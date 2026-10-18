import { useSyncExternalStore } from "react";
import { STORES, emptyJournalData, type JournalData, type StoreName, type Entry, type JEvent, type Leg, type Stay, type GazetteerEntry, type ImportRun, type Trip, type PlaceEntry } from "./types";
import { KIND_REGISTRY } from "./kinds";
import { migrateEntryEvaluation, migrateTripEvaluation } from "./evaluation";
import { loadStations } from "./geo";
import type { StorageAdapter, Row } from "./storage";

// ─── IndexedDB implementation ─────────────────────────────────────────────────

const DB_NAME = "waypoint-journal";
// v8: DM4, removed placeEvents store, renamed places→gazetteer
// v9: auto-import, added the importRuns store (the new Base fields are optional, so no backfill)
// v10: removed the staging store (WP15)
const DB_VERSION = 10;

/** The slice of IDBDatabase that the upgrade needs. Lets tests run it without a browser. */
export interface UpgradableDB {
  objectStoreNames: { contains(name: string): boolean };
  createObjectStore(name: string, options?: { keyPath?: string }): unknown;
  deleteObjectStore(name: string): void;
}

/**
 * Brings an IndexedDB database up to the current schema. Idempotent: running it
 * again on an up-to-date database changes nothing. Runs inside onupgradeneeded.
 */
export function applyUpgrade(db: UpgradableDB, oldVersion: number): void {
  // Create any missing stores (covers fresh installs and every upgrade, including v9 importRuns)
  for (const s of STORES) {
    if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: "id" });
  }
  // v8: remove legacy stores
  if (oldVersion < 8) {
    if (db.objectStoreNames.contains("placeEvents")) db.deleteObjectStore("placeEvents");
    if (db.objectStoreNames.contains("places")) db.deleteObjectStore("places");
  }
  // v10: drop the staging store (WP15)
  if (oldVersion < 10) {
    if (db.objectStoreNames.contains("staging")) db.deleteObjectStore("staging");
  }
}

/**
 * MIGRATION RULE (DM10 — go-live gate)
 * Every change to a stored record shape after this point requires a migration:
 *   1. Bump DB_VERSION
 *   2. Add an onupgradeneeded handler in IDBAdapter for the new version
 *   3. Add a boot migration function (pattern: migrateLegStayKeys, migrateEventKeys, etc.)
 *   4. Add a corresponding migration in SQLiteAdapter
 *   5. Add a test that the migration is idempotent
 */

