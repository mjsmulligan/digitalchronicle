/**
 * WP2 of docs/specs/book-export.md: entry to block mapping (section 7).
 * Importer fixtures are reused where the shape matters; other cases are built by
 * cloning them so each test states exactly what it varies.
 */
import { beforeEach, describe, expect, test } from "vitest";
import {
  buildBookModel,
  buildSectionBlocks,
  formatDay,
  formatRating,
  type Block,
  type BlockContext,
  type BookDefinition,
} from "..";
import type { Book, Entry, JEvent, Leg, Person, Place, PlaceEntry, Stay } from "../../types";
import { FRIEND, SELF, TRIP_EUROPE, makeFixture, type Fixture } from "./fixtures";

let fx: Fixture;
beforeEach(async () => {
  fx = await makeFixture();
});

const ctx = (over: Partial<BlockContext> = {}): BlockContext => ({
  people: [SELF, FRIEND],
  places: [],
  trips: [],
  ...over,
});
const plain = (entries: Entry[], c = ctx()) =>
  buildSectionBlocks("plain", undefined, "year", entries, c);
const types = (blocks: Block[]) => blocks.map((b) => b.type);
const tableOf = (blocks: Block[]) =>
  blocks.find((b) => b.type === "table") as Extract<Block, { type: "table" }>;

describe("formatting", () => {
  test("rating prints as n/10 without a trailing .0", () => {
    expect(formatRating(8)).toBe("8/10");
    expect(formatRating(7.5)).toBe("7.5/10");
    expect(formatRating(0)).toBe("0/10");
  });
  test("days print in a fixed format", () => {
    expect(formatDay("2026-01-04")).toBe("4 Jan 2026");
  });
});

describe("legs", () => {
  // The viaduct importer stores each row's Notes as the reflection, so clear the text
  // when a test is about the table itself.
  const bare = (over: Partial<Leg> = {}): Leg =>
    ({ ...fx.e.legMay17, reflection: undefined, review: undefined, ...over }) as Leg;

  test("legs on one day share one table with one icon per leg", () => {
    const legMay17 = bare();
    const air: Leg = {
      ...legMay17,
      id: "air",
      dedupeKey: "leg|air",
      mode: "air",
      flightNumber: "EI333",
      trainNumber: undefined,
    };
    const blocks = plain([legMay17, air]);
    expect(types(blocks)).toEqual(["dateLine", "table"]);
    const t = tableOf(blocks);
    expect(t.rows.map((r) => r.icon)).toEqual(["train", "plane"]);
    expect(t.columns.slice(0, 3)).toEqual(["Time", "From", "To"]);
    expect(t.rows[0].cells[1]).toBe("Berlin Hbf");
    expect(t.rows[1].cells).toContain("EI333");
  });

  test("legs on different days are separate tables, each under its own date line", () => {
    const blocks = plain([bare(), bare({ id: "n", dedupeKey: "n", start: "2026-05-19T10:21" })]);
    expect(types(blocks)).toEqual(["dateLine", "table", "dateLine", "table"]);
  });

  test("a leg that starts where the last one ended is marked as a connection", () => {
    const a: Leg = {
      ...bare(),
      id: "a",
      dedupeKey: "a",
      from: "A",
      fromName: "Alpha",
      to: "B",
      toName: "Beta",
    };
    const b: Leg = {
      ...bare(),
      id: "b",
      dedupeKey: "b",
      from: "B",
      fromName: "Beta",
      to: "C",
      toName: "Gamma",
    };
    const t = tableOf(plain([a, b]));
    expect(t.columns).toContain("Note");
    const note = t.columns.indexOf("Note");
    expect(t.rows[0].cells[note]).toBe("");
    expect(t.rows[1].cells[note]).toBe("Connects at Beta");
  });

  test("an unknown mode gets the neutral icon and missing fields stay empty, never invented", () => {
    const odd = {
      ...bare(),
      id: "odd",
      dedupeKey: "odd",
      mode: "teleport",
      trainNumber: undefined,
      fromName: undefined,
      toName: undefined,
      from: "",
      to: "",
    } as unknown as Leg;
    const t = tableOf(plain([odd]));
    expect(t.rows[0].icon).toBe("leg");
    expect(t.rows[0].cells.slice(1, 3)).toEqual(["", ""]);
    expect(t.columns).not.toContain("Ref");
  });

  test("optional columns are dropped when nothing fills them", () => {
    const t = tableOf(plain([bare()]));
    expect(t.columns).not.toContain("Note");
  });
});

