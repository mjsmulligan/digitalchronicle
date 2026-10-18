/**
 * WP12b — Photo library connected source.
 *
 * Registers the photo library as a connected source so it is checked once per
 * app launch (with the runner's 6-hour throttle). Uses a silent permission
 * check and the "since" scan scope so only photos added since the last completed
 * scan are processed on startup.
 *
 * Spec reference: docs/specs/auto-import.md, WP12b.
 *
 * Key constraints:
 *   - Never prompts for permissions (uses getMediaPermissions, not requestMediaPermissions).
 *   - Returns early without error when no scan marker exists (user has not yet run a
 *     first manual scan — startup check is not the right moment to onboard them).
 *   - Caps new photos at STARTUP_CAP to keep startup latency predictable.
 *   - Advances the scan marker only after the pipeline commits successfully.
 *   - Preserves the base scope (all / albums / date-range) stored in the marker.
 */

import { putMany, getState } from "@chronicle/journal/db";
import { uid, type ImportRun } from "@chronicle/journal/types";
import { resolveLocalDay } from "../../../../src/lib/journal/sources/exif/timeResolution";
import {
  InMemoryLocalityCache,
  ResolvingLocalityResolver,
} from "../../../../src/lib/journal/sources/exif/localityResolver";
import { buildPlaceEntries } from "../../../../src/lib/journal/sources/exif/entryBuilder";
import { buildStagingPlan } from "../../../../src/lib/journal/sources/exif/stagingService";
import type { SourceDef } from "../connectedSources";
import { getScanMarker, setScanMarker } from "./scanPrefs";
import type {
  TimedPhotoRecord,
  LocatedPhotoRecord,
  UnlocatedPhotoRecord,
} from "../../../../src/lib/journal/sources/exif/types";

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Maximum number of new photos processed per startup check.
 * Photos above the cap are picked up on the next launch.
 * Manual scans (useExifScan) are not capped.
 */
const STARTUP_CAP = 500;

// ─── Device module loader ─────────────────────────────────────────────────────

// Same lazy-require pattern as useExifScan.ts: expo-media-library and
// expo-location require native code absent in Expo Go. Returning null lets
// check() bail out silently when native modules are unavailable.
function loadDeviceModules() {
  try {
    const mediaAccess = require("./mediaAccess") as typeof import("./mediaAccess");
    const geocoder = require("./deviceGeocoder") as typeof import("./deviceGeocoder");
    if (typeof mediaAccess?.getMediaPermissions !== "function") return null;
    if (typeof geocoder?.deviceGeocoder?.resolve !== "function") return null;
    return { mediaAccess, geocoder };
  } catch {
    return null;
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function makePhotoSource(): SourceDef {
  return {
    id: "photo-library",

    /**
     * The photo source is "connected" once the user has completed at least one
     * manual scan (which writes the scan marker for the first time). Before the
     * first scan the startup check has no timestamp to work from, so we treat it
     * as not yet connected and skip silently.
     */
    async isConnected() {
      return (await getScanMarker()) !== null;
    },

    /**
     * Run a silent incremental photo check.
     *
     * Fetches only photos created after marker.lastScannedAt, caps at 500,
     * runs the full EXIF pipeline, and commits any new place entries.
     * Advances the scan marker only after a successful commit.
     * Throws "Permission needed" if permission is absent or revoked (the runner
     * records this as a source error and does not advance lastCheckedAt).
     */
    async check() {
      const modules = loadDeviceModules();
      if (!modules) return; // Native modules unavailable; skip silently.

      const {
        mediaAccess: { getMediaPermissions, scanPhotos },
        geocoder: { deviceGeocoder },
      } = modules;

      // Silent permission check: never prompt from a startup check.
      const perm = await getMediaPermissions();
      if (perm.status !== "granted" && perm.status !== "limited") {
        throw new Error("Permission needed");
      }

      const marker = await getScanMarker();
      if (!marker) return; // No first scan yet; startup check has nothing to anchor to.

      const scope = { kind: "since" as const, timestamp: marker.lastScannedAt };

      // ── Scan + time-resolve (capped at STARTUP_CAP) ────────────────────────
      const journal = getState();
      const legs = journal.legs;
      const fallbackTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

      const timed: TimedPhotoRecord[] = [];
      for await (const batch of scanPhotos(scope)) {
        for (const photo of batch) {
          if (timed.length >= STARTUP_CAP) break;
          timed.push(resolveLocalDay(photo, legs, fallbackTz));
        }
        if (timed.length >= STARTUP_CAP) break;
      }

      // ── Geocode ────────────────────────────────────────────────────────────
      const cache = new InMemoryLocalityCache();
      const resolver = new ResolvingLocalityResolver(deviceGeocoder, cache);
      const located: LocatedPhotoRecord[] = [];
      const unlocated: UnlocatedPhotoRecord[] = [];

      for (const photo of timed) {
        if (photo.latitude !== null && photo.longitude !== null) {
          const info = await resolver.resolve(photo.latitude, photo.longitude, photo.localDay);
          if (info) located.push({ ...photo, locality: info });
          else      unlocated.push({ ...photo, locality: null });
        } else {
          unlocated.push({ ...photo, locality: null });
        }
      }

      if (resolver.pendingCount > 0) await resolver.retryPending();

      // ── Build place entries ────────────────────────────────────────────────
      const builtEntries = buildPlaceEntries(located, unlocated, legs);

      // ── Staging plan (dedup + bin match) ──────────────────────────────────
      const importId = uid();
      const startedAt = new Date().toISOString();

      const plan = buildStagingPlan(
        builtEntries,
        journal.localityPlaces  ?? [],
        journal.placeEntries    ?? [],
        journal.placeBinMarkers ?? [],
        importId,
      );

      // ── Commit ─────────────────────────────────────────────────────────────
      if (plan.newPlaces.length      > 0) await putMany("localityPlaces", plan.newPlaces);
      if (plan.newEntries.length     > 0) await putMany("placeEntries",   plan.newEntries);
      if (plan.updatedEntries.length > 0) await putMany("placeEntries",   plan.updatedEntries);

      if (plan.newEntries.length > 0) {
        const run: ImportRun = {
          id: importId,
          source: "photo-library",
          filename: "Photo library scan",
          trigger: "startup",
          startedAt,
          finishedAt: new Date().toISOString(),
          status: "done",
          added: plan.newEntries.length,
          updated: 0,
          skipped: { duplicate: 0, inFile: 0, removed: 0 },
          errors: [],
          replaced: [],
        };
        await putMany("importRuns", [run]);
      }

      // ── Advance marker (only on successful completion) ────────────────────
      // Preserve the base scope (all / albums / date-range) from the stored marker
      // so future startup checks continue to respect the user's scan preference.
      // setScanMarker updates lastScannedAt to now.
      await setScanMarker(marker.scope);
    },
  };
}
