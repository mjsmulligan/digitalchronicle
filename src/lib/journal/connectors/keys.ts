/**
 * Deduplication keys: the one place they are built.
 *
 * Every key is source-agnostic, so the same thing arriving from two different
 * connectors (a setlist.fm import and a generic CSV both recording the same
 * concert, or Letterboxd and Netflix both recording the same watch) gets the
 * same key. Connectors, the kind registry, the add-entry dialog and the mobile
 * editor all call these functions. Nothing else may build a dedupeKey.
 *
 * Format (every text part goes through normaliseText, dates are the local day):
 *   leg:         leg|<date>|<FROM>|<TO>            (from and to upper-cased)
 *   stay:        stay|<date>|<place>
 *   event:       event|<date>|<artist>
 *   film:        film|<title>|<date>               (no year: not every source has one)
 *   episode:     episode|<show>|<season>|<episode title>|<date>
 *   book:        book|<title>|<author>|<date>
 *   place-entry: place-entry|<localityKey>|<localDay>
 *
 * Changing a key format changes what already-stored entries match, so do it
 * only with a plan for stored data (the app is not live yet, see the merge spec).
 */
import type { Book, Entry, Episode, Film, JEvent, Leg, PlaceEntry, Stay } from "../types";

/** Letters that Unicode decomposition does not split into base letter + accent. */
const FOLD: Record<string, string> = { ß: "ss", ø: "o", æ: "ae", œ: "oe", ł: "l", đ: "d" };

/**
 * The single text normaliser for keys. Two strings that a person would call the
 * same name give the same result: case, accents, punctuation, "&" versus "and",
 * and spacing do not matter. "Hôtel Le Marianne" and "Hotel le Marianne" match;
 * "Spider-Man" and "Spider Man" match; "Don't" and "Dont" match. Accents are
 * removed from Latin letters only, so Cyrillic and other scripts are left intact.
 *
 * Returns lower-case words joined by single hyphens, or "" for empty input.
 */
export function normaliseText(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFKD")
    // Accents come off Latin letters only; other scripts keep theirs ("й", "ї" stay as written).
    .replace(/(\p{Script=Latin})\p{M}+/gu, "$1")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[ßøæœłđ]/g, (c) => FOLD[c])
    .replace(/&/g, " and ")
    .replace(/[-_/\\]+/g, " ")
    .replace(/[^\p{L}\p{M}\p{N}\s]+/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

/** The local day of a start value ("2026-03-01" or "2026-03-01T09:00"). */
const day = (start: string) => start.slice(0, 10);

/** Station and airport parts: normalised, then upper-cased (codes read better that way). */
const code = (s: string | undefined) => normaliseText(s).toUpperCase();

export function legKey(l: Pick<Leg, "start" | "from" | "to">) {
  return `leg|${day(l.start)}|${code(l.from)}|${code(l.to)}`;
}

export function stayKey(s: Pick<Stay, "start" | "place">) {
  return `stay|${day(s.start)}|${normaliseText(s.place)}`;
}

export function eventKey(e: Pick<JEvent, "start" | "artist">) {
  return `event|${day(e.start)}|${normaliseText(e.artist)}`;
}

export function filmKey(f: Pick<Film, "start" | "title">) {
  return `film|${normaliseText(f.title)}|${day(f.start)}`;
}

export function episodeKey(e: Pick<Episode, "start" | "showTitle" | "season" | "episodeTitle">) {
  return `episode|${normaliseText(e.showTitle)}|${normaliseText(e.season)}|${normaliseText(e.episodeTitle)}|${day(e.start)}`;
}

export function bookKey(b: Pick<Book, "start" | "title" | "author">) {
  return `book|${normaliseText(b.title)}|${normaliseText(b.author)}|${day(b.start)}`;
}

/** `localityKey` is already normalised by the photo pipeline, so it is used as given. */
export function placeEntryKey(p: Pick<PlaceEntry, "localityKey" | "localDay">) {
  return `place-entry|${p.localityKey}|${p.localDay}`;
}

/**
 * The key for any entry, from its source fields (never from `overrides`, so a
 * user's correction does not change what a re-import matches).
 */
export function entryKey(e: Entry): string {
  switch (e.kind) {
    case "leg": return legKey(e);
    case "stay": return stayKey(e);
    case "event": return eventKey(e);
    case "film": return filmKey(e);
    case "episode": return episodeKey(e);
    case "book": return bookKey(e);
    case "place-entry": return placeEntryKey(e);
    default: return (e as Entry).dedupeKey;
  }
}