class IDBAdapter implements StorageAdapter {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private openDB(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (event) => {
          applyUpgrade(req.result, event.oldVersion);
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
    await this.replaceAll(emptyJournalData());
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
const empty = (): State => ({ ready: false, commitProgress: null, ...emptyJournalData() });
const SERVER = empty();
let state: State = empty();
const listeners = new Set<() => void>();
function emit(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

// ─── Geo helpers ─────────────────────────────────────────────────────────────

function hasPlace(e: Entry): boolean {
  return KIND_REGISTRY[e.kind].hasPlace(e);
}

function hasJournalPlaces(data: Partial<JournalData>): boolean {
  return [...(data.legs ?? []), ...(data.stays ?? []), ...(data.events ?? [])].some(hasPlace);
}

// ─── Public API (unchanged signatures) ───────────────────────────────────────

// ─── One-time dedupeKey migration ─────────────────────────────────────────────

/**
 * Recomputes Leg and Stay dedupeKeys from source-namespaced format
 * (e.g. "viaduct|leg|...") to source-agnostic format ("leg|...").
 * No-op on subsequent boots once all keys are already in the new format.
 * If the key change reveals true duplicates, the higher-precedence record
 * (lower tier, then reflection present, then earlier createdAt) is kept.
 */
async function migrateLegStayKeys(data: Partial<State>): Promise<void> {
  const legs = (data.legs ?? []) as Leg[];
  const stays = (data.stays ?? []) as Stay[];

  const staleLegIds = new Set(legs.filter((l) => !l.dedupeKey.startsWith("leg|")).map((l) => l.id));
  const staleStayIds = new Set(stays.filter((s) => !s.dedupeKey.startsWith("stay|")).map((s) => s.id));

  if (staleLegIds.size === 0 && staleStayIds.size === 0) return;

  // Recompute keys for stale records
  const updatedLegs = legs.map((l) =>
    staleLegIds.has(l.id)
      ? { ...l, dedupeKey: `leg|${l.start.slice(0, 10)}|${l.from.toUpperCase()}|${l.to.toUpperCase()}` }
      : l,
  );
  const updatedStays = stays.map((s) =>
    staleStayIds.has(s.id)
      ? { ...s, dedupeKey: `stay|${s.start.slice(0, 10)}|${s.place.toLowerCase()}` }
      : s,
  );

  // If two records now share a key, keep the better one
  function pick<T extends { id: string; tier: number; reflection?: string; createdAt: string }>(
    items: T[],
  ): { keep: T; discard: T[] } {
    if (items.length === 1) return { keep: items[0], discard: [] };
    const sorted = [...items].sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier; // lower tier = higher precedence
      const aHasRef = !!a.reflection;
      const bHasRef = !!b.reflection;
      if (aHasRef !== bHasRef) return aHasRef ? -1 : 1;
      return a.createdAt < b.createdAt ? -1 : 1;
    });
    return { keep: sorted[0], discard: sorted.slice(1) };
  }

  const legByKey = new Map<string, Leg[]>();
  for (const l of updatedLegs) (legByKey.get(l.dedupeKey) ?? legByKey.set(l.dedupeKey, []).get(l.dedupeKey)!).push(l);

  const stayByKey = new Map<string, Stay[]>();
  for (const s of updatedStays) (stayByKey.get(s.dedupeKey) ?? stayByKey.set(s.dedupeKey, []).get(s.dedupeKey)!).push(s);

  const legWrites: Leg[] = [];
  const legRemoveIds: string[] = [];
  for (const group of legByKey.values()) {
    const hasStale = group.some((l) => staleLegIds.has(l.id));
    if (!hasStale) continue; // no key change in this group, nothing to write
    const { keep, discard } = pick(group);
    legWrites.push(keep);
    legRemoveIds.push(...discard.map((l) => l.id));
  }

  const stayWrites: Stay[] = [];
  const stayRemoveIds: string[] = [];
  for (const group of stayByKey.values()) {
    const hasStale = group.some((s) => staleStayIds.has(s.id));
    if (!hasStale) continue;
    const { keep, discard } = pick(group);
    stayWrites.push(keep);
    stayRemoveIds.push(...discard.map((s) => s.id));
  }

  if (legWrites.length) await adapter.putMany("legs", legWrites);
  if (legRemoveIds.length) await adapter.removeMany("legs", legRemoveIds);
  if (stayWrites.length) await adapter.putMany("stays", stayWrites);
  if (stayRemoveIds.length) await adapter.removeMany("stays", stayRemoveIds);

  // Update data in-place so the subsequent emit reflects the migrated state
  const discardLegs = new Set(legRemoveIds);
  const discardStays = new Set(stayRemoveIds);
  const legWriteMap = new Map(legWrites.map((l) => [l.id, l]));
  const stayWriteMap = new Map(stayWrites.map((s) => [s.id, s]));
  data.legs = updatedLegs.filter((l) => !discardLegs.has(l.id)).map((l) => legWriteMap.get(l.id) ?? l);
  data.stays = updatedStays.filter((s) => !discardStays.has(s.id)).map((s) => stayWriteMap.get(s.id) ?? s);
}

/**
 * Recomputes JEvent dedupeKeys from source-namespaced format
 * (e.g. "setlistfm|event|...") to source-agnostic format ("event|...").
 * No-op on subsequent boots once all keys already start with "event|".
 * If the key change reveals true duplicates (same date+artist from two sources),
 * the higher-precedence record (lower tier, then reflection present, then
 * earlier createdAt) is kept.
 */
async function migrateEventKeys(data: Partial<State>): Promise<void> {
  const events = (data.events ?? []) as JEvent[];

  const staleIds = new Set(
    events
      .filter((e) => e.dedupeKey.includes("|event|") && !e.dedupeKey.startsWith("event|"))
      .map((e) => e.id),
  );

  if (staleIds.size === 0) return;

  const updatedEvents = events.map((e) =>
    staleIds.has(e.id)
      ? { ...e, dedupeKey: `event|${e.start.slice(0, 10)}|${e.artist.toLowerCase()}` }
      : e,
  );

  function pickBest<T extends { id: string; tier: number; reflection?: string; createdAt: string }>(
    items: T[],
  ): { keep: T; discard: T[] } {
    if (items.length === 1) return { keep: items[0], discard: [] };
    const sorted = [...items].sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      const aHasRef = !!a.reflection;
      const bHasRef = !!b.reflection;
      if (aHasRef !== bHasRef) return aHasRef ? -1 : 1;
      return a.createdAt < b.createdAt ? -1 : 1;
    });
    return { keep: sorted[0], discard: sorted.slice(1) };
  }

