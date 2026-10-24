/**
 * WP5 of docs/specs/book-export.md: HTML for the PDF renderer.
 */
import { beforeEach, describe, expect, test } from "vitest";
import { buildBookModel, renderBookHtml, type BookDefinition, type BookModel } from "..";
import { makeFixture, type Fixture } from "./fixtures";

let fx: Fixture;
beforeEach(async () => {
  fx = await makeFixture();
});

const def = (over: Partial<BookDefinition> = {}): BookDefinition => ({
  title: "Our 2026",
  subtitle: "A year",
  start: "2026-01-01",
  end: "2026-12-31",
  chapterMode: "year",
  ...over,
});
const opts = { generatedOn: "2026-10-24" };
const PHOTO = { dataUri: "data:image/jpeg;base64,AAAA", width: 100, height: 50 };

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
        id: "y",
        kind: "year",
        title: "2026",
        dateRange: { start: "2026-01-01", end: "2026-12-31" },
        sections: [{ id: "s", kind: "plain", entryIds: [], blocks }],
      },
    ],
    stats: { entryCount: 0, excludedCount: 0 },
  };
}

describe("front matter", () => {
  test("title page, dedication, colophon and contents, in that order", () => {
    const { html } = renderBookHtml(
      model([], {
        subtitle: "Sub",
        dedication: "For M\nand M",
        sources: ["Calendar", "Goodreads"],
      }),
      { pageSize: "A4" },
    );
    const order = [
      'class="title"',
      'class="dedication"',
      'class="colophon"',
      'class="contents"',
      'class="chapter"',
    ];
    const at = order.map((s) => html.indexOf(s));
    expect(at.every((n) => n >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(html).toContain("For M<br>and M");
    expect(html).toContain("Compiled by Chronicle from: Calendar, Goodreads.");
    expect(html).toContain("Generated 24 Oct 2026.");
    expect(html).toContain("<li>2026</li>");
  });

  test("no dedication section when none is set", () => {
    expect(renderBookHtml(model([]), { pageSize: "A4" }).html).not.toContain('class="dedication"');
  });

  test("cover photo is placed on the title page when available", () => {
    const r = renderBookHtml(model([], { coverMediaId: "c" }), {
      pageSize: "A4",
      photo: () => PHOTO,
    });
    expect(r.html).toMatch(/class="title"><img src="data:image\/jpeg;base64,AAAA"/);
    expect(r.stats.photosPlaced).toBe(1);
  });
});

describe("blocks", () => {
  test("every block type renders and text is escaped", () => {
    const { html } = renderBookHtml(
      model([
        { type: "heading", level: 3, text: "Japan <1>" },
        { type: "dateLine", date: "2026-08-06", label: "Day 1 of the journey" },
        { type: "heading", level: 4, text: "Dune & co" },
        { type: "paragraph", text: 'We "cried".', italic: true },
        { type: "quote", text: "Loved it", attribution: "Goodreads" },
        {
          type: "table",
          caption: "Legs",
          columns: ["A"],
          rows: [{ icon: "plane", cells: ["x<y"] }],
        },
        { type: "photo", mediaId: "m", caption: "Sunset" },
      ]),
      { pageSize: "A4", photo: () => PHOTO },
    );
    expect(html).toContain("<h3>Japan &lt;1&gt;</h3>");
    expect(html).toContain('<p class="date">6 Aug 2026 · Day 1 of the journey</p>');
    expect(html).toContain("<h4>Dune &amp; co</h4>");
    expect(html).toContain('<p class="italic">We &quot;cried&quot;.</p>');
    expect(html).toContain("<blockquote>Loved it<cite>Goodreads</cite></blockquote>");
    expect(html).toContain("<caption>Legs</caption>");
    expect(html).toContain('<td class="ic">Flight</td><td>x&lt;y</td>');
    expect(html).toContain("<figcaption>Sunset</figcaption>");
  });

  test("date line precision and an empty unknown-date line", () => {
    const { html } = renderBookHtml(
      model([
        { type: "dateLine", date: "2010-12-15", precision: "month" },
        { type: "dateLine", date: "2010-01-01", precision: "unknown" },
      ]),
      { pageSize: "A4" },
    );
    expect(html).toContain('<p class="date">December 2010</p>');
    expect(html.match(/class="date"/g)).toHaveLength(1);
  });

  test("photos that are unavailable are left out", () => {
    const r = renderBookHtml(model([{ type: "photo", mediaId: "gone" }]), {
      pageSize: "A4",
      photo: () => null,
    });
    expect(r.html).not.toContain("<figure>");
    expect(r.stats.photosPlaced).toBe(0);
  });

  test("short tables keep together, long ones may break; header repeats", () => {
    const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ cells: [String(i)] }));
    const short = renderBookHtml(model([{ type: "table", columns: ["A"], rows: rows(8) }]), {
      pageSize: "A4",
    }).html;
    const long = renderBookHtml(model([{ type: "table", columns: ["A"], rows: rows(9) }]), {
      pageSize: "A4",
    }).html;
    expect(short).toContain('<table class="keep">');
    expect(long).toContain("<table><thead>");
  });
});

