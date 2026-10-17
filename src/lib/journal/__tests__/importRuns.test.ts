/**
 * WP1 of docs/specs/auto-import.md: data model and run store.
 *
 * Covers the importRuns store being part of every enumeration of stores
 * (IndexedDB upgrade, SQLite table SQL, backup export and restore) and the
 * new optional Base fields surviving serialisation and view().
 */
import { describe, test, expect } from "vitest";
import {
  STORES, emptyJournalData, view,
  type ImportRun, type Leg, type JournalData,
} from "../types";
import { applyUpgrade, type UpgradableDB } from "../db";
import { storeTableSql } from "../storage";
import { toBackupData, fromBackupData } from "../backup";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const leg = (over: Partial<Leg> = {}): Leg => ({
  id: "leg1", kind: "leg", source: "viaduct", tier: 2, mode: "rail",
  from: "Dublin Heuston", to: "Cork", start: "2026-03-01T09:00",
  dedupeKey: "leg|2026-03-01|DUBLIN HEUSTON|CORK", createdAt: "2026-03-01T10:00:00.000Z",
  ...over,
});

const run = (over: Partial<ImportRun> = {}): ImportRun => ({
  id: "run1", source: "viaduct", filename: "journeys.csv", trigger: "manual",
  startedAt: "2026-10-17T10:00:00.000Z", finishedAt: "2026-10-17T10:00:05.000Z",
  status: "done", added: 14, updated: 1,
  skipped: { duplicate: 230, inFile: 2, removed: 1 },
  errors: [], replaced: [{ store: "legs", before: leg({ id: "old1", rating: 7 }) }],
  ...over,
});

/** A stand-in for IDBDatabase that records what the upgrade did to it. */
function fakeDb(existing: string[]) {
  const names = new Set(existing);
  const calls = { created: [] as string[], deleted: [] as string[] };
  const db: UpgradableDB = {
    objectStoreNames: { contains: (n) => names.has(n) },
    createObjectStore: (n, opts) => {
      expect(opts).toEqual({ keyPath: "id" });
      names.add(n);
      calls.created.push(n);
    },
    deleteObjectStore: (n) => { names.delete(n); calls.deleted.push(n); },
  };
  return { db, names, calls };
}

// ─── Store registry ──────────────────────────────────────────────────────────

describe("importRuns store", () => {
  test("is registered and starts empty", () => {
    expect(STORES).toContain("importRuns");
    expect(emptyJournalData().importRuns).toEqual([]);
  });
});

// ─── IndexedDB upgrade (DB v9) ───────────────────────────────────────────────

describe("applyUpgrade", () => {
  const v8Stores = STORES.filter((s) => s !== "importRuns");

  test("v8 to v9 creates only importRuns", () => {
    const { db, names, calls } = fakeDb(v8Stores);
    applyUpgrade(db, 8);
    expect(calls.created).toEqual(["importRuns"]);
    expect(calls.deleted).toEqual([]);
    expect([...names].sort()).toEqual([...STORES].sort());
  });

  test("is idempotent: a second run changes nothing", () => {
    const { db, calls } = fakeDb(v8Stores);
    applyUpgrade(db, 8);
    const afterFirst = { created: [...calls.created], deleted: [...calls.deleted] };
    applyUpgrade(db, 8);
    applyUpgrade(db, 9);
    expect(calls.created).toEqual(afterFirst.created);
    expect(calls.deleted).toEqual(afterFirst.deleted);
  });

  test("fresh install creates every store", () => {
    const { db, names } = fakeDb([]);
    applyUpgrade(db, 0);
    expect([...names].sort()).toEqual([...STORES].sort());
  });

  test("still removes the legacy v7 stores when upgrading from before v8", () => {
    const { db, names, calls } = fakeDb(["placeEvents", "places", "legs"]);
    applyUpgrade(db, 7);
    expect(calls.deleted.sort()).toEqual(["placeEvents", "places"]);
    expect(names.has("placeEvents")).toBe(false);
    expect(names.has("places")).toBe(false);
    expect(names.has("legs")).toBe(true);
    expect(names.has("importRuns")).toBe(true);
  });

  test("does not delete anything on a v8 or later database", () => {
    const { db, calls } = fakeDb(v8Stores);
    applyUpgrade(db, 8);
    expect(calls.deleted).toEqual([]);
  });
});

