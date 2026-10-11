/**
 * WP14 — Staging significance hints (pure).
 *
 * Spec reference: docs/specs/Source spec_ Photo library (EXIF).md, §4 + check 8.
 *
 * Ordering rules (highest score first):
 *   1. Photo count relative to the place's own typical day
 *      (a day at home with 40 photos stands out against a norm of 3).
 *   2. Whether an existing calendar entry (JEvent) exists on that date.
 *   3. Absolute photo count.
 *
 * Routine days (below the place norm) are collapsed for bulk dismiss.
 * Single-photo days are never hidden, regardless of routine status.
 *
 * No network calls, no device APIs, no React Native imports.
 */

import type { PlaceEntry } from "../../types";
import type { JEvent } from "../../types";

// ─── Place norm ───────────────────────────────────────────────────────────────

/**
 * Compute the "typical" photo count for a place by averaging the photoCount
 * of all *accepted* entries for that place. Returns 1 when there are no
 * accepted entries (so the first suggestion is always treated as unusual).
 */
export function computePlaceNorm(entries: PlaceEntry[], placeId: string): number {
  const accepted = entries.filter((e) => e.placeId === placeId && e.status === "accepted");
  if (accepted.length === 0) return 1;
  const total = accepted.reduce((s, e) => s + e.photoCount, 0);
  return total / accepted.length;
}

// ─── Hint score ───────────────────────────────────────────────────────────────

/**
 * Score used to sort a single PlaceEntry relative to its place's norm.
 *
 * Higher = more unusual = surfaces first.
 *
 * Weights:
 *   - Relative ratio  (photoCount / norm): weight 10
 *   - Calendar entry on the date:          weight  5
 *   - Absolute photo count:                weight  1
 */
export function hintScore(
  entry: PlaceEntry,
  norm: number,
  hasCalendarEntry: boolean,
): number {
  const ratio = entry.photoCount / Math.max(norm, 1);
  return ratio * 10 + (hasCalendarEntry ? 5 : 0) + entry.photoCount;
}

// ─── Routine classification ───────────────────────────────────────────────────

/**
 * A day is "routine" when its photo count is below 1.5× the place norm.
 * Single-photo days are *never* routine — they must always remain visible.
 *
 * Routine days should be collapsed in the UI (shown, but in a collapsed group)
 * to allow bulk dismiss. They are never hidden entirely.
 */
export function isRoutine(entry: PlaceEntry, norm: number): boolean {
  if (entry.photoCount <= 1) return false; // single-photo days are never routine
  return entry.photoCount < norm * 1.5;
}

// ─── Calendar lookup helper ───────────────────────────────────────────────────

/**
 * Build a Set of all days that have at least one calendar entry (JEvent).
 * Comparing against this set is O(1) per entry during sort.
 */
export function buildCalendarDaySet(events: JEvent[]): Set<string> {
  return new Set(events.map((e) => e.start));
}

// ─── Sort ─────────────────────────────────────────────────────────────────────

/**
 * Sort a list of pending PlaceEntries by significance hints.
 *
 * Unusual days (high hintScore) appear first.
 * Routine days (isRoutine === true) appear last, sorted among themselves.
 * Single-photo days are never routine and therefore never pushed to the bottom.
 *
 * Returns a new array; the input is not mutated.
 *
 * @param entries        PlaceEntries to sort (typically the pending entries for one place).
 * @param allEntries     All PlaceEntries in the journal (used to compute the place norm).
 * @param calendarEvents All JEvent entries in the journal (used to detect calendar-day matches).
 */
export function sortEntriesByHints(
  entries: PlaceEntry[],
  allEntries: PlaceEntry[],
  calendarEvents: JEvent[],
): PlaceEntry[] {
  const calendarDays = buildCalendarDaySet(calendarEvents);

  // Compute per-place norms once
  const normCache = new Map<string, number>();
  const getNorm = (placeId: string): number => {
    if (!normCache.has(placeId)) {
      normCache.set(placeId, computePlaceNorm(allEntries, placeId));
    }
    return normCache.get(placeId)!;
  };

  const scored = entries.map((e) => {
    const norm = getNorm(e.placeId);
    const routine = isRoutine(e, norm);
    const score = hintScore(e, norm, calendarDays.has(e.localDay));
    return { entry: e, score, routine };
  });

  // Sort: non-routine first (by score desc), then routine (by score desc)
  return scored
    .sort((a, b) => {
      if (a.routine !== b.routine) return a.routine ? 1 : -1; // non-routine first
      return b.score - a.score; // higher score first within each group
    })
    .map((s) => s.entry);
}

// ─── Partition helper ─────────────────────────────────────────────────────────

/**
 * Split a sorted list of entries into unusual (top section) and routine
 * (collapsed section). Returns both arrays in display order.
 *
 * The unusual section is always shown expanded.
 * The routine section should be rendered collapsed with a "Show N routine days"
 * toggle in the UI.
 */
export function partitionByRoutine(
  sortedEntries: PlaceEntry[],
  allEntries: PlaceEntry[],
): { unusual: PlaceEntry[]; routine: PlaceEntry[] } {
  const normCache = new Map<string, number>();
  const getNorm = (placeId: string): number => {
    if (!normCache.has(placeId)) {
      normCache.set(placeId, computePlaceNorm(allEntries, placeId));
    }
    return normCache.get(placeId)!;
  };

  const unusual: PlaceEntry[] = [];
  const routine: PlaceEntry[] = [];

  for (const e of sortedEntries) {
    if (isRoutine(e, getNorm(e.placeId))) {
      routine.push(e);
    } else {
      unusual.push(e);
    }
  }

  return { unusual, routine };
}
