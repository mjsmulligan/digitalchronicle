/**
 * WP1 of docs/specs/book-export.md: build a BookModel from journal data.
 *
 * Pipeline: JournalData + BookDefinition -> selectBookEntries -> grouping -> BookModel.
 * Pure and deterministic: no clock, no storage, no device APIs. The same data and
 * definition always give the same model.
 *
 * Entry mapping to blocks (tables, quotes, reflections) is WP2, so `blocks` is
 * left empty here and sections carry `entryIds`.
 */
import { entryHasPerson, matchesFilter } from "../feedFilter";
import { buildSectionBlocks } from "./blocks";
import { entryDay, sourceDisplayName } from "./common";
import { view, type Entry, type JournalData, type Trip } from "../types";
import type {
  BookChapter,
  BookDefinition,
  BookModel,
  BookSection,
  BuildOptions,
  TripRef,
} from "./types";

/** Same journal-visible set the feed uses: not hidden, and only accepted place entries. */
function visibleEntries(data: JournalData): Entry[] {
  return [
    ...data.legs,
    ...data.stays,
    ...data.events,
    ...data.films,
    ...data.episodes,
    ...data.books,
    ...(data.placeEntries ?? []).filter((e) => e.status === "accepted"),
  ].filter((e) => !e.hidden);
}

