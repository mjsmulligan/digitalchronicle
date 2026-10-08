/**
 * Home preferences — display name and home airport/station code(s).
 * Stored in the shared chronicle-prefs.json file, following the same
 * read/write pattern as goodreadsPrefs.ts and scanPrefs.ts.
 *
 * homeAirports is an array of IATA or station codes (e.g. ["DUB"]).
 * The trip suggestion logic uses these codes plus gazetteer proximity
 * to identify home departures for both air and rail legs.
 */
import * as FileSystem from "expo-file-system/legacy";

const PREFS_PATH = (FileSystem.documentDirectory ?? "") + "chronicle-prefs.json";

async function readPrefs(): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await FileSystem.readAsStringAsync(PREFS_PATH)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function writePrefs(prefs: Record<string, unknown>): Promise<void> {
  await FileSystem.writeAsStringAsync(PREFS_PATH, JSON.stringify(prefs));
}

export interface HomePrefs {
  /** Your display name, e.g. "Mike" */
  displayName: string;
  /**
   * Home airport or station codes, e.g. ["DUB"].
   * Nearby stations within HOME_RADIUS_KM are also treated as home departures,
   * so one airport code covers the surrounding city's rail stations too.
   */
  homeAirports: string[];
}

export async function getHomePrefs(): Promise<HomePrefs> {
  const prefs = await readPrefs();
  const displayName = typeof prefs.displayName === "string" ? prefs.displayName : "";
  const raw = prefs.homeAirports;
  const homeAirports = Array.isArray(raw)
    ? (raw as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  return { displayName, homeAirports };
}

export async function setHomePrefs(update: Partial<HomePrefs>): Promise<void> {
  const prefs = await readPrefs();
  if (update.displayName !== undefined) {
    if (update.displayName.trim()) prefs.displayName = update.displayName.trim();
    else delete prefs.displayName;
  }
  if (update.homeAirports !== undefined) {
    if (update.homeAirports.length) prefs.homeAirports = update.homeAirports;
    else delete prefs.homeAirports;
  }
  await writePrefs(prefs);
}
