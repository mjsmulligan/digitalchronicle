/**
 * WP2 of docs/specs/auto-import.md: classify against hidden entries.
 *
 * Part 1 tests classify() and buildDedupeIndex() directly.
 * Part 2 runs the real stageFile / commitBatch / hideMany pipeline against an
 * in-memory storage adapter, to prove that re-importing never brings back an
 * entry the user hid.
 */
import { describe, test, expect, beforeEach } from "vitest";
import { classify, buildDedupeIndex } from "../classify";
import { stageFile, commitBatch } from "../staging";
import {
  setAdapter, initJournal, getState, allEntries, allHiddenEntries,
  hideMany, unhideMany, putMany, storeFor,
} from "../db";
import type { StorageAdapter, Row } from "../storage";
import { STORES, emptyJournalData, type JournalData, type StoreName, type Entry, type Leg, type Tier } from "../types";
import viaductCsv from "../connectors/viaduct/fixtures/sample.csv?raw";

// ─── Fixtures ────────────────────────────────────────────────────────────────

let n = 0;
const leg = (over: Partial<Leg> = {}): Leg => {
  n += 1;
  return {
    id: `leg${n}`, kind: "leg", source: "viaduct", tier: 2, mode: "rail",
    from: "A", to: "B", start: "2026-03-01T09:00",
    dedupeKey: "leg|2026-03-01|A|B", createdAt: "2026-03-01T10:00:00.000Z",
    ...over,
  };
};
const incoming = (tier: Tier, key = "leg|2026-03-01|A|B") => leg({ id: `in${tier}`, tier, dedupeKey: key });
const classifyOne = (entry: Entry, existing: Entry[]) =>
  classify(entry, buildDedupeIndex(existing), new Set());

// ─── Part 1: classify() ──────────────────────────────────────────────────────

describe("classify", () => {
  test("new when nothing matches", () => {
    expect(classifyOne(incoming(2), [])).toEqual({ status: "new" });
    expect(classifyOne(incoming(2), [leg({ dedupeKey: "leg|other" })])).toEqual({ status: "new" });
  });

  test("duplicate for the same tier, with the match id", () => {
    const existing = leg({ tier: 2 });
    expect(classifyOne(incoming(2), [existing])).toEqual({ status: "duplicate", matchId: existing.id });
  });

  test("supersedes when the incoming tier number is lower (higher precedence)", () => {
    const existing = leg({ tier: 3 });
    expect(classifyOne(incoming(2), [existing])).toEqual({ status: "supersedes", matchId: existing.id });
  });

  test("superseded when the incoming tier number is higher (lower precedence)", () => {
    const existing = leg({ tier: 2 });
    expect(classifyOne(incoming(3), [existing])).toEqual({ status: "superseded", matchId: existing.id });
  });

  test("batch-duplicate for a key seen earlier in the same file", () => {
    const seen = new Set<string>();
    const index = buildDedupeIndex([]);
    expect(classify(incoming(2), index, seen)).toEqual({ status: "new" });
    expect(classify(incoming(2), index, seen)).toEqual({ status: "batch-duplicate" });
  });

  test("removed when the match is hidden, whatever the tier", () => {
    for (const hiddenTier of [1, 2, 3] as Tier[]) {
      for (const incomingTier of [1, 2, 3] as Tier[]) {
        const hidden = leg({ tier: hiddenTier, hidden: true });
        expect(classifyOne(incoming(incomingTier), [hidden])).toEqual({ status: "removed", matchId: hidden.id });
      }
    }
  });

  test("a second row for a hidden key in the same file is a batch-duplicate", () => {
    const hidden = leg({ hidden: true });
    const index = buildDedupeIndex([hidden]);
    const seen = new Set<string>();
    expect(classify(incoming(2), index, seen).status).toBe("removed");
    expect(classify(incoming(2), index, seen).status).toBe("batch-duplicate");
  });
});

describe("buildDedupeIndex", () => {
  test("indexes hidden entries", () => {
    const hidden = leg({ hidden: true });
    expect(buildDedupeIndex([hidden]).get(hidden.dedupeKey)).toBe(hidden);
  });

  test("a visible entry wins over a hidden one with the same key, in either order", () => {
    const visible = leg({ id: "visible" });
    const hidden = leg({ id: "hidden", hidden: true });
    expect(buildDedupeIndex([visible, hidden]).get(visible.dedupeKey)?.id).toBe("visible");
    expect(buildDedupeIndex([hidden, visible]).get(visible.dedupeKey)?.id).toBe("visible");
    // ...so such an import is classified against the visible entry, not "removed"
    expect(classifyOne(incoming(2), [hidden, visible]).status).toBe("duplicate");
  });

  test("among entries of the same visibility the last one wins (as before)", () => {
    const a = leg({ id: "a" });
    const b = leg({ id: "b" });
    expect(buildDedupeIndex([a, b]).get(a.dedupeKey)?.id).toBe("b");
  });
});

// ─── Part 2: the real pipeline ───────────────────────────────────────────────