describe("stays", () => {
  const stay = (over: Partial<Stay> = {}): Stay => ({ ...fx.e.hotel, ...over }) as Stay;

  test("one row with a hotel icon, check-in, check-out and computed nights", () => {
    const s = stay({
      id: "s",
      dedupeKey: "s",
      start: "2026-06-01",
      end: "2026-06-04",
      place: "Hotel Arts",
      city: "Barcelona",
    });
    const blocks = plain([s]);
    const t = tableOf(blocks);
    expect(t.rows[0].icon).toBe("hotel");
    expect(t.columns).toEqual(["Place", "Check-in", "Check-out", "Nights"]);
    expect(t.rows[0].cells).toEqual(["Hotel Arts, Barcelona", "1 Jun 2026", "4 Jun 2026", "3"]);
    expect(blocks[0]).toMatchObject({
      type: "dateLine",
      date: "2026-06-01",
      endDate: "2026-06-04",
    });
  });

  test("a stay with no check-out has no nights column", () => {
    const t = tableOf(
      plain([stay({ id: "s", dedupeKey: "s", start: "2026-06-01", end: undefined })]),
    );
    expect(t.columns).toEqual(["Place", "Check-in"]);
  });
});

describe("venue events", () => {
  const ev = (over: Partial<JEvent>): JEvent =>
    ({
      ...fx.e.caribou,
      tripId: undefined,
      review: undefined,
      reflection: undefined,
      participants: undefined,
      rating: undefined,
      ...over,
    }) as JEvent;

  test("consecutive concerts share one table; empty With and Rating columns are dropped", () => {
    const a = ev({
      id: "a",
      dedupeKey: "a",
      start: "2026-05-15",
      artist: "Caribou",
      venue: "Tempodrom",
      city: "Berlin",
    });
    const b = ev({
      id: "b",
      dedupeKey: "b",
      start: "2026-05-18",
      artist: "Kraftwerk",
      venue: "Elbphilharmonie",
      city: "Hamburg",
    });
    const blocks = plain([a, b]);
    expect(types(blocks)).toEqual(["table"]);
    const t = tableOf(blocks);
    expect(t.columns).toEqual(["Date", "Event", "Venue"]);
    expect(t.rows.map((r) => r.cells)).toEqual([
      ["15 May 2026", "Caribou", "Tempodrom, Berlin"],
      ["18 May 2026", "Kraftwerk", "Elbphilharmonie, Hamburg"],
    ]);
  });

  test("With lists the other people only, and the rating shows as n/10", () => {
    const e = ev({
      id: "a",
      dedupeKey: "a",
      venue: "3Arena",
      city: "Dublin",
      participants: [SELF.id, FRIEND.id],
      rating: 8.5,
    });
    const t = tableOf(plain([e]));
    expect(t.columns).toEqual(["Date", "Event", "Venue", "With", "Rating"]);
    expect(t.rows[0].cells.slice(3)).toEqual(["Sarah", "8.5/10"]);
  });

  test("an event with a reflection is a narrative entry so the text stays with it", () => {
    const e = ev({
      id: "a",
      dedupeKey: "a",
      venue: "3Arena",
      city: "Dublin",
      reflection: "Loud and wonderful.",
    });
    const blocks = plain([e]);
    expect(types(blocks)).toEqual(["dateLine", "heading", "paragraph", "paragraph"]);
    expect(blocks[1]).toMatchObject({ type: "heading", level: 4, text: e.artist });
    expect(blocks[3]).toEqual({ type: "paragraph", text: "Loud and wonderful.", italic: true });
  });

  test("an event with no venue is a narrative entry, not a table row", () => {
    const e = ev({ id: "a", dedupeKey: "a", category: "milestone", venue: "", city: "" });
    expect(types(plain([e]))).toEqual(["dateLine", "heading"]);
  });
});

