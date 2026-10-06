/**
 * Universal evaluation helpers — rating (0–10) and reflection (prose).
 *
 * Rules
 * -----
 * 1. Evaluation fields belong to entries and containers (Trip, Series) only —
 *    never to calendar dates.
 * 2. Fields supplied by an external source are provenance-locked in
 *    `sourceLocked` and must be shown read-only in the UI.
 * 3. Unlocked fields (manual entries, or fields the source left empty) are
 *    freely user-editable.
 */

export type EvalField = "rating" | "reflection";

// ── Source lock rules ─────────────────────────────────────────────────────────

/**
 * Returns the evaluation fields that should be locked for a given source.
 * "locked" means: the value came from an authoritative external record and
 * the user cannot override it (the source owns it).
 */
export function sourceLocks(e: { source?: string }): EvalField[] {
  const s = e.source ?? "";
  // Letterboxd: diary supplies both rating (1–5 → doubled to 0–10) and
  // review text (mapped to reflection). Both are external provenance.
  if (s === "letterboxd") return ["rating", "reflection"];
  // Goodreads: supplies a 1–5 star rating (doubled to 0–10).
  if (s === "goodreads") return ["rating"];
  // All other sources: no evaluation locks.
  return [];
}

// ── Field-level lock check ────────────────────────────────────────────────────

/**
 * Returns true if `field` is provenance-locked for this entry/container.
 * A locked field must be rendered read-only with a source badge in the UI.
 */
export function isLocked(
  e: { sourceLocked?: EvalField[] },
  field: EvalField,
): boolean {
  return e.sourceLocked?.includes(field) ?? false;
}

// ── Boot migration helpers ────────────────────────────────────────────────────

/**
 * Idempotent migration for a single entry:
 *  1. Promotes the legacy `journal` field to `reflection` if reflection is absent.
 *  2. Assigns `sourceLocked` from source rules if not already present.
 *
 * Returns the same object reference when nothing changed, so callers can use
 * reference equality to detect no-ops.
 */
export function migrateEntryEvaluation<
  T extends {
    source?: string;
    journal?: string;
    reflection?: string;
    sourceLocked?: EvalField[];
  },
>(e: T): T {
  const locks = sourceLocks(e);
  const needsReflect = !!(e.journal && !e.reflection);
  const needsLocks = locks.length > 0 && !e.sourceLocked;

  if (!needsReflect && !needsLocks) return e;

  const next: T = { ...e };
  if (needsReflect) next.reflection = e.journal;
  if (needsLocks) next.sourceLocked = locks;
  return next;
}

/**
 * Idempotent migration for a trip:
 *  Moves the deprecated `notes` field to `reflection` if reflection is absent.
 */
export function migrateTripEvaluation<T extends { notes?: string; reflection?: string }>(
  t: T,
): T {
  if (t.notes && !t.reflection) {
    return { ...t, reflection: t.notes };
  }
  return t;
}

// ── Merge helper (used in commitBatch for supersedes) ────────────────────────

/**
 * Merges evaluation fields from an incoming (import) entry onto an existing
 * stored entry.
 *
 * - Locked fields: always take the incoming source value (provenance wins).
 * - Unlocked fields: keep the existing user value if present; otherwise fall
 *   back to the incoming value.
 */
export function mergeEvaluation<
  T extends {
    rating?: number;
    reflection?: string;
    sourceLocked?: EvalField[];
  },
>(
  incoming: T,
  old: T,
): { rating?: number; reflection?: string; sourceLocked?: EvalField[] } {
  const locks: EvalField[] = incoming.sourceLocked ?? [];
  return {
    rating: locks.includes("rating")
      ? incoming.rating
      : (old.rating ?? incoming.rating),
    reflection: locks.includes("reflection")
      ? incoming.reflection
      : (old.reflection ?? incoming.reflection),
    sourceLocked: incoming.sourceLocked,
  };
}
