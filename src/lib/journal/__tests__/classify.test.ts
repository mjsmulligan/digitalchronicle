/**
 * WP2 of docs/specs/auto-import.md: classify against hidden entries.
 *
 * Part 1 tests classify() and buildDedupeIndex() directly.
 * Part 2 runs the real importFile / hideMany pipeline against an
 * in-memory storage adapter, to prove that re-importing never brings back an
 * entry the user hid.
 */
import { describe, test, expect, beforeEach } from "vitest";
import { classify, buildDedupeIndex, hasSourceChanges } from "../classify";
import { importFile } from "../import";
import {
  setAdapter, initJournal, getState, allEntries, allHiddenEntries,
  hideMany, unhideMany, putMany, storeFor,
} from "../db";
import type { StorageAdapter, Row } from "../storage";
import { STORES, emptyJournalData, type JournalData, type StoreName, type Entry, type Leg } from "../types";
import viaductCsv from "../connectors/viaduct/fixtures/sample.csv?raw";

// ─── Fixtures ────────────────────────────────────────────────────────────────

let n = 0;
const leg = (over: Partial<Leg> = {}): Leg => {
  n += 1;
  return {
    id: `leg${n}`, kind: "leg", source: "viaduct", mode: "rail",
    from: "A", to: "B", start: "2026-03-01T09:00",
    dedupeKey: "leg|2026-03-01|A|B", createdAt: "2026-03-01T10:00:00.000Z",
    ...over,
  };
};
const incoming = (over: Partial<Leg> = {}) => leg({ id: "incoming", ...over });
const classifyOne = (entry: Entry, existing: Entry[]) =>
  classify(entry, buildDedupeIndex(existing), new Set());

// ─── Part 1: classify() ──────────────────────────────────────────────────────

describe("classify", () => {
  test("new when nothing matches", () => {
    expect(classifyOne(incoming(), [])).toEqual({ status: "new" });
    expect(classifyOne(incoming(), [leg({ dedupeKey: "leg|other" })])).toEqual({ status: "new" });
  });

  test("duplicate when the same source says the same thing, with the match id", () => {
    const existing = leg();
    expect(classifyOne(incoming(), [existing])).toEqual({ status: "duplicate", matchId: existing.id });
  });

  test("refresh when the same source changed a source field", () => {
    const existing = leg({ operator: "DB" });
    expect(classifyOne(incoming({ operator: "SNCF" }), [existing])).toEqual({ status: "refresh", matchId: existing.id });
  });

  test("enrich when the match came from a different source, whatever it holds", () => {
    const existing = leg({ source: "icalendar" });
    expect(classifyOne(incoming(), [existing])).toEqual({ status: "enrich", matchId: existing.id });
    expect(classifyOne(incoming({ operator: "SNCF" }), [leg({ source: "manual" })]).status).toBe("enrich");
  });

  test("batch-duplicate for a key seen earlier in the same file", () => {
    const seen = new Set<string>();
    const index = buildDedupeIndex([]);
    expect(classify(incoming(), index, seen)).toEqual({ status: "new" });
    expect(classify(incoming(), index, seen)).toEqual({ status: "batch-duplicate" });
  });

  test("removed when the match is hidden, whatever the source or content", () => {
    for (const hiddenSource of ["viaduct", "icalendar", "manual"]) {
      const hidden = leg({ source: hiddenSource, hidden: true });
      expect(classifyOne(incoming(), [hidden])).toEqual({ status: "removed", matchId: hidden.id });
      expect(classifyOne(incoming({ operator: "SNCF" }), [hidden]).status).toBe("removed");
    }
  });

  test("a second row for a hidden key in the same file is a batch-duplicate", () => {
    const hidden = leg({ hidden: true });
    const index = buildDedupeIndex([hidden]);
    const seen = new Set<string>();
    expect(classify(incoming(), index, seen).status).toBe("removed");
    expect(classify(incoming(), index, seen).status).toBe("batch-duplicate");
  });
});

describe("hasSourceChanges", () => {
  test("ignores everything the user owns and importer bookkeeping", () => {
    const existing = leg({
      reflection: "Lovely", participants: ["p1"], tripId: "t1", overrides: { from: "Berlin" } as Leg["overrides"],
      importId: "run1", unreviewed: "new", importNotes: ["note"], sourceRef: "old.csv#row2", createdAt: "2020-01-01T00:00:00.000Z",
    });
    const same = incoming({ sourceRef: "new.csv#row9", createdAt: "2026-10-25T00:00:00.000Z" });
    expect(hasSourceChanges(same, existing)).toBe(false);
  });

  test("a field the user overrode is not a change even when the source differs", () => {
    const existing = leg({ operator: "DB", overrides: { operator: "My operator" } as unknown as Leg["overrides"] });
    expect(hasSourceChanges(incoming({ operator: "SNCF" }), existing)).toBe(false);
  });

  test("a field the incoming record leaves out is not a change", () => {
    const existing = leg({ operator: "DB", rating: 7 });
    expect(hasSourceChanges(incoming({ operator: undefined }), existing)).toBe(false);
  });

  test("key order inside nested values does not matter", () => {
    const existing = leg({ raw: { a: 1, b: 2 } });
    expect(hasSourceChanges(incoming({ raw: { b: 2, a: 1 } }), existing)).toBe(false);
    expect(hasSourceChanges(incoming({ raw: { a: 1, b: 3 } }), existing)).toBe(true);
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
    expect(classifyOne(incoming(), [hidden, visible]).status).toBe("duplicate");
  });

  test("among entries of the same visibility the last one wins (as before)", () => {
    const a = leg({ id: "a" });
    const b = leg({ id: "b" });
    expect(buildDedupeIndex([a, b]).get(a.dedupeKey)?.id).toBe("b");
  });
});