describe("books and other consumption", () => {
  const book = (over: Partial<Book> = {}): Book =>
    ({
      ...fx.e.bookJun22,
      review: undefined,
      reflection: undefined,
      rating: undefined,
      participants: undefined,
      datePrecision: undefined,
      ...over,
    }) as Book;

  test("title, creator line, source review quoted with attribution, then the reflection in italics", () => {
    const b = book({
      id: "b",
      dedupeKey: "b",
      title: "Piranesi",
      author: "Susanna Clarke",
      year: 2020,
      rating: 9,
      review: "A strange gift.",
      reflection: "Read it twice.",
    });
    const blocks = plain([b]);
    expect(types(blocks)).toEqual(["dateLine", "heading", "paragraph", "quote", "paragraph"]);
    expect(blocks[1]).toMatchObject({ text: "Piranesi" });
    expect(blocks[2]).toEqual({ type: "paragraph", text: "Susanna Clarke · 2020 · 9/10" });
    expect(blocks[3]).toEqual({ type: "quote", text: "A strange gift.", attribution: "Goodreads" });
    expect(blocks[4]).toEqual({ type: "paragraph", text: "Read it twice.", italic: true });
  });

  test("review and reflection are never merged", () => {
    const b = book({ id: "b", dedupeKey: "b", review: "Source text", reflection: "My text" });
    const blocks = plain([b]);
    const quote = blocks.find((x) => x.type === "quote") as Extract<Block, { type: "quote" }>;
    const mine = blocks.find((x) => x.type === "paragraph" && x.italic) as Extract<
      Block,
      { type: "paragraph" }
    >;
    expect(quote.text).toBe("Source text");
    expect(mine.text).toBe("My text");
  });

  test("a null rating from stored data does not crash and prints nothing", () => {
    const b = book({ id: "b", dedupeKey: "b", rating: null as unknown as undefined });
    expect(() => plain([b])).not.toThrow();
    expect(JSON.stringify(plain([b]))).not.toContain("/10");
  });

  test("a loosely dated entry carries its precision so renderers do not invent a day", () => {
    const blocks = plain([
      book({ id: "b", dedupeKey: "b", start: "2026-06-01", datePrecision: "month" }),
    ]);
    expect(blocks[0]).toMatchObject({ type: "dateLine", precision: "month" });
  });

  test("films and episodes get their own headings", () => {
    const film = {
      ...fx.e.bookJun22,
      id: "f",
      dedupeKey: "f",
      kind: "film",
      title: "Ran",
      year: 1985,
      director: "Kurosawa",
      rewatch: true,
      rating: undefined,
      review: undefined,
      reflection: undefined,
    } as unknown as Entry;
    const ep = {
      ...fx.e.bookJun22,
      id: "e",
      dedupeKey: "e",
      kind: "episode",
      showTitle: "Severance",
      episodeTitle: "Hello, Ms. Cobel",
      season: "Season 2",
      rating: undefined,
      review: undefined,
      reflection: undefined,
    } as unknown as Entry;
    const [filmBlocks, epBlocks] = [plain([film]), plain([ep])];
    expect(filmBlocks[1]).toMatchObject({ text: "Ran (1985)" });
    expect(filmBlocks[2]).toEqual({ type: "paragraph", text: "Kurosawa · Rewatch" });
    expect(epBlocks[1]).toMatchObject({ text: "Severance: Hello, Ms. Cobel" });
  });

  test("participants appear as With: names under the entry", () => {
    const b = book({ id: "b", dedupeKey: "b", participants: [SELF.id, FRIEND.id] });
    expect(plain([b])).toContainEqual({ type: "paragraph", text: "With: Sarah" });
    const alone = book({ id: "c", dedupeKey: "c", participants: undefined });
    expect(JSON.stringify(plain([alone]))).not.toContain("With:");
  });
});

