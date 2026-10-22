import { test, expect } from "vitest";
import { suggestTrips, MAX_TRIP_DAYS } from "../tripSuggestion";
import { emptyJournalData } from "../types";
import type { Leg, JournalData } from "../types";

// ── fixture helpers ────────────────────────────────────────────────────────────

let seq = 0;
function leg(from: string, to: string, date: string, extra: Partial<Leg> = {}): Leg {
  const id = `leg-${++seq}`;
  return {
    id,
    kind:      "leg",
    mode:      "air",
    source:    "viaduct",
    tier:      2,
    start:     `${date}T10:00`,
    from,
    to,
    fromName:  from,
    toName:    to,
    dedupeKey: `leg|air|${from}|${to}|${date}`,
    createdAt: `${date}T00:00:00Z`,
    ...extra,
  };
}

function journal(legs: Leg[]): JournalData {
  return { ...emptyJournalData(), legs };
}

// ── tests ──────────────────────────────────────────────────────────────────────

test("suggests a simple out-and-back trip", () => {
  const j = journal([
    leg("DUB", "LHR", "2025-03-01"),
    leg("LHR", "DUB", "2025-03-05"),
  ]);
  const results = suggestTrips(j, ["DUB"]);
  expect(results).toHaveLength(1);
  expect(results[0].start).toBe("2025-03-01");
  expect(results[0].end).toBe("2025-03-05");
});

test("uses destination name as title", () => {
  const j = journal([
    leg("DUB", "LHR", "2025-03-01"),
    leg("LHR", "DUB", "2025-03-05"),
  ]);
  const [r] = suggestTrips(j, ["DUB"]);
  expect(r.title).toBe("LHR");
});

test("suppresses suggestion when no return leg is found", () => {
  const j = journal([
    leg("DUB", "JFK", "2025-06-01"),
    // no return flight in data
  ]);
  expect(suggestTrips(j, ["DUB"])).toHaveLength(0);
});

test(`suppresses suggestion when return is more than ${MAX_TRIP_DAYS} days out`, () => {
  const farReturn = "2025-07-15"; // 44 days after June 1
  const j = journal([
    leg("DUB", "JFK", "2025-06-01"),
    leg("JFK", "DUB", farReturn),
  ]);
  expect(suggestTrips(j, ["DUB"])).toHaveLength(0);
});

test("accepts a return leg exactly at MAX_TRIP_DAYS", () => {
  // MAX_TRIP_DAYS = 30; departure 2025-06-01, return 2025-07-01 = 30 days
  const j = journal([
    leg("DUB", "BCN", "2025-06-01"),
    leg("BCN", "DUB", "2025-07-01"),
  ]);
  expect(suggestTrips(j, ["DUB"])).toHaveLength(1);
});

test("suppresses when there is an intermediate home arrival (two trips stitched together)", () => {
  // DUB→LHR, return LHR→DUB, then separately DUB→CDG, return CDG→DUB
  // Without the guard, the first outLeg would grab the second return as its close.
  const j = journal([
    leg("DUB", "LHR", "2025-01-10"),
    leg("LHR", "DUB", "2025-01-15"),  // real return for trip 1
    leg("DUB", "CDG", "2025-01-20"),  // start of trip 2
    leg("CDG", "DUB", "2025-01-25"),
  ]);
  const results = suggestTrips(j, ["DUB"]);
  // Both trips should be detected independently, not merged into one
  expect(results).toHaveLength(2);
  expect(results[0].end).toBe("2025-01-15");
  expect(results[1].start).toBe("2025-01-20");
  expect(results[1].end).toBe("2025-01-25");
});

test("suppresses a candidate whose window contains an intermediate home arrival", () => {
  // Overlapping-windows scenario: trip 2 departs while trip 1 is still open.
  //   DUB→LHR 10 Jan  (trip 1 out)
  //   DUB→BCN 12 Jan  (trip 2 out — person is already away, weird data)
  //   LHR→DUB 15 Jan  (trip 1 return — consumed by trip 1, but still in trip 2's window)
  //   BCN→DUB 20 Jan  (trip 2 "return")
  //
  // Trip 1 is correctly suggested (Jan 10–15).
  // When evaluating trip 2 (Jan 12–20), LHR→DUB arrives home within that window
  // → the intermediate-home-arrival guard fires → trip 2 is suppressed.
  const j = journal([
    leg("DUB", "LHR", "2025-01-10"),
    leg("DUB", "BCN", "2025-01-12"),
    leg("LHR", "DUB", "2025-01-15"),
    leg("BCN", "DUB", "2025-01-20"),
  ]);
  const results = suggestTrips(j, ["DUB"]);
  expect(results).toHaveLength(1);
  expect(results[0].start).toBe("2025-01-10");
  expect(results[0].end).toBe("2025-01-15");
});

test("two independent trips produce two suggestions", () => {
  const j = journal([
    leg("DUB", "MAD", "2025-04-01"),
    leg("MAD", "DUB", "2025-04-07"),
    leg("DUB", "TXL", "2025-05-10"),
    leg("TXL", "DUB", "2025-05-15"),
  ]);
  const results = suggestTrips(j, ["DUB"]);
  expect(results).toHaveLength(2);
  expect(results[0].title).toBe("MAD");
  expect(results[1].title).toBe("TXL");
});

test("returns empty when homeAirports is empty", () => {
  const j = journal([
    leg("DUB", "LHR", "2025-03-01"),
    leg("LHR", "DUB", "2025-03-05"),
  ]);
  expect(suggestTrips(j, [])).toHaveLength(0);
});

test("legs already linked to a trip are not used in suggestions", () => {
  const j = journal([
    leg("DUB", "LHR", "2025-03-01", { tripId: "existing-trip" }),
    leg("LHR", "DUB", "2025-03-05"),
  ]);
  expect(suggestTrips(j, ["DUB"])).toHaveLength(0);
});

test("counts unlinked entries in the window for entryCount", () => {
  const j: JournalData = {
    ...emptyJournalData(),
    legs: [
      leg("DUB", "BCN", "2025-08-01"),
      leg("BCN", "DUB", "2025-08-10"),
    ],
    events: [
      {
        id: "ev1", kind: "event", source: "setlistfm", tier: 2,
        start: "2025-08-05", artist: "Band", category: "concert",
        venue: "Venue", city: "Barcelona",
        dedupeKey: "event|2025-08-05|band", createdAt: "2025-08-05T00:00:00Z",
      },
    ],
  };
  const [r] = suggestTrips(j, ["DUB"]);
  // 2 legs + 1 event = 3 entries in window
  expect(r.entryCount).toBe(3);
});
