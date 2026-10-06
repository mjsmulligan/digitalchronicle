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

export type Purpose = "work" | "family" | "leisure" | "other";

// Per-kind override shapes — defined before Base to avoid circular references.
// Fields mirror the corresponding kind interfaces; kept in sync manually.
export type LegOverrides = Partial<{
  start: string; end: string; from: string; to: string;
  fromName: string; toName: string; mode: string;
  flightNumber: string; trainNumber: string; operator: string; seat: string;
}>;
export type StayOverrides    = Partial<{ start: string; end: string; place: string; city: string; notes: string }>;
export type EventOverrides   = Partial<{ start: string; end: string; artist: string; venue: string; city: string; country: string; category: string; tour: string }>;
export type FilmOverrides    = Partial<{ start: string; title: string; year: number; director: string }>;
export type EpisodeOverrides = Partial<{ start: string; showTitle: string; season: string; episodeTitle: string; episodeNumber: number }>;
export type BookOverrides    = Partial<{ start: string; title: string; author: string; year: number; dateStarted: string }>;

export type AnyOverrides = LegOverrides | StayOverrides | EventOverrides | FilmOverrides | EpisodeOverrides | BookOverrides;

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
  /** User's own prose reflection. Never overwritten by connectors or supersede. */
  reflection?: string;
  /**
   * Source-supplied review text (e.g. a Letterboxd review, Goodreads review,
   * or calendar description). Written only by connectors. Read-only in the UI.
   * See evaluation.ts — D8.
   */
  review?: string;
  /** Universal quantitative field: rating 0–10 (one decimal). Blank means unrated. Original-scale value lives in `raw`. */
  rating?: number;
  /**
   * Tracks rating provenance — whether the rating came from an external source.
   * See `isLocked()` in evaluation.ts.
   */
  sourceLocked?: ("rating")[];
  /**
   * How precisely the date is known.
   * "day"     — full YYYY-MM-DD known (default assumed when omitted)
   * "month"   — only YYYY-MM known (e.g. Goodreads "read" month)
   * "year"    — only YYYY known
   * "unknown" — date is a best guess / cannot be determined
   */
  datePrecision?: "day" | "month" | "year" | "unknown";
  /** Tier 1 manual overrides layered on top of source data */
  overrides?: AnyOverrides;
  createdAt: string;
  purpose?: Purpose;
  /** Person ids or free-text names of who was there */
  companions?: string[];
  /** Parsed source record, including nested JSON fields, retained for later reprocessing. */
  raw?: Record<string, unknown>;
  /** Where this fact came from: filename and row/index within it. */
  sourceRef?: string;
  /** Extra sources absorbed when two entries were merged. */
  additionalSources?: Array<{ source: string; sourceRef?: string }>;
  /**
   * Soft-delete flag. When `true` the entry is excluded from all normal views
   * and helpers (allEntries, feeds, trip linking, etc.) but remains in the
   * database so it can be restored from Settings → Hidden Entries.
   * Absent (undefined) means visible — the field is never set to `false`.
   */
  hidden?: true;
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
  /** Container-level rating 0–10. Separate from individual episode/book ratings. */
  rating?: number;
  /** Container-level reflection prose. */
  reflection?: string;
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

/**
 * A stable string key that uniquely identifies a locality (city / town) as
 * returned by the device geocoder. Treated as opaque — the format is defined
 * by the LocalityResolver implementation in the EXIF source (WP4).
 */
export type LocalityKey = string;

/**
 * A reference back to a single photo that contributed evidence to a PlaceEvent.
 * The photo itself is never stored — only the minimal reference needed to re-link
 * the journal entry to the original asset.
 */
export interface PhotoEvidenceRef {
  /** Platform media asset id (e.g. Android content URI id or iOS localIdentifier) */
  mediaId: string;
  /** Platform-specific URI for opening the asset (content:// or ph://) */
  uri?: string;
  /** YYYY-MM-DD local day assigned to this photo (see WP3 time resolution) */
  localDay: string;
  /** Whether a GPS coordinate was present and used for locality resolution */
  hasGps: boolean;
  /** Which time-resolution rule was applied (see spec section 6) */
  timingRule: "exif-offset" | "gps-inferred" | "fallback";
  /** Set true when the photo has been deleted from the library after scanning */
  missing?: boolean;
}

