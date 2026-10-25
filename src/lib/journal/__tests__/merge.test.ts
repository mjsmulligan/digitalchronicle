import { test, expect } from "vitest";
import { mergeEntries } from "../merge";
import type { Film } from "../types";

const base = { id: "a", kind: "film" as const, source: "letterboxd", start: "2023-01-01", dedupeKey: "film|foo|2023|2023-01-01", title: "Foo", createdAt: "2023-01-01T00:00:00Z" };

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

// ─── WP3 of docs/specs/merge-dedup.md: the one merge policy ──────────────────

import { enrichEntry, MAX_ABSORBED, refreshFromSource } from "../merge";
import type { Entry, Leg } from "../types";

let n = 0;
const leg = (over: Partial<Leg> = {}): Leg => {
  n += 1;
  return {
    id: `leg${n}`, kind: "leg", source: "icalendar", sourceRef: `cal.ics#row${n}`, mode: "air",
    from: "DUB", to: "LHR", start: "2026-03-01T09:00", dedupeKey: "leg|2026-03-01|DUB|LHR",
    createdAt: "2026-03-01T10:00:00.000Z", ...over,
  };
};
const fr24 = (over: Partial<Leg> = {}) => leg({ source: "flightradar24", sourceRef: "fr.csv#row2", ...over });

test("fills only the gaps, and never overwrites a value the base has", () => {
  const base = leg({ flightNumber: "EI154" });
  const other = fr24({ flightNumber: "EI999", operator: "Aer Lingus", seat: "12A", end: "2026-03-01T10:30" });
  const out = mergeEntries(base, other);
  expect(out.flightNumber).toBe("EI154");
  expect(out.operator).toBe("Aer Lingus");
  expect(out.seat).toBe("12A");
  expect(out.end).toBe("2026-03-01T10:30");
});

test("empty strings and empty arrays count as gaps, null too", () => {
  const out = mergeEntries(leg({ operator: "" }), fr24({ operator: "Aer Lingus" }));
  expect(out.operator).toBe("Aer Lingus");
});

test("only editable fields are filled, not arbitrary ones", () => {
  const out = mergeEntries(leg(), fr24({ aircraft: "A320", raw: { a: 1 } }));
  expect((out as Leg).aircraft).toBeUndefined();
  expect(out.raw).toBeUndefined();
});

test("keeps the base's id, kind, source and sourceRef, whatever the other says", () => {
  const base = leg();
  const out = mergeEntries(base, fr24());
  expect([out.id, out.kind, out.source, out.sourceRef]).toEqual([base.id, "leg", base.source, base.sourceRef]);
});

test("time zone and UTC fields are only copied when they describe the same local time", () => {
  const dateOnly = leg({ start: "2026-03-01" });
  const timed = fr24({ start: "2026-03-01T09:00", startTz: "Europe/Dublin", startUTC: "2026-03-01T09:00:00.000Z" });
  expect(mergeEntries(dateOnly, timed).startUTC).toBeUndefined();
  const same = fr24({ startTz: "Europe/Dublin", startUTC: "2026-03-01T09:00:00.000Z" });
  expect(mergeEntries(leg(), same).startUTC).toBe("2026-03-01T09:00:00.000Z");
});

test("refuses to merge entries of different kinds", () => {
  const stay = { ...leg(), kind: "stay", place: "Hotel" } as unknown as Entry;
  expect(() => mergeEntries(leg(), stay)).toThrow(/Cannot merge/);
});

test("a manual merge keeps both reflections, an import never adds to the user's", () => {
  const base = leg({ reflection: "mine" });
  const other = fr24({ reflection: "source note" });
  expect(mergeEntries(base, other).reflection).toBe("mine\n\n---\n\nsource note");
  expect(mergeEntries(base, other, { absorb: true }).reflection).toBe("mine");
  expect(mergeEntries(leg(), other, { absorb: true }).reflection).toBe("source note");
});

test("a manual merge does not repeat a reflection the base already contains", () => {
  const base = leg({ reflection: "mine\n\n---\n\nsource note" });
  expect(mergeEntries(base, fr24({ reflection: "source note" })).reflection).toBe(base.reflection);
});

test("a source rating fills a missing one and stays locked; the base's own rating wins", () => {
  const fromSource = fr24({ rating: 8, sourceLocked: ["rating"] });
  const filled = mergeEntries(leg(), fromSource);
  expect(filled.rating).toBe(8);
  expect(filled.sourceLocked).toEqual(["rating"]);
  const own = mergeEntries(leg({ rating: 5 }), fromSource);
  expect(own.rating).toBe(5);
  expect(own.sourceLocked).toBeUndefined();
});

test("participants: an unset base adopts the other's, otherwise they are unioned", () => {
  expect(mergeEntries(leg(), fr24({ participants: ["p2"] })).participants).toEqual(["p2"]);
  expect(mergeEntries(leg({ participants: ["p1"] }), fr24({ participants: ["p1", "p2"] })).participants).toEqual(["p1", "p2"]);
  expect(mergeEntries(leg({ participants: [] }), fr24()).participants).toEqual([]);
});

