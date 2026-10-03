import { useSyncExternalStore } from "react";
import { STORES, type JournalData, type StoreName, type Entry, type PlaceRecord, type StagingBatch } from "./types";
import { loadStations } from "./geo";
import type { StorageAdapter, Row } from "./storage";

// ─── IndexedDB implementation ─────────────────────────────────────────────────

const DB_NAME = "waypoint-journal";
const DB_VERSION = 5;

class IDBAdapter implements StorageAdapter {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private openDB(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: "id" });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return this.dbPromise;
  }

  private tx(stores: StoreName[], fn: (t: IDBTransaction) => void): Promise<void> {
    return this.openDB().then(
      (db) =>
        new Promise((resolve, reject) => {
          const t = db.transaction(stores, "readwrite");
          fn(t);
          t.oncomplete = () => resolve();
          t.onerror = () => reject(t.error);
        }),
    );
  }

  async getAll<T extends Row>(store: StoreName): Promise<T[]> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const r = db.transaction(store).objectStore(store).getAll();
      r.onsuccess = () => resolve(r.result as T[]);
      r.onerror = () => reject(r.error);
    });
  }

  async putMany<T extends Row>(store: StoreName, items: T[]): Promise<void> {
    if (!items.length) return;
    await this.tx([store], (t) => items.forEach((i) => t.objectStore(store).put(i)));
  }

  async removeMany(store: StoreName, ids: string[]): Promise<void> {
    await this.tx([store], (t) => ids.forEach((id) => t.objectStore(store).delete(id)));
  }

  async replaceAll(data: JournalData): Promise<void> {
    await this.tx([...STORES], (t) => {
      for (const s of STORES) {
        const os = t.objectStore(s);
        os.clear();
        ((data[s] ?? []) as Row[]).forEach((r) => os.put(r));
      }
    });
  }

  async clearAll(): Promise<void> {
    await this.replaceAll({ trips: [], legs: [], stays: [], events: [], films: [], episodes: [], books: [], series: [], notes: [], staging: [], people: [], places: [] });
  }
}

// ─── Active adapter ───────────────────────────────────────────────────────────

let adapter: StorageAdapter = new IDBAdapter();

/**
 * Replace the active storage adapter. Must be called **before** `initJournal()`.
 *
 * The mobile app calls this at startup to inject a SQLiteAdapter:
 *   setAdapter(await SQLiteAdapter.open());
 *   await initJournal();
 */
export function setAdapter(a: StorageAdapter): void {
  adapter = a;
  initPromise = undefined; // reset so the next initJournal() re-reads from the new adapter
}

// ─── React state layer ────────────────────────────────────────────────────────

export interface CommitProgress {
  batchId: string;
  done: number;
  total: number;
}

export interface State extends JournalData {
  ready: boolean;
  commitProgress: CommitProgress | null;
}
const empty = (): State => ({ ready: false, commitProgress: null, trips: [], legs: [], stays: [], events: [], films: [], episodes: [], books: [], series: [], notes: [], staging: [], people: [], places: [] });
const SERVER = empty();
let state: State = empty();
const listeners = new Set<() => void>();
function emit(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

// ─── Geo helpers ─────────────────────────────────────────────────────────────

function hasPlace(e: Entry): boolean {
  if (e.kind === "leg") return !!(e.from || e.to || e.overrides?.from || e.overrides?.to);
  if (e.kind === "film" || e.kind === "episode" || e.kind === "book") return false;
  return !!(e.city || e.overrides?.city || (e.kind === "stay" && (e.place || e.overrides?.place)));
}

function hasJournalPlaces(data: Partial<JournalData>): boolean {
  return (
    [...(data.legs ?? []), ...(data.stays ?? []), ...(data.events ?? [])].some(hasPlace) ||
    (data.staging ?? []).some((batch) => batch.records.some((record) => hasPlace(record.entry)))
  );
}

// ─── Public API (unchanged signatures) ───────────────────────────────────────

let initPromise: Promise<void> | undefined;

export function initJournal(): Promise<void> {
  initPromise ??= (async () => {
    const data: Partial<State> = {};
    for (const s of STORES) (data as Record<string, unknown>)[s] = await adapter.getAll(s);
    if (hasJournalPlaces(data)) {
      await loadStations();
    }
    emit({ ...data, ready: true });
  })().catch((error: unknown) => {
    initPromise = undefined;
    throw error;
  });
  return initPromise;
}

export function useJournal(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => SERVER,
  );
}

export function getState() {
  return state;
}

type DbRow = { id: string };
/** Update the in-progress commit indicator. Pass null to clear. */
export function setCommitProgress(progress: CommitProgress | null): void {
  emit({ commitProgress: progress });
}

export async function putMany(store: StoreName, items: (DbRow & Record<string, any>)[] | any[]) {
  if (!items.length) return;
  if ((store === "legs" || store === "stays" || store === "events") && (items as Entry[]).some(hasPlace)) await loadStations();
  if (store === "staging" && (items as StagingBatch[]).some((batch) => batch.records.some((record) => hasPlace(record.entry)))) await loadStations();
  await adapter.putMany(store, items);
  const map = new Map((state[store] as DbRow[]).map((r) => [r.id, r]));
  items.forEach((i) => map.set(i.id, i));
  emit({ [store]: [...map.values()] } as Partial<State>);
}

export async function removeMany(store: StoreName, ids: string[]) {
  await adapter.removeMany(store, ids);
  const set = new Set(ids);
  emit({ [store]: (state[store] as DbRow[]).filter((r) => !set.has(r.id)) } as Partial<State>);
}

export async function replaceAll(data: JournalData) {
  if (hasJournalPlaces(data)) await loadStations();
  await adapter.replaceAll(data);
  emit({ ...data });
}

export async function clearAll() {
  await replaceAll({ trips: [], legs: [], stays: [], events: [], films: [], episodes: [], books: [], series: [], notes: [], staging: [], people: [], places: [] });
}

export type { PlaceRecord };

export function storeFor(e: Entry): StoreName {
  if (e.kind === "leg") return "legs";
  if (e.kind === "stay") return "stays";
  if (e.kind === "film") return "films";
  if (e.kind === "episode") return "episodes";
  if (e.kind === "book") return "books";
  return "events";
}

export function allEntries(s: JournalData): Entry[] {
  return [...s.legs, ...s.stays, ...s.events, ...s.films, ...s.episodes, ...s.books];
}
