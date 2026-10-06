/**
 * WP7 — Sync and re-scan (pure logic).
 *
 * Spec reference: docs/specs/Source spec_ Photo library (EXIF).md, section 11.
 *
 * Responsibilities:
 *   1. Given a new `StagingBatch` of place candidates and the current set of
 *      committed `PlaceEvent`s, produce an `UpsertPlan` describing which entries
 *      to create, extend (mutate date range + evidence), or leave unchanged.
 *   2. Mark `PhotoEvidenceRef`s as `missing: true` when a photo has been deleted
 *      from the device library since the last scan.
 *   3. Build/update an `ExifScanMarker` so the next scan can be incremental.
 *
 * Re-scan idempotency guarantee (spec §11, acceptance check 3):
 *   Running the same scan twice must produce zero new writes on the second pass.
 *   This is achieved by matching on `dedupeKey` (same localityKey + same dateStart)
 *   for exact duplicates, and by merging adjacent/overlapping date ranges instead
 *   of creating new entries for visits that extend an existing place.
 *
 * No network calls, no device APIs, no React Native imports in this file.
 */

import type { PlaceEvent, PhotoEvidenceRef } from "../../types";
import type { ExifScanMarker, ScanScope } from "./types";

// ─── Types ────────────────────────────────────────────────────────────────────

/** A candidate place that came out of the staging mapper (WP6). */
export interface PlaceCandidate {
  /** PlaceEvent as produced by mapToStagingBatch */
  entry: PlaceEvent;
}

/** The action to take for a single candidate */
export type UpsertAction =
  | { kind: "create"; entry: PlaceEvent }
  | { kind: "extend"; existing: PlaceEvent; merged: PlaceEvent }
  | { kind: "no-op"; existing: PlaceEvent; reason: "exact-duplicate" | "subsumed" };

/** The complete set of changes to apply to the placeEvents store */
export interface UpsertPlan {
  actions: UpsertAction[];
  /** Convenience: entries to write (creates + extends) */
  toWrite: PlaceEvent[];
  /** Convenience: ids to delete (none currently — extends replace in-place) */
  toDelete: string[];
}

// ─── Date range helpers ───────────────────────────────────────────────────────

/**
 * Returns true when two date ranges overlap or are adjacent (differ by ≤1 day).
 * Adjacent ranges (Jul-15 end / Jul-16 start) are treated as one continuous visit.
 */
export function rangesOverlapOrAdjacent(
  aStart: string, aEnd: string,
  bStart: string, bEnd: string,
): boolean {
  // Overlap: a starts before b ends AND a ends after b starts
  // (≤ because same-day ranges overlap even if they're equal)
  // Adjacent: aEnd is one day before bStart, or vice versa
  const aEndMs = Date.UTC(+aEnd.slice(0, 4), +aEnd.slice(5, 7) - 1, +aEnd.slice(8, 10));
  const bStartMs = Date.UTC(+bStart.slice(0, 4), +bStart.slice(5, 7) - 1, +bStart.slice(8, 10));
  const aStartMs = Date.UTC(+aStart.slice(0, 4), +aStart.slice(5, 7) - 1, +aStart.slice(8, 10));
  const bEndMs = Date.UTC(+bEnd.slice(0, 4), +bEnd.slice(5, 7) - 1, +bEnd.slice(8, 10));

  const ONE_DAY = 86_400_000;
  // b starts at most one day after a ends (adjacent), AND a starts at most one day after b ends
  return bStartMs - aEndMs <= ONE_DAY && aStartMs - bEndMs <= ONE_DAY;
}

/** Returns the earlier of two YYYY-MM-DD strings. */
export function minDay(a: string, b: string): string {
  return a <= b ? a : b;
}

/** Returns the later of two YYYY-MM-DD strings. */
export function maxDay(a: string, b: string): string {
  return a >= b ? a : b;
}

// ─── Evidence merge ───────────────────────────────────────────────────────────

/**
 * Merge two evidence ref arrays: de-duplicate by `mediaId`, keep refs from both.
 * The cap (MAX_EVIDENCE_REFS) is intentionally NOT re-applied here — we want to
 * preserve existing evidence when extending a place. The cap only applies on first
 * creation (handled by WP6's sampleEvidenceRefs).
 */
export function mergeEvidence(
  existing: PhotoEvidenceRef[],
  incoming: PhotoEvidenceRef[],
): PhotoEvidenceRef[] {
  const seen = new Set(existing.map((r) => r.mediaId));
  const extras = incoming.filter((r) => !seen.has(r.mediaId));
  return [...existing, ...extras];
}

// ─── Missing-photo marker ─────────────────────────────────────────────────────

