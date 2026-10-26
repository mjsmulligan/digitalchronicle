/**
 * WP8 of docs/specs/merge-dedup.md: splitting an auto-merge (section 4.8).
 */
import { describe, test, expect, beforeEach, vi } from "vitest";

vi.mock("../artworkEnrichment", () => ({ enrichAll: vi.fn(async () => {}) }));

import { importFile } from "../import";
import { setAdapter, initJournal, getState, allEntries, putMany, splitAbsorbed } from "../db";
import { rowHash } from "../split";
import { buildNearIndex, findNearMatches } from "../nearMatch";
import type { StorageAdapter, Row } from "../storage";
import { STORES, emptyJournalData, type JournalData, type StoreName, type Stay } from "../types";

class MemoryAdapter implements StorageAdapter {
  data = new Map<string, Map<string, Row>>();
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
  async replaceAll(d: JournalData): Promise<void> {
    this.data.clear();
    for (const s of STORES) for (const r of (d[s] ?? []) as Row[]) this.table(s).set(r.id, structuredClone(r));
  }
  async clearAll(): Promise<void> {
    await this.replaceAll(emptyJournalData());
  }
}

let mem: MemoryAdapter;
beforeEach(async () => {
  mem = new MemoryAdapter();
  setAdapter(mem);
  await initJournal();
});

const stays = () => getState().stays;
const header = "type,start,end,place,city,notes";
const csv = (...rows: string[]) => [header, ...rows].join("\n");
const IMPORT = (name: string, text: string) => importFile(name, text, { forced: "generic" });

/** Two rows with the same key in one file: the second fills the city. */
const sameFile = csv("stay,2026-10-12,2026-10-14,Hotel X,,", "stay,2026-10-12,2026-10-14,Hotel X,Paris,");

describe("splitAbsorbed after a same-file merge", () => {
  async function merged() {
    await IMPORT("cal.csv", sameFile);
    expect(stays()).toHaveLength(1);
    return stays()[0];
  }

  test("restores the original and makes a new entry from the row", async () => {
    const before = await merged();
    expect(before.city).toBe("Paris");
    expect(before.absorbed).toHaveLength(1);
    const row = before.absorbed![0];

    const res = await splitAbsorbed(before.id, row.source, row.sourceRef);
    expect(res.ok).toBe(true);
    expect(stays()).toHaveLength(2);

    const orig = stays().find((s) => s.id === before.id)!;
    expect(orig.city).toBeUndefined();
    expect(orig.absorbed).toBeUndefined();
    expect(orig.fieldSources).toBeUndefined();
    expect(orig.additionalSources).toBeUndefined();

    const created = stays().find((s) => s.id !== before.id)!;
    expect(created.city).toBe("Paris");
    expect(created.dedupeKey).toBe(before.dedupeKey);
    expect(created.sourceRef).toBe(row.sourceRef);
    expect(created.unreviewed).toBe("new");
    expect(created.separateRows).toEqual([rowHash(row.entry)]);
    expect(created.absorbed).toBeUndefined();
  });

  test("trip, people, overrides and reflection stay with the original", async () => {
    const before = await merged();
    await putMany("stays", [{ ...before, tripId: "t1", reflection: "lovely", participants: ["p1"], overrides: { place: "My Hotel" } } as Stay]);
    const row = stays()[0].absorbed![0];
    await splitAbsorbed(before.id, row.source, row.sourceRef);
    const orig = stays().find((s) => s.id === before.id)!;
    expect([orig.tripId, orig.reflection, orig.participants, orig.overrides]).toEqual(["t1", "lovely", ["p1"], { place: "My Hotel" }]);
    const created = stays().find((s) => s.id !== before.id)!;
    expect(created.tripId).toBeUndefined();
    expect(created.reflection).toBeUndefined();
  });

  test("a field the user changed since the merge is kept", async () => {
    const before = await merged();
    await putMany("stays", [{ ...before, city: "Lyon" } as Stay]);
    const row = stays()[0].absorbed![0];
    await splitAbsorbed(before.id, row.source, row.sourceRef);
    expect(stays().find((s) => s.id === before.id)!.city).toBe("Lyon");
  });

  test("re-importing the file does not merge the split row again", async () => {
    const before = await merged();
    const row = before.absorbed![0];
    await splitAbsorbed(before.id, row.source, row.sourceRef);
    const again = await IMPORT("cal.csv", sameFile);
    expect(again.added).toBe(0);
    expect(again.updated).toBe(0);
    expect(again.run).toBeUndefined();
    expect(stays()).toHaveLength(2);
    expect(stays().find((s) => s.id === before.id)!.absorbed).toBeUndefined();
  });

  test("it also holds when the file is renamed and the row moves", async () => {
    const before = await merged();
    const row = before.absorbed![0];
    await splitAbsorbed(before.id, row.source, row.sourceRef);
    const again = await IMPORT("renamed.csv", csv("stay,2026-10-12,2026-10-14,Hotel X,Paris,", "stay,2026-10-12,2026-10-14,Hotel X,,"));
    expect(stays()).toHaveLength(2);
    expect(again.added).toBe(0);
  });

  test("the pair is marked not a duplicate both ways and near match stays quiet", async () => {
    const before = await merged();
    const row = before.absorbed![0];
    const res = await splitAbsorbed(before.id, row.source, row.sourceRef);
    if (!res.ok) throw new Error("split failed");
    const orig = stays().find((s) => s.id === before.id)!;
    expect(orig.notDuplicateOf).toEqual([res.created.id]);
    expect(res.created.notDuplicateOf).toEqual([before.id]);
    expect(findNearMatches(orig, buildNearIndex(allEntries(getState())))).toEqual([]);
  });

  test("a hidden split entry stays hidden on re-import", async () => {
    const before = await merged();
    const row = before.absorbed![0];
    const res = await splitAbsorbed(before.id, row.source, row.sourceRef);
    if (!res.ok) throw new Error("split failed");
    await putMany("stays", [{ ...res.created, hidden: true } as Stay]);
    const again = await IMPORT("cal.csv", sameFile);
    expect(again.skipped.removed).toBe(1);
    expect(allEntries(getState())).toHaveLength(1);
  });
});

