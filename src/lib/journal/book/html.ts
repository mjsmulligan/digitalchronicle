/**
 * WP5 of docs/specs/book-export.md: BookModel to one HTML string for expo-print.
 *
 * Pure: no React Native, no DOM, no clock, no file access. Fonts and photos are
 * passed in already loaded (fonts as base64, photos as data URIs, because iOS
 * cannot print local file URLs). Reads only the BookModel; all layout lives here.
 *
 * Layout features come from the WP0 spike: base64 @font-face, @page size, margins
 * and page-number box, chapter openings on a right-hand page, tables that avoid
 * splitting when short, photos that avoid splitting across pages.
 */
import { formatDay } from "./blocks";
import { dateLineText } from "./dateLine";
import { MARGIN_BOTTOM_PT, MARGIN_TOP_PT, MARGIN_X_PT } from "./layout";
import type { Block, BookModel, PageSize } from "./types";

export interface BookFont {
  family: string;
  weight: 400 | 500 | 600 | 700;
  style: "normal" | "italic";
  /** TrueType file, base64. */
  base64: string;
}

export interface BookPhoto {
  /** "data:image/jpeg;base64,..." */
  dataUri: string;
  width: number;
  height: number;
}

export interface BookHtmlOptions {
  pageSize: PageSize;
  /**
   * "css" (default): margins come from @page. Android honours this, iOS ignores it.
   * "native": @page margin is 0 and the caller passes `margins` to printToFileAsync (iOS only).
   */
  marginMode?: "css" | "native";
  /** Page number in the bottom margin box. Default true. */
  pageNumbers?: boolean;
  /** "right" (default): chapters open on a right-hand page. "page": any new page. */
  chapterBreak?: "right" | "page";
  fonts?: BookFont[];
  /** Photos for photo blocks and the cover. Return null if unavailable; the block is left out. */
  photo?: (mediaId: string) => BookPhoto | null;
}

export interface BookHtmlResult {
  html: string;
  stats: { chapters: number; photosPlaced: number; htmlBytes: number };
}

const ICON_LABELS: Record<string, string> = {
  plane: "Flight",
  train: "Train",
  car: "Car",
  leg: "Journey",
  hotel: "Stay",
};

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Escaped text with line breaks kept. */
function multiline(s: string): string {
  return esc(s.replace(/\r\n?/g, "\n").trim()).replace(/\n/g, "<br>");
}

function fontFaces(fonts: BookFont[]): string {
  return fonts
    .map(
      (f) =>
        `@font-face{font-family:"${f.family}";font-weight:${f.weight};font-style:${f.style};` +
        `src:url(data:font/ttf;base64,${f.base64}) format("truetype");}`,
    )
    .join("\n");
}

function css(o: Required<Omit<BookHtmlOptions, "photo">>): string {
  const margin =
    o.marginMode === "css"
      ? `${MARGIN_TOP_PT}pt ${MARGIN_X_PT}pt ${MARGIN_BOTTOM_PT}pt ${MARGIN_X_PT}pt`
      : "0";
  const pageNo = o.pageNumbers
    ? `@bottom-center{content:counter(page);font-family:"Lora",Georgia,serif;font-size:8.5pt;color:#555;}`
    : "";
  const brk = o.chapterBreak === "right" ? "right" : "page";
  const maxPhoto = o.pageSize === "A4" ? 300 : 200;
  return `
${fontFaces(o.fonts)}
@page{margin:${margin};${pageNo}}
@page front{@bottom-center{content:none;}}
.title,.dedication,.colophon{page:front;}
*{box-sizing:border-box;}
html{font-family:"Lora",Georgia,serif;font-size:10.5pt;line-height:1.45;color:#1b1b1b;}
body{margin:0;}
h1,h2,h3,h4{font-family:"Fraunces","Lora",Georgia,serif;font-weight:600;margin:0;}
.title,.dedication,.colophon,.contents{break-after:page;}
.title{padding-top:25%;text-align:center;}
.title img{display:block;margin:0 auto 24pt;max-width:100%;max-height:${maxPhoto}pt;height:auto;object-fit:cover;}
.title h1{font-size:30pt;line-height:1.15;}
.title .sub{font-size:13pt;margin-top:10pt;color:#444;}
.title .range{font-size:10pt;margin-top:24pt;color:#666;}
.dedication{padding-top:35%;text-align:center;font-style:italic;font-size:12pt;}
.colophon{padding-top:60%;font-size:8.5pt;color:#555;text-align:center;}
.colophon p{margin:0 0 4pt;}
.contents h2{font-size:16pt;margin-bottom:14pt;}
.contents ul{padding:0;margin:0;}
.contents li{list-style:none;margin:0 0 5pt;}
h2.chapter{break-before:${brk};font-size:24pt;padding:36pt 0 18pt;break-after:avoid;}
h3{font-size:14pt;margin:18pt 0 8pt;break-after:avoid;border-bottom:0.5pt solid #999;padding-bottom:3pt;}
h4{font-size:11.5pt;margin:1pt 0 3pt;break-after:avoid;}
.date{font-size:8.5pt;letter-spacing:.04em;text-transform:uppercase;color:#666;margin:10pt 0 0;break-after:avoid;}
p{margin:0 0 5pt;orphans:2;widows:2;}
p.italic{font-style:italic;}
blockquote{margin:0 0 6pt;padding-left:9pt;border-left:1.5pt solid #bbb;font-size:10pt;break-inside:avoid;}
blockquote cite{display:block;font-size:8.5pt;color:#666;margin-top:2pt;font-style:normal;}
table{width:100%;border-collapse:collapse;margin:4pt 0 11pt;font-size:9pt;}
table.keep{break-inside:avoid;}
tr{break-inside:avoid;}
thead{display:table-header-group;}
caption{text-align:left;font-size:8.5pt;color:#666;padding-bottom:2pt;}
td,th{text-align:left;padding:2.5pt 4pt;border-bottom:0.4pt solid #ccc;vertical-align:top;}
th{font-weight:600;font-size:8pt;text-transform:uppercase;color:#666;}
td.ic{width:46pt;color:#666;}
figure{margin:4pt 0 11pt;break-inside:avoid;}
figure img{display:block;width:100%;height:auto;max-height:${maxPhoto}pt;object-fit:cover;}
figcaption{font-size:8.5pt;color:#666;margin-top:2pt;}
`;
}

