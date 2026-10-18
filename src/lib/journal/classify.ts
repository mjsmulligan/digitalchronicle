import type { Entry, StagedRecord } from "./types";

/** What classify() decides about one incoming record. */
export type Classification = Pick<StagedRecord, "status" | "matchId">;

/**
 * Lookup of everything already in the journal, by dedupeKey. Pass visible AND
 * hidden entries: a hidden entry is a record the user removed, and the importer
 * must recognise it so that re-importing never brings it back.
 *
 * If a visible and a hidden entry share a key (data from before hidden entries
 * were indexed), the visible one wins, because it is what the user sees.
 * Among entries of the same visibility the last one wins.
 */
export function buildDedupeIndex(entries: Iterable<Entry>): Map<string, Entry> {
  const index = new Map<string, Entry>();
  for (const e of entries) {
    const prev = index.get(e.dedupeKey);
    if (prev && !prev.hidden && e.hidden) continue;
    index.set(e.dedupeKey, e);
  }
  return index;
}

/**
 * Decides what to do with one incoming record. Isolated in its own function so
 * the source precedence rules (tiers) can be redesigned without touching the
 * importers.
 *
 *   batch-duplicate  same key seen earlier in this file
 *   new              no match in the journal
 *   removed          matches an entry the user hid, whatever its tier
 *   supersedes       match with a higher tier number (lower precedence)
 *   superseded       match with a lower tier number (higher precedence)
 *   duplicate        match with the same tier
 *
 * `seen` is the set of keys already classified in this file; classify adds to it.
 */
export function classify(entry: Entry, existing: Map<string, Entry>, seen: Set<string>): Classification {
  if (seen.has(entry.dedupeKey)) return { status: "batch-duplicate" };
  seen.add(entry.dedupeKey);
  const m = existing.get(entry.dedupeKey);
  if (!m) return { status: "new" };
  if (m.hidden) return { status: "removed", matchId: m.id };
  if (entry.tier < m.tier) return { status: "supersedes", matchId: m.id };
  if (entry.tier > m.tier) return { status: "superseded", matchId: m.id };
  return { status: "duplicate", matchId: m.id };
}
