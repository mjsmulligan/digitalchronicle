/**
 * WP3 of docs/specs/auto-import.md: the importFile orchestrator.
 *
 * Runs the real pipeline (connector parse, classify, writes, run record) against
 * an in-memory StorageAdapter, as classify.test.ts does.
 */
import { describe, test, expect, beforeEach, vi } from "vitest";

vi.mock("../artworkEnrichment", () => ({ enrichAll: vi.fn(async () => {}) }));

import { enrichAll } from "../artworkEnrichment";
import { importFile } from "../import";
import {
  setAdapter, initJournal, getState, allEntries, allHiddenEntries, hideMany, putMany, storeFor,
} from "../db";
import type { StorageAdapter, Row } from "../storage";
import {
  STORES, emptyJournalData, type JournalData, type StoreName, type Entry, type Leg, type ImportRun,
} from "../types";
import viaductCsv from "../connectors/viaduct/fixtures/sample.csv?raw";

// ─── In-memory adapter ───────────────────────────────────────────────────────

class MemoryAdapter implements StorageAdapter {
  data = new Map<string, Map<string, Row>>();
  /** Called before every putMany, so tests can observe state or inject failures. */
  onPut?: (store: StoreName, items: Row[]) => void;
  private table(store: string) {
    if (!this.data.has(store)) this.data.set(store, new Map());
    return this.data.get(store)!;
  }
  async getAll<T extends Row>(store: StoreName): Promise<T[]> {
    return structuredClone([...this.table(store).values()]) as T[];
  }
  async putMany<T extends Row>(store: StoreName, items: T[]): Promise<void> {
    this.onPut?.(store, items);
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
  rows<T extends Row>(store: StoreName): T[] {
    return [...this.table(store).values()] as T[];
  }
}

let mem: MemoryAdapter;

async function freshJournal() {
  mem = new MemoryAdapter();
  setAdapter(mem);
  await initJournal();
  vi.mocked(enrichAll).mockClear();
}

const runs = () => getState().importRuns;
const legs = () => getState().legs;

beforeEach(freshJournal);

// ─── new ─────────────────────────────────────────────────────────────────────

describe("importFile: new records", () => {
  test("writes every new record flagged new, with the run id, and persists a done run", async () => {
    const res = await importFile("sample.csv", viaductCsv, { forced: "viaduct" });
    expect(res.added).toBe(4);
    expect(res.updated).toBe(0);
    expect(res.skipped).toEqual({ duplicate: 0, inFile: 0, removed: 0 });

    const run = res.run!;
    expect(run.status).toBe("done");
    expect(run.trigger).toBe("manual");
    expect(run.source).toBe("viaduct");
    expect(run.filename).toBe("sample.csv");
    expect(run.added).toBe(4);
    expect(run.finishedAt).toBeDefined();
    expect(runs()).toHaveLength(1);
    expect(mem.rows<ImportRun>("importRuns")[0]).toMatchObject({ id: run.id, status: "done", added: 4 });

    expect(legs()).toHaveLength(4);
    for (const l of legs()) {
      expect(l.unreviewed).toBe("new");
      expect(l.importId).toBe(run.id);
      expect(l.sourceRef).toMatch(/^sample\.csv#row/);
    }
  });

  test("the run record exists before the first entry is written", async () => {
    let runStatusAtFirstEntryWrite: string | undefined;
    mem.onPut = (store) => {
      if (store === "legs" && runStatusAtFirstEntryWrite === undefined) {
        runStatusAtFirstEntryWrite = mem.rows<ImportRun>("importRuns")[0]?.status ?? "missing";
      }
    };
    await importFile("sample.csv", viaductCsv, { forced: "viaduct" });
    expect(runStatusAtFirstEntryWrite).toBe("running");
  });

  test("writes in chunks of 100", async () => {
    const rows = ["Date,Origin,Destination,Departure time,Arrival time,Operator,Train number,Seat,Notes"];
    for (let i = 0; i < 250; i++) {
      const d = new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10);
      rows.push(`${d},Berlin Hbf,Hamburg Hbf,09:34,11:20,DB,ICE 703,,`);
    }
    const sizes: number[] = [];
    mem.onPut = (store, items) => { if (store === "legs") sizes.push(items.length); };
    const res = await importFile("big.csv", rows.join("\n"), { forced: "viaduct" });
    expect(res.added).toBe(250);
    expect(sizes).toEqual([100, 100, 50]);
  });
});

// ─── duplicates and no-op ────────────────────────────────────────────────────

describe("importFile: re-import", () => {
  test("re-importing the same file changes nothing and leaves no run row", async () => {
    await importFile("sample.csv", viaductCsv, { forced: "viaduct" });
    const before = JSON.stringify(legs());
    const runsBefore = mem.rows("importRuns").length;
    const putsAfter: StoreName[] = [];
    mem.onPut = (store) => putsAfter.push(store);

    const res = await importFile("sample.csv", viaductCsv, { forced: "viaduct" });
    expect(res.run).toBeUndefined();
    expect(res.added).toBe(0);
    expect(res.updated).toBe(0);
    expect(res.skipped.duplicate).toBe(4);
    expect(putsAfter).toEqual([]);
    expect(mem.rows("importRuns")).toHaveLength(runsBefore);
    expect(JSON.stringify(legs())).toBe(before);
  });

  test("a repeated row inside one file is counted as inFile", async () => {
    const lines = viaductCsv.trim().split("\n");
    const doubled = [...lines, lines[1]].join("\n");
    const res = await importFile("dup.csv", doubled, { forced: "viaduct" });
    expect(res.added).toBe(4);
    expect(res.skipped.inFile).toBe(1);
    expect(legs()).toHaveLength(4);
  });
});

// ─── enrich and same-file duplicates ─────────────────────────────────────────

describe("importFile: enrich", () => {
  const ENRICH_FIELDS = { operator: undefined, seat: undefined, trainNumber: undefined };

  /** Stored legs as another source (a calendar) left them: reviewed, with gaps and user data. */
  async function seedOtherSource() {
    await importFile("sample.csv", viaductCsv, { forced: "viaduct" });
    const seeded = legs().map((l, i) => {
      const { unreviewed: _u, importNotes: _n, ...rest } = l;
      return {
        ...rest, ...ENRICH_FIELDS, source: "icalendar", sourceRef: `cal.ics#row${i + 1}`, reflection: undefined,
        ...(i === 0 ? { reflection: "Best train of the trip", tripId: "trip1", participants: ["p1"], overrides: { from: "Berlin" } as Leg["overrides"] } : {}),
      } as Leg;
    });
    await putMany("legs", seeded);
    return seeded;
  }

  test("a second source fills the gaps, keeps the base source, and records itself", async () => {
    const seeded = await seedOtherSource();
    const res = await importFile("sample.csv", viaductCsv, { forced: "viaduct" });
    expect(res.added).toBe(0);
    expect(res.updated).toBe(4);
    expect(legs()).toHaveLength(4);

    for (const before of seeded) {
      const after = legs().find((l) => l.id === before.id)!;
      expect(after.source).toBe("icalendar");
      expect(after.sourceRef).toBe(before.sourceRef);
      expect(after.operator).toBeTruthy();
      expect(after.trainNumber).toBeTruthy();
      expect(after.unreviewed).toBe("updated");
      expect(after.importId).toBe(res.run!.id);
      expect(after.additionalSources).toHaveLength(1);
      expect(after.additionalSources![0].source).toBe("viaduct");
      expect(after.additionalSources![0].sourceRef).toMatch(/^sample\.csv#row\d+$/);
      expect(after.absorbed).toHaveLength(1);
      expect(after.absorbed![0].entry.source).toBe("viaduct");
      expect(after.fieldSources!.operator).toBe(after.additionalSources![0].sourceRef);
    }
  });

  test("the user's id, reflection, trip, participants and overrides survive", async () => {
    const [first] = await seedOtherSource();
    await importFile("sample.csv", viaductCsv, { forced: "viaduct" });
    const after = legs().find((l) => l.id === first.id)!;
    expect(after.reflection).toBe("Best train of the trip");
    expect(after.tripId).toBe("trip1");
    expect(after.participants).toEqual(["p1"]);
    expect(after.overrides).toEqual({ from: "Berlin" });
  });

  test("a value the base already has is never overwritten", async () => {
    await seedOtherSource();
    await putMany("legs", legs().map((l) => ({ ...l, operator: "My operator" })));
    await importFile("sample.csv", viaductCsv, { forced: "viaduct" });
    expect(legs().every((l) => l.operator === "My operator")).toBe(true);
    // ...while the gaps next to it were still filled
    expect(legs().every((l) => !!l.trainNumber)).toBe(true);
  });

  test("importing the same file again changes nothing", async () => {
    await seedOtherSource();
    await importFile("sample.csv", viaductCsv, { forced: "viaduct" });
    const snapshot = JSON.stringify(legs());
    const again = await importFile("sample.csv", viaductCsv, { forced: "viaduct" });
    expect(again.run).toBeUndefined();
    expect(again.skipped.duplicate).toBe(4);
    expect(JSON.stringify(legs())).toBe(snapshot);
  });

  test("an entry that is still new stays new", async () => {
    const seeded = await seedOtherSource();
    await putMany("legs", seeded.map((l) => ({ ...l, unreviewed: "new" as const, importId: "earlier-run" })));
    await importFile("sample.csv", viaductCsv, { forced: "viaduct" });
    expect(legs().every((l) => l.unreviewed === "new")).toBe(true);
  });

  test("undoing the import puts the entries back as they were", async () => {
    const seeded = await seedOtherSource();
    const res = await importFile("sample.csv", viaductCsv, { forced: "viaduct" });
    expect(res.run!.replaced).toHaveLength(4);
    const { undoRun } = await import("../db");
    expect(await undoRun(res.run!.id)).toEqual({ hidden: 0, restored: 4, kept: 0 });
    for (const before of seeded) {
      const after = legs().find((l) => l.id === before.id)!;
      expect(after.operator).toBeUndefined();
      expect(after.additionalSources).toBeUndefined();
      expect(after.absorbed).toBeUndefined();
    }
  });

  test("a later refresh from the base's own source keeps what another source filled in", async () => {
    await seedOtherSource();
    await importFile("sample.csv", viaductCsv, { forced: "viaduct" });
    // The calendar now reports a new end time for the first leg.
    const first = legs()[0];
    const changed = { ...first, end: "2026-05-17T12:00" } as Leg;
    await putMany("legs", [changed]);
    const { refreshFromSource } = await import("../merge");
    const incoming = { ...first, end: "2026-05-17T13:30", operator: undefined, trainNumber: undefined, seat: undefined } as Leg;
    const refreshed = refreshFromSource(changed, incoming);
    expect(refreshed.end).toBe("2026-05-17T13:30");
    expect(refreshed.operator).toBe(first.operator);
    expect(refreshed.trainNumber).toBe(first.trainNumber);
    expect(refreshed.additionalSources).toEqual(first.additionalSources);
    expect(refreshed.fieldSources).toEqual(first.fieldSources);
  });
});

describe("importFile: same key twice in one file", () => {
  const header = "Date,Origin,Destination,Departure time,Arrival time,Operator,Train number,Seat,Notes";
  const csv = [
    header,
    "2026-05-17,Berlin Hbf,Hamburg Hbf,09:34,11:20,DB,ICE 703,,",
    "2026-05-17,Berlin Hbf,Hamburg Hbf,09:34,11:20,DB,ICE 703,Coach 5 / 61,",
  ].join("\n");

  test("the rows become one entry with both source references, and still count as inFile", async () => {
    const res = await importFile("dup.csv", csv, { forced: "viaduct" });
    expect(res.added).toBe(1);
    expect(res.skipped.inFile).toBe(1);
    expect(legs()).toHaveLength(1);
    const leg = legs()[0];
    expect(leg.seat).toBe("Coach 5 / 61"); // the gap the first row left
    expect(leg.additionalSources).toHaveLength(1);
    expect(leg.additionalSources![0].sourceRef).not.toBe(leg.sourceRef);
    expect(leg.absorbed).toHaveLength(1);
    expect(leg.fieldSources!.seat).toBe(leg.additionalSources![0].sourceRef);
  });

  test("where the rows disagree the first row's value is kept", async () => {
    const conflicting = [header, "2026-05-17,Berlin Hbf,Hamburg Hbf,09:34,11:20,DB,ICE 703,Coach 1,", "2026-05-17,Berlin Hbf,Hamburg Hbf,09:34,11:20,DB,ICE 703,Coach 9,"].join("\n");
    await importFile("dup.csv", conflicting, { forced: "viaduct" });
    expect(legs()[0].seat).toBe("Coach 1");
    expect(legs()[0].absorbed).toHaveLength(1);
  });

  test("importing the same file again is a no-op", async () => {
    await importFile("dup.csv", csv, { forced: "viaduct" });
    const snapshot = JSON.stringify(legs());
    const again = await importFile("dup.csv", csv, { forced: "viaduct" });
    expect(again.run).toBeUndefined();
    expect(JSON.stringify(legs())).toBe(snapshot);
  });

  test("a third row is absorbed too, and only the last five are kept", async () => {
    const rows = [header];
    for (let i = 0; i < 8; i++) rows.push(`2026-05-17,Berlin Hbf,Hamburg Hbf,09:34,11:20,DB,ICE 703,Coach ${i},`);
    const res = await importFile("many.csv", rows.join("\n"), { forced: "viaduct" });
    expect(res.added).toBe(1);
    expect(res.skipped.inFile).toBe(7);
    expect(legs()[0].additionalSources).toHaveLength(7);
    expect(legs()[0].absorbed).toHaveLength(5);
  });

  test("a hidden entry stays hidden, and its later rows are not merged anywhere", async () => {
    await importFile("dup.csv", csv, { forced: "viaduct" });
    await hideMany("legs", [legs()[0].id]);
    const res = await importFile("dup.csv", csv, { forced: "viaduct" });
    expect(res.run).toBeUndefined();
    expect(res.skipped.removed).toBe(1);
    expect(allHiddenEntries(getState())).toHaveLength(1);
  });
});

// ─── removed ─────────────────────────────────────────────────────────────────

describe("importFile: removed", () => {
  test("a hidden entry is skipped, counted, never written, never flagged", async () => {
    await importFile("sample.csv", viaductCsv, { forced: "viaduct" });
    const target = allEntries(getState())[0];
    await hideMany(storeFor(target), [target.id]);

    const res = await importFile("sample.csv", viaductCsv, { forced: "viaduct" });
    expect(res.run).toBeUndefined();
    expect(res.skipped).toEqual({ duplicate: 3, inFile: 0, removed: 1 });
    expect(allEntries(getState())).toHaveLength(3);
    expect(allHiddenEntries(getState()).map((e) => e.id)).toEqual([target.id]);
    expect(legs()).toHaveLength(4);
  });

  test("a hidden entry survives a file that also has new rows", async () => {
    await importFile("sample.csv", viaductCsv, { forced: "viaduct" });
    const target = allEntries(getState())[0];
    await hideMany(storeFor(target), [target.id]);

    const extra = `${viaductCsv.trim()}\n2026-09-01,Berlin Hbf,Munich Hbf,08:00,12:00,DB,ICE 1,,`;
    const res = await importFile("more.csv", extra, { forced: "viaduct" });
    expect(res.added).toBe(1);
    expect(res.skipped.removed).toBe(1);
    expect(legs().find((l) => l.id === target.id)?.hidden).toBe(true);
  });
});

// ─── refresh ─────────────────────────────────────────────────────────────────

describe("importFile: refresh", () => {
  const STALE = "Stale operator";

  async function seedStaleSource() {
    await importFile("sample.csv", viaductCsv, { forced: "viaduct" });
    const first = legs()[0] as Leg;
    // The user has reviewed this entry, edited it and written a reflection, and
    // the source has since changed a field (the operator), so a re-import refreshes it.
    const original: Leg = {
      ...first,
      operator: STALE,
      unreviewed: undefined,
      importNotes: undefined,
      reflection: "Best train of the trip",
      overrides: { from: "Berlin" } as Leg["overrides"],
      tripId: "trip1",
      participants: ["p1"],
    };
    delete original.unreviewed;
    delete original.importNotes;
    // Mark the other legs reviewed so only the refreshed one is of interest.
    await putMany("legs", [original, ...legs().slice(1).map((l) => { const { unreviewed: _u, ...r } = l; return r; })]);
    return original;
  }

  test("a reviewed entry becomes updated; id, trip, overrides, reflection and participants survive", async () => {
    const original = await seedStaleSource();
    const res = await importFile("sample.csv", viaductCsv, { forced: "viaduct" });

    expect(res.added).toBe(0);
    expect(res.updated).toBe(1);
    expect(res.skipped.duplicate).toBe(3);
    expect(legs()).toHaveLength(4);

    const after = legs().find((l) => l.id === original.id) as Leg;
    expect(after.unreviewed).toBe("updated");
    expect(after.importId).toBe(res.run!.id);
    expect(after.operator).not.toBe(STALE);
    expect(after.tripId).toBe("trip1");
    expect(after.overrides).toEqual(original.overrides);
    expect(after.reflection).toBe("Best train of the trip");
    expect(after.participants).toEqual(["p1"]);
  });

  test("the prior version is snapshotted in run.replaced, and persisted", async () => {
    const original = await seedStaleSource();
    const res = await importFile("sample.csv", viaductCsv, { forced: "viaduct" });
    expect(res.run!.updated).toBe(1);
    expect(res.run!.replaced).toHaveLength(1);
    expect(res.run!.replaced[0].store).toBe("legs");
    expect(res.run!.replaced[0].before).toMatchObject({ id: original.id, reflection: "Best train of the trip" });
    expect(mem.rows<ImportRun>("importRuns").find((r) => r.id === res.run!.id)!.replaced).toHaveLength(1);
  });

  test("an entry that is still new stays new", async () => {
    const original = await seedStaleSource();
    await putMany("legs", [{ ...original, unreviewed: "new", importId: "earlier-run" }]);
    const res = await importFile("sample.csv", viaductCsv, { forced: "viaduct" });
    const after = legs().find((l) => l.id === original.id)!;
    expect(after.unreviewed).toBe("new");
    expect(after.importId).toBe(res.run!.id);
  });

  test("caps replaced snapshots at 500 but still writes every update", async () => {
    // Reuse the chunk file shape: 520 rows, stored first with a stale operator, then refreshed.
    const rows = ["Date,Origin,Destination,Departure time,Arrival time,Operator,Train number,Seat,Notes"];
    for (let i = 0; i < 520; i++) {
      const d = new Date(Date.UTC(2019, 0, 1 + i)).toISOString().slice(0, 10);
      rows.push(`${d},Berlin Hbf,Hamburg Hbf,09:34,11:20,DB,ICE 703,,`);
    }
    const csv = rows.join("\n");
    await importFile("big.csv", csv, { forced: "viaduct" });
    await putMany("legs", legs().map((l) => { const { unreviewed: _u, ...r } = l; return { ...r, operator: STALE }; }));
    const res = await importFile("big.csv", csv, { forced: "viaduct" });
    expect(res.updated).toBe(520);
    expect(res.run!.replaced).toHaveLength(500);
  });
});

// ─── suspected duplicate flights ─────────────────────────────────────────────

describe("importFile: suspected duplicate flights (merge spec 4.6)", () => {
  const flightToParis = [
    "BEGIN:VCALENDAR", "BEGIN:VEVENT",
    "DTSTART:20261015T060000Z", "DTEND:20261015T080000Z",
    "SUMMARY:Flight to Paris", "END:VEVENT", "END:VCALENDAR",
  ].join("\n");
  const existingLeg = (over: Partial<Leg> = {}): Leg => ({
    id: "existing", kind: "leg", source: "viaduct", mode: "air", from: "DUB", to: "LHR",
    start: "2026-10-15T09:00", dedupeKey: "leg|2026-10-15|DUB|LHR", createdAt: "2026-10-01T00:00:00.000Z",
    ...over,
  });

  test("is imported flagged new with a note, not dropped", async () => {
    await putMany("legs", [existingLeg()]);
    const res = await importFile("calendar.ics", flightToParis, { forced: "icalendar" });
    expect(res.added).toBe(1);
    expect(res.skipped.duplicate).toBe(0);
    const added = legs().find((l) => l.id !== "existing")!;
    expect(added.unreviewed).toBe("new");
    expect(added.importNotes?.[0]).toMatch(/^Possible duplicate of "/);
    expect(added.possibleDuplicateOf).toBe("existing");
  });

  test("no note when there is no other leg that day, or the only one is hidden", async () => {
    let res = await importFile("calendar.ics", flightToParis, { forced: "icalendar" });
    expect(legs()[0].possibleDuplicateOf).toBeUndefined();
    expect(res.added).toBe(1);

    await freshJournal();
    await putMany("legs", [existingLeg({ hidden: true })]);
    res = await importFile("calendar.ics", flightToParis, { forced: "icalendar" });
    const added = legs().find((l) => l.id !== "existing")!;
    expect(added.possibleDuplicateOf).toBeUndefined();
    expect(added?.importNotes ?? []).not.toContainEqual(expect.stringMatching(/^Possible duplicate/));
  });
});

// ─── trigger and progress ────────────────────────────────────────────────────

describe("importFile: trigger", () => {
  async function progressSeenDuringWrites(trigger: "manual" | "startup") {
    const seen: (string | null)[] = [];
    mem.onPut = (store) => { if (store === "legs") seen.push(getState().commitProgress?.batchId ?? null); };
    const res = await importFile("sample.csv", viaductCsv, { forced: "viaduct", trigger });
    expect(getState().commitProgress).toBeNull();
    return { seen, res };
  }

  test("manual sets commitProgress while writing and clears it afterwards", async () => {
    const { seen, res } = await progressSeenDuringWrites("manual");
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((id) => id === res.run!.id)).toBe(true);
    expect(res.run!.trigger).toBe("manual");
  });

  test("startup never sets commitProgress", async () => {
    const { seen, res } = await progressSeenDuringWrites("startup");
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((id) => id === null)).toBe(true);
    expect(res.run!.trigger).toBe("startup");
  });

  test("an unsupported format throws on a manual import and is swallowed on startup", async () => {
    const fr24 = "Date,Flight number,From,To,Dep time,Arr time,Aircraft\n";
    await expect(importFile("fr24.csv", fr24, { trigger: "manual" })).rejects.toThrow();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await importFile("fr24.csv", fr24, { trigger: "startup" });
    expect(res.added).toBe(0);
    expect(res.run).toBeUndefined();
    expect(res.errors).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

// ─── single flight ───────────────────────────────────────────────────────────

describe("importFile: single flight", () => {
  test("two overlapping imports of the same file run one after the other", async () => {
    const [a, b] = await Promise.all([
      importFile("sample.csv", viaductCsv, { forced: "viaduct", trigger: "startup" }),
      importFile("sample.csv", viaductCsv, { forced: "viaduct", trigger: "manual" }),
    ]);
    expect(a.added).toBe(4);
    expect(b.added).toBe(0);
    expect(b.skipped.duplicate).toBe(4);
    expect(legs()).toHaveLength(4);
    expect(runs()).toHaveLength(1);
  });

  test("a failed import does not block the next one", async () => {
    await expect(importFile("fr24.csv", "Date,Flight number,From,To,Dep time,Arr time,Aircraft\n")).rejects.toThrow();
    const res = await importFile("sample.csv", viaductCsv, { forced: "viaduct" });
    expect(res.added).toBe(4);
  });
});

// ─── interruption ────────────────────────────────────────────────────────────

describe("importFile: interrupted runs", () => {
  test("a crash mid-write leaves a running run; re-importing finishes the job", async () => {
    let entryPuts = 0;
    mem.onPut = (store) => {
      if (store === "legs" && ++entryPuts === 1) throw new Error("app killed");
    };
    await expect(importFile("sample.csv", viaductCsv, { forced: "viaduct" })).rejects.toThrow("app killed");
    expect(getState().commitProgress).toBeNull();
    expect(mem.rows<ImportRun>("importRuns")[0].status).toBe("running");
    expect(legs()).toHaveLength(0);

    mem.onPut = undefined;
    const res = await importFile("sample.csv", viaductCsv, { forced: "viaduct" });
    expect(res.added).toBe(4);
  });

  test("boot closes a running run with counts recomputed from entries carrying its id", async () => {
    const m = new MemoryAdapter();
    const run: ImportRun = {
      id: "r1", source: "viaduct", filename: "sample.csv", trigger: "manual",
      startedAt: "2026-10-18T10:00:00.000Z", status: "running", added: 0, updated: 0,
      skipped: { duplicate: 0, inFile: 0, removed: 0 }, errors: [], replaced: [],
    };
    const written = (id: string, over: Partial<Entry> = {}): Leg => ({
      id, kind: "leg", source: "viaduct", mode: "rail", from: "A", to: "B",
      start: "2026-03-01T09:00", dedupeKey: `leg|${id}`, createdAt: "2026-03-01T10:00:00.000Z",
      unreviewed: "new", importId: "r1", ...over,
    } as Leg);
    const replacedOne = written("l3", { unreviewed: "updated" });
    run.replaced = [{ store: "legs", before: { ...replacedOne, importId: undefined, unreviewed: undefined } as Entry }];
    await m.putMany("importRuns", [run, { ...run, id: "r0", status: "done", added: 9 }]);
    await m.putMany("legs", [written("l1"), written("l2"), replacedOne, written("other", { importId: "r0" })]);

    setAdapter(m);
    await initJournal();

    const closed = getState().importRuns.find((r) => r.id === "r1")!;
    expect(closed.status).toBe("done");
    expect(closed.added).toBe(2);
    expect(closed.updated).toBe(1);
    expect(closed.finishedAt).toBeDefined();
    expect(m.rows<ImportRun>("importRuns").find((r) => r.id === "r1")!.status).toBe("done");
    // Other runs are untouched.
    expect(getState().importRuns.find((r) => r.id === "r0")!.added).toBe(9);

    // Idempotent: a second boot does not touch the runs again.
    const runPuts: StoreName[] = [];
    m.onPut = (store) => { if (store === "importRuns") runPuts.push(store); };
    setAdapter(m);
    await initJournal();
    expect(runPuts).toEqual([]);
  });
});

// ─── enrichment ──────────────────────────────────────────────────────────────

describe("importFile: enrichment", () => {
  test("is called for the new entries only", async () => {
    const res = await importFile("sample.csv", viaductCsv, { forced: "viaduct" });
    expect(enrichAll).toHaveBeenCalledTimes(1);
    const passed = vi.mocked(enrichAll).mock.calls[0][0] as Entry[];
    expect(passed.map((e) => e.id).sort()).toEqual(legs().map((l) => l.id).sort());
    expect(passed.every((e) => e.importId === res.run!.id)).toBe(true);
  });

  test("is not called when nothing was added", async () => {
    await importFile("sample.csv", viaductCsv, { forced: "viaduct" });
    vi.mocked(enrichAll).mockClear();
    await importFile("sample.csv", viaductCsv, { forced: "viaduct" });
    expect(enrichAll).not.toHaveBeenCalled();
  });

  test("a failing enrichment never fails the import", async () => {
    vi.mocked(enrichAll).mockRejectedValueOnce(new Error("offline"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await importFile("sample.csv", viaductCsv, { forced: "viaduct" });
    expect(res.added).toBe(4);
    await new Promise((r) => setTimeout(r, 0));
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});


// ─── people matching ─────────────────────────────────────────────────────────

describe("importFile: people matching", () => {
  const ics = (extra: string[]) =>
    [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:dinner-1",
      "DTSTART:20260301T190000Z",
      "DTEND:20260301T210000Z",
      "SUMMARY:Dinner",
      ...extra,
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

  async function seedPeople() {
    await putMany("people", [
      { id: "me", name: "Mike Mulligan", isSelf: true, createdAt: "2026-01-01T00:00:00Z" },
      { id: "kelly", name: "Kelly Fitzsimons", createdAt: "2026-01-01T00:00:00Z" },
    ]);
  }

  test("tags attendees who match a person and keeps the rest as companions", async () => {
    await seedPeople();
    await importFile("cal.ics", ics([
      'ATTENDEE;CN="Kelly Fitzsimons":mailto:k@example.com',
      'ATTENDEE;CN="Someone Else":mailto:s@example.com',
    ]), { forced: "icalendar" });
    const [e] = getState().events;
    expect(e.participants).toEqual(["me", "kelly"]);
    expect(e.companions).toEqual(["Someone Else"]);
  });

  test("an event with no matching names is left alone (implicit self)", async () => {
    await seedPeople();
    await importFile("cal.ics", ics([]), { forced: "icalendar" });
    const [e] = getState().events;
    expect(e.participants).toBeUndefined();
  });

  test("a re-import does not override participants the user has set", async () => {
    await seedPeople();
    await importFile("cal.ics", ics([]), { forced: "icalendar" });
    const [first] = getState().events;
    await putMany("events", [{ ...first, participants: [] }]);
    await importFile("cal.ics", ics(['ATTENDEE;CN="Kelly Fitzsimons":mailto:k@example.com']), { forced: "icalendar" });
    expect(getState().events.every((e) => !e.participants?.includes("kelly"))).toBe(true);
  });
});
