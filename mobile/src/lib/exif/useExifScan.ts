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
import type { ScanScope, TimedPhotoRecord, LocatedPhotoRecord, UnlocatedPhotoRecord } from "../../../../src/lib/journal/sources/exif/types";
import type { Place, PlaceEntry, PhotoEvidenceRef } from "@chronicle/journal/types";
import { uid } from "@chronicle/journal/types";

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

      // ── Step 6: dedup against existing data and produce new records ────────
      //   For each BuiltPlaceEntry:
      //     a. Skip if a PlaceEntry already exists with the same dedupeKey.
      //     b. Find or create a Place container for the locality.
      //     c. Create a new pending PlaceEntry.
      //   Full staging logic (bin matching, batch actions, hints) is WP13.
      const existingPlaces = journal.localityPlaces ?? [];
      const existingEntryKeys = new Set(
        (journal.placeEntries ?? []).map((e) => e.dedupeKey),
      );

      // Build a lookup from localityKey → Place (also from aliasKeys)
      const placeByKey = new Map<string, Place>(
        existingPlaces.flatMap((p): [string, Place][] => [
          [p.localityKey, p],
          ...((p.aliasKeys ?? []).map((ak) => [ak, p] as [string, Place])),
        ]),
      );

      const MAX_EVIDENCE_REFS = 5;
      const newPlaces: Place[]      = [];
      const newEntries: PlaceEntry[] = [];

      for (const built of builtEntries) {
        const dedupeKey = `place-entry|${built.localityKey}|${built.localDay}`;
        if (existingEntryKeys.has(dedupeKey)) continue; // already exists

        // Find or create the Place container
        let place = placeByKey.get(built.localityKey);
        if (!place) {
          place = {
            id: uid(),
            kind: "place",
            localityKey: built.localityKey,
            locality: built.locality,
            region: built.region,
            country: built.country,
            createdAt: new Date().toISOString(),
          };
          placeByKey.set(built.localityKey, place);
          newPlaces.push(place);
        }

        // Sample photo evidence (located first, then unlocated to fill up to cap)
        const evidenceRefs: PhotoEvidenceRef[] = [
          ...built.photos.slice(0, MAX_EVIDENCE_REFS).map((p) => ({
            mediaId: p.mediaId,
            localDay: p.localDay,
            hasGps: true as const,
            timingRule: p.timingRule,
          })),
          ...built.unlocatedPhotos
            .slice(0, Math.max(0, MAX_EVIDENCE_REFS - built.photos.length))
            .map((p) => ({
              mediaId: p.mediaId,
              localDay: p.localDay,
              hasGps: false as const,
              timingRule: p.timingRule,
            })),
        ];

        const totalPhotos = built.photos.length + built.unlocatedPhotos.length;
        const entry: PlaceEntry = {
          id: uid(),
          kind: "place-entry",
          source: "photo-library",
          tier: 2,
          start: built.localDay,   // Base.start mirrors localDay
          placeId: place.id,
          localityKey: built.localityKey,
          localDay: built.localDay,
          photoEvidence: evidenceRefs,
          photoCount: totalPhotos,
          singlePhoto: totalPhotos === 1,
          status: "pending",
          dedupeKey,
          createdAt: new Date().toISOString(),
        };
        newEntries.push(entry);
      }

      // ── Step 7: commit ─────────────────────────────────────────────────────
      setState((s) => ({ ...s, phase: "committing" }));
      if (newPlaces.length  > 0) await putMany("localityPlaces", newPlaces);
      if (newEntries.length > 0) await putMany("placeEntries",   newEntries);

      setState((s) => ({ ...s, phase: "done", created: newEntries.length, extended: 0 }));

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
