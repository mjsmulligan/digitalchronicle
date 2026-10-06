/**
 * Characterization tests for the three built-in connectors.
 *
 * Imports directly from the connectors package and registry — parsers.ts is
 * not used here.
 */
import { describe, it, expect } from "vitest";
import { connector as viaductConnector } from "@/lib/journal/connectors/viaduct/index";
import { connector as setlistConnector } from "@/lib/journal/connectors/setlistfm/index";
import { connector as genericConnector } from "@/lib/journal/connectors/generic/index";
import { detectConnector } from "@/lib/journal/connectors/registry";
import { eventKey } from "@/lib/journal/connectors/keys";
import type { ParseResult } from "@/lib/journal/connectors/types";
import { stageFile } from "@/lib/journal/staging";
import {
  SAMPLE_VIADUCT,
  SAMPLE_SETLIST,
  SAMPLE_GENERIC,
  SAMPLE_LIFE,
} from "@/lib/journal/samples";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function parse(connector: { parse(i: { name: string; text: string }): ParseResult | Promise<ParseResult> }, text: string): ParseResult {
  return connector.parse({ name: "", text }) as ParseResult;
}

/** Strip volatile fields so snapshots are deterministic. */
function strip(r: ParseResult) {
  return {
    errors: r.errors,
    entries: r.entries.map(({ entry, warnings, sourceRow }) => ({
      entry: { ...entry, id: undefined, createdAt: undefined },
      warnings,
      sourceRow,
    })),
  };
}

// ---------------------------------------------------------------------------
// parseViaduct
// ---------------------------------------------------------------------------
describe("parseViaduct", () => {
  it("parses SAMPLE_VIADUCT and matches snapshot", () => {
    expect(strip(parse(viaductConnector, SAMPLE_VIADUCT))).toMatchSnapshot();
  });

  it("returns 4 legs with no errors", () => {
    const r = parse(viaductConnector, SAMPLE_VIADUCT);
    expect(r.errors).toHaveLength(0);
    expect(r.entries).toHaveLength(4);
    for (const { entry } of r.entries) {
      expect(entry.kind).toBe("leg");
      expect((entry as { mode: string }).mode).toBe("rail");
      expect(entry.source).toBe("viaduct");
    }
  });
});

// ---------------------------------------------------------------------------
// parseSetlist
// ---------------------------------------------------------------------------
describe("parseSetlist", () => {
  it("parses SAMPLE_SETLIST and matches snapshot", () => {
    expect(strip(parse(setlistConnector, SAMPLE_SETLIST))).toMatchSnapshot();
  });

  it("returns 3 events with no errors", () => {
    const r = parse(setlistConnector, SAMPLE_SETLIST);
    expect(r.errors).toHaveLength(0);
    expect(r.entries).toHaveLength(3);
    for (const { entry } of r.entries) {
      expect(entry.kind).toBe("event");
      expect(entry.source).toBe("setlistfm");
    }
  });
});

// ---------------------------------------------------------------------------
// parseGeneric — stays
// ---------------------------------------------------------------------------
describe("parseGeneric (stays)", () => {
  it("parses SAMPLE_GENERIC and matches snapshot", () => {
    expect(strip(parse(genericConnector, SAMPLE_GENERIC))).toMatchSnapshot();
  });

  it("returns 4 stays with no errors", () => {
    const r = parse(genericConnector, SAMPLE_GENERIC);
    expect(r.errors).toHaveLength(0);
    expect(r.entries).toHaveLength(4);
    for (const { entry } of r.entries) {
      expect(entry.kind).toBe("stay");
    }
  });
});

// ---------------------------------------------------------------------------
// parseGeneric — life events (SAMPLE_LIFE)
// ---------------------------------------------------------------------------
describe("parseGeneric (life events)", () => {
  it("parses SAMPLE_LIFE and matches snapshot", () => {
    expect(strip(parse(genericConnector, SAMPLE_LIFE))).toMatchSnapshot();
  });

  it("returns 5 events with no errors", () => {
    const r = parse(genericConnector, SAMPLE_LIFE);
    expect(r.errors).toHaveLength(0);
    expect(r.entries).toHaveLength(5);
    for (const { entry } of r.entries) {
      expect(entry.kind).toBe("event");
    }
  });
});

// ---------------------------------------------------------------------------
// parseGeneric — unknown type rows
// ---------------------------------------------------------------------------
describe("parseGeneric (unknown type)", () => {
  it("emits an error for an unrecognised type and produces no entry", () => {
    const csv = `type,start,title\nunknown_type,2026-01-01,Foo`;
    const r = parse(genericConnector, csv);
    expect(r.entries).toHaveLength(0);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/unknown type/i);
  });
});

