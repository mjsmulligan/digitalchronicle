/**
 * Small helpers shared by build.ts and blocks.ts. Kept apart so those two files
 * do not import each other.
 */
import { view, type Entry } from "../types";

/** Local calendar day of an entry, after user overrides. */
export function entryDay(e: Entry): string {
  return view(e).start.slice(0, 10);
}

// Display names for the colophon ("Compiled by Chronicle from: ...").
// Unlisted connector ids fall back to the id itself. "manual" is not a source.
const SOURCE_NAMES: Record<string, string> = {
  icalendar: "Calendar",
  viaduct: "viaduct.world",
  setlistfm: "setlist.fm",
  goodreads: "Goodreads",
  letterboxd: "Letterboxd",
  netflix: "Netflix",
  "photo-library": "Photo library",
  generic: "CSV import",
};

export function sourceDisplayName(id: string): string {
  return SOURCE_NAMES[id] ?? id;
}