function tableHtml(b: Extract<Block, { type: "table" }>): string {
  if (!b.columns.length) return "";
  const withIcons = b.rows.some((r) => r.icon);
  const head =
    `<thead><tr>${withIcons ? "<th></th>" : ""}` +
    b.columns.map((c) => `<th>${esc(c)}</th>`).join("") +
    `</tr></thead>`;
  const rows = b.rows
    .map((r) => {
      const cells = r.cells.slice(0, b.columns.length);
      while (cells.length < b.columns.length) cells.push("");
      const icon = withIcons
        ? `<td class="ic">${r.icon ? esc(ICON_LABELS[r.icon] ?? r.icon) : ""}</td>`
        : "";
      return `<tr>${icon}${cells.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`;
    })
    .join("");
  const caption = b.caption ? `<caption>${esc(b.caption)}</caption>` : "";
  // Short tables stay on one page; long ones may break between rows.
  return `<table${b.rows.length <= 8 ? ' class="keep"' : ""}>${caption}${head}<tbody>${rows}</tbody></table>`;
}

export function renderBookHtml(model: BookModel, options: BookHtmlOptions): BookHtmlResult {
  const o = {
    pageSize: options.pageSize,
    marginMode: options.marginMode ?? "css",
    pageNumbers: options.pageNumbers ?? true,
    chapterBreak: options.chapterBreak ?? "right",
    fonts: options.fonts ?? [],
  };
  let photosPlaced = 0;
  const photoFor = (id: string): BookPhoto | null => {
    const p = options.photo?.(id) ?? null;
    if (p) photosPlaced++;
    return p;
  };
  const img = (p: BookPhoto, alt = "") =>
    `<img src="${p.dataUri}" width="${p.width}" height="${p.height}" alt="${esc(alt)}">`;

  const { meta } = model;
  const body: string[] = [];

  const cover = meta.coverMediaId ? photoFor(meta.coverMediaId) : null;
  body.push(
    `<section class="title">${cover ? img(cover) : ""}<h1>${esc(meta.title)}</h1>` +
      (meta.subtitle ? `<div class="sub">${esc(meta.subtitle)}</div>` : "") +
      `<div class="range">${esc(formatDay(meta.dateRange.start))} to ${esc(formatDay(meta.dateRange.end))}</div></section>`,
  );
  if (meta.dedication)
    body.push(`<section class="dedication">${multiline(meta.dedication)}</section>`);
  body.push(
    `<section class="colophon"><p>${
      meta.sources.length
        ? `Compiled by Chronicle from: ${esc(meta.sources.join(", "))}.`
        : "Compiled by Chronicle."
    }</p><p>Generated ${esc(formatDay(meta.generatedOn))}.</p></section>`,
  );
  body.push(
    `<section class="contents"><h2>Contents</h2><ul>${model.chapters
      .map((c) => `<li>${esc(c.title)}</li>`)
      .join("")}</ul></section>`,
  );

  const renderBlock = (b: Block): string => {
    switch (b.type) {
      case "heading":
        return b.level >= 4 ? `<h4>${esc(b.text)}</h4>` : `<h3>${esc(b.text)}</h3>`;
      case "dateLine": {
        const t = dateLineText(b);
        return t ? `<p class="date">${esc(t)}</p>` : "";
      }
      case "paragraph":
        return b.text.trim()
          ? `<p${b.italic ? ' class="italic"' : ""}>${multiline(b.text)}</p>`
          : "";
      case "quote":
        return b.text.trim()
          ? `<blockquote>${multiline(b.text)}${b.attribution ? `<cite>${esc(b.attribution)}</cite>` : ""}</blockquote>`
          : "";
      case "table":
        return tableHtml(b);
      case "photo": {
        const p = photoFor(b.mediaId);
        return p
          ? `<figure>${img(p, b.caption)}${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ""}</figure>`
          : "";
      }
    }
  };

  for (const chapter of model.chapters) {
    body.push(`<h2 class="chapter">${esc(chapter.title)}</h2>`);
    for (const section of chapter.sections)
      for (const b of section.blocks) body.push(renderBlock(b));
  }

  const html =
    `<!doctype html><html lang="${esc(meta.language)}"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${esc(meta.title)}</title><style>${css(o)}</style></head><body>${body.filter(Boolean).join("\n")}</body></html>`;
  return { html, stats: { chapters: model.chapters.length, photosPlaced, htmlBytes: html.length } };
}
