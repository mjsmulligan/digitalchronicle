/** Saved Goodreads user ID, stored in the same local prefs file as the theme. */
import * as FileSystem from "expo-file-system/legacy";

const PREFS_PATH = (FileSystem.documentDirectory ?? "") + "chronicle-prefs.json";

async function readPrefs(): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await FileSystem.readAsStringAsync(PREFS_PATH)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function getGoodreadsUserId(): Promise<string | null> {
  const v = (await readPrefs()).goodreadsUserId;
  return typeof v === "string" && v ? v : null;
}

export async function setGoodreadsUserId(id: string | null): Promise<void> {
  const prefs = await readPrefs();
  if (id) prefs.goodreadsUserId = id;
  else delete prefs.goodreadsUserId;
  await FileSystem.writeAsStringAsync(PREFS_PATH, JSON.stringify(prefs));
}
