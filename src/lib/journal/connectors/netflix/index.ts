/**
 * Netflix viewing history connector.
 *
 * File: NetflixViewingHistory.csv
 * Header: Title,Date
 *
 * Column map:
 *   Date   → start  (M/D/YY format, e.g. "9/30/26" → "2026-09-30")
 *   Title  → parsed (see title parsing below)
 *
 * Title parsing rules (applied in order):
 *  1. "{Show}: Season {N}: {Episode}"         → Episode
 *  2. "{Show}: Limited Series: {Episode}"     → Episode, season="Limited Series"
 *  3. "{Show}: {SeasonLabel}: {Episode}"
 *     where SeasonLabel ~ /^(Season|Part|Volume|Chapter|Series)\s+\d+/i
 *     or Chapter + word ordinal (e.g. "Chapter One" — used by Stranger Things S1)
 *     or is a 4-digit year (e.g. WWE SmackDown: 2025: ...)
 *                                             → Episode
 *  4. "{Show}: {SeasonLabel}{N}: {Episode}"
 *     where SeasonLabel ends with a digit (e.g. "Stranger Things 5") → Episode
 *  5. Two-pass heuristics for ambiguous titles:
 *     a. 2-part titles: if the same first segment appears with 2+ distinct second
 *        segments, classify as Episode (showTitle=parts[0], episodeTitle=parts[1])
 *     b. 3+-part titles: if the same "A: B" prefix appears 2+ times across all
 *        3+-part rows, treat "A: B" as the show title and recurse into parts 2+
 *        for season/episode (handles "Star Trek: Discovery", "Criminal: UK", etc.)
 *  6. No pattern matched → Film (can be corrected manually)
 *
 * Tier: 3 — automated play history; accurate date but no curation, rating, or intent.
 */
import { uid } from "../../types";
import type { Film, Episode } from "../../types";
import type { Connector, ParseResult } from "../types";
import { csvRows } from "../csv";

const now = () => new Date().toISOString();

