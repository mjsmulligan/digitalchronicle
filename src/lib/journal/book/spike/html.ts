/**
 * WP0 spike: BookModel + journal data -> one HTML string for expo-print.
 *
 * Throwaway in detail (WP2 and WP5 replace the entry rendering) but deliberately
 * uses the layout features the real PDF needs, so the spike tests them:
 *  - @font-face with base64 fonts (embedding)
 *  - @page size and margins, with a page number margin box
 *  - chapter openings on a right-hand page (break-before: right)
 *  - tables, quotes, italic reflections, inline photos with break-inside: avoid
 *
 * Pure: no React Native, no DOM, no clock. Runs on device and in Node.
 */
import { entryDay } from "../common";
import { view, type Entry, type JournalData } from "../../types";
import {
  MARGIN_BOTTOM_PT,
  MARGIN_TOP_PT,
  MARGIN_X_PT,
  PAGE_PX,
  photoTargetWidthPx,
} from "../layout";
import type { BookModel, PageSize } from "../types";

export interface SpikeFont {
  family: string;
  weight: 400 | 500 | 600 | 700;
  style: "normal" | "italic";
  /** TrueType file, base64. */
  base64: string;
}

export interface SpikePhoto {
  /** "data:image/jpeg;base64,..." (iOS cannot print local file URLs). */
  dataUri: string;
  width: number;
  height: number;
}

export interface SpikeHtmlInput {
  model: BookModel;
  data: JournalData;
  pageSize: PageSize;
  /**
   * "css": margins come from @page (Android honours this, iOS ignores it).
   * "native": @page margin is 0 and the caller passes `margins` to printToFileAsync (iOS only).
   */
  marginMode: "css" | "native";
  /** Emit an @page margin box with counter(page). Needs a recent Chromium WebView. */
  pageNumbers: boolean;
  /** "right" uses break-before: right (may add blank pages); "page" uses a plain page break. */
  chapterBreak: "right" | "page";
  fonts: SpikeFont[];
  photos: SpikePhoto[];
}

export { PAGE_PX, MARGIN_X_PT, MARGIN_TOP_PT, MARGIN_BOTTOM_PT, photoTargetWidthPx };

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function longDate(d: string): string {
  const t = new Date(`${d}T00:00:00Z`);
  return `${WEEKDAYS[t.getUTCDay()]} ${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear()}`;
}

const stars = (rating: number) => `${rating.toFixed(1)}/10`;

function fontFaces(fonts: SpikeFont[]): string {
  return fonts
    .map(
      (f) =>
        `@font-face{font-family:"${f.family}";font-weight:${f.weight};font-style:${f.style};` +
        `src:url(data:font/ttf;base64,${f.base64}) format("truetype");}`,
    )
    .join("\n");
}

