import { describe, it, expect } from "vitest";
import { connector } from "./index";
import sampleText from "./fixtures/sample.csv?raw";

describe("viaduct connector", () => {
  it("has correct metadata", () => {
    expect(connector.id).toBe("viaduct");
    expect(connector.label).toBe("Viaduct rail CSV");
    expect(connector.kind).toBe("file");
    expect(connector.tier).toBe(2);
    expect(connector.accepts).toContain(".csv");
  });

  it("parses the fixture without errors", () => {
    const r = connector.parse({ name: "sample.csv", text: sampleText });
    if (r instanceof Promise) throw new Error("expected sync parse");
    expect(r.errors).toHaveLength(0);
    expect(r.entries).toHaveLength(4);
  });

  it("produces rail legs with correct source", () => {
    const r = connector.parse({ name: "sample.csv", text: sampleText });
    if (r instanceof Promise) throw new Error("expected sync parse");
    for (const { entry } of r.entries) {
      expect(entry.kind).toBe("leg");
      expect((entry as { mode: string }).mode).toBe("rail");
      expect(entry.source).toBe("viaduct");
      expect(entry.tier).toBe(2);
    }
  });

  it("sets dedupeKeys on all entries", () => {
    const r = connector.parse({ name: "sample.csv", text: sampleText });
    if (r instanceof Promise) throw new Error("expected sync parse");
    for (const { entry } of r.entries) {
      expect(entry.dedupeKey).toMatch(/^leg\|/);
    }
  });

  describe("sniff", () => {
    it("scores high for a viaduct filename", () => {
      expect(connector.sniff!("viaduct-journeys.csv", "")).toBeGreaterThan(0.5);
    });

    it("scores high for station/origin/operator content", () => {
      const head = "date,origin,destination,departure time,arrival time,operator,train number";
      expect(connector.sniff!("export.csv", head)).toBeGreaterThan(0.5);
    });

    it("scores zero for unrelated content", () => {
      expect(connector.sniff!("diary.csv", "watcheddate,film,rating")).toBe(0);
    });
  });
});
