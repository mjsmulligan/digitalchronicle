/**
 * WP1 of docs/specs/book-export.md: BookModel selection and grouping.
 * Entries come from the real importers (see fixtures.ts).
 */
import { describe, test, expect, beforeEach } from "vitest";
import { buildBookModel, selectBookEntries, sourcesUsed, type BookDefinition } from "..";
import type { JournalData, PlaceEntry } from "../../types";
import {
  FRIEND,
  SELF,
  TRIP_EUROPE,
  TRIP_JAPAN,
  makeFixture,
  printOrder,
  type Fixture,
} from "./fixtures";

const OPTS = { generatedOn: "2026-10-22" };
const def = (over: Partial<BookDefinition> = {}): BookDefinition => ({
  title: "Test Book",
  start: "2000-01-01",
  end: "2030-12-31",
  chapterMode: "year",
  ...over,
});

let fx: Fixture;
let data: JournalData;
beforeEach(async () => {
  fx = await makeFixture();
  data = fx.data;
});

describe("year mode", () => {
  test("one chapter per year, oldest first, titled by year", () => {
    const m = buildBookModel(data, def(), OPTS);
    expect(m.chapters.map((c) => [c.id, c.kind, c.title])).toEqual([
      ["year-2010", "year", "2010"],
      ["year-2026", "year", "2026"],
    ]);
    expect(m.chapters[0].dateRange).toEqual({ start: "2010-12-15", end: "2010-12-15" });
    expect(m.chapters[1].dateRange).toEqual({ start: "2026-03-14", end: "2026-09-09" });
  });

  test("trips become sections; unlinked entries form plain runs around them", () => {
    const { e } = fx;
    const m = buildBookModel(data, def(), OPTS);
    const sections = m.chapters[1].sections;
    expect(sections.map((s) => [s.kind, s.title ?? null])).toEqual([
      ["plain", null],
      ["trip", "Berlin and Hamburg"],
      ["plain", null],
      ["trip", "Japan"],
      ["plain", null],
    ]);
    // Trip entries stay together, in date order, even with an unlinked book on 15 May.
    expect(sections[1].entryIds).toEqual([
      e.caribou.id,
      e.legMay17.id,
      e.kraftwerk.id,
      e.legMay19.id,
    ]);
    expect(sections[3].entryIds).toEqual([e.legAug6.id, e.japanConcert.id, e.legAug9.id]);
    // An unlinked entry dated inside a trip never splits it.
    expect(sections[0].entryIds).toEqual([e.fontaines.id, e.bookMay15.id]);
    expect(sections[2].entryIds).toEqual([
      e.hotel.id,
      e.bookJun22.id,
      e.birthday.id,
      e.bookAug6.id,
    ]);
    expect(sections[4].entryIds).toEqual([e.drinks.id, e.bookSep9.id]);
  });

  test("trip sections carry whole-trip dates for the Day N framing", () => {
    const m = buildBookModel(data, def(), OPTS);
    const trip = m.chapters[1].sections[1].trip;
    expect(trip).toEqual({
      id: TRIP_EUROPE.id,
      title: TRIP_EUROPE.title,
      start: "2026-05-15",
      end: "2026-05-20",
    });
  });

  test("a trip that crosses New Year appears in both year chapters", () => {
    const { e } = fx;
    const a = {
      ...e.legMay17,
      id: "dec",
      dedupeKey: "leg|dec",
      start: "2025-12-30T10:00",
      tripId: "trip-xmas",
    };
    const b = {
      ...e.legMay17,
      id: "jan",
      dedupeKey: "leg|jan",
      start: "2026-01-02T10:00",
      tripId: "trip-xmas",
    };
    data.legs.push(a, b);
    data.trips.push({
      id: "trip-xmas",
      title: "Ski week",
      start: "2025-12-29",
      end: "2026-01-03",
      cover: "",
      createdAt: "",
    });
    const m = buildBookModel(data, def({ start: "2025-01-01", end: "2026-12-31" }), OPTS);
    expect(m.chapters.map((c) => c.title)).toEqual(["2025", "2026"]);
    const [y25, y26] = m.chapters;
    expect(y25.sections).toHaveLength(1);
    expect(y25.sections[0].entryIds).toEqual(["dec"]);
    expect(y25.sections[0].trip?.title).toBe("Ski week");
    expect(y26.sections[0].entryIds).toEqual(["jan"]);
    expect(y26.sections[0].trip?.start).toBe("2025-12-29");
  });

  test("an entry whose trip id matches no trip is treated as unlinked", () => {
    fx.e.caribou.tripId = "trip-deleted";
    const m = buildBookModel(data, def({ start: "2026-05-15", end: "2026-05-15" }), OPTS);
    expect(m.chapters[0].sections.map((s) => s.kind)).toEqual(["plain"]);
    expect(m.stats.entryCount).toBe(2);
  });
});

