/**
 * WP4 of docs/specs/merge-dedup.md: manual merge and undo (section 4.7).
 * mergeManual and undoMerge run against an in-memory StorageAdapter that can be made to fail.
 */
import { describe, test, expect, beforeEach, vi } from "vitest";

vi.mock("../artworkEnrichment", () => ({ enrichAll: vi.fn(async () => {}) }));

import { importFile } from "../import";
import {
  setAdapter, initJournal, getState, allEntries, allHiddenEntries, putMany, mergeManual, undoMerge,
} from "../db";
import type { StorageAdapter, Row } from "../storage";
import { STORES, emptyJournalData, type JournalData, type StoreName, type Leg, type Stay } from "../types";
import viaductCsv from "../connectors/viaduct/fixtures/sample.csv?raw";

class MemoryAdapter implements StorageAdapter {
  data = new Map<string, Map<string, Row>>();
  /** Throws before anything is written, like a transaction that rolls back. */
  failNextPut = false;
  private table(store: string) {
    if (!this.data.has(store)) this.data.set(store, new Map());
    return this.data.get(store)!;
  }
  async getAll<T extends Row>(store: StoreName): Promise<T[]> {
    return structuredClone([...this.table(store).values()]) as T[];
  }
  async putMany<T extends Row>(store: StoreName, items: T[]): Promise<void> {
    if (this.failNextPut) { this.failNextPut = false; throw new Error("disk full"); }
    for (const i of items) this.table(store).set(i.id, structuredClone(i));
  }
  async removeMany(store: StoreName, ids: string[]): Promise<void> {
    for (const id of ids) this.table(store).delete(id);
  }
  async replaceAll(data: JournalData): Promise<void> {
    this.data.clear();
    for (const s of STORES) for (const r of (data[s] ?? []) as Row[]) this.table(s).set(r.id, structuredClone(r));
  }
  async clearAll(): Promise<void> {
    await this.replaceAll(emptyJournalData());
  }
  stored<T extends Row>(store: StoreName, id: string): T | undefined {
    return this.table(store).get(id) as T | undefined;
  }
}

let mem: MemoryAdapter;
beforeEach(async () => {
  mem = new MemoryAdapter();
  setAdapter(mem);
  await initJournal();
});

const legs = () => getState().legs;
const byId = (id: string) => legs().find((l) => l.id === id)!;

let n = 0;
const leg = (over: Partial<Leg> = {}): Leg => {
  n += 1;
  return {
    id: `leg${n}`, kind: "leg", source: "icalendar", sourceRef: `cal.ics#row${n}`, mode: "air",
    from: "DUB", to: "LHR", start: "2026-03-01T09:00", dedupeKey: `leg|2026-03-01|DUB|LHR#${n}`,
    createdAt: "2026-03-01T10:00:00.000Z", ...over,
  };
};

/** A base and another leg from a different source that holds details the base lacks. */
async function seedPair() {
  const base = leg({ id: "base", reflection: "mine", tripId: "t1", unreviewed: "new", importNotes: ["check me"] });
  const other = leg({ id: "other", source: "flightradar24", sourceRef: "fr.csv#row2", operator: "Aer Lingus", seat: "12A", unreviewed: "new" });
  await putMany("legs", [base, other]);
  return { base: byId("base"), other: byId("other") };
}

