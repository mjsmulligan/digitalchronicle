/**
 * Book cover provider interface and Open Library implementation — book covers WP2.
 *
 * Kept separate from artworkProvider.ts (which is TMDB-shaped) so that neither
 * provider needs to stub the other's methods.
 *
 * Open Library (openlibrary.org) is free, requires no API key, and provides
 * deterministic cover URLs when an ISBN is known. For books without a persisted
 * isbn13 field, a title + author search is used as a fallback.
 *
 * ISBN probe:
 *   GET https://openlibrary.org/api/books?bibkeys=ISBN:{isbn13}&format=json
 *   Returns {} when the ISBN is unknown (Open Library returns a 1×1 GIF from the
 *   cover URL rather than a 404, so the JSON probe is more reliable).
 *
 * Title/author search fallback:
 *   GET https://openlibrary.org/search.json?title={t}&author={a}&fields=...&limit=5
 *   Accept only an exact normalised title match; prefer highest edition_count.
 *
 * Throttle: 200ms minimum gap between requests (~5 req/s).
 * Retry: one retry on 5xx. No retry on 404/unknown.
 */

import { normaliseTitle } from "./artwork";

// ─── Public types ─────────────────────────────────────────────────────────────

/** Result returned by the provider when a cover is found. */
export interface BookCoverResult {
  provider: "open_library";
  /**
   * Open Library integer cover id (used in /b/id/{cover_id}-L URLs).
   * 0 when the cover was found via ISBN path (no cover_id in that case).
   */
  cover_id: number;
  /**
   * Relative cover path suitable for imageUrl(). Examples:
   *   "/b/isbn/9780441013593-L"   ← ISBN path
   *   "/b/id/9255566-L"            ← search path
   */
  poster_path: string;
  /** Title string from the provider result (or the input isbn13 key for ISBN path). */
  title_matched: string;
  /** 0–1 confidence score. 1.0 for ISBN hits; 0.8 for title/author search exact match. */
  confidence: number;
}

// ─── Provider interface ───────────────────────────────────────────────────────

export interface BookCoverProvider {
  /** True when the provider can make network requests. Always true for Open Library. */
  readonly enabled: boolean;

  /**
   * Find a book cover.
   *
   * @param normTitle  Output of normaliseTitle() applied to the book title.
   * @param author     Raw author string used for search disambiguation.
   * @param isbn13     When present, tried first via the deterministic ISBN path.
   */
  findBook(
    normTitle: string,
    author: string,
    isbn13?: string,
  ): Promise<BookCoverResult | null>;

  /** Construct the full Open Library cover image URL from a poster_path. */
  imageUrl(path: string): string;
}

// ─── Open Library implementation ─────────────────────────────────────────────

const OL_BASE = "https://openlibrary.org";
const OL_COVERS_BASE = "https://covers.openlibrary.org";
const MIN_INTERVAL_MS = 200; // ~5 req/s
const RETRY_DELAY_MS = 1000;

export class OpenLibraryProvider implements BookCoverProvider {
  readonly enabled = true;

  private _queue: Promise<void> = Promise.resolve();
  private _lastRequestAt = 0;

  imageUrl(path: string): string {
    return `${OL_COVERS_BASE}${path}.jpg`;
  }

  async findBook(
    normTitle: string,
    author: string,
    isbn13?: string,
  ): Promise<BookCoverResult | null> {
    // 1. Try ISBN path first (deterministic, confidence 1.0)
    if (isbn13) {
      const isbnResult = await this._findByIsbn(isbn13);
      if (isbnResult) return isbnResult;
    }

    // 2. Fall back to title/author search (confidence 0.8)
    return this._findBySearch(normTitle, author);
  }

  // ── ISBN probe ───────────────────────────────────────────────────────────────

  private async _findByIsbn(isbn13: string): Promise<BookCoverResult | null> {
    const url = `${OL_BASE}/api/books?bibkeys=ISBN:${isbn13}&format=json`;
    let data: Record<string, unknown>;
    try {
      data = await this._fetchJson<Record<string, unknown>>(url);
    } catch {
      return null;
    }
    // Empty object means unknown ISBN
    if (!data || Object.keys(data).length === 0) return null;

    return {
      provider: "open_library",
      cover_id: 0, // not available from this endpoint; use ISBN cover URL
      poster_path: `/b/isbn/${isbn13}-L`,
      title_matched: isbn13,
      confidence: 1.0,
    };
  }

  // ── Title/author search ──────────────────────────────────────────────────────

  private async _findBySearch(normTitle: string, author: string): Promise<BookCoverResult | null> {
    const params = new URLSearchParams({
      title: normTitle,
      author: author,
      fields: "key,cover_i,title,edition_count",
      limit: "5",
    });
    const url = `${OL_BASE}/search.json?${params}`;
    let data: OLSearchResponse;
    try {
      data = await this._fetchJson<OLSearchResponse>(url);
    } catch {
      return null;
    }

    const docs = data.docs ?? [];
    if (!docs.length) return null;

    // Accept only exact normalised title matches, pick highest edition_count
    const candidates = docs
      .filter((d) => d.title !== undefined && normaliseTitle(d.title) === normTitle)
      .filter((d) => typeof d.cover_i === "number")
      .sort((a, b) => (b.edition_count ?? 0) - (a.edition_count ?? 0));

    if (!candidates.length) return null;

    const best = candidates[0];
    return {
      provider: "open_library",
      cover_id: best.cover_i!,
      poster_path: `/b/id/${best.cover_i}-L`,
      title_matched: best.title!,
      confidence: 0.8,
    };
  }

  // ── Throttled fetch with retry ───────────────────────────────────────────────

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const result = this._queue.then(async () => {
      const now = Date.now();
      const wait = MIN_INTERVAL_MS - (now - this._lastRequestAt);
      if (wait > 0) await delay(wait);
      this._lastRequestAt = Date.now();
      return fn();
    });
    this._queue = result.then(() => undefined, () => undefined);
    return result;
  }

  private _fetchJson<T>(url: string): Promise<T> {
    return this.enqueue(() => this._fetchWithRetry<T>(url));
  }

  private async _fetchWithRetry<T>(url: string, attempt = 0): Promise<T> {
    const res = await fetch(url);

    if (res.status >= 500 && res.status < 600) {
      if (attempt === 0) {
        await delay(RETRY_DELAY_MS);
        return this._fetchWithRetry<T>(url, attempt + 1);
      }
      throw new Error(`Open Library request failed with status ${res.status} after retry`);
    }

    if (!res.ok) {
      throw new Error(`Open Library request failed with status ${res.status}`);
    }

    return res.json() as Promise<T>;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Open Library response shapes (minimal) ──────────────────────────────────

interface OLSearchDoc {
  key?: string;
  title?: string;
  cover_i?: number;
  edition_count?: number;
}

interface OLSearchResponse {
  numFound?: number;
  docs?: OLSearchDoc[];
}

// ─── Active provider instance ─────────────────────────────────────────────────

let _bookCoverProvider: BookCoverProvider | null = null;

/**
 * Inject the active book cover provider.
 * Call at app startup (or in tests with a mock).
 *
 *   setBookCoverProvider(new OpenLibraryProvider());
 */
export function setBookCoverProvider(p: BookCoverProvider): void {
  _bookCoverProvider = p;
}

/**
 * Returns the active book cover provider, or null when none has been set.
 * Callers should treat null as "feature disabled".
 */
export function getBookCoverProvider(): BookCoverProvider | null {
  return _bookCoverProvider;
}
