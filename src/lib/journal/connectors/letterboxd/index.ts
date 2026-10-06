/**
 * Letterboxd connector.
 *
 * Handles two file variants from the Letterboxd data export:
 *   - diary.csv     — all watches; no Review column
 *   - reviews.csv   — subset with written reviews; superset of diary columns
 *
 * Column map (verified against real export):
 *   Watched Date  → start (YYYY-MM-DD; datePrecision = "day")
 *   Name          → title
 *   Year          → year (release year, not watch year)
 *   Rating        → rating (×2 → 0–10; empty/0 → undefined)
 *   Rewatch       → rewatch ("Yes" → true)
 *   Review        → reflection (reviews.csv only; blank → undefined)
 *   Letterboxd URI→ sourceRef
 *   Date          → ignored (log date, not watch date)
 *   Tags          → ignored for now
 *
 * Merge workflow — import diary.csv first, then reviews.csv. The reviews file
 * shares the same dedup keys, so each entry hits the "supersedes" path in
 * commitBatch which already preserves `old.reflection ?? new.reflection`.
 * No special merge logic is needed here.
 */
import { uid } from "../../types";
import type { Film } from "../../types";
import type { Connector, ParseResult } from "../types";
import { csvRows } from "../csv";

const now = () => new Date().toISOString();

/** Normalise title: trim and collapse internal whitespace. */
function normTitle(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

/** Build source-agnostic film dedup key. */
function filmKey(title: string, year: number | undefined, watchedDate: string): string {
  const normT = title.toLowerCase().trim();
  const yearPart = year ? `|${year}` : "";
  return `film|${normT}${yearPart}|${watchedDate}`;
}

function parseLetterboxd(text: string): ParseResult {
  const out: ParseResult = { entries: [], errors: [] };
  const rows = csvRows(text);

  rows.forEach(({ row: r, sourceRow }) => {
    // Both diary.csv and reviews.csv use "Watched Date"
    const watchedDate = (r["Watched Date"] as string | undefined)?.trim() ?? "";
    const rawTitle = (r["Name"] as string | undefined)?.trim() ?? "";

    if (!watchedDate || !rawTitle) {
      out.errors.push(`Row ${sourceRow}: missing Watched Date or Name — skipped`);
      return;
    }

    const title = normTitle(rawTitle);

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(watchedDate)) {
      out.errors.push(`Row ${sourceRow}: unrecognised date "${watchedDate}" — skipped`);
      return;
    }

    const rawYear = (r["Year"] as string | undefined)?.trim();
    const year = rawYear ? parseInt(rawYear, 10) : undefined;

    // Rating: Letterboxd uses 0.5–5 half-stars; multiply by 2 for 0–10 scale.
    // Empty or "0" → unrated.
    const rawRating = (r["Rating"] as string | undefined)?.trim();
    let rating: number | undefined;
    if (rawRating && rawRating !== "0") {
      const parsed = parseFloat(rawRating);
      if (!isNaN(parsed) && parsed > 0) rating = Math.round(parsed * 2 * 10) / 10;
    }

    const rewatch = (r["Rewatch"] as string | undefined)?.trim().toLowerCase() === "yes"
      ? true
      : undefined;

    // Source review from reviews.csv "Review" column; stored as `review`, not `reflection`.
    const rawReview = (r["Review"] as string | undefined)?.trim();
    const review = rawReview || undefined;

    const letterboxdUri = (r["Letterboxd URI"] as string | undefined)?.trim();

    const film: Film = {
      id: uid(),
      kind: "film",
      source: "letterboxd",
      tier: 2,
      start: watchedDate,
      datePrecision: "day",
      title,
      year,
      rewatch,
      rating,
      review,
      sourceRef: letterboxdUri || `letterboxd:row:${sourceRow}`,
      dedupeKey: filmKey(title, year, watchedDate),
      createdAt: now(),
      raw: r as Record<string, unknown>,
    };

    const w: string[] = [];
    if (!year) w.push("Release year unknown");

    out.entries.push({ entry: film, warnings: w, sourceRow });
  });

  return out;
}

export const connector: Connector = {
  id: "letterboxd",
  label: "Letterboxd diary / reviews",
  kind: "file",
  tier: 2,
  accepts: [".csv"],
  sniff(name, head) {
    const n = name.toLowerCase();
    // Exact filename matches
    if (n === "diary.csv" || n === "reviews.csv") return 0.95;
    if (n.includes("letterboxd")) return 0.9;
    // Header content checks (head is lowercased by registry)
    if (head.includes("watched date") && head.includes("letterboxd uri")) return 0.95;
    if (head.includes("watched date") && head.includes("rewatch")) return 0.8;
    return 0;
  },
  parse({ text }) {
    return parseLetterboxd(text);
  },
};
