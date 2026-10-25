/**
 * WP2 of docs/specs/merge-dedup.md: one key module.
 * normaliseText and every key builder live in connectors/keys.ts. These tests
 * pin the formats and prove that the same thing from two sources gets one key.
 */
import { describe, test, expect } from "vitest";
import {
  normaliseText, legKey, stayKey, eventKey, filmKey, episodeKey, bookKey, placeEntryKey, entryKey,
} from "../connectors/keys";
import { KIND_REGISTRY } from "../kinds";
import { connector as letterboxd } from "../connectors/letterboxd";
import { connector as netflix } from "../connectors/netflix";
import { connector as goodreads } from "../connectors/goodreads";
import { connector as icalendar } from "../connectors/icalendar";
import { connector as setlistfm } from "../connectors/setlistfm";
import { connector as generic } from "../connectors/generic";
import type { Book, Entry, Episode, Film, JEvent, Leg, PlaceEntry, Stay } from "../types";

// ─── normaliseText ───────────────────────────────────────────────────────────

describe("normaliseText", () => {
  const same: [string, string][] = [
    ["Hôtel Le Marianne", "Hotel le Marianne"],
    ["München Hbf", "Munchen Hbf"],
    ["São Paulo", "Sao Paulo"],
    ["Beyoncé", "BEYONCE"],
    ["Spider-Man", "Spider Man"],
    ["Don't Look Up", "Dont Look Up"],
    ["Don’t Look Up", "Don't Look Up"],
    ["Deadpool & Wolverine", "Deadpool and Wolverine"],
    ["  The   National ", "the national"],
    ["Guns N' Roses", "Guns N Roses"],
    ["Straße", "Strasse"],
    ["Bjørk", "Bjork"],
  ];
  test.each(same)("%s matches %s", (a, b) => {
    expect(normaliseText(a)).toBe(normaliseText(b));
  });

  const different: [string, string][] = [
    ["The Bear", "Bear"],
    ["Hotel Berlin", "Hotel Hamburg"],
    ["Alien", "Aliens"],
  ];
  test.each(different)("%s does not match %s", (a, b) => {
    expect(normaliseText(a)).not.toBe(normaliseText(b));
  });

  test("gives lower-case words joined by single hyphens", () => {
    expect(normaliseText("Deadpool & Wolverine")).toBe("deadpool-and-wolverine");
    expect(normaliseText("  Hôtel   Le  Marianne ")).toBe("hotel-le-marianne");
  });

  test("keeps letters from other scripts and digits, accents included", () => {
    expect(normaliseText("Київ 2026")).toBe("київ-2026");
    expect(normaliseText("Харків, Україна")).toBe("харків-україна");
    expect(normaliseText("Йорк")).toBe("йорк");
  });

  test("empty, null and undefined give an empty string", () => {
    expect(normaliseText("")).toBe("");
    expect(normaliseText(undefined)).toBe("");
    expect(normaliseText(null)).toBe("");
    expect(normaliseText(" - & ")).toBe("and");
  });

  test("is idempotent", () => {
    for (const s of ["Hôtel Le Marianne", "Deadpool & Wolverine", "A  B-C_D", "Київ"]) {
      expect(normaliseText(normaliseText(s))).toBe(normaliseText(s));
    }
  });
});

// ─── builders ────────────────────────────────────────────────────────────────

describe("key formats", () => {
  test("leg: date, upper-cased from and to, time ignored", () => {
    expect(legKey({ start: "2026-10-15T09:00", from: "dub", to: "Lhr" })).toBe("leg|2026-10-15|DUB|LHR");
    expect(legKey({ start: "2026-03-01", from: "München Hbf", to: "Berlin Hbf" })).toBe("leg|2026-03-01|MUNCHEN-HBF|BERLIN-HBF");
  });

  test("leg: a placeholder code leaves an empty part", () => {
    expect(legKey({ start: "2026-10-15", from: "", to: "CDG" })).toBe("leg|2026-10-15||CDG");
  });

  test("stay, event, film, episode, book, place-entry", () => {
    expect(stayKey({ start: "2026-10-12", place: "Hôtel Le Marianne" })).toBe("stay|2026-10-12|hotel-le-marianne");
    expect(eventKey({ start: "2023-06-15T19:00", artist: "Radiohead" })).toBe("event|2023-06-15|radiohead");
    expect(filmKey({ start: "2024-08-11", title: "Deadpool & Wolverine" })).toBe("film|deadpool-and-wolverine|2024-08-11");
    expect(episodeKey({ start: "2026-06-01", showTitle: "Bridgerton", season: "Season 4", episodeTitle: "A Courtship" }))
      .toBe("episode|bridgerton|season-4|a-courtship|2026-06-01");
    expect(episodeKey({ start: "2026-06-01", showTitle: "Bridgerton" })).toBe("episode|bridgerton|||2026-06-01");
    expect(bookKey({ start: "2026-09-09", title: "The Magicians", author: "Lev Grossman" })).toBe("book|the-magicians|lev-grossman|2026-09-09");
    expect(placeEntryKey({ localityKey: "gb:london", localDay: "2025-07-05" })).toBe("place-entry|gb:london|2025-07-05");
  });

  test("a film key has no year, so a source without one still matches", () => {
    expect(filmKey({ start: "2024-08-11", title: "Oppenheimer" })).not.toMatch(/\|20\d\d\|/);
  });
});