  const byKey = new Map<string, JEvent[]>();
  for (const e of updatedEvents) {
    (byKey.get(e.dedupeKey) ?? byKey.set(e.dedupeKey, []).get(e.dedupeKey)!).push(e);
  }

  const writes: JEvent[] = [];
  const removeIds: string[] = [];
  for (const group of byKey.values()) {
    const hasStale = group.some((e) => staleIds.has(e.id));
    if (!hasStale) continue;
    const { keep, discard } = pickBest(group);
    writes.push(keep);
    removeIds.push(...discard.map((e) => e.id));
  }

  if (writes.length) await adapter.putMany("events", writes);
  if (removeIds.length) await adapter.removeMany("events", removeIds);

  const discardSet = new Set(removeIds);
  const writeMap = new Map(writes.map((e) => [e.id, e]));
  data.events = updatedEvents.filter((e) => !discardSet.has(e.id)).map((e) => writeMap.get(e.id) ?? e);
}

/**
 * Migrate old `sourceLocked: ["reflection"]` entries: move `reflection` → `review`,
 * clear `reflection`, remove `"reflection"` from `sourceLocked`.
 * Idempotent — entries without the old "reflection" lock are untouched.
 */
async function migrateReviewReflection(data: Partial<State>): Promise<void> {
  const entryStores = ["legs", "stays", "events", "films", "episodes", "books", "placeEntries"] as const;
  for (const store of entryStores) {
    const rows = (data[store] ?? []) as Entry[];
    const changed: Entry[] = [];
    const next = rows.map((e) => {
      const locked = (e.sourceLocked as string[] | undefined) ?? [];
      if (!locked.includes("reflection")) return e;
      const updated = {
        ...e,
        review: e.review ?? e.reflection,
        reflection: undefined,
        sourceLocked: locked.filter((f) => f !== "reflection") as ("rating")[],
      };
      if (updated.sourceLocked.length === 0) updated.sourceLocked = undefined as unknown as ("rating")[];
      changed.push(updated as Entry);
      return updated as Entry;
    });
    if (changed.length) {
      await adapter.putMany(store, changed);
      (data as Record<string, unknown>)[store] = next;
    }
  }
}

/**
 * Rating + reflection are the universal evaluation fields. Folds legacy
 * `journal` into `reflection`, `Trip.notes` into `Trip.reflection`, and infers
 * source locks. Idempotent: no writes once every record is normalised.
 */
