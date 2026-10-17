import type { JournalData, StoreName } from "./types";

/**
 * Minimal row shape — every record in every store has an `id` field.
 */
export type Row = { id: string };

/**
 * Persistence adapter interface — the only surface that differs between
 * the browser web app (IndexedDB via IDBAdapter in db.ts) and the mobile
 * app (SQLite via SQLiteAdapter in mobile/src/lib/storage/).
 *
 * Implementors must be pure CRUD: no React state, no geo loading, no
 * staging logic. All orchestration lives in db.ts which calls through here.
 *
 * Usage
 * -----
 *   // Web (default — no action required):
 *   import { initJournal } from "./db";
 *   await initJournal();
 *
 *   // Mobile — inject before initJournal():
 *   import { setAdapter, initJournal } from "./db";
 *   import { SQLiteAdapter } from "../storage/SQLiteAdapter";
 *   const adapter = await SQLiteAdapter.open();
 *   setAdapter(adapter);
 *   await initJournal();
 */
export interface StorageAdapter {
  /** Read all records from a named store. */
  getAll<T extends Row>(store: StoreName): Promise<T[]>;

  /** Upsert a batch of records into a store (insert or replace by id). */
  putMany<T extends Row>(store: StoreName, items: T[]): Promise<void>;

  /** Delete records by their ids. */
  removeMany(store: StoreName, ids: string[]): Promise<void>;

  /**
   * Atomically replace the contents of every store.
   * Used for JSON restore and clearAll.
   */
  replaceAll(data: JournalData): Promise<void>;

  /** Wipe all stores — equivalent to replaceAll with empty arrays. */
  clearAll(): Promise<void>;
}

/**
 * SQL the mobile adapter runs to create one store's table. Idempotent
 * (`IF NOT EXISTS`), so adding a store to STORES creates its table on the next
 * launch with no separate migration. Kept here, free of expo imports, so it can
 * be tested in node.
 */
export function storeTableSql(store: StoreName): string {
  return `CREATE TABLE IF NOT EXISTS "${store}" (id TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL)`;
}
