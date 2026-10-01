import { timezoneFor } from "./geo";
import { localToUTC } from "./tz";

/**
 * Identifier for the import source that produced an entry.
 * "manual" is the only reserved value (highest-precedence sovereign edits).
 * All other values are connector ids registered in connectors/registry.ts.
 */
export type Source = string;
/** 1 = user manual (sovereign), 2 = primary transit/attendance records, 3 = secondary order/calendar records */
export type Tier = 1 | 2 | 3;
export type Mode = "air" | "rail" | "road";

/** How sure we are this fact is right, independent of Tier (which is precedence, not quality). */
export type Confidence = "confirmed" | "inferred" | "approximate";
export type Purpose = "work" | "family" | "leisure" | "other";

interface Base {
  id: string;
  source: Source;
  tier: Tier;
  /** Person IDs (from the people store) who were present at this entry.
   *  undefined / absent → the journal owner (isSelf person) is implicitly present.
   *  [] → self was explicitly removed; no participants. */
  participants?: string[];
  /** Local wall-clock time at the start place, "YYYY-MM-DDTHH:mm" (or date only) */
  start: string;
  /** Local wall-clock time at the end place */
  end?: string;
  /** IANA zone for `start`, e.g. "Europe/Dublin". Undefined if the place couldn't be resolved. */
  startTz?: string;
  /** IANA zone for `end` */
  endTz?: string;
  /** `start` converted to UTC (ISO 8601). Undefined whenever startTz is unknown or start has no time. */
  startUTC?: string;
  /** `end` converted to UTC (ISO 8601) */
  endUTC?: string;
  tripId?: string;
  dedupeKey: string;
  /** Free-text personal reflection on this entry. Stored in IndexedDB; never exported. */
  reflection?: string;
  /** @deprecated Legacy name for `reflection`; still written by existing UI and parsers. */
  journal?: string;
  /** Numeric rating 0–10 (one decimal). Blank means unrated. Original-scale value lives in `raw`. */
  rating?: number;
  /**
   * How precisely the date is known.
   * "day"     — full YYYY-MM-DD known (default assumed when omitted)
   * "month"   — only YYYY-MM known (e.g. Goodreads "read" month)
   * "year"    — only YYYY known
   * "unknown" — date is a best guess / cannot be determined
   */
  datePrecision?: "day" | "month" | "year" | "unknown";
  /** Tier 1 manual overrides layered on top of source data */
  overrides?: Record<string, string>;
  createdAt: string;
  /** How sure we are this fact (not just this record) is right. Not the same as Tier. */
  confidence: Confidence;
  purpose?: Purpose;
  /** Person ids or free-text names of who was there */
  companions?: string[];
  /** Parsed source record, including nested JSON fields, retained for later reprocessing. */
  raw?: Record<string, unknown>;
  /** Where this fact came from: filename and row/index within it. */
  sourceRef?: string;
}

export interface Leg extends Base {
  kind: "leg";
  mode: Mode;
  from: string;
  to: string;
  fromName?: string;
  toName?: string;
  flightNumber?: string;
  aircraft?: string;
  operator?: string;
  trainNumber?: string;
  seat?: string;
}

export interface Stay extends Base {
  kind: "stay";
  place: string;
  city?: string;
  notes?: string;
}

export type EventCategory = "concert" | "gathering" | "celebration" | "milestone" | "memory" | "activity";
export const CATEGORY_LABEL: Record<EventCategory, string> = {
  concert: "Concert", gathering: "Gathering", celebration: "Celebration",
  milestone: "Milestone", memory: "Memory", activity: "Activity",
};

export interface JEvent extends Base {
  kind: "event";
  category: EventCategory;
  /** Headline: artist for concerts, title for other moments */
  artist: string;
  people?: string[];
  venue: string;
  city: string;
  country?: string;
  tour?: string;
  setlist?: string[];
}

/**
 * A film watch event. The film metadata and the viewing record are the same
 * thing — there is no separate Film record. A rewatch is a separate Film entry
 * with a different dedupeKey (date differs).
 *
 * dedupeKey: `film|{normTitle}|{year}|{watchedDate}` — source-agnostic so that
 * Letterboxd (tier 2) supersedes Netflix (tier 3) for the same watch.
 */
export interface Film extends Base {
  kind: "film";
  title: string;
  /** Release year (not watch year) */
  year?: number;
  director?: string;
  /** True when the source explicitly flags this as a rewatch */
  rewatch?: boolean;
}

/**
 * A single episode watch event. Series grouping is handled by `seriesId` (pointing
 * at a Series container), mirroring the way tripId links entries to a Trip.
 *
 * dedupeKey: `episode|{normShowTitle}|{normSeason}|{normEpTitle}|{watchedDate}`
 */
export interface Episode extends Base {
  kind: "episode";
  showTitle: string;
  /** Raw season label, e.g. "Season 4", "Limited Series" */
  season?: string;
  episodeTitle?: string;
  episodeNumber?: number;
  /** Reference to a Series container */
  seriesId?: string;
}