function css(input: SpikeHtmlInput): string {
  const margin =
    input.marginMode === "css"
      ? `${MARGIN_TOP_PT}pt ${MARGIN_X_PT}pt ${MARGIN_BOTTOM_PT}pt ${MARGIN_X_PT}pt`
      : "0";
  const pageNo = input.pageNumbers
    ? `@bottom-center{content:counter(page);font-family:"Lora",serif;font-size:8.5pt;color:#555;}`
    : "";
  const brk = input.chapterBreak === "right" ? "right" : "page";
  return `
${fontFaces(input.fonts)}
@page{margin:${margin};${pageNo}}
*{box-sizing:border-box;}
html{font-family:"Lora",serif;font-size:10.5pt;line-height:1.45;color:#1b1b1b;}
body{margin:0;}
h1,h2,h3,h4{font-family:"Fraunces","Lora",serif;font-weight:600;margin:0;}
.title,.colophon,.dedication,.contents{break-after:page;}
.title{padding-top:30%;text-align:center;}
.title h1{font-size:30pt;line-height:1.15;}
.title .sub{font-size:13pt;margin-top:10pt;color:#444;}
.title .range{font-size:10pt;margin-top:24pt;color:#666;}
.colophon{padding-top:60%;font-size:8.5pt;color:#555;text-align:center;}
.dedication{padding-top:35%;text-align:center;font-style:italic;font-size:12pt;}
.contents h2{font-size:16pt;margin-bottom:14pt;}
.contents li{list-style:none;margin:0 0 5pt 0;}
.contents ul{padding:0;margin:0;}
h2.chapter{break-before:${brk};font-size:24pt;padding:36pt 0 18pt;break-after:avoid;}
h3.trip{font-size:14pt;margin:18pt 0 8pt;break-after:avoid;border-bottom:0.5pt solid #999;padding-bottom:3pt;}
h3.trip span{font-family:"Lora",serif;font-weight:400;font-size:9pt;color:#666;margin-left:8pt;}
.entry{margin:0 0 11pt;orphans:2;widows:2;}
.date{font-size:8.5pt;letter-spacing:.04em;text-transform:uppercase;color:#666;margin:0;break-after:avoid;}
h4{font-size:11.5pt;margin:1pt 0 3pt;break-after:avoid;}
.meta{font-size:9pt;color:#555;margin:0 0 3pt;}
p{margin:0 0 5pt;}
.reflection{font-style:italic;}
blockquote{margin:0 0 5pt;padding-left:9pt;border-left:1.5pt solid #bbb;font-size:10pt;}
blockquote cite{display:block;font-size:8.5pt;color:#666;margin-top:2pt;font-style:normal;}
table{width:100%;border-collapse:collapse;margin:0 0 11pt;break-inside:avoid;font-size:9pt;}
td,th{text-align:left;padding:2.5pt 4pt;border-bottom:0.4pt solid #ccc;vertical-align:top;}
th{font-weight:600;font-size:8pt;text-transform:uppercase;color:#666;}
td.ic{width:46pt;color:#666;}
figure{margin:0 0 11pt;break-inside:avoid;}
figure img{display:block;width:100%;height:auto;max-height:${input.pageSize === "A4" ? 300 : 200}pt;object-fit:cover;}
`;
}

function entryTime(e: Entry): string {
  const s = view(e).start;
  return s.length > 10 ? s.slice(11, 16) : "";
}

function legRow(e: Entry): string {
  const v = view(e);
  if (v.kind !== "leg") return "";
  const id = v.flightNumber ?? v.trainNumber ?? "";
  return `<tr><td class="ic">${v.mode === "air" ? "Flight" : "Train"}</td><td>${esc(entryDay(e))} ${esc(entryTime(e))}</td><td>${esc(v.fromName ?? v.from)}</td><td>${esc(v.toName ?? v.to)}</td><td>${esc(id)}</td></tr>`;
}

function stayRow(e: Entry): string {
  const v = view(e);
  if (v.kind !== "stay") return "";
  return `<tr><td class="ic">Stay</td><td>${esc(entryDay(e))}</td><td colspan="3">${esc(v.place)}${v.city ? `, ${esc(v.city)}` : ""}</td></tr>`;
}

function reflectionHtml(e: Entry): string {
  return e.reflection ? `<p class="reflection">${esc(e.reflection)}</p>` : "";
}

function blockEntry(e: Entry, photo: string): string {
  const v = view(e);
  const day = `<p class="date">${esc(longDate(entryDay(e)))}</p>`;
  if (v.kind === "event") {
    const where = [v.venue, v.city].filter(Boolean).join(", ");
    return `<div class="entry">${day}<h4>${esc(v.artist)}</h4><p class="meta">${esc(where)}${v.rating !== undefined ? ` &middot; ${stars(v.rating)}` : ""}</p>${reflectionHtml(e)}${photo}</div>`;
  }
  if (v.kind === "book") {
    const review = v.review
      ? `<blockquote>${esc(v.review)}<cite>Goodreads review</cite></blockquote>`
      : "";
    return `<div class="entry">${day}<h4>${esc(v.title)}</h4><p class="meta">${esc(v.author)}${v.rating !== undefined ? ` &middot; ${stars(v.rating)}` : ""}</p>${review}${reflectionHtml(e)}${photo}</div>`;
  }
  return `<div class="entry">${day}<h4>${esc(String(v.kind))}</h4>${photo}</div>`;
}

