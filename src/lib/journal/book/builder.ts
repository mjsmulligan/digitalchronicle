/**
 * WP6 of docs/specs/book-export.md: the pure logic behind the builder screen.
 * Defaults, validation, the review list with exclusions, a page estimate and
 * the saved-book record. No React Native, storage or clock.
 */
import { view, type Entry, type JournalData, type PlaceEntry } from "../types";
import { placeName } from "./blocks";
import { buildBookModel, selectBookEntries } from "./build";
import { entryDay } from "./common";
import type { BookDefinition, BookModel, PageSize } from "./types";

/** A book definition as stored, with bookkeeping. */
export interface SavedBook {
  id: string;
  definition: BookDefinition;
  createdAt: string;
  updatedAt: string;
  /** Set after a successful export. */
  lastExportedAt?: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function isRealDay(s: string): boolean {
  if (!DAY.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Problems that stop an export. Empty when the definition is usable. */
export function validateDefinition(def: BookDefinition): string[] {
  const errors: string[] = [];
  if (!def.title.trim()) errors.push("Give the book a title.");
  if (!isRealDay(def.start)) errors.push("Start date must be a real date, as YYYY-MM-DD.");
  if (!isRealDay(def.end)) errors.push("End date must be a real date, as YYYY-MM-DD.");
  if (isRealDay(def.start) && isRealDay(def.end) && def.start > def.end)
    errors.push("The start date is after the end date.");
  return errors;
}

/** Calendar years that have at least one journal entry, oldest first. */
export function journalYears(data: JournalData): string[] {
  const all = selectBookEntries(data, {
    title: "",
    start: "0000-01-01",
    end: "9999-12-31",
    chapterMode: "year",
  });
  return [...new Set(all.map((e) => entryDay(e).slice(0, 4)))].sort();
}

/**
 * A starting point: the latest year that has entries (or `today`'s year for an
 * empty journal), by year, A4.
 */
export function defaultDefinition(data: JournalData, today: string): BookDefinition {
  const years = journalYears(data);
  const year = years.length ? years[years.length - 1] : today.slice(0, 4);
  return {
    title: `My ${year}`,
    start: `${year}-01-01`,
    end: `${year}-12-31`,
    chapterMode: "year",
    pageSize: "A4",
  };
}

/** Short one-line description of an entry for the review list. */
export function entryLabel(e: Entry, data: Pick<JournalData, "localityPlaces">): string {
  const v = view(e);
  switch (v.kind) {
    case "leg":
      return `${v.fromName ?? v.from} to ${v.toName ?? v.to}`;
    case "stay":
      return v.place;
    case "event":
      return v.artist;
    case "film":
    case "book":
      return v.title;
    case "episode":
      return v.episodeTitle ? `${v.showTitle}: ${v.episodeTitle}` : v.showTitle;
    case "place-entry":
      return placeName(v as PlaceEntry, {
        people: [],
        places: data.localityPlaces ?? [],
        trips: [],
      }).name;
    default:
      return String((v as Entry).kind);
  }
}

export interface ReviewEntry {
  id: string;
  day: string;
  label: string;
  excluded: boolean;
}
export interface ReviewChapter {
  id: string;
  title: string;
  entries: ReviewEntry[];
}

/**
 * Entries grouped the way the book will group them, including ones the user has
 * excluded, so an exclusion can be ticked back in.
 */
export function buildReviewList(data: JournalData, def: BookDefinition): ReviewChapter[] {
  const excluded = new Set(def.excludedEntryIds ?? []);
  const model = buildBookModel(
    data,
    { ...def, excludedEntryIds: [] },
    { generatedOn: "1970-01-01" },
  );
  const byId = new Map(selectBookEntries(data, def).map((e) => [e.id, e]));
  return model.chapters.map((c) => ({
    id: c.id,
    title: c.title,
    entries: c.sections.flatMap((s) =>
      s.entryIds.map((id) => {
        const e = byId.get(id)!;
        return { id, day: entryDay(e), label: entryLabel(e, data), excluded: excluded.has(id) };
      }),
    ),
  }));
}

// ── page estimate ────────────────────────────────────────────────────────────

/** Text lines that fit a page, and characters that fit a line, per page size. */
const PAGE_METRICS: Record<PageSize, { lines: number; chars: number }> = {
  A4: { lines: 59, chars: 90 },
  A5: { lines: 39, chars: 58 },
};
/** Lines of vertical space each block type takes, beyond its text. */
const LINES = { heading3: 3, heading4: 1.8, date: 1.8, row: 1.5, tableGap: 1, photo: 14 };
/** Pages before the first chapter: title, dedication (if any), colophon, contents. */
const FRONT_MATTER_PAGES = 4;

/**
 * Rough page count, so the user knows if a book is 40 or 400 pages before
 * exporting. Calibrated against desktop Chromium PDFs of the real renderer.
 * Devices whose print engine honours right-hand chapter openings can add blank pages.
 */
export function estimatePages(model: BookModel, pageSize: PageSize): number {
  const { lines: perPage, chars } = PAGE_METRICS[pageSize];
  let pages = FRONT_MATTER_PAGES + (model.meta.dedication ? 1 : 0);
  for (const chapter of model.chapters) {
    // The chapter title takes a slice of its first page.
    let lines = 6;
    for (const section of chapter.sections) {
      for (const b of section.blocks) {
        switch (b.type) {
          case "heading":
            lines += b.level >= 4 ? LINES.heading4 : LINES.heading3;
            break;
          case "dateLine":
            lines += LINES.date;
            break;
          case "paragraph":
          case "quote":
            lines += Math.max(1, Math.ceil(b.text.length / chars)) + 0.4;
            break;
          case "table":
            lines += (b.rows.length + 1) * LINES.row + LINES.tableGap;
            break;
          case "photo":
            lines += LINES.photo;
            break;
        }
      }
    }
    pages += Math.max(1, Math.ceil(lines / perPage)) + 0.05;
  }
  return Math.ceil(pages);
}

/** "my-2026" style base name for exported files. */
export function bookFileBase(def: BookDefinition): string {
  const slug = def.title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "book";
}
