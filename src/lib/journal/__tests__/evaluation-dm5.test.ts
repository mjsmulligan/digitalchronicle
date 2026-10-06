import { test, expect } from "vitest";
import type { Entry } from "../types";
import { mergeEvaluation, migrateEntryEvaluation } from "../evaluation";

// ---------------------------------------------------------------------------
// mergeEvaluation
// ---------------------------------------------------------------------------

test("mergeEvaluation: user reflection survives supersede with source review", () => {
  const old = { reflection: "my personal note" } as Partial<Entry>;
  const incoming = { source: "letterboxd", review: "Stunning cinematography.", rating: 8.5 } as Partial<Entry>;
  const result = mergeEvaluation(incoming as Entry, old as Entry);
  expect(result.reflection).toBe("my personal note");
  expect(result.review).toBe("Stunning cinematography.");
});

test("mergeEvaluation: review from incoming is always taken (updated source text)", () => {
  const old = { reflection: "user note", review: "old review" } as Partial<Entry>;
  const incoming = { source: "letterboxd", review: "Updated review.", rating: 9 } as Partial<Entry>;
  const result = mergeEvaluation(incoming as Entry, old as Entry);
  expect(result.review).toBe("Updated review.");
  expect(result.reflection).toBe("user note");
});

test("mergeEvaluation: reflection preserved even when incoming has no reflection", () => {
  const old = { reflection: "user wrote this" } as Partial<Entry>;
  const incoming = { source: "goodreads", review: "Great book." } as Partial<Entry>;
  const result = mergeEvaluation(incoming as Entry, old as Entry);
  expect(result.reflection).toBe("user wrote this");
});

test("mergeEvaluation: sourceLocked no longer includes reflection", () => {
  const old = {} as Partial<Entry>;
  const incoming = { source: "letterboxd", review: "A review.", rating: 7.5 } as Partial<Entry>;
  const result = mergeEvaluation(incoming as Entry, old as Entry);
  expect(result.sourceLocked ?? []).not.toContain("reflection");
  expect(result.sourceLocked ?? []).toContain("rating");
});

// ---------------------------------------------------------------------------
// migrateReviewReflection (via migrateEntryEvaluation belt-and-suspenders)
// ---------------------------------------------------------------------------

test("migrateEntryEvaluation: moves sourceLocked reflection → review", () => {
  const entry = {
    id: "1",
    source: "letterboxd",
    reflection: "Incredible film.",
    sourceLocked: ["reflection"] as unknown as ("rating")[],
    dedupeKey: "film|2020-01-01|title",
    createdAt: "2020-01-01",
    kind: "film",
  } as unknown as Entry;

  const migrated = migrateEntryEvaluation(entry);
  expect(migrated).not.toBeNull();
  expect(migrated!.review).toBe("Incredible film.");
  expect(migrated!.reflection).toBeUndefined();
  // sourceLocked is either undefined or does not contain "reflection"
  expect(migrated!.sourceLocked ?? []).not.toContain("reflection");
});

test("migrateEntryEvaluation: idempotent when sourceLocked has no reflection", () => {
  const entry = {
    id: "2",
    source: "letterboxd",
    review: "Already migrated.",
    sourceLocked: ["rating"] as ("rating")[],
    rating: 8,
    dedupeKey: "film|2020-01-01|title",
    createdAt: "2020-01-01",
    kind: "film",
  } as unknown as Entry;

  const migrated = migrateEntryEvaluation(entry);
  // No changes needed — should return null (already normalised)
  expect(migrated).toBeNull();
});

// ---------------------------------------------------------------------------
// review field round-trips through JSON (type-level verification)
// ---------------------------------------------------------------------------

test("review field round-trips through JSON", () => {
  const entry = {
    id: "3",
    source: "goodreads",
    review: "Loved it.",
    reflection: "Personal note.",
    dedupeKey: "book|title|author",
    createdAt: "2020-01-01",
    kind: "book",
  } as unknown as Entry;

  const serialised = JSON.stringify(entry);
  const deserialised = JSON.parse(serialised) as Entry;
  expect(deserialised.review).toBe("Loved it.");
  expect(deserialised.reflection).toBe("Personal note.");
});
