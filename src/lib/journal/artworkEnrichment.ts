/**
 * Artwork enrichment service — event posters WP4 + book covers WP3 + artist images.
 *
 * Public functions:
 *
 *   resolveArtwork(key)              — single-key lookup for films/TV: cache → provider → store.
 *   resolveBookCoverForEntry(entry)  — book cover lookup: cache → provider → store.
 *   resolveArtistImage(artistName)   — artist image lookup: cache → TheAudioDB → store.
 *   enrichAll(entries, signal)       — background batch for all unmatched entries (films + books + artists).
 *
 * Films/TV respect the "Fetch posters" toggle (setFetchPostersEnabled).
 * Books respect the "Fetch book covers" toggle (setFetchBookCoversEnabled).
 * Artist images are always fetched when the provider is set (no separate toggle).
 * WP5 wires up the toggles to persisted user preferences; this module manages
 * in-memory state so unit tests can flip them without any I/O.
 *
 * Storage and providers are resolved lazily via injected singletons:
 *   artwork.ts             — setArtworkStorage()
 *   artworkProvider.ts     — setArtworkProvider()
 *   bookCoverProvider.ts   — setBookCoverProvider()
 *   artistImageProvider.ts — setArtistImageProvider()
 */

import {
  artworkStorage,
  eventToArtworkKey,
  bookToArtworkKey,
  artistToArtworkKey,
  type ArtworkMatch,
  type ArtworkMediaType,
} from "./artwork";
import { getArtworkProvider, CONFIDENCE_THRESHOLD } from "./artworkProvider";
import { getBookCoverProvider } from "./bookCoverProvider";
import { getArtistImageProvider } from "./artistImageProvider";
import { normaliseTitle } from "./artwork";
import type { Entry, Book, JEvent } from "./types";

// ─── Settings toggles ─────────────────────────────────────────────────────────

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

/**
 * In-memory "Fetch book covers" flag. Default: on.
 * Book covers WP3 reads the persisted preference at app start and calls this setter.
 */
let _fetchBookCoversEnabled = true;

export function getFetchBookCoversEnabled(): boolean {
  return _fetchBookCoversEnabled;
}

/**
 * Flip the book covers toggle. When disabled, resolveBookCoverForEntry and
 * enrichAll skip book cover lookups; already-cached covers still display.
 */