describe("page setup", () => {
  const css = (o: Parameters<typeof renderBookHtml>[1]) => renderBookHtml(model([]), o).html;

  test("css margins by default, none in native mode", () => {
    expect(css({ pageSize: "A4" })).toContain("@page{margin:51pt 45pt 57pt 45pt;");
    expect(css({ pageSize: "A4", marginMode: "native" })).toContain("@page{margin:0;");
  });

  test("page numbers and chapter breaks are configurable", () => {
    expect(css({ pageSize: "A4" })).toContain("counter(page)");
    expect(css({ pageSize: "A4" })).toContain("break-before:right");
    const plain = css({ pageSize: "A5", pageNumbers: false, chapterBreak: "page" });
    expect(plain).not.toContain("counter(page)");
    expect(plain).toContain("break-before:page");
    expect(plain).toContain("max-height:200pt");
  });

  test("title, dedication and colophon pages carry no page number", () => {
    const html = css({ pageSize: "A4" });
    expect(html).toContain("@page front{@bottom-center{content:none;}}");
    expect(html).toContain(".title,.dedication,.colophon{page:front;}");
  });

  test("fonts are embedded as base64 @font-face", () => {
    const html = css({
      pageSize: "A4",
      fonts: [{ family: "Lora", weight: 400, style: "italic", base64: "ZZZ" }],
    });
    expect(html).toContain(
      'font-family:"Lora";font-weight:400;font-style:italic;src:url(data:font/ttf;base64,ZZZ)',
    );
  });
});

describe("whole book from importer fixtures", () => {
  test("year and trip mode both render with the right chapter titles", () => {
    const year = renderBookHtml(buildBookModel(fx.data, def(), opts), { pageSize: "A4" }).html;
    expect(year).toContain('<h2 class="chapter">2026</h2>');
    expect(year).toContain("<h3>Berlin and Hamburg</h3>");
    const trip = renderBookHtml(buildBookModel(fx.data, def({ chapterMode: "trip" }), opts), {
      pageSize: "A4",
    }).html;
    expect(trip).toContain('<h2 class="chapter">Berlin and Hamburg</h2>');
    expect(trip).toContain('<h2 class="chapter">Japan</h2>');
  });

  test("no raw ids, no em dashes, deterministic", () => {
    const m = buildBookModel(fx.data, def(), opts);
    const a = renderBookHtml(m, { pageSize: "A5" });
    expect(a.html).toBe(renderBookHtml(m, { pageSize: "A5" }).html);
    expect(a.html).not.toContain("—");
    for (const e of Object.values(fx.e)) expect(a.html).not.toContain(e.id);
  });
});
