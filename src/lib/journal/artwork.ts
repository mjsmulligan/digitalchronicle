/**
 * Artwork enrichment layer — event posters spec.
 *
 * This module is intentionally kept separate from JournalData / STORES so that
 * artwork cache is never included in chronicle backups or replaceAll() resets.
 * Each platform provides its own storage implementation:
 *   - Web:    IDBartworkStore (below) backed by a standalone IndexedDB database.
 *   - Mobile: SQLiteArtworkStore in mobile/src/lib/artworkStore.ts (WP6).
 *
 * Public surface used by callers:
 *   normaliseTitle(raw)          — canonical form for matching and keying
 *   artworkKey(type, norm, year) — stable cache key
 *   eventToArtworkKey(entry)     — derive key from any Entry (null for non-film/tv/book)
 *   bookToArtworkKey(entry)      — derive key from a Book entry (null for non-books)
 *   artworkStorage               — active storage implementation (call setArtworkStorage to inject)
 */

import type { Entry, Film, Episode, Book } from "./types";
import { view } from "./types";

// ─── Core types ───────────────────────────────────────────────────────────────

export type ArtworkMediaType = "movie" | "tv";

/** "matched" = poster found; "none" = no match (cached, retried after 30 days); "manual" = user override */
export type ArtworkMatchStatus = "matched" | "none" | "manual";

export interface ArtworkMatch {
  /**
   * Storage primary key — identical to `key`. Used as IDB keyPath and SQLite PK
   * so get-by-key is a direct lookup without a secondary index.
   */
  id: string;
  /** `media_type|normalised_title|year` (year may be empty for TV) */
  key: string;
  media_type: ArtworkMediaType;
  status: ArtworkMatchStatus;
  /** Always "tmdb" for now; kept for future provider swaps */
  provider: string;
  /** TMDB movie or TV id when status is "matched" or "manual" */
  provider_id?: number;
  /** TMDB relative poster path, e.g. "/abc123.jpg" */
  poster_path?: string;
  /** Title string returned by the provider — shown in the correction picker (WP8) */
  title_matched?: string;
  /** 0–1 confidence score, for debugging only */
  confidence?: number;
  /** ISO 8601 UTC timestamp when this record was last written */
  fetched_at: string;
}

// ─── Key building ─────────────────────────────────────────────────────────────

/**
 * Build the canonical cache key for an artwork match.
 *
 * @param mediaType  "movie" | "tv"
 * @param normTitle  Already-normalised title (output of normaliseTitle())
 * @param year       Release year (optional — omitted for TV series)
 */
export function artworkKey(
  mediaType: ArtworkMediaType,
  normTitle: string,
  year?: number,
): string {
  return `${mediaType}|${normTitle}|${year ?? ""}`;
}

// ─── Title normalisation (spec section 6) ─────────────────────────────────────

/**
 * Produce the canonical normalised title used for matching and key building.
 *
 * Rules (applied in order):
 *  1. Trim and lowercase.
 *  2. Strip trailing "(year)" suffix, e.g. "Dune (2021)" → "dune".
 *  3. Strip accents via NFD decomposition.
 *  4. Collapse runs of spaces and hyphens to a single space.
 *  5. Strip a leading "the ", "a ", or "an " article (for comparison only —
 *     the raw title is stored separately in title_matched).
 */
export function normaliseTitle(raw: string): string {
  let s = raw.trim().toLowerCase();
  // Strip trailing "(year)" e.g. "Dune (2021)" or "Dune(2021)"
  s = s.replace(/\s*\(\d{4}\)\s*$/, "");
  // NFD + remove combining diacritical marks
  s = s.normalize("NFD").replace(/[̀-ͯ]/g, "");
  // Collapse runs of spaces and hyphens to a single space
  s = s.replace(/[-\s]+/g, " ").trim();
  // Strip leading articles
  s = s.replace(/^(the|a|an) /, "");
  return s.trim();
}

// ─── Entry → key resolver (WP2) ──────────────────────────────────────────────

/**
 * Derive an artwork cache key from a journal entry.
 *
 * Returns null for any entry kind that is not a movie, TV episode, or book:
 *   Leg, Stay, JEvent, PlaceEntry → null.
 *
 * For Film entries the key uses the film title + release year.
 * For Episode entries the key uses the show title (already parsed by the
 * Netflix connector) with no year — series posters are not season-specific.
 * For Book entries delegates to bookToArtworkKey.
 */
export function eventToArtworkKey(entry: Entry): string | null {
  if (entry.kind === "film") {
    const v = view(entry as Film);
    const norm = normaliseTitle(v.title);
    if (!norm) return null;
    return artworkKey("movie", norm, v.year);
  }

  if (entry.kind === "episode") {
    const ep = entry as Episode;
    const norm = normaliseTitle(ep.showTitle);
    if (!norm) return null;
    // No year for TV: series poster is not season-dependent
    return artworkKey("tv", norm, undefined);
  }

  if (entry.kind === "book") {
    return bookToArtworkKey(entry);
  }

  return null;
}

