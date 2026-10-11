import { test, expect } from "vitest";
import { mergeEntries } from "../merge";
import type { Film } from "../types";

const base = { id: "a", kind: "film" as const, source: "letterboxd", tier: 2 as const, start: "2023-01-01", dedupeKey: "film|foo|2023|2023-01-01", title: "Foo", createdAt: "2023-01-01T00:00:00Z" };

test("mergeEntries: concatenates both reflections", () => {
  const winner = { ...base, reflection: "my note" } as Film;
  const loser  = { ...base, id: "b", reflection: "another note" } as Film;
  const result = mergeEntries(winner, loser);
  expect(result.reflection).toBe("my note\n\n---\n\nanother note");
});

test("mergeEntries: keeps winner reflection when loser has none", () => {
  const winner = { ...base, reflection: "my note" } as Film;
  const loser  = { ...base, id: "b" } as Film;
  const result = mergeEntries(winner, loser);
  expect(result.reflection).toBe("my note");
});

test("mergeEntries: keeps winner id", () => {
  const winner = { ...base } as Film;
  const loser  = { ...base, id: "b" } as Film;
  expect(mergeEntries(winner, loser).id).toBe("a");
});

test("mergeEntries: unions participants", () => {
  const winner = { ...base, participants: ["p1"] } as Film;
  const loser  = { ...base, id: "b", participants: ["p2"] } as Film;
  const result = mergeEntries(winner, loser);
  expect(result.participants).toEqual(expect.arrayContaining(["p1", "p2"]));
  expect(result.participants!.length).toBe(2);
});

test("mergeEntries: winner review wins over loser review", () => {
  const winner = { ...base, review: "winner review" } as Film;
  const loser  = { ...base, id: "b", review: "loser review" } as Film;
  expect(mergeEntries(winner, loser).review).toBe("winner review");
});

test("mergeEntries: loser review used when winner has none", () => {
  const winner = { ...base } as Film;
  const loser  = { ...base, id: "b", review: "loser review" } as Film;
  expect(mergeEntries(winner, loser).review).toBe("loser review");
});
