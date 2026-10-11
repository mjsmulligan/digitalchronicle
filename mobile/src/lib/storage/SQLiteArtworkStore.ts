/**
 * SQLiteArtworkStore — mobile-side implementation of ArtworkStorage.
 *
 * Uses a separate "chronicle-artwork.db" SQLite file that is NOT part of
 * the main chronicle.db journal — this mirrors the IDBartworkStore on web
 * which uses a separate "chronicle-artwork" IndexedDB database. Neither
 * database is touched by the journal replaceAll / clearAll operations, so
 * poster cache bytes are never included in backups.
 *
 * WAL mode is enabled for better concurrent read performance (matches
 * the main chronicle.db approach in SQLiteAdapter).
 *
 * Note: expo-sqlite's openDatabaseAsync returns the same underlying
 * connection when called with the same name in the same process, so
 * opening "chronicle-artwork.db" twice is safe.
 */
import * as SQLite from "expo-sqlite";
import type { ArtworkMatch, ArtworkStorage } from "@chronicle/journal/artwork";

const STALE_NONE_DAYS = 30;

function staleCutoff(): string {
  const d = new Date();
  d.setDate(d.getDate() - STALE_NONE_DAYS);
  return d.toISOString();
}

export class SQLiteArtworkStore implements ArtworkStorage {
  private db: SQLite.SQLiteDatabase;
  /** Serial JS-level queue — same pattern as SQLiteAdapter to avoid lock contention. */
  private _queue: Promise<void> = Promise.resolve();

  private constructor(db: SQLite.SQLiteDatabase) {
    this.db = db;
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const result = this._queue.then(fn);
    this._queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /**
   * Open (or create) the artwork SQLite database.
   * Creates the artwork_match table if it does not already exist.
   * Safe to call on every app launch.
   */
  static async open(dbName = "chronicle-artwork.db"): Promise<SQLiteArtworkStore> {
    const db = await SQLite.openDatabaseAsync(dbName);
    await db.execAsync("PRAGMA journal_mode = WAL;");
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS artwork_match (
        id   TEXT PRIMARY KEY NOT NULL,
        data TEXT NOT NULL
      );
    `);
    return new SQLiteArtworkStore(db);
  }

  async getByKey(key: string): Promise<ArtworkMatch | undefined> {
    return this.enqueue(async () => {
      const row = await this.db.getFirstAsync<{ data: string }>(
        `SELECT data FROM artwork_match WHERE id = ?`,
        [key],
      );
      return row ? (JSON.parse(row.data) as ArtworkMatch) : undefined;
    });
  }

  async upsert(match: ArtworkMatch): Promise<void> {
    return this.enqueue(async () => {
      await this.db.runAsync(
        `INSERT OR REPLACE INTO artwork_match (id, data) VALUES (?, ?)`,
        [match.id, JSON.stringify(match)],
      );
    });
  }

  async deleteByKey(key: string): Promise<void> {
    return this.enqueue(async () => {
      await this.db.runAsync(`DELETE FROM artwork_match WHERE id = ?`, [key]);
    });
  }

  /**
   * Return all "none" records older than STALE_NONE_DAYS.
   * Uses JSON_EXTRACT so the query runs without a schema migration.
   */
  async listStaleNone(): Promise<ArtworkMatch[]> {
    return this.enqueue(async () => {
      const cutoff = staleCutoff();
      const rows = await this.db.getAllAsync<{ data: string }>(
        `SELECT data FROM artwork_match
           WHERE JSON_EXTRACT(data, '$.status')     = 'none'
             AND JSON_EXTRACT(data, '$.fetched_at') < ?`,
        [cutoff],
      );
      return rows.map((r) => JSON.parse(r.data) as ArtworkMatch);
    });
  }

  /** Wipe the entire artwork cache (e.g. developer reset). */
  async clearAll(): Promise<void> {
    return this.enqueue(async () => {
      await this.db.runAsync(`DELETE FROM artwork_match`);
    });
  }
}
