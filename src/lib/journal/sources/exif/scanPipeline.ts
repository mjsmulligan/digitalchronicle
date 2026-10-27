/**
 * Scan pipeline helpers (pure).
 *
 * Shared by the startup check (mobile/src/lib/exif/photoSource.ts) and the manual
 * scan (useExifScan.ts), which previously each carried their own copy of this logic.
 *
 *   resolvePhotoLocalities  geocode photos, retry failures, and report which photos
 *                           are still waiting on a lookup
 *   nextMarkerTimestamp     decide how far the incremental-scan marker may advance
 *
 * Spec §8: "If a lookup fails or the phone is offline: the photos stay pending with
 * their coordinates and are retried on the next scan." These helpers are what make
 * that true for the incremental scan.
 */

import type { ResolvingLocalityResolver } from "./localityResolver";
import type { LocatedPhotoRecord, TimedPhotoRecord, UnlocatedPhotoRecord } from "./types";

// ─── Locality resolution ──────────────────────────────────────────────────────

export interface ResolveHooks {
  /** Checked before each photo. Returning true stops the pass. */
  shouldCancel?: () => boolean;
  /** Called as lookups succeed or queue up, with how many are waiting for a retry. */
  onProgress?: (pending: number) => void;
}

export interface ResolveOutcome {
  located: LocatedPhotoRecord[];
  unlocated: UnlocatedPhotoRecord[];
  /**
   * Photos that have GPS but whose lookup failed and is still waiting for a retry
   * (offline, geocoder error). They are also in `unlocated` so they can still attach
   * to a day's entry as evidence, but the scan marker must not move past them.
   * A photo the geocoder simply has no answer for is not listed here.
   */
  unresolved: TimedPhotoRecord[];
}

/**
 * Resolve photos to localities.
 *
 * Failed lookups are retried once at the end, and photos whose retry succeeded are
 * moved into `located`. (Before this, retryPending() only warmed the cache, so photos
 * that failed the first time stayed unlocated even after the retry worked.)
 *
 * Returns null if `shouldCancel` stopped the pass.
 */
export async function resolvePhotoLocalities(
  timed: TimedPhotoRecord[],
  resolver: ResolvingLocalityResolver,
  hooks: ResolveHooks = {},
): Promise<ResolveOutcome | null> {
  const located: LocatedPhotoRecord[] = [];
  const unlocated: UnlocatedPhotoRecord[] = [];
  const gpsMisses: TimedPhotoRecord[] = [];

  for (const photo of timed) {
    if (hooks.shouldCancel?.()) return null;

    if (photo.latitude !== null && photo.longitude !== null) {
      const info = await resolver.resolve(photo.latitude, photo.longitude, photo.localDay);
      if (info) located.push({ ...photo, locality: info });
      else gpsMisses.push(photo);
    } else {
      unlocated.push({ ...photo, locality: null });
    }
    hooks.onProgress?.(resolver.pendingCount);
  }

  if (resolver.pendingCount > 0) {
    await resolver.retryPending();
    hooks.onProgress?.(resolver.pendingCount);
  }

  const unresolved: TimedPhotoRecord[] = [];
  for (const photo of gpsMisses) {
    const lat = photo.latitude as number;
    const lon = photo.longitude as number;
    const info = resolver.peek(lat, lon);
    if (info) {
      located.push({ ...photo, locality: info });
      continue;
    }
    unlocated.push({ ...photo, locality: null });
    if (resolver.hasPending(lat, lon)) unresolved.push(photo);
  }

  return { located, unlocated, unresolved };
}

// ─── Scan marker ──────────────────────────────────────────────────────────────

/**
 * How long a photo with a failed lookup can hold the marker back. After this the
 * photo is given up on, so a place the geocoder can never resolve does not freeze
 * the incremental scan forever.
 */
export const UNRESOLVED_HOLD_MS = 30 * 86_400_000;

export interface MarkerInput {
  /** The marker before this scan, or null for a manual scan that covers everything. */
  previous: string | null;
  /** When this scan began (ms). Photos created after this are left for the next scan. */
  scanStartedAt: number;
  /** True if the scan stopped before reading every photo in scope (the startup cap). */
  capped?: boolean;
  /** Newest creation time (ms) among the photos that were processed. */
  newestProcessedAt?: number;
  /** Creation times (ms) of photos whose lookup is still waiting for a retry. */
  unresolvedCreatedAt?: number[];
}

/**
 * Work out the timestamp the scan marker should move to.
 *
 * The marker is where the next incremental scan starts reading, so it must never move
 * past a photo that was not fully handled:
 *
 *   - It uses the time the scan began, not the time it ended, so photos added during
 *     the scan are picked up next time.
 *   - If the scan stopped at the startup cap, it stops at the newest photo processed,
 *     so the rest are read on the next launch (this is what the code comment always
 *     promised; the marker used to jump to "now" and skip them).
 *   - It stops short of photos whose lookup is still waiting for a retry, for up to
 *     UNRESOLVED_HOLD_MS.
 *
 * One millisecond is taken off a held back boundary because the library's date filter
 * may be exclusive. Reading one photo twice is harmless, since the staging plan skips
 * photos it already holds.
 */
export function nextMarkerTimestamp(input: MarkerInput): string {
  const previousMs = input.previous ? Date.parse(input.previous) : Number.NaN;
  const hasPrevious = Number.isFinite(previousMs);

  let t = input.scanStartedAt;

  if (input.capped) {
    if (input.newestProcessedAt === undefined) {
      // We cannot tell where the scan stopped, so do not move the marker.
      return hasPrevious ? (input.previous as string) : new Date(0).toISOString();
    }
    t = Math.min(t, input.newestProcessedAt - 1);
  }

  for (const created of input.unresolvedCreatedAt ?? []) {
    if (input.scanStartedAt - created <= UNRESOLVED_HOLD_MS) t = Math.min(t, created - 1);
  }

  if (hasPrevious) t = Math.max(t, previousMs);
  return new Date(t).toISOString();
}

/** The largest creation time among photos that report one, or undefined. */
export function newestCreatedAt(photos: Array<{ createdAt?: number }>): number | undefined {
  let newest: number | undefined;
  for (const p of photos) {
    if (p.createdAt !== undefined && (newest === undefined || p.createdAt > newest)) {
      newest = p.createdAt;
    }
  }
  return newest;
}

/** Creation times of the given photos, skipping any that do not report one. */
export function createdAtList(photos: Array<{ createdAt?: number }>): number[] {
  return photos.flatMap((p) => (p.createdAt !== undefined ? [p.createdAt] : []));
}