describe("trip mode", () => {
  const tripDef = (over: Partial<BookDefinition> = {}) => def({ chapterMode: "trip", ...over });

  test("one chronological sequence: gap, trip, gap, trip, gap", () => {
    const m = buildBookModel(data, tripDef(), OPTS);
    expect(m.chapters.map((c) => [c.kind, c.title])).toEqual([
      ["gap", "December 2010"],
      ["gap", "March to May 2026"],
      ["trip", "Berlin and Hamburg"],
      ["gap", "June to August 2026"],
      ["trip", "Japan"],
      ["gap", "August to September 2026"],
    ]);
  });

  test("gap chapters never span two years", () => {
    const m = buildBookModel(data, tripDef(), OPTS);
    for (const c of m.chapters.filter((c) => c.kind === "gap")) {
      expect(c.dateRange.start.slice(0, 4)).toBe(c.dateRange.end.slice(0, 4));
    }
    // 2010 book and the first 2026 entries sit in separate gap chapters.
    expect(m.chapters[0].sections[0].entryIds).toEqual([fx.e.book2010.id]);
  });

  test("trip chapters hold one trip section in date order; ids are stable", () => {
    const m = buildBookModel(data, tripDef(), OPTS);
    const europe = m.chapters.find((c) => c.id === `trip-${TRIP_EUROPE.id}`)!;
    expect(europe.sections).toHaveLength(1);
    expect(europe.sections[0].kind).toBe("trip");
    expect(europe.dateRange).toEqual({ start: "2026-05-15", end: "2026-05-19" });
    expect(m.chapters.find((c) => c.id === `trip-${TRIP_JAPAN.id}`)).toBeDefined();
    expect(m.chapters.filter((c) => c.kind === "gap").map((c) => c.id)).toEqual([
      "gap-2010-12-15",
      "gap-2026-03-14",
      "gap-2026-06-01",
      "gap-2026-08-20",
    ]);
  });

  test("a trip clipped by the date range keeps only the entries inside it", () => {
    const m = buildBookModel(data, tripDef({ start: "2026-05-18", end: "2026-05-31" }), OPTS);
    const europe = m.chapters.find((c) => c.kind === "trip")!;
    expect(europe.sections[0].entryIds).toEqual([fx.e.kraftwerk.id, fx.e.legMay19.id]);
    expect(europe.dateRange).toEqual({ start: "2026-05-18", end: "2026-05-19" });
  });
});

describe("every entry appears exactly once", () => {
  test.each(["year", "trip"] as const)("%s mode", (mode) => {
    const m = buildBookModel(data, def({ chapterMode: mode }), OPTS);
    const ids = printOrder(m);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(16);
    expect(m.stats).toEqual({ entryCount: 16, excludedCount: 0 });
  });

  test("chapters run in date order in both modes", () => {
    for (const mode of ["year", "trip"] as const) {
      const m = buildBookModel(data, def({ chapterMode: mode }), OPTS);
      const starts = m.chapters.map((c) => c.dateRange.start);
      expect(starts).toEqual([...starts].sort());
      expect(starts[0]).toBe("2010-12-15");
      expect(m.chapters[m.chapters.length - 1].dateRange.end).toBe("2026-09-09");
    }
  });
});