/**
 * Derive an artwork cache key from a Book entry.
 *
 * Key format: `"book|{normTitle}|{year_or_empty}"` — same pattern as films.
 * Returns null if the entry is not a book or has an empty title.
 */
export function bookToArtworkKey(entry: Entry): string | null {
  if (entry.kind !== "book") return null;
  const b = entry as Book;
  const norm = normaliseTitle(b.title);
  if (!norm) return null;
  return `book|${norm}|${b.year ?? ""}`;
}

// ─── Storage interface ────────────────────────────────────────────────────────

/**
 * Platform-agnostic artwork storage contract.
 * The web implementation (IDBartworkStore) is below.
 * The mobile implementation is in mobile/src/lib/artworkStore.ts (WP6).
 */
export interface ArtworkStorage {
  /** Look up a single cached result. Returns undefined on cache miss. */
  getByKey(key: string): Promise<ArtworkMatch | undefined>;
  /** Insert or replace a match record. */
  upsert(match: ArtworkMatch): Promise<void>;
  /** Remove a cached result (used when clearing the artwork cache). */
  deleteByKey(key: string): Promise<void>;
  /**
   * Return all records with status "none" whose fetched_at is older than the
   * given date. Used by the enrichment service to find stale negatives eligible
   * for retry (spec: retry after 30 days).
   */
  listStaleNone(olderThan: Date): Promise<ArtworkMatch[]>;
  /** Clear every record — used by dev reset. */
  clearAll(): Promise<void>;
}

// ─── Active storage instance ──────────────────────────────────────────────────

let _storage: ArtworkStorage | null = null;

/**
 * Inject the platform storage implementation.
 * Must be called at app startup, before any artwork lookup.
 *
 *   // web
 *   setArtworkStorage(new IDBartworkStore());
 *
 *   // mobile (WP6)
 *   setArtworkStorage(new SQLiteArtworkStore(db));
 */
export function setArtworkStorage(s: ArtworkStorage): void {
  _storage = s;
}

/** Returns the active artwork storage, throwing if not yet initialised. */
export function artworkStorage(): ArtworkStorage {
  if (!_storage) throw new Error("artworkStorage: not initialised — call setArtworkStorage() first");
  return _storage;
}

// ─── Web: IDB implementation ──────────────────────────────────────────────────

const IDB_NAME = "chronicle-artwork";
const IDB_VERSION = 1;
const STORE = "artwork_match";

/**
 * IndexedDB-backed artwork storage for the web app.
 *
 * Uses a dedicated database ("chronicle-artwork") so that it is completely
 * decoupled from the main "waypoint-journal" store and never swept by
 * JournalData backup/restore operations.
 */
export class IDBartworkStore implements ArtworkStorage {
  private _dbp: Promise<IDBDatabase> | null = null;

  private db(): Promise<IDBDatabase> {
    if (!this._dbp) {
      this._dbp = new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(IDB_NAME, IDB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE)) {
            db.createObjectStore(STORE, { keyPath: "id" });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return this._dbp;
  }

  async getByKey(key: string): Promise<ArtworkMatch | undefined> {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result as ArtworkMatch | undefined);
      req.onerror = () => reject(req.error);
    });
  }

  async upsert(match: ArtworkMatch): Promise<void> {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, "readwrite").objectStore(STORE).put(match);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async deleteByKey(key: string): Promise<void> {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, "readwrite").objectStore(STORE).delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async listStaleNone(olderThan: Date): Promise<ArtworkMatch[]> {
    const db = await this.db();
    const all = await new Promise<ArtworkMatch[]>((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result as ArtworkMatch[]);
      req.onerror = () => reject(req.error);
    });
    const cutoff = olderThan.toISOString();
    return all.filter((m) => m.status === "none" && m.fetched_at < cutoff);
  }

  async clearAll(): Promise<void> {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, "readwrite").objectStore(STORE).clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
}

// ─── In-memory implementation (for tests) ────────────────────────────────────

/**
 * Simple in-memory ArtworkStorage for unit tests.
 * Inject via: setArtworkStorage(new MemoryArtworkStore())
 */
export class MemoryArtworkStore implements ArtworkStorage {
  private store = new Map<string, ArtworkMatch>();

  async getByKey(key: string): Promise<ArtworkMatch | undefined> {
    return this.store.get(key);
  }

  async upsert(match: ArtworkMatch): Promise<void> {
    this.store.set(match.id, match);
  }

  async deleteByKey(key: string): Promise<void> {
    this.store.delete(key);
  }

  async listStaleNone(olderThan: Date): Promise<ArtworkMatch[]> {
    const cutoff = olderThan.toISOString();
    return [...this.store.values()].filter(
      (m) => m.status === "none" && m.fetched_at < cutoff,
    );
  }

  async clearAll(): Promise<void> {
    this.store.clear();
  }
}