/**
 * A series container — groups episodes (TV) or volumes (books) the same way
 * Trip groups legs/stays. Not an entry itself; never appears in the Entry union.
 */
export interface Series {
  id: string;
  kind: "series";
  title: string;
  /** "tv" for television shows; "book" for book series */
  mediaType?: "tv" | "book";
  createdAt: string;
}

/**
 * A book read event. `start` = Date Read (completion date — "when this happened").
 * An optional `dateStarted` can capture when reading began without overloading Base.end.
 *
 * dedupeKey: `book|{normTitle}|{normAuthor}|{dateRead}`
 */
export interface Book extends Base {
  kind: "book";
  /** Clean title — series suffix stripped, e.g. "Bridgerton" not "Bridgerton (Bridgertons, #1)" */
  title: string;
  author: string;
  /** Original Publication Year */
  year?: number;
  goodreadsId?: string;
  /** Parsed series name, e.g. "Bridgertons" */
  series?: string;
  /** Series position, e.g. 6 or 7.5 */
  seriesNumber?: number;
  /** Reference to a Series container */
  seriesId?: string;
  /** When reading started (YYYY-MM-DD). Separate from Base.start which is the completion date. */
  dateStarted?: string;
}

export type Entry = Leg | Stay | JEvent | Film | Episode | Book;

/**
 * A person who appears in journal entries.
 * Not a contact book — just enough to link entries to the same individual
 * and support a person-centric view. All data stays in IndexedDB.
 */
export interface Person {
  id: string;
  name: string;
  /** Alternative names / nicknames for matching (e.g. "Rob" for "Robert Smith"). */
  aliases?: string[];
  notes?: string;
  /** Marks the journal owner. Exactly one Person should have isSelf: true. */
  isSelf?: boolean;
  createdAt: string;
}

export interface Note {
  id: string;
  /** YYYY-MM-DD day note, or attached to a trip */
  date?: string;
  tripId?: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}

export interface Trip {
  id: string;
  title: string;
  start: string;
  end: string;
  notes: string;
  cover: string;
  createdAt: string;
  purpose?: Purpose;
}

export type StageStatus = "new" | "duplicate" | "supersedes" | "superseded" | "batch-duplicate";

export interface StagedRecord {
  entry: Entry;
  warnings: string[];
  status: StageStatus;
  matchId?: string;
  selected: boolean;
}

export interface StagingBatch {
  id: string;
  source: Source;
  filename: string;
  createdAt: string;
  records: StagedRecord[];
  errors: string[];
}

export interface JournalData {
  trips: Trip[];
  legs: Leg[];
  stays: Stay[];
  events: JEvent[];
  films: Film[];
  episodes: Episode[];
  books: Book[];
  series: Series[];
  notes: Note[];
  staging: StagingBatch[];
  people: Person[];
}

export const STORES = ["trips", "legs", "stays", "events", "films", "episodes", "books", "series", "notes", "staging", "people"] as const;
export type StoreName = (typeof STORES)[number];

/**
 * @deprecated Use sourceLabel(id) from connectors/registry.ts instead.
 * Kept temporarily for any code that hasn't been migrated yet.
 */
// SOURCE_LABEL removed — use sourceLabel() from connectors/registry.ts

export function view<T extends Entry>(e: T): T {
  if (!e.overrides) return e;
  const v = { ...e, ...e.overrides } as T;
  const keys = e.overrides;
  if (v.kind === "leg") {
    if ("start" in keys || "from" in keys) {
      v.startTz = timezoneFor(v.from);
      v.startUTC = localToUTC(v.start, v.startTz);
    }
    if ("end" in keys || "to" in keys) {
      v.endTz = timezoneFor(v.to);
      v.endUTC = v.end ? localToUTC(v.end, v.endTz) : undefined;
    }
  } else if ("city" in keys || "start" in keys || "end" in keys) {
    const tz = timezoneFor(v.city ?? "");
    v.startTz = tz;
    v.startUTC = localToUTC(v.start, tz);
    v.endTz = v.end ? tz : undefined;
    v.endUTC = v.end ? localToUTC(v.end, tz) : undefined;
  }
  return v;
}

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function day(s: string) {
  return s.slice(0, 10);
}

export function entryTitle(e: Entry): string {
  const v = view(e);
  if (v.kind === "leg") return `${v.from} → ${v.to}`;
  if (v.kind === "stay") return v.place;
  if (v.kind === "film") return v.year ? `${v.title} (${v.year})` : v.title;
  if (v.kind === "episode") return v.episodeTitle ? `${v.showTitle}: ${v.episodeTitle}` : v.showTitle;
  if (v.kind === "book") return v.author ? `${v.title} — ${v.author}` : v.title;
  return v.category === "concert" && v.venue ? `${v.artist} @ ${v.venue}` : v.artist;
}
