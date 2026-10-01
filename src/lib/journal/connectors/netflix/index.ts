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
 *     or is a 4-digit year (e.g. WWE SmackDown: 2025: ...)
 *                                             → Episode
 *  4. No pattern matched                      → Film
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

/** Season-like label patterns. */
const SEASON_LABEL_RE =
  /^(Season|Part|Volume|Chapter|Series)\s+\d+/i;
const YEAR_LABEL_RE = /^\d{4}$/;

type ParsedTitle =
  | { kind: "film"; title: string }
  | { kind: "episode"; showTitle: string; season: string; episodeTitle: string };

/**
 * Parse a Netflix title string into either a Film or Episode descriptor.
 * Netflix encodes show structure with colons: "Show: Season N: Episode"
 */
function parseTitle(raw: string): ParsedTitle {
  const parts = raw.split(":").map((p) => p.trim());

  if (parts.length >= 3) {
    const show = parts[0];
    const middle = parts[1];
    // Remainder after show and season label
    const episode = parts.slice(2).join(": ").trim();

    if (
      /^limited series$/i.test(middle) ||
      SEASON_LABEL_RE.test(middle) ||
      YEAR_LABEL_RE.test(middle)
    ) {
      return { kind: "episode", showTitle: show, season: middle, episodeTitle: episode };
    }
  }

  // Two parts: "Show: Something" — not enough info to confirm episode structure.
  // Treat as Film (can be corrected manually).
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

function parseNetflix(text: string): ParseResult {
  const out: ParseResult = { entries: [], errors: [] };
  const rows = csvRows(text);

  // Two-pass classification for ambiguous 2-part titles ("Show: Episode Title").
  // If the same first segment appears with 2+ distinct second segments, it's a
  // show — classify those rows as episodes. Singletons remain as films.
  const twoPartPrefixCount = new Map<string, number>();
  for (const { row: r } of rows) {
    const rawTitle = (r["Title"] as string | undefined)?.trim() ?? "";
    const parts = rawTitle.split(":").map((p) => p.trim());
    if (parts.length === 2) {
      const prefix = norm(parts[0]);
      twoPartPrefixCount.set(prefix, (twoPartPrefixCount.get(prefix) ?? 0) + 1);
    }
  }

  rows.forEach(({ row: r, sourceRow }) => {
    const rawTitle = (r["Title"] as string | undefined)?.trim() ?? "";
    const rawDate = (r["Date"] as string | undefined)?.trim() ?? "";

    if (!rawTitle || !rawDate) {
      out.errors.push(`Row ${sourceRow}: missing Title or Date — skipped`);
      return;
    }

    const watchedDate = parseNetflixDate(rawDate);
    if (!watchedDate) {
      out.errors.push(`Row ${sourceRow}: unrecognised date "${rawDate}" — skipped`);
      return;
    }

    // Override 2-part titles where the prefix is a known show (seen 2+ times)
    const parts = rawTitle.split(":").map((p) => p.trim());
    const is2PartShow = parts.length === 2 && (twoPartPrefixCount.get(norm(parts[0])) ?? 0) >= 2;

    const parsed = is2PartShow
      ? { kind: "episode" as const, showTitle: parts[0], season: "", episodeTitle: parts[1] }
      : parseTitle(rawTitle);

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
  });

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
