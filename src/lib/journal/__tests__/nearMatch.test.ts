/**
 * WP5 of docs/specs/merge-dedup.md: near-match detection (section 4.6).
 * Part 1 tests findNearMatches per kind. Part 2 runs the real import pipeline.
 */
import { describe, test, expect, beforeEach, vi } from "vitest";

vi.mock("../artworkEnrichment", () => ({ enrichAll: vi.fn(async () => {}) }));

import { buildNearIndex, clearDuplicateFlag, findNearMatches } from "../nearMatch";
import { importFile } from "../import";
import {
  setAdapter, initJournal, getState, allEntries, putMany, mergeManual, markNotDuplicate,
} from "../db";
import type { StorageAdapter, Row } from "../storage";
import {
  STORES, emptyJournalData, type JournalData, type StoreName, type Entry, type Book, type Episode, type Film,
  type JEvent, type Leg, type Stay,
} from "../types";

// ─── Fixtures ────────────────────────────────────────────────────────────────

let n = 0;
const base = (kind: Entry["kind"], source: string) => {
  n += 1;
  return { id: `e${n}`, kind, source, createdAt: "2026-01-01T00:00:00.000Z", dedupeKey: `${kind}|${n}` };
};
const leg = (o: Partial<Leg> = {}): Leg => ({
  ...base("leg", "viaduct"), kind: "leg", mode: "air", from: "DUB", to: "LHR", start: "2026-10-15T09:00", ...o,
} as Leg);
const stay = (o: Partial<Stay> = {}): Stay => ({
  ...base("stay", "booking"), kind: "stay", place: "Hotel Le Marianne", city: "Paris", start: "2026-10-12", end: "2026-10-14", ...o,
} as Stay);
const event = (o: Partial<JEvent> = {}): JEvent => ({
  ...base("event", "setlistfm"), kind: "event", category: "concert", artist: "Ed Sheeran", venue: "Croke Park", city: "Dublin",
  start: "2026-07-25", ...o,
} as JEvent);
const film = (o: Partial<Film> = {}): Film => ({
  ...base("film", "letterboxd"), kind: "film", title: "The Bear", start: "2026-05-01", ...o,
} as Film);
const episode = (o: Partial<Episode> = {}): Episode => ({
  ...base("episode", "netflix"), kind: "episode", showTitle: "The Bear", season: "Season 2", episodeTitle: "Pop", start: "2026-05-01", ...o,
} as Episode);
const book = (o: Partial<Book> = {}): Book => ({
  ...base("book", "goodreads"), kind: "book", title: "Dune", author: "Frank Herbert", start: "2026-05-01", ...o,
} as Book);

const near = (entry: Entry, existing: Entry[]) => findNearMatches(entry, buildNearIndex(existing));
const ids = (entry: Entry, existing: Entry[]) => near(entry, existing).map((m) => m.id);

// ─── Part 1: findNearMatches ─────────────────────────────────────────────────

describe("legs", () => {
  test("a leg without codes matches another leg of the same mode that day", () => {
    const existing = leg({ id: "x" });
    expect(near(leg({ from: "", to: "Paris" }), [existing])).toEqual([{ id: "x", reason: "route not known on one side", score: 1 }]);
    expect(ids(leg({ from: "DUB", to: "" }), [existing])).toEqual(["x"]);
  });

  test("the same service number matches, a different one never does", () => {
    const existing = leg({ id: "x", flightNumber: "EI154", from: "DUB", to: "LHR" });
    expect(near(leg({ from: "DUB", to: "STN", flightNumber: "EI154" }), [existing])[0]).toMatchObject({ id: "x", reason: "same service number" });
    expect(ids(leg({ from: "", to: "", flightNumber: "EI999" }), [existing])).toEqual([]);
  });

  test("a different mode, day or fully known different route does not match", () => {
    const existing = leg({ id: "x" });
    expect(ids(leg({ from: "", mode: "rail" }), [existing])).toEqual([]);
    expect(ids(leg({ from: "", start: "2026-10-16T09:00" }), [existing])).toEqual([]);
    expect(ids(leg({ from: "BER", to: "MUC" }), [existing])).toEqual([]);
  });

  test("train numbers count the same way as flight numbers", () => {
    const existing = leg({ id: "x", mode: "rail", from: "Berlin Hbf", to: "Hamburg Hbf", trainNumber: "ICE 703" });
    expect(near(leg({ mode: "rail", from: "", to: "", trainNumber: "ice703" }), [existing])).toHaveLength(0); // "ice-703" differs from "ice703"
    expect(ids(leg({ mode: "rail", from: "", to: "", trainNumber: "ICE 703" }), [existing])).toEqual(["x"]);
  });
});

