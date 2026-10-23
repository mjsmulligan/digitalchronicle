/**
 * WP0 spike harness: the generator must be deterministic and the HTML must carry
 * the print features the spike exists to test.
 */
import { describe, expect, test } from "vitest";
import { buildBookModel } from "..";
import {
  buildSpikeHtml,
  makeSpikeJournal,
  photoTargetWidthPx,
  type SpikeFont,
  type SpikePhoto,
} from "../spike";

const fonts: SpikeFont[] = [{ family: "Lora", weight: 400, style: "normal", base64: "AAAA" }];
const photos: SpikePhoto[] = Array.from({ length: 5 }, (_, i) => ({
  dataUri: `data:image/jpeg;base64,PHOTO${i}`,
  width: 1050,
  height: 700,
}));

function build(over: Partial<Parameters<typeof buildSpikeHtml>[0]> = {}, entryCount = 120) {
  const data = makeSpikeJournal({ entryCount });
  const model = buildBookModel(
    data,
    { title: "T", start: "2000-01-01", end: "2100-01-01", chapterMode: "year" },
    { generatedOn: "2026-10-22" },
  );
  return buildSpikeHtml({
    model,
    data,
    pageSize: "A4",
    marginMode: "css",
    pageNumbers: true,
    chapterBreak: "right",
    fonts,
    photos,
    ...over,
  });
}

describe("spike data", () => {
  test("is deterministic for a seed and produces about the requested entries", () => {
    const a = makeSpikeJournal({ entryCount: 200 });
    const b = makeSpikeJournal({ entryCount: 200 });
    expect(a).toEqual(b);
    const total = a.legs.length + a.stays.length + a.events.length + a.books.length;
    expect(total).toBeGreaterThanOrEqual(200);
    expect(total).toBeLessThan(215);
  });
});

describe("spike html", () => {
  test("is deterministic", () => {
    expect(build().html).toEqual(build().html);
  });

  test("embeds fonts and uses the print features under test", () => {
    const { html } = build();
    expect(html).toContain("@font-face");
    expect(html).toContain("data:font/ttf;base64,AAAA");
    expect(html).toContain("counter(page)");
    expect(html).toContain("break-before:right");
  });

  test("options switch the features off", () => {
    const { html } = build({ pageNumbers: false, chapterBreak: "page" });
    expect(html).not.toContain("counter(page)");
    expect(html).not.toContain("break-before:right");
    expect(html).toContain("break-before:page");
  });

  test("native margin mode zeroes the CSS page margin", () => {
    expect(build({ marginMode: "native" }).html).toContain("@page{margin:0;");
  });

  test("places each supplied photo once, never more than supplied", () => {
    const { html, stats } = build();
    expect(stats.photosPlaced).toBe(5);
    for (let i = 0; i < 5; i++) expect(html.split(`PHOTO${i}"`).length - 1).toBe(1);
  });

  test("escapes text from the journal", () => {
    const data = makeSpikeJournal({ entryCount: 10 });
    data.events[0] = { ...data.events[0], artist: "<script>x</script>" };
    const model = buildBookModel(
      data,
      { title: "A & B", start: "2000-01-01", end: "2100-01-01", chapterMode: "year" },
      { generatedOn: "2026-10-22" },
    );
    const { html } = buildSpikeHtml({
      model,
      data,
      pageSize: "A4",
      marginMode: "css",
      pageNumbers: true,
      chapterBreak: "right",
      fonts,
      photos: [],
    });
    expect(html).not.toContain("<script>x");
    expect(html).toContain("A &amp; B");
  });
});

describe("photoTargetWidthPx", () => {
  test("is 150 ppi at the content width", () => {
    // A4 content width is 595 - 90 = 505 pt = 7.01 in, so about 1052 px.
    expect(photoTargetWidthPx("A4")).toBe(1052);
    expect(photoTargetWidthPx("A5")).toBeLessThan(photoTargetWidthPx("A4"));
  });
});