export interface SpikeHtmlResult {
  html: string;
  stats: { chapters: number; entries: number; photosPlaced: number; htmlBytes: number };
}

export function buildSpikeHtml(input: SpikeHtmlInput): SpikeHtmlResult {
  const { model, data } = input;
  const byId = new Map<string, Entry>();
  for (const list of [data.legs, data.stays, data.events, data.books] as Entry[][])
    for (const e of list) byId.set(e.id, e);

  // Spread photos evenly over the entries that can carry one (events and books).
  const carriers = model.chapters
    .flatMap((c) => c.sections.flatMap((s) => s.entryIds))
    .filter((id) => byId.get(id)?.kind === "event" || byId.get(id)?.kind === "book");
  const step = input.photos.length
    ? Math.max(1, Math.floor(carriers.length / input.photos.length))
    : 0;
  const photoFor = new Map<string, SpikePhoto>();
  if (step) {
    for (let i = 0; i < input.photos.length; i++) {
      const id = carriers[Math.min(carriers.length - 1, i * step)];
      if (id) photoFor.set(id, input.photos[i]);
    }
  }
  let placed = 0;
  const figure = (id: string) => {
    const p = photoFor.get(id);
    if (!p) return "";
    placed++;
    return `<figure><img src="${p.dataUri}" width="${p.width}" height="${p.height}" /></figure>`;
  };

  const body: string[] = [];
  body.push(
    `<section class="title"><h1>${esc(model.meta.title)}</h1>` +
      (model.meta.subtitle ? `<div class="sub">${esc(model.meta.subtitle)}</div>` : "") +
      `<div class="range">${esc(model.meta.dateRange.start)} to ${esc(model.meta.dateRange.end)}</div></section>`,
  );
  body.push(
    `<section class="colophon"><p>Compiled by Chronicle from: ${esc(model.meta.sources.join(", "))}.</p><p>Generated ${esc(model.meta.generatedOn)}</p></section>`,
  );
  if (model.meta.dedication)
    body.push(`<section class="dedication">${esc(model.meta.dedication)}</section>`);
  body.push(
    `<section class="contents"><h2>Contents</h2><ul>${model.chapters.map((c) => `<li>${esc(c.title)}</li>`).join("")}</ul></section>`,
  );

  for (const chapter of model.chapters) {
    body.push(`<h2 class="chapter">${esc(chapter.title)}</h2>`);
    for (const section of chapter.sections) {
      if (section.kind === "trip" && section.trip) {
        body.push(
          `<h3 class="trip">${esc(section.trip.title)}<span>${esc(section.trip.start)} to ${esc(section.trip.end)}</span></h3>`,
        );
      }
      // Runs of legs and stays share one table; everything else is a block.
      let rows: string[] = [];
      const flush = () => {
        if (rows.length)
          body.push(
            `<table><tr><th>Mode</th><th>When</th><th>From</th><th>To</th><th>Ref</th></tr>${rows.join("")}</table>`,
          );
        rows = [];
      };
      for (const id of section.entryIds) {
        const e = byId.get(id);
        if (!e) continue;
        if (e.kind === "leg") rows.push(legRow(e));
        else if (e.kind === "stay") rows.push(stayRow(e));
        else {
          flush();
          body.push(blockEntry(e, figure(id)));
        }
      }
      flush();
    }
  }

  const html = `<!doctype html><html lang="${esc(model.meta.language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css(input)}</style></head><body>${body.join("\n")}</body></html>`;
  return {
    html,
    stats: {
      chapters: model.chapters.length,
      entries: model.stats.entryCount,
      photosPlaced: placed,
      htmlBytes: html.length,
    },
  };
}