/**
 * @deprecated Superseded by PlaceEntry (WP10). Kept only to avoid breaking
 * the existing scan pipeline until WP12/WP13 replace it. Do not use in new code.
 *
 * A city-level place event derived from evidence (photos, calendar, receipts, …).
 * Represents presence in a city over a date range (ranges removed in WP10 spec).
 */
export interface PlaceEvent extends Base {
  kind: "place";
  /** Human-readable city / town name (e.g. "London") */
  locality: string;
  region?: string;
  country?: string;
  localityKey: LocalityKey;
  photoEvidence: PhotoEvidenceRef[];
  photoCount: number;
  singlePhoto?: boolean;
}

// ─── WP10: Place container and one-day entry ──────────────────────────────────

/**
 * User-decision state for a PlaceEntry.
 *   pending   — arrived from a scan, waiting for the user to accept or dismiss.
 *   accepted  — the user confirmed this day at this place.
 *   dismissed — the user rejected it; lives in the bin until the bin is emptied,
 *               then a PlaceBinMarker is kept so re-scan still skips it.
 */
export type PlaceStatus = "pending" | "accepted" | "dismissed";

/**
 * A locality place container. Like Trip or Series, this is not an Entry — it is
 * a grouping record that holds PlaceEntry children.
 *
 * Places are created when the first PlaceEntry for a locality is confirmed.
 * A place knows its geographic parents (region, country) so the Staging Hub
 * can browse the full hierarchy.
 *
 * dedupeKey is not used here; uniqueness is by localityKey (+ aliasKeys).
 */
export interface Place {
  id: string;
  kind: "place";
  /** Normalised locality key from the geocoder (e.g. "ie:dublin") */
  localityKey: LocalityKey;
  /**
   * Keys of places that have been merged into this one (spelling variants).
   * Re-scan maps photos matching any alias key to this place.
   */
  aliasKeys?: LocalityKey[];
  /** Human-readable city / town name (e.g. "Dublin") */
  locality: string;
  region?: string;
  country?: string;
  /**
   * Id of the parent Place (the region-level or country-level container).
   * Undefined for top-level country places.
   */
  parentId?: string;
  createdAt: string;
}

/**
 * A single-day place fact: this locality, this calendar day, this evidence.
 *
 * A two-day stay in London is one Place with two PlaceEntries.
 * A weekend in London plus a day trip two weeks later is one Place with three entries.
 * There are no date ranges; visits (consecutive entries) are derived for display.
 *
 * Base.start = localDay (YYYY-MM-DD). Base.end is not used.
 *
 * dedupeKey: `place-entry|{localityKey}|{localDay}` — same place, same day = same entry.
 */
export interface PlaceEntry extends Base {
  kind: "place-entry";
  /** Id of the Place container this entry belongs to */
  placeId: string;
  /**
   * Locality key (denormalised from the Place container for quick lookup
   * without a join, e.g. in deduplication).
   */
  localityKey: LocalityKey;
  /**
   * The local calendar day this entry covers. Same value as Base.start —
   * kept as an explicit field so callers don't need to know the Base convention.
   */
  localDay: string; // YYYY-MM-DD
  /** Photo evidence sampled from this day (up to 10 refs) */
  photoEvidence: PhotoEvidenceRef[];
  /** Total number of photos that produced this entry (before the 10-ref sample) */
  photoCount: number;
  /** True when this entry was produced from a single photo */
  singlePhoto?: boolean;
  /** User decision on this entry */
  status: PlaceStatus;
}

/**
 * Minimal record kept after the bin is emptied for a dismissed PlaceEntry.
 * The full PlaceEntry is deleted; this marker survives so a re-scan can
 * still recognise and skip the same photos.
 *
 * A "reset decisions" action removes these markers, allowing the entry to be
 * offered again on the next scan.
 */