// ─── entryKey and the registry ───────────────────────────────────────────────

const base = { id: "x", source: "manual", dedupeKey: "stale", createdAt: "2026-01-01T00:00:00.000Z" };
const sample: Entry[] = [
  { ...base, kind: "leg", mode: "air", from: "DUB", to: "LHR", start: "2026-10-15T09:00" } as Leg,
  { ...base, kind: "stay", place: "Hôtel Le Marianne", start: "2026-10-12" } as Stay,
  { ...base, kind: "event", category: "concert", artist: "The National", venue: "", city: "", start: "2024-03-01" } as JEvent,
  { ...base, kind: "film", title: "Oppenheimer", start: "2026-09-29" } as Film,
  { ...base, kind: "episode", showTitle: "Bridgerton", season: "Season 4", episodeTitle: "A Courtship", start: "2026-06-01" } as Episode,
  { ...base, kind: "book", title: "Dune", author: "Frank Herbert", start: "2024-01-15" } as Book,
  { ...base, kind: "place-entry", localityKey: "gb:london", localDay: "2025-07-05", start: "2025-07-05" } as unknown as PlaceEntry,
];

describe("entryKey", () => {
  test.each(sample.map((e) => [e.kind, e] as const))("%s: the registry builds the same key", (_k, e) => {
    expect(KIND_REGISTRY[e.kind].buildKey(e)).toBe(entryKey(e));
    expect(entryKey(e)).not.toBe("stale");
    expect(entryKey(e).startsWith(`${e.kind}|`)).toBe(true);
  });

  test("a user's overrides never change the key", () => {
    const leg = sample[0] as Leg;
    expect(entryKey({ ...leg, overrides: { from: "CDG" } as Leg["overrides"] })).toBe(entryKey(leg));
  });
});

// ─── the same thing from two sources ─────────────────────────────────────────

const parse = async (c: { parse: (i: { name: string; text: string }) => unknown }, name: string, text: string) => {
  const r = (await c.parse({ name, text })) as { entries: { entry: Entry }[]; errors: string[] };
  expect(r.errors).toEqual([]);
  return r.entries.map((e) => e.entry);
};

describe("cross-source keys", () => {
  test("a Letterboxd and a Netflix record of the same watch match", async () => {
    const lb = await parse(
      letterboxd, "diary.csv",
      "Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date\n2026-09-30,Oppenheimer,2023,https://boxd.it/abc,4,,,2026-09-29\n",
    );
    const nf = await parse(netflix, "NetflixViewingHistory.csv", "Title,Date\nOppenheimer,9/29/26\n");
    expect(lb[0].dedupeKey).toBe(nf[0].dedupeKey);
  });

  test("an ampersand and 'and' in a film title match across sources", async () => {
    const lb = await parse(
      letterboxd, "diary.csv",
      "Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date\n2026-09-30,Deadpool & Wolverine,2024,https://boxd.it/abc,4,,,2024-08-11\n",
    );
    expect(lb[0].dedupeKey).toBe(filmKey({ start: "2024-08-11", title: "Deadpool and Wolverine" }));
  });

  test("a calendar item and a setlist.fm row for the same concert match", async () => {
    const ics = [
      "BEGIN:VCALENDAR", "BEGIN:VEVENT",
      "DTSTART:20230615T190000", "DTEND:20230615T230000",
      "SUMMARY:Radiohead", "END:VEVENT", "END:VCALENDAR",
    ].join("\n");
    const cal = await parse(icalendar, "calendar.ics", ics);
    const sl = await parse(setlistfm, "setlist.csv", "date,artist,venue,city\n2023-06-15,Radiohead,Glastonbury,Glastonbury");
    expect(cal[0].kind).toBe("event");
    expect(cal[0].dedupeKey).toBe(sl[0].dedupeKey);
  });

  test("a generic CSV stay and a calendar stay with an accent difference match", async () => {
    const gen = await parse(generic, "stays.csv", "type,start,end,place,city\nstay,2026-10-12,2026-10-14,Hotel Le Marianne,Paris");
    expect(gen[0].dedupeKey).toBe(stayKey({ start: "2026-10-12", place: "Hôtel Le Marianne" }));
  });

  test("a Goodreads book and a manual book with the same title, author and day match", async () => {
    const gr = await parse(
      goodreads, "goodreads_library_export.csv",
      "Book Id,Title,Author,My Rating,Date Read,Date Added,Exclusive Shelf\n1,The Magicians,Lev Grossman,4,2026/09/09,2026/09/01,read\n",
    );
    expect(gr[0].dedupeKey).toBe(bookKey({ start: "2026-09-09", title: "the magicians", author: "LEV GROSSMAN" }));
  });
});
