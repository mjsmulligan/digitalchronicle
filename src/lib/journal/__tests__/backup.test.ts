import { describe, test, expect } from "vitest";
import { STORES, emptyJournalData, type JournalData, type BackupFile } from "../types";

describe("backup round-trip", () => {
  test("emptyJournalData can be serialised and deserialised", () => {
    const data = emptyJournalData();
    const envelope: BackupFile = {
      app: "chronicle",
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      data,
    };
    const json = JSON.stringify(envelope);
    const parsed: BackupFile = JSON.parse(json);
    expect(parsed.app).toBe("chronicle");
    expect(parsed.schemaVersion).toBe(1);
    expect(typeof parsed.exportedAt).toBe("string");
    // Every store round-trips
    for (const store of STORES) {
      expect(Array.isArray((parsed.data as unknown as Record<string, unknown>)[store])).toBe(true);
    }
  });

  test("every store is present in backup data", () => {
    const data = emptyJournalData();
    for (const store of STORES) {
      expect(store in data).toBe(true);
    }
  });

  test("backup data has no extra stores beyond STORES", () => {
    const data = emptyJournalData();
    const keys = Object.keys(data);
    for (const key of keys) {
      expect(STORES as readonly string[]).toContain(key);
    }
  });
});
