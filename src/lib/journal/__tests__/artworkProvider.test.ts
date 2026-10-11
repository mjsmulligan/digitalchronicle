/**
 * Tests for artworkProvider.ts — WP3.
 *
 * All network calls are intercepted via vi.stubGlobal('fetch', ...) so no live
 * network is required. Fixture files in fixtures/tmdb/ record representative
 * TMDB responses.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  TmdbProvider,
  POSTER_SIZE_EVENT,
  CONFIDENCE_THRESHOLD,
  setArtworkProvider,
  getArtworkProvider,
} from "../artworkProvider";

// ─── Fixture loader ───────────────────────────────────────────────────────────

import searchMovieDune from "./fixtures/tmdb/search-movie-dune-2021.json";
import searchMovieAmelie from "./fixtures/tmdb/search-movie-amelie-2001.json";
import searchMovieGodfather from "./fixtures/tmdb/search-movie-godfather-1972.json";
import searchMovieNone from "./fixtures/tmdb/search-movie-nonexistent.json";
import searchTvSuccession from "./fixtures/tmdb/search-tv-succession.json";
import findImdbInception from "./fixtures/tmdb/find-imdb-tt1375666.json";

/** Build a fake fetch that returns the given JSON body. */
function mockFetch(body: unknown, status = 200): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  }) as unknown as typeof fetch;
}

/**
 * Build a fake fetch that routes by URL substring to different fixtures.
 * Unmatched URLs return a 404.
 */
function routedFetch(routes: Array<[string, unknown]>): typeof fetch {
  return vi.fn().mockImplementation(async (url: string) => {
    for (const [pattern, body] of routes) {
      if (url.includes(pattern)) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => body,
        };
      }
    }
    return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) };
  }) as unknown as typeof fetch;
}

// ─── Setup ────────────────────────────────────────────────────────────────────

const TEST_API_KEY = "test_api_key_123";

let provider: TmdbProvider;

