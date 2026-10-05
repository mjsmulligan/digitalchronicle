/**
 * WP5 — Place builder (pure).
 *
 * @deprecated WP12 replaces this with entryBuilder.ts (buildPlaceEntries).
 *   The run-based date-range model is replaced by a one-entry-per-day model.
 *   This file is kept for the WP6 staging mapper tests until WP13 removes them.
 *   New code should import from entryBuilder.ts instead.
 *
 * Spec reference: docs/specs/Source spec_ Photo library (EXIF).md, section 9 (draft 4).
 *
 * Inputs:
 *   - LocatedPhotoRecord[]   — photos with a resolved local day AND locality key
 *   - UnlocatedPhotoRecord[] — photos with a local day but NO locality (no GPS / resolution failed)
 *   - Trip[]                 — known trips (for boundary splitting and trip link proposals)
 *   - Leg[]                  — known trip legs (photos taken during a leg are excluded)
 *
 * Outputs:
 *   - BuiltPlace[]           — places with date ranges, photo evidence, and stable identity
 *
 * No network calls, no device APIs, no React Native imports in this file.
 */

import type { LocalityKey } from "../../types";
import type { Leg, Trip } from "../../types";
import type { TimedPhotoRecord, LocatedPhotoRecord, UnlocatedPhotoRecord, BuiltPlace } from "./types";

// ─── Open questions from spec ──────────────────────────────────────────────────

/**
 * Spec §9.4: "A long gap in days also ends a run, so two separate visits to the
 * same city are not merged. This is a fixed internal value, not a user setting.
 * Open: the value."
 *
 * 30 days is used as a reasonable default — overseas trips rarely exceed this.
 * To be confirmed once tested on real data.
 */
export const DEFAULT_MAX_GAP_DAYS = 30;

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

/**
 * Find the trip that contains a given YYYY-MM-DD day (or null if none does).
 * Used to determine if two adjacent days in a run cross a trip boundary.
 */
function tripIdForDay(day: string, trips: Trip[]): string | null {
  for (const trip of trips) {
    if (day >= trip.start.slice(0, 10) && day <= trip.end.slice(0, 10)) return trip.id;
  }
  return null;
}

/**
 * Split an already-sorted array of unique YYYY-MM-DD days into groups where
 * no adjacent pair is more than maxGapDays apart.
 */
function splitByGap(days: string[], maxGapDays: number): string[][] {
  if (!days.length) return [];
  const groups: string[][] = [[days[0]]];
  for (let i = 1; i < days.length; i++) {
    if (daysDiff(days[i - 1], days[i]) > maxGapDays) {
      groups.push([days[i]]);
    } else {
      groups[groups.length - 1].push(days[i]);
    }
  }
  return groups;
}

/**
 * Further split a group of adjacent days at trip boundaries.
 *
 * A boundary occurs when consecutive days belong to different trips
 * (or one is inside a trip and the next is standalone — trip id changes).
 */
function splitAtTripBoundaries(days: string[], trips: Trip[]): string[][] {
  if (!days.length) return [];
  const groups: string[][] = [[days[0]]];
  for (let i = 1; i < days.length; i++) {
    if (tripIdForDay(days[i - 1], trips) !== tripIdForDay(days[i], trips)) {
      groups.push([days[i]]);
    } else {
      groups[groups.length - 1].push(days[i]);
    }
  }
  return groups;
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * WP5: Build city-level place objects from resolved photo records.
 *
 * @param locatedPhotos   Photos that have been resolved to a locality (WP4 output).
 * @param unlocatedPhotos Photos with no GPS or failed resolution — attach by day only.
 * @param trips           Known trips for trip-boundary splitting and trip link proposals.
 * @param legs            Known legs; photos taken during a leg are excluded.
 * @param maxGapDays      Maximum day gap before starting a new run. Default 30.
 * @returns               Array of BuiltPlace ready for WP6 staging mapper.
 */
export function buildPlaces(
  locatedPhotos: LocatedPhotoRecord[],
  unlocatedPhotos: UnlocatedPhotoRecord[],
  trips: Trip[],
  legs: Leg[],
  maxGapDays = DEFAULT_MAX_GAP_DAYS,
): BuiltPlace[] {
  // Step 1: exclude photos taken during a known leg
  const activeLocated = locatedPhotos.filter((p) => !isDuringLeg(p, legs));
  const activeUnlocated = unlocatedPhotos.filter((p) => !isDuringLeg(p, legs));

  // Step 2: group remaining located photos by locality key
  const byLocality = new Map<LocalityKey, LocatedPhotoRecord[]>();
  for (const photo of activeLocated) {
    const key = photo.locality.key;
    const existing = byLocality.get(key);
    if (existing) {
      existing.push(photo);
    } else {
      byLocality.set(key, [photo]);
    }
  }

  const places: BuiltPlace[] = [];

  // Steps 3–6: for each locality, build runs
  for (const [localityKey, photos] of byLocality) {
    // Collect and sort unique days (spec §9: "consecutive days with the same locality key")
    const daySet = new Set(photos.map((p) => p.localDay));
    const sortedDays = [...daySet].sort();

    // Split by gap first (spec §9.4)
    const gapGroups = splitByGap(sortedDays, maxGapDays);

    for (const gapGroup of gapGroups) {
      // Split at trip boundaries (spec §9.3)
      const tripGroups = splitAtTripBoundaries(gapGroup, trips);

      for (const dayGroup of tripGroups) {
        const groupDaySet = new Set(dayGroup);
        const groupPhotos = photos.filter((p) => groupDaySet.has(p.localDay));
        const { name, region, country } = groupPhotos[0].locality;

        places.push({
          localityKey,
          locality: name,
          region,
          country,
          dateStart: dayGroup[0],
          dateEnd: dayGroup[dayGroup.length - 1],
          photos: groupPhotos,
          unlocatedPhotos: [],
        });
      }
    }
  }

  // Step 8: attach unlocated photos to places covering their day (spec §7)
  // "attach as evidence to a place whose date range covers its local day"
  for (const photo of activeUnlocated) {
    for (const place of places) {
      if (photo.localDay >= place.dateStart && photo.localDay <= place.dateEnd) {
        place.unlocatedPhotos.push(photo);
        break; // attach to the first (earliest-start) covering place only
      }
    }
  }

  return places;
}
