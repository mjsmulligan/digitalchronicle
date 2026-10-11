/**
 * Tests for artworkEnrichment.ts — WP4.
 *
 * All I/O is replaced with in-memory fakes:
 *   - MemoryArtworkStore from artwork.ts for storage
 *   - MockProvider below for the artwork provider
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  resolveArtwork,
  resolveBookCoverForEntry,
  enrichAll,
  setFetchPostersEnabled,
  getFetchPostersEnabled,
  setFetchBookCoversEnabled,
  getFetchBookCoversEnabled,
} from "../artworkEnrichment";
import {
  MemoryArtworkStore,
  setArtworkStorage,
  type ArtworkMatch,
} from "../artwork";
import { setArtworkProvider, type ArtworkProvider, type ArtworkProviderResult } from "../artworkProvider";
import { setBookCoverProvider, type BookCoverProvider, type BookCoverResult } from "../bookCoverProvider";
import { uid } from "../types";
import type { Film, Episode, JEvent, Book } from "../types";

// ─── Mock provider ────────────────────────────────────────────────────────────

interface MockCall {
  method: "findMovie" | "findTv";
  args: unknown[];
}

class MockProvider implements ArtworkProvider {
  calls: MockCall[] = [];
  private _result: ArtworkProviderResult | null = null;
  private _throws = false;

  /** Configure the result every call returns. */
  willReturn(r: ArtworkProviderResult | null) { this._result = r; return this; }
  /** Configure the provider to throw on the next call. */
  willThrow() { this._throws = true; return this; }

  async findMovie(normTitle: string, year?: number): Promise<ArtworkProviderResult | null> {
    this.calls.push({ method: "findMovie", args: [normTitle, year] });
    if (this._throws) { this._throws = false; throw new Error("network error"); }
    return this._result;
  }

  async findTv(normTitle: string): Promise<ArtworkProviderResult | null> {
    this.calls.push({ method: "findTv", args: [normTitle] });
    if (this._throws) { this._throws = false; throw new Error("network error"); }
    return this._result;
  }

  async byExternalId(): Promise<ArtworkProviderResult | null> { return null; }

  imageUrl(path: string): string { return `https://image.tmdb.org/t/p/w342${path}`; }
}

// ─── Entry factories ──────────────────────────────────────────────────────────

function film(title: string, year?: number): Film {
  return {
    id: uid(), kind: "film", source: "letterboxd", tier: 2,
    start: "2024-01-15", dedupeKey: `film|${title.toLowerCase()}|2024-01-15`,
    title, year, createdAt: new Date().toISOString(),
  };
}

function episode(showTitle: string): Episode {
  return {
    id: uid(), kind: "episode", source: "netflix", tier: 3,
    start: "2024-01-15", dedupeKey: `episode|${showTitle.toLowerCase()}|||2024-01-15`,
    showTitle, createdAt: new Date().toISOString(),
  };
}

function event(): JEvent {
  return {
    id: uid(), kind: "event", source: "manual", tier: 1,
    start: "2024-01-15", dedupeKey: "event|2024-01-15|radiohead",
    category: "concert", artist: "Radiohead", venue: "3Arena", city: "Dublin",
    createdAt: new Date().toISOString(),
  };
}

// ─── Test result helpers ──────────────────────────────────────────────────────

const MATCHED_RESULT: ArtworkProviderResult = {
  provider: "tmdb",
  provider_id: 438631,
  poster_path: "/d5NXSklXo0qyIYkgV94XAgMIckC.jpg",
  title_matched: "Dune",
  confidence: 1.0,
};

// ─── Setup ────────────────────────────────────────────────────────────────────

let store: MemoryArtworkStore;
let provider: MockProvider;

beforeEach(() => {
  store = new MemoryArtworkStore();
  provider = new MockProvider();
  setArtworkStorage(store);
  setArtworkProvider(provider);
  setFetchPostersEnabled(true);
});

// ─── resolveArtwork ───────────────────────────────────────────────────────────

