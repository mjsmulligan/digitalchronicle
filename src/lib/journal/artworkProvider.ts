/**
 * Artwork provider interface and TMDB implementation — event posters WP3.
 *
 * The provider sits behind the ArtworkProvider interface so it can be swapped
 * without touching the enrichment service (WP4) or UI layers (WP6, WP7).
 *
 * API key: read from VITE_TMDB_API_KEY (web) or EXPO_PUBLIC_TMDB_API_KEY (mobile).
 * If missing the provider is disabled and every lookup returns null quietly.
 *
 * Throttling: requests are serialised through a promise chain so that at most
 * one is in flight per instance, with a MIN_INTERVAL_MS gap between them.
 * This keeps the app well inside TMDB's 50 req/s limit regardless of how many
 * titles are enriched concurrently.
 *
 * Retry: one retry with exponential backoff on HTTP 429 and 5xx responses.
 */

import { normaliseTitle, type ArtworkMediaType } from "./artwork";

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * TMDB poster size token. w342 is the recommended size for the entry screen;
 * larger sizes (w500, w780) are available for retina displays if needed later.
 */
export type PosterSize = "w92" | "w154" | "w185" | "w342" | "w500" | "w780" | "original";

/** The event-screen poster size. Import this constant rather than hard-coding. */
export const POSTER_SIZE_EVENT: PosterSize = "w342";

/** Result returned by the provider when a match is found. */
export interface ArtworkProviderResult {
  provider: "tmdb";
  provider_id: number;
  /** TMDB relative path, e.g. "/abc123.jpg". Null when TMDB has no image. */
  poster_path: string | null;
  /** Title string as returned by the provider — used in the correction picker (WP8). */
  title_matched: string;
  /** 0–1 confidence score. Values below CONFIDENCE_THRESHOLD are not stored as matches. */
  confidence: number;
}

// ─── Provider interface ───────────────────────────────────────────────────────

/**
 * Platform-agnostic artwork provider contract.
 *
 * All title arguments should already be normalised (via normaliseTitle()) so
 * that matching is consistent between callers. The provider does its own
 * normalisation on result titles before comparing.
 */
export interface ArtworkProvider {
  /**
   * Search for a movie by normalised title and optional release year.
   * Returns the best match (highest confidence) or null.
   */
  findMovie(normTitle: string, year?: number): Promise<ArtworkProviderResult | null>;

  /**
   * Search for a TV series by normalised series title.
   * Returns the series-level poster (not a season or episode poster).
   */
  findTv(normSeriesTitle: string): Promise<ArtworkProviderResult | null>;

  /**
   * Direct lookup by external id (IMDb or TMDB).
   * Bypasses the search + ranking logic. Returns null if the id is not found.
   * Note: no current connectors supply IMDb/TMDB ids — kept for future use.
   */
  byExternalId(
    source: "imdb" | "tmdb",
    id: string,
    mediaType: ArtworkMediaType,
  ): Promise<ArtworkProviderResult | null>;

  /**
   * Construct the full image URL for a TMDB poster path.
   *
   * @param path  TMDB relative path, e.g. "/abc123.jpg"
   * @param size  Defaults to POSTER_SIZE_EVENT ("w342")
   */
  imageUrl(path: string, size?: PosterSize): string;
}

// ─── Confidence threshold ─────────────────────────────────────────────────────

/**
 * Minimum confidence to store a match.
 * Below this threshold the result is treated as "no match" (status: "none").
 * Spec: "wrong poster is worse than no poster".
 */
export const CONFIDENCE_THRESHOLD = 0.5;

// ─── TMDB implementation ──────────────────────────────────────────────────────

const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";
const MIN_INTERVAL_MS = 50; // 20 req/s — well within TMDB's 50 req/s limit
const RETRY_DELAY_MS = 1000; // initial backoff on 429 / 5xx

/** Resolve the TMDB API key from the build environment. Returns undefined if absent. */
function resolveApiKey(): string | undefined {
  // Vite web: import.meta.env.VITE_TMDB_API_KEY
  // Expo mobile: process.env.EXPO_PUBLIC_TMDB_API_KEY
  // Both are inlined at build time; the fallback keeps tests working with a mock.
  try {
    // @ts-expect-error — import.meta.env is only available in Vite bundles
    const vite = import.meta?.env?.VITE_TMDB_API_KEY as string | undefined;
    if (vite) return vite;
  } catch {
    // not in Vite context (e.g. Vitest with jsdom)
  }
  try {
    const expo = (typeof process !== "undefined" && process.env?.EXPO_PUBLIC_TMDB_API_KEY) as
      | string
      | undefined;
    if (expo) return expo;
  } catch {
    // not available
  }
  return undefined;
}