/** Minimal in-memory StorageAdapter so stageFile, commitBatch and hideMany can run in node. */
class MemoryAdapter implements StorageAdapter {
  private data = new Map<string, Map<string, Row>>();
  private table(store: string) {
    if (!this.data.has(store)) this.data.set(store, new Map());
    return this.data.get(store)!;
  }
  async getAll<T extends Row>(store: StoreName): Promise<T[]> {
    return structuredClone([...this.table(store).values()]) as T[];
  }
  async putMany<T extends Row>(store: StoreName, items: T[]): Promise<void> {
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
}

const statuses = (b: { records: { status: string }[] }) => b.records.map((r) => r.status).sort();

async function freshJournal() {
  setAdapter(new MemoryAdapter());
  await initJournal();
}

describe("re-import after hiding (stageFile + commitBatch)", () => {
  beforeEach(freshJournal);

  test("a hidden entry is classified removed and never comes back", async () => {
    // First import: four new rail legs.
    const first = await stageFile("sample.csv", viaductCsv, "viaduct");
    expect(statuses(first)).toEqual(["new", "new", "new", "new"]);
    expect((await commitBatch(first)).count).toBe(4);
    expect(allEntries(getState())).toHaveLength(4);

    // The user hides one.
    const target = allEntries(getState())[0];
    await hideMany(storeFor(target), [target.id]);
    expect(allEntries(getState())).toHaveLength(3);
    expect(allHiddenEntries(getState())).toHaveLength(1);

    // Re-import the same file: the hidden one is recognised, the rest are duplicates.
    const second = await stageFile("sample.csv", viaductCsv, "viaduct");
    expect(statuses(second)).toEqual(["duplicate", "duplicate", "duplicate", "removed"]);
    const removed = second.records.find((r) => r.status === "removed")!;
    expect(removed.matchId).toBe(target.id);
    expect(removed.entry.dedupeKey).toBe(target.dedupeKey);
    expect(second.records.every((r) => !r.selected)).toBe(true);

    // Committing writes nothing: no resurrected entry, no second copy.
    expect((await commitBatch(second)).count).toBe(0);
    expect(allEntries(getState())).toHaveLength(3);
    expect(getState().legs).toHaveLength(4);
    expect(allHiddenEntries(getState()).map((e) => e.id)).toEqual([target.id]);
  });

  test("a removed record cannot be committed even if it is forced selected", async () => {
    const first = await stageFile("sample.csv", viaductCsv, "viaduct");
    await commitBatch(first);
    const target = allEntries(getState())[0];
    await hideMany(storeFor(target), [target.id]);

    const second = await stageFile("sample.csv", viaductCsv, "viaduct");
    second.records.forEach((r) => { r.selected = true; });
    expect((await commitBatch(second)).count).toBe(0);
    expect(getState().legs).toHaveLength(4);
    expect(allEntries(getState())).toHaveLength(3);
  });

  test("unhiding returns the entry to normal duplicate handling", async () => {
    const first = await stageFile("sample.csv", viaductCsv, "viaduct");
    await commitBatch(first);
    const target = allEntries(getState())[0];
    await hideMany(storeFor(target), [target.id]);
    await unhideMany(storeFor(target), [target.id]);

    const again = await stageFile("sample.csv", viaductCsv, "viaduct");
    expect(statuses(again)).toEqual(["duplicate", "duplicate", "duplicate", "duplicate"]);
  });

  test("without hiding, a re-import is all duplicates (unchanged behaviour)", async () => {
    const first = await stageFile("sample.csv", viaductCsv, "viaduct");
    await commitBatch(first);
    const again = await stageFile("sample.csv", viaductCsv, "viaduct");
    expect(statuses(again)).toEqual(["duplicate", "duplicate", "duplicate", "duplicate"]);
    expect((await commitBatch(again)).count).toBe(0);
  });
});

describe("fuzzy flight rule ignores hidden legs", () => {
  beforeEach(freshJournal);

  const flightToParis = [
    "BEGIN:VCALENDAR", "BEGIN:VEVENT",
    "DTSTART:20261015T060000Z", "DTEND:20261015T080000Z",
    "SUMMARY:Flight to Paris", "END:VEVENT", "END:VCALENDAR",
  ].join("\n");

  const sameDayLeg = (over: Partial<Leg> = {}) =>
    leg({ id: "existing", mode: "air", from: "DUB", to: "LHR", start: "2026-10-15T09:00", dedupeKey: "leg|2026-10-15|DUB|LHR", ...over });

  test("a visible leg on the same date still makes a ??? flight a possible duplicate", async () => {
    await putMany("legs", [sameDayLeg()]);
    const batch = await stageFile("calendar.ics", flightToParis, "icalendar");
    expect(batch.records).toHaveLength(1);
    expect(batch.records[0].status).toBe("duplicate");
    expect(batch.records[0].warnings.join(" ")).toContain("possible duplicate");
  });

  test("a hidden leg on the same date does not", async () => {
    await putMany("legs", [sameDayLeg({ hidden: true })]);
    const batch = await stageFile("calendar.ics", flightToParis, "icalendar");
    expect(batch.records[0].status).toBe("new");
  });
});
