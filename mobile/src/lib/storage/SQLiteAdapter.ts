/**
 * SQLiteAdapter — implements StorageAdapter for React Native / Expo
 *
 * Storage strategy: one table per store, each row is (id TEXT PK, data TEXT).
 * All entry fields are serialised to JSON in the `data` column. This keeps the
 * schema migration-free while the data model evolves; a future phase can add
 * indexed columns (e.g. `start_date TEXT GENERATED`) for FTS5 and sorted queries.
 *
 * WAL mode is enabled for better concurrent read performance.
 */
import * as SQLite from "expo-sqlite";
import { STORES, emptyJournalData, type JournalData, type StoreName } from "@chronicle/journal/types";
import type { StorageAdapter, Row } from "@chronicle/journal/storage";

export class SQLiteAdapter implements StorageAdapter {
  private db: SQLite.SQLiteDatabase;
  /**
   * JS-level serial queue — ensures only one async DB operation runs at a time.
   *
   * expo-sqlite's withExclusiveTransactionAsync acquires a SQLite EXCLUSIVE lock,
   * but it does not internally queue concurrent callers: a second call that arrives
   * while the first holds the lock receives "database is locked" immediately.
   * Serialising at the JS level before handing off to SQLite prevents that race.
   *
   * Pattern: each new operation appends to the chain; the chain always resolves to
   * void (errors are swallowed on the chain itself) so a failed op doesn't stall
   * subsequent ones, while the returned promise still rejects to the caller.
   */
  private _queue: Promise<void> = Promise.resolve();

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const result = this._queue.then(fn);
    this._queue = result.then(() => undefined, () => undefined);
    return result;
  }

  private constructor(db: SQLite.SQLiteDatabase) {
    this.db = db;
  }

  /**
   * Open (or create) the Chronicle SQLite database and ensure all store tables
   * exist. Call this once at app startup, before setAdapter() + initJournal().
   *
   *   const adapter = await SQLiteAdapter.open();
   *   setAdapter(adapter);
   *   await initJournal();
   */
  static async open(name = "chronicle.db"): Promise<SQLiteAdapter> {
    const db = await SQLite.openDatabaseAsync(name);
    const adapter = new SQLiteAdapter(db);
    await adapter.init();
    return adapter;
  }

  /** Create tables and enable WAL. Idempotent — safe to call on every launch. */
  private async init(): Promise<void> {
    await this.db.execAsync("PRAGMA journal_mode = WAL;");
    for (const store of STORES) {
      await this.db.execAsync(`
        CREATE TABLE IF NOT EXISTS "${store}" (
          id   TEXT PRIMARY KEY NOT NULL,
          data TEXT NOT NULL
        );
      `);
    }
  }

  // ── StorageAdapter implementation ────────────────────────────────────────

  async getAll<T extends Row>(store: StoreName): Promise<T[]> {
    return this.enqueue(async () => {
      const rows = await this.db.getAllAsync<{ data: string }>(
        `SELECT data FROM "${store}"`
      );
      return rows.map((r) => JSON.parse(r.data) as T);
    });
  }

  async putMany<T extends Row>(store: StoreName, items: T[]): Promise<void> {
    if (!items.length) return;
    return this.enqueue(async () => {
      // withExclusiveTransactionAsync serialises writes and passes a txn object.
      // Use a prepared statement so SQL is parsed once rather than once per row —
      // significant speedup for large batches (e.g. 4000 Netflix entries).
      await this.db.withExclusiveTransactionAsync(async (txn) => {
        const stmt = await txn.prepareAsync(
          `INSERT OR REPLACE INTO "${store}" (id, data) VALUES (?, ?)`
        );
        try {
          for (const item of items) {
            await stmt.executeAsync([item.id, JSON.stringify(item)]);
          }
        } finally {
          await stmt.finalizeAsync();
        }
      });
    });
  }

  async removeMany(store: StoreName, ids: string[]): Promise<void> {
    if (!ids.length) return;
    return this.enqueue(async () => {
      await this.db.withExclusiveTransactionAsync(async (txn) => {
        for (const id of ids) {
          await txn.runAsync(`DELETE FROM "${store}" WHERE id = ?`, [id]);
        }
      });
    });
  }

  async replaceAll(data: JournalData): Promise<void> {
    return this.enqueue(async () => {
      await this.db.withExclusiveTransactionAsync(async (txn) => {
        for (const store of STORES) {
          await txn.runAsync(`DELETE FROM "${store}"`);
          const items = (data[store] ?? []) as Row[];
          for (const item of items) {
            await txn.runAsync(
              `INSERT INTO "${store}" (id, data) VALUES (?, ?)`,
              [item.id, JSON.stringify(item)]
            );
          }
        }
      });
    });
  }

  async clearAll(): Promise<void> {
    await this.replaceAll(emptyJournalData());
  }
}
