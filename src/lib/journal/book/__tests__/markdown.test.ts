/**
 * WP3 of docs/specs/book-export.md: Markdown renderer.
 */
import { beforeEach, describe, expect, test } from "vitest";
import { buildBookModel, renderMarkdown, type BookDefinition, type BookModel } from "..";
import { makeFixture, type Fixture } from "./fixtures";

let fx: Fixture;
beforeEach(async () => {
  fx = await makeFixture();
});

const def = (over: Partial<BookDefinition> = {}): BookDefinition => ({
  title: "Our 2026",
  start: "2026-01-01",
  end: "2026-12-31",
  chapterMode: "year",
  ...over,
});
const opts = { generatedOn: "2026-10-24" };

/** A tiny hand-made model for cases the importer fixtures do not reach. */
function model(
  blocks: BookModel["chapters"][0]["sections"][0]["blocks"],
  meta: Partial<BookModel["meta"]> = {},
): BookModel {
  return {
    meta: {
      title: "T",
      language: "en",
      dateRange: { start: "2026-01-01", end: "2026-12-31" },
      chapterMode: "year",
      sources: [],
      generatedOn: "2026-10-24",
      ...meta,
    },
    chapters: [
      {
        id: "year-2026",
        kind: "year",
        title: "2026",
        dateRange: { start: "2026-01-01", end: "2026-12-31" },
        sections: [{ id: "s1", kind: "plain", entryIds: [], blocks }],
      },
    ],
    stats: { entryCount: 0, excludedCount: 0 },
  };
}

describe("front matter", () => {
  test("title, subtitle, range, dedication and colophon", () => {
    const m = model([], {
      title: "Our 2026",
      subtitle: "A year at home",
      dedication: "For Maia\nand Maxim",
      sources: ["Calendar", "Goodreads"],
    });
    const { markdown } = renderMarkdown(m);
    expect(
      markdown.startsWith("# Our 2026\n\n*A year at home*\n\n1 Jan 2026 to 31 Dec 2026\n"),
    ).toBe(true);
    expect(markdown).toContain("*For Maia*  \n*and Maxim*");
    expect(markdown).toContain(
      "Compiled by Chronicle from: Calendar, Goodreads. Generated 24 Oct 2026.",
    );
  });

  test("no sources gives a shorter colophon", () => {
    expect(renderMarkdown(model([])).markdown).toContain(
      "Compiled by Chronicle. Generated 24 Oct 2026.",
    );
  });

  test("cover image is referenced first", () => {
    const r = renderMarkdown(model([{ type: "photo", mediaId: "m2" }], { coverMediaId: "m1" }));
    expect(r.markdown).toContain("![Cover](media/photo-001.jpg)");
    expect(r.markdown).toContain("![Photo](media/photo-002.jpg)");
    expect(r.media).toEqual([
      { mediaId: "m1", path: "media/photo-001.jpg" },
      { mediaId: "m2", path: "media/photo-002.jpg" },
    ]);
  });
});

describe("blocks", () => {
  test("headings: chapter ##, trip ###, entry ####, never above ###", () => {
    const { markdown } = renderMarkdown(
      model([
        { type: "heading", level: 3, text: "Japan" },
        { type: "heading", level: 4, text: "Dune" },
        { type: "heading", level: 1, text: "Odd" },
      ]),
    );
    expect(markdown).toContain("\n## 2026\n");
    expect(markdown).toContain("\n### Japan\n");
    expect(markdown).toContain("\n#### Dune\n");
    expect(markdown).toContain("\n### Odd\n");
  });

  test("date lines: day, span, time, label, precision", () => {
    const { markdown } = renderMarkdown(
      model([
        { type: "dateLine", date: "2026-01-04" },
        { type: "dateLine", date: "2026-01-04", endDate: "2026-01-06" },
        { type: "dateLine", date: "2026-01-04", time: "14:30", label: "Day 3 of the journey" },
        { type: "dateLine", date: "2010-12-15", precision: "month" },
        { type: "dateLine", date: "2010-01-01", precision: "year" },
        { type: "dateLine", date: "2010-01-01", precision: "unknown" },
      ]),
    );
    expect(markdown).toContain("**4 Jan 2026**\n");
    expect(markdown).toContain("**4 Jan 2026 to 6 Jan 2026**");
    expect(markdown).toContain("**4 Jan 2026, 14:30 · Day 3 of the journey**");
    expect(markdown).toContain("**December 2010**");
    expect(markdown).toContain("**2010**");
    expect(markdown).not.toContain("1 Jan 2010");
  });

  test("quote with attribution, and italic reflection", () => {
    const { markdown } = renderMarkdown(
      model([
        { type: "quote", text: "Loved it.\nTwice.", attribution: "Goodreads" },
        { type: "paragraph", text: "We cried.", italic: true },
      ]),
    );
    expect(markdown).toContain("> Loved it.\n> Twice.\n>\n> Source: Goodreads");
    expect(markdown).toContain("\n*We cried.*\n");
  });

  test("table: pipe table, icon column as text, ragged rows padded", () => {
    const { markdown } = renderMarkdown(
      model([
        {
          type: "table",
          caption: "Legs",
          columns: ["Time", "From", "To"],
          rows: [
            { icon: "plane", cells: ["08:00", "DUB", "BER"] },
            { icon: "hotel", cells: ["", "Hotel | Inn"] },
          ],
        },
      ]),
    );
    expect(markdown).toContain(
      "**Legs**\n\n| Type | Time | From | To |\n| --- | --- | --- | --- |\n| Flight | 08:00 | DUB | BER |\n| Stay |   | Hotel \\| Inn |   |",
    );
  });

  test("table without icons has no Type column", () => {
    const { markdown } = renderMarkdown(
      model([{ type: "table", columns: ["A", "B"], rows: [{ cells: ["1", "2"] }] }]),
    );
    expect(markdown).toContain("| A | B |\n| --- | --- |\n| 1 | 2 |");
    expect(markdown).not.toContain("Type");
  });

  test("photo reuse gives one media entry; caption becomes alt text", () => {
    const r = renderMarkdown(
      model([
        { type: "photo", mediaId: "a", caption: "Sunset [west]" },
        { type: "photo", mediaId: "a" },
      ]),
    );
    expect(r.markdown).toContain("![Sunset \\[west\\]](media/photo-001.jpg)");
    expect(r.markdown.match(/photo-001/g)).toHaveLength(2);
    expect(r.media).toHaveLength(1);
  });

  test("custom media path function", () => {
    const r = renderMarkdown(model([{ type: "photo", mediaId: "abc" }]), {
      mediaPath: (id) => `media/${id}.jpg`,
    });
    expect(r.media[0].path).toBe("media/abc.jpg");
  });
});