async function migrateEvaluationFields(data: Partial<State>): Promise<void> {
  const entryStores = ["legs", "stays", "events", "films", "episodes", "books", "placeEntries"] as const;
  for (const store of entryStores) {
    const rows = (data[store] ?? []) as Entry[];
    const changed: Entry[] = [];
    const next = rows.map((e) => {
      const m = migrateEntryEvaluation(e);
      if (m) changed.push(m);
      return m ?? e;
    });
    if (changed.length) {
      await adapter.putMany(store, changed);
      (data as Record<string, unknown>)[store] = next;
    }
  }
  const trips = (data.trips ?? []) as Trip[];
  const changedTrips: Trip[] = [];
  const nextTrips = trips.map((t) => {
    const m = migrateTripEvaluation(t);
    if (m) changedTrips.push(m);
    return m ?? t;
  });
  if (changedTrips.length) {
    await adapter.putMany("trips", changedTrips);
    data.trips = nextTrips;
  }
}

/**
 * WP12a: migrates legacy photo PlaceEntries to the auto-import model.
 *
 * Before WP12a, buildStagingPlan created entries with status "pending" (awaiting
 * user confirmation in the Staging Hub) or "dismissed" (rejected by the user).
 * After WP12a, new entries arrive as "accepted" and are flagged for review in
 * the feed (unreviewed: "new"), matching every other auto-imported source.
 *
 * Mapping (per spec §8 / D13):
 *   pending   -> accepted + unreviewed: "new"  (scan results the user has not yet reviewed)
 *   dismissed -> accepted + hidden: true       (user rejected them; stay hidden)
 *
 * No-op on subsequent boots: once all entries are "accepted" the filter finds nothing.
 * Exported for testing.
 */
export async function migratePhotoPlaceEntries(data: Partial<State>): Promise<void> {
  const entries = (data.placeEntries ?? []) as PlaceEntry[];
  const toMigrate = entries.filter(
    (e) => e.status === "pending" || e.status === "dismissed",
  );
  if (!toMigrate.length) return;

  const migrated: PlaceEntry[] = toMigrate.map((e): PlaceEntry => {
    if (e.status === "dismissed") {
      return { ...e, status: "accepted", hidden: true };
    }
    // pending -> accepted + unreviewed: "new"
    return { ...e, status: "accepted", unreviewed: "new" };
  });

  await adapter.putMany("placeEntries", migrated);
  const byId = new Map(migrated.map((e) => [e.id, e]));
  data.placeEntries = entries.map((e) => byId.get(e.id) ?? e);
}

/**
 * Closes import runs that were interrupted (app killed mid-import), which are
 * still "running" at boot. The counts are recomputed from the entries that carry
 * the run's id: every one of them was written by the run, and the ones it
 * replaced have a snapshot in `replaced`. Idempotent: once closed, a run is
 * never "running" again, so later boots write nothing.
 */
async function closeInterruptedRuns(data: Partial<State>): Promise<void> {
  const runs = (data.importRuns ?? []) as ImportRun[];
  const open = runs.filter((r) => r.status === "running");
  if (!open.length) return;
  const entryStores = ["legs", "stays", "events", "films", "episodes", "books", "placeEntries"] as const;
  const written = new Map<string, number>();
  for (const store of entryStores) {
    for (const e of (data[store] ?? []) as Entry[]) {
      if (e.importId) written.set(e.importId, (written.get(e.importId) ?? 0) + 1);
    }
  }
  const now = new Date().toISOString();
  const closed = open.map((r): ImportRun => {
    const total = written.get(r.id) ?? 0;
    const updated = Math.min(r.replaced.length, total);
    return { ...r, status: "done", added: total - updated, updated, finishedAt: now };
  });
  await adapter.putMany("importRuns", closed);
  const byId = new Map(closed.map((r) => [r.id, r]));
  data.importRuns = runs.map((r) => byId.get(r.id) ?? r);
}

let initPromise: Promise<void> | undefined;

