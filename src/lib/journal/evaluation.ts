/**
 * Universal evaluation fields: `rating` (0–10), `reflection` (user prose), `review` (source text).
 *
 * Rules:
 *  - Only entries (events) and containers (Trip, Series) carry them. No day-level reflections.
 *  - `review` is written only by connectors; it is read-only in the UI.
 *  - `reflection` is user-owned and never overwritten by connectors or supersede.
 *  - `sourceLocked` tracks only rating provenance now (reflection/review split replaces the old "reflection" lock).
 */
import type { Entry, Trip } from "./types";

export type EvalField = "rating" | "reflection";

/** Fields this freshly imported entry already filled from its source. */
export function sourceLocks(e: Pick<Entry, "source" | "rating">): ("rating")[] {
  if (e.source === "manual") return [];
  const out: ("rating")[] = [];
  if (e.rating !== undefined && e.rating !== null) out.push("rating");
  return out;
}

export function isLocked(e: Pick<Entry, "sourceLocked" | "review">, field: EvalField): boolean {
  if (field === "reflection") return !!e.review; // presence of review locks reflection
  return !!e.sourceLocked?.includes("rating");
}

function rawHasText(raw: Record<string, unknown> | undefined, text: string): boolean {
  if (!raw) return false;
  const t = text.trim();
  return Object.values(raw).some((v) => typeof v === "string" && v.trim() === t);
}

/**
 * Normalise a legacy entry: fold `journal` into `reflection`, infer source locks,
 * and migrate old `sourceLocked: ["reflection"]` entries to use the `review` field.
 * Returns null when unchanged.
 */
export function migrateEntryEvaluation<T extends Entry>(e: T): T | null {
  const legacy = e as T & { journal?: string };
  const hasJournal = "journal" in legacy;
  const needsLocks = e.sourceLocked === undefined;
  // Belt-and-suspenders: migrate old sourceLocked reflection → review
  const hasLegacyReflectionLock = (e.sourceLocked as string[] | undefined)?.includes("reflection");
  if (!hasJournal && !needsLocks && !hasLegacyReflectionLock) return null;
  const next = { ...legacy } as T & { journal?: string };
  if (hasJournal) {
    if (!next.reflection && legacy.journal) next.reflection = legacy.journal;
    delete next.journal;
  }
  if (needsLocks) {
    const locks: ("rating")[] = [];
    if (e.source !== "manual") {
      if (next.rating !== undefined && next.rating !== null) locks.push("rating");
      // Only lock a reflection we can prove came from the source payload.
      if (next.reflection && rawHasText(next.raw, next.reflection)) {
        // Move source-supplied text to review instead of locking reflection
        next.review = next.review ?? next.reflection;
        next.reflection = undefined;
        // Do not push "reflection" to locks — that field is gone
      }
    }
    next.sourceLocked = locks.length ? locks : undefined;
  }
  if (hasLegacyReflectionLock && next.reflection) {
    // Move locked reflection to review field
    if (!next.review) next.review = next.reflection;
    next.reflection = undefined;
    // Remove "reflection" from sourceLocked
    next.sourceLocked = (next.sourceLocked as string[] | undefined)?.filter((f) => f !== "reflection") as ("rating")[] | undefined;
    if (next.sourceLocked?.length === 0) next.sourceLocked = undefined;
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
 * `reflection` is NEVER replaced by a supersede — it belongs to the user.
 */
export function mergeEvaluation<T extends Entry>(incoming: T, old: Entry): T {
  const locks = sourceLocks(incoming);
  return {
    ...incoming,
    // Source-side: review comes from incoming (updated source text)
    review: incoming.review,
    // User-side: reflection is NEVER replaced by a supersede
    reflection: old.reflection ?? incoming.reflection,
    // Rating: source-locked rating wins; otherwise keep user's rating
    rating: locks.includes("rating") ? incoming.rating : (old.rating ?? incoming.rating),
    sourceLocked: locks.length ? locks : undefined,
  };
}