export function setFetchBookCoversEnabled(enabled: boolean): void {
  _fetchBookCoversEnabled = enabled;
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
  let storage: ReturnType<typeof artworkStorage>;
  try { storage = artworkStorage(); } catch { return null; }

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

// ─── resolveBookCoverForEntry ─────────────────────────────────────────────────

/**
 * Resolve a cover image for a single Book entry.
 *
 * Resolution order mirrors resolveArtwork:
 *  1. Return any cached "manual" or "matched" hit immediately (no network).
 *  2. Return null for a "none" hit younger than STALE_NONE_DAYS.
 *  3. If the book covers toggle is off, return null.
 *  4. Fetch from the book cover provider.
 *
 * Unlike resolveArtwork this takes the full entry (not just the key) because
 * findBook requires author and isbn13, which are not encoded in the key.
 */
export async function resolveBookCoverForEntry(entry: Book): Promise<ArtworkMatch | null> {
  const key = bookToArtworkKey(entry);
  if (!key) return null;

  let storage: ReturnType<typeof artworkStorage>;
  try { storage = artworkStorage(); } catch { return null; }

  // ── 1 & 2: cache check ──────────────────────────────────────────────────────
  const cached = await storage.getByKey(key);
  if (cached) {
    if (cached.status === "manual" || cached.status === "matched") return cached;
    if (cached.status === "none") {
      const cutoff = staleCutoff();
      if (cached.fetched_at >= cutoff) return null;
      // Stale none: fall through to re-fetch
    }
  }

  // ── 3: toggle check ──────────────────────────────────────────────────────────
  if (!_fetchBookCoversEnabled) return null;

  // ── 4: fetch ─────────────────────────────────────────────────────────────────
  const provider = getBookCoverProvider();
  if (!provider) return null;

  const normTitle = normaliseTitle(entry.title);
  const now = new Date().toISOString();

  try {
    const result = await provider.findBook(normTitle, entry.author, entry.isbn13);

    if (result !== null && result.confidence >= CONFIDENCE_THRESHOLD) {
      const match: ArtworkMatch = {
        id: key,
        key,
        media_type: "book",
        status: "matched",
        provider: result.provider,
        poster_path: result.poster_path,
        title_matched: result.title_matched,
        confidence: result.confidence,
        fetched_at: now,
      };
      await storage.upsert(match);
      return match;
    }

    // No confident match — cache as "none" for STALE_NONE_DAYS
    const none: ArtworkMatch = {
      id: key,
      key,
      media_type: "book",
      status: "none",
      provider: "open_library",
      fetched_at: now,
    };
    await storage.upsert(none);
    return null;
  } catch {
    return null;
  }
}

// ─── resolveArtistImage ───────────────────────────────────────────────────────

/**
 * Resolve a concert artist image from TheAudioDB.
 *
 * Resolution order mirrors resolveArtwork:
 *  1. Return any cached "manual" or "matched" hit immediately.
 *  2. Return null for a "none" hit younger than STALE_NONE_DAYS.
 *  3. If no provider is set, return null.
 *  4. Fetch from TheAudioDB, cache result.
 *
 * poster_path stores the full image URL for TheAudioDB (no imageUrl() needed
 * on the provider — just return the path directly).
 */
export async function resolveArtistImage(artistName: string): Promise<ArtworkMatch | null> {
  const key = artistToArtworkKey(artistName);
  if (!key) { console.log("[ArtistImg] no key for:", artistName); return null; }

  let storage: ReturnType<typeof artworkStorage>;
  try { storage = artworkStorage(); } catch (e) { console.log("[ArtistImg] storage not ready:", e); return null; }

  // ── 1 & 2: cache check ──────────────────────────────────────────────────────
  const cached = await storage.getByKey(key);
  if (cached) {
    console.log("[ArtistImg] cache hit:", artistName, cached.status, cached.poster_path?.slice(0, 80));
    if (cached.status === "manual" || cached.status === "matched") return cached;
    if (cached.status === "none") {
      const cutoff = staleCutoff();
      if (cached.fetched_at >= cutoff) { console.log("[ArtistImg] stale none, skipping:", artistName); return null; }
    }
  } else {
    console.log("[ArtistImg] cache miss:", artistName);
  }

  // ── 3: provider check ────────────────────────────────────────────────────────
  const provider = getArtistImageProvider();
  if (!provider) { console.log("[ArtistImg] no provider set"); return null; }

  // ── 4: fetch ─────────────────────────────────────────────────────────────────
  const now = new Date().toISOString();
  try {
    console.log("[ArtistImg] fetching:", artistName);
    const result = await provider.findArtist(artistName);
    console.log("[ArtistImg] result:", artistName, result ? `${result.provider} conf=${result.confidence} url=${result.imageUrl.slice(0, 80)}` : "null");
    if (result !== null && result.confidence >= CONFIDENCE_THRESHOLD) {
      const match: ArtworkMatch = {
        id: key,
        key,
        media_type: "artist",
        status: "matched",
        provider: result.provider,
        // Store the full image URL directly as poster_path
        poster_path: result.imageUrl,
        title_matched: result.artistName,
        confidence: result.confidence,
        fetched_at: now,
      };
      await storage.upsert(match);
      return match;
    }
    // No match — cache as "none"
    console.log("[ArtistImg] no match, caching none:", artistName);
    const none: ArtworkMatch = {
      id: key,
      key,
      media_type: "artist",
      status: "none",
      provider: "theaudiodb",
      fetched_at: now,
    };
    await storage.upsert(none);
    return null;
  } catch (e) {
    console.log("[ArtistImg] fetch error:", artistName, e);
    return null;
  }
}

// ─── enrichAll ────────────────────────────────────────────────────────────────

/**
 * Background enrichment of all unmatched Film, Episode, Book, and concert artist entries.
 *
 * Steps:
 *  1. Collect distinct film/TV artwork keys; collect unresolved Book entries.
 *  2. Skip already-resolved keys / entries.
 *  3. Resolve remaining film/TV keys and book entries with concurrency limits.
 *  4. Abort early if the optional AbortSignal fires.
 *
 * Film/TV enrichment requires getArtworkProvider(); book cover enrichment
 * requires getBookCoverProvider(). Each is skipped independently when its
 * provider is absent or its toggle is off.
 *
 * Safe to call from import completion hooks and on app start.
 * A partial run leaves already-resolved keys intact.
 */
export async function enrichAll(
  entries: Entry[],
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) return;

  let storage: ReturnType<typeof artworkStorage>;
  try { storage = artworkStorage(); } catch { return; }
  const cutoff = staleCutoff();

  // ── Film / TV enrichment ───────────────────────────────────────────────────

  if (_fetchEnabled && getArtworkProvider()) {
    // 1: collect distinct film/TV keys (eventToArtworkKey now skips books)
    const filmKeySet = new Set<string>();
    for (const entry of entries) {
      if (entry.kind === "book") continue; // books handled separately below
      const key = eventToArtworkKey(entry);
      if (key) filmKeySet.add(key);
    }

    if (filmKeySet.size && !signal?.aborted) {
      // 2: filter to unresolved
      const toResolve: string[] = [];
      for (const key of filmKeySet) {
        if (signal?.aborted) break;
        const cached = await storage.getByKey(key);
        if (!cached) toResolve.push(key);
        else if (cached.status === "none" && cached.fetched_at < cutoff) toResolve.push(key);
      }

      // 3: resolve with concurrency limit
      if (toResolve.length && !signal?.aborted) {
        let i = 0;
        async function filmWorker(): Promise<void> {
          while (i < toResolve.length) {
            if (signal?.aborted) return;
            await resolveArtwork(toResolve[i++]);
          }
        }
        const wc = Math.min(ENRICH_CONCURRENCY, toResolve.length);
        await Promise.all(Array.from({ length: wc }, filmWorker));
      }
    }
  }

  if (signal?.aborted) return;

  // ── Book cover enrichment ──────────────────────────────────────────────────

  if (_fetchBookCoversEnabled && getBookCoverProvider()) {
    // 1: collect book entries with a resolvable key
    const bookEntries: Book[] = [];
    for (const entry of entries) {
      if (entry.kind !== "book") continue;
      const key = bookToArtworkKey(entry);
      if (!key) continue;
      // 2: filter to unresolved
      if (signal?.aborted) break;
      const cached = await storage.getByKey(key);
      if (!cached || (cached.status === "none" && cached.fetched_at < cutoff)) {
        bookEntries.push(entry as Book);
      }
    }

    // 3: resolve with concurrency limit
    if (bookEntries.length && !signal?.aborted) {
      let j = 0;
      async function bookWorker(): Promise<void> {
        while (j < bookEntries.length) {
          if (signal?.aborted) return;
          await resolveBookCoverForEntry(bookEntries[j++]);
        }
      }
      const wc = Math.min(ENRICH_CONCURRENCY, bookEntries.length);
      await Promise.all(Array.from({ length: wc }, bookWorker));
    }
  }

  if (signal?.aborted) return;

  // ── Artist image enrichment ────────────────────────────────────────────────

  if (getArtistImageProvider()) {
    // 1: collect distinct concert artist names
    const artistNames = new Set<string>();
    for (const entry of entries) {
      if (entry.kind !== "event") continue;
      const ev = entry as JEvent;
      if (ev.category !== "concert") continue;
      const name = ev.artist?.trim();
      if (name) artistNames.add(name);
    }

    if (artistNames.size && !signal?.aborted) {
      // 2: filter to unresolved
      const toResolve: string[] = [];
      for (const name of artistNames) {
        if (signal?.aborted) break;
        const key = artistToArtworkKey(name);
        if (!key) continue;
        const cached = await storage.getByKey(key);
        if (!cached || (cached.status === "none" && cached.fetched_at < cutoff)) {
          toResolve.push(name);
        }
      }

      // 3: resolve with concurrency limit
      if (toResolve.length && !signal?.aborted) {
        let k = 0;
        async function artistWorker(): Promise<void> {
          while (k < toResolve.length) {
            if (signal?.aborted) return;
            await resolveArtistImage(toResolve[k++]);
          }
        }
        const wc = Math.min(ENRICH_CONCURRENCY, toResolve.length);
        await Promise.all(Array.from({ length: wc }, artistWorker));
      }
    }
  }
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

/** Decompose an artwork key back into its constituent parts. Returns null for malformed keys or book keys (books use resolveBookCoverForEntry instead). */
function parseKey(key: string): ParsedKey | null {
  const parts = key.split("|");
  if (parts.length !== 3) return null;
  const [mediaTypeRaw, normTitle, yearStr] = parts;
  // Book keys are handled by resolveBookCoverForEntry, not resolveArtwork
  if (mediaTypeRaw !== "movie" && mediaTypeRaw !== "tv") return null;
  if (!normTitle) return null;
  const year = yearStr ? parseInt(yearStr, 10) : undefined;
  return {
    mediaType: mediaTypeRaw,
    normTitle,
    year: year !== undefined && !isNaN(year) ? year : undefined,
  };
}
