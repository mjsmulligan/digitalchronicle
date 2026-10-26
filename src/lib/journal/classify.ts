import { findSplitEntry, type SplitIndex } from "./split";
import type { Entry } from "./types";

/** What classify() decides about one incoming record. */
export type ClassificationStatus = "batch-duplicate" | "new" | "removed" | "refresh" | "enrich" | "duplicate";
export type Classification = { status: ClassificationStatus; matchId?: string; split?: true };

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
    // A split entry shares its key with the entry it was split from; the key belongs to that one.
    if (e.separateRows?.length) continue;
    const prev = index.get(e.dedupeKey);
    if (prev && !prev.hidden && e.hidden) continue;
    index.set(e.dedupeKey, e);
  }
  return index;
}

/**
 * Fields that never count as a source change: identity, bookkeeping set by the
 * importer, and everything the user owns. Anything the user corrected lives in
 * `overrides`, and those fields are skipped too (see hasSourceChanges).
 */
export const NOT_SOURCE_FIELDS = new Set([
  "id", "source", "dedupeKey", "createdAt", "sourceRef", "sourceLocked",
  "importId", "importNotes", "unreviewed", "hidden",
  "overrides", "reflection", "participants", "tripId", "seriesId", "additionalSources", "absorbed", "fieldSources", "separateRows",
]);

/** Order-independent JSON, so two equal objects compare equal whatever their key order. */
export function stable(v: unknown): string {
  return JSON.stringify(v, (_k, val) =>
    val && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : val,
  );
}

/**
 * True when `incoming` says something different from `existing` about a field
 * the source owns. Only fields the incoming record defines are compared, so a
 * rating or note the user added where the source had none is not a change, and
 * fields the user overrode are ignored. An unchanged re-import must report false.
 */
export function hasSourceChanges(incoming: Entry, existing: Entry): boolean {
  const overridden = new Set(Object.keys((existing.overrides ?? {}) as Record<string, unknown>));
  const inc = incoming as unknown as Record<string, unknown>;
  const old = existing as unknown as Record<string, unknown>;
  for (const key of Object.keys(inc)) {
    if (NOT_SOURCE_FIELDS.has(key) || overridden.has(key)) continue;
    if (inc[key] === undefined) continue;
    // A field another row filled in (see fieldSources) is not contradicted by a blank here.
    if (existing.fieldSources?.[key] !== undefined && (inc[key] === "" || inc[key] === null)) continue;
    if (stable(inc[key]) !== stable(old[key])) return true;
  }
  return false;
}

/**
 * Decides what to do with one incoming record. Isolated in its own function so
 * the matching rules can change without touching the importers. There is no
 * source precedence: no source ever replaces another.
 *
 *   batch-duplicate  same key seen earlier in this file
 *   new              no match in the journal
 *   removed          matches an entry the user hid
 *   refresh          match from the same source whose source fields changed
 *   enrich           match from a different source (fills gaps, see the merge spec)
 *   duplicate        match from the same source with nothing changed
 *
 * `splits` (see split.ts) routes a row the user split apart to its own entry first.
 *
 * `seen` is the set of keys already classified in this file; classify adds to it.
 */
export function classify(
  entry: Entry,
  existing: Map<string, Entry>,
  seen: Set<string>,
  splits?: SplitIndex,
): Classification {
  // A row the user split out of another entry belongs to its own entry, whatever its key says.
  const owner = splits && findSplitEntry(entry, splits);
  if (owner) {
    if (owner.hidden) return { status: "removed", matchId: owner.id, split: true };
    return { status: hasSourceChanges(entry, owner) ? "refresh" : "duplicate", matchId: owner.id, split: true };
  }
  if (seen.has(entry.dedupeKey)) return { status: "batch-duplicate" };
  seen.add(entry.dedupeKey);
  const m = existing.get(entry.dedupeKey);
  if (!m) return { status: "new" };
  if (m.hidden) return { status: "removed", matchId: m.id };
  if (entry.source !== m.source) return { status: "enrich", matchId: m.id };
  return { status: hasSourceChanges(entry, m) ? "refresh" : "duplicate", matchId: m.id };
}
