/**
 * Tests for bookCoverProvider.ts — book covers WP2.
 *
 * All network calls are intercepted via vi.stubGlobal('fetch', ...) so no live
 * network is required. Fixture files in fixtures/open-library/ record representative
 * Open Library responses.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  OpenLibraryProvider,
  setBookCoverProvider,
  getBookCoverProvider,
} from "../bookCoverProvider";

// ─── Fixture loader ───────────────────────────────────────────────────────────

import apiBookIsbnHit from "./fixtures/open-library/api-books-isbn-hit.json";
import apiBookIsbnMiss from "./fixtures/open-library/api-books-isbn-miss.json";
import searchExactMatch from "./fixtures/open-library/search-exact-match.json";
import searchNoMatch from "./fixtures/open-library/search-no-match.json";

// ─── Mock helpers ─────────────────────────────────────────────────────────────

function mockFetch(body: unknown, status = 200): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as typeof fetch;
}

/**
 * Route fetch calls by URL substring — maps each pattern to a fixture body.
 * Unmatched URLs return 404.
 */
function routedFetch(routes: Array<[string, unknown]>): typeof fetch {
  return vi.fn().mockImplementation(async (url: string) => {
    for (const [pattern, body] of routes) {
      if (url.includes(pattern)) {
        return { ok: true, status: 200, json: async () => body };
      }
    }
    return { ok: false, status: 404, json: async () => ({}) };
  }) as unknown as typeof fetch;
}

// ─── Setup ────────────────────────────────────────────────────────────────────

let provider: OpenLibraryProvider;

beforeEach(() => {
  provider = new OpenLibraryProvider();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  setBookCoverProvider(null as unknown as OpenLibraryProvider);
});

// ─── imageUrl ────────────────────────────────────────────────────────────────

describe("OpenLibraryProvider.imageUrl", () => {
  it("builds a cover URL for an ISBN path", () => {
    expect(provider.imageUrl("/b/isbn/9780441013593-L")).toBe(
      "https://covers.openlibrary.org/b/isbn/9780441013593-L.jpg",
    );
  });

  it("builds a cover URL for a cover_id path", () => {
    expect(provider.imageUrl("/b/id/9255566-L")).toBe(
      "https://covers.openlibrary.org/b/id/9255566-L.jpg",
    );
  });
});

// ─── enabled ─────────────────────────────────────────────────────────────────

describe("OpenLibraryProvider.enabled", () => {
  it("is always true (no API key required)", () => {
    expect(provider.enabled).toBe(true);
  });
});

// ─── ISBN path — hit ─────────────────────────────────────────────────────────

describe("findBook — ISBN hit", () => {
  it("returns confidence 1.0 with ISBN poster_path when the ISBN is known", async () => {
    vi.stubGlobal("fetch", mockFetch(apiBookIsbnHit));
    const result = await provider.findBook("dune", "Frank Herbert", "9780441013593");

    expect(result).not.toBeNull();
    expect(result!.provider).toBe("open_library");
    expect(result!.confidence).toBe(1.0);
    expect(result!.poster_path).toBe("/b/isbn/9780441013593-L");
    expect(result!.title_matched).toBe("9780441013593");
  });

  it("calls only the api/books endpoint (no search call) on ISBN hit", async () => {
    const mockFn = mockFetch(apiBookIsbnHit);
    vi.stubGlobal("fetch", mockFn);
    await provider.findBook("dune", "Frank Herbert", "9780441013593");

    expect(mockFn).toHaveBeenCalledOnce();
    const url: string = mockFn.mock.calls[0][0] as string;
    expect(url).toContain("api/books");
    expect(url).toContain("ISBN:9780441013593");
  });

  it("URL contains only ISBN — no title, author, or personal data", async () => {
    const mockFn = mockFetch(apiBookIsbnHit);
    vi.stubGlobal("fetch", mockFn);
    await provider.findBook("dune", "Frank Herbert", "9780441013593");

    const url = new URL(mockFn.mock.calls[0][0] as string);
    // Only bibkeys and format params
    const allowed = new Set(["bibkeys", "format"]);
    for (const key of url.searchParams.keys()) {
      expect(allowed).toContain(key);
    }
  });
});

