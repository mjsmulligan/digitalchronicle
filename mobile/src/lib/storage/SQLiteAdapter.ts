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
import { STORES, type JournalData, type StoreName } from "@chronicle/journal/types";
import type { StorageAdapter, Row } from "@chronicle/journal/storage";

export class SQLiteAdapter implements StorageAdapter {
  private db: SQLite.SQLiteDatabase;

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
    const rows = await this.db.getAllAsync<{ data: string }>(
      `SELECT data FROM "${store}"`
    );
    return rows.map((r) => JSON.parse(r.data) as T);
  }

  async putMany<T extends Row>(store: StoreName, items: T[]): Promise<void> {
    if (!items.length) return;
    await this.db.withTransactionAsync(async () => {
      for (const item of items) {
        await this.db.runAsync(
          `INSERT OR REPLACE INTO "${store}" (id, data) VALUES (?, ?)`,
          [item.id, JSON.stringify(item)]
        );
      }
    });
  }

  async removeMany(store: StoreName, ids: string[]): Promise<void> {
    if (!ids.length) return;
    await this.db.withTransactionAsync(async () => {
      for (const id of ids) {
        await this.db.runAsync(`DELETE FROM "${store}" WHERE id = ?`, [id]);
      }
    });
  }

  async replaceAll(data: JournalData): Promise<void> {
    await this.db.withTransactionAsync(async () => {
      for (const store of STORES) {
        await this.db.runAsync(`DELETE FROM "${store}"`);
        const items = (data[store] ?? []) as Row[];
        for (const item of items) {
          await this.db.runAsync(
            `INSERT INTO "${store}" (id, data) VALUES (?, ?)`,
            [item.id, JSON.stringify(item)]
          );
        }
      }
    });
  }

  async clearAll(): Promise<void> {
    await this.replaceAll({
      trips: [],
      legs: [],
      stays: [],
      events: [],
      films: [],
      episodes: [],
      books: [],
      series: [],
      notes: [],
      staging: [],
      people: [],
    });
  }
}
