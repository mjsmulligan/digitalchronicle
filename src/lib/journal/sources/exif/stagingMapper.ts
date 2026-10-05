/**
 * WP6 — Staging mapper (pure).
 *
 * Spec reference: docs/specs/Source spec_ Photo library (EXIF).md, section 10.
 *
 * Converts `BuiltPlace[]` (WP5 output) into a `StagingBatch` containing
 * `StagedRecord[]` ready for the staging layer to commit or discard.
 *
 * Responsibilities:
 *   1. Build a `PlaceEvent` from each `BuiltPlace`.
 *   2. Assign confidence based on photo count and timing rule quality.
 *   3. Sample photo evidence (max MAX_EVIDENCE_REFS per place).
 *   4. Propose a trip link when the place dates overlap a known trip.
 *   5. Classify each record (new / duplicate / supersedes / superseded)
 *      against the existing journal entries.
 *   6. Assemble and return a `StagingBatch`.
 *
 * No network calls, no device APIs, no React Native imports in this file.
 */

import type { Entry, PlaceEvent, PhotoEvidenceRef, StagedRecord, StagingBatch, Trip } from "../../types";
import { uid } from "../../types";
import type { BuiltPlace } from "./types";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Source identifier used in PlaceEvent.source and StagingBatch.source */
export const EXIF_SOURCE_ID = "photo-library" as const;

/** Tier for photo-library evidence: primary attendance record */
export const EXIF_TIER = 2 as const;

/**
 * Maximum number of photo evidence refs included per PlaceEvent.
 * The full count is still recorded in `photoCount` — this is just a sampling
 * cap to keep the stored entry small.
 */
export const MAX_EVIDENCE_REFS = 10;

/**
 * Minimum photo count required to promote confidence from "inferred" to "approximate".
 * (Spec §10: "a place with ≥5 photos from multiple days is more likely to be correct".)
 */
export const MIN_PHOTOS_FOR_APPROXIMATE = 5;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Derive the confidence level for a place from its evidence.
 *
 * Rules (spec §10):
 *   - Single photo only → "inferred" (weakest signal)
 *   - Multiple photos but all using "fallback" timing (no GPS, no EXIF offset) → "inferred"
 *   - 5+ photos, at least one with gps or exif-offset timing → "approximate"
 *   - Places coming from direct booking/calendar sources would be "confirmed";
 *     photo-library evidence is never stronger than "approximate".
 */
export function placeConfidence(place: BuiltPlace): PlaceEvent["confidence"] {
  const allPhotos = [...place.photos, ...place.unlocatedPhotos];
  if (allPhotos.length < 2) return "inferred";

  const hasGoodTiming = place.photos.some(
    (p) => p.timingRule === "exif-offset" || p.timingRule === "gps-inferred",
  );
  if (!hasGoodTiming) return "inferred";

  if (allPhotos.length >= MIN_PHOTOS_FOR_APPROXIMATE) return "approximate";
  return "inferred";
}

/**
 * Sample up to MAX_EVIDENCE_REFS photos from a BuiltPlace to use as stored
 * evidence refs. Prefers located photos (they have GPS) over unlocated ones.
 * Within each group, picks photos spread across the date range so evidence
 * isn't skewed to a single day.
 */
export function sampleEvidenceRefs(place: BuiltPlace): PhotoEvidenceRef[] {
  // Sort located photos by day to get spread coverage, then concat unlocated
  const located = [...place.photos].sort((a, b) => a.localDay.localeCompare(b.localDay));
  const unlocated = [...place.unlocatedPhotos].sort((a, b) => a.localDay.localeCompare(b.localDay));

  const pool = [...located, ...unlocated];
  const sample = pool.slice(0, MAX_EVIDENCE_REFS);

  return sample.map(
    (p): PhotoEvidenceRef => ({
      mediaId: p.mediaId,
      ...(p.uri ? { uri: p.uri } : {}),
      localDay: p.localDay,
      hasGps: p.latitude !== null && p.longitude !== null,
      timingRule: p.timingRule,
    }),
  );
}

/**
 * Returns the id of the first trip whose date range overlaps this place.
 * Used to propose a tripId link on the PlaceEvent.
 */
export function proposeTripId(place: BuiltPlace, trips: Trip[]): string | undefined {
  for (const trip of trips) {
    const tripStart = trip.start.slice(0, 10);
    const tripEnd = trip.end.slice(0, 10);
    // Overlap: place starts before trip ends AND place ends after trip starts
    if (place.dateStart <= tripEnd && place.dateEnd >= tripStart) {
      return trip.id;
    }
  }
  return undefined;
}

/**
 * Compute the deduplication key for a built place.
 * Format: `place|{localityKey}|{dateStart}`
 * Same city on the same starting day in the same locality → same dedupeKey.
 */
export function placeDedupeKey(place: BuiltPlace): string {
  return `place|${place.localityKey}|${place.dateStart}`;
}

// ─── Classify against existing entries ────────────────────────────────────────

type StageStatus = StagedRecord["status"];

function classify(
  entry: Entry,
  existing: Map<string, Entry>,
  seen: Set<string>,
): Pick<StagedRecord, "status" | "matchId"> {
  if (seen.has(entry.dedupeKey)) return { status: "batch-duplicate" };
  seen.add(entry.dedupeKey);
  const m = existing.get(entry.dedupeKey);
  if (!m) return { status: "new" };
  if (entry.tier < m.tier) return { status: "supersedes", matchId: m.id };
  if (entry.tier > m.tier) return { status: "superseded", matchId: m.id };
  return { status: "duplicate", matchId: m.id };
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * WP6: Map `BuiltPlace[]` to a `StagingBatch`.
 *
 * @param builtPlaces   WP5 output: places with photos grouped by locality run.
 * @param trips         Known trips for trip-link proposals.
 * @param existingEntries Map of dedupeKey → Entry from the current journal state.
 * @param batchId       Optional stable id for the batch (generated if omitted).
 * @returns             A StagingBatch ready for the commit or discard flow.
 */
export function mapToStagingBatch(
  builtPlaces: BuiltPlace[],
  trips: Trip[],
  existingEntries: Map<string, Entry>,
  batchId?: string,
): StagingBatch {
  const seen = new Set<string>();
  const records: StagedRecord[] = [];
  const now = new Date().toISOString();

  for (const place of builtPlaces) {
    const allPhotos = [...place.photos, ...place.unlocatedPhotos];
    const confidence = placeConfidence(place);
    const evidenceRefs = sampleEvidenceRefs(place);
    const dedupeKey = placeDedupeKey(place);
    const tripId = proposeTripId(place, trips);

    const entry: PlaceEvent = {
      id: uid(),
      kind: "place",
      source: EXIF_SOURCE_ID,
      tier: EXIF_TIER,
      start: place.dateStart,
      end: place.dateEnd,
      confidence,
      locality: place.locality,
      region: place.region,
      country: place.country,
      localityKey: place.localityKey,
      photoEvidence: evidenceRefs,
      photoCount: allPhotos.length,
      singlePhoto: allPhotos.length === 1 ? true : undefined,
      dedupeKey,
      createdAt: now,
      ...(tripId ? { tripId } : {}),
    };

    const { status, matchId } = classify(entry, existingEntries, seen);

    records.push({
      entry,
      warnings: [],
      status,
      matchId,
      selected: status === "new" || status === "supersedes",
    });
  }

  return {
    id: batchId ?? uid(),
    source: EXIF_SOURCE_ID,
    filename: "photo-library",
    createdAt: now,
    records,
    errors: [],
  };
}