describe("place entries", () => {
  const pe = (id: string, day: string, over: Partial<PlaceEntry> = {}): PlaceEntry =>
    ({
      id,
      kind: "place-entry",
      source: "photo-library",
      tier: 2,
      createdAt: "",
      placeId: "pl-london",
      localityKey: "gb:london",
      photoEvidence: [],
      photoCount: 4,
      status: "accepted",
      start: day,
      localDay: day,
      dedupeKey: `p|${day}`,
      ...over,
    }) as PlaceEntry;
  const london: Place = {
    id: "pl-london",
    kind: "place",
    localityKey: "gb:london",
    locality: "London",
    region: "England",
    country: "United Kingdom",
    createdAt: "",
  };

  test("consecutive days at one place read as one visit with a date range", () => {
    const blocks = plain([pe("1", "2026-06-01"), pe("2", "2026-06-02")], ctx({ places: [london] }));
    expect(blocks).toEqual([
      { type: "dateLine", date: "2026-06-01", endDate: "2026-06-02" },
      { type: "heading", level: 4, text: "London" },
      { type: "paragraph", text: "England, United Kingdom" },
    ]);
  });

  test("a gap in days, or a different place, starts a new visit", () => {
    const paris = pe("3", "2026-06-05", { placeId: "pl-paris", localityKey: "fr:paris" });
    const blocks = plain(
      [pe("1", "2026-06-01"), pe("2", "2026-06-03"), paris],
      ctx({ places: [london] }),
    );
    expect(blocks.filter((b) => b.type === "dateLine")).toHaveLength(3);
  });

  test("without a Place record the name comes from the locality key", () => {
    const blocks = plain([
      pe("1", "2026-06-01", { localityKey: "it:porto-venere", placeId: "missing" }),
    ]);
    expect(blocks[1]).toMatchObject({ text: "Porto Venere" });
  });
});