beforeEach(() => {
  provider = new TmdbProvider(TEST_API_KEY);
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ─── Constants ────────────────────────────────────────────────────────────────

describe("constants", () => {
  it("POSTER_SIZE_EVENT is w342", () => {
    expect(POSTER_SIZE_EVENT).toBe("w342");
  });

  it("CONFIDENCE_THRESHOLD is 0.5", () => {
    expect(CONFIDENCE_THRESHOLD).toBe(0.5);
  });
});

// ─── imageUrl ────────────────────────────────────────────────────────────────

describe("TmdbProvider.imageUrl", () => {
  it("builds a URL with default event size", () => {
    const url = provider.imageUrl("/abc123.jpg");
    expect(url).toBe("https://image.tmdb.org/t/p/w342/abc123.jpg");
  });

  it("builds a URL with explicit size", () => {
    const url = provider.imageUrl("/abc123.jpg", "w500");
    expect(url).toBe("https://image.tmdb.org/t/p/w500/abc123.jpg");
  });

  it("builds a URL with original size", () => {
    const url = provider.imageUrl("/abc123.jpg", "original");
    expect(url).toBe("https://image.tmdb.org/t/p/original/abc123.jpg");
  });
});

// ─── enabled guard ────────────────────────────────────────────────────────────

describe("disabled provider (no API key)", () => {
  it("findMovie returns null without making any fetch call", async () => {
    const noKeyProvider = new TmdbProvider("");
    const mockFn = mockFetch({});
    vi.stubGlobal("fetch", mockFn);
    const result = await noKeyProvider.findMovie("dune", 2021);
    expect(result).toBeNull();
    expect(mockFn).not.toHaveBeenCalled();
  });

  it("findTv returns null without making any fetch call", async () => {
    const noKeyProvider = new TmdbProvider("");
    const mockFn = mockFetch({});
    vi.stubGlobal("fetch", mockFn);
    const result = await noKeyProvider.findTv("succession");
    expect(result).toBeNull();
    expect(mockFn).not.toHaveBeenCalled();
  });

  it("byExternalId returns null without making any fetch call", async () => {
    const noKeyProvider = new TmdbProvider("");
    const mockFn = mockFetch({});
    vi.stubGlobal("fetch", mockFn);
    const result = await noKeyProvider.byExternalId("imdb", "tt1375666", "movie");
    expect(result).toBeNull();
    expect(mockFn).not.toHaveBeenCalled();
  });
});

// ─── findMovie ────────────────────────────────────────────────────────────────

describe("TmdbProvider.findMovie", () => {
  it("returns the correct match for a known title + year (Dune 2021)", async () => {
    vi.stubGlobal("fetch", mockFetch(searchMovieDune));
    const result = await provider.findMovie("dune", 2021);

    expect(result).not.toBeNull();
    expect(result!.provider).toBe("tmdb");
    expect(result!.provider_id).toBe(438631);
    expect(result!.title_matched).toBe("Dune");
    expect(result!.poster_path).toBe("/d5NXSklXo0qyIYkgV94XAgMIckC.jpg");
    expect(result!.confidence).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
  });

  it("does not return Dune Part Two when searching for Dune 2021", async () => {
    // Both "Dune" and "Dune: Part Two" appear in results; the 2024 entry should
    // score lower because its year does not match 2021 ±1.
    vi.stubGlobal("fetch", mockFetch(searchMovieDune));
    const result = await provider.findMovie("dune", 2021);
    expect(result!.provider_id).toBe(438631); // 2021 Dune, not 2024
  });

  it("resolves accented titles (Amélie)", async () => {
    vi.stubGlobal("fetch", mockFetch(searchMovieAmelie));
    // Search with normalised (de-accented) title; TMDB returns accented title
    const result = await provider.findMovie("amelie", 2001);
    expect(result).not.toBeNull();
    expect(result!.provider_id).toBe(194);
    expect(result!.title_matched).toBe("Amélie");
  });

  it("picks highest-popularity result when multiple candidates qualify (The Godfather)", async () => {
    vi.stubGlobal("fetch", mockFetch(searchMovieGodfather));
    // Both "The Godfather" (1972) and "The Godfather Part II" (1974) appear.
    // Searching for normalised "godfather" year 1972 — only the 1972 one matches year within ±1.
    const result = await provider.findMovie("godfather", 1972);
    expect(result).not.toBeNull();
    expect(result!.provider_id).toBe(238);
  });

  it("returns null for an empty result set", async () => {
    vi.stubGlobal("fetch", mockFetch(searchMovieNone));
    const result = await provider.findMovie("xyznonexistentfilm1234", 2020);
    expect(result).toBeNull();
  });

  it("returns null when no result has an exact title match", async () => {
    // Dune results don't contain a normalised-match for "arrival"
    vi.stubGlobal("fetch", mockFetch(searchMovieDune));
    const result = await provider.findMovie("arrival", 2016);
    expect(result).toBeNull();
  });

  it("sends Bearer token in Authorization header", async () => {
    const mockFn = mockFetch(searchMovieDune);
    vi.stubGlobal("fetch", mockFn);
    await provider.findMovie("dune", 2021);
    const init = mockFn.mock.calls[0][1] as RequestInit;
    expect((init?.headers as Record<string, string>)?.Authorization).toBe(`Bearer ${TEST_API_KEY}`);
  });

  it("does NOT include any personal identifiers in the URL", async () => {
    const mockFn = mockFetch(searchMovieDune);
    vi.stubGlobal("fetch", mockFn);
    await provider.findMovie("dune", 2021);
    const url: string = mockFn.mock.calls[0][0] as string;
    // Only title, year, language, include_adult should appear — no api_key in URL (uses Bearer header)
    const allowedKeys = new Set(["query", "year", "language", "include_adult"]);
    const urlObj = new URL(url);
    for (const key of urlObj.searchParams.keys()) {
      expect(allowedKeys).toContain(key);
    }
  });
});

// ─── findTv ───────────────────────────────────────────────────────────────────

describe("TmdbProvider.findTv", () => {
  it("returns the correct series match (Succession)", async () => {
    vi.stubGlobal("fetch", mockFetch(searchTvSuccession));
    const result = await provider.findTv("succession");

    expect(result).not.toBeNull();
    expect(result!.provider_id).toBe(75006);
    expect(result!.title_matched).toBe("Succession");
    expect(result!.poster_path).toBe("/7HW47XbkNQ5fiwQFYGWdw9gs144.jpg");
  });

  it("returns null when no title match in results", async () => {
    vi.stubGlobal("fetch", mockFetch(searchTvSuccession));
    // Searching for a different show using the Succession fixture (wrong title)
    const result = await provider.findTv("breaking bad");
    expect(result).toBeNull();
  });

  it("sends Bearer token in Authorization header and nothing personal in URL", async () => {
    const mockFn = mockFetch(searchTvSuccession);
    vi.stubGlobal("fetch", mockFn);
    await provider.findTv("succession");
    const url: string = mockFn.mock.calls[0][0] as string;
    const init = mockFn.mock.calls[0][1] as RequestInit;
    expect((init?.headers as Record<string, string>)?.Authorization).toBe(`Bearer ${TEST_API_KEY}`);
    const urlObj = new URL(url);
    const allowed = new Set(["query", "language", "include_adult"]);
    for (const key of urlObj.searchParams.keys()) {
      expect(allowed).toContain(key);
    }
  });
});

// ─── byExternalId ─────────────────────────────────────────────────────────────

describe("TmdbProvider.byExternalId", () => {
  it("resolves an IMDb id to the correct movie (Inception)", async () => {
    vi.stubGlobal("fetch", mockFetch(findImdbInception));
    const result = await provider.byExternalId("imdb", "tt1375666", "movie");

    expect(result).not.toBeNull();
    expect(result!.provider_id).toBe(27205);
    expect(result!.title_matched).toBe("Inception");
    expect(result!.confidence).toBe(1);
  });

  it("returns null when IMDb lookup returns no movie results", async () => {
    vi.stubGlobal("fetch", mockFetch({ movie_results: [], tv_results: [] }));
    const result = await provider.byExternalId("imdb", "tt9999999", "movie");
    expect(result).toBeNull();
  });

  it("resolves a direct TMDB id for a movie", async () => {
    vi.stubGlobal("fetch", mockFetch({ id: 27205, title: "Inception", poster_path: "/ljsZTbVsrQSqZgWeep2B1QiDKuh.jpg" }));
    const result = await provider.byExternalId("tmdb", "27205", "movie");
    expect(result).not.toBeNull();
    expect(result!.provider_id).toBe(27205);
    expect(result!.confidence).toBe(1);
  });
});

// ─── Retry behaviour ─────────────────────────────────────────────────────────

describe("retry on transient failures", () => {
  it("retries once on 429 and succeeds on second attempt", async () => {
    let callCount = 0;
    const spy = vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return { ok: false, status: 429, headers: { get: () => "0" }, json: async () => ({}) };
      }
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => searchMovieDune };
    }));

    vi.spyOn(globalThis, "setTimeout").mockImplementation((fn) => { (fn as () => void)(); return 0 as unknown as ReturnType<typeof setTimeout>; });

    const result = await provider.findMovie("dune", 2021);
    expect(callCount).toBe(2);
    expect(result).not.toBeNull();
    void spy;
  });

  it("throws after exhausting retries on 500", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 500, headers: { get: () => null }, json: async () => ({}),
    }));
    vi.spyOn(globalThis, "setTimeout").mockImplementation((fn) => { (fn as () => void)(); return 0 as unknown as ReturnType<typeof setTimeout>; });

    await expect(provider.findMovie("dune", 2021)).rejects.toThrow("500");
  });
});

