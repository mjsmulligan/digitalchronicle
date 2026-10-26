/**
 * WP10 of docs/specs/merge-dedup.md: convert an event to a stay, and the event-vs-stay near match.
 */
import { describe, test, expect, beforeEach, vi } from "vitest";

vi.mock("../artworkEnrichment", () => ({ enrichAll: vi.fn(async () => {}) }));

import { importFile } from "../import";
import { setAdapter, initJournal, getState, allEntries, allHiddenEntries, putMany, convertKind, mergeManual } from "../db";
import { eventToStay } from "../convert";
import { buildNearIndex, findNearMatches } from "../nearMatch";
import { stayKey } from "../connectors/keys";
import type { StorageAdapter, Row } from "../storage";
import { STORES, emptyJournalData, type JournalData, type StoreName, type JEvent, type Stay } from "../types";

class MemoryAdapter implements StorageAdapter {
  data = new Map<string, Map<string, Row>>();
  failNextPut = false;
  private table(store: string) {
    if (!this.data.has(store)) this.data.set(store, new Map());
    return this.data.get(store)!;
  }
  async getAll<T extends Row>(store: StoreName): Promise<T[]> { return structuredClone([...this.table(store).values()]) as T[]; }
  async putMany<T extends Row>(store: StoreName, items: T[]): Promise<void> {
    if (this.failNextPut) { this.failNextPut = false; throw new Error("disk full"); }
    for (const i of items) this.table(store).set(i.id, structuredClone(i));
  }
  async removeMany(store: StoreName, ids: string[]): Promise<void> { for (const id of ids) this.table(store).delete(id); }
  async replaceAll(d: JournalData): Promise<void> {
    this.data.clear();
    for (const s of STORES) for (const r of (d[s] ?? []) as Row[]) this.table(s).set(r.id, structuredClone(r));
  }
  async clearAll(): Promise<void> { await this.replaceAll(emptyJournalData()); }
}

let mem: MemoryAdapter;
beforeEach(async () => {
  mem = new MemoryAdapter();
  setAdapter(mem);
  await initJournal();
});

const event = (o: Partial<JEvent> = {}): JEvent => ({
  id: "ev1", kind: "event", source: "icalendar", sourceRef: "cal.ics#row1", category: "activity", artist: "Hotel Exemple Paris",
  venue: "Rue Exemple", city: "Paris", start: "2026-10-12T22:59", end: "2026-10-14T11:00", startTz: "Europe/Dublin",
  dedupeKey: "event|2026-10-12|hotel-exemple-paris", createdAt: "2026-10-01T00:00:00.000Z", raw: { summary: "Hotel Exemple Paris" }, ...o,
});
const booking = (o: Partial<Stay> = {}): Stay => ({
  id: "bk1", kind: "stay", source: "booking", sourceRef: "b#1", place: "Hotel Exemple Paris", city: "Paris",
  start: "2026-10-12", end: "2026-10-14", dedupeKey: stayKey({ start: "2026-10-12", place: "Hotel Exemple Paris" }),
  createdAt: "2026-10-01T00:00:00.000Z", ...o,
});

describe("eventToStay", () => {
  test("maps the headline, dates and city, and keeps what the user and the source own", () => {
    const s = eventToStay(event({
      tripId: "t1", participants: ["p1"], reflection: "lovely", rating: 8, companions: ["Sam"],
      overrides: { artist: "Marianne", start: "2026-10-12T20:00" } as JEvent["overrides"],
    }), "new1");
    expect(s).toMatchObject({
      id: "new1", kind: "stay", place: "Hotel Exemple Paris", city: "Paris", start: "2026-10-12", end: "2026-10-14",
      source: "icalendar", sourceRef: "cal.ics#row1", tripId: "t1", participants: ["p1"], reflection: "lovely", rating: 8,
      companions: ["Sam"], raw: { summary: "Hotel Exemple Paris" },
    });
    expect(s.overrides).toEqual({ place: "Marianne", start: "2026-10-12" });
    expect(s.dedupeKey).toBe("stay|2026-10-12|hotel-exemple-paris");
  });

  test("an event that ends the same day has no end, and the key ignores overrides", () => {
    const s = eventToStay(event({ end: "2026-10-12T23:30", overrides: { artist: "Other" } as JEvent["overrides"] }), "n");
    expect(s.end).toBeUndefined();
    expect(s.dedupeKey).toBe("stay|2026-10-12|hotel-exemple-paris");
  });
});