describe("stays", () => {
  test("overlapping dates and a shared significant word match, accents and filler words aside", () => {
    const existing = stay({ id: "x" });
    expect(near(stay({ place: "Hôtel Marianne" }), [existing])[0]).toMatchObject({ id: "x", reason: "overlapping dates, similar name" });
    expect(ids(stay({ place: "Marianne Paris", city: "" }), [existing])).toEqual(["x"]);
  });

  test("overlapping dates in the same city match even under a different name", () => {
    expect(near(stay({ place: "Booking 1234" }), [stay({ id: "x" })])[0]).toMatchObject({ id: "x", reason: "overlapping dates, same city" });
  });

  test("different name and different city does not match, nor does a stay on other nights", () => {
    expect(ids(stay({ place: "Ibis Lyon", city: "Lyon" }), [stay({ id: "x" })])).toEqual([]);
    expect(ids(stay({ start: "2026-10-20", end: "2026-10-22" }), [stay({ id: "x" })])).toEqual([]);
  });

  test("back-to-back stays do not overlap: the check-out day is free", () => {
    expect(ids(stay({ start: "2026-10-14", end: "2026-10-16" }), [stay({ id: "x" })])).toEqual([]);
    expect(ids(stay({ start: "2026-10-13", end: "2026-10-16" }), [stay({ id: "x" })])).toEqual(["x"]);
  });

  test("a stay with no end counts as one night", () => {
    expect(ids(stay({ end: undefined, start: "2026-10-13" }), [stay({ id: "x" })])).toEqual(["x"]);
    expect(ids(stay({ end: undefined, start: "2026-10-14" }), [stay({ id: "x" })])).toEqual([]);
  });
});

describe("events", () => {
  test("a title that contains the other on the same day matches", () => {
    const existing = event({ id: "x" });
    expect(near(event({ artist: "Ed Sheeran Mathematics Tour", venue: "" }), [existing])[0]).toMatchObject({ id: "x", reason: "same day, similar title" });
    expect(ids(event({ artist: "ed sheeran", venue: "" }), [existing])).toEqual(["x"]);
  });

  test("the same venue on the same day matches weakly", () => {
    expect(near(event({ artist: "Gig night" }), [event({ id: "x" })])).toEqual([{ id: "x", reason: "same day, same venue", score: 1 }]);
  });

  test("words are compared whole, and short titles do not match by accident", () => {
    expect(ids(event({ artist: "Art", venue: "" }), [event({ id: "x", artist: "Party" })])).toEqual([]);
    expect(ids(event({ artist: "Go", venue: "" }), [event({ id: "x", artist: "Go home" })])).toEqual([]);
  });

  test("a different day does not match", () => {
    expect(ids(event({ start: "2026-07-26" }), [event({ id: "x" })])).toEqual([]);
  });
});

describe("films, episodes and books", () => {
  test("the same title a day either side matches, two days apart does not", () => {
    const existing = film({ id: "x", start: "2026-05-01" });
    expect(ids(film({ start: "2026-05-02" }), [existing])).toEqual(["x"]);
    expect(ids(film({ start: "2026-04-30" }), [existing])).toEqual(["x"]);
    expect(ids(film({ start: "2026-05-03" }), [existing])).toEqual([]);
  });

  test("the year must agree only when both have one", () => {
    const existing = film({ id: "x", year: 2022 });
    expect(ids(film({ year: 2022 }), [existing])).toEqual(["x"]);
    expect(ids(film({ year: undefined }), [existing])).toEqual(["x"]);
    expect(ids(film({ year: 2023 }), [existing])).toEqual([]);
  });

  test("punctuation and accents do not matter in a title", () => {
    expect(ids(film({ title: "Amélie" }), [film({ id: "x", title: "Amelie" })])).toEqual(["x"]);
  });

  test("an episode needs the same show, and the same episode title and season where both give one", () => {
    const existing = episode({ id: "x" });
    expect(ids(episode({ start: "2026-05-02" }), [existing])).toEqual(["x"]);
    expect(ids(episode({ episodeTitle: "Sundae" }), [existing])).toEqual([]);
    expect(ids(episode({ season: "Season 3" }), [existing])).toEqual([]);
    expect(ids(episode({ episodeTitle: undefined, season: undefined }), [existing])).toEqual(["x"]);
  });

  test("a book needs the same title, and the same year where both give one", () => {
    expect(ids(book({ start: "2026-05-02" }), [book({ id: "x" })])).toEqual(["x"]);
    expect(ids(book({ title: "Dune Messiah" }), [book({ id: "x" })])).toEqual([]);
    expect(ids(book({ year: 1965 }), [book({ id: "x", year: 1984 })])).toEqual([]);
  });
});

