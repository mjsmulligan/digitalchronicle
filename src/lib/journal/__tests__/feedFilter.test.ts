import { describe, test, expect } from "vitest";
import { matchesFilter, entryHasPerson } from "../feedFilter";
import type { Entry, Person } from "../types";

const base = {
  id: "x",
  source: "t",
  tier: 2,
  start: "2026-01-01",
  dedupeKey: "k",
  createdAt: "",
} as const;
const ev = (category: string) =>
  ({ ...base, kind: "event", category, artist: "A", venue: "", city: "" }) as unknown as Entry;
const leg = { ...base, kind: "leg", mode: "rail", from: "A", to: "B" } as unknown as Entry;
const stay = { ...base, kind: "stay", place: "Hotel" } as unknown as Entry;

describe("matchesFilter", () => {
  test("all matches everything", () => {
    expect(matchesFilter(leg, "all")).toBe(true);
  });
  test("travel is legs and stays", () => {
    expect(matchesFilter(leg, "travel")).toBe(true);
    expect(matchesFilter(stay, "travel")).toBe(true);
    expect(matchesFilter(ev("concert"), "travel")).toBe(false);
  });
  test("event categories", () => {
    expect(matchesFilter(ev("concert"), "concert")).toBe(true);
    expect(matchesFilter(ev("gathering"), "social")).toBe(true);
    expect(matchesFilter(ev("celebration"), "social")).toBe(true);
    expect(matchesFilter(ev("activity"), "memory")).toBe(true);
    expect(matchesFilter(ev("milestone"), "milestone")).toBe(true);
    expect(matchesFilter(ev("milestone"), "concert")).toBe(false);
    expect(matchesFilter(leg, "concert")).toBe(false);
  });
  test("new matches entries awaiting review", () => {
    expect(matchesFilter({ ...leg, unreviewed: "new" } as Entry, "new")).toBe(true);
    expect(matchesFilter(leg, "new")).toBe(false);
  });
});

describe("entryHasPerson", () => {
  const self: Person = { id: "s", name: "Me", isSelf: true, createdAt: "" };
  const other: Person = { id: "o", name: "Other", createdAt: "" };
  test("self is implicit when participants is absent, absent when explicitly removed", () => {
    expect(entryHasPerson(leg, self)).toBe(true);
    expect(entryHasPerson({ ...leg, participants: [] } as Entry, self)).toBe(false);
    expect(entryHasPerson({ ...leg, participants: ["s"] } as Entry, self)).toBe(true);
  });
  test("others must be listed", () => {
    expect(entryHasPerson(leg, other)).toBe(false);
    expect(entryHasPerson({ ...leg, participants: ["o"] } as Entry, other)).toBe(true);
  });
});