/** Score how closely a candidate title matches the search title (0–1). */
function titleScore(searchNorm: string, candidateRaw: string): number {
  const candidateNorm = normaliseTitle(candidateRaw);
  return candidateNorm === searchNorm ? 1 : 0;
}

/** Score how closely a candidate year matches the expected year (0–1). */
function yearScore(searchYear: number | undefined, candidateYear: number | undefined): number {
  if (searchYear === undefined) return 1; // no expectation → neutral
  if (candidateYear === undefined) return 0.5; // unknown → give partial benefit of the doubt
  return Math.abs(searchYear - candidateYear) <= 1 ? 1 : 0;
}

/** Extract a 4-digit year from a TMDB date string like "2021-09-10". */
function extractYear(dateStr: string | undefined): number | undefined {
  if (!dateStr) return undefined;
  const y = parseInt(dateStr.slice(0, 4), 10);
  return isNaN(y) ? undefined : y;
}

export class TmdbProvider implements ArtworkProvider {
  private readonly apiKey: string | undefined;
  /** Promise chain used to serialise requests (throttle). */
  private _queue: Promise<void> = Promise.resolve();
  private _lastRequestAt = 0;

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? resolveApiKey();
    if (!this.apiKey) {
      console.warn(
        "[TmdbProvider] VITE_TMDB_API_KEY / EXPO_PUBLIC_TMDB_API_KEY is not set — poster lookups are disabled",
      );
    }
  }

  /** True when the provider is operational. */
  get enabled(): boolean {
    return !!this.apiKey;
  }

  imageUrl(path: string, size: PosterSize = POSTER_SIZE_EVENT): string {
    return `${TMDB_IMAGE_BASE}/${size}${path}`;
  }

  // ── Throttled fetch ──────────────────────────────────────────────────────────

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const result = this._queue.then(async () => {
      const now = Date.now();
      const wait = MIN_INTERVAL_MS - (now - this._lastRequestAt);
      if (wait > 0) await delay(wait);
      this._lastRequestAt = Date.now();
      return fn();
    });
    // Keep the chain alive; swallow errors so a failed call doesn't stall later ones
    this._queue = result.then(() => undefined, () => undefined);
    return result;
  }

  /** Fetch with one retry on 429 or 5xx. */
  private async fetchJson<T>(url: string): Promise<T> {
    return this.enqueue(() => this._fetchWithRetry<T>(url));
  }

  private async _fetchWithRetry<T>(url: string, attempt = 0): Promise<T> {
    const res = await fetch(url);

    if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
      if (attempt === 0) {
        const retryAfter = parseInt(res.headers.get("Retry-After") ?? "0", 10);
        await delay(retryAfter > 0 ? retryAfter * 1000 : RETRY_DELAY_MS * 2 ** attempt);
        return this._fetchWithRetry<T>(url, attempt + 1);
      }
      throw new Error(`TMDB request failed with status ${res.status} after retry`);
    }

    if (!res.ok) {
      throw new Error(`TMDB request failed with status ${res.status}`);
    }

    return res.json() as Promise<T>;
  }

  // ── ArtworkProvider interface ───────────────────────────────────────────────

  async findMovie(normTitle: string, year?: number): Promise<ArtworkProviderResult | null> {
    if (!this.apiKey) return null;

    const params = new URLSearchParams({
      api_key: this.apiKey,
      query: normTitle,
      include_adult: "false",
      language: "en-US",
    });
    if (year !== undefined) params.set("year", String(year));

    const data = await this.fetchJson<TmdbSearchMovieResponse>(
      `${TMDB_BASE}/search/movie?${params}`,
    );

    return this._rankMovieResults(data.results ?? [], normTitle, year);
  }

  async findTv(normSeriesTitle: string): Promise<ArtworkProviderResult | null> {
    if (!this.apiKey) return null;

    const params = new URLSearchParams({
      api_key: this.apiKey,
      query: normSeriesTitle,
      include_adult: "false",
      language: "en-US",
    });

    const data = await this.fetchJson<TmdbSearchTvResponse>(
      `${TMDB_BASE}/search/tv?${params}`,
    );

    return this._rankTvResults(data.results ?? [], normSeriesTitle);
  }

  async byExternalId(
    source: "imdb" | "tmdb",
    id: string,
    mediaType: ArtworkMediaType,
  ): Promise<ArtworkProviderResult | null> {
    if (!this.apiKey) return null;

    if (source === "tmdb") {
      // Direct TMDB id — use the movie/tv details endpoint
      const endpoint = mediaType === "movie" ? "movie" : "tv";
      const params = new URLSearchParams({ api_key: this.apiKey, language: "en-US" });
      try {
        const data = await this.fetchJson<TmdbMovieDetail | TmdbTvDetail>(
          `${TMDB_BASE}/${endpoint}/${id}?${params}`,
        );
        const title = "title" in data ? data.title : data.name;
        return {
          provider: "tmdb",
          provider_id: data.id,
          poster_path: data.poster_path ?? null,
          title_matched: title,
          confidence: 1,
        };
      } catch {
        return null;
      }
    }

    // IMDb id — use the /find endpoint
    const params = new URLSearchParams({
      api_key: this.apiKey,
      external_source: "imdb_id",
      language: "en-US",
    });
    try {
      const data = await this.fetchJson<TmdbFindResponse>(
        `${TMDB_BASE}/find/${id}?${params}`,
      );
      const results =
        mediaType === "movie"
          ? (data.movie_results ?? [])
          : (data.tv_results ?? []);
      if (!results.length) return null;
      const r = results[0];
      const title = "title" in r ? r.title : r.name;
      return {
        provider: "tmdb",
        provider_id: r.id,
        poster_path: r.poster_path ?? null,
        title_matched: title,
        confidence: 1,
      };
    } catch {
      return null;
    }
  }

  // ── Private ranking helpers ───────────────────────────────────────────────

  private _rankMovieResults(
    results: TmdbMovieResult[],
    normTitle: string,
    year: number | undefined,
  ): ArtworkProviderResult | null {
    if (!results.length) return null;

    // Score each result and keep only those with an exact title match
    const scored = results
      .map((r) => {
        const ts = titleScore(normTitle, r.title);
        const ys = yearScore(year, extractYear(r.release_date));
        const confidence = ts * ys;
        return { r, confidence };
      })
      .filter(({ confidence }) => confidence >= CONFIDENCE_THRESHOLD)
      .sort((a, b) => {
        // Primary: confidence descending; secondary: popularity descending
        if (b.confidence !== a.confidence) return b.confidence - a.confidence;
        return (b.r.popularity ?? 0) - (a.r.popularity ?? 0);
      });

    if (!scored.length) return null;

    const { r, confidence } = scored[0];
    return {
      provider: "tmdb",
      provider_id: r.id,
      poster_path: r.poster_path ?? null,
      title_matched: r.title,
      confidence,
    };
  }

  private _rankTvResults(
    results: TmdbTvResult[],
    normTitle: string,
  ): ArtworkProviderResult | null {
    if (!results.length) return null;

    const scored = results
      .map((r) => {
        const ts = titleScore(normTitle, r.name);
        // No year filter for TV — use exact title match alone
        return { r, confidence: ts };
      })
      .filter(({ confidence }) => confidence >= CONFIDENCE_THRESHOLD)
      .sort((a, b) => {
        if (b.confidence !== a.confidence) return b.confidence - a.confidence;
        return (b.r.popularity ?? 0) - (a.r.popularity ?? 0);
      });

    if (!scored.length) return null;

    const { r, confidence } = scored[0];
    return {
      provider: "tmdb",
      provider_id: r.id,
      poster_path: r.poster_path ?? null,
      title_matched: r.name,
      confidence,
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── TMDB response shapes (minimal — only fields we use) ─────────────────────

interface TmdbMovieResult {
  id: number;
  title: string;
  release_date?: string;
  poster_path?: string | null;
  popularity?: number;
}

interface TmdbTvResult {
  id: number;
  name: string;
  first_air_date?: string;
  poster_path?: string | null;
  popularity?: number;
}

interface TmdbSearchMovieResponse {
  results?: TmdbMovieResult[];
}

interface TmdbSearchTvResponse {
  results?: TmdbTvResult[];
}

interface TmdbMovieDetail {
  id: number;
  title: string;
  poster_path?: string | null;
}

interface TmdbTvDetail {
  id: number;
  name: string;
  poster_path?: string | null;
}

interface TmdbFindResponse {
  movie_results?: (TmdbMovieResult & { title: string })[];
  tv_results?: (TmdbTvResult & { name: string })[];
}

// ─── Active provider instance ─────────────────────────────────────────────────

let _provider: ArtworkProvider | null = null;

/**
 * Inject the active artwork provider.
 * Call at app startup (or in tests with a mock).
 *
 *   setArtworkProvider(new TmdbProvider());
 */
export function setArtworkProvider(p: ArtworkProvider): void {
  _provider = p;
}

/**
 * Returns the active provider, or null when none has been set or the
 * API key is absent. Callers should treat null as "feature disabled".
 */
export function getArtworkProvider(): ArtworkProvider | null {
  return _provider;
}
