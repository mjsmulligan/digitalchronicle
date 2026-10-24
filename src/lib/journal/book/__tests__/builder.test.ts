/**
 * WP6 of docs/specs/book-export.md: pure builder logic.
 */
import { beforeEach, describe, expect, test } from "vitest";
import {
  bookFileBase,
  buildBookModel,
  buildReviewList,
  defaultDefinition,
  estimatePages,
  journalYears,
  validateDefinition,
  type BookDefinition,
} from "..";
import { makeSpikeJournal } from "../spike";
import { makeFixture, type Fixture } from "./fixtures";

let fx: Fixture;
beforeEach(async () => {
  fx = await makeFixture();
});

const def = (over: Partial<BookDefinition> = {}): BookDefinition => ({
  title: "Our 2026",
  start: "2026-01-01",
  end: "2026-12-31",
  chapterMode: "year",
  ...over,
});

describe("defaults and validation", () => {
  test("journalYears lists years with entries, oldest first", () => {
    expect(journalYears(fx.data)).toEqual(["2010", "2026"]);
  });

  test("default definition is the latest year with entries", () => {
    expect(defaultDefinition(fx.data, "2026-10-24")).toMatchObject({
      title: "My 2026",
      start: "2026-01-01",
      end: "2026-12-31",
      chapterMode: "year",
      pageSize: "A4",
    });
  });

  test("an empty journal defaults to the current year", () => {
    const empty = {
      ...fx.data,
      legs: [],
      stays: [],
      events: [],
      books: [],
      films: [],
      episodes: [],
    };
    expect(defaultDefinition(empty, "2026-10-24").start).toBe("2026-01-01");
  });

  test("validation", () => {
    expect(validateDefinition(def())).toEqual([]);
    expect(validateDefinition(def({ title: "  " }))).toHaveLength(1);
    expect(validateDefinition(def({ start: "2026-13-01" }))).toHaveLength(1);
    expect(validateDefinition(def({ end: "2026/12/31" }))).toHaveLength(1);
    expect(validateDefinition(def({ start: "2026-05-01", end: "2026-04-01" }))).toEqual([
      "The start date is after the end date.",
    ]);
    expect(validateDefinition(def({ start: "2026-02-30" }))).toHaveLength(1);
  });

  test("file base name is a safe slug", () => {
    expect(bookFileBase(def({ title: "Our 2026: Café & Co!" }))).toBe("our-2026-cafe-co");
    expect(bookFileBase(def({ title: "???" }))).toBe("book");
  });
});

describe("review list", () => {
  test("groups like the book and flags exclusions without dropping them", () => {
    const gone = fx.e.fontaines.id;
    const list = buildReviewList(fx.data, def({ excludedEntryIds: [gone] }));
    expect(list.map((c) => c.title)).toEqual(["2026"]);
    const all = list.flatMap((c) => c.entries);
    expect(all.find((e) => e.id === gone)).toMatchObject({
      excluded: true,
      label: "Fontaines D.C.",
    });
    expect(all.filter((e) => e.excluded)).toHaveLength(1);
    expect(all.length).toBe(
      buildBookModel(fx.data, def(), { generatedOn: "2026-10-24" }).stats.entryCount,
    );
  });

  test("labels read naturally for each kind", () => {
    const labels = buildReviewList(fx.data, def()).flatMap((c) => c.entries.map((e) => e.label));
    expect(labels).toContain("Berlin Hbf to Hamburg Hbf");
    expect(labels).toContain("Hotel Arts Barcelona");
    expect(labels).toContain("Land");
  });

  test("trip mode shows trip and gap chapters", () => {
    const list = buildReviewList(fx.data, def({ chapterMode: "trip" }));
    expect(list.map((c) => c.title)).toContain("Japan");
  });
});

describe("page estimate", () => {
  // Reference: real renderer output (html.ts) printed by desktop Chromium.
  const ACTUAL: { n: number; mode: "year" | "trip"; size: "A4" | "A5"; pages: number }[] = [
    { n: 400, mode: "year", size: "A4", pages: 54 },
    { n: 400, mode: "year", size: "A5", pages: 85 },
    { n: 800, mode: "year", size: "A4", pages: 105 },
    { n: 800, mode: "year", size: "A5", pages: 166 },
    { n: 800, mode: "trip", size: "A4", pages: 229 },
    { n: 800, mode: "trip", size: "A5", pages: 276 },
  ];

  test.each(ACTUAL)("within 20 percent of the real PDF: $n entries, $mode, $size", (c) => {
    const data = makeSpikeJournal({ entryCount: c.n });
    const model = buildBookModel(
      data,
      { title: "Cal", start: "2000-01-01", end: "2100-01-01", chapterMode: c.mode },
      { generatedOn: "2026-10-24" },
    );
    const est = estimatePages(model, c.size);
    expect(est).toBeGreaterThan(c.pages * 0.8);
    expect(est).toBeLessThan(c.pages * 1.2);
  });

  test("A5 needs more pages than A4; an empty book is just front matter", () => {
    const model = buildBookModel(fx.data, def(), { generatedOn: "2026-10-24" });
    expect(estimatePages(model, "A5")).toBeGreaterThan(estimatePages(model, "A4"));
    const empty = buildBookModel(fx.data, def({ start: "1990-01-01", end: "1990-12-31" }), {
      generatedOn: "2026-10-24",
    });
    expect(estimatePages(empty, "A4")).toBe(4);
  });
});
