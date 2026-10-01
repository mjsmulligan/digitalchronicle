import { useSyncExternalStore } from "react";
import { STORES, type JournalData, type StoreName, type Entry, type PlaceRecord } from "./types";

const DB_NAME = "waypoint-journal";
const DB_VERSION = 5;

let dbPromise: Promise<IDBDatabase> | null = null;
function openDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx(stores: StoreName[], fn: (t: IDBTransaction) => void): Promise<void> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(stores, "readwrite");
        fn(t);
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
      }),
  );
}

async function getAll<T>(store: StoreName): Promise<T[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const r = db.transaction(store).objectStore(store).getAll();
    r.onsuccess = () => resolve(r.result as T[]);
    r.onerror = () => reject(r.error);
  });
}

export interface State extends JournalData {
  ready: boolean;
}
const empty = (): State => ({ ready: false, trips: [], legs: [], stays: [], events: [], films: [], episodes: [], books: [], series: [], notes: [], staging: [], people: [], places: [] });
const SERVER = empty();
let state: State = empty();
const listeners = new Set<() => void>();
function emit(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

let initPromise: Promise<void> | undefined;

export function initJournal(): Promise<void> {
  initPromise ??= (async () => {
    const data: Partial<State> = {};
    for (const s of STORES) (data as Record<string, unknown>)[s] = await getAll(s);
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

type Row = { id: string };
export async function putMany(store: StoreName, items: (Row & Record<string, any>)[] | any[]) {
  if (!items.length) return;
  await tx([store], (t) => items.forEach((i) => t.objectStore(store).put(i)));
  const map = new Map((state[store] as Row[]).map((r) => [r.id, r]));
  items.forEach((i) => map.set(i.id, i));
  emit({ [store]: [...map.values()] } as Partial<State>);
}

export async function removeMany(store: StoreName, ids: string[]) {
  await tx([store], (t) => ids.forEach((id) => t.objectStore(store).delete(id)));
  const set = new Set(ids);
  emit({ [store]: (state[store] as Row[]).filter((r) => !set.has(r.id)) } as Partial<State>);
}

export async function replaceAll(data: JournalData) {
  await tx([...STORES], (t) => {
    for (const s of STORES) {
      const os = t.objectStore(s);
      os.clear();
      ((data[s] ?? []) as Row[]).forEach((r) => os.put(r));
    }
  });
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
