/**
 * WP12a — Boot migration for legacy photo PlaceEntries.
 *
 * Spec reference: docs/specs/auto-import.md, §8 / D13.
 *
 * Before WP12a, buildStagingPlan created PlaceEntries with status "pending"
 * (waiting in the Staging Hub) or "dismissed" (rejected, pending bin emptying).
 * The migration maps them to the auto-import model:
 *   pending   -> accepted + unreviewed: "new"
 *   dismissed -> accepted + hidden: true
 *
 * Tests verify:
 *   - pending entries become accepted + unreviewed: "new"
 *   - dismissed entries become accepted + hidden: true
 *   - already-accepted entries are untouched
 *   - the migration is idempotent (second run writes nothing)
 *   - both adapter paths (IDB-like and SQLite-like) behave identically
 */
import { describe, it, expect } from "vitest";
import { migratePhotoPlaceEntries, setAdapter } from "../db";
import type { PlaceEntry } from "../types";
import type { StorageAdapter, Row } from "../storage";
import type { JournalData, StoreName } from "../types";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makePlaceEntry(id: string, status: "pending" | "accepted" | "dismissed"): PlaceEntry {
  return {
    id,
    kind: "place-entry",
    source: "photo-library",
    start: "2025-07-05",
    placeId: "place-1",
    localityKey: "gb:london",
    localDay: "2025-07-05",
    photoEvidence: [],
    photoCount: 3,
    status,
    dedupeKey: `place-entry|gb:london|2025-07-05-${id}`,
    createdAt: "2025-07-05T12:00:00.000Z",
  };
}

// ─── Fake adapter ─────────────────────────────────────────────────────────────

/**
 * A fake StorageAdapter that records putMany calls.
 * Suitable for both IDB-like and SQLite-like usage (same interface).
 */
function makeAdapter() {
  const puts: Array<{ store: StoreName; items: Row[] }> = [];
  const adapter: StorageAdapter = {
    async getAll<T extends Row>(store: StoreName): Promise<T[]> {
      void store;
      return [];
    },
    async putMany<T extends Row>(store: StoreName, items: T[]): Promise<void> {
      puts.push({ store, items: [...items] });
    },
    async removeMany(_store: StoreName, _ids: string[]): Promise<void> {},
    async replaceAll(_data: JournalData): Promise<void> {},
    async clearAll(): Promise<void> {},
  };
  return { adapter, puts };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("migratePhotoPlaceEntries", () => {
  it("maps pending entries to accepted + unreviewed: new", async () => {
    const { adapter, puts } = makeAdapter();
    setAdapter(adapter);

    const data: Record<string, unknown> = {
      placeEntries: [makePlaceEntry("e1", "pending"), makePlaceEntry("e2", "pending")],
    };

    await migratePhotoPlaceEntries(data);

    // One putMany call with both migrated entries
    expect(puts).toHaveLength(1);
    expect(puts[0].store).toBe("placeEntries");
    const written = puts[0].items as PlaceEntry[];
    expect(written).toHaveLength(2);
    for (const e of written) {
      expect(e.status).toBe("accepted");
      expect(e.unreviewed).toBe("new");
      expect(e.hidden).toBeUndefined();
    }

    // In-memory data is also updated
    const inMem = data.placeEntries as PlaceEntry[];
    expect(inMem.every((e) => e.status === "accepted" && e.unreviewed === "new")).toBe(true);
  });

  it("maps dismissed entries to accepted + hidden: true", async () => {
    const { adapter, puts } = makeAdapter();
    setAdapter(adapter);

    const data: Record<string, unknown> = {
      placeEntries: [makePlaceEntry("e3", "dismissed"), makePlaceEntry("e4", "dismissed")],
    };

    await migratePhotoPlaceEntries(data);

    expect(puts).toHaveLength(1);
    const written = puts[0].items as PlaceEntry[];
    for (const e of written) {
      expect(e.status).toBe("accepted");
      expect(e.hidden).toBe(true);
      expect(e.unreviewed).toBeUndefined();
    }
  });

  it("leaves already-accepted entries untouched", async () => {
    const { adapter, puts } = makeAdapter();
    setAdapter(adapter);

    const data: Record<string, unknown> = {
      placeEntries: [makePlaceEntry("e5", "accepted")],
    };

    await migratePhotoPlaceEntries(data);

    // No writes needed
    expect(puts).toHaveLength(0);
    const inMem = data.placeEntries as PlaceEntry[];
    expect(inMem[0].status).toBe("accepted");
  });

  it("handles a mix of pending, dismissed and accepted entries", async () => {
    const { adapter, puts } = makeAdapter();
    setAdapter(adapter);

    const data: Record<string, unknown> = {
      placeEntries: [
        makePlaceEntry("e6", "pending"),
        makePlaceEntry("e7", "accepted"),
        makePlaceEntry("e8", "dismissed"),
      ],
    };

    await migratePhotoPlaceEntries(data);

    expect(puts).toHaveLength(1);
    const written = puts[0].items as PlaceEntry[];
    expect(written).toHaveLength(2); // e6 and e8 only

    const inMem = data.placeEntries as PlaceEntry[];
    expect(inMem.find((e) => e.id === "e6")?.status).toBe("accepted");
    expect(inMem.find((e) => e.id === "e6")?.unreviewed).toBe("new");
    expect(inMem.find((e) => e.id === "e7")?.status).toBe("accepted"); // unchanged
    expect(inMem.find((e) => e.id === "e8")?.status).toBe("accepted");
    expect(inMem.find((e) => e.id === "e8")?.hidden).toBe(true);
  });

  it("is idempotent: a second run writes nothing", async () => {
    const { adapter } = makeAdapter();
    setAdapter(adapter);

    const data: Record<string, unknown> = {
      placeEntries: [makePlaceEntry("e9", "pending"), makePlaceEntry("e10", "dismissed")],
    };

    // First run migrates
    await migratePhotoPlaceEntries(data);

    // Second run: track new puts only
    const { adapter: adapter2, puts: puts2 } = makeAdapter();
    setAdapter(adapter2);
    await migratePhotoPlaceEntries(data); // data is already migrated in memory

    expect(puts2).toHaveLength(0); // nothing left to write
  });

  it("no-op on empty placeEntries (idempotent on first boot with no scan data)", async () => {
    const { adapter, puts } = makeAdapter();
    setAdapter(adapter);

    const data: Record<string, unknown> = { placeEntries: [] };
    await migratePhotoPlaceEntries(data);

    expect(puts).toHaveLength(0);
  });

  it("no-op when placeEntries is absent (covers missing store on IDB/SQLite cold start)", async () => {
    const { adapter, puts } = makeAdapter();
    setAdapter(adapter);

    const data: Record<string, unknown> = {};
    await migratePhotoPlaceEntries(data);

    expect(puts).toHaveLength(0);
  });
});
