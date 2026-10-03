import { describe, it, expect } from "vitest";
import { connector } from "./index";
import type { Film, Episode } from "../../types";
import sampleText from "./fixtures/sample.csv?raw";

describe("netflix connector", () => {
  it("has correct metadata", () => {
    expect(connector.id).toBe("netflix");
    expect(connector.label).toBe("Netflix viewing history");
    expect(connector.kind).toBe("file");
    expect(connector.tier).toBe(3);
    expect(connector.accepts).toContain(".csv");
  });

  it("parses fixture without errors", async () => {
    const r = await connector.parse({ name: "NetflixViewingHistory.csv", text: sampleText });
    expect(r.errors).toHaveLength(0);
    expect(r.entries).toHaveLength(3);
  });

  it("assigns correct source and tier to all entries", async () => {
    const r = await connector.parse({ name: "NetflixViewingHistory.csv", text: sampleText });
    for (const { entry } of r.entries) {
      expect(entry.source).toBe("netflix");
      expect(entry.tier).toBe(3);
      expect(entry.datePrecision).toBe("day");
    }
  });

  describe("title parsing", () => {
    it("routes a bare title to a Film", async () => {
      const r = await connector.parse({ name: "NetflixViewingHistory.csv", text: sampleText });
      const film = r.entries.find(({ entry }) => entry.kind === "film");
      expect(film).toBeDefined();
      expect((film!.entry as Film).title).toBe("Oppenheimer");
    });

    it("routes 'Show: Season N: Episode' to an Episode", async () => {
      const r = await connector.parse({ name: "NetflixViewingHistory.csv", text: sampleText });
      const bridgerton = r.entries.find(
        ({ entry }) => entry.kind === "episode" && (entry as Episode).showTitle === "Bridgerton",
      );
      expect(bridgerton).toBeDefined();
      const ep = bridgerton!.entry as Episode;
      expect(ep.season).toBe("Season 4");
      expect(ep.episodeTitle).toBe("A Courtship");
    });

    it("routes 'Show: Limited Series: Episode' to an Episode", async () => {
      const r = await connector.parse({ name: "NetflixViewingHistory.csv", text: sampleText });
      const crown = r.entries.find(
        ({ entry }) => entry.kind === "episode" && (entry as Episode).showTitle === "The Crown",
      );
      expect(crown).toBeDefined();
      const ep = crown!.entry as Episode;
      expect(ep.season).toBe("Limited Series");
      expect(ep.episodeTitle).toBe("Fairytale");
    });
  });

  describe("date parsing", () => {
    it("converts M/D/YY to YYYY-MM-DD", async () => {
      const r = await connector.parse({ name: "NetflixViewingHistory.csv", text: sampleText });
      const film = r.entries.find(({ entry }) => entry.kind === "film");
      // 9/29/26 → 2026-09-29
      expect(film!.entry.start).toBe("2026-09-29");
    });

    it("anchors two-digit years: 00–29 → 2000–2029", async () => {
      const text = "Title,Date\nSome Film,1/1/25";
      const r = await connector.parse({ name: "NetflixViewingHistory.csv", text });
      expect(r.entries[0].entry.start).toBe("2025-01-01");
    });
  });

  describe("dedupeKey", () => {
    it("sets source-agnostic film key", async () => {
      const r = await connector.parse({ name: "NetflixViewingHistory.csv", text: sampleText });
      const film = r.entries.find(({ entry }) => entry.kind === "film");
      expect(film!.entry.dedupeKey).toBe("film|oppenheimer|2026-09-29");
    });

    it("sets source-agnostic episode key", async () => {
      const r = await connector.parse({ name: "NetflixViewingHistory.csv", text: sampleText });
      const bridgerton = r.entries.find(
        ({ entry }) => entry.kind === "episode" && (entry as Episode).showTitle === "Bridgerton",
      );
      expect(bridgerton!.entry.dedupeKey).toBe(
        "episode|bridgerton|season 4|a courtship|2026-06-01",
      );
    });
  });

  describe("sniff", () => {
    it("scores high for NetflixViewingHistory filename", () => {
      expect(connector.sniff!("NetflixViewingHistory.csv", "")).toBeGreaterThan(0.5);
    });

    it("scores high for filename containing 'netflix'", () => {
      expect(connector.sniff!("netflix_export.csv", "")).toBeGreaterThan(0.5);
    });

    it("scores zero for unrelated content", () => {
      expect(connector.sniff!("diary.csv", "watched date,name,year,letterboxd uri")).toBe(0);
    });
  });
});