describe("what is never a near match", () => {
  test("entries of another kind", () => {
    expect(ids(event({ artist: "The Bear" }), [film({ id: "x" })])).toEqual([]);
    expect(ids(stay({ place: "Dublin" }), [leg({ id: "x" })])).toEqual([]);
  });

  test("hidden entries and the entry itself", () => {
    const hidden = leg({ id: "x", hidden: true });
    expect(ids(leg({ from: "" }), [hidden])).toEqual([]);
    const self = leg({ id: "x" });
    expect(ids(self, [self])).toEqual([]);
  });

  test("place entries, and entries without a usable date", () => {
    const place = { ...base("place-entry", "photos"), kind: "place-entry", localityKey: "gb:london", localDay: "2026-10-15", start: "2026-10-15" } as unknown as Entry;
    expect(ids(place, [place, { ...place, id: "other" } as Entry])).toEqual([]);
    expect(ids(leg({ from: "", start: "someday" }), [leg({ id: "x" })])).toEqual([]);
  });

  test("a pair the user marked not a duplicate, whichever side carries the mark", () => {
    const x = leg({ id: "x" });
    const a = leg({ id: "a", from: "", notDuplicateOf: ["x"] });
    expect(ids(a, [x])).toEqual([]);
    const b = leg({ id: "b", from: "" });
    expect(ids(b, [{ ...x, notDuplicateOf: ["b"] }])).toEqual([]);
    expect(ids(b, [x])).toEqual(["x"]);
  });
});

describe("ordering", () => {
  test("the strongest reason comes first, then the nearest day", () => {
    const weak = event({ id: "weak", artist: "Gig night" });
    const strong = event({ id: "strong", artist: "Ed Sheeran" });
    expect(ids(event({ artist: "Ed Sheeran" }), [weak, strong])).toEqual(["strong", "weak"]);
    const far = film({ id: "far", start: "2026-05-02" });
    const close = film({ id: "close", start: "2026-05-01" });
    expect(ids(film({ start: "2026-05-01" }), [far, close])).toEqual(["close", "far"]);
  });
});

describe("a field the user corrected counts", () => {
  test("overrides are compared, not the original source value", () => {
    const existing = leg({ id: "x", from: "XXX", to: "YYY", overrides: { from: "DUB", to: "LHR" } as Leg["overrides"] });
    expect(ids(leg({ from: "DUB", to: "LHR", flightNumber: "EI1" }), [existing])).toEqual(["x"]);
  });
});

describe("clearDuplicateFlag", () => {
  test("removes the link and only the duplicate note", () => {
    const e = leg({ possibleDuplicateOf: "x", importNotes: ['Possible duplicate of "DUB → LHR"', "No city detected"] });
    const cleared = clearDuplicateFlag(e);
    expect(cleared.possibleDuplicateOf).toBeUndefined();
    expect(cleared.importNotes).toEqual(["No city detected"]);
    expect(clearDuplicateFlag(leg({ possibleDuplicateOf: "x", importNotes: ['Possible duplicate of "A"'] })).importNotes).toBeUndefined();
  });

  test("leaves the entry alone when the link points elsewhere", () => {
    const e = leg({ possibleDuplicateOf: "x" });
    expect(clearDuplicateFlag(e, "y")).toBe(e);
  });
});

// ─── Part 2: the import pipeline ─────────────────────────────────────────────

class MemoryAdapter implements StorageAdapter {
  private data = new Map<string, Map<string, Row>>();
  private table(store: string) {
    if (!this.data.has(store)) this.data.set(store, new Map());
    return this.data.get(store)!;
  }
  async getAll<T extends Row>(store: StoreName): Promise<T[]> {
    return structuredClone([...this.table(store).values()]) as T[];
  }
  async putMany<T extends Row>(store: StoreName, items: T[]): Promise<void> {
    for (const i of items) this.table(store).set(i.id, structuredClone(i));
  }
  async removeMany(store: StoreName, ids: string[]): Promise<void> {
    for (const id of ids) this.table(store).delete(id);
  }
  async replaceAll(d: JournalData): Promise<void> {
    this.data.clear();
    for (const s of STORES) for (const r of (d[s] ?? []) as Row[]) this.table(s).set(r.id, structuredClone(r));
  }
  async clearAll(): Promise<void> {
    await this.replaceAll(emptyJournalData());
  }
}