// ─── Part 2: the real pipeline ───────────────────────────────────────────────

/** Minimal in-memory StorageAdapter so importFile and hideMany can run in node. */
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

async function freshJournal() {
  setAdapter(new MemoryAdapter());
  await initJournal();
}

describe("re-import after hiding (importFile)", () => {
  beforeEach(freshJournal);

  test("a hidden entry is never brought back by re-import", async () => {
    // First import: four new rail legs.
    const first = await importFile("sample.csv", viaductCsv, { forced: "viaduct" });
    expect(first.added).toBe(4);
    expect(allEntries(getState())).toHaveLength(4);

    // The user hides one.
    const target = allEntries(getState())[0];
    await hideMany(storeFor(target), [target.id]);
    expect(allEntries(getState())).toHaveLength(3);
    expect(allHiddenEntries(getState())).toHaveLength(1);

    // Re-import the same file: hidden entry is skipped as removed, rest are duplicates.
    const second = await importFile("sample.csv", viaductCsv, { forced: "viaduct" });
    expect(second.added).toBe(0);
    expect(second.skipped.removed).toBe(1);
    expect(second.skipped.duplicate).toBe(3);

    // Hidden entry stays hidden; visible count unchanged.
    expect(allEntries(getState())).toHaveLength(3);
    expect(allHiddenEntries(getState()).map((e) => e.id)).toContain(target.id);
  });

  test("unhiding returns the entry to normal duplicate handling", async () => {
    const first = await importFile("sample.csv", viaductCsv, { forced: "viaduct" });
    expect(first.added).toBe(4);
    const target = allEntries(getState())[0];
    await hideMany(storeFor(target), [target.id]);
    await unhideMany(storeFor(target), [target.id]);

    const again = await importFile("sample.csv", viaductCsv, { forced: "viaduct" });
    expect(again.added).toBe(0);
    expect(again.skipped.duplicate).toBe(4);
    expect(again.skipped.removed).toBe(0);
  });

  test("without hiding, a re-import is all duplicates (unchanged behaviour)", async () => {
    const first = await importFile("sample.csv", viaductCsv, { forced: "viaduct" });
    expect(first.added).toBe(4);
    const again = await importFile("sample.csv", viaductCsv, { forced: "viaduct" });
    expect(again.added).toBe(0);
    expect(again.skipped.duplicate).toBe(4);
  });
});

describe("near-match rule ignores hidden legs", () => {
  beforeEach(freshJournal);

  const flightToParis = [
    "BEGIN:VCALENDAR", "BEGIN:VEVENT",
    "DTSTART:20261015T060000Z", "DTEND:20261015T080000Z",
    "SUMMARY:Flight to Paris", "END:VEVENT", "END:VCALENDAR",
  ].join("\n");

  const sameDayLeg = (over: Partial<Leg> = {}) =>
    leg({ id: "existing", mode: "air", from: "DUB", to: "LHR", start: "2026-10-15T09:00", dedupeKey: "leg|2026-10-15|DUB|LHR", ...over });

  test("a visible leg on the same date flags the imported flight as a possible duplicate", async () => {
    await putMany("legs", [sameDayLeg()]);
    const result = await importFile("calendar.ics", flightToParis, { forced: "icalendar" });
    // The flight is added (not blocked) but flagged with a note.
    expect(result.added).toBe(1);
    const entry = allEntries(getState()).find((e) => e.kind === "leg" && e.id !== "existing");
    expect(entry?.importNotes?.[0]).toMatch(/^Possible duplicate of "/);
    expect((entry as Leg).possibleDuplicateOf).toBe("existing");
  });

  test("a hidden leg on the same date does not flag the imported flight", async () => {
    await putMany("legs", [sameDayLeg({ hidden: true })]);
    const result = await importFile("calendar.ics", flightToParis, { forced: "icalendar" });
    expect(result.added).toBe(1);
    const entry = allEntries(getState()).find((e) => e.kind === "leg");
    expect(entry?.importNotes ?? []).not.toContainEqual(expect.stringMatching(/^Possible duplicate/));
    expect((entry as Leg).possibleDuplicateOf).toBeUndefined();
  });
});
