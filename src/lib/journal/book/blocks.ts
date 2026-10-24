/**
 * WP2 of docs/specs/book-export.md: map a section's entries to print blocks.
 * Treatment per event type follows section 7 of the spec.
 *
 * Pure and deterministic, no device or storage access. Both renderers read the
 * blocks and decide how to draw them.
 *
 * Rules worth knowing:
 *  - Source review text and the user's reflection are always separate blocks:
 *    the review is a `quote` attributed to the source, the reflection an italic
 *    `paragraph`. They are never merged.
 *  - Nothing is invented. Missing fields give empty cells, not guesses.
 *  - Not printed: unreviewed flags, source icons, dedupe keys, raw source ids.
 *  - Ratings print as "n/10". Stars are left to the renderer step, because the
 *    glyph depends on the font chosen there.
 */
import {
  view,
  type Entry,
  type JEvent,
  type Leg,
  type Person,
  type Place,
  type PlaceEntry,
  type Stay,
  type Trip,
} from "../types";
import { entryDay, sourceDisplayName } from "./common";
import type { Block, ChapterKind, TableRow, TripRef } from "./types";

export interface BlockContext {
  people: Person[];
  places: Place[];
  trips: Trip[];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "14 Jan 2026". Fixed format so output never depends on device locale. */
export function formatDay(day: string): string {
  return `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`;
}

/** "7.5/10", "8/10". */
export function formatRating(n: number): string {
  return `${Number(n.toFixed(1))}/10`;
}

function dayNumber(day: string): number {
  return (
    Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) /
    86_400_000
  );
}

function daysBetween(a: string, b: string): number {
  return dayNumber(b) - dayNumber(a);
}

function entryTime(e: Entry): string {
  const s = view(e).start;
  return s.length >= 16 ? s.slice(11, 16) : "";
}

function endTime(e: Entry): string {
  const s = view(e).end;
  return s && s.length >= 16 ? s.slice(11, 16) : "";
}

/** Names of the other people present. The journal owner is never listed. */
function withNames(e: Entry, ctx: BlockContext): string {
  const names: string[] = [];
  for (const id of e.participants ?? []) {
    const p = ctx.people.find((x) => x.id === id);
    if (p && !p.isSelf) names.push(p.name);
  }
  return names.join(", ");
}

function withBlock(e: Entry, ctx: BlockContext): Block[] {
  const names = withNames(e, ctx);
  return names ? [{ type: "paragraph", text: `With: ${names}` }] : [];
}

/** Source review (quote, attributed) then user reflection (italic). Always separate. */
function evaluationBlocks(e: Entry): Block[] {
  const out: Block[] = [];
  if (e.review)
    out.push({ type: "quote", text: e.review, attribution: sourceDisplayName(e.source) });
  if (e.reflection) out.push({ type: "paragraph", text: e.reflection, italic: true });
  return out;
}

function joinMeta(parts: (string | undefined | false)[]): string {
  return parts.filter((p): p is string => !!p).join(" · ");
}

/** Drop optional columns that are empty in every row, keeping the first `keep` columns. */
function compact(
  columns: string[],
  rows: TableRow[],
  keep: number,
): { columns: string[]; rows: TableRow[] } {
  const drop = new Set<number>();
  for (let c = keep; c < columns.length; c++) if (rows.every((r) => !r.cells[c])) drop.add(c);
  if (!drop.size) return { columns, rows };
  return {
    columns: columns.filter((_, i) => !drop.has(i)),
    rows: rows.map((r) => ({ ...r, cells: r.cells.filter((_, i) => !drop.has(i)) })),
  };
}

function table(columns: string[], rows: TableRow[], keep: number): Block {
  const t = compact(columns, rows, keep);
  return { type: "table", columns: t.columns, rows: t.rows };
}

// ---- movement ------------------------------------------------------------

const LEG_ICON: Record<string, string> = { air: "plane", rail: "train", road: "car" };

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase() && a.trim() !== "";
}

function legTable(legs: Leg[]): Block {
  const rows: TableRow[] = legs.map((raw, i) => {
    const l = view(raw);
    const from = l.fromName ?? l.from ?? "";
    const to = l.toName ?? l.to ?? "";
    const prev = i > 0 ? view(legs[i - 1]) : undefined;
    const prevTo = prev ? (prev.toName ?? prev.to ?? "") : "";
    const start = entryTime(l);
    const end = endTime(l);
    return {
      icon: LEG_ICON[l.mode] ?? "leg",
      cells: [
        start && end ? `${start} to ${end}` : start,
        from,
        to,
        l.flightNumber ?? l.trainNumber ?? "",
        sameName(prevTo, from) ? `Connects at ${from}` : "",
      ],
    };
  });
  return table(["Time", "From", "To", "Ref", "Note"], rows, 3);
}

