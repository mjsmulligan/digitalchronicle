/**
 * Near-match detection (docs/specs/merge-dedup.md, section 4.6).
 *
 * Exact dedupe keys miss the same thing recorded slightly differently by two sources
 * (a flight with no airport codes, a hotel under two names, a film logged a day apart).
 * findNearMatches finds such candidates among the entries the user can see. It never
 * merges anything: import writes the new entry as usual, linked to the best candidate
 * through `possibleDuplicateOf` with a short note, and the user decides.
 *
 * Only entries of the same kind are compared, and place entries never (exact only).
 * A pair the user marked "not a duplicate" (`notDuplicateOf`, either way round) is skipped.
 */
import { normaliseText } from "./connectors/keys";
import { entryTitle, view, type Entry, type Episode, type Book, type Film, type JEvent, type Leg, type Stay } from "./types";

export interface NearMatch {
  /** The existing entry. */
  id: string;
  /** Plain-language reason, for notes and the review screen. */
  reason: string;
  /** Higher is more likely a real duplicate. */
  score: number;
}

/** Visible entries by every local day they cover (stays cover each night). */
export type NearIndex = Map<string, Entry[]>;

/** Start of the note written on an entry that has a possible duplicate. */
export const DUPLICATE_NOTE_PREFIX = "Possible duplicate of";

export const possibleDuplicateNote = (match: Entry) => `${DUPLICATE_NOTE_PREFIX} "${entryTitle(match)}"`;

/** Drops the possible-duplicate link (to `otherId`, or any) and its note from an entry. */
export function clearDuplicateFlag<T extends Entry>(e: T, otherId?: string): T {
  if (e.possibleDuplicateOf === undefined || (otherId !== undefined && e.possibleDuplicateOf !== otherId)) return e;
  const { possibleDuplicateOf: _p, importNotes, ...rest } = e;
  const notes = (importNotes ?? []).filter((n) => !n.startsWith(DUPLICATE_NOTE_PREFIX));
  return { ...rest, ...(notes.length ? { importNotes: notes } : {}) } as T;
}

// ─── Days ────────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
/** A stay is indexed under at most this many nights, so a typo'd end date cannot flood the index. */
const MAX_STAY_NIGHTS = 60;
const DAY_RE = /^\d{4}-\d{2}-\d{2}/;

const dayOf = (iso: string) => iso.slice(0, 10);
const dayNum = (day: string) => Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) / DAY_MS;
const dayStr = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);
const hasDay = (e: Entry) => DAY_RE.test(e.start);

/** Nights a stay covers: check-in day up to, not including, the check-out day. */
function stayDays(e: Entry): string[] {
  const start = dayOf(e.start);
  const end = e.end && DAY_RE.test(e.end) ? dayOf(e.end) : undefined;
  const nights = end ? Math.min(Math.max(dayNum(end) - dayNum(start), 1), MAX_STAY_NIGHTS) : 1;
  return Array.from({ length: nights }, (_, i) => dayStr(dayNum(start) + i));
}

const coveredDays = (e: Entry) => (e.kind === "stay" ? stayDays(e) : [dayOf(e.start)]);

/** Entries that may be a near match, by day. Hidden entries and place entries are left out. */
export function buildNearIndex(entries: Iterable<Entry>): NearIndex {
  const index: NearIndex = new Map();
  for (const e of entries) {
    if (e.hidden || e.kind === "place-entry" || !hasDay(e)) continue;
    for (const d of coveredDays(e)) {
      const bucket = index.get(d);
      if (bucket) bucket.push(e);
      else index.set(d, [e]);
    }
  }
  return index;
}

// ─── Text ────────────────────────────────────────────────────────────────────

/** Words that say what kind of place it is, not which one. */
const GENERIC_WORDS = new Set([
  "hotel", "hostel", "inn", "motel", "apartment", "apartments", "apt", "bnb", "airbnb", "guesthouse", "lodge",
  "resort", "suites", "suite", "the", "and", "le", "la", "les", "el", "los", "las", "der", "die", "das", "de",
  "du", "des", "del", "di", "by", "at", "of", "in", "on",
]);

const tokens = (s: string | undefined) => normaliseText(s).split("-").filter(Boolean);
const significant = (s: string | undefined) => tokens(s).filter((t) => t.length >= 3 && !GENERIC_WORDS.has(t));
const same = (a: string | undefined, b: string | undefined) => {
  const x = normaliseText(a);
  return x !== "" && x === normaliseText(b);
};