export interface PlaceBinMarker {
  /** Stable id for IndexedDB keyPath */
  id: string;
  localityKey: LocalityKey;
  /** Keys of any merged place that also maps to this locality */
  aliasKeys?: LocalityKey[];
  /** The day that was dismissed (YYYY-MM-DD) */
  localDay: string;
  /** Media IDs of the photos that were in the dismissed entry */
  photoIds: string[];
}

export type Entry = Leg | Stay | JEvent | Film | Episode | Book | PlaceEvent | PlaceEntry;

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

/**
 * @deprecated Day-level notes are no longer part of the model: reflections belong
 * to entries and containers only. The store is kept so existing data survives in backups.
 */
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
  cover: string;
  createdAt: string;
  /** Universal rating 0–10 for the whole trip */
  rating?: number;
  /** Universal reflection on the whole trip */
  reflection?: string;
  /** @deprecated Folded into `reflection` on boot. */
  notes?: string;
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

export interface PlaceRecord {
  id: string;
  /** Normalised upper-case code or name, e.g. "DUB", "LONDON ST PANCRAS" */
  code: string;
  name: string;
  lat: number;
  lon: number;
  /** IANA timezone, e.g. "Europe/Dublin". Optional — map still works without it. */
  timezone?: string;
  createdAt: string;
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
  /** Transit place records (airports, stations) used for geo lookup — NOT locality places */
  places: PlaceRecord[];
  /**
   * @deprecated Superseded by localityPlaces + placeEntries (WP10).
   * Kept for the existing scan pipeline until WP12/WP13 replace it.
   * Will be removed once the migration is complete.
   */
  placeEvents: PlaceEvent[];
  /** WP10: Place containers (one per locality, like Trip / Series) */
  localityPlaces: Place[];
  /** WP10: One-day place facts (one per locality+day) */
  placeEntries: PlaceEntry[];
  /** WP10: Minimal markers kept after the bin is emptied, so re-scan still skips dismissed photos */
  placeBinMarkers: PlaceBinMarker[];
}

export const STORES = [
  "trips", "legs", "stays", "events", "films", "episodes", "books",
  "series", "notes", "staging", "people", "places",
  // Legacy (WP1–WP9)
  "placeEvents",
  // WP10
  "localityPlaces", "placeEntries", "placeBinMarkers",
] as const;
export type StoreName = (typeof STORES)[number];

/** Returns an empty JournalData with every store initialised to an empty array. */
export function emptyJournalData(): JournalData {
  return Object.fromEntries(STORES.map((s) => [s, []])) as unknown as JournalData;
}

/** The top-level shape of a Chronicle backup file. */
export interface BackupFile {
  app: "chronicle";
  schemaVersion: 1;
  exportedAt: string;
  data: JournalData;
}

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
  } else if (("city" in keys || "start" in keys || "end" in keys) && (v.kind === "stay" || v.kind === "event")) {
    const tz = timezoneFor((v as { city?: string }).city ?? "");
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
  if (v.kind === "place") return v.country ? `${v.locality}, ${v.country}` : v.locality;
  if (v.kind === "place-entry") {
    // Derive a human-readable name from localityKey ("gb:london" → "London",
    // "it:porto-venere" → "Porto Venere"). The Place container carries the
    // canonical name but entryTitle can't access the store, so we parse the key.
    const slug = v.localityKey.slice(v.localityKey.indexOf(":") + 1);
    return slug
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }
  if (v.kind === "film") return v.year ? `${v.title} (${v.year})` : v.title;
  if (v.kind === "episode") return v.episodeTitle ? `${v.showTitle}: ${v.episodeTitle}` : v.showTitle;
  if (v.kind === "book") return v.author ? `${v.title} — ${v.author}` : v.title;
  return v.category === "concert" && v.venue ? `${v.artist} @ ${v.venue}` : v.artist;
}
