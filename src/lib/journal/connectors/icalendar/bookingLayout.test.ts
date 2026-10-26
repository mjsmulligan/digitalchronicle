/**
 * WP9 of docs/specs/merge-dedup.md: a stay that arrives as a timed calendar event with a
 * booking-site description. The fixture is anonymised: no real names, codes or hotels.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../artworkEnrichment", () => ({ enrichAll: vi.fn(async () => {}) }));

import { connector } from "./index";
import text from "./fixtures/booking-layout.ics?raw";
import { stayKey } from "../keys";
import { importFile } from "../../import";
import { setAdapter, initJournal, getState, putMany } from "../../db";
import type { StorageAdapter, Row } from "../../storage";
import { STORES, emptyJournalData, type JournalData, type StoreName, type JEvent, type Stay } from "../../types";

const parsed = (() => {
  const r = connector.parse({ name: "booking.ics", text });
  if (r instanceof Promise) throw new Error("expected sync parse");
  return r;
})();
const stays = parsed.entries.map((e) => e.entry).filter((e): e is Stay => e.kind === "stay");
const events = parsed.entries.map((e) => e.entry).filter((e): e is JEvent => e.kind === "event");

describe("booking layout", () => {
  it("imports the booking as one stay, the conference and the bare range as events", () => {
    expect(stays).toHaveLength(2);
    expect(events.map((e) => e.artist)).toEqual(["Example Conference", "Retreat"]);
  });

  const paris = stays[0];

  it("takes dates and nights from the description range, not the calendar times", () => {
    expect(paris.start).toBe("2026-10-12");
    expect(paris.end).toBe("2026-10-14");
    // a date-only stay has no UTC instant, so the odd calendar times leave no trace
    expect(paris.startUTC).toBeUndefined();
  });

  it("uses the first description line as the place and skips the postcode for the city", () => {
    expect(paris.place).toBe("Hôtel Exemple Paris");
    expect(paris.city).toBe("Paris");
  });

  it("does not make the organiser a companion of their own stay", () => {
    expect(paris.companions).toBeUndefined();
  });

  it("works with a booking code only, and with a postcode after the city", () => {
    const lyon = stays[1];
    expect(lyon.place).toBe("Sample Inn Lyon");
    expect(lyon.city).toBe("Lyon");
    expect([lyon.start, lyon.end]).toEqual(["2026-11-01", "2026-11-02"]);
  });

  it("keeps the source text for reprocessing", () => {
    expect(paris.raw?.description).toContain("(2026.10.12 00:00 - 2026.10.14 00:00)");
  });

  it("gets the key another source would build for the same hotel and night", () => {
    // Accents and case do not matter: a Booking.com "Hotel Exemple Paris" matches.
    expect(paris.dedupeKey).toBe(stayKey({ start: "2026-10-12", place: "Hotel Exemple Paris" }));
  });
});

class MemoryAdapter implements StorageAdapter {
  private data = new Map<string, Map<string, Row>>();
  private table(store: string) {
    if (!this.data.has(store)) this.data.set(store, new Map());
    return this.data.get(store)!;
  }
  async getAll<T extends Row>(store: StoreName): Promise<T[]> { return structuredClone([...this.table(store).values()]) as T[]; }
  async putMany<T extends Row>(store: StoreName, items: T[]): Promise<void> { for (const i of items) this.table(store).set(i.id, structuredClone(i)); }
  async removeMany(store: StoreName, ids: string[]): Promise<void> { for (const id of ids) this.table(store).delete(id); }
  async replaceAll(d: JournalData): Promise<void> {
    this.data.clear();
    for (const s of STORES) for (const r of (d[s] ?? []) as Row[]) this.table(s).set(r.id, structuredClone(r));
  }
  async clearAll(): Promise<void> { await this.replaceAll(emptyJournalData()); }
}

describe("booking layout and another source", () => {
  beforeEach(async () => {
    setAdapter(new MemoryAdapter());
    await initJournal();
  });

  it("enriches a stay from another source with the same name and night instead of adding a second", async () => {
    const other: Stay = {
      id: "booking-stay", kind: "stay", source: "booking", sourceRef: "b#1", place: "Hotel Exemple Paris", city: "Paris",
      start: "2026-10-12", end: "2026-10-14", dedupeKey: stayKey({ start: "2026-10-12", place: "Hotel Exemple Paris" }),
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    await putMany("stays", [other]);
    const res = await importFile("booking.ics", text, { forced: "icalendar" });
    expect(res.updated).toBe(1);
    const all = getState().stays;
    expect(all.filter((s) => s.place.includes("Exemple"))).toHaveLength(1);
    const merged = all.find((s) => s.id === "booking-stay")!;
    expect(merged.additionalSources?.[0]).toMatchObject({ source: "icalendar" });
  });
});