describe("selection", () => {
  test("date range is inclusive at both ends", () => {
    const sel = selectBookEntries(data, def({ start: "2026-05-15", end: "2026-05-18" }));
    expect(sel.map((x) => x.id).sort()).toEqual(
      [fx.e.caribou.id, fx.e.bookMay15.id, fx.e.legMay17.id, fx.e.kraftwerk.id].sort(),
    );
  });

  test("kind filter matches the feed: travel is legs and stays", () => {
    const sel = selectBookEntries(data, def({ filter: "travel" }));
    expect(sel.every((x) => x.kind === "leg" || x.kind === "stay")).toBe(true);
    expect(sel).toHaveLength(5);
  });

  test("book filter", () => {
    expect(selectBookEntries(data, def({ filter: "book" }))).toHaveLength(5);
  });

  test("concert filter returns concert events only", () => {
    const sel = selectBookEntries(data, def({ filter: "concert" }));
    expect(sel.length).toBeGreaterThanOrEqual(3);
    expect(sel.every((x) => x.kind === "event" && x.category === "concert")).toBe(true);
    expect(sel.map((x) => x.id)).toContain(fx.e.caribou.id);
  });

  test("trip filter", () => {
    const sel = selectBookEntries(data, def({ tripId: TRIP_JAPAN.id }));
    expect(sel.map((x) => x.id)).toEqual([fx.e.legAug6.id, fx.e.japanConcert.id, fx.e.legAug9.id]);
  });

  test("person filter: a named person matches only entries listing them", () => {
    fx.e.kraftwerk.participants = [SELF.id, FRIEND.id];
    const sel = selectBookEntries(data, def({ personId: FRIEND.id }));
    expect(sel.map((x) => x.id)).toEqual([fx.e.kraftwerk.id]);
  });

  test("person filter: self is implicitly present when participants is absent", () => {
    fx.e.kraftwerk.participants = [FRIEND.id]; // self explicitly absent
    const sel = selectBookEntries(data, def({ personId: SELF.id }));
    expect(sel).toHaveLength(15);
    expect(sel.map((x) => x.id)).not.toContain(fx.e.kraftwerk.id);
  });

  test("an unknown person id matches nothing rather than ignoring the filter", () => {
    expect(selectBookEntries(data, def({ personId: "nobody" }))).toEqual([]);
  });

  test("hidden entries never appear", () => {
    fx.e.caribou.hidden = true;
    expect(printOrder(buildBookModel(data, def(), OPTS))).not.toContain(fx.e.caribou.id);
  });

  test("only accepted place entries appear", () => {
    const mk = (id: string, status: PlaceEntry["status"], d: string): PlaceEntry => ({
      id,
      kind: "place-entry",
      source: "photo-library",
      createdAt: "",
      placeId: "pl1",
      localityKey: "gb:london",
      photoEvidence: [],
      photoCount: 3,
      status,
      start: d,
      localDay: d,
      dedupeKey: `place-entry|gb:london|${d}`,
    });
    data.placeEntries = [
      mk("accepted", "accepted", "2026-04-01"),
      mk("pending", "pending", "2026-04-02"),
      mk("dismissed", "dismissed", "2026-04-03"),
    ];
    const ids = printOrder(buildBookModel(data, def(), OPTS));
    expect(ids).toContain("accepted");
    expect(ids).not.toContain("pending");
    expect(ids).not.toContain("dismissed");
  });

  test("the unreviewed flag does not affect inclusion", () => {
    fx.e.caribou.unreviewed = "new";
    expect(printOrder(buildBookModel(data, def(), OPTS))).toContain(fx.e.caribou.id);
  });

  test("user date overrides move an entry to its corrected day", () => {
    fx.e.bookJun22.overrides = { start: "2025-02-03" };
    const m = buildBookModel(data, def(), OPTS);
    expect(m.chapters.map((c) => c.title)).toEqual(["2010", "2025", "2026"]);
    expect(m.chapters[1].sections[0].entryIds).toEqual([fx.e.bookJun22.id]);
  });
});

describe("exclusions", () => {
  test("excluded entries are removed from the book but stay selectable and in the data", () => {
    const excluded = [fx.e.caribou.id, fx.e.bookSep9.id];
    const m = buildBookModel(data, def({ excludedEntryIds: excluded }), OPTS);
    const ids = printOrder(m);
    for (const id of excluded) expect(ids).not.toContain(id);
    expect(m.stats).toEqual({ entryCount: 14, excludedCount: 2 });
    // The review list still sees them.
    const candidates = selectBookEntries(data, def({ excludedEntryIds: excluded })).map(
      (x) => x.id,
    );
    for (const id of excluded) expect(candidates).toContain(id);
    expect(data.events).toContain(fx.e.caribou);
  });

  test("excluding every entry of a trip removes its section; excluding all removes chapters", () => {
    const tripIds = [fx.e.legAug6.id, fx.e.legAug9.id, fx.e.japanConcert.id];
    const m = buildBookModel(data, def({ excludedEntryIds: tripIds }), OPTS);
    expect(m.chapters[1].sections.some((s) => s.title === "Japan")).toBe(false);

    const all = selectBookEntries(data, def()).map((x) => x.id);
    const empty = buildBookModel(data, def({ excludedEntryIds: all }), OPTS);
    expect(empty.chapters).toEqual([]);
    expect(empty.stats).toEqual({ entryCount: 0, excludedCount: 16 });
  });

  test("excluded ids that match nothing are ignored and not counted", () => {
    const m = buildBookModel(data, def({ excludedEntryIds: ["does-not-exist"] }), OPTS);
    expect(m.stats).toEqual({ entryCount: 16, excludedCount: 0 });
  });
});