// ─── SQLite table SQL ────────────────────────────────────────────────────────

describe("storeTableSql", () => {
  test("creates every store idempotently, including importRuns", () => {
    for (const store of STORES) {
      const sql = storeTableSql(store);
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS");
      expect(sql).toContain(`"${store}"`);
      expect(sql).toContain("id TEXT PRIMARY KEY NOT NULL");
    }
    expect(storeTableSql("importRuns")).toContain('"importRuns"');
  });
});

// ─── Backup ──────────────────────────────────────────────────────────────────

describe("backup helpers", () => {
  const withRun = (): JournalData => ({
    ...emptyJournalData(),
    legs: [leg({ unreviewed: "new", importId: "run1", importNotes: ["Possible duplicate"] })],
    importRuns: [run()],
  });

  test("round trip keeps importRuns, replaced snapshots and the new entry fields", () => {
    const original = withRun();
    const envelope = { app: "chronicle", schemaVersion: 1, exportedAt: "2026-10-17T10:00:00.000Z", data: toBackupData(original) };
    const restored = fromBackupData(JSON.parse(JSON.stringify(envelope)));
    expect(restored.importRuns).toEqual(original.importRuns);
    expect(restored.importRuns[0].replaced[0].before.rating).toBe(7);
    expect(restored.legs[0].unreviewed).toBe("new");
    expect(restored.legs[0].importId).toBe("run1");
    expect(restored.legs[0].importNotes).toEqual(["Possible duplicate"]);
    expect(restored).toEqual(original);
  });

  test("toBackupData covers every store and fills missing ones", () => {
    const data = toBackupData({ legs: [leg()] });
    for (const store of STORES) expect(Array.isArray((data as unknown as Record<string, unknown>)[store])).toBe(true);
    expect(data.importRuns).toEqual([]);
    expect(data.legs).toHaveLength(1);
  });

  test("an older backup without importRuns restores it as empty", () => {
    const old = { app: "chronicle", schemaVersion: 1, data: { legs: [leg()], trips: [] } };
    const restored = fromBackupData(old);
    expect(restored.importRuns).toEqual([]);
    expect(restored.legs).toHaveLength(1);
    expect(restored.placeBinMarkers).toEqual([]);
  });

  test("accepts the legacy envelope", () => {
    expect(fromBackupData({ version: 1, data: { legs: [leg()] } }).legs).toHaveLength(1);
  });

  test("rejects unsupported versions and files that are not backups", () => {
    expect(() => fromBackupData({ schemaVersion: 2, data: {} })).toThrow("Unsupported backup version");
    expect(() => fromBackupData({ schemaVersion: 1, data: { unrelated: [] } })).toThrow("Not a Chronicle backup");
    expect(() => fromBackupData({ schemaVersion: 1 })).toThrow("Not a Chronicle backup");
    expect(() => fromBackupData(null)).toThrow("Unsupported backup version");
  });
});

// ─── Entry fields ────────────────────────────────────────────────────────────

describe("new Base fields", () => {
  test("absent means reviewed", () => {
    const e = leg();
    expect(e.unreviewed).toBeUndefined();
    expect("unreviewed" in e).toBe(false);
  });

  test("survive JSON serialisation (what both adapters do)", () => {
    const e = leg({ unreviewed: "updated", importId: "run9", importNotes: ["a", "b"] });
    expect(JSON.parse(JSON.stringify(e))).toEqual(e);
  });

  test("survive view() with and without overrides", () => {
    const flagged = { unreviewed: "new" as const, importId: "run1", importNotes: ["note"] };
    const plain = view(leg(flagged));
    expect(plain.unreviewed).toBe("new");
    const overridden = view(leg({ ...flagged, overrides: { to: "Limerick" } }));
    expect(overridden.to).toBe("Limerick");
    expect(overridden.unreviewed).toBe("new");
    expect(overridden.importId).toBe("run1");
    expect(overridden.importNotes).toEqual(["note"]);
  });
});