export function initJournal(): Promise<void> {
  initPromise ??= (async () => {
    const data: Partial<State> = {};
    for (const s of STORES) (data as Record<string, unknown>)[s] = await adapter.getAll(s);
    if (hasJournalPlaces(data)) {
      await loadStations();
    }
    await migrateLegStayKeys(data);
    await migrateEventKeys(data);
    await migrateReviewReflection(data);
    await migrateEvaluationFields(data);
    await migratePhotoPlaceEntries(data);
    await closeInterruptedRuns(data);
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

/**
 * Soft-delete: marks entries as hidden without removing them from the DB.
 * Hiding is a user action, so it also clears `unreviewed` and `importNotes` (spec 4.1).
 */
export async function hideMany(store: StoreName, ids: string[]) {
  if (!ids.length) return;
  const set = new Set(ids);
  const hide = <T extends object>(r: T) => ({ ...stripReviewFlags(r), hidden: true as const });
  const toHide = (state[store] as DbRow[]).filter((r) => set.has(r.id)).map(hide);
  if (!toHide.length) return;
  await adapter.putMany(store, toHide);
  emit({ [store]: (state[store] as DbRow[]).map((r) => (set.has(r.id) ? hide(r) : r)) } as Partial<State>);
}

// ─── Review helpers (auto-import, spec 5.4 and 5.6) ───────────────────────────

const ENTRY_STORES = ["legs", "stays", "events", "films", "episodes", "books", "placeEntries"] as const satisfies readonly StoreName[];
const REVIEW_CHUNK = 100;

/** Removes the keys that mark an entry as awaiting review. `importId` stays: it is provenance. */
function stripReviewFlags<T extends object>(e: T): T {
  const { unreviewed: _u, importNotes: _n, ...rest } = e as T & { unreviewed?: unknown; importNotes?: unknown };
  return rest as T;
}

const hasReviewFlags = (e: Entry) => e.unreviewed !== undefined || e.importNotes !== undefined;

/**
 * The single write path for a user-authored change to an entry: a field edit, a
 * reflection, a rating, participants, a trip attach or detach, a merge. It clears
 * `unreviewed` and `importNotes`, because the user has now looked at the entry.
 * Imports and connectors never call this. (Hiding clears the flags inside
 * hideMany, which is the hide path.)
 */
export async function saveUserEdit(entry: Entry | Entry[]): Promise<void> {
  const list = Array.isArray(entry) ? entry : [entry];
  const byStore = new Map<StoreName, Entry[]>();
  for (const e of list) {
    const store = storeFor(e);
    const bucket = byStore.get(store);
    if (bucket) bucket.push(stripReviewFlags(e));
    else byStore.set(store, [stripReviewFlags(e)]);
  }
  for (const [store, items] of byStore) await putMany(store, items);
}

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Clears the review flags on every entry (in `stores`) that matches, in chunks. Returns the count. */
async function clearFlagsWhere(match: (e: Entry) => boolean, stores: readonly StoreName[] = ENTRY_STORES): Promise<number> {
  let count = 0;
  for (const store of stores) {
    const hits = (state[store] as Entry[]).filter((e) => hasReviewFlags(e) && match(e));
    for (let i = 0; i < hits.length; i += REVIEW_CHUNK) {
      await putMany(store, hits.slice(i, i + REVIEW_CHUNK).map(stripReviewFlags));
      if (i + REVIEW_CHUNK < hits.length) await yieldToUi();
    }
    count += hits.length;
  }
  return count;
}

/** The user kept these entries: clear their flags, change nothing else. */
export async function markReviewed(store: StoreName, ids: string[]): Promise<void> {
  const set = new Set(ids);
  await clearFlagsWhere((e) => set.has(e.id), [store]);
}

/** Keep all from one import. Returns how many entries were cleared. */
export async function markRunReviewed(runId: string): Promise<number> {
  return clearFlagsWhere((e) => e.importId === runId);
}

/** Settings: mark all new as read. Returns how many entries were cleared. */
export async function markAllReviewed(): Promise<number> {
  return clearFlagsWhere(() => true);
}

/**
 * Has the user changed this replaced entry since the import? Compared with the
 * snapshot taken before the import: a supersede keeps `overrides`, `reflection`,
 * `participants`, `tripId` and (unless the source locks it) `rating`, so any
 * difference there is the user's. A cleared flag alone (a plain "Keep") is not an edit.
 */
function editedSinceImport(current: Entry, before: Entry): boolean {
  if (current.hidden) return true; // hiding is a user action
  if (current.unreviewed !== undefined) return false; // still unseen, so untouched
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  if (!same(current.overrides, before.overrides)) return true;
  if (!same(current.reflection, before.reflection)) return true;
  if (!same(current.participants, before.participants)) return true;
  if (!same(current.tripId, before.tripId)) return true;
  if (!current.sourceLocked?.includes("rating") && !same(current.rating, before.rating)) return true;
  return false;
}

/**
 * Undo an import without deleting anything (spec 5.6).
 *  - Entries it added that are still unseen are hidden (they appear in Hidden Entries).
 *  - Entries it replaced go back to their prior version, unless the user has edited them since.
 *  - Anything the user has since reviewed or edited is kept.
 * The run becomes "undone". Undoing twice is a no-op.
 */
export async function undoRun(runId: string): Promise<{ hidden: number; restored: number; kept: number }> {
  const run = state.importRuns.find((r) => r.id === runId);
  if (!run || run.status === "undone") return { hidden: 0, restored: 0, kept: 0 };

  const replacedIds = new Set(run.replaced.map((r) => r.before.id));
  let hidden = 0;
  let restored = 0;
  let kept = 0;

  // Entries this run wrote. The ones it replaced are handled from their snapshots.
  for (const store of ENTRY_STORES) {
    const mine = (state[store] as Entry[]).filter((e) => e.importId === runId && !replacedIds.has(e.id) && !e.hidden);
    const unseen = mine.filter((e) => e.unreviewed === "new").map((e) => e.id);
    for (let i = 0; i < unseen.length; i += REVIEW_CHUNK) {
      await hideMany(store, unseen.slice(i, i + REVIEW_CHUNK));
    }
    hidden += unseen.length;
    kept += mine.length - unseen.length;
  }

  for (const { store, before } of run.replaced) {
    const current = (state[store] as Entry[]).find((e) => e.id === before.id);
    if (!current || editedSinceImport(current, before)) { kept++; continue; }
    await putMany(store, [before]);
    restored++;
  }

  await putMany("importRuns", [{ ...run, status: "undone" as const }]);
  return { hidden, restored, kept };
}

/** Restore soft-deleted entries by removing the hidden flag. */
export async function unhideMany(store: StoreName, ids: string[]) {
  if (!ids.length) return;
  const set = new Set(ids);
  const toUnhide = (state[store] as (DbRow & { hidden?: true })[])
    .filter((r) => set.has(r.id))
    .map((r) => { const { hidden: _h, ...rest } = r; return rest as DbRow & { hidden?: true }; });
  if (!toUnhide.length) return;
  await adapter.putMany(store, toUnhide);
  emit({ [store]: (state[store] as (DbRow & { hidden?: true })[]).map((r) => { if (!set.has(r.id)) return r; const { hidden: _h, ...rest } = r; return rest as DbRow & { hidden?: true }; }) } as Partial<State>);
}

export async function replaceAll(data: JournalData) {
  if (hasJournalPlaces(data)) await loadStations();
  await adapter.replaceAll(data);
  emit({ ...data });
}

export async function clearAll() {
  await replaceAll(emptyJournalData());
}

export type { GazetteerEntry };

export function storeFor(e: Entry): StoreName {
  return KIND_REGISTRY[e.kind].store;
}

export function allEntries(s: JournalData): Entry[] {
  return [
    ...s.legs, ...s.stays, ...s.events, ...s.films, ...s.episodes, ...s.books,
    ...(s.placeEntries ?? []).filter((e) => e.status === "accepted"), // WP10: pending/dismissed are staging items, not journal entries
  ].filter((e) => !e.hidden);
}

/** Returns every entry that has been soft-deleted (hidden: true), across all entry stores. */
export function allHiddenEntries(s: JournalData): Entry[] {
  return [
    ...s.legs, ...s.stays, ...s.events, ...s.films, ...s.episodes, ...s.books,
    ...(s.placeEntries ?? []),
  ].filter((e) => e.hidden === true);
}
