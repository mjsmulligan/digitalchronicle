/**
 * chronicle-prefs.json-backed SyncStorage for the connected-sources runner.
 * Keys are namespaced with "cs_" to avoid collisions with existing prefs.
 * Not imported by connectedSources.ts so tests can run in Node.
 */
import * as FileSystem from "expo-file-system/legacy";
import type { SyncStorage } from "./connectedSources";

const PREFS_PATH = (FileSystem.documentDirectory ?? "") + "chronicle-prefs.json";
const NS = "cs_";

async function readAll(): Promise<Record<string, string>> {
  try {
    return JSON.parse(await FileSystem.readAsStringAsync(PREFS_PATH)) as Record<string, string>;
  } catch {
    return {};
  }
}

export function makeSyncPrefsStorage(): SyncStorage {
  return {
    async get(key: string) {
      const all = await readAll();
      const v = all[NS + key];
      return typeof v === "string" ? v : null;
    },
    async set(key: string, value: string | null) {
      const all = await readAll();
      if (value === null) delete all[NS + key];
      else all[NS + key] = value;
      await FileSystem.writeAsStringAsync(PREFS_PATH, JSON.stringify(all));
    },
  };
}