describe("mergeManual", () => {
  test("the base keeps its id and source and gains what it lacked", async () => {
    const { base, other } = await seedPair();
    const res = await mergeManual(base.id, other.id);
    expect(res.ok).toBe(true);
    const after = byId(base.id);
    expect([after.id, after.source, after.sourceRef]).toEqual([base.id, base.source, base.sourceRef]);
    expect(after.operator).toBe("Aer Lingus");
    expect(after.seat).toBe("12A");
    expect(after.reflection).toBe("mine");
    expect(after.tripId).toBe("t1");
    expect(after.mergedFrom).toEqual([other.id]);
    expect(after.additionalSources).toEqual([{ source: "flightradar24", sourceRef: "fr.csv#row2" }]);
    // a manual merge records provenance, not split data
    expect(after.absorbed).toBeUndefined();
    expect(after.fieldSources).toBeUndefined();
  });

  test("merging is a user action: the base's review flags are cleared", async () => {
    const { base, other } = await seedPair();
    await mergeManual(base.id, other.id);
    const after = byId(base.id);
    expect(after.unreviewed).toBeUndefined();
    expect(after.importNotes).toBeUndefined();
  });

  test("the other becomes a hidden twin that keeps its key and remembers the base as it was", async () => {
    const { base, other } = await seedPair();
    await mergeManual(base.id, other.id);
    expect(allEntries(getState()).map((e) => e.id)).toEqual([base.id]);
    const twin = allHiddenEntries(getState())[0] as Leg;
    expect(twin.id).toBe(other.id);
    expect(twin.hidden).toBe(true);
    expect(twin.dedupeKey).toBe(other.dedupeKey);
    expect(twin.unreviewed).toBeUndefined();
    expect(twin.mergedInto?.id).toBe(base.id);
    expect(twin.mergedInto?.baseBefore).toEqual(base);
  });

  test("both rows are persisted", async () => {
    const { base, other } = await seedPair();
    await mergeManual(base.id, other.id);
    expect(mem.stored<Leg>("legs", base.id)!.mergedFrom).toEqual([other.id]);
    expect(mem.stored<Leg>("legs", other.id)!.hidden).toBe(true);
  });

  test("a failed write leaves both entries and the journal untouched", async () => {
    const { base, other } = await seedPair();
    mem.failNextPut = true;
    await expect(mergeManual(base.id, other.id)).rejects.toThrow("disk full");
    expect(byId(base.id)).toEqual(base);
    expect(byId(other.id)).toEqual(other);
    expect(mem.stored<Leg>("legs", base.id)).toEqual(base);
    expect(mem.stored<Leg>("legs", other.id)).toEqual(other);
    expect(allHiddenEntries(getState())).toHaveLength(0);
  });

  test("refuses entries of different kinds, the same entry, and entries that are gone", async () => {
    const { base } = await seedPair();
    const stay: Stay = {
      id: "stay1", kind: "stay", source: "icalendar", place: "Hotel", start: "2026-03-01", dedupeKey: "stay|2026-03-01|hotel",
      createdAt: "2026-03-01T10:00:00.000Z",
    };
    await putMany("stays", [stay]);
    expect(await mergeManual(base.id, stay.id)).toMatchObject({ ok: false, reason: expect.stringContaining("same kind") });
    expect(await mergeManual(base.id, base.id)).toMatchObject({ ok: false });
    expect(await mergeManual(base.id, "nope")).toMatchObject({ ok: false });
    expect(allHiddenEntries(getState())).toHaveLength(0);
  });

  test("re-importing the twin's source row does not bring it back", async () => {
    await importFile("sample.csv", viaductCsv, { forced: "viaduct" });
    const [a, b] = legs();
    await mergeManual(a.id, b.id);
    const again = await importFile("sample.csv", viaductCsv, { forced: "viaduct" });
    expect(again.skipped.removed).toBe(1);
    expect(again.added).toBe(0);
    expect(allEntries(getState())).toHaveLength(3);
  });

  test("a later refresh from the base's own source still works and keeps the merge link", async () => {
    await importFile("sample.csv", viaductCsv, { forced: "viaduct" });
    const [a, b] = legs();
    await putMany("legs", [{ ...a, operator: "Stale operator", unreviewed: undefined }]);
    await mergeManual(a.id, b.id);
    const res = await importFile("sample.csv", viaductCsv, { forced: "viaduct" });
    expect(res.updated).toBe(1);
    const after = byId(a.id);
    expect(after.source).toBe("viaduct");
    expect(after.operator).not.toBe("Stale operator");
    expect(after.mergedFrom).toEqual([b.id]);
    expect(after.additionalSources).toEqual(expect.arrayContaining([expect.objectContaining({ source: "viaduct" })]));
  });
});

describe("undoMerge", () => {
  test("puts the base back exactly as it was and brings the twin back", async () => {
    const { base, other } = await seedPair();
    await mergeManual(base.id, other.id);
    const res = await undoMerge(other.id);
    expect(res).toEqual({ ok: true });
    expect(byId(base.id)).toEqual(base);
    const twin = byId(other.id);
    expect(twin.hidden).toBeUndefined();
    expect(twin.mergedInto).toBeUndefined();
    expect(twin.dedupeKey).toBe(other.dedupeKey);
    expect(twin.operator).toBe("Aer Lingus");
    expect(allEntries(getState()).map((e) => e.id).sort()).toEqual(["base", "other"]);
    expect(mem.stored<Leg>("legs", base.id)).toEqual(base);
  });

  test("merges into the same base undo newest first", async () => {
    const base = leg({ id: "base" });
    const x = leg({ id: "x", source: "fr", operator: "Aer Lingus" });
    const y = leg({ id: "y", source: "wallet", seat: "12A" });
    await putMany("legs", [base, x, y]);
    await mergeManual("base", "x");
    const afterX = byId("base");
    await mergeManual("base", "y");
    expect(byId("base").mergedFrom).toEqual(["x", "y"]);
    // the earlier merge cannot be undone while a later one sits on top of it
    expect(await undoMerge("x")).toMatchObject({ ok: false, reason: expect.stringContaining("Undo that one first") });
    expect(allEntries(getState()).map((e) => e.id)).toEqual(["base"]);
    expect((await undoMerge("y")).ok).toBe(true);
    expect(byId("base")).toEqual(afterX);
    expect((await undoMerge("x")).ok).toBe(true);
    expect(byId("base").mergedFrom).toBeUndefined();
    expect(byId("base").operator).toBeUndefined();
  });

  test("if the base has since been deleted the twin simply comes back", async () => {
    const { base, other } = await seedPair();
    await mergeManual(base.id, other.id);
    const { removeMany } = await import("../db");
    await removeMany("legs", [base.id]);
    expect(await undoMerge(other.id)).toEqual({ ok: true });
    expect(allEntries(getState()).map((e) => e.id)).toEqual([other.id]);
  });

  test("refuses an entry that was not merged into another", async () => {
    const { other } = await seedPair();
    expect(await undoMerge(other.id)).toMatchObject({ ok: false });
    expect(await undoMerge("nope")).toMatchObject({ ok: false });
  });

  test("a failed undo leaves the merge in place", async () => {
    const { base, other } = await seedPair();
    await mergeManual(base.id, other.id);
    const merged = byId(base.id);
    mem.failNextPut = true;
    await expect(undoMerge(other.id)).rejects.toThrow("disk full");
    expect(byId(base.id)).toEqual(merged);
    expect(allHiddenEntries(getState()).map((e) => e.id)).toEqual([other.id]);
  });
});