function stayTable(stays: Stay[]): Block {
  const rows: TableRow[] = stays.map((raw) => {
    const s = view(raw);
    const day = entryDay(s);
    const out = s.end ? s.end.slice(0, 10) : "";
    const nights = out && out > day ? daysBetween(day, out) : 0;
    return {
      icon: "hotel",
      cells: [
        s.city && s.city !== s.place ? `${s.place}, ${s.city}` : s.place,
        formatDay(day),
        out ? formatDay(out) : "",
        nights ? String(nights) : "",
      ],
    };
  });
  return table(["Place", "Check-in", "Check-out", "Nights"], rows, 2);
}

// ---- items ---------------------------------------------------------------

/** One printable unit. Its date line is printed unless it repeats the previous one. */
interface Item {
  day: string;
  endDay?: string;
  time?: string;
  /** False for table runs that carry their own date column. */
  dateLine: boolean;
  precision?: "month" | "year" | "unknown";
  blocks: Block[];
}

const TABLE_EVENT_CATEGORIES = new Set(["concert", "activity"]);

/**
 * Concerts and other venue events with a venue go in a table, unless they carry a
 * source review or a reflection: those read as a short narrative entry so the text
 * stays attached to its event instead of trailing a table.
 */
function isTableEvent(e: Entry): e is JEvent {
  return (
    e.kind === "event" &&
    TABLE_EVENT_CATEGORIES.has(e.category) &&
    !!view(e).venue &&
    !e.review &&
    !e.reflection
  );
}

function precisionOf(e: Entry): Item["precision"] {
  const p = e.datePrecision;
  return p === "month" || p === "year" || p === "unknown" ? p : undefined;
}

function eventRow(raw: JEvent, ctx: BlockContext): TableRow {
  const e = view(raw);
  return {
    cells: [
      formatDay(entryDay(e)),
      e.artist,
      [e.venue, e.city].filter(Boolean).join(", "),
      withNames(e, ctx),
      e.rating != null ? formatRating(e.rating) : "",
    ],
  };
}

export function placeName(e: PlaceEntry, ctx: BlockContext): { name: string; detail: string } {
  const place = ctx.places.find((p) => p.id === e.placeId);
  if (place) {
    return {
      name: place.locality,
      detail: [place.region, place.country].filter(Boolean).join(", "),
    };
  }
  // Fall back to the locality key ("gb:london" -> "London").
  const slug = e.localityKey.slice(e.localityKey.indexOf(":") + 1);
  const name = slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return { name, detail: "" };
}

function narrativeItem(raw: Entry, ctx: BlockContext): Item {
  const e = view(raw);
  const blocks: Block[] = [];
  const rating = e.rating != null ? formatRating(e.rating) : undefined;
  if (e.kind === "book") {
    blocks.push({ type: "heading", level: 4, text: e.title });
    const meta = joinMeta([e.author, e.year ? String(e.year) : undefined, rating]);
    if (meta) blocks.push({ type: "paragraph", text: meta });
  } else if (e.kind === "film") {
    blocks.push({ type: "heading", level: 4, text: e.year ? `${e.title} (${e.year})` : e.title });
    const meta = joinMeta([e.director, e.rewatch ? "Rewatch" : undefined, rating]);
    if (meta) blocks.push({ type: "paragraph", text: meta });
  } else if (e.kind === "episode") {
    blocks.push({
      type: "heading",
      level: 4,
      text: e.episodeTitle ? `${e.showTitle}: ${e.episodeTitle}` : e.showTitle,
    });
    const meta = joinMeta([e.season, rating]);
    if (meta) blocks.push({ type: "paragraph", text: meta });
  } else if (e.kind === "event") {
    blocks.push({ type: "heading", level: 4, text: e.artist });
    const meta = joinMeta([[e.venue, e.city].filter(Boolean).join(", "), rating]);
    if (meta) blocks.push({ type: "paragraph", text: meta });
  } else {
    // Legs, stays and place entries are handled by their own builders.
    blocks.push({ type: "heading", level: 4, text: String(e.kind) });
  }
  blocks.push(...withBlock(e, ctx), ...evaluationBlocks(e));
  return {
    day: entryDay(e),
    time: entryTime(e) || undefined,
    dateLine: true,
    precision: precisionOf(e),
    blocks,
  };
}