// ─── ISBN path — miss, fallthrough to search ─────────────────────────────────

describe("findBook — ISBN miss, search hit", () => {
  it("falls through to search when ISBN is not in Open Library", async () => {
    vi.stubGlobal(
      "fetch",
      routedFetch([
        ["api/books", apiBookIsbnMiss],
        ["search.json", searchExactMatch],
      ]),
    );

    const result = await provider.findBook("dune", "Frank Herbert", "0000000000000");

    expect(result).not.toBeNull();
    expect(result!.confidence).toBe(0.8);
    expect(result!.cover_id).toBe(9255566);
    expect(result!.poster_path).toBe("/b/id/9255566-L");
    expect(result!.title_matched).toBe("Dune");
  });

  it("makes exactly two fetch calls (isbn probe + search) on miss+hit", async () => {
    const mockFn = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("api/books")) return { ok: true, status: 200, json: async () => apiBookIsbnMiss };
      return { ok: true, status: 200, json: async () => searchExactMatch };
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", mockFn);

    await provider.findBook("dune", "Frank Herbert", "0000000000000");
    expect(mockFn).toHaveBeenCalledTimes(2);
  });
});

// ─── Search path ─────────────────────────────────────────────────────────────

describe("findBook — search (no isbn13)", () => {
  it("returns confidence 0.8 with cover_id path on exact title match", async () => {
    vi.stubGlobal("fetch", mockFetch(searchExactMatch));
    const result = await provider.findBook("dune", "Frank Herbert");

    expect(result).not.toBeNull();
    expect(result!.confidence).toBe(0.8);
    expect(result!.cover_id).toBe(9255566); // higher edition_count wins
    expect(result!.poster_path).toBe("/b/id/9255566-L");
  });

  it("picks the result with the highest edition_count on multiple exact matches", async () => {
    vi.stubGlobal("fetch", mockFetch(searchExactMatch));
    const result = await provider.findBook("dune", "Frank Herbert");
    // searchExactMatch has two "Dune" docs: edition_count 100 and 40
    expect(result!.cover_id).toBe(9255566); // edition_count 100
  });

  it("returns null when no result has an exact normalised title match", async () => {
    vi.stubGlobal("fetch", mockFetch(searchNoMatch));
    const result = await provider.findBook("dune", "Frank Herbert");
    expect(result).toBeNull();
  });

  it("search URL contains only title and author — no ISBN or personal data", async () => {
    const mockFn = mockFetch(searchExactMatch);
    vi.stubGlobal("fetch", mockFn);
    await provider.findBook("dune", "Frank Herbert");

    const url = new URL(mockFn.mock.calls[0][0] as string);
    const allowed = new Set(["title", "author", "fields", "limit"]);
    for (const key of url.searchParams.keys()) {
      expect(allowed).toContain(key);
    }
  });
});

// ─── Network error handling ───────────────────────────────────────────────────

describe("findBook — network errors", () => {
  it("returns null when ISBN probe throws a network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network offline")));
    const result = await provider.findBook("dune", "Frank Herbert", "9780441013593");
    expect(result).toBeNull();
  });

  it("retries once on 500 then returns null (does not crash enrichment pipeline)", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
      calls++;
      return { ok: false, status: 500, json: async () => ({}) };
    }));
    vi.spyOn(globalThis, "setTimeout").mockImplementation((fn) => {
      (fn as () => void)();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });

    const result = await provider.findBook("dune", "Frank Herbert");
    expect(result).toBeNull();
    expect(calls).toBe(2); // original + 1 retry
  });
});

// ─── Registry ────────────────────────────────────────────────────────────────

describe("setBookCoverProvider / getBookCoverProvider", () => {
  it("getBookCoverProvider returns null before injection", () => {
    expect(getBookCoverProvider()).toBeNull();
  });

  it("getBookCoverProvider returns the injected provider", () => {
    setBookCoverProvider(provider);
    expect(getBookCoverProvider()).toBe(provider);
  });
});
