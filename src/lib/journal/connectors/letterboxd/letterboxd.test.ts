import { describe, it, expect } from "vitest";
import { connector } from "./index";
import type { Film } from "../../types";
import diaryText from "./fixtures/diary.csv?raw";
import reviewsText from "./fixtures/reviews.csv?raw";

describe("letterboxd connector", () => {
  it("has correct metadata", () => {
    expect(connector.id).toBe("letterboxd");
    expect(connector.label).toBe("Letterboxd diary / reviews");
    expect(connector.kind).toBe("file");
    expect(connector.tier).toBe(2);
    expect(connector.accepts).toContain(".csv");
  });

  describe("diary.csv", () => {
    it("parses fixture without errors", () => {
      const r = connector.parse({ name: "diary.csv", text: diaryText });
      if (r instanceof Promise) throw new Error("expected sync parse");
      expect(r.errors).toHaveLength(0);
      expect(r.entries).toHaveLength(3);
    });

    it("produces Film entries with correct source and tier", () => {
      const r = connector.parse({ name: "diary.csv", text: diaryText });
      if (r instanceof Promise) throw new Error("expected sync parse");
      for (const { entry } of r.entries) {
        expect(entry.kind).toBe("film");
        expect(entry.source).toBe("letterboxd");
        expect(entry.tier).toBe(2);
        expect(entry.datePrecision).toBe("day");
      }
    });

    it("maps rating ×2 onto 0–10 scale", () => {
      const r = connector.parse({ name: "diary.csv", text: diaryText });
      if (r instanceof Promise) throw new Error("expected sync parse");
      const deadpool = r.entries.find(
        ({ entry }) => (entry as Film).title === "Deadpool & Wolverine",
      );
      // diary.csv rating = 3 → 3 × 2 = 6
      expect((deadpool!.entry as Film).rating).toBe(6);
    });

    it("leaves unrated entries without a rating", () => {
      const r = connector.parse({ name: "diary.csv", text: diaryText });
      if (r instanceof Promise) throw new Error("expected sync parse");
      const dune = r.entries.find(
        ({ entry }) => (entry as Film).title === "Dune: Part Two",
      );
      expect((dune!.entry as Film).rating).toBeUndefined();
    });

    it("sets rewatch flag only when source says Yes", () => {
      const r = connector.parse({ name: "diary.csv", text: diaryText });
      if (r instanceof Promise) throw new Error("expected sync parse");
      const dk = r.entries.find(
        ({ entry }) => (entry as Film).title === "The Dark Knight",
      );
      const deadpool = r.entries.find(
        ({ entry }) => (entry as Film).title === "Deadpool & Wolverine",
      );
      expect((dk!.entry as Film).rewatch).toBe(true);
      expect((deadpool!.entry as Film).rewatch).toBeUndefined();
    });

    it("sets source-agnostic dedupeKey", () => {
      const r = connector.parse({ name: "diary.csv", text: diaryText });
      if (r instanceof Promise) throw new Error("expected sync parse");
      for (const { entry } of r.entries) {
        expect(entry.dedupeKey).toMatch(/^film\|/);
      }
      const deadpool = r.entries.find(
        ({ entry }) => (entry as Film).title === "Deadpool & Wolverine",
      );
      expect(deadpool!.entry.dedupeKey).toBe("film|deadpool & wolverine|2024|2024-08-11");
    });

    it("sets sourceRef to the Letterboxd URI", () => {
      const r = connector.parse({ name: "diary.csv", text: diaryText });
      if (r instanceof Promise) throw new Error("expected sync parse");
      const deadpool = r.entries.find(
        ({ entry }) => (entry as Film).title === "Deadpool & Wolverine",
      );
      expect(deadpool!.entry.sourceRef).toBe("https://boxd.it/gyyOR7");
    });

    it("uses Watched Date not Date as start", () => {
      const r = connector.parse({ name: "diary.csv", text: diaryText });
      if (r instanceof Promise) throw new Error("expected sync parse");
      const deadpool = r.entries.find(
        ({ entry }) => (entry as Film).title === "Deadpool & Wolverine",
      );
      // Watched Date = 2024-08-11, Date (log date) = 2026-09-30 — must use watched date
      expect(deadpool!.entry.start).toBe("2024-08-11");
    });
  });

  describe("reviews.csv", () => {
    it("parses fixture without errors", () => {
      const r = connector.parse({ name: "reviews.csv", text: reviewsText });
      if (r instanceof Promise) throw new Error("expected sync parse");
      expect(r.errors).toHaveLength(0);
      expect(r.entries).toHaveLength(1);
    });

    it("populates reflection from Review column", () => {
      const r = connector.parse({ name: "reviews.csv", text: reviewsText });
      if (r instanceof Promise) throw new Error("expected sync parse");
      const entry = r.entries[0].entry as Film;
      expect(entry.reflection).toBe("Great fun but runs about 20 minutes too long.");
    });

    it("shares the same dedupeKey as the diary entry for the same watch", () => {
      const diary = connector.parse({ name: "diary.csv", text: diaryText });
      const reviews = connector.parse({ name: "reviews.csv", text: reviewsText });
      if (diary instanceof Promise || reviews instanceof Promise) throw new Error("expected sync");
      const diaryKey = diary.entries.find(
        ({ entry }) => (entry as Film).title === "Deadpool & Wolverine",
      )!.entry.dedupeKey;
      const reviewKey = reviews.entries[0].entry.dedupeKey;
      expect(reviewKey).toBe(diaryKey);
    });
  });

  describe("sniff", () => {
    it("scores high for diary.csv filename", () => {
      expect(connector.sniff!("diary.csv", "")).toBeGreaterThan(0.5);
    });

    it("scores high for reviews.csv filename", () => {
      expect(connector.sniff!("reviews.csv", "")).toBeGreaterThan(0.5);
    });

    it("scores high for Letterboxd header content", () => {
      const head = "date,name,year,letterboxd uri,rating,rewatch,tags,watched date";
      expect(connector.sniff!("export.csv", head)).toBeGreaterThan(0.5);
    });

    it("scores zero for unrelated content", () => {
      expect(connector.sniff!("stations.csv", "date,origin,destination,operator")).toBe(0);
    });
  });
});