/** Print order: start (date and time), then dedupeKey, then id, so ties are stable. */
export function compareEntries(a: Entry, b: Entry): number {
  const sa = view(a).start;
  const sb = view(b).start;
  if (sa !== sb) return sa < sb ? -1 : 1;
  if (a.dedupeKey !== b.dedupeKey) return a.dedupeKey < b.dedupeKey ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Every entry the definition's date range and filters select, in print order,
 * before per-book exclusions. The builder's review list uses this so excluded
 * entries stay visible and can be ticked back in.
 */
export function selectBookEntries(data: JournalData, def: BookDefinition): Entry[] {
  const kind = def.filter ?? "all";
  const person = def.personId ? data.people.find((p) => p.id === def.personId) : undefined;
  // An unknown person id matches nothing rather than silently ignoring the filter.
  const personMissing = def.personId !== undefined && person === undefined;

  return visibleEntries(data)
    .filter((e) => {
      const d = entryDay(e);
      if (d < def.start || d > def.end) return false;
      if (!matchesFilter(e, kind)) return false;
      if (personMissing) return false;
      if (person && !entryHasPerson(e, person)) return false;
      if (def.tripId !== undefined && e.tripId !== def.tripId) return false;
      return true;
    })
    .sort(compareEntries);
}

/** Sorted display names of every source that contributed to these entries. */
export function sourcesUsed(entries: Entry[]): string[] {
  const ids = new Set<string>();
  for (const e of entries) {
    ids.add(e.source);
    for (const a of e.additionalSources ?? []) ids.add(a.source);
  }
  ids.delete("manual");
  return [...ids].map(sourceDisplayName).sort((a, b) => a.localeCompare(b, "en"));
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "March 2025" for one month, "March to June 2025" across months of one year. */
function gapTitle(startDay: string, endDay: string): string {
  const year = startDay.slice(0, 4);
  const m1 = MONTHS[Number(startDay.slice(5, 7)) - 1];
  const m2 = MONTHS[Number(endDay.slice(5, 7)) - 1];
  return m1 === m2 ? `${m1} ${year}` : `${m1} to ${m2} ${year}`;
}

function tripRef(t: Trip): TripRef {
  return { id: t.id, title: t.title, start: t.start, end: t.end };
}

/** One unit of print order: all of a trip's entries together, or a single non-trip entry. */
interface Unit {
  trip?: Trip;
  entries: Entry[];
}

/**
 * Collapse sorted entries into units. A trip's entries form one unit positioned
 * where the trip's first entry falls, so a trip is never split by an unlinked
 * entry that happens to fall between its days. Such an entry follows the trip.
 */
function toUnits(sorted: Entry[], tripById: Map<string, Trip>): Unit[] {
  const units: Unit[] = [];
  const byTrip = new Map<string, Unit>();
  for (const e of sorted) {
    const trip = e.tripId ? tripById.get(e.tripId) : undefined;
    if (!trip) {
      units.push({ entries: [e] });
      continue;
    }
    let u = byTrip.get(trip.id);
    if (!u) {
      u = { trip, entries: [] };
      byTrip.set(trip.id, u);
      units.push(u);
    }
    u.entries.push(e);
  }
  return units;
}

function plainSection(id: string, entries: Entry[]): BookSection {
  return { id, kind: "plain", entryIds: entries.map((e) => e.id), blocks: [] };
}

function tripSection(id: string, trip: Trip, entries: Entry[]): BookSection {
  return {
    id,
    kind: "trip",
    title: trip.title,
    trip: tripRef(trip),
    entryIds: entries.map((e) => e.id),
    blocks: [],
  };
}

function rangeOf(entries: Entry[]) {
  return { start: entryDay(entries[0]), end: entryDay(entries[entries.length - 1]) };
}

/** Year mode sections: trip sections interleaved with plain runs, in print order. */
function yearSections(
  chapterId: string,
  entries: Entry[],
  tripById: Map<string, Trip>,
): BookSection[] {
  const sections: BookSection[] = [];
  let run: Entry[] = [];
  const flush = () => {
    if (run.length) sections.push(plainSection(`${chapterId}-s${sections.length + 1}`, run));
    run = [];
  };
  for (const u of toUnits(entries, tripById)) {
    if (u.trip) {
      flush();
      sections.push(tripSection(`${chapterId}-s${sections.length + 1}`, u.trip, u.entries));
    } else {
      run.push(...u.entries);
    }
  }
  flush();
  return sections;
}

function buildYearChapters(entries: Entry[], tripById: Map<string, Trip>): BookChapter[] {
  const byYear = new Map<string, Entry[]>();
  for (const e of entries) {
    const y = entryDay(e).slice(0, 4);
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y)!.push(e);
  }
  return [...byYear.keys()].sort().map((year) => {
    const list = byYear.get(year)!;
    const id = `year-${year}`;
    return {
      id,
      kind: "year" as const,
      title: year,
      dateRange: rangeOf(list),
      sections: yearSections(id, list, tripById),
    };
  });
}

/**
 * Trip mode: one chronological sequence. Each trip is a chapter. Entries outside
 * any trip form gap chapters between trips, split at 1 January so no gap chapter
 * spans two years.
 */
function buildTripChapters(entries: Entry[], tripById: Map<string, Trip>): BookChapter[] {
  const chapters: BookChapter[] = [];
  let run: Entry[] = [];

  const flushRun = () => {
    if (!run.length) return;
    const range = rangeOf(run);
    const id = `gap-${range.start}`;
    chapters.push({
      id,
      kind: "gap",
      title: gapTitle(range.start, range.end),
      dateRange: range,
      sections: [plainSection(`${id}-s1`, run)],
    });
    run = [];
  };

  for (const u of toUnits(entries, tripById)) {
    if (u.trip) {
      flushRun();
      const id = `trip-${u.trip.id}`;
      chapters.push({
        id,
        kind: "trip",
        title: u.trip.title,
        dateRange: rangeOf(u.entries),
        sections: [tripSection(`${id}-s1`, u.trip, u.entries)],
      });
      continue;
    }
    const e = u.entries[0];
    if (run.length && entryDay(run[run.length - 1]).slice(0, 4) !== entryDay(e).slice(0, 4))
      flushRun();
    run.push(e);
  }
  flushRun();
  return chapters;
}

export function buildBookModel(
  data: JournalData,
  def: BookDefinition,
  opts: BuildOptions,
): BookModel {
  const candidates = selectBookEntries(data, def);
  const excluded = new Set(def.excludedEntryIds ?? []);
  const entries = candidates.filter((e) => !excluded.has(e.id));
  const tripById = new Map(data.trips.map((t) => [t.id, t]));

  const chapters =
    def.chapterMode === "trip"
      ? buildTripChapters(entries, tripById)
      : buildYearChapters(entries, tripById);

  // WP2: fill each section's print blocks from its entries.
  const byId = new Map(entries.map((e) => [e.id, e]));
  const ctx = { people: data.people, places: data.localityPlaces ?? [], trips: data.trips };
  for (const chapter of chapters) {
    for (const section of chapter.sections) {
      const sectionEntries = section.entryIds.map((id) => byId.get(id)!);
      section.blocks = buildSectionBlocks(
        section.kind,
        section.trip,
        chapter.kind,
        sectionEntries,
        ctx,
      );
    }
  }

  return {
    meta: {
      title: def.title,
      ...(def.subtitle !== undefined && { subtitle: def.subtitle }),
      ...(def.dedication !== undefined && { dedication: def.dedication }),
      language: opts.language ?? "en",
      dateRange: { start: def.start, end: def.end },
      chapterMode: def.chapterMode,
      sources: sourcesUsed(entries),
      generatedOn: opts.generatedOn,
      ...(def.coverMediaId !== undefined && { coverMediaId: def.coverMediaId }),
    },
    chapters,
    stats: {
      entryCount: entries.length,
      excludedCount: candidates.length - entries.length,
    },
  };
}
