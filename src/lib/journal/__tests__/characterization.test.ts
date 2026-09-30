/**
 * Characterization tests — written BEFORE the refactor.
 *
 * They import from parsers.ts (current location).  After the refactor,
 * parsers.ts becomes a thin re-export of the connector modules so all imports
 * continue to resolve and the snapshots must be bit-for-bit identical.
 */
import { describe, it, expect } from "vitest";
import {
  parseViaduct,
  parseSetlist,
  parseGeneric,
  detectSource,
  type ParseResult,
} from "@/lib/journal/parsers";
import { stageFile } from "@/lib/journal/staging";
import {
  SAMPLE_VIADUCT,
  SAMPLE_SETLIST,
  SAMPLE_GENERIC,
  SAMPLE_LIFE,
} from "@/lib/journal/samples";

// ---------------------------------------------------------------------------
// Strip volatile fields so snapshots are deterministic
// ---------------------------------------------------------------------------
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
    expect(strip(parseViaduct(SAMPLE_VIADUCT))).toMatchSnapshot();
  });

  it("returns 4 legs with no errors", () => {
    const r = parseViaduct(SAMPLE_VIADUCT);
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
    expect(strip(parseSetlist(SAMPLE_SETLIST))).toMatchSnapshot();
  });

  it("returns 3 events with no errors", () => {
    const r = parseSetlist(SAMPLE_SETLIST);
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
    expect(strip(parseGeneric(SAMPLE_GENERIC))).toMatchSnapshot();
  });

  it("returns 4 stays with no errors", () => {
    const r = parseGeneric(SAMPLE_GENERIC);
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
    expect(strip(parseGeneric(SAMPLE_LIFE))).toMatchSnapshot();
  });

  it("returns 5 events with no errors", () => {
    const r = parseGeneric(SAMPLE_LIFE);
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
    const r = parseGeneric(csv);
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
    const r = parseGeneric(csv);
    expect(r.entries).toHaveLength(2);
    expect(r.errors).toHaveLength(0);
    expect(r.entries[0].entry.dedupeKey).toBe(r.entries[1].entry.dedupeKey);
  });
});

// ---------------------------------------------------------------------------
// detectSource
// ---------------------------------------------------------------------------
describe("detectSource", () => {
  it("detects viaduct from SAMPLE_VIADUCT content", () => {
    expect(detectSource("export.csv", SAMPLE_VIADUCT)).toBe("viaduct");
  });

  it("detects setlistfm from SAMPLE_SETLIST content", () => {
    expect(detectSource("attended.json", SAMPLE_SETLIST)).toBe("setlistfm");
  });

  it("detects setlistfm from filename alone", () => {
    expect(detectSource("my-setlist-export.csv", "date,artist,venue\n")).toBe("setlistfm");
  });

  it("falls back to generic for SAMPLE_GENERIC", () => {
    expect(detectSource("export.csv", SAMPLE_GENERIC)).toBe("generic");
  });

  it("falls back to generic for SAMPLE_LIFE", () => {
    expect(detectSource("life.csv", SAMPLE_LIFE)).toBe("generic");
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