describe("sources list", () => {
  test("display names, sorted, only for sources actually used", () => {
    const m = buildBookModel(data, def(), OPTS);
    expect(m.meta.sources).toEqual(["Calendar", "Goodreads", "setlist.fm", "viaduct.world"]);
  });

  test("a source with no included entries is left out", () => {
    const m = buildBookModel(data, def({ filter: "travel" }), OPTS);
    expect(m.meta.sources).toEqual(["Calendar", "viaduct.world"]);
  });

  test("additional sources count; manual and duplicates do not", () => {
    fx.e.hotel.additionalSources = [{ source: "photo-library" }, { source: "viaduct" }];
    fx.e.birthday.source = "manual";
    expect(sourcesUsed([fx.e.hotel, fx.e.birthday, fx.e.legMay17])).toEqual([
      "Calendar",
      "Photo library",
      "viaduct.world",
    ]);
  });

  test("an unknown connector id falls back to the id", () => {
    fx.e.hotel.source = "mystery-source";
    expect(sourcesUsed([fx.e.hotel])).toEqual(["mystery-source"]);
  });
});

describe("model shape", () => {
  test("meta carries the definition and caller inputs; optional keys are omitted when unset", () => {
    const m = buildBookModel(
      data,
      def({ subtitle: "Sub", dedication: "For Maia", coverMediaId: "media-1" }),
      { generatedOn: "2026-10-22", language: "en-IE" },
    );
    expect(m.meta).toMatchObject({
      title: "Test Book",
      subtitle: "Sub",
      dedication: "For Maia",
      language: "en-IE",
      dateRange: { start: "2000-01-01", end: "2030-12-31" },
      chapterMode: "year",
      generatedOn: "2026-10-22",
      coverMediaId: "media-1",
    });
    const bare = buildBookModel(data, def(), OPTS);
    expect(Object.keys(bare.meta)).not.toContain("subtitle");
    expect(Object.keys(bare.meta)).not.toContain("coverMediaId");
    expect(bare.meta.language).toBe("en");
  });

  test("every section has blocks and the model is plain JSON", () => {
    const m = buildBookModel(data, def(), OPTS);
    for (const c of m.chapters)
      for (const s of c.sections) expect(s.blocks.length).toBeGreaterThan(0);
    expect(JSON.parse(JSON.stringify(m))).toEqual(m);
  });

  test("no matching entries gives an empty book, not an error", () => {
    const m = buildBookModel(data, def({ start: "1990-01-01", end: "1990-12-31" }), OPTS);
    expect(m.chapters).toEqual([]);
    expect(m.stats).toEqual({ entryCount: 0, excludedCount: 0 });
    expect(m.meta.sources).toEqual([]);
  });
});

describe("determinism", () => {
  test.each(["year", "trip"] as const)(
    "%s mode: same input gives the same model, whatever the store order",
    (mode) => {
      const d = def({ chapterMode: mode });
      const a = buildBookModel(data, d, OPTS);
      const reversed: JournalData = {
        ...data,
        legs: [...data.legs].reverse(),
        stays: [...data.stays].reverse(),
        events: [...data.events].reverse(),
        books: [...data.books].reverse(),
        trips: [...data.trips].reverse(),
      };
      expect(buildBookModel(reversed, d, OPTS)).toEqual(a);
      expect(buildBookModel(data, d, OPTS)).toEqual(a);
    },
  );

  test("entries sharing a start sort by dedupeKey then id", () => {
    const x = { ...fx.e.legMay17, id: "b", dedupeKey: "leg|same" };
    const y = { ...fx.e.legMay17, id: "a", dedupeKey: "leg|same" };
    const z = { ...fx.e.legMay17, id: "c", dedupeKey: "leg|aaa" };
    data.legs = [x, y, z];
    data.stays = [];
    data.events = [];
    data.books = [];
    const ids = printOrder(
      buildBookModel(data, def({ start: "2026-05-17", end: "2026-05-17" }), OPTS),
    );
    expect(ids).toEqual(["c", "a", "b"]);
  });
});
