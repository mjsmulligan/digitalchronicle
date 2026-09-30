import { describe, it, expect } from "vitest";
import { connector } from "./index";
import sampleText from "./fixtures/sample.json?raw";

describe("setlistfm connector", () => {
  it("has correct metadata", () => {
    expect(connector.id).toBe("setlistfm");
    expect(connector.label).toBe("setlist.fm JSON/CSV");
    expect(connector.kind).toBe("file");
    expect(connector.tier).toBe(2);
    expect(connector.accepts).toContain(".json");
    expect(connector.accepts).toContain(".csv");
  });

  it("parses the fixture without errors", () => {
    const r = connector.parse({ name: "sample.json", text: sampleText });
    if (r instanceof Promise) throw new Error("expected sync parse");
    expect(r.errors).toHaveLength(0);
    expect(r.entries).toHaveLength(3);
  });

  it("produces concert events with correct source", () => {
    const r = connector.parse({ name: "sample.json", text: sampleText });
    if (r instanceof Promise) throw new Error("expected sync parse");
    for (const { entry } of r.entries) {
      expect(entry.kind).toBe("event");
      expect((entry as { category: string }).category).toBe("concert");
      expect(entry.source).toBe("setlistfm");
      expect(entry.tier).toBe(2);
    }
  });

  it("preserves setlists", () => {
    const r = connector.parse({ name: "sample.json", text: sampleText });
    if (r instanceof Promise) throw new Error("expected sync parse");
    const caribou = r.entries.find(
      ({ entry }) => "artist" in entry && entry.artist === "Caribou",
    );
    expect(caribou).toBeDefined();
    expect(
      (caribou!.entry as { setlist?: string[] }).setlist,
    ).toContain("Sun");
  });

  describe("sniff", () => {
    it("scores high for setlist filename", () => {
      expect(connector.sniff!("setlist-export.json", "")).toBeGreaterThan(0.5);
    });

    it("scores high for eventdate content", () => {
      expect(
        connector.sniff!("export.json", '[ { "eventdate": "01-01-2026"'),
      ).toBeGreaterThan(0.5);
    });

    it("scores zero for unrelated content", () => {
      expect(
        connector.sniff!("stations.csv", "date,origin,destination,operator"),
      ).toBe(0);
    });
  });
});