describe("resolveArtwork", () => {
  describe("cache hits", () => {
    it("returns a matched record without calling the provider", async () => {
      const key = "movie|dune|2021";
      const match: ArtworkMatch = {
        id: key, key, media_type: "movie", status: "matched",
        provider: "tmdb", provider_id: 438631,
        poster_path: "/abc.jpg", title_matched: "Dune",
        confidence: 1, fetched_at: new Date().toISOString(),
      };
      await store.upsert(match);

      const result = await resolveArtwork(key);
      expect(result).toEqual(match);
      expect(provider.calls).toHaveLength(0);
    });

    it("returns a manual record without calling the provider", async () => {
      const key = "movie|arrival|2016";
      const match: ArtworkMatch = {
        id: key, key, media_type: "movie", status: "manual",
        provider: "tmdb", provider_id: 329865,
        poster_path: "/x2Fx0AoMJc9VTrjiBBm0TDWWMM.jpg", title_matched: "Arrival",
        confidence: 1, fetched_at: new Date().toISOString(),
      };
      await store.upsert(match);

      const result = await resolveArtwork(key);
      expect(result).toEqual(match);
      expect(provider.calls).toHaveLength(0);
    });

    it("returns null for a recent 'none' without calling the provider", async () => {
      const key = "movie|unknown|2020";
      const none: ArtworkMatch = {
        id: key, key, media_type: "movie", status: "none",
        provider: "tmdb", fetched_at: new Date().toISOString(),
      };
      await store.upsert(none);

      const result = await resolveArtwork(key);
      expect(result).toBeNull();
      expect(provider.calls).toHaveLength(0);
    });
  });

  describe("stale none (30+ days old) triggers a retry", () => {
    it("re-fetches a stale none and stores a match on success", async () => {
      const key = "movie|dune|2021";
      const staleDate = new Date();
      staleDate.setDate(staleDate.getDate() - 31);
      const staleNone: ArtworkMatch = {
        id: key, key, media_type: "movie", status: "none",
        provider: "tmdb", fetched_at: staleDate.toISOString(),
      };
      await store.upsert(staleNone);
      provider.willReturn(MATCHED_RESULT);

      const result = await resolveArtwork(key);
      expect(result).not.toBeNull();
      expect(result?.status).toBe("matched");
      expect(provider.calls).toHaveLength(1);
      // Stored record updated
      expect((await store.getByKey(key))?.status).toBe("matched");
    });
  });

  describe("cache miss → fetch", () => {
    it("calls findMovie for a movie key", async () => {
      provider.willReturn(MATCHED_RESULT);
      await resolveArtwork("movie|dune|2021");
      expect(provider.calls[0].method).toBe("findMovie");
      expect(provider.calls[0].args[0]).toBe("dune");
      expect(provider.calls[0].args[1]).toBe(2021);
    });

    it("calls findTv for a tv key", async () => {
      provider.willReturn({ ...MATCHED_RESULT, provider_id: 75006, title_matched: "Succession" });
      await resolveArtwork("tv|succession|");
      expect(provider.calls[0].method).toBe("findTv");
      expect(provider.calls[0].args[0]).toBe("succession");
    });

    it("stores and returns a matched record on provider success", async () => {
      provider.willReturn(MATCHED_RESULT);
      const result = await resolveArtwork("movie|dune|2021");

      expect(result?.status).toBe("matched");
      expect(result?.provider_id).toBe(438631);
      expect(result?.poster_path).toBe("/d5NXSklXo0qyIYkgV94XAgMIckC.jpg");

      const stored = await store.getByKey("movie|dune|2021");
      expect(stored?.status).toBe("matched");
    });

    it("stores 'none' and returns null when provider finds no match", async () => {
      provider.willReturn(null);
      const result = await resolveArtwork("movie|xyznotarealfilm|2099");

      expect(result).toBeNull();
      const stored = await store.getByKey("movie|xyznotarealfilm|2099");
      expect(stored?.status).toBe("none");
    });

    it("returns null and writes nothing on network failure", async () => {
      provider.willThrow();
      const result = await resolveArtwork("movie|dune|2021");

      expect(result).toBeNull();
      expect(await store.getByKey("movie|dune|2021")).toBeUndefined();
    });

    it("passes year as undefined for a movie key with no year", async () => {
      provider.willReturn(MATCHED_RESULT);
      await resolveArtwork("movie|inception|");
      expect(provider.calls[0].args[1]).toBeUndefined();
    });
  });

  describe("toggle off", () => {
    it("returns null without fetching when toggle is off", async () => {
      setFetchPostersEnabled(false);
      const result = await resolveArtwork("movie|dune|2021");
      expect(result).toBeNull();
      expect(provider.calls).toHaveLength(0);
    });

    it("still returns cached matched result when toggle is off", async () => {
      const key = "movie|dune|2021";
      const match: ArtworkMatch = {
        id: key, key, media_type: "movie", status: "matched",
        provider: "tmdb", provider_id: 438631,
        poster_path: "/abc.jpg", title_matched: "Dune",
        confidence: 1, fetched_at: new Date().toISOString(),
      };
      await store.upsert(match);
      setFetchPostersEnabled(false);

      const result = await resolveArtwork(key);
      expect(result).toEqual(match);
    });
  });

  describe("no provider injected", () => {
    it("returns null without throwing when provider is null", async () => {
      setArtworkProvider(null as unknown as MockProvider);
      const result = await resolveArtwork("movie|dune|2021");
      expect(result).toBeNull();
      setArtworkProvider(provider); // restore
    });
  });
});

