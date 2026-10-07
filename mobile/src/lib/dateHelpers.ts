/**
 * Shared date-formatting and sorting helpers for the journal layout.
 *
 * parseDay is used by DayGroup, TripRow (trips tab), EntryDayGroup and
 * SuggestionDayGroup (trip detail) to build the 52dp date column.
 */

export const MONTHS_SHORT = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

export const DAYS_SHORT = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

export interface ParsedDay {
  num: string;
  day: string;
  month: string;
  year: string;
}

/**
 * Parse an ISO date string (YYYY-MM-DD) into the four display fields used
 * by the two-column date column.  Noon is used to avoid DST edge-cases
 * shifting the date.
 */
/**
 * Stable sort key for an entry.
 *
 * Prefers `startUTC` when available — it's a true cross-timezone timestamp
 * and correctly orders legs that depart from different cities on the same day
 * (e.g. DUB→AMS then AMS→BER, where local times are in different zones).
 * Falls back to `start` (local wall-clock) for entries without UTC data.
 */
export function entrySortKey(e: { start: string; startUTC?: string }): string {
  return e.startUTC ?? e.start;
}

/**
 * Comparator for sorting entries chronologically within a trip or day group.
 *
 * Primary:   entrySortKey (UTC if available, local otherwise).
 * Tiebreaker for same-day legs: route continuity.
 *   If leg A's `to` matches leg B's `from` they are a connection — A flies
 *   first. This handles the common case where multi-leg itineraries are
 *   imported with date-only timestamps and no UTC data.
 */
export function compareEntriesChronological(
  a: { start: string; startUTC?: string; kind: string; from?: string; to?: string },
  b: { start: string; startUTC?: string; kind: string; from?: string; to?: string }
): number {
  const cmp = entrySortKey(a).localeCompare(entrySortKey(b));
  if (cmp !== 0) return cmp;

  // Same sort key — apply route-continuity tiebreaker for legs
  if (a.kind === "leg" && b.kind === "leg" && a.to && b.from && a.from && b.to) {
    if (a.to === b.from) return -1; // a connects into b → a first
    if (b.to === a.from) return 1;  // b connects into a → b first
  }

  return 0;
}

export function parseDay(iso: string): ParsedDay {
  const d = new Date(iso + "T12:00:00");
  return {
    num:   d.getDate().toString(),
    day:   DAYS_SHORT[d.getDay()],
    month: MONTHS_SHORT[d.getMonth()],
    year:  d.getFullYear().toString(),
  };
}