describe("splitAbsorbed after a cross-source enrich", () => {
  test("the other source's row becomes its own entry and the original is as before", async () => {
    await IMPORT("a.csv", csv("stay,2026-10-12,2026-10-14,Hotel X,,"));
    const first = stays()[0];
    // pretend the first row came from another source
    await putMany("stays", [{ ...first, source: "booking", sourceRef: "b.csv#row1" } as Stay]);
    const original = stays()[0];

    await IMPORT("a.csv", csv("stay,2026-10-12,2026-10-14,Hotel X,Paris,"));
    const merged = stays()[0];
    expect(merged.city).toBe("Paris");
    expect(merged.additionalSources).toEqual([{ source: "generic", sourceRef: "a.csv#row2" }]);
    expect(merged.unreviewed).toBe("new"); // still unseen, so it stays new

    const row = merged.absorbed![0];
    await splitAbsorbed(merged.id, row.source, row.sourceRef);
    const orig = stays().find((s) => s.id === original.id)!;
    expect(orig.city).toBeUndefined();
    expect(orig.source).toBe("booking");
    expect(orig.additionalSources).toBeUndefined();
    const created = stays().find((s) => s.id !== original.id)!;
    expect(created.source).toBe("generic");
    expect(created.city).toBe("Paris");

    const again = await IMPORT("a.csv", csv("stay,2026-10-12,2026-10-14,Hotel X,Paris,"));
    expect(again.run).toBeUndefined();
    expect(stays()).toHaveLength(2);
  });

  test("the original's own source can still refresh it after a split", async () => {
    await IMPORT("a.csv", sameFile);
    const before = stays()[0];
    const row = before.absorbed![0];
    await splitAbsorbed(before.id, row.source, row.sourceRef);
    await putMany("stays", [{ ...stays().find((s) => s.id === before.id)!, place: "Stale" } as Stay]);
    const res = await IMPORT("a.csv", sameFile);
    expect(res.updated).toBe(1);
    expect(stays().find((s) => s.id === before.id)!.place).toBe("Hotel X");
    expect(stays()).toHaveLength(2);
  });
});

describe("splitAbsorbed bookkeeping and failure", () => {
  test("splitting one of several rows keeps the others", async () => {
    await IMPORT("a.csv", csv("stay,2026-10-12,2026-10-14,Hotel X,,", "stay,2026-10-12,2026-10-14,Hotel X,Paris,", "stay,2026-10-12,2026-10-14,Hotel X,,note three"));
    const before = stays()[0];
    expect(before.absorbed).toHaveLength(2);
    const [r2, r3] = before.absorbed!;
    await splitAbsorbed(before.id, r2.source, r2.sourceRef);
    const orig = stays().find((s) => s.id === before.id)!;
    expect(orig.absorbed!.map((a) => a.sourceRef)).toEqual([r3.sourceRef]);
    expect(orig.additionalSources).toEqual([{ source: "generic", sourceRef: r3.sourceRef }]);
  });

  test("refuses an unknown entry or a row that is not absorbed", async () => {
    await IMPORT("a.csv", sameFile);
    const e = stays()[0];
    expect(await splitAbsorbed("nope", "generic", "x")).toMatchObject({ ok: false });
    expect(await splitAbsorbed(e.id, "generic", "other.csv#row9")).toMatchObject({ ok: false });
    expect(stays()).toHaveLength(1);
  });

  test("a failed write leaves the merged entry untouched", async () => {
    await IMPORT("a.csv", sameFile);
    const before = stays()[0];
    const row = before.absorbed![0];
    mem.failNextPut = true;
    await expect(splitAbsorbed(before.id, row.source, row.sourceRef)).rejects.toThrow("disk full");
    expect(stays()).toEqual([before]);
  });
});

describe("rowHash", () => {
  const base = { id: "a", kind: "stay", source: "generic", place: "Hotel X", start: "2026-10-12", dedupeKey: "k", createdAt: "x" } as unknown as Stay;
  test("ignores filename and user data, but not what the source said", () => {
    const h = rowHash(base);
    expect(rowHash({ ...base, sourceRef: "other.csv#row7", importId: "r", unreviewed: "new", tripId: "t", reflection: "mine" } as Stay)).toBe(h);
    expect(rowHash({ ...base, city: "Paris" } as Stay)).not.toBe(h);
    expect(rowHash({ ...base, source: "booking" } as Stay)).not.toBe(h);
  });
});