describe("importFile and near matches", () => {
  beforeEach(async () => {
    setAdapter(new MemoryAdapter());
    await initJournal();
  });

  const stays = () => getState().stays;
  const header = "type,start,end,place,city,notes";
  const row = (place: string, city = "Paris") => `stay,2026-10-12,2026-10-14,${place},${city},`;
  const csv = (...rows: string[]) => [header, ...rows].join("\n");

  async function seedBookingStay() {
    await putMany("stays", [stay({ id: "booking-stay", dedupeKey: "stay|2026-10-12|hotel-le-marianne" })]);
  }

  test("a stay under another name is imported as new, linked to the candidate with a note", async () => {
    await seedBookingStay();
    const res = await importFile("cal.csv", csv(row("Marianne Paris")), { forced: "generic" });
    expect(res.added).toBe(1);
    expect(stays()).toHaveLength(2);
    const added = stays().find((s) => s.id !== "booking-stay")!;
    expect(added.unreviewed).toBe("new");
    expect(added.possibleDuplicateOf).toBe("booking-stay");
    expect(added.importNotes?.[0]).toBe('Possible duplicate of "Hotel Le Marianne"');
    // the candidate is not touched
    expect(stays().find((s) => s.id === "booking-stay")).toEqual(expect.objectContaining({ place: "Hotel Le Marianne" }));
    expect(stays().find((s) => s.id === "booking-stay")!.possibleDuplicateOf).toBeUndefined();
  });

  test("an exact key match never reaches the near-match stage", async () => {
    await seedBookingStay();
    const res = await importFile("cal.csv", csv(row("Hotel Le Marianne")), { forced: "generic" });
    expect(res.added).toBe(0);
    expect(stays()).toHaveLength(1);
    expect(stays().some((s) => s.possibleDuplicateOf)).toBe(false);
  });

  test("an entry far from any candidate is not flagged", async () => {
    await seedBookingStay();
    await importFile("cal.csv", csv("stay,2026-11-20,2026-11-22,Ibis,Lyon,"), { forced: "generic" });
    expect(stays().find((s) => s.id !== "booking-stay")!.possibleDuplicateOf).toBeUndefined();
  });

  test("a dismissed pair does not come back, on re-import or on a rescan", async () => {
    await seedBookingStay();
    await importFile("cal.csv", csv(row("Marianne Paris")), { forced: "generic" });
    const added = stays().find((s) => s.id !== "booking-stay")!;

    await markNotDuplicate(added.id, "booking-stay");
    const a = stays().find((s) => s.id === added.id)!;
    const b = stays().find((s) => s.id === "booking-stay")!;
    expect(a.possibleDuplicateOf).toBeUndefined();
    expect(a.importNotes ?? []).not.toContainEqual(expect.stringMatching(/^Possible duplicate/));
    expect(a.notDuplicateOf).toEqual(["booking-stay"]);
    expect(b.notDuplicateOf).toEqual([added.id]);
    expect(a.unreviewed).toBe("new"); // dismissing the hint is not reviewing the entry

    const again = await importFile("cal.csv", csv(row("Marianne Paris")), { forced: "generic" });
    expect(again.run).toBeUndefined();
    expect(stays().find((s) => s.id === added.id)!.possibleDuplicateOf).toBeUndefined();
    expect(near(a, allEntries(getState()))).toEqual([]);
  });

  test("markNotDuplicate is safe to repeat and to call with an unknown id", async () => {
    await seedBookingStay();
    await importFile("cal.csv", csv(row("Marianne Paris")), { forced: "generic" });
    const added = stays().find((s) => s.id !== "booking-stay")!;
    await markNotDuplicate(added.id, "booking-stay");
    await markNotDuplicate(added.id, "booking-stay");
    expect(stays().find((s) => s.id === added.id)!.notDuplicateOf).toEqual(["booking-stay"]);
    await expect(markNotDuplicate("nope", "nada")).resolves.toBeUndefined();
  });

  test("merging the pair resolves the hint", async () => {
    await seedBookingStay();
    await importFile("cal.csv", csv(row("Marianne Paris")), { forced: "generic" });
    const added = stays().find((s) => s.id !== "booking-stay")!;
    const res = await mergeManual(added.id, "booking-stay");
    expect(res.ok).toBe(true);
    const merged = stays().find((s) => s.id === added.id)!;
    expect(merged.possibleDuplicateOf).toBeUndefined();
    expect(merged.importNotes ?? []).not.toContainEqual(expect.stringMatching(/^Possible duplicate/));
  });
});
