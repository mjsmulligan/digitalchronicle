/**
 * Artwork enrichment service — event posters WP4.
 *
 * Two public functions:
 *
 *   resolveArtwork(key)         — single-key lookup: cache → provider → store.
 *   enrichAll(entries, signal)  — background batch for all unmatched entries.
 *
 * Both respect the "Fetch posters" toggle (setFetchPostersEnabled).
 * WP5 wires up the toggle to a persisted user preference; WP4 manages the
 * in-memory state so unit tests can flip it without any I/O.
 *
 * Storage and provider are resolved lazily via the injected singletons from
 * artwork.ts and artworkProvider.ts — callers must call setArtworkStorage()
 * and setArtworkProvider() before the first resolve call.
 */

import {
  artworkStorage,
  eventToArtworkKey,
  type ArtworkMatch,
  type ArtworkMediaType,
} from "./artwork";
import { getArtworkProvider, CONFIDENCE_THRESHOLD } from "./artworkProvider";
import type { Entry } from "./types";

// ─── Settings toggle ──────────────────────────────────────────────────────────

/**
 * In-memory "Fetch posters" flag. Default: on.
 * WP5 reads the persisted preference at app start and calls this setter.
 */
let _fetchEnabled = true;

export function getFetchPostersEnabled(): boolean {
  return _fetchEnabled;
}

/**
 * Flip the toggle. When disabled, resolveArtwork and enrichAll make no
 * network calls; already-cached posters are unaffected and still displayed.
 */
export function setFetchPostersEnabled(enabled: boolean): void {
  _fetchEnabled = enabled;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Negative results (status "none") are retried after this many days. */
const STALE_NONE_DAYS = 30;

/** Maximum concurrent provider calls during enrichAll. */
const ENRICH_CONCURRENCY = 3;

// ─── resolveArtwork ───────────────────────────────────────────────────────────

/**
 * Resolve artwork for a single artwork key.
 *
 * Resolution order:
 *  1. Return any "manual" or "matched" cache hit immediately (no network).
 *  2. Return null for a "none" hit that is less than STALE_NONE_DAYS old.
 *  3. If toggle is off, return null without fetching.
 *  4. Fetch from the provider.
 *     - On network/provider error: return null, write nothing.
 *     - On a confident match: write status "matched", return the record.
 *     - On no match: write status "none" (cached for STALE_NONE_DAYS), return null.
 */
export async function resolveArtwork(key: string): Promise<ArtworkMatch | null> {
  const storage = artworkStorage();

  // ── 1 & 2: cache check ──────────────────────────────────────────────────────
  const cached = await storage.getByKey(key);
  if (cached) {
    if (cached.status === "manual" || cached.status === "matched") return cached;
    if (cached.status === "none") {
      const cutoff = staleCutoff();
      if (cached.fetched_at >= cutoff) return null; // non-stale negative — skip
      // Stale none: fall through to re-fetch
    }
  }

  // ── 3: toggle check ──────────────────────────────────────────────────────────
  if (!_fetchEnabled) return null;

  // ── 4: fetch ─────────────────────────────────────────────────────────────────
  const provider = getArtworkProvider();
  if (!provider) return null;

  const parsed = parseKey(key);
  if (!parsed) return null;

  try {
    const result =
      parsed.mediaType === "movie"
        ? await provider.findMovie(parsed.normTitle, parsed.year)
        : await provider.findTv(parsed.normTitle);

    const now = new Date().toISOString();

    if (result !== null && result.confidence >= CONFIDENCE_THRESHOLD) {
      const match: ArtworkMatch = {
        id: key,
        key,
        media_type: parsed.mediaType,
        status: "matched",
        provider: result.provider,
        provider_id: result.provider_id,
        poster_path: result.poster_path ?? undefined,
        title_matched: result.title_matched,
        confidence: result.confidence,
        fetched_at: now,
      };
      await storage.upsert(match);
      return match;
    }

    // No confident match — cache as "none" to avoid re-fetching for 30 days
    const none: ArtworkMatch = {
      id: key,
      key,
      media_type: parsed.mediaType,
      status: "none",
      provider: "tmdb",
      fetched_at: now,
    };
    await storage.upsert(none);
    return null;
  } catch {
    // Network failure or provider error — leave key unresolved, write nothing
    return null;
  }
}

// ─── enrichAll ────────────────────────────────────────────────────────────────

/**
 * Background enrichment of all unmatched Film and Episode entries.
 *
 * Steps:
 *  1. Collect distinct artwork keys across all entries.
 *  2. Skip keys that are already resolved (matched / manual / non-stale none).
 *  3. Resolve remaining keys with up to ENRICH_CONCURRENCY concurrent calls.
 *  4. Abort early if the optional AbortSignal fires.
 *
 * Safe to call from import completion hooks and on app start.
 * A partial run leaves already-resolved keys intact.
 */
export async function enrichAll(
  entries: Entry[],
  signal?: AbortSignal,
): Promise<void> {
  if (!_fetchEnabled) return;
  if (!getArtworkProvider()) return;
  if (signal?.aborted) return;

  // ── 1: collect distinct keys ──────────────────────────────────────────────
  const keySet = new Set<string>();
  for (const entry of entries) {
    const key = eventToArtworkKey(entry);
    if (key) keySet.add(key);
  }
  if (!keySet.size) return;

  // ── 2: filter to unresolved ────────────────────────────────────────────────
  const storage = artworkStorage();
  const cutoff = staleCutoff();
  const toResolve: string[] = [];

  for (const key of keySet) {
    if (signal?.aborted) return;
    const cached = await storage.getByKey(key);
    if (!cached) {
      toResolve.push(key);
    } else if (cached.status === "none" && cached.fetched_at < cutoff) {
      toResolve.push(key); // stale negative — eligible for retry
    }
    // matched / manual — already done, skip
  }

  if (!toResolve.length || signal?.aborted) return;

  // ── 3: resolve with concurrency limit ─────────────────────────────────────
  //
  // Classic JS worker-pool: multiple async workers each claim the next index
  // from a shared counter. Because `i++` is synchronous, no two workers claim
  // the same item. Workers stop when the counter is exhausted or aborted.
  //
  let i = 0;

  async function worker(): Promise<void> {
    while (i < toResolve.length) {
      if (signal?.aborted) return;
      const key = toResolve[i++];
      await resolveArtwork(key);
    }
  }

  const workerCount = Math.min(ENRICH_CONCURRENCY, toResolve.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** ISO timestamp of the stale-none cutoff (now minus STALE_NONE_DAYS). */
function staleCutoff(): string {
  const d = new Date();
  d.setDate(d.getDate() - STALE_NONE_DAYS);
  return d.toISOString();
}

interface ParsedKey {
  mediaType: ArtworkMediaType;
  normTitle: string;
  year: number | undefined;
}

/** Decompose an artwork key back into its constituent parts. Returns null for malformed keys. */
function parseKey(key: string): ParsedKey | null {
  const parts = key.split("|");
  if (parts.length !== 3) return null;
  const [mediaTypeRaw, normTitle, yearStr] = parts;
  if (mediaTypeRaw !== "movie" && mediaTypeRaw !== "tv") return null;
  if (!normTitle) return null;
  const year = yearStr ? parseInt(yearStr, 10) : undefined;
  return {
    mediaType: mediaTypeRaw,
    normTitle,
    year: year !== undefined && !isNaN(year) ? year : undefined,
  };
}
