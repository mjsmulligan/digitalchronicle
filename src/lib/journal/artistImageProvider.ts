/**
 * Artist image provider — TheAudioDB + Deezer implementations.
 *
 * TheAudioDB (theaudiodb.com):
 *   Free-tier key "123" — searches by name, returns full image URLs.
 *   Coverage is inconsistent: mainstream artists sometimes have no image
 *   fields populated on the free tier even when the artist record exists.
 *
 * Deezer (api.deezer.com):
 *   No API key required. Excellent coverage for mainstream artists.
 *   Returns square artist photos (picture_xl) for almost all known acts.
 *   Placeholder images (no real photo) have an empty hash segment in the
 *   CDN URL and are filtered out.
 *
 * Use CompositeArtistImageProvider([tadb, deezer]) to try both in order.
 * All providers store full URLs directly as poster_path.
 */

import { normaliseTitle } from "./artwork";

// ── Public types ──────────────────────────────────────────────────────────────

export interface ArtistImageResult {
  provider: "theaudiodb" | "deezer";
  /**
   * Full image URL (strArtistThumb from TheAudioDB, picture_xl from Deezer).
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

    // Try every image field in preference order, skipping any URL that contains
    // a literal space. TADB has corrupted CDN entries where the filename has a
    // space (e.g. "ysytsw1498815 745.jpg") — even %20-encoded these are 404s.
    // Returning null lets the CompositeArtistImageProvider fall through to Deezer.
    const candidates = [
      best.strArtistThumb,
      best.strArtistWideThumb,
      best.strArtistFanart,
      best.strArtistFanart2,
      best.strArtistFanart3,
      best.strArtistFanart4,
      best.strArtistBanner,
      best.strArtistClearart,
      best.strArtistLogo,
    ];
    const rawUrl = candidates.find((u) => u && !u.includes(" ")) ?? null;
    if (!rawUrl) return null;
    const imageUrl = sanitizeUrl(rawUrl);

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

/**
 * TADB sometimes returns image URLs with literal spaces in the filename,
 * e.g. "…/thumb/ysytsw1498815 745.jpg". React Native's Image rejects
 * these silently. Replace unencoded spaces so the URL is valid.
 */
function sanitizeUrl(url: string): string {
  return url.replace(/ /g, "%20");
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

// ── Deezer response shapes ────────────────────────────────────────────────────

interface DeezerArtist {
  id: number;
  name: string;
  picture_small?: string;
  picture_medium?: string;
  picture_big?: string;
  picture_xl?: string;
}

interface DeezerSearchResponse {
  data?: DeezerArtist[];
  total?: number;
}

// ── DeezerArtistProvider ──────────────────────────────────────────────────────

/**
 * Artist image provider backed by the Deezer search API.
 *
 * No API key required. Returns square artist photos from Deezer's CDN.
 * Placeholder images (no real photo) have an empty hash segment in the CDN
 * URL ("/images/artist//") and are filtered out.
 *
 * API: GET https://api.deezer.com/search/artist?q={name}&limit=5
 */
export class DeezerArtistProvider implements ArtistImageProvider {
  readonly enabled = true;

  /** poster_path is already a full URL — identity function. */
  imageUrl(path: string): string {
    return path;
  }

  async findArtist(artistName: string): Promise<ArtistImageResult | null> {
    const url = `https://api.deezer.com/search/artist?q=${encodeURIComponent(artistName)}&limit=5`;
    let data: DeezerSearchResponse;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      data = await res.json() as DeezerSearchResponse;
    } catch {
      return null;
    }

    if (!data.data?.length) return null;

    const normQuery = normaliseTitle(artistName);

    // Prefer an exact normalised name match; fall back to first result
    const exact = data.data.find(
      (a) => normaliseTitle(a.name) === normQuery,
    );
    const best = exact ?? data.data[0];

    // Deezer placeholder images have an empty hash: "/images/artist//"
    // Filter these out — they're a generic icon, not an artist photo
    const imageUrl = best.picture_xl ?? best.picture_big ?? best.picture_medium ?? null;
    if (!imageUrl || imageUrl.includes("/images/artist//")) return null;

    return {
      provider: "deezer",
      imageUrl,
      artistName: best.name,
      confidence: exact ? 1.0 : 0.8,
    };
  }
}

// ── CompositeArtistImageProvider ──────────────────────────────────────────────

/**
 * Tries each provider in order and returns the first non-null result.
 * Use this to chain TADB → Deezer so mainstream artists get coverage even
 * when the TADB free tier returns no image data.
 */
export class CompositeArtistImageProvider implements ArtistImageProvider {
  constructor(private readonly providers: ArtistImageProvider[]) {}

  get enabled(): boolean {
    return this.providers.some((p) => p.enabled);
  }

  /** All providers return full URLs — identity function. */
  imageUrl(path: string): string {
    return path;
  }

  async findArtist(artistName: string): Promise<ArtistImageResult | null> {
    for (const p of this.providers) {
      if (!p.enabled) continue;
      try {
        const result = await p.findArtist(artistName);
        if (result) return result;
      } catch {
        // provider threw — try next
      }
    }
    return null;
  }
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