test("overrides are unioned with the base winning, and trip and series links fall back to the other", () => {
  const base = leg({ overrides: { from: "Dublin" } as Leg["overrides"] });
  const other = fr24({ overrides: { from: "X", to: "London" } as Leg["overrides"], tripId: "t1" });
  const out = mergeEntries(base, other);
  expect(out.overrides).toEqual({ from: "Dublin", to: "London" });
  expect(out.tripId).toBe("t1");
  expect(mergeEntries({ ...base, tripId: "t0" } as Leg, other).tripId).toBe("t0");
});

test("additionalSources: the other's source and extras are added by source plus sourceRef, never the base's own", () => {
  const base = leg({ additionalSources: [{ source: "viaduct", sourceRef: "v.csv#row1" }] });
  const other = fr24({ additionalSources: [{ source: "viaduct", sourceRef: "v.csv#row1" }, { source: "wallet", sourceRef: "w.pdf#1" }] });
  const out = mergeEntries(base, other);
  expect(out.additionalSources).toEqual([
    { source: "viaduct", sourceRef: "v.csv#row1" },
    { source: "flightradar24", sourceRef: "fr.csv#row2" },
    { source: "wallet", sourceRef: "w.pdf#1" },
  ]);
  expect(mergeEntries(base, { ...base, id: "x" }).additionalSources).toEqual(base.additionalSources);
});

test("a second row from the same source is recorded, since its sourceRef differs", () => {
  const base = leg();
  const out = mergeEntries(base, leg({ sourceRef: "cal.ics#row99" }));
  expect(out.additionalSources).toEqual([{ source: "icalendar", sourceRef: "cal.ics#row99" }]);
});

test("is idempotent: merging the same record twice changes nothing more", () => {
  const other = fr24({ operator: "Aer Lingus", reflection: "x" });
  const once = mergeEntries(leg(), other, { absorb: true });
  const twice = mergeEntries(once, other, { absorb: true });
  expect(twice).toEqual(once);
});

test("absorb records the row, the fields it filled, and keeps only the last few rows", () => {
  const out = mergeEntries(leg(), fr24({ operator: "Aer Lingus" }), { absorb: true });
  expect(out.absorbed).toHaveLength(1);
  expect(out.absorbed![0]).toMatchObject({ source: "flightradar24", sourceRef: "fr.csv#row2" });
  expect(out.absorbed![0].entry.id).toBeTruthy();
  expect(out.fieldSources).toEqual({ operator: "fr.csv#row2" });
  let cur = leg();
  for (let i = 0; i < MAX_ABSORBED + 3; i++) cur = mergeEntries(cur, fr24({ sourceRef: `fr.csv#row${i}` }), { absorb: true });
  expect(cur.absorbed).toHaveLength(MAX_ABSORBED);
  expect(cur.additionalSources).toHaveLength(MAX_ABSORBED + 3);
  expect(cur.absorbed![MAX_ABSORBED - 1].sourceRef).toBe(`fr.csv#row${MAX_ABSORBED + 2}`);
});

test("without absorb nothing is recorded (manual merge)", () => {
  const out = mergeEntries(leg(), fr24({ operator: "Aer Lingus" }));
  expect(out.absorbed).toBeUndefined();
  expect(out.fieldSources).toBeUndefined();
});

test("enrichEntry reports a change only when something was added", () => {
  const base = leg();
  const first = enrichEntry(base, fr24({ operator: "Aer Lingus" }));
  expect(first.changed).toBe(true);
  expect(enrichEntry(first.entry, fr24({ operator: "Aer Lingus" })).changed).toBe(false);
});

test("refreshFromSource: source fields come from the incoming row, the user's data stays", () => {
  const old = leg({ operator: "Old", reflection: "mine", tripId: "t1", participants: ["p1"], overrides: { from: "Dublin" } as Leg["overrides"] });
  const refreshed = refreshFromSource(old, leg({ operator: "New", end: "2026-03-01T11:00" }));
  expect(refreshed.id).toBe(old.id);
  expect(refreshed.operator).toBe("New");
  expect(refreshed.end).toBe("2026-03-01T11:00");
  expect(refreshed.reflection).toBe("mine");
  expect(refreshed.tripId).toBe("t1");
  expect(refreshed.participants).toEqual(["p1"]);
  expect(refreshed.overrides).toEqual({ from: "Dublin" });
});

test("refreshFromSource: a field another row filled stays unless the source now defines it", () => {
  const merged = mergeEntries(leg(), fr24({ operator: "Aer Lingus", seat: "12A" }), { absorb: true });
  const refreshed = refreshFromSource(merged, leg({ seat: "14C" }));
  expect(refreshed.operator).toBe("Aer Lingus");
  expect(refreshed.seat).toBe("14C");
  expect(refreshed.fieldSources).toEqual({ operator: "fr.csv#row2" });
  expect(refreshed.additionalSources).toEqual(merged.additionalSources);
  expect(refreshed.absorbed).toEqual(merged.absorbed);
});

test("refreshFromSource keeps a review another row supplied when the source has none", () => {
  const merged = mergeEntries(leg(), fr24({ review: "Great flight" }), { absorb: true });
  expect(refreshFromSource(merged, leg()).review).toBe("Great flight");
});