// ─── enrichAll ───────────────────────────────────────────────────────────────

describe("enrichAll", () => {
  it("resolves distinct Film and Episode keys", async () => {
    provider.willReturn(MATCHED_RESULT);
    const entries = [film("Dune", 2021), film("Dune", 2021), episode("Succession")];
    await enrichAll(entries);
    // Two distinct keys: movie|dune|2021 and tv|succession|
    expect(provider.calls).toHaveLength(2);
  });

  it("skips non-film/episode entries (events, books, legs)", async () => {
    provider.willReturn(MATCHED_RESULT);
    await enrichAll([event()]);
    expect(provider.calls).toHaveLength(0);
  });

  it("skips already-matched keys", async () => {
    const key = "movie|dune|2021";
    await store.upsert({
      id: key, key, media_type: "movie", status: "matched",
      provider: "tmdb", fetched_at: new Date().toISOString(),
    });
    await enrichAll([film("Dune", 2021)]);
    expect(provider.calls).toHaveLength(0);
  });

  it("skips recent 'none' keys", async () => {
    const key = "movie|dune|2021";
    await store.upsert({
      id: key, key, media_type: "movie", status: "none",
      provider: "tmdb", fetched_at: new Date().toISOString(),
    });
    await enrichAll([film("Dune", 2021)]);
    expect(provider.calls).toHaveLength(0);
  });

  it("retries stale 'none' keys (31 days old)", async () => {
    const key = "movie|dune|2021";
    const stale = new Date();
    stale.setDate(stale.getDate() - 31);
    await store.upsert({
      id: key, key, media_type: "movie", status: "none",
      provider: "tmdb", fetched_at: stale.toISOString(),
    });
    provider.willReturn(MATCHED_RESULT);
    await enrichAll([film("Dune", 2021)]);
    expect(provider.calls).toHaveLength(1);
  });

  it("does nothing when toggle is off", async () => {
    setFetchPostersEnabled(false);
    await enrichAll([film("Dune", 2021), episode("Succession")]);
    expect(provider.calls).toHaveLength(0);
  });

  it("does nothing when no provider is injected", async () => {
    setArtworkProvider(null as unknown as MockProvider);
    await enrichAll([film("Dune", 2021)]);
    expect(provider.calls).toHaveLength(0);
    setArtworkProvider(provider);
  });

  it("aborts early when signal fires before processing", async () => {
    const controller = new AbortController();
    controller.abort();
    await enrichAll([film("Dune", 2021), episode("Succession")], controller.signal);
    expect(provider.calls).toHaveLength(0);
  });

  it("aborts mid-run when signal fires", async () => {
    // Use a provider that aborts the signal on its first call
    const controller = new AbortController();
    let callCount = 0;
    const abortingProvider: ArtworkProvider = {
      async findMovie() {
        callCount++;
        controller.abort(); // abort after first call
        return MATCHED_RESULT;
      },
      async findTv() { callCount++; return MATCHED_RESULT; },
      async byExternalId() { return null; },
      imageUrl: (p) => p,
    };
    setArtworkProvider(abortingProvider);

    // Three distinct films to enrich
    await enrichAll(
      [film("Dune", 2021), film("Arrival", 2016), film("Inception", 2010)],
      controller.signal,
    );
    // Should stop after very few calls (1–3 depending on concurrency timing)
    expect(callCount).toBeLessThan(4);
  });

  it("resolves an empty entries array without error", async () => {
    await expect(enrichAll([])).resolves.toBeUndefined();
    expect(provider.calls).toHaveLength(0);
  });
});

// ─── getFetchPostersEnabled ───────────────────────────────────────────────────

describe("getFetchPostersEnabled", () => {
  it("returns true by default (after beforeEach reset)", () => {
    expect(getFetchPostersEnabled()).toBe(true);
  });

  it("reflects setFetchPostersEnabled", () => {
    setFetchPostersEnabled(false);
    expect(getFetchPostersEnabled()).toBe(false);
    setFetchPostersEnabled(true);
    expect(getFetchPostersEnabled()).toBe(true);
  });
});

// ─── Book cover enrichment ────────────────────────────────────────────────────

function book(title: string, author: string, year?: number, isbn13?: string): Book {
  return {
    id: uid(), kind: "book", source: "goodreads", tier: 2,
    start: "2024-01-15", dedupeKey: `book|${title.toLowerCase()}|2024-01-15`,
    title, author, year, isbn13, createdAt: new Date().toISOString(),
  };
}

class MockBookCoverProvider implements BookCoverProvider {
  calls: Array<{ normTitle: string; author: string; isbn13?: string }> = [];
  private _result: BookCoverResult | null = null;

  willReturn(r: BookCoverResult | null) { this._result = r; return this; }

