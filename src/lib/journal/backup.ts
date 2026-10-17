import { STORES, type JournalData } from "./types";

/**
 * Builds the `data` payload of a Chronicle backup from the live journal state.
 * Driven by STORES so a new store is exported automatically (a hand-written
 * list drifts: importRuns, placeBinMarkers and others were easy to miss).
 */
export function toBackupData(state: Partial<JournalData>): JournalData {
  return Object.fromEntries(
    STORES.map((k) => [k, (state as Record<string, unknown>)[k] ?? []]),
  ) as unknown as JournalData;
}

/**
 * Validates a parsed backup file and returns a complete JournalData, with any
 * store missing from the file (an older backup) set to an empty array.
 * Accepts the old envelope (`version: 1`) and the current one (`schemaVersion: 1`).
 */
export function fromBackupData(parsed: unknown): JournalData {
  const file = (parsed ?? {}) as { schemaVersion?: unknown; version?: unknown; data?: unknown };
  if (file.schemaVersion !== 1 && file.version !== 1) throw new Error("Unsupported backup version");
  const d = (file.data ?? {}) as Record<string, unknown>;
  if (!STORES.some((k) => Array.isArray(d[k]))) throw new Error("Not a Chronicle backup");
  return Object.fromEntries(
    STORES.map((k) => [k, Array.isArray(d[k]) ? d[k] : []]),
  ) as unknown as JournalData;
}