/** Turn a section's entries (already in print order) into items. */
function toItems(entries: Entry[], ctx: BlockContext): Item[] {
  const items: Item[] = [];
  let i = 0;
  while (i < entries.length) {
    const e = entries[i];

    if (e.kind === "leg") {
      const day = entryDay(e);
      const run: Leg[] = [];
      while (i < entries.length && entries[i].kind === "leg" && entryDay(entries[i]) === day)
        run.push(entries[i++] as Leg);
      const blocks: Block[] = [legTable(run)];
      const withs = [...new Set(run.flatMap((l) => withNames(l, ctx).split(", ").filter(Boolean)))];
      if (withs.length) blocks.push({ type: "paragraph", text: `With: ${withs.join(", ")}` });
      for (const l of run) blocks.push(...evaluationBlocks(l));
      items.push({ day, dateLine: true, blocks });
      continue;
    }

    if (e.kind === "stay") {
      const day = entryDay(e);
      const run: Stay[] = [];
      while (i < entries.length && entries[i].kind === "stay" && entryDay(entries[i]) === day)
        run.push(entries[i++] as Stay);
      const out = run.length === 1 && run[0].end ? run[0].end.slice(0, 10) : undefined;
      const blocks: Block[] = [stayTable(run)];
      for (const s of run) blocks.push(...withBlock(s, ctx), ...evaluationBlocks(s));
      items.push({ day, endDay: out && out > day ? out : undefined, dateLine: true, blocks });
      continue;
    }

    if (e.kind === "place-entry") {
      const first = e as PlaceEntry;
      let last = first;
      i++;
      // Consecutive days at one place read as one visit.
      while (i < entries.length) {
        const n = entries[i];
        if (n.kind !== "place-entry" || n.placeId !== first.placeId) break;
        if (daysBetween(entryDay(last), entryDay(n)) !== 1) break;
        last = n as PlaceEntry;
        i++;
      }
      const { name, detail } = placeName(first, ctx);
      const blocks: Block[] = [{ type: "heading", level: 4, text: name }];
      if (detail) blocks.push({ type: "paragraph", text: detail });
      blocks.push(...evaluationBlocks(first));
      const day = entryDay(first);
      const endDay = entryDay(last);
      items.push({ day, endDay: endDay > day ? endDay : undefined, dateLine: true, blocks });
      continue;
    }

    if (isTableEvent(e)) {
      const rows: TableRow[] = [];
      while (i < entries.length && isTableEvent(entries[i]))
        rows.push(eventRow(entries[i++] as JEvent, ctx));
      items.push({
        day: entryDay(e),
        dateLine: false,
        blocks: [table(["Date", "Event", "Venue", "With", "Rating"], rows, 3)],
      });
      continue;
    }

    items.push(narrativeItem(e, ctx));
    i++;
  }
  return items;
}

/**
 * Blocks for one section. `entries` must be in print order.
 * A trip section opens with its heading (year chapters only, since a trip chapter's
 * title already is the trip), the trip dates, and the trip's own rating and reflection.
 */
export function buildSectionBlocks(
  sectionKind: "trip" | "plain",
  trip: TripRef | undefined,
  chapterKind: ChapterKind,
  entries: Entry[],
  ctx: BlockContext,
): Block[] {
  const blocks: Block[] = [];

  if (sectionKind === "trip" && trip) {
    if (chapterKind === "year") blocks.push({ type: "heading", level: 3, text: trip.title });
    const dates =
      trip.end > trip.start
        ? `${formatDay(trip.start)} to ${formatDay(trip.end)}`
        : formatDay(trip.start);
    // A trip that crosses New Year appears in two year chapters. Its own rating and
    // reflection belong to the whole trip, so they print once, in the last of them.
    const full = ctx.trips.find((t) => t.id === trip.id);
    const lastDay = entries.length ? entryDay(entries[entries.length - 1]) : trip.end;
    const closesTrip = lastDay.slice(0, 4) >= trip.end.slice(0, 4);
    blocks.push({
      type: "paragraph",
      text: joinMeta([dates, closesTrip && full?.rating != null && formatRating(full.rating)]),
    });
    if (closesTrip && full?.reflection)
      blocks.push({ type: "paragraph", text: full.reflection, italic: true });
  }

  let lastDay: string | undefined;
  for (const item of toItems(entries, ctx)) {
    if (item.dateLine) {
      const repeats = lastDay === item.day && !item.endDay && !item.precision;
      if (!repeats) {
        const n = trip ? daysBetween(trip.start, item.day) + 1 : 0;
        blocks.push({
          type: "dateLine",
          date: item.day,
          ...(item.endDay && { endDate: item.endDay }),
          ...(item.time && { time: item.time }),
          ...(trip && n >= 1 && { label: `Day ${n} of the journey` }),
          ...(item.precision && { precision: item.precision }),
        });
      }
      lastDay = item.day;
    } else {
      lastDay = undefined;
    }
    blocks.push(...item.blocks);
  }
  return blocks;
}
