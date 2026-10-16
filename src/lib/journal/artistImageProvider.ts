/**
 * Artist image provider — TheAudioDB implementation.
 *
 * TheAudioDB (theaudiodb.com) provides free artist images via a simple
 * name-search API. The free-tier key is "123" (public, no registration needed).
 *
 * API shape:
 *   GET https://www.theaudiodb.com/api/v1/json/{key}/search.php?s={artist}
 *   Returns { artists: ArtistResult[] | null }
 *   (null — not [] — when no match is found)
 *
 * Image fields returned (all full URLs, not relative paths):
 *   strArtistThumb  — square-ish artist photo; best fit for the poster grid
 *   strArtistFanart — wide promotional photo
 *   strArtistBanner — very wide banner
 *   strArtistLogo   — logo/wordmark
 *
 * We store the full URL directly as poster_path (no imageUrl() translation
 * needed, unlike TMDB which uses relative paths).
 *
 * Throttle: 200ms minimum between requests (be a good citizen on the free tier).
 * Retry: one retry on 5xx.
 * Matching: accept the first result whose normalised name matches exactly;
 *   fall back to accepting the first result regardless (artist names often have
 *   minor punctuation differences between data sources).
 */

import { normaliseTitle } from "./artwork";

// ── Public types ──────────────────────────────────────────────────────────────

export interface ArtistImageResult {
  provider: "theaudiodb";
  /**
   * Full image URL from TheAudioDB (strArtistThumb).
   * Stored directly as poster_path in ArtworkMatch — no imageUrl() needed.
   */
  imageUrl: string;
  /** Artist name as returned by the API. */
  artistName: string;
  /** 1.0 for exact normalised name match; 0.8 for first-result fallback. */
  confidence: number;
}

// ── Provider interface ────────────────────────────────────────────────────────

export interface ArtistImageProvider {
  readonly enabled: boolean;

  /**
   * Find an artist image.
   * @param artistName  Raw artist name from the journal entry.
   */
  findArtist(artistName: string): Promise<ArtistImageResult | null>;

  /**
   * For ArtworkMatch compatibility: poster_path for artists is already a full
   * URL, so this is an identity function.
   */
  imageUrl(path: string): string;
}

// ── TheAudioDB implementation ─────────────────────────────────────────────────

const TADB_BASE = "https://www.theaudiodb.com/api/v1/json";
const MIN_INTERVAL_MS = 200;
const RETRY_DELAY_MS  = 1000;

export class TheAudioDbProvider implements ArtistImageProvider {
  readonly enabled = true;
  private readonly _apiKey: string;
  private _queue: Promise<void> = Promise.resolve();
  private _lastRequestAt = 0;

  constructor(apiKey = "123") {
    this._apiKey = apiKey;
  }

  /** poster_path is a full URL for TheAudioDB — return as-is. */
  imageUrl(path: string): string {
    return path;
  }

  async findArtist(artistName: string): Promise<ArtistImageResult | null> {
    const url = `${TADB_BASE}/${this._apiKey}/search.php?s=${encodeURIComponent(artistName)}`;
    let data: TADBSearchResponse;
    try {
      data = await this._fetchJson<TADBSearchResponse>(url);
    } catch {
      return null;
    }

    // TheAudioDB returns null (not []) when no results found
    if (!data.artists?.length) return null;

    const normQuery = normaliseTitle(artistName);

    // Prefer an exact normalised name match
    const exact = data.artists.find(
      (a) => normaliseTitle(a.strArtist ?? "") === normQuery,
    );
    const best = exact ?? data.artists[0];

    // Try every image field in preference order — free tier may have some null
    const imageUrl =
      best.strArtistThumb ??
      best.strArtistWideThumb ??
      best.strArtistFanart ??
      best.strArtistFanart2 ??
      best.strArtistFanart3 ??
      best.strArtistFanart4 ??
      best.strArtistBanner ??
      best.strArtistClearart ??
      best.strArtistLogo ??
      null;
    if (!imageUrl) return null;

    return {
      provider: "theaudiodb",
      imageUrl,
      artistName: best.strArtist ?? artistName,
      confidence: exact ? 1.0 : 0.8,
    };
  }

  // ── Throttled fetch with retry ─────────────────────────────────────────────

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const result = this._queue.then(async () => {
      const wait = MIN_INTERVAL_MS - (Date.now() - this._lastRequestAt);
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
    if (res.status >= 500 && attempt === 0) {
      await delay(RETRY_DELAY_MS);
      return this._fetchWithRetry<T>(url, 1);
    }
    if (!res.ok) throw new Error(`TheAudioDB request failed: ${res.status}`);
    return res.json() as Promise<T>;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── TheAudioDB response shapes (minimal) ──────────────────────────────────────

interface TADBArtist {
  strArtist?: string;
  strArtistThumb?: string;
  strArtistWideThumb?: string;
  strArtistFanart?: string;
  strArtistFanart2?: string;
  strArtistFanart3?: string;
  strArtistFanart4?: string;
  strArtistBanner?: string;
  strArtistClearart?: string;
  strArtistLogo?: string;
  strMusicBrainzID?: string;
}

interface TADBSearchResponse {
  artists?: TADBArtist[] | null;
}

// ── Active provider singleton ─────────────────────────────────────────────────

let _artistImageProvider: ArtistImageProvider | null = null;

/**
 * Inject the active artist image provider.
 * Call at app startup before any image resolution.
 *
 *   setArtistImageProvider(new TheAudioDbProvider("123"));
 */
export function setArtistImageProvider(p: ArtistImageProvider): void {
  _artistImageProvider = p;
}

/**
 * Returns the active artist image provider, or null when none has been set.
 */
export function getArtistImageProvider(): ArtistImageProvider | null {
  return _artistImageProvider;
}