// ---------------------------------------------------------------------------
// parseGeneric — batch-duplicate (same dedupeKey twice in one file)
// ---------------------------------------------------------------------------
describe("parseGeneric (batch-duplicate rows)", () => {
  it("produces two entries with the same dedupeKey for identical rows", () => {
    const csv = [
      "type,start,title,venue,city",
      "concert,2026-05-01,Band A,Venue X,London",
      "concert,2026-05-01,Band A,Venue X,London",
    ].join("\n");
    const r = parse(genericConnector, csv);
    expect(r.entries).toHaveLength(2);
    expect(r.errors).toHaveLength(0);
    expect(r.entries[0].entry.dedupeKey).toBe(r.entries[1].entry.dedupeKey);
  });
});

// ---------------------------------------------------------------------------
// detectConnector
// ---------------------------------------------------------------------------
describe("detectConnector", () => {
  it("detects viaduct from SAMPLE_VIADUCT content", () => {
    expect(detectConnector("export.csv", SAMPLE_VIADUCT).id).toBe("viaduct");
  });

  it("detects setlistfm from SAMPLE_SETLIST content", () => {
    expect(detectConnector("attended.json", SAMPLE_SETLIST).id).toBe("setlistfm");
  });

  it("detects setlistfm from filename alone", () => {
    expect(detectConnector("my-setlist-export.csv", "date,artist,venue\n").id).toBe("setlistfm");
  });

  it("falls back to generic for SAMPLE_GENERIC", () => {
    expect(detectConnector("export.csv", SAMPLE_GENERIC).id).toBe("generic");
  });

  it("falls back to generic for SAMPLE_LIFE", () => {
    expect(detectConnector("life.csv", SAMPLE_LIFE).id).toBe("generic");
  });
});

// ---------------------------------------------------------------------------
// Flightradar24 rejection (tested via stageFile — it throws before any DB I/O)
// ---------------------------------------------------------------------------
describe("stageFile – Flightradar24 rejection", () => {
  it("throws the canonical error message for FR24 exports", async () => {
    const fr24 =
      "Flight Number,Dep Time,Arr Time,Aircraft\nAB123,10:00,12:00,A320\n";
    await expect(stageFile("myflights.csv", fr24)).rejects.toThrow(
      "Flightradar24 exports are not supported. Use a generic flight CSV or add flights manually.",
    );
  });
});

// ---------------------------------------------------------------------------
// DM7 — source-agnostic event keys
// ---------------------------------------------------------------------------
describe("eventKey (connectors/keys)", () => {
  it("produces source-agnostic key with event| prefix", () => {
    expect(eventKey({ start: "2023-06-15", artist: "Radiohead" })).toBe(
      "event|2023-06-15|radiohead",
    );
  });

  it("lowercases the artist name", () => {
    expect(eventKey({ start: "2024-03-01", artist: "The National" })).toBe(
      "event|2024-03-01|the national",
    );
  });

  it("slices the start to date-only when a time component is present", () => {
    expect(eventKey({ start: "2024-03-01T20:00:00", artist: "Blur" })).toBe(
      "event|2024-03-01|blur",
    );
  });

  it("setlistfm connector emits source-agnostic dedupeKey", () => {
    const csv = "date,artist,venue,city,country\n2023-06-15,Radiohead,Glastonbury,Glastonbury,UK";
    const r = setlistConnector.parse({ name: "", text: csv }) as ParseResult;
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0].entry.dedupeKey).toBe("event|2023-06-15|radiohead");
  });

  it("generic connector emits source-agnostic dedupeKey for concert rows", () => {
    const csv = "type,start,title,venue,city\nconcert,2023-06-15,Radiohead,Glastonbury,Glastonbury";
    const r = genericConnector.parse({ name: "", text: csv }) as ParseResult;
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0].entry.dedupeKey).toBe("event|2023-06-15|radiohead");
  });

  it("same concert from setlistfm and generic produces identical dedupeKey", () => {
    const setlistCsv = "date,artist,venue,city\n2023-06-15,Radiohead,Glastonbury,Glastonbury";
    const genericCsv = "type,start,title,venue,city\nconcert,2023-06-15,Radiohead,Glastonbury,Glastonbury";
    const setlistResult = setlistConnector.parse({ name: "", text: setlistCsv }) as ParseResult;
    const genericResult = genericConnector.parse({ name: "", text: genericCsv }) as ParseResult;
    expect(setlistResult.entries[0].entry.dedupeKey).toBe(
      genericResult.entries[0].entry.dedupeKey,
    );
  });
});
