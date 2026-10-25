/**
 * Tests for artwork.ts — WP1 (types, storage, key building),
 * WP2 (normaliseTitle, eventToArtworkKey), and
 * book covers WP1 (bookToArtworkKey).
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  normaliseTitle,
  artworkKey,
  eventToArtworkKey,
  bookToArtworkKey,
  MemoryArtworkStore,
  setArtworkStorage,
  artworkStorage,
  type ArtworkMatch,
} from "../artwork";
import { uid } from "../types";
import type { Film, Episode, JEvent, Book, Leg, Stay } from "../types";

// ─── normaliseTitle ───────────────────────────────────────────────────────────

describe("normaliseTitle", () => {
  it("lowercases", () => {
    expect(normaliseTitle("Dune")).toBe("dune");
  });

  it("strips trailing (year) with space", () => {
    expect(normaliseTitle("Dune (2021)")).toBe("dune");
  });

  it("strips trailing (year) without space", () => {
    expect(normaliseTitle("Dune(2021)")).toBe("dune");
  });

  it("strips accents", () => {
    expect(normaliseTitle("Amélie")).toBe("amelie");
    expect(normaliseTitle("Nausicaä")).toBe("nausicaa");
    expect(normaliseTitle("Le Fabuleux Destin d'Amélie Poulain")).toBe(
      "le fabuleux destin d'amelie poulain",
    );
  });

  it("strips leading 'the'", () => {
    expect(normaliseTitle("The Godfather")).toBe("godfather");
    expect(normaliseTitle("The Dark Knight")).toBe("dark knight");
  });

  it("strips leading 'a'", () => {
    expect(normaliseTitle("A Quiet Place")).toBe("quiet place");
  });

  it("strips leading 'an'", () => {
    expect(normaliseTitle("An American Werewolf in London")).toBe(
      "american werewolf in london",
    );
  });

  it("does not strip 'the' mid-title", () => {
    expect(normaliseTitle("Into the Wild")).toBe("into the wild");
  });

  it("collapses multiple spaces", () => {
    expect(normaliseTitle("Star  Wars")).toBe("star wars");
  });

  it("collapses hyphens to space", () => {
    expect(normaliseTitle("Spider-Man")).toBe("spider man");
  });

  it("handles colons and apostrophes (preserved)", () => {
    // Colons are not stripped — they're part of subtitle-bearing titles
    expect(normaliseTitle("Star Wars: A New Hope")).toBe(
      "star wars: a new hope",
    );
  });

  it("trims surrounding whitespace", () => {
    expect(normaliseTitle("  Dune  ")).toBe("dune");
  });

  it("handles empty string", () => {
    expect(normaliseTitle("")).toBe("");
  });

  it("handles numeric-only string", () => {
    expect(normaliseTitle("1917")).toBe("1917");
  });

  it("does not strip 'the' from titles that start with 'theme' etc.", () => {
    // "the " requires a trailing space, so "theme" is safe
    expect(normaliseTitle("Themes of Love")).toBe("themes of love");
  });
});

// ─── artworkKey ───────────────────────────────────────────────────────────────

describe("artworkKey", () => {
  it("formats movie key with year", () => {
    expect(artworkKey("movie", "dune", 2021)).toBe("movie|dune|2021");
  });

  it("formats movie key without year", () => {
    expect(artworkKey("movie", "dune")).toBe("movie|dune|");
  });

  it("formats tv key without year", () => {
    expect(artworkKey("tv", "succession")).toBe("tv|succession|");
  });

  it("formats tv key with year (unusual but valid)", () => {
    expect(artworkKey("tv", "succession", 2018)).toBe("tv|succession|2018");
  });
});

// ─── eventToArtworkKey ───────────────────────────────────────────────────────

function makeFilm(overrides: Partial<Film> = {}): Film {
  return {
    id: uid(), kind: "film", source: "letterboxd",
    start: "2024-01-15", dedupeKey: "film|test|2024-01-15",
    title: "Dune", year: 2021, createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeEpisode(overrides: Partial<Episode> = {}): Episode {
  return {
    id: uid(), kind: "episode", source: "netflix",
    start: "2024-01-15", dedupeKey: "episode|test||ep1|2024-01-15",
    showTitle: "Succession", season: "Season 4", episodeTitle: "Connor's Wedding",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeEvent(category: JEvent["category"] = "concert"): JEvent {
  return {
    id: uid(), kind: "event", source: "manual",
    start: "2024-01-15", dedupeKey: "event|2024-01-15|radiohead",
    category, artist: "Radiohead", venue: "3Arena", city: "Dublin",
    createdAt: new Date().toISOString(),
  };
}

function makeBook(): Book {
  return {
    id: uid(), kind: "book", source: "goodreads",
    start: "2024-01-15", dedupeKey: "book|dune|frank herbert|2024-01-15",
    title: "Dune", author: "Frank Herbert", createdAt: new Date().toISOString(),
  };
}

function makeLeg(): Leg {
  return {
    id: uid(), kind: "leg", source: "viaduct",
    start: "2024-01-15", dedupeKey: "leg|2024-01-15|DUB|LHR",
    mode: "air", from: "DUB", to: "LHR", createdAt: new Date().toISOString(),
  };
}

describe("eventToArtworkKey", () => {
  describe("Film entries", () => {
    it("returns a movie key for a Letterboxd film with year", () => {
      const film = makeFilm({ title: "Dune", year: 2021 });
      expect(eventToArtworkKey(film)).toBe("movie|dune|2021");
    });

    it("returns a movie key without year when year is absent (Netflix film)", () => {
      const film = makeFilm({ source: "netflix", title: "Inception", year: undefined });
      expect(eventToArtworkKey(film)).toBe("movie|inception|");
    });

    it("normalises 'The' prefix from film title", () => {
      const film = makeFilm({ title: "The Godfather", year: 1972 });
      expect(eventToArtworkKey(film)).toBe("movie|godfather|1972");
    });

    it("normalises accented characters in film title", () => {
      const film = makeFilm({ title: "Amélie", year: 2001 });
      expect(eventToArtworkKey(film)).toBe("movie|amelie|2001");
    });

    it("strips subtitle year suffix", () => {
      // e.g. Letterboxd sometimes adds the year to the title string
      const film = makeFilm({ title: "Dune (2021)", year: 2021 });
      expect(eventToArtworkKey(film)).toBe("movie|dune|2021");
    });

    it("handles hyphens in title", () => {
      const film = makeFilm({ title: "Spider-Man: No Way Home", year: 2021 });
      expect(eventToArtworkKey(film)).toBe("movie|spider man: no way home|2021");
    });

    it("returns null for empty title", () => {
      const film = makeFilm({ title: "" });
      expect(eventToArtworkKey(film)).toBeNull();
    });

    it("respects manual overrides (view() is applied)", () => {
      const film = makeFilm({
        title: "Dune",
        year: 2021,
        overrides: { title: "Arrival", year: 2016 } as Film["overrides"],
      });
      // view() applies overrides, so we should get arrival
      expect(eventToArtworkKey(film)).toBe("movie|arrival|2016");
    });
  });

  describe("Episode entries", () => {
    it("returns a tv key using showTitle", () => {
      const ep = makeEpisode({ showTitle: "Succession" });
      expect(eventToArtworkKey(ep)).toBe("tv|succession|");
    });

    it("normalises 'The' in show title", () => {
      const ep = makeEpisode({ showTitle: "The Bear" });
      expect(eventToArtworkKey(ep)).toBe("tv|bear|");
    });

    it("ignores episode title and season for the key", () => {
      const ep = makeEpisode({
        showTitle: "Breaking Bad",
        season: "Season 3",
        episodeTitle: "Fly",
      });
      expect(eventToArtworkKey(ep)).toBe("tv|breaking bad|");
    });

    it("handles compound show title with colon (Star Trek: Discovery)", () => {
      const ep = makeEpisode({ showTitle: "Star Trek: Discovery" });
      expect(eventToArtworkKey(ep)).toBe("tv|star trek: discovery|");
    });

    it("normalises accented show title", () => {
      const ep = makeEpisode({ showTitle: "Élite" });
      expect(eventToArtworkKey(ep)).toBe("tv|elite|");
    });

    it("returns null for empty showTitle", () => {
      const ep = makeEpisode({ showTitle: "" });
      expect(eventToArtworkKey(ep)).toBeNull();
    });
  });

  describe("Non-film / non-episode entries return null", () => {
    it("concert event", () => {
      expect(eventToArtworkKey(makeEvent("concert"))).toBeNull();
    });

    it("gathering event", () => {
      expect(eventToArtworkKey(makeEvent("gathering"))).toBeNull();
    });

    it("book returns a book key (delegates to bookToArtworkKey)", () => {
      expect(eventToArtworkKey(makeBook())).toBe("book|dune|");
    });

    it("leg (flight)", () => {
      expect(eventToArtworkKey(makeLeg())).toBeNull();
    });

    it("stay", () => {
      const stay: Stay = {
        id: uid(), kind: "stay", source: "viaduct",
        start: "2024-01-15", dedupeKey: "stay|2024-01-15|marriott",
        place: "Marriott", createdAt: new Date().toISOString(),
      };
      expect(eventToArtworkKey(stay)).toBeNull();
    });
  });
});

// ─── bookToArtworkKey (book covers WP1) ──────────────────────────────────────

describe("bookToArtworkKey", () => {
  it("returns book|normTitle|year for a book with year", () => {
    const book: Book = {
      id: uid(), kind: "book", source: "goodreads",
      start: "2024-01-15", dedupeKey: "book|dune|2024-01-15",
      title: "Dune", author: "Frank Herbert", year: 1965,
      createdAt: new Date().toISOString(),
    };
    expect(bookToArtworkKey(book)).toBe("book|dune|1965");
  });

  it("returns book|normTitle| (empty year) for a book without year", () => {
    const book: Book = {
      id: uid(), kind: "book", source: "goodreads",
      start: "2024-01-15", dedupeKey: "book|dune|2024-01-15",
      title: "Dune", author: "Frank Herbert",
      createdAt: new Date().toISOString(),
    };
    expect(bookToArtworkKey(book)).toBe("book|dune|");
  });

  it("strips accents from an accented title", () => {
    const book: Book = {
      id: uid(), kind: "book", source: "goodreads",
      start: "2024-05-01", dedupeKey: "b|2024-05-01",
      title: "Déjà Vu", author: "Some Author", year: 2000,
      createdAt: new Date().toISOString(),
    };
    expect(bookToArtworkKey(book)).toBe("book|deja vu|2000");
  });

  it("strips leading 'The' article", () => {
    const book: Book = {
      id: uid(), kind: "book", source: "goodreads",
      start: "2024-05-01", dedupeKey: "b|2024-05-01",
      title: "The Name of the Wind", author: "Patrick Rothfuss", year: 2007,
      createdAt: new Date().toISOString(),
    };
    expect(bookToArtworkKey(book)).toBe("book|name of the wind|2007");
  });

  it("returns null for a non-book entry", () => {
    expect(bookToArtworkKey(makeBook())).toBe("book|dune|");  // makeBook() has no year
    expect(bookToArtworkKey(makeLeg())).toBeNull();
  });
});

// ─── MemoryArtworkStore — round-trip storage (WP1) ───────────────────────────

describe("MemoryArtworkStore", () => {
  let store: MemoryArtworkStore;

  beforeEach(() => {
    store = new MemoryArtworkStore();
    setArtworkStorage(store);
  });

  function makeMatch(overrides: Partial<ArtworkMatch> = {}): ArtworkMatch {
    const key = overrides.key ?? "movie|dune|2021";
    return {
      id: key,
      key,
      media_type: "movie",
      status: "matched",
      provider: "tmdb",
      provider_id: 438631,
      poster_path: "/d5NXSklXo0qyIYkgV94XAgMIckC.jpg",
      title_matched: "Dune",
      confidence: 0.98,
      fetched_at: new Date().toISOString(),
      ...overrides,
    };
  }

  it("getByKey returns undefined on cache miss", async () => {
    expect(await store.getByKey("movie|dune|2021")).toBeUndefined();
  });

  it("upsert then getByKey round-trips all fields", async () => {
    const match = makeMatch();
    await store.upsert(match);
    const result = await store.getByKey(match.key);
    expect(result).toEqual(match);
  });

  it("upsert replaces an existing record", async () => {
    const match = makeMatch();
    await store.upsert(match);
    const updated = { ...match, poster_path: "/newpath.jpg" };
    await store.upsert(updated);
    const result = await store.getByKey(match.key);
    expect(result?.poster_path).toBe("/newpath.jpg");
  });

  it("deleteByKey removes a record", async () => {
    const match = makeMatch();
    await store.upsert(match);
    await store.deleteByKey(match.key);
    expect(await store.getByKey(match.key)).toBeUndefined();
  });

  it("deleteByKey is a no-op for missing key", async () => {
    await expect(store.deleteByKey("nonexistent")).resolves.toBeUndefined();
  });

  it("listStaleNone returns only status=none older than cutoff", async () => {
    const old = makeMatch({
      key: "movie|old|2000",
      status: "none",
      fetched_at: "2024-01-01T00:00:00.000Z",
    });
    const fresh = makeMatch({
      key: "movie|fresh|2000",
      status: "none",
      fetched_at: new Date().toISOString(),
    });
    const matched = makeMatch({
      key: "movie|matched|2000",
      status: "matched",
      fetched_at: "2024-01-01T00:00:00.000Z",
    });
    await store.upsert(old);
    await store.upsert(fresh);
    await store.upsert(matched);

    // Cutoff: 30 days ago
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const stale = await store.listStaleNone(cutoff);

    expect(stale).toHaveLength(1);
    expect(stale[0].key).toBe("movie|old|2000");
  });

  it("clearAll removes everything", async () => {
    await store.upsert(makeMatch({ key: "movie|a|2020" }));
    await store.upsert(makeMatch({ key: "movie|b|2021" }));
    await store.clearAll();
    expect(await store.getByKey("movie|a|2020")).toBeUndefined();
    expect(await store.getByKey("movie|b|2021")).toBeUndefined();
  });

  it("artworkStorage() accessor returns the injected store", () => {
    expect(artworkStorage()).toBe(store);
  });

  it("artworkStorage() throws if not initialised", () => {
    // Temporarily break the injection
    setArtworkStorage(null as unknown as MemoryArtworkStore);
    expect(() => artworkStorage()).toThrow("not initialised");
    // Restore
    setArtworkStorage(store);
  });
});
