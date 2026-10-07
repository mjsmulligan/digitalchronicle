/**
 * Shared date-formatting helpers for the two-column journal layout.
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
export function parseDay(iso: string): ParsedDay {
  const d = new Date(iso + "T12:00:00");
  return {
    num:   d.getDate().toString(),
    day:   DAYS_SHORT[d.getDay()],
    month: MONTHS_SHORT[d.getMonth()],
    year:  d.getFullYear().toString(),
  };
}
