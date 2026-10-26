/**
 * Splitting an auto-merge (docs/specs/merge-dedup.md, section 4.8).
 *
 * An import can fold a row into an existing entry (same key). If that was wrong, the user
 * splits the row back out. The split entry keeps the row's own dedupeKey, so it is found
 * by a hash of the row's source fields (`separateRows`) or by its sourceRef, never by key.
 */
import { NOT_SOURCE_FIELDS, stable } from "./classify";
import type { Entry } from "./types";

/** Fingerprint of what a source said about a row, independent of filename and user data. */
export function rowHash(e: Entry): string {
  const fields: Record<string, unknown> = { source: e.source };
  for (const [k, v] of Object.entries(e as unknown as Record<string, unknown>)) {
    if (v === undefined || NOT_SOURCE_FIELDS.has(k)) continue;
    fields[k] = v;
  }
  // FNV-1a over the stable JSON: short, synchronous and good enough to tell rows apart.
  const text = stable(fields);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** An entry that came out of a split. */
export const isSplitEntry = (e: Entry) => (e.separateRows?.length ?? 0) > 0;

const refKey = (source: string, sourceRef: string | undefined) => (sourceRef ? `r:${source}|${sourceRef}` : undefined);

/** Split entries by the rows they own: `h:<hash>` and `r:<source>|<sourceRef>`. */
export type SplitIndex = Map<string, Entry>;

export function buildSplitIndex(entries: Iterable<Entry>): SplitIndex {
  const index: SplitIndex = new Map();
  for (const e of entries) {
    if (!isSplitEntry(e)) continue;
    for (const h of e.separateRows!) index.set(`h:${h}`, e);
    const r = refKey(e.source, e.sourceRef);
    if (r) index.set(r, e);
  }
  return index;
}

/** The split entry that owns this incoming row, if any. */
export function findSplitEntry(row: Entry, index: SplitIndex): Entry | undefined {
  const r = refKey(row.source, row.sourceRef);
  return index.get(`h:${rowHash(row)}`) ?? (r ? index.get(r) : undefined);
}