/** Every word of the shorter title appears in the longer one, and it is not trivially short. */
function titleContains(a: string | undefined, b: string | undefined): boolean {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length || !tb.length) return false;
  const [small, large] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (small.join("").length < 4) return false;
  return small.every((t) => large.includes(t));
}

// ─── Per kind ────────────────────────────────────────────────────────────────

type Hit = { reason: string; score: number } | null;

function legHit(a: Leg, b: Leg): Hit {
  if (a.mode !== b.mode) return null;
  const numberOf = (l: Leg) => normaliseText(l.flightNumber || l.trainNumber);
  const na = numberOf(a);
  const nb = numberOf(b);
  if (na && nb && na !== nb) return null; // two different services are two legs
  if (na && na === nb) return { reason: "same service number", score: 3 };
  if (same(a.from, b.from) && same(a.to, b.to)) return { reason: "same route", score: 3 };
  if (!a.from || !a.to || !b.from || !b.to) return { reason: "route not known on one side", score: 1 };
  return null;
}

function stayHit(a: Stay, b: Stay): Hit {
  // Dates overlap by at least one night (the check-out day is free for the next guest).
  const nights = new Set(stayDays(a));
  if (!stayDays(b).some((d) => nights.has(d))) return null;
  const ta = significant(a.place);
  const tb = new Set(significant(b.place));
  const shared = ta.filter((t) => tb.has(t)).length;
  if (shared > 0 && shared / Math.min(ta.length, tb.size) >= 0.5) return { reason: "overlapping dates, similar name", score: 3 };
  if (same(a.city, b.city)) return { reason: "overlapping dates, same city", score: 2 };
  return null;
}

function eventHit(a: JEvent, b: JEvent): Hit {
  if (titleContains(a.artist, b.artist)) return { reason: "same day, similar title", score: 3 };
  if (same(a.venue, b.venue)) return { reason: "same day, same venue", score: 1 };
  return null;
}

/** Same title, and the same year when both have one. */
const titleHit = (a: { title: string; year?: number }, b: { title: string; year?: number }): Hit =>
  same(a.title, b.title) && (a.year === undefined || b.year === undefined || a.year === b.year)
    ? { reason: "same title", score: 3 }
    : null;

function episodeHit(a: Episode, b: Episode): Hit {
  if (!same(a.showTitle, b.showTitle)) return null;
  if (a.episodeTitle && b.episodeTitle && !same(a.episodeTitle, b.episodeTitle)) return null;
  if (a.season && b.season && !same(a.season, b.season)) return null;
  return { reason: "same episode", score: 3 };
}

function hitFor(a: Entry, b: Entry): Hit {
  // Compare what the user sees, so a field they corrected counts.
  const va = view(a);
  const vb = view(b);
  switch (va.kind) {
    case "leg": return legHit(va, vb as Leg);
    case "stay": return stayHit(va, vb as Stay);
    case "event": return eventHit(va, vb as JEvent);
    case "film": return titleHit(va as Film, vb as Film);
    case "book": return titleHit(va as Book, vb as Book);
    case "episode": return episodeHit(va, vb as Episode);
    default: return null;
  }
}

/** Days to look at: the entry's own, and one either side where a self-reported date can drift. */
function searchDays(e: Entry): string[] {
  if (e.kind === "stay") return stayDays(e);
  const d = dayOf(e.start);
  if (e.kind === "film" || e.kind === "episode" || e.kind === "book") {
    const n = dayNum(d);
    return [dayStr(n - 1), d, dayStr(n + 1)];
  }
  return [d];
}

/**
 * Likely duplicates of `entry` among the indexed entries, best first. Exact key matches
 * are not this function's job (classify handles them before it is asked).
 */
export function findNearMatches(entry: Entry, index: NearIndex): NearMatch[] {
  if (entry.kind === "place-entry" || !hasDay(entry)) return [];
  const here = dayNum(dayOf(entry.start));
  const out = new Map<string, NearMatch & { distance: number }>();
  for (const d of searchDays(entry)) {
    for (const other of index.get(d) ?? []) {
      if (other.id === entry.id || other.kind !== entry.kind || out.has(other.id)) continue;
      if (entry.notDuplicateOf?.includes(other.id) || other.notDuplicateOf?.includes(entry.id)) continue;
      const hit = hitFor(entry, other);
      if (hit) out.set(other.id, { id: other.id, ...hit, distance: Math.abs(dayNum(dayOf(other.start)) - here) });
    }
  }
  return [...out.values()]
    .sort((x, y) => y.score - x.score || x.distance - y.distance || x.id.localeCompare(y.id))
    .map(({ id, reason, score }) => ({ id, reason, score }));
}
