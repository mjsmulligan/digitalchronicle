/**
 * WP8 — useExifScan hook.
 *
 * Orchestrates the full EXIF pipeline from permissions to committed PlaceEvents.
 * Device modules (expo-media-library, expo-location) are lazy-required so the
 * settings screen loads in Expo Go; the scan itself requires a dev build.
 */

import { useCallback, useRef, useState } from "react";
import { putMany, getState } from "@chronicle/journal/db";
import { uid, type ImportRun } from "@chronicle/journal/types";
import { resolveLocalDay } from "@chronicle/journal/sources/exif/timeResolution";
import { InMemoryLocalityCache, ResolvingLocalityResolver } from "@chronicle/journal/sources/exif/localityResolver";
import {
  createdAtList,
  newestCreatedAt,
  nextMarkerTimestamp,
  resolvePhotoLocalities,
} from "@chronicle/journal/sources/exif/scanPipeline";
import { buildPlaceEntries } from "@chronicle/journal/sources/exif/entryBuilder";
import { buildStagingPlan } from "@chronicle/journal/sources/exif/stagingService";
import type { ScanScope, TimedPhotoRecord } from "@chronicle/journal/sources/exif/types";
import { getScanMarker, setScanMarker } from "./scanPrefs";

// ─── Lazy device module loader ────────────────────────────────────────────────
// expo-media-library requires native code not present in Expo Go.
// Lazy require means the settings screen renders even without native modules.

function loadDeviceModules() {
  try {
    const mediaAccess = require("./mediaAccess") as typeof import("./mediaAccess");
    const geocoder = require("./deviceGeocoder") as typeof import("./deviceGeocoder");
    if (typeof mediaAccess?.requestMediaPermissions !== "function") return null;
    if (typeof geocoder?.deviceGeocoder?.resolve !== "function") return null;
    return { mediaAccess, geocoder };
  } catch {
    return null;
  }
}

// ─── State ────────────────────────────────────────────────────────────────────

export type ScanPhase =
  | "idle"
  | "requesting-permissions"
  | "scanning"
  | "geocoding"
  | "building"
  | "committing"
  | "done"
  | "error"
  | "cancelled"
  | "permission-denied";

export interface ScanState {
  phase: ScanPhase;
  scanned: number;
  pending: number;
  created: number;
  extended: number;
  error?: string;
}

const IDLE: ScanState = { phase: "idle", scanned: 0, pending: 0, created: 0, extended: 0 };

