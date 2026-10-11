/**
 * WP12 — Entry builder (pure).
 *
 * Spec reference: docs/specs/Source spec_ Photo library (EXIF).md, draft 7 §10.
 *
 * Produces one BuiltPlaceEntry per (localityKey × localDay) pair from a set of
 * resolved photo records. This replaces the WP5 "run builder" (placeBuilder.ts)
 * which built date-range BuiltPlace objects.
 *
 * Differences from WP5:
 *   - One entry per day, not one entry per visit date range.
 *   - No gap splitting (DEFAULT_MAX_GAP_DAYS removed — irrelevant for per-day model).
 *   - No trip-boundary splitting (trips don't affect individual days).
 *   - Same-day photos in two different localities produce two separate entries (spec §10).
 *   - Unlocated photos attach only when exactly one place exists for that day (spec §7).
 *
 * No network calls, no device APIs, no React Native imports in this file.
 */

import type { Leg } from "../../types";
import type {
  TimedPhotoRecord,
  LocatedPhotoRecord,
  UnlocatedPhotoRecord,
  BuiltPlaceEntry,
} from "./types";

// ─── Re-exported helpers (previously in placeBuilder.ts) ────────────────────

/**
 * Calendar-day difference between two YYYY-MM-DD strings.
 * Treats both as UTC midnight so timezone does not affect the result.
 */
export function daysDiff(a: string, b: string): number {
  const aMs = Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10));
  const bMs = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10));
  return Math.round(Math.abs(bMs - aMs) / 86_400_000);
}

/**
 * Returns true if a photo was taken during the window of a known leg.
 *
 * Spec §7: "Photos taken during a known leg (a flight or train journey) are
 * excluded from place building, since the leg already covers that time."
 *
 * If the leg has resolved UTC timestamps, those are used for precise comparison.
 * Otherwise the photo's localDay is compared against the leg's start/end dates.
 */
export function isDuringLeg(photo: TimedPhotoRecord, legs: Leg[]): boolean {
  for (const leg of legs) {
    if (leg.startUTC && leg.endUTC && photo.captureTimestamp !== null) {
      const tsMs = photo.captureTimestamp * 1000;
      const s = new Date(leg.startUTC).getTime();
      const e = new Date(leg.endUTC).getTime();
      if (tsMs >= s && tsMs <= e) return true;
    } else {
      // Fallback: day-level comparison when no UTC times or no precise timestamp
      const legStart = leg.start.slice(0, 10);
      const legEnd = (leg.end ?? leg.start).slice(0, 10);
      if (photo.localDay >= legStart && photo.localDay <= legEnd) return true;
    }
  }
  return false;
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * WP12: Build one-per-day place entry objects from resolved photo records.
 *
 * Algorithm:
 *   1. Exclude photos taken during a known leg (spec §7).
 *   2. Group remaining located photos by (localityKey + localDay).
 *   3. Each group → one BuiltPlaceEntry.
 *   4. Count how many entries exist per day across all localities.
 *   5. Attach unlocated photos to the day's entry only when exactly one place
 *      resolved that day (spec §7: "ambiguous — no single best place to attach to").
 *
 * Same-day photos in two different localities produce two separate BuiltPlaceEntries
 * (acceptance check 10). Each is independently staged, with no conflict flag.
 *
 * @param locatedPhotos   Photos resolved to a locality (WP4 output).
 * @param unlocatedPhotos Photos with no GPS or failed resolution.
 * @param legs            Known legs; photos taken during a leg are excluded.
 * @returns               Array of BuiltPlaceEntry, one per (locality × day) pair.
 */
export function buildPlaceEntries(
  locatedPhotos: LocatedPhotoRecord[],
  unlocatedPhotos: UnlocatedPhotoRecord[],
  legs: Leg[],
): BuiltPlaceEntry[] {
  // Step 1: exclude photos taken during a known leg
  const activeLocated   = locatedPhotos.filter(   (p) => !isDuringLeg(p, legs));
  const activeUnlocated = unlocatedPhotos.filter( (p) => !isDuringLeg(p, legs));

  // Step 2: group located photos by (localityKey|localDay)
  const byGroup = new Map<string, BuiltPlaceEntry>();

  for (const photo of activeLocated) {
    const groupKey = `${photo.locality.key}|${photo.localDay}`;
    const existing = byGroup.get(groupKey);
    if (existing) {
      existing.photos.push(photo);
    } else {
      byGroup.set(groupKey, {
        localityKey:    photo.locality.key,
        locality:       photo.locality.name,
        region:         photo.locality.region,
        country:        photo.locality.country,
        level:          photo.locality.level,
        localDay:       photo.localDay,
        photos:         [photo],
        unlocatedPhotos: [],
      });
    }
  }

  const entries = [...byGroup.values()];

  // Step 4: count distinct localities per day (for unlocated attachment logic)
  const localitiesPerDay = new Map<string, number>();
  for (const entry of entries) {
    localitiesPerDay.set(entry.localDay, (localitiesPerDay.get(entry.localDay) ?? 0) + 1);
  }

  // Step 5: attach unlocated photos — only when exactly one locality for that day
  for (const photo of activeUnlocated) {
    const count = localitiesPerDay.get(photo.localDay) ?? 0;
    if (count !== 1) continue; // 0 → no located place; >1 → ambiguous

    // Find the single entry for this day
    const target = entries.find((e) => e.localDay === photo.localDay);
    if (target) target.unlocatedPhotos.push(photo);
  }

  return entries;
}
