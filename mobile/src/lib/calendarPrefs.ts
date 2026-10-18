/**
 * Persisted connect state and chosen calendars for the device calendar source.
 *
 * Stored in chronicle-prefs.json under the key "calendarPrefs".
 * Separate from the connected-sources prefs (which are stored with the cs_ prefix)
 * because this carries richer data (the list of chosen calendar IDs).
 */
import * as FileSystem from "expo-file-system/legacy";

const PREFS_PATH = (FileSystem.documentDirectory ?? "") + "chronicle-prefs.json";

export interface CalendarPrefs {
  connected: boolean;
  /** IDs of the device calendars the user has chosen to import from. */
  calendarIds: string[];
}

const DEFAULT_PREFS: CalendarPrefs = { connected: false, calendarIds: [] };

async function readAll(): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await FileSystem.readAsStringAsync(PREFS_PATH)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function getCalendarPrefs(): Promise<CalendarPrefs> {
  const all = await readAll();
  const raw = all.calendarPrefs;
  if (!raw || typeof raw !== "object") return DEFAULT_PREFS;
  const p = raw as Partial<CalendarPrefs>;
  return {
    connected: typeof p.connected === "boolean" ? p.connected : false,
    calendarIds: Array.isArray(p.calendarIds) ? (p.calendarIds as string[]) : [],
  };
}

export async function setCalendarPrefs(prefs: CalendarPrefs): Promise<void> {
  const all = await readAll();
  all.calendarPrefs = prefs;
  await FileSystem.writeAsStringAsync(PREFS_PATH, JSON.stringify(all));
}
