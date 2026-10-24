import { describe, expect, test } from "vitest";
import { buildMarkdownPackage, type BookModel } from "..";

const bytes = (n: number) => new Uint8Array([n, n, n]);

function model(): BookModel {
  return {
    meta: {
      title: "T",
      language: "en",
      dateRange: { start: "2026-01-01", end: "2026-12-31" },
      chapterMode: "year",
      sources: [],
      generatedOn: "2026-10-24",
      coverMediaId: "a",
    },
    chapters: [
      {
        id: "y",
        kind: "year",
        title: "2026",
        dateRange: { start: "2026-01-01", end: "2026-12-31" },
        sections: [
          {
            id: "s",
            kind: "plain",
            entryIds: [],
            blocks: [
              { type: "photo", mediaId: "b" },
              { type: "photo", mediaId: "c" },
            ],
          },
        ],
      },
    ],
    stats: { entryCount: 0, excludedCount: 0 },
  };
}

describe("buildMarkdownPackage", () => {
  test("book.md plus one file per image, loaded sequentially", async () => {
    let active = 0;
    let peak = 0;
    const p = await buildMarkdownPackage(model(), async (id) => {
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active--;
      return bytes(id.charCodeAt(0));
    });
    expect(p.missing).toEqual([]);
    expect(p.files.map((f) => f.path)).toEqual([
      "book.md",
      "media/photo-001.jpg",
      "media/photo-002.jpg",
      "media/photo-003.jpg",
    ]);
    expect(peak).toBe(1);
  });

  test("failed and empty images are reported and never linked", async () => {
    const p = await buildMarkdownPackage(model(), async (id) => {
      if (id === "b") throw new Error("boom");
      if (id === "c") return null;
      return bytes(1);
    });
    expect(p.missing).toEqual(["b", "c"]);
    expect(p.files.map((f) => f.path)).toEqual(["book.md", "media/photo-001.jpg"]);
    const md = p.files[0].data as string;
    expect(md).toContain("![Cover](media/photo-001.jpg)");
    expect(md).not.toContain("photo-002");
  });
});
