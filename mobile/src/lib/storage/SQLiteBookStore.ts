/**
 * Saved book definitions for the book export (docs/specs/book-export.md).
 *
 * Kept in its own "chronicle-books.db", like the artwork cache, so a journal
 * replaceAll / clearAll (import, reset) never wipes the user's saved books. The
 * spec called for a table in chronicle.db; this keeps the same shape (id, data)
 * without touching the journal's store list or backup format.
 */
import * as SQLite from "expo-sqlite";
import type { SavedBook } from "@chronicle/journal/book";

export class SQLiteBookStore {
  private constructor(private db: SQLite.SQLiteDatabase) {}

  private static instance: Promise<SQLiteBookStore> | null = null;

  /** One shared store for the app. Safe to call from any screen. */
  static get(): Promise<SQLiteBookStore> {
    if (!SQLiteBookStore.instance) {
      SQLiteBookStore.instance = (async () => {
        const db = await SQLite.openDatabaseAsync("chronicle-books.db");
        await db.runAsync("PRAGMA journal_mode = WAL");
        await db.runAsync(`
          CREATE TABLE IF NOT EXISTS books (
            id         TEXT PRIMARY KEY NOT NULL,
            data       TEXT NOT NULL,
            updated_at TEXT NOT NULL
          )
        `);
        return new SQLiteBookStore(db);
      })();
      // A failed open must not be cached forever.
      SQLiteBookStore.instance.catch(() => {
        SQLiteBookStore.instance = null;
      });
    }
    return SQLiteBookStore.instance;
  }

  /** Most recently updated first. */
  async list(): Promise<SavedBook[]> {
    const rows = await this.db.getAllAsync<{ data: string }>(
      "SELECT data FROM books ORDER BY updated_at DESC",
    );
    return rows.map((r) => JSON.parse(r.data) as SavedBook);
  }

  async get(id: string): Promise<SavedBook | undefined> {
    const row = await this.db.getFirstAsync<{ data: string }>(
      "SELECT data FROM books WHERE id = ?",
      [id],
    );
    return row ? (JSON.parse(row.data) as SavedBook) : undefined;
  }

  async put(book: SavedBook): Promise<void> {
    await this.db.runAsync("INSERT OR REPLACE INTO books (id, data, updated_at) VALUES (?, ?, ?)", [
      book.id,
      JSON.stringify(book),
      book.updatedAt,
    ]);
  }

  async remove(id: string): Promise<void> {
    await this.db.runAsync("DELETE FROM books WHERE id = ?", [id]);
  }
}