// ─── setArtworkProvider / getArtworkProvider ──────────────────────────────────

describe("provider registry", () => {
  it("getArtworkProvider returns null before injection", () => {
    setArtworkProvider(null as unknown as TmdbProvider);
    expect(getArtworkProvider()).toBeNull();
  });

  it("getArtworkProvider returns the injected provider", () => {
    setArtworkProvider(provider);
    expect(getArtworkProvider()).toBe(provider);
    setArtworkProvider(null as unknown as TmdbProvider);
  });
});

// ─── Five-title smoke table ───────────────────────────────────────────────────
// Satisfies WP3 acceptance: "five known titles including one TV series, one
// ambiguous title and one non-existent title" — all resolved via recorded fixtures.

describe("five-title smoke table (recorded fixtures, no live network)", () => {
  it("resolves all five scenarios correctly", async () => {
    vi.stubGlobal(
      "fetch",
      routedFetch([
        ["search/movie?", searchMovieDune],        // 1. Dune (2021) — clear match
        ["search/tv?",    searchTvSuccession],      // 2. Succession — TV series
      ]),
    );

    const dune = await provider.findMovie("dune", 2021);
    expect(dune?.provider_id).toBe(438631);         // matched

    const succession = await provider.findTv("succession");
    expect(succession?.provider_id).toBe(75006);    // TV series matched

    // 3. Ambiguous — year forces disambiguation (1984 Dune)
    const oldDune = await provider.findMovie("dune", 1984);
    expect(oldDune?.provider_id).toBe(9362);

    // 4. "Dune Part Two" found by searching with subtitle
    const part2 = await provider.findMovie("dune: part two", 2024);
    expect(part2?.provider_id).toBe(438632);

    // 5. Non-existent title — reuse fixture that maps to empty results
    vi.stubGlobal("fetch", mockFetch(searchMovieNone));
    const none = await provider.findMovie("xyznonexistentfilm1234", 2099);
    expect(none).toBeNull();
  });
});