/** Parse Netflix M/D/YY date to YYYY-MM-DD. */
function parseNetflixDate(raw: string): string | null {
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (!m) return null;
  const [, mo, day, yy] = m;
  const yr = parseInt(yy, 10);
  // Two-digit year anchor: 00-29 → 2000-2029; 30-99 → 1930-1999 (matches JS Date)
  const year = yr <= 29 ? 2000 + yr : 1900 + yr;
  return `${year}-${mo.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

/** Normalise a title segment for dedup keys: lowercase + trim. */
function norm(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Season-like label patterns.
 *
 * Standard:   "Season 3", "Part 2", "Volume 1", "Series 4", "Chapter 7"
 * Ordinal:    "Chapter One" … "Chapter Twelve" — Netflix Stranger Things S1 format
 * Year label: "2025" (WWE SmackDown etc.)
 * Trailing N: parts[1] ends with " <digit>" e.g. "Stranger Things 5" — Netflix's
 *             format for numbered seasons whose name repeats the show title
 */
const SEASON_LABEL_RE =
  /^(Season|Part|Volume|Series)\s+\d+/i;

const CHAPTER_LABEL_RE =
  /^Chapter\s+(\d+|One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|Eleven|Twelve)/i;

const YEAR_LABEL_RE = /^\d{4}$/;

/** True when `segment` looks like a season label in any of the known formats. */
function isSeasonLabel(segment: string): boolean {
  return (
    /^limited series$/i.test(segment) ||
    SEASON_LABEL_RE.test(segment) ||
    CHAPTER_LABEL_RE.test(segment) ||
    YEAR_LABEL_RE.test(segment) ||
    // "Stranger Things 5", "Beyond 2" — show title repeated + season number
    /\s\d+$/.test(segment)
  );
}

type ParsedTitle =
  | { kind: "film"; title: string }
  | { kind: "episode"; showTitle: string; season: string; episodeTitle: string };

/**
 * Parse a Netflix title string into either a Film or Episode descriptor,
 * given pre-computed prefix frequency maps for the two-pass heuristics.
 */
function parseTitle(
  raw: string,
  twoPartPrefixCount: Map<string, number>,
  compoundPrefixCount: Map<string, number>,
): ParsedTitle {
  const parts = raw.split(":").map((p) => p.trim());

  // ── 3+ part title ──────────────────────────────────────────────────────────
  if (parts.length >= 3) {
    const p1 = parts[1];

    // Pass A: standard/ordinal/year/trailing-digit season label in parts[1].
    // This check takes priority — if parts[1] IS a season label, the show title
    // is just parts[0] regardless of how many rows share the compound prefix.
    // (e.g. "Stranger Things: Stranger Things 5: ..." — "Stranger Things 5" ends
    // with a digit and is a season, not part of the show title.)
    if (isSeasonLabel(p1)) {
      const episodeTitle = parts.slice(2).join(": ").trim();
      return { kind: "episode", showTitle: parts[0], season: p1, episodeTitle };
    }

    // Pass B: compound show title ("Star Trek: Discovery", "Criminal: UK", etc.)
    // Only reached when parts[1] is NOT a season label.
    // If the "parts[0]: parts[1]" prefix was seen 2+ times across all 3+-part rows,
    // the show title spans the first two segments.
    const compoundKey = norm(`${parts[0]}:${p1}`);
    if ((compoundPrefixCount.get(compoundKey) ?? 0) >= 2) {
      const showTitle = `${parts[0]}: ${p1}`;
      const rest = parts.slice(2);
      // Check whether parts[2] is itself a season label
      if (rest.length >= 2 && isSeasonLabel(rest[0])) {
        return { kind: "episode", showTitle, season: rest[0], episodeTitle: rest.slice(1).join(": ").trim() };
      }
      return { kind: "episode", showTitle, season: "", episodeTitle: rest.join(": ").trim() };
    }
  }

  // ── 2-part title ───────────────────────────────────────────────────────────
  if (parts.length === 2) {
    // Two-pass: if same first segment seen 2+ times → it's a show
    if ((twoPartPrefixCount.get(norm(parts[0])) ?? 0) >= 2) {
      return { kind: "episode", showTitle: parts[0], season: "", episodeTitle: parts[1] };
    }
  }

  // ── Fallback: film ─────────────────────────────────────────────────────────
  return { kind: "film", title: raw.trim() };
}

function filmDedupeKey(title: string, watchedDate: string): string {
  return `film|${norm(title)}|${watchedDate}`;
}

function episodeDedupeKey(
  showTitle: string,
  season: string,
  episodeTitle: string,
  watchedDate: string,
): string {
  return `episode|${norm(showTitle)}|${norm(season)}|${norm(episodeTitle)}|${watchedDate}`;
}

/** Yield to the JS event loop so the UI can breathe between chunks. */
function yieldToUI(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const PARSE_CHUNK = 200;

async function parseNetflix(text: string): Promise<ParseResult> {
  const out: ParseResult = { entries: [], errors: [] };
  const rows = csvRows(text);

  // ── Pre-pass: build prefix frequency maps ─────────────────────────────────

  // Map 1: for 2-part titles — count how many rows share the same first segment
  const twoPartPrefixCount = new Map<string, number>();
  // Map 2: for 3+-part titles — count how many rows share the same first-two-segment compound
  const compoundPrefixCount = new Map<string, number>();

  for (const { row: r } of rows) {
    const rawTitle = (r["Title"] as string | undefined)?.trim() ?? "";
    const parts = rawTitle.split(":").map((p) => p.trim());
    if (parts.length === 2) {
      const key = norm(parts[0]);
      twoPartPrefixCount.set(key, (twoPartPrefixCount.get(key) ?? 0) + 1);
    }
    if (parts.length >= 3) {
      const key = norm(`${parts[0]}:${parts[1]}`);
      compoundPrefixCount.set(key, (compoundPrefixCount.get(key) ?? 0) + 1);
    }
  }

  // ── Main pass: classify and emit entries ──────────────────────────────────

  for (let i = 0; i < rows.length; i++) {
    if (i > 0 && i % PARSE_CHUNK === 0) await yieldToUI();

    const { row: r, sourceRow } = rows[i];
    const rawTitle = (r["Title"] as string | undefined)?.trim() ?? "";
    const rawDate = (r["Date"] as string | undefined)?.trim() ?? "";

    if (!rawTitle || !rawDate) {
      out.errors.push(`Row ${sourceRow}: missing Title or Date — skipped`);
      continue;
    }

    const watchedDate = parseNetflixDate(rawDate);
    if (!watchedDate) {
      out.errors.push(`Row ${sourceRow}: unrecognised date "${rawDate}" — skipped`);
      continue;
    }

    const parsed = parseTitle(rawTitle, twoPartPrefixCount, compoundPrefixCount);

    if (parsed.kind === "film") {
      const film: Film = {
        id: uid(),
        kind: "film",
        source: "netflix",
        tier: 3,
        start: watchedDate,
        datePrecision: "day",
        title: parsed.title,
        dedupeKey: filmDedupeKey(parsed.title, watchedDate),
        sourceRef: `netflix:row:${sourceRow}`,
        createdAt: now(),
        confidence: "confirmed",
        raw: r as Record<string, unknown>,
      };
      out.entries.push({ entry: film, warnings: [], sourceRow });
    } else {
      const ep: Episode = {
        id: uid(),
        kind: "episode",
        source: "netflix",
        tier: 3,
        start: watchedDate,
        datePrecision: "day",
        showTitle: parsed.showTitle,
        season: parsed.season,
        episodeTitle: parsed.episodeTitle,
        dedupeKey: episodeDedupeKey(
          parsed.showTitle,
          parsed.season,
          parsed.episodeTitle,
          watchedDate,
        ),
        sourceRef: `netflix:row:${sourceRow}`,
        createdAt: now(),
        confidence: "confirmed",
        raw: r as Record<string, unknown>,
      };
      out.entries.push({ entry: ep, warnings: [], sourceRow });
    }
  }

  return out;
}

export const connector: Connector = {
  id: "netflix",
  label: "Netflix viewing history",
  kind: "file",
  tier: 3,
  accepts: [".csv"],
  sniff(name, head) {
    const n = name.toLowerCase();
    if (n.includes("netflix")) return 0.95;
    // Header is exactly "title,date" (csvRows lowercases keys via csvRows normalisation)
    if (head.replace(/\s/g, "") === "title,date") return 0.85;
    return 0;
  },
  parse({ text }) {
    return parseNetflix(text);
  },
};
