/**
 * BookModel: the device-independent, JSON-serialisable description of a book.
 * See docs/specs/book-export.md, section 8.
 *
 * Pure TypeScript. No React Native, DOM or storage imports. Both renderers
 * (PDF and Markdown) read this model and nothing else about layout.
 *
 * Division of work between packages:
 *  - WP1 (build.ts) selects entries and groups them into chapters and sections.
 *    Sections list their entries by id in `entryIds`.
 *  - WP2 maps each entry to `blocks` (tables, quotes, reflections and so on).
 *    Until then `blocks` is empty.
 */
import type { FeedKind } from "../feedFilter";

export type ChapterMode = "year" | "trip";
export type PageSize = "A4" | "A5";

/**
 * A saved book definition (the `definition` JSON of the `books` table).
 * Dates are local calendar days, "YYYY-MM-DD", inclusive at both ends.
 */
export interface BookDefinition {
  title: string;
  subtitle?: string;
  dedication?: string;
  start: string;
  end: string;
  /** Feed kind filter. Defaults to "all". */
  filter?: FeedKind;
  /** Only entries this person took part in (same rule as the feed person filter). */
  personId?: string;
  /** Only entries linked to this trip. */
  tripId?: string;
  chapterMode: ChapterMode;
  /** Per-book exclusions. Entries are never deleted from the journal. */
  excludedEntryIds?: string[];
  pageSize?: PageSize;
  /** Media vault id of the cover photo. */
  coverMediaId?: string;
}

/** Inputs that must come from the caller so the model is reproducible. */
export interface BuildOptions {
  /** Generation date, "YYYY-MM-DD". Passed in, never read from a clock. */
  generatedOn: string;
  /** BCP 47 tag. Defaults to "en". */
  language?: string;
}

export interface DayRange {
  start: string;
  end: string;
}

export interface BookMeta {
  title: string;
  subtitle?: string;
  dedication?: string;
  language: string;
  /** The range the user asked for, not the extent of the entries found. */
  dateRange: DayRange;
  chapterMode: ChapterMode;
  /** Display names of the sources actually used by included entries, sorted. */
  sources: string[];
  generatedOn: string;
  coverMediaId?: string;
}

export interface TripRef {
  id: string;
  title: string;
  /** Whole-trip dates, used for the "Day N of the journey" framing. */
  start: string;
  end: string;
}

export type TableRow = {
  /** Icon key such as "plane", "train" or "hotel". Renderers choose how to draw it. */
  icon?: string;
  cells: string[];
};

export type Block =
  | { type: "heading"; level: 1 | 2 | 3 | 4; text: string }
  | { type: "dateLine"; date: string; time?: string }
  | { type: "paragraph"; text: string; italic?: boolean }
  | { type: "quote"; text: string; attribution?: string }
  | { type: "table"; caption?: string; columns: string[]; rows: TableRow[] }
  | { type: "photo"; mediaId: string; caption?: string };

/**
 * A run of entries inside a chapter.
 *  - "trip": every included entry of one trip that falls in this chapter.
 *  - "plain": consecutive entries that belong to no trip. No heading.
 */
export interface BookSection {
  id: string;
  kind: "trip" | "plain";
  title?: string;
  trip?: TripRef;
  /** Entry ids in print order. */
  entryIds: string[];
  /** Filled by WP2. */
  blocks: Block[];
}

/**
 * "year": a calendar year (year mode).
 * "trip": one trip (trip mode).
 * "gap":  entries outside any trip between two trip chapters (trip mode).
 */
export type ChapterKind = "year" | "trip" | "gap";

export interface BookChapter {
  id: string;
  kind: ChapterKind;
  title: string;
  /** Days of the first and last entry in the chapter. */
  dateRange: DayRange;
  sections: BookSection[];
}

export interface BookStats {
  /** Entries that appear in the book. */
  entryCount: number;
  /** Entries that matched the date range and filters but were excluded by the user. */
  excludedCount: number;
}

export interface BookModel {
  meta: BookMeta;
  chapters: BookChapter[];
  stats: BookStats;
}
