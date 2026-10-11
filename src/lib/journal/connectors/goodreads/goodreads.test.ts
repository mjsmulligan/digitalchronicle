import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { connector } from "./index";
import type { Book } from "../../types";
import type { ParseResult } from "../types";

const fixtureText = readFileSync(
  join(__dirname, "fixtures/goodreads_library_export.csv"),
  "utf-8",
);

describe("goodreads connector — metadata", () => {
  it("has correct id and label", () => {
    expect(connector.id).toBe("goodreads");
    expect(connector.label).toBe("Goodreads library");
  });

  it("is tier 2", () => {
    expect(connector.tier).toBe(2);
  });
});

describe("goodreads connector — parse", () => {
  // goodreads parse() is synchronous; cast to avoid the Promise<ParseResult> union
  const result = connector.parse({ name: "goodreads_library_export.csv", text: fixtureText }) as ParseResult;

  it("imports only 'read' shelf entries (skips currently-reading, to-read)", () => {
    // Fixture has 6 rows: 4 read, 1 currently-reading. Sense and Sensibility has
    // no Date Read but has Date Added — still imported with datePrecision "unknown".
    expect(result.entries).toHaveLength(5);
  });

  it("produces entries with source 'goodreads' and tier 2", () => {
    const entry = result.entries[0].entry as Book;
    expect(entry.source).toBe("goodreads");
    expect(entry.tier).toBe(2);
  });

  it("all entries have kind 'book'", () => {
    expect(result.entries.every(({ entry }) => entry.kind === "book")).toBe(true);
  });

  it("The Magicians — strips series suffix from title", () => {
    const entry = result.entries.find(
      ({ entry }) => (entry as Book).goodreadsId === "6101718",
    )!.entry as Book;
    expect(entry.title).toBe("The Magicians");
    expect(entry.series).toBe("The Magicians");
    expect(entry.seriesNumber).toBe(1);
  });

  it("The Magicians — rating ×2 (1.0 → 2)", () => {
    const entry = result.entries.find(
      ({ entry }) => (entry as Book).goodreadsId === "6101718",
    )!.entry as Book;
    expect(entry.rating).toBe(2);
  });

  it("The Magicians — review from My Review", () => {
    const entry = result.entries.find(
      ({ entry }) => (entry as Book).goodreadsId === "6101718",
    )!.entry as Book;
    expect(entry.review).toBeTruthy();
    expect(entry.review).toContain("DNF");
  });

  it("The Magicians — start = Date Read", () => {
    const entry = result.entries.find(
      ({ entry }) => (entry as Book).goodreadsId === "6101718",
    )!.entry as Book;
    expect(entry.start).toBe("2026-09-09");
    expect(entry.datePrecision).toBe("day");
  });

  it("Bridgertons #6 — series name and number parsed correctly", () => {
    const entry = result.entries.find(
      ({ entry }) => (entry as Book).goodreadsId === "110396",
    )!.entry as Book;
    expect(entry.title).toBe("When He Was Wicked");
    expect(entry.series).toBe("Bridgertons");
    expect(entry.seriesNumber).toBe(6);
    expect(entry.rating).toBe(6); // 3.0 × 2
  });

  it("Land — no series suffix, no seriesNumber", () => {
    const entry = result.entries.find(
      ({ entry }) => (entry as Book).goodreadsId === "241126782",
    )!.entry as Book;
    expect(entry.title).toBe("Land");
    expect(entry.series).toBeUndefined();
    expect(entry.seriesNumber).toBeUndefined();
    expect(entry.rating).toBe(8); // 4.0 × 2
    expect(entry.author).toBe("Maggie O'Farrell");
  });

  it("Bridgertons #7.5 — decimal series number", () => {
    const entry = result.entries.find(
      ({ entry }) => (entry as Book).goodreadsId === "4411509",
    )!.entry as Book;
    expect(entry.series).toBe("Bridgertons");
    expect(entry.seriesNumber).toBe(7.5);
  });

  it("Sense and Sensibility — no Date Read falls back to Date Added with unknown precision", () => {
    const entry = result.entries.find(
      ({ entry }) => (entry as Book).goodreadsId === "14935",
    )!.entry as Book;
    expect(entry.start).toBe("2010-12-15"); // Date Added
    expect(entry.datePrecision).toBe("unknown");
  });

  it("dedupeKey format: book|normTitle|normAuthor|dateRead", () => {
    const entry = result.entries.find(
      ({ entry }) => (entry as Book).goodreadsId === "6101718",
    )!.entry as Book;
    expect(entry.dedupeKey).toBe("book|the magicians|lev grossman|2026-09-09");
  });

  it("dedupeKey uses empty date when Date Read is blank", () => {
    const entry = result.entries.find(
      ({ entry }) => (entry as Book).goodreadsId === "14935",
    )!.entry as Book;
    expect(entry.dedupeKey).toBe("book|sense and sensibility|jane austen|");
  });

  it("no errors in fixture parse", () => {
    expect(result.errors).toHaveLength(0);
  });
});

describe("goodreads connector — sniff", () => {
  const sniff = connector.sniff!;

  it("scores 0.97 for canonical export filename", () => {
    expect(sniff("goodreads_library_export.csv", "")).toBe(0.97);
  });

  it("scores 0.97 for any filename containing 'goodreads'", () => {
    expect(sniff("my_goodreads_backup.csv", "")).toBe(0.97);
  });

  it("scores 0.9 for header containing 'Book Id' and 'Exclusive Shelf'", () => {
    expect(
      sniff("unknown.csv", "Book Id,Title,Author,Exclusive Shelf"),
    ).toBe(0.9);
  });

  it("scores 0 for unrelated files", () => {
    expect(sniff("diary.csv", "Date,Name,Watched Date,Rating")).toBe(0);
  });
});
