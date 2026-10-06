import { test, expect } from "vitest";
import { STORES, emptyJournalData, type JournalData } from "../types";

test("emptyJournalData covers every store", () => {
  const empty = emptyJournalData();
  for (const store of STORES) {
    expect(store in empty).toBe(true);
    expect(Array.isArray((empty as unknown as Record<string, unknown>)[store])).toBe(true);
  }
});

test("JournalData has no stores missing from STORES", () => {
  // Every key in JournalData should be in STORES
  const empty = emptyJournalData();
  const keys = Object.keys(empty) as string[];
  for (const key of keys) {
    expect(STORES).toContain(key);
  }
});