describe("trip sections", () => {
  const trip = {
    id: TRIP_EUROPE.id,
    title: TRIP_EUROPE.title,
    start: "2026-05-15",
    end: "2026-05-20",
  };
  const withTrip = ctx({ trips: [{ ...TRIP_EUROPE, rating: 8, reflection: "A good week." }] });

  test("year chapter: heading, dates with rating, the trip reflection, then entries with Day N framing", () => {
    const book: Book = { ...fx.e.bookMay15, reflection: undefined, review: undefined };
    const leg: Leg = { ...fx.e.legMay17, reflection: undefined, review: undefined };
    const blocks = buildSectionBlocks("trip", trip, "year", [book, leg], withTrip);
    expect(blocks[0]).toEqual({ type: "heading", level: 3, text: "Berlin and Hamburg" });
    expect(blocks[1]).toEqual({ type: "paragraph", text: "15 May 2026 to 20 May 2026 · 8/10" });
    expect(blocks[2]).toEqual({ type: "paragraph", text: "A good week.", italic: true });
    const dates = blocks.filter((b) => b.type === "dateLine") as Extract<
      Block,
      { type: "dateLine" }
    >[];
    expect(dates.map((d) => d.label)).toEqual(["Day 1 of the journey", "Day 3 of the journey"]);
  });

  test("a table row carries its own date, so it gets no date line or Day label", () => {
    const blocks = buildSectionBlocks("trip", trip, "year", [fx.e.caribou], withTrip);
    expect(types(blocks)).not.toContain("dateLine");
  });

  test("trip chapter: no heading, since the chapter title is the trip", () => {
    const blocks = buildSectionBlocks("trip", trip, "trip", [fx.e.bookMay15], withTrip);
    expect(blocks.some((b) => b.type === "heading" && b.level === 3)).toBe(false);
    expect(blocks[0]).toMatchObject({ type: "paragraph" });
  });

  test("a trip crossing New Year prints its rating and reflection once, in the last chapter", () => {
    const xmas = { id: "x", title: "Ski week", start: "2025-12-29", end: "2026-01-03" };
    const c = ctx({
      trips: [
        {
          ...TRIP_EUROPE,
          id: "x",
          title: "Ski week",
          start: xmas.start,
          end: xmas.end,
          rating: 9,
          reflection: "Snow.",
        },
      ],
    });
    const dec: Leg = {
      ...fx.e.legMay17,
      id: "dec",
      dedupeKey: "dec",
      start: "2025-12-30T10:00",
      tripId: "x",
    };
    const jan: Leg = {
      ...fx.e.legMay17,
      id: "jan",
      dedupeKey: "jan",
      start: "2026-01-02T10:00",
      tripId: "x",
    };
    const first = buildSectionBlocks("trip", xmas, "year", [dec], c);
    const last = buildSectionBlocks("trip", xmas, "year", [jan], c);
    expect(JSON.stringify(first)).not.toContain("Snow.");
    expect(JSON.stringify(first)).not.toContain("9/10");
    expect(JSON.stringify(last)).toContain("Snow.");
    expect(JSON.stringify(last)).toContain("9/10");
  });
});

describe("what is never printed", () => {
  test("no ids, dedupe keys, source ids, or new/updated flags appear in blocks", () => {
    fx.e.caribou.unreviewed = "new";
    fx.e.bookJun22.unreviewed = "updated";
    const m = buildBookModel(
      fx.data,
      { title: "T", start: "2000-01-01", end: "2100-01-01", chapterMode: "year" } as BookDefinition,
      { generatedOn: "2026-10-22" },
    );
    const text = JSON.stringify(m.chapters.flatMap((c) => c.sections.flatMap((s) => s.blocks)));
    for (const e of [...fx.data.legs, ...fx.data.events, ...fx.data.books, ...fx.data.stays]) {
      expect(text).not.toContain(e.id);
      expect(text).not.toContain(e.dedupeKey);
    }
    expect(text).not.toContain("unreviewed");
    expect(text).not.toContain('"new"');
    expect(text).not.toContain("updated");
  });

  test("a repeated date line on the same day is not printed twice", () => {
    const b1: Book = {
      ...fx.e.bookJun22,
      id: "1",
      dedupeKey: "1",
      start: "2026-06-22",
      review: undefined,
      reflection: undefined,
    };
    const b2: Book = { ...b1, id: "2", dedupeKey: "2" };
    expect(plain([b1, b2]).filter((b) => b.type === "dateLine")).toHaveLength(1);
  });
});

describe("the whole model", () => {
  test("a full book from importer fixtures maps every entry without error, in both modes", () => {
    for (const chapterMode of ["year", "trip"] as const) {
      const m = buildBookModel(
        fx.data,
        { title: "T", start: "2000-01-01", end: "2100-01-01", chapterMode },
        { generatedOn: "2026-10-22" },
      );
      const blocks = m.chapters.flatMap((c) => c.sections.flatMap((s) => s.blocks));
      expect(blocks.length).toBeGreaterThan(30);
      // Trip chapters carry no repeated trip heading in trip mode.
      if (chapterMode === "trip") {
        for (const c of m.chapters.filter((c) => c.kind === "trip"))
          expect(c.sections[0].blocks.some((b) => b.type === "heading" && b.level === 3)).toBe(
            false,
          );
      }
    }
  });
});
