/**
 * Universal evaluation fields: `rating` (0–10) and `reflection` (prose).
 *
 * Rules:
 *  - Only entries (events) and containers (Trip, Series) carry them. No day-level reflections.
 *  - A value supplied by an import source (e.g. a Letterboxd review or Goodreads rating)
 *    is read-only provenance; the field is listed in `entry.sourceLocked`.
 *  - Fields the source left empty are the user's to write.
 */
import type { Entry, Trip } from "./types";

export type EvalField = "rating" | "reflection";

/** Fields this freshly imported entry already filled from its source. */
export function sourceLocks(e: Pick<Entry, "source" | "rating" | "reflection">): EvalField[] {
  if (e.source === "manual") return [];
  const out: EvalField[] = [];
  if (e.rating !== undefined && e.rating !== null) out.push("rating");
  if (e.reflection && e.reflection.trim()) out.push("reflection");
  return out;
}

export function isLocked(e: Pick<Entry, "sourceLocked">, field: EvalField): boolean {
  return !!e.sourceLocked?.includes(field);
}

function rawHasText(raw: Record<string, unknown> | undefined, text: string): boolean {
  if (!raw) return false;
  const t = text.trim();
  return Object.values(raw).some((v) => typeof v === "string" && v.trim() === t);
}

/**
 * Normalise a legacy entry: fold `journal` into `reflection` and infer source locks
 * for entries stored before `sourceLocked` existed. Returns null when unchanged.
 */
export function migrateEntryEvaluation<T extends Entry>(e: T): T | null {
  const legacy = e as T & { journal?: string };
  const hasJournal = "journal" in legacy;
  const needsLocks = e.sourceLocked === undefined;
  if (!hasJournal && !needsLocks) return null;
  const next = { ...legacy } as T & { journal?: string };
  if (hasJournal) {
    if (!next.reflection && legacy.journal) next.reflection = legacy.journal;
    delete next.journal;
  }
  if (needsLocks) {
    const locks: EvalField[] = [];
    if (e.source !== "manual") {
      if (next.rating !== undefined && next.rating !== null) locks.push("rating");
      // Only lock a reflection we can prove came from the source payload.
      if (next.reflection && rawHasText(next.raw, next.reflection)) locks.push("reflection");
    }
    next.sourceLocked = locks;
  }
  return next;
}

/** Fold legacy `Trip.notes` into `Trip.reflection`. Returns null when unchanged. */
export function migrateTripEvaluation(t: Trip): Trip | null {
  if (!("notes" in t)) return null;
  const next = { ...t };
  if (!next.reflection && t.notes) next.reflection = t.notes;
  delete next.notes;
  return next;
}

/**
 * When a source record supersedes an existing entry, source-supplied values win
 * (they are provenance); otherwise the user's existing value is kept.
 */
export function mergeEvaluation<T extends Entry>(incoming: T, old: Entry): T {
  const locks = sourceLocks(incoming);
  return {
    ...incoming,
    rating: locks.includes("rating") ? incoming.rating : (old.rating ?? incoming.rating),
    reflection: locks.includes("reflection") ? incoming.reflection : (old.reflection ?? incoming.reflection),
    sourceLocked: locks,
  };
}