const DEV_BUILD_MSG = "Requires a dev build — run: npx expo run:android";

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useExifScan() {
  const [state, setState] = useState<ScanState>(IDLE);
  const cancelRef = useRef(false);

  const cancel = useCallback(() => { cancelRef.current = true; }, []);
  const reset  = useCallback(() => setState(IDLE), []);

  const start = useCallback(async (scope: ScanScope = { kind: "all" }) => {
    cancelRef.current = false;
    setState({ ...IDLE, phase: "requesting-permissions" });

    try {
      // Check native modules are available — inside try/catch so any JSI-level
      // error that escapes loadDeviceModules is still handled gracefully.
      const modules = loadDeviceModules();
      if (!modules) {
        setState((s) => ({ ...s, phase: "error", error: DEV_BUILD_MSG }));
        return;
      }

      const { mediaAccess: { requestMediaPermissions, scanPhotos }, geocoder: { deviceGeocoder } } = modules;
      // ── Step 1: permissions ────────────────────────────────────────────────
      const perms = await requestMediaPermissions();
      if (perms.status !== "granted" && perms.status !== "limited") {
        setState((s) => ({ ...s, phase: "permission-denied" }));
        return;
      }

      setState((s) => ({ ...s, phase: "scanning" }));
      const scanStartedAt = Date.now();
      // A "since" scan (for example reconnecting from the Sources page) must stay
      // inside the user's chosen scope, so read it from the stored marker.
      const previousMarker = await getScanMarker();
      const effectiveScope: ScanScope =
        scope.kind === "since" && scope.base === undefined && previousMarker
          ? { ...scope, base: previousMarker.scope }
          : scope;

      // ── Step 2 + 3: scan + time-resolve ───────────────────────────────────
      const timed: TimedPhotoRecord[] = [];
      const journal = getState();
      const legs = journal.legs;
      const fallbackTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

      for await (const batch of scanPhotos(effectiveScope)) {
        if (cancelRef.current) { setState((s) => ({ ...s, phase: "cancelled" })); return; }
        for (const photo of batch) timed.push(resolveLocalDay(photo, legs, fallbackTz));
        setState((s) => ({ ...s, scanned: timed.length }));
      }

      if (cancelRef.current) { setState((s) => ({ ...s, phase: "cancelled" })); return; }

      // ── Step 4: geocode ────────────────────────────────────────────────────
      setState((s) => ({ ...s, phase: "geocoding" }));
      const cache = new InMemoryLocalityCache();
      const resolver = new ResolvingLocalityResolver(deviceGeocoder, cache);
      const outcome = await resolvePhotoLocalities(timed, resolver, {
        shouldCancel: () => cancelRef.current,
        onProgress: (pending) => setState((s) => ({ ...s, pending })),
      });
      if (!outcome) { setState((s) => ({ ...s, phase: "cancelled" })); return; }
      const { located, unlocated, unresolved } = outcome;

      // ── Step 5: build place entries (one per locality × day) ──────────────
      setState((s) => ({ ...s, phase: "building" }));
      const builtEntries = buildPlaceEntries(located, unlocated, legs);

      // ── Step 6: staging plan (dedup, bin match, evidence update) ──────────
      // Pre-generate an importId so new entries can carry it before the run is written.
      const importId = uid();
      const startedAt = new Date().toISOString();

      const plan = buildStagingPlan(
        builtEntries,
        journal.localityPlaces  ?? [],
        journal.placeEntries    ?? [],
        journal.placeBinMarkers ?? [],
        importId,
      );

      // ── Step 7: commit ─────────────────────────────────────────────────────
      setState((s) => ({ ...s, phase: "committing" }));
      if (plan.newPlaces.length      > 0) await putMany("localityPlaces", plan.newPlaces);
      if (plan.newEntries.length     > 0) await putMany("placeEntries",   plan.newEntries);
      if (plan.updatedEntries.length > 0) await putMany("placeEntries",   plan.updatedEntries);

      // Write an ImportRun only when at least one new entry was created.
      // Evidence-only updates and no-change rescans leave no run record.
      if (plan.newEntries.length > 0) {
        const run: ImportRun = {
          id: importId,
          source: "photo-library",
          filename: "Photo library scan",
          // "since" scope is only used by the startup check; all other scopes are manual.
          trigger: scope.kind === "since" ? "startup" : "manual",
          startedAt,
          finishedAt: new Date().toISOString(),
          status: "done",
          added: plan.newEntries.length,
          updated: plan.updatedEntries.length,
          skipped: { duplicate: 0, inFile: 0, removed: 0 },
          errors: [],
          replaced: [],
        };
        await putMany("importRuns", [run]);
      }

      // Advance the scan marker now that the scan completed successfully.
      // The marker stores the user's base scope so future startup checks know which
      // albums or date range to apply, and a timestamp that starts from when this scan
      // began and stays behind photos whose lookup failed (see scanPipeline.ts).
      // A "since" scan keeps the stored base scope; a manual scan replaces it.
      const markerScope = scope.kind === "since"
        ? (previousMarker?.scope ?? scope.base ?? { kind: "all" as const })
        : scope;
      await setScanMarker(
        markerScope,
        nextMarkerTimestamp({
          previous: scope.kind === "since" ? previousMarker?.lastScannedAt ?? null : null,
          scanStartedAt,
          newestProcessedAt: newestCreatedAt(timed),
          unresolvedCreatedAt: createdAtList(unresolved),
        }),
      );

      setState((s) => ({
        ...s,
        phase: "done",
        created:  plan.newEntries.length,
        extended: plan.updatedEntries.length,
      }));

    } catch (err) {
      const msg = String(err);
      setState((s) => ({
        ...s,
        phase: "error",
        error: msg.includes("native module") || msg.includes("NativeModule")
          ? DEV_BUILD_MSG
          : msg,
      }));
    }
  }, []);

  return { state, start, cancel, reset };
}
