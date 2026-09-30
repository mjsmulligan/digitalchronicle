import { describe, it, expect } from "vitest";
import { connector } from "./index";
import sampleText from "./fixtures/sample.csv?raw";
import lifeText from "./fixtures/life.csv?raw";

describe("generic connector", () => {
  it("has correct metadata", () => {
    expect(connector.id).toBe("generic");
    expect(connector.label).toBe("Generic / cleaned CSV or JSON");
    expect(connector.kind).toBe("file");
    expect(connector.tier).toBe(3);
    expect(connector.accepts).toContain(".csv");
    expect(connector.accepts).toContain(".json");
  });

  it("has no sniff function (it is always the fallback)", () => {
    expect(connector.sniff).toBeUndefined();
  });

  describe("stays fixture", () => {
    it("parses without errors", () => {
      const r = connector.parse({ name: "sample.csv", text: sampleText });
      if (r instanceof Promise) throw new Error("expected sync parse");
      expect(r.errors).toHaveLength(0);
      expect(r.entries).toHaveLength(4);
    });

    it("produces stay entries", () => {
      const r = connector.parse({ name: "sample.csv", text: sampleText });
      if (r instanceof Promise) throw new Error("expected sync parse");
      for (const { entry } of r.entries) {
        expect(entry.kind).toBe("stay");
        expect(entry.source).toBe("generic");
      }
    });
  });

  describe("life events fixture", () => {
    it("parses without errors", () => {
      const r = connector.parse({ name: "life.csv", text: lifeText });
      if (r instanceof Promise) throw new Error("expected sync parse");
      expect(r.errors).toHaveLength(0);
      expect(r.entries).toHaveLength(5);
    });

    it("produces events", () => {
      const r = connector.parse({ name: "life.csv", text: lifeText });
      if (r instanceof Promise) throw new Error("expected sync parse");
      for (const { entry } of r.entries) {
        expect(entry.kind).toBe("event");
      }
    });
  });

  describe("unknown type rows", () => {
    it("emits an error and produces no entry", () => {
      const csv = `type,start,title\nunknown_type,2026-01-01,Foo`;
      const r = connector.parse({ name: "x.csv", text: csv });
      if (r instanceof Promise) throw new Error("expected sync parse");
      expect(r.entries).toHaveLength(0);
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]).toMatch(/unknown type/i);
    });
  });

  describe("batch-duplicate rows", () => {
    it("produces identical dedupeKeys for identical rows", () => {
      const csv = [
        "type,start,title,venue,city",
        "concert,2026-05-01,Band A,Venue X,London",
        "concert,2026-05-01,Band A,Venue X,London",
      ].join("\n");
      const r = connector.parse({ name: "x.csv", text: csv });
      if (r instanceof Promise) throw new Error("expected sync parse");
      expect(r.entries).toHaveLength(2);
      expect(r.errors).toHaveLength(0);
      expect(r.entries[0].entry.dedupeKey).toBe(r.entries[1].entry.dedupeKey);
    });
  });
});
