/**
 * Field-picking and value-coercion helpers shared by all connectors.
 * Moved verbatim from parsers.ts — no behaviour change.
 */
import type { Purpose } from "../types";

/** Normalise to lowercase alphanumeric for fuzzy header matching. */
export const nk = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Return the first non-empty value in `row` whose header matches one of the
 * given `aliases` (after normalisation via `nk`).
 */
export function pick(row: Record<string, unknown>, aliases: string[]): string {
  const keys = Object.keys(row);
  for (const a of aliases) {
    const k = keys.find((k) => nk(k) === nk(a));
    if (k && row[k] != null && String(row[k]).trim()) return String(row[k]).trim();
  }
  return "";
}

const PURPOSE_VALUES: Purpose[] = ["work", "family", "leisure", "other"];
export function purposeFrom(row: Record<string, unknown>): Purpose | undefined {
  const v = pick(row as Record<string, string>, ["purpose"]).toLowerCase();
  return (PURPOSE_VALUES as string[]).includes(v) ? (v as Purpose) : undefined;
}

export function companionsFrom(row: Record<string, unknown>): string[] | undefined {
  const v = pick(row as Record<string, string>, [
    "companions",
    "with",
    "people",
    "guests",
  ]);
  const list = v
    .split(/[;|,]/)
    .map((x) => x.trim())
    .filter(Boolean);
  return list.length ? list : undefined;
}

