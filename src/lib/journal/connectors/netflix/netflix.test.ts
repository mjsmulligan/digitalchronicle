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

    it("routes 'Show: Chapter One: Episode' (ordinal word) to an Episode", async () => {
      // Stranger Things Season 1 uses word ordinals instead of digits
      const text = [
        "Title,Date",
        "Stranger Things: Chapter One: The Vanishing of Will Byers,7/1/25",
        "Stranger Things: Chapter Two: The Weirdo on Maple Street,7/1/25",
        "Stranger Things: Chapter Three: Holly Jolly,7/2/25",
      ].join("\n");
      const r = await connector.parse({ name: "NetflixViewingHistory.csv", text });
      expect(r.errors).toHaveLength(0);
      for (const { entry } of r.entries) {
        expect(entry.kind).toBe("episode");
        expect((entry as Episode).showTitle).toBe("Stranger Things");
        expect((entry as Episode).season).toBe(
          entry === r.entries[0].entry ? "Chapter One"
          : entry === r.entries[1].entry ? "Chapter Two"
          : "Chapter Three",
        );
      }
      expect((r.entries[0].entry as Episode).episodeTitle).toBe("The Vanishing of Will Byers");
    });

    it("routes 'Show: Show N: Chapter X: Episode' (season as repeated title+digit) to an Episode", async () => {
      // Stranger Things S2–5 use "Stranger Things 2/3/4/5" as the season segment
      const text = [
        "Title,Date",
        "Stranger Things: Stranger Things 5: Chapter One: The Crawl,10/1/25",
        "Stranger Things: Stranger Things 5: Chapter Two: The Vanishing of Holly Wheeler,10/2/25",
      ].join("\n");
      const r = await connector.parse({ name: "NetflixViewingHistory.csv", text });
      expect(r.errors).toHaveLength(0);
      expect(r.entries).toHaveLength(2);
      const ep = r.entries[0].entry as Episode;
      expect(ep.kind).toBe("episode");
      expect(ep.showTitle).toBe("Stranger Things");
      expect(ep.season).toBe("Stranger Things 5");
      expect(ep.episodeTitle).toBe("Chapter One: The Crawl");
    });

    it("routes 'Franchise: SubShow: Season N: Episode' (compound title) to an Episode", async () => {
      // Star Trek: Discovery, Criminal: UK, etc. — show title spans first two colon segments
      const text = [
        "Title,Date",
        "Star Trek: Discovery: Season 3: Far from Home,9/1/25",
        "Star Trek: Discovery: Season 3: People of Earth,9/2/25",
        "Star Trek: Discovery: Context Is for Kings,9/3/25",
      ].join("\n");
      const r = await connector.parse({ name: "NetflixViewingHistory.csv", text });
      expect(r.errors).toHaveLength(0);
      expect(r.entries).toHaveLength(3);
      for (const { entry } of r.entries) {
        expect(entry.kind).toBe("episode");
        expect((entry as Episode).showTitle).toBe("Star Trek: Discovery");
      }
      // Structured season extracted when present
      expect((r.entries[0].entry as Episode).season).toBe("Season 3");
      expect((r.entries[0].entry as Episode).episodeTitle).toBe("Far from Home");
      // No season segment → empty season, full remainder as episode title
      expect((r.entries[2].entry as Episode).season).toBe("");
      expect((r.entries[2].entry as Episode).episodeTitle).toBe("Context Is for Kings");
    });

    it("does not misclassify film sequels with subtitle colons as episodes", async () => {
      // "Miss Congeniality 2: Armed and Fabulous" — appears once, no second segment
      const text = "Title,Date\nMiss Congeniality 2: Armed and Fabulous,8/1/25";
      const r = await connector.parse({ name: "NetflixViewingHistory.csv", text });
      expect(r.entries[0].entry.kind).toBe("film");
      expect((r.entries[0].entry as Film).title).toBe("Miss Congeniality 2: Armed and Fabulous");
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
