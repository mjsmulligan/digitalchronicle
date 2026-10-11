/**
 * Persisted artwork preferences — stored in chronicle-prefs.json alongside
 * other user preferences (theme, home airport, Goodreads user ID, etc.).
 *
 * fetchPosters:    whether to call TMDB to look up film/show poster images.
 * fetchBookCovers: whether to call Open Library to look up book cover images.
 *
 * Default: true for both. Turning either off stops new network requests;
 * already-cached images continue to display.
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

/** Read the "Fetch posters" toggle. Defaults to true if never set. */
export async function getPosterFetchEnabled(): Promise<boolean> {
  const v = (await readPrefs()).fetchPosters;
  // undefined → pref not set yet → default on
  return v !== false;
}

/** Persist the "Fetch posters" toggle. */
export async function setPosterFetchEnabled(enabled: boolean): Promise<void> {
  const prefs = await readPrefs();
  prefs.fetchPosters = enabled;
  await writePrefs(prefs);
}

/** Read the "Fetch book covers" toggle. Defaults to true if never set. */
export async function getBookCoverFetchEnabled(): Promise<boolean> {
  const v = (await readPrefs()).fetchBookCovers;
  return v !== false;
}

/** Persist the "Fetch book covers" toggle. */
export async function setBookCoverFetchEnabled(enabled: boolean): Promise<void> {
  const prefs = await readPrefs();
  prefs.fetchBookCovers = enabled;
  await writePrefs(prefs);
}
