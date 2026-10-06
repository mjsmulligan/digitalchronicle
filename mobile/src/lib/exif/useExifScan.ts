/**
 * WP8 — useExifScan hook.
 *
 * Orchestrates the full EXIF pipeline from permissions to committed PlaceEvents.
 * Device modules (expo-media-library, expo-location) are lazy-required so the
 * settings screen loads in Expo Go; the scan itself requires a dev build.
 */

import { useCallback, useRef, useState } from "react";
import { putMany, getState } from "@chronicle/journal/db";
import { resolveLocalDay } from "../../../../src/lib/journal/sources/exif/timeResolution";
import { InMemoryLocalityCache, ResolvingLocalityResolver } from "../../../../src/lib/journal/sources/exif/localityResolver";
import { buildPlaceEntries } from "../../../../src/lib/journal/sources/exif/entryBuilder";
import { buildStagingPlan } from "../../../../src/lib/journal/sources/exif/stagingService";
import type { ScanScope, TimedPhotoRecord, LocatedPhotoRecord, UnlocatedPhotoRecord } from "../../../../src/lib/journal/sources/exif/types";

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

      // ── Step 2 + 3: scan + time-resolve ───────────────────────────────────
      const timed: TimedPhotoRecord[] = [];
      const journal = getState();
      const legs = journal.legs;
      const fallbackTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

      for await (const batch of scanPhotos(scope)) {
        if (cancelRef.current) { setState((s) => ({ ...s, phase: "cancelled" })); return; }
        for (const photo of batch) timed.push(resolveLocalDay(photo, legs, fallbackTz));
        setState((s) => ({ ...s, scanned: timed.length }));
      }

      if (cancelRef.current) { setState((s) => ({ ...s, phase: "cancelled" })); return; }

      // ── Step 4: geocode ────────────────────────────────────────────────────
      setState((s) => ({ ...s, phase: "geocoding" }));
      const cache = new InMemoryLocalityCache();
      const resolver = new ResolvingLocalityResolver(deviceGeocoder, cache);
      const located: LocatedPhotoRecord[] = [];
      const unlocated: UnlocatedPhotoRecord[] = [];

      for (const photo of timed) {
        if (cancelRef.current) { setState((s) => ({ ...s, phase: "cancelled" })); return; }
        if (photo.latitude !== null && photo.longitude !== null) {
          const info = await resolver.resolve(photo.latitude, photo.longitude, photo.localDay);
          if (info) located.push({ ...photo, locality: info });
          else      unlocated.push({ ...photo, locality: null });
        } else {
          unlocated.push({ ...photo, locality: null });
        }
        setState((s) => ({ ...s, pending: resolver.pendingCount }));
      }

      if (resolver.pendingCount > 0) {
        await resolver.retryPending();
        setState((s) => ({ ...s, pending: resolver.pendingCount }));
      }

      // ── Step 5: build place entries (one per locality × day) ──────────────
      setState((s) => ({ ...s, phase: "building" }));
      const builtEntries = buildPlaceEntries(located, unlocated, legs);

      // ── Step 6: staging plan (dedup, bin match, evidence update) ──────────
      const plan = buildStagingPlan(
        builtEntries,
        journal.localityPlaces  ?? [],
        journal.placeEntries    ?? [],
        journal.placeBinMarkers ?? [],
      );

      // ── Step 7: commit ─────────────────────────────────────────────────────
      setState((s) => ({ ...s, phase: "committing" }));
      if (plan.newPlaces.length      > 0) await putMany("localityPlaces", plan.newPlaces);
      if (plan.newEntries.length     > 0) await putMany("placeEntries",   plan.newEntries);
      if (plan.updatedEntries.length > 0) await putMany("placeEntries",   plan.updatedEntries);

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
