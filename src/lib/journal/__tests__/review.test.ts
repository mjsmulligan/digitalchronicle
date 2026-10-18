/**
 * WP4 of docs/specs/auto-import.md: review helpers.
 * markReviewed, markRunReviewed, markAllReviewed, undoRun, saveUserEdit, and
 * hide clearing the flags. Runs against an in-memory StorageAdapter.
 */
import { describe, test, expect, beforeEach, vi } from "vitest";

vi.mock("../artworkEnrichment", () => ({ enrichAll: vi.fn(async () => {}) }));

import { importFile } from "../import";
import {
  setAdapter, initJournal, getState, allEntries, allHiddenEntries, hideMany, unhideMany, putMany,
  saveUserEdit, markReviewed, markRunReviewed, markAllReviewed, undoRun,
} from "../db";
import type { StorageAdapter, Row } from "../storage";
import { STORES, emptyJournalData, type JournalData, type StoreName, type Leg, type ImportRun } from "../types";
import viaductCsv from "../connectors/viaduct/fixtures/sample.csv?raw";

class MemoryAdapter implements StorageAdapter {
  private data = new Map<string, Map<string, Row>>();
  puts: { store: StoreName; n: number }[] = [];
  private table(store: string) {
    if (!this.data.has(store)) this.data.set(store, new Map());
    return this.data.get(store)!;
  }
  async getAll<T extends Row>(store: StoreName): Promise<T[]> {
    return structuredClone([...this.table(store).values()]) as T[];
  }
  async putMany<T extends Row>(store: StoreName, items: T[]): Promise<void> {
    this.puts.push({ store, n: items.length });
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
const flagged = () => legs().filter((l) => l.unreviewed !== undefined);
const importSample = () => importFile("sample.csv", viaductCsv, { forced: "viaduct" });

/** A tier-3 copy of every leg, as left by a lower precedence source and already reviewed. */
async function downgradeAndReview() {
  await putMany("legs", legs().map((l) => {
    const { unreviewed: _u, importNotes: _n, ...rest } = l;
    return { ...rest, tier: 3 };
  }));
}

// ─── flag clearing ───────────────────────────────────────────────────────────

describe("the flag is cleared by user actions", () => {
  test("saveUserEdit clears unreviewed and importNotes, keeps importId, and persists", async () => {
    const res = await importSample();
    const target = { ...legs()[0], importNotes: ["Something to check"] } as Leg;
    await putMany("legs", [target]);

    await saveUserEdit({ ...target, reflection: "Lovely", rating: 8 });
    const after = legs().find((l) => l.id === target.id)!;
    expect(after.unreviewed).toBeUndefined();
    expect("unreviewed" in after).toBe(false);
    expect(after.importNotes).toBeUndefined();
    expect(after.importId).toBe(res.run!.id);
    expect(after.reflection).toBe("Lovely");
    expect(mem.stored<Leg>("legs", target.id)!.unreviewed).toBeUndefined();
    // The other three are untouched.
    expect(flagged()).toHaveLength(3);
  });

  test("saveUserEdit accepts a list and routes each entry to its own store", async () => {
    await importSample();
    await saveUserEdit(legs().slice(0, 2));
    expect(flagged()).toHaveLength(2);
  });

  test("hiding clears the flags, and unhiding returns a normal reviewed entry", async () => {
    await importSample();
    const target = legs()[0];
    await hideMany("legs", [target.id]);
    const hidden = allHiddenEntries(getState())[0];
    expect(hidden.id).toBe(target.id);
    expect(hidden.unreviewed).toBeUndefined();
    expect(mem.stored<Leg>("legs", target.id)!.unreviewed).toBeUndefined();

    await unhideMany("legs", [target.id]);
    const back = allEntries(getState()).find((e) => e.id === target.id)!;
    expect(back.unreviewed).toBeUndefined();
    expect(back.hidden).toBeUndefined();
  });

  test("markReviewed clears only the named entries", async () => {
    await importSample();
    const [a, b] = legs();
    await markReviewed("legs", [a.id, b.id]);
    expect(flagged().map((l) => l.id).sort()).toEqual(legs().filter((l) => l.id !== a.id && l.id !== b.id).map((l) => l.id).sort());
    expect(legs().find((l) => l.id === a.id)!.importId).toBeDefined();
  });
});

// ─── bulk ────────────────────────────────────────────────────────────────────

describe("markRunReviewed and markAllReviewed", () => {
  const second = [
    "Date,Origin,Destination,Departure time,Arrival time,Operator,Train number,Seat,Notes",
    "2026-09-01,Berlin Hbf,Munich Hbf,08:00,12:00,DB,ICE 1,,",
    "2026-09-02,Munich Hbf,Berlin Hbf,08:00,12:00,DB,ICE 2,,",
  ].join("\n");

  test("markRunReviewed clears one run and returns its count", async () => {
    const a = await importSample();
    const b = await importFile("more.csv", second, { forced: "viaduct" });
    expect(b.added).toBe(2);
    expect(await markRunReviewed(b.run!.id)).toBe(2);
    expect(flagged()).toHaveLength(4);
    expect(flagged().every((l) => l.importId === a.run!.id)).toBe(true);
    expect(await markRunReviewed(b.run!.id)).toBe(0);
  });

  test("markAllReviewed clears everything and returns the count", async () => {
    await importSample();
    await importFile("more.csv", second, { forced: "viaduct" });
    expect(await markAllReviewed()).toBe(6);
    expect(flagged()).toHaveLength(0);
    expect(await markAllReviewed()).toBe(0);
  });

  test("markAllReviewed writes in chunks of 100, across stores", async () => {
    const many: Leg[] = Array.from({ length: 250 }, (_, i) => ({
      id: `l${i}`, kind: "leg", source: "viaduct", tier: 2, mode: "rail", from: "A", to: "B",
      start: "2026-03-01T09:00", dedupeKey: `leg|${i}`, createdAt: "2026-03-01T10:00:00.000Z",
      unreviewed: "new", importId: "r", importNotes: ["n"],
    } as Leg));
    await putMany("legs", many);
    mem.puts = [];
    expect(await markAllReviewed()).toBe(250);
    expect(mem.puts.filter((p) => p.store === "legs").map((p) => p.n)).toEqual([100, 100, 50]);
    expect(flagged()).toHaveLength(0);
    expect(legs().every((l) => !("importNotes" in l))).toBe(true);
  });
});

// ─── undoRun ─────────────────────────────────────────────────────────────────

describe("undoRun", () => {
  test("hides untouched new entries, keeps edited and kept ones, and marks the run undone", async () => {
    const res = await importSample();
    const [edited, keptOne, hiddenByUser] = legs();
    await saveUserEdit({ ...edited, reflection: "Mine" });
    await markReviewed("legs", [keptOne.id]);
    await hideMany("legs", [hiddenByUser.id]);

    const out = await undoRun(res.run!.id);
    expect(out).toEqual({ hidden: 1, restored: 0, kept: 2 });

    const visible = allEntries(getState()).map((e) => e.id).sort();
    expect(visible).toEqual([edited.id, keptOne.id].sort());
    expect(allHiddenEntries(getState())).toHaveLength(2);
    const nowHidden = allHiddenEntries(getState()).find((e) => e.id !== hiddenByUser.id)!;
    expect(nowHidden.unreviewed).toBeUndefined();
    expect(getState().importRuns.find((r) => r.id === res.run!.id)!.status).toBe("undone");
    expect(mem.stored<ImportRun>("importRuns", res.run!.id)!.status).toBe("undone");
  });

  test("never deletes: every imported leg is still stored", async () => {
    const res = await importSample();
    await undoRun(res.run!.id);
    expect(legs()).toHaveLength(4);
    expect(allEntries(getState())).toHaveLength(0);
    expect(allHiddenEntries(getState())).toHaveLength(4);
  });

  test("a later import of the same file skips what an undo hid", async () => {
    const res = await importSample();
    await undoRun(res.run!.id);
    const again = await importSample();
    expect(again.run).toBeUndefined();
    expect(again.skipped.removed).toBe(4);
  });

  test("restores replaced entries to their prior version", async () => {
    await importSample();
    await downgradeAndReview();
    const res = await importSample(); // tier 2 now supersedes all four
    expect(res.updated).toBe(4);
    expect(legs().every((l) => l.unreviewed === "updated" && l.tier === 2)).toBe(true);

    const out = await undoRun(res.run!.id);
    expect(out).toEqual({ hidden: 0, restored: 4, kept: 0 });
    expect(legs().every((l) => l.tier === 3 && l.unreviewed === undefined)).toBe(true);
    expect(allEntries(getState())).toHaveLength(4);
  });

  test("a replaced entry the user edited after the import is kept as it is", async () => {
    await importSample();
    await downgradeAndReview();
    const res = await importSample();
    const [a, b, c] = legs();
    await saveUserEdit({ ...a, reflection: "Written after the update" });
    await saveUserEdit({ ...b, rating: 9 });
    await markReviewed("legs", [c.id]); // a plain Keep is not an edit

    const out = await undoRun(res.run!.id);
    expect(out).toEqual({ hidden: 0, restored: 2, kept: 2 });
    const byId = new Map(legs().map((l) => [l.id, l]));
    expect(byId.get(a.id)!.tier).toBe(2);
    expect(byId.get(a.id)!.reflection).toBe("Written after the update");
    expect(byId.get(b.id)!.tier).toBe(2);
    expect(byId.get(c.id)!.tier).toBe(3);
  });

  test("a replaced entry that was hidden afterwards stays hidden", async () => {
    await importSample();
    await downgradeAndReview();
    const res = await importSample();
    await hideMany("legs", [legs()[0].id]);
    const out = await undoRun(res.run!.id);
    expect(out.kept).toBe(1);
    expect(out.restored).toBe(3);
    expect(allHiddenEntries(getState())).toHaveLength(1);
  });

  test("a mix of new, replaced, edited and kept gives the right counts and data", async () => {
    await importSample();
    await downgradeAndReview();
    const extra = [
      "Date,Origin,Destination,Departure time,Arrival time,Operator,Train number,Seat,Notes",
      ...viaductCsv.trim().split("\n").slice(1),
      "2026-09-01,Berlin Hbf,Munich Hbf,08:00,12:00,DB,ICE 1,,",
      "2026-09-02,Munich Hbf,Berlin Hbf,08:00,12:00,DB,ICE 2,,",
      "2026-09-03,Munich Hbf,Hamburg Hbf,08:00,12:00,DB,ICE 3,,",
    ].join("\n");
    const res = await importFile("mix.csv", extra, { forced: "viaduct" });
    expect(res).toMatchObject({ added: 3, updated: 4 });

    const newOnes = legs().filter((l) => l.unreviewed === "new");
    await saveUserEdit({ ...newOnes[0], reflection: "keep me" });   // added then edited: kept
    const replaced = legs().filter((l) => l.unreviewed === "updated");
    await saveUserEdit({ ...replaced[0], rating: 7 });               // replaced then edited: kept

    const out = await undoRun(res.run!.id);
    expect(out).toEqual({ hidden: 2, restored: 3, kept: 2 });
    expect(allEntries(getState())).toHaveLength(4 + 1);
    expect(allHiddenEntries(getState())).toHaveLength(2);
  });

  test("undoing twice, or an unknown run, changes nothing", async () => {
    const res = await importSample();
    await undoRun(res.run!.id);
    expect(await undoRun(res.run!.id)).toEqual({ hidden: 0, restored: 0, kept: 0 });
    expect(await undoRun("nope")).toEqual({ hidden: 0, restored: 0, kept: 0 });
  });
});