describe("convertKind", () => {
  test("writes the stay, hides the event under its own key, flags nothing as new", async () => {
    await putMany("events", [event({ unreviewed: "new", tripId: "t1" })]);
    const res = await convertKind("ev1", "stay");
    if (!res.ok) throw new Error(res.reason);
    expect(allEntries(getState()).map((e) => [e.kind, e.id === "ev1"])).toEqual([["stay", false]]);
    expect(allEntries(getState())[0].unreviewed).toBeUndefined();
    const hidden = allHiddenEntries(getState())[0];
    expect(hidden).toMatchObject({ id: "ev1", kind: "event", dedupeKey: "event|2026-10-12|hotel-exemple-paris" });
    expect(mem.data.get("stays")!.size).toBe(1);
  });

  test("re-importing the calendar row does not bring the event back", async () => {
    const ics = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", "DTSTART;TZID=Europe/Dublin:20261012T225900",
      "DTEND;TZID=Europe/Dublin:20261012T235900", "SUMMARY:Hotel Exemple Paris", "UID:u1@example", "END:VEVENT", "END:VCALENDAR",
    ].join("\n");
    await importFile("cal.ics", ics, { forced: "icalendar" });
    const imported = getState().events[0];
    expect(imported).toBeDefined();
    await convertKind(imported.id, "stay");
    const again = await importFile("cal.ics", ics, { forced: "icalendar" });
    expect(again.added).toBe(0);
    expect(again.skipped.removed).toBe(1);
    expect(allEntries(getState())).toHaveLength(1);
  });

  test("refuses anything but an event, and entries that are gone", async () => {
    await putMany("stays", [booking()]);
    expect(await convertKind("bk1", "stay")).toMatchObject({ ok: false });
    expect(await convertKind("nope", "stay")).toMatchObject({ ok: false });
  });

  test("a hint that pointed at the event follows it to the stay", async () => {
    await putMany("events", [event()]);
    await putMany("stays", [booking({ id: "new-stay", possibleDuplicateOf: "ev1" })]);
    const res = await convertKind("ev1", "stay");
    if (!res.ok) throw new Error(res.reason);
    expect(getState().stays.find((s) => s.id === "new-stay")!.possibleDuplicateOf).toBe(res.created.id);
  });

  test("a failed write leaves the event in place", async () => {
    await putMany("events", [event()]);
    mem.failNextPut = true;
    await expect(convertKind("ev1", "stay")).rejects.toThrow("disk full");
    expect(allEntries(getState()).map((e) => e.kind)).toEqual(["event"]);
  });
});

describe("converted entries merge normally; cross-kind merge stays refused", () => {
  test("mergeManual refuses an event and a stay", async () => {
    await putMany("events", [event()]);
    await putMany("stays", [booking()]);
    expect(await mergeManual("bk1", "ev1")).toMatchObject({ ok: false, reason: expect.stringContaining("same kind") });
  });

  test("after conversion the stay merges into the Booking.com stay and keeps the user's data", async () => {
    await putMany("events", [event({ reflection: "lovely", tripId: "t1" })]);
    await putMany("stays", [booking({ notes: "late check-in" })]);
    const res = await convertKind("ev1", "stay");
    if (!res.ok) throw new Error(res.reason);
    const merged = await mergeManual("bk1", res.created.id);
    expect(merged.ok).toBe(true);
    const base = getState().stays.find((s) => s.id === "bk1")!;
    expect(base.reflection).toBe("lovely");
    expect(base.tripId).toBe("t1");
    expect(base.mergedFrom).toEqual([res.created.id]);
    expect(allEntries(getState())).toHaveLength(1);
  });
});

describe("event vs stay near match", () => {
  const idx = (...e: Parameters<typeof buildNearIndex>[0] extends Iterable<infer T> ? T[] : never) => buildNearIndex(e);
  test("an event during a stay with a similar name matches, in both directions", () => {
    const st = booking();
    const ev = event({ id: "ev", start: "2026-10-13T10:00", artist: "Hotel Exemple" });
    expect(findNearMatches(ev, idx(st)).map((m) => m.id)).toEqual(["bk1"]);
    expect(findNearMatches(st, idx(ev)).map((m) => m.id)).toEqual(["ev"]);
  });

  test("a different name, a day outside the stay, or a hidden entry does not match", () => {
    const st = booking();
    expect(findNearMatches(event({ artist: "Dinner with Sam" }), idx(st))).toEqual([]);
    expect(findNearMatches(event({ start: "2026-10-20T10:00" }), idx(st))).toEqual([]);
    expect(findNearMatches(event(), idx({ ...st, hidden: true }))).toEqual([]);
  });

  test("an import of a calendar event flags the stay it overlaps, and conversion then allows the merge", async () => {
    await putMany("stays", [booking()]);
    const ics = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", "DTSTART;TZID=Europe/Dublin:20261013T100000",
      "DTEND;TZID=Europe/Dublin:20261013T110000", "SUMMARY:Hotel Exemple Paris", "UID:u2@example", "END:VEVENT", "END:VCALENDAR",
    ].join("\n");
    await importFile("cal.ics", ics, { forced: "icalendar" });
    const imported = getState().events[0];
    expect(imported.possibleDuplicateOf).toBe("bk1");
    expect(imported.importNotes?.[0]).toBe('Possible duplicate of "Hotel Exemple Paris"');

    const res = await convertKind(imported.id, "stay");
    if (!res.ok) throw new Error(res.reason);
    expect(res.created.possibleDuplicateOf).toBe("bk1");
    expect((await mergeManual("bk1", res.created.id)).ok).toBe(true);
  });
});
