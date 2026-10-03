/**
 * Goodreads library export connector.
 *
 * File: goodreads_library_export.csv
 *
 * Column map (relevant fields):
 *   Book Id                  → goodreadsId
 *   Title                    → title (series suffix stripped) + series/seriesNumber parsed
 *   Author                   → author
 *   My Rating                → rating (1–5 × 2 → 0–10; 0 = unrated)
 *   Original Publication Year → year
 *   Date Read                → start / datePrecision "day"; YYYY/MM/DD format
 *   Date Added               → fallback date when Date Read is blank
 *   My Review                → reflection
 *   Exclusive Shelf          → filter: only "read" rows imported
 *   ISBN13                   → cleaned of Excel artifact `="..."` wrapping
 *
 * Title parsing:
 *   " (SeriesName, #N)" suffix stripped from clean title.
 *   N may be a decimal (e.g. 7.5 for a novella).
 *
 * Dedup key: `book|{normTitle}|{normAuthor}|{dateRead}`
 *   dateRead is empty string when date is unknown (entries still imported,
 *   but collisions on same title/author will deduplicate).
 *
 * Tier: 2 — primary reading record; curated by the user on Goodreads.
 */
import { uid } from "../../types";
import type { Book } from "../../types";
import type { Connector, ParseResult } from "../types";
import { csvRows } from "../csv";

const now = () => new Date().toISOString();

/** Strip Excel ISBN artifact: `="0670020559"` → `0670020559` */
function cleanISBN(raw: string): string {
  return raw.replace(/^="?/, "").replace(/"?$/, "").trim();
}

/** Parse Goodreads date format YYYY/MM/DD → YYYY-MM-DD, or null. */
function parseGoodreadsDate(raw: string): string | null {
  const m = raw.trim().match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** Series suffix pattern: " (Series Name, #6)" or " (Series Name, #7.5)" */
const SERIES_RE = /\s+\(([^,)]+),\s+#([\d.]+)\)\s*$/;

interface ParsedTitle {
  title: string;
  series?: string;
  seriesNumber?: number;
}

function parseTitle(raw: string): ParsedTitle {
  const m = raw.match(SERIES_RE);
  if (!m) return { title: raw.trim() };
  return {
    title: raw.slice(0, m.index).trim(),
    series: m[1].trim(),
    seriesNumber: parseFloat(m[2]),
  };
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}

function dedupeKey(normTitle: string, normAuthor: string, dateRead: string): string {
  return `book|${normTitle}|${normAuthor}|${dateRead}`;
}

function parseGoodreads(text: string): ParseResult {
  const out: ParseResult = { entries: [], errors: [] };
  const rows = csvRows(text);

  rows.forEach(({ row: r, sourceRow }) => {
    const shelf = ((r["Exclusive Shelf"] as string | undefined) ?? "").trim();
    if (shelf !== "read") return; // only import books the user has read

    const rawTitle = ((r["Title"] as string | undefined) ?? "").trim();
    const rawAuthor = ((r["Author"] as string | undefined) ?? "").trim();

    if (!rawTitle || !rawAuthor) {
      out.errors.push(`Row ${sourceRow}: missing Title or Author — skipped`);
      return;
    }

    const { title, series, seriesNumber } = parseTitle(rawTitle);

    // Date: prefer Date Read; fall back to Date Added with unknown precision
    const rawDateRead = ((r["Date Read"] as string | undefined) ?? "").trim();
    const rawDateAdded = ((r["Date Added"] as string | undefined) ?? "").trim();
    const dateRead = parseGoodreadsDate(rawDateRead);
    const dateAdded = parseGoodreadsDate(rawDateAdded);
    const startDate = dateRead ?? dateAdded ?? null;
    const datePrecision = dateRead ? ("day" as const) : ("unknown" as const);

    if (!startDate) {
      out.errors.push(`Row ${sourceRow}: no usable date for "${rawTitle}" — skipped`);
      return;
    }

    // Rating: Goodreads 1–5 (0 = not rated). Multiply × 2 for 0–10 scale.
    const rawRating = parseFloat((r["My Rating"] as string | undefined) ?? "0");
    const rating = rawRating > 0 ? rawRating * 2 : undefined;

    // Reflection: My Review column
    const reflection = ((r["My Review"] as string | undefined) ?? "").trim() || undefined;

    // Year: Original Publication Year preferred, fall back to Year Published
    const rawOrigYear = ((r["Original Publication Year"] as string | undefined) ?? "").trim();
    const rawPubYear = ((r["Year Published"] as string | undefined) ?? "").trim();
    const yearStr = rawOrigYear || rawPubYear;
    const year = yearStr ? parseInt(yearStr, 10) : undefined;

    const goodreadsId = ((r["Book Id"] as string | undefined) ?? "").trim() || undefined;
    const isbn13Raw = ((r["ISBN13"] as string | undefined) ?? "").trim();
    const isbn13 = isbn13Raw ? cleanISBN(isbn13Raw) : undefined;

    const book: Book = {
      id: uid(),
      kind: "book",
      source: "goodreads",
      tier: 2,
      start: startDate,
      datePrecision,
      title,
      author: rawAuthor,
      ...(year !== undefined && { year }),
      ...(rating !== undefined && { rating }),
      ...(reflection && { reflection }),
      ...(goodreadsId && { goodreadsId }),
      ...(series && { series }),
      ...(seriesNumber !== undefined && { seriesNumber }),
      dedupeKey: dedupeKey(norm(title), norm(rawAuthor), dateRead ?? ""),
      sourceRef: `goodreads:row:${sourceRow}`,
      createdAt: now(),
      confidence: "confirmed",
      raw: { ...r, ...(isbn13 && { isbn13 }) } as Record<string, unknown>,
    };

    out.entries.push({ entry: book, warnings: [], sourceRow });
  });

  return out;
}

export const connector: Connector = {
  id: "goodreads",
  label: "Goodreads library",
  kind: "file",
  tier: 2,
  accepts: [".csv"],
  sniff(name, head) {
    const n = name.toLowerCase();
    if (n.includes("goodreads") || n === "goodreads_library_export.csv") return 0.97;
    // Header contains "Book Id" which is Goodreads-specific
    if (head.includes("Book Id") && head.includes("Exclusive Shelf")) return 0.9;
    return 0;
  },
  parse({ text }) {
    return parseGoodreads(text);
  },
};