/**
 * Returns a new PlaceEvent with any evidence refs whose `mediaId` is no longer
 * in the current library marked as `missing: true`.
 *
 * Spec §11: "If a photo is deleted from the library, mark it as missing in the
 * existing place's photoEvidence rather than removing the place."
 *
 * @param place        The existing committed place to update.
 * @param currentIds   Set of mediaIds that are present in the current library.
 * @returns            The place with refs updated, or the original if unchanged.
 */
export function markMissingPhotos(place: PlaceEvent, currentIds: Set<string>): PlaceEvent {
  const updatedRefs = place.photoEvidence.map((ref) =>
    !ref.missing && !currentIds.has(ref.mediaId) ? { ...ref, missing: true as const } : ref,
  );
  const changed = updatedRefs.some((r, i) => r !== place.photoEvidence[i]);
  if (!changed) return place;
  return { ...place, photoEvidence: updatedRefs };
}

// ─── Main: build upsert plan ──────────────────────────────────────────────────

/**
 * WP7: Compute the set of changes needed to sync a batch of new place candidates
 * into the existing placeEvents store.
 *
 * Algorithm:
 *   For each candidate:
 *   1. Look for an existing PlaceEvent with the same `localityKey` whose date
 *      range overlaps or is adjacent to the candidate's range.
 *   2. If found and ranges are identical → no-op (exact-duplicate).
 *   3. If found and ranges overlap/adjacent → extend: merge date range and evidence.
 *   4. If the candidate's range is fully contained in an existing range → no-op (subsumed).
 *   5. Otherwise → create new entry.
 *
 * @param candidates      New place candidates from the staging mapper (WP6).
 * @param existingPlaces  Current PlaceEvents in the journal store.
 * @returns               UpsertPlan to execute.
 */
export function buildUpsertPlan(
  candidates: PlaceCandidate[],
  existingPlaces: PlaceEvent[],
): UpsertPlan {
  // Index existing places by localityKey for efficient lookup
  const byLocality = new Map<string, PlaceEvent[]>();
  for (const p of existingPlaces) {
    const list = byLocality.get(p.localityKey) ?? [];
    list.push(p);
    byLocality.set(p.localityKey, list);
  }

  const actions: UpsertAction[] = [];
  // Track which existing places have already been extended this run (avoid double-extending)
  const extended = new Map<string, PlaceEvent>(); // id → merged

  for (const { entry: candidate } of candidates) {
    const sameLocality = byLocality.get(candidate.localityKey) ?? [];

    // Find the first existing place that overlaps or is adjacent
    let matched: PlaceEvent | undefined;
    for (const existing of sameLocality) {
      // Use the already-extended version if we merged it earlier this run
      const current = extended.get(existing.id) ?? existing;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      if (rangesOverlapOrAdjacent(current.start, current.end!, candidate.start, candidate.end!)) {
        matched = current;
        break;
      }
    }

    if (!matched) {
      // No overlap → create
      actions.push({ kind: "create", entry: candidate });
      continue;
    }

    // Exact duplicate (same start + same end) → no-op
    if (matched.start === candidate.start && matched.end === candidate.end) {
      actions.push({ kind: "no-op", existing: matched, reason: "exact-duplicate" });
      continue;
    }

    // Subsumed: candidate range fully contained in existing → no-op
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    if (candidate.start >= matched.start && candidate.end! <= matched.end!) {
      actions.push({ kind: "no-op", existing: matched, reason: "subsumed" });
      continue;
    }

    // Overlap / adjacent → extend: widen date range, merge evidence
    const merged: PlaceEvent = {
      ...matched,
      start: minDay(matched.start, candidate.start),
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      end: maxDay(matched.end!, candidate.end!),
      photoEvidence: mergeEvidence(matched.photoEvidence, candidate.photoEvidence),
      photoCount: matched.photoCount + candidate.photoCount,
    };

    extended.set(matched.id, merged);
    actions.push({ kind: "extend", existing: matched, merged });
  }

  // Deduplicate: if the same existing entry was extended multiple times (two
  // separate candidates merged into it), only keep the last merged version.
  const latestMerge = new Map<string, PlaceEvent>(); // existing id → final merged
  for (const action of actions) {
    if (action.kind === "extend") latestMerge.set(action.existing.id, action.merged);
  }

  const toWrite: PlaceEvent[] = [
    ...actions.filter((a) => a.kind === "create").map((a) => (a as { kind: "create"; entry: PlaceEvent }).entry),
    ...latestMerge.values(),
  ];

  return { actions, toWrite, toDelete: [] };
}

// ─── Scan marker ──────────────────────────────────────────────────────────────

/**
 * Build an updated `ExifScanMarker` after a completed scan.
 */
export function buildScanMarker(scope: ScanScope): ExifScanMarker {
  return {
    sourceId: "photo-library",
    lastScannedAt: new Date().toISOString(),
    scope,
  };
}