describe("escaping", () => {
  test("inline markup characters are escaped", () => {
    const { markdown } = renderMarkdown(
      model([{ type: "paragraph", text: "a *b* _c_ `d` <e> [f] g|h" }]),
    );
    expect(markdown).toContain("a \\*b\\* \\_c\\_ \\`d\\` \\<e\\> \\[f\\] g\\|h");
  });

  test("line-start markers are escaped", () => {
    const { markdown } = renderMarkdown(
      model([
        { type: "paragraph", text: "# not a heading" },
        { type: "paragraph", text: "- not a list" },
        { type: "paragraph", text: "1. not a list" },
        { type: "paragraph", text: "> not a quote" },
      ]),
    );
    expect(markdown).toContain("\n\\# not a heading\n");
    expect(markdown).toContain("\n\\- not a list\n");
    expect(markdown).toContain("\n1\\. not a list\n");
    expect(markdown).toContain("\n\\> not a quote\n");
  });

  test("multi-line paragraph keeps hard breaks", () => {
    const { markdown } = renderMarkdown(model([{ type: "paragraph", text: "one\n\ntwo" }]));
    expect(markdown).toContain("one  \ntwo");
  });
});

describe("whole book from importer fixtures", () => {
  test("year mode", () => {
    const model = buildBookModel(fx.data, def(), opts);
    const r = renderMarkdown(model);
    expect(r.markdown).toContain("## 2026");
    expect(r.markdown).toContain("### Berlin and Hamburg");
    expect(r.markdown).toContain("### Japan");
    expect(r.markdown).toContain("| Type |");
    expect(r.markdown.endsWith("\n")).toBe(true);
    expect(r.markdown.endsWith("\n\n")).toBe(false);
  });

  test("trip mode has trip and gap chapters as ##", () => {
    const r = renderMarkdown(buildBookModel(fx.data, def({ chapterMode: "trip" }), opts));
    expect(r.markdown).toContain("## Berlin and Hamburg");
    expect(r.markdown).toContain("## Japan");
    expect(r.markdown).toMatch(/\n## [A-Z][a-z]+ (to [A-Z][a-z]+ )?20\d\d\n/);
    expect(r.markdown).not.toMatch(/\n### Berlin and Hamburg\n/);
  });

  test("plain markdown: no HTML tags, no em dashes, no raw ids", () => {
    const model = buildBookModel(fx.data, def(), opts);
    const { markdown } = renderMarkdown(model);
    expect(markdown).not.toMatch(/<[a-zA-Z/]/);
    expect(markdown).not.toContain("—");
    for (const e of Object.values(fx.e)) expect(markdown).not.toContain(e.id);
  });

  test("deterministic", () => {
    const a = renderMarkdown(buildBookModel(fx.data, def(), opts)).markdown;
    const b = renderMarkdown(buildBookModel(fx.data, def(), opts)).markdown;
    expect(a).toBe(b);
  });

  test("empty book still renders front matter", () => {
    const r = renderMarkdown(
      buildBookModel(fx.data, def({ start: "1990-01-01", end: "1990-12-31" }), opts),
    );
    expect(r.markdown).toContain("# Our 2026");
    expect(r.media).toEqual([]);
  });
});

describe("hasMedia", () => {
  test("photos and cover for unavailable media are omitted", () => {
    const r = renderMarkdown(
      model(
        [
          { type: "photo", mediaId: "ok" },
          { type: "photo", mediaId: "gone" },
        ],
        {
          coverMediaId: "gone",
        },
      ),
      { hasMedia: (id) => id === "ok" },
    );
    expect(r.markdown).not.toContain("Cover");
    expect(r.markdown).toContain("![Photo](media/photo-001.jpg)");
    expect(r.media).toEqual([{ mediaId: "ok", path: "media/photo-001.jpg" }]);
  });
});