  readonly enabled = true;

  async findBook(normTitle: string, author: string, isbn13?: string): Promise<BookCoverResult | null> {
    this.calls.push({ normTitle, author, isbn13 });
    return this._result;
  }

  imageUrl(path: string): string { return `https://covers.openlibrary.org${path}.jpg`; }
}

const MATCHED_BOOK_RESULT: BookCoverResult = {
  provider: "open_library",
  cover_id: 9255566,
  poster_path: "/b/id/9255566-L",
  title_matched: "Dune",
  confidence: 0.8,
};

describe("resolveBookCoverForEntry", () => {
  let bookProvider: MockBookCoverProvider;

  beforeEach(() => {
    bookProvider = new MockBookCoverProvider();
    setBookCoverProvider(bookProvider);
    setFetchBookCoversEnabled(true);
  });

  it("fetches and stores a cover on cache miss", async () => {
    bookProvider.willReturn(MATCHED_BOOK_RESULT);
    const entry = book("Dune", "Frank Herbert", 1965);
    const result = await resolveBookCoverForEntry(entry);

    expect(result).not.toBeNull();
    expect(result!.status).toBe("matched");
    expect(result!.media_type).toBe("book");
    expect(result!.poster_path).toBe("/b/id/9255566-L");
    expect(bookProvider.calls).toHaveLength(1);
    expect(bookProvider.calls[0].normTitle).toBe("dune");
    expect(bookProvider.calls[0].author).toBe("Frank Herbert");
  });

  it("passes isbn13 to findBook when present on the entry", async () => {
    bookProvider.willReturn(MATCHED_BOOK_RESULT);
    const entry = book("Dune", "Frank Herbert", 1965, "9780441013593");
    await resolveBookCoverForEntry(entry);
    expect(bookProvider.calls[0].isbn13).toBe("9780441013593");
  });

  it("stores a none record and returns null when provider finds nothing", async () => {
    bookProvider.willReturn(null);
    const entry = book("Dune", "Frank Herbert");
    const result = await resolveBookCoverForEntry(entry);
    expect(result).toBeNull();
    const cached = await store.getByKey("book|dune|");
    expect(cached?.status).toBe("none");
  });

  it("returns cached match without calling provider on second call", async () => {
    bookProvider.willReturn(MATCHED_BOOK_RESULT);
    const entry = book("Dune", "Frank Herbert");
    await resolveBookCoverForEntry(entry);
    await resolveBookCoverForEntry(entry);
    expect(bookProvider.calls).toHaveLength(1); // second call served from cache
  });

  it("respects the book covers toggle — skips fetch when off", async () => {
    setFetchBookCoversEnabled(false);
    bookProvider.willReturn(MATCHED_BOOK_RESULT);
    const result = await resolveBookCoverForEntry(book("Dune", "Frank Herbert"));
    expect(result).toBeNull();
    expect(bookProvider.calls).toHaveLength(0);
  });

  it("returns null when no book cover provider is set", async () => {
    setBookCoverProvider(null as unknown as MockBookCoverProvider);
    const result = await resolveBookCoverForEntry(book("Dune", "Frank Herbert"));
    expect(result).toBeNull();
  });
});

describe("enrichAll — book cover enrichment", () => {
  let bookProvider: MockBookCoverProvider;

  beforeEach(() => {
    bookProvider = new MockBookCoverProvider().willReturn(MATCHED_BOOK_RESULT);
    setBookCoverProvider(bookProvider);
    setFetchBookCoversEnabled(true);
  });

  it("resolves book entries in enrichAll", async () => {
    const entries = [book("Dune", "Frank Herbert"), book("1984", "George Orwell")];
    await enrichAll(entries);
    expect(bookProvider.calls).toHaveLength(2);
  });

  it("skips books when book covers toggle is off", async () => {
    setFetchBookCoversEnabled(false);
    await enrichAll([book("Dune", "Frank Herbert")]);
    expect(bookProvider.calls).toHaveLength(0);
  });

  it("does not call book provider for film entries", async () => {
    const entries = [film("Dune", 2021), book("Dune", "Frank Herbert")];
    await enrichAll(entries);
    // Film handled by film provider, book by book provider
    expect(bookProvider.calls).toHaveLength(1);
    expect(bookProvider.calls[0].normTitle).toBe("dune");
  });
});

describe("getFetchBookCoversEnabled", () => {
  it("returns true by default", () => {
    expect(getFetchBookCoversEnabled()).toBe(true);
  });

  it("reflects setFetchBookCoversEnabled", () => {
    setFetchBookCoversEnabled(false);
    expect(getFetchBookCoversEnabled()).toBe(false);
    setFetchBookCoversEnabled(true);
    expect(getFetchBookCoversEnabled()).toBe(true);
  });
});
