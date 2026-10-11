/**
 * Web poster preferences — persisted in localStorage.
 *
 * fetchPosters: whether to call TMDB to look up and download poster images.
 *   Default: true. Turning this off stops all new network requests; posters
 *   already cached in the browser image cache continue to display.
 */

const KEY = "chronicle-fetch-posters";

/** Read the "Fetch posters" toggle from localStorage. Defaults to true. */
export function getPosterFetchEnabledPref(): boolean {
  try {
    const v = localStorage.getItem(KEY);
    return v !== "false";
  } catch {
    return true;
  }
}

/** Persist the "Fetch posters" toggle to localStorage. */
export function setPosterFetchEnabledPref(enabled: boolean): void {
  try {
    localStorage.setItem(KEY, enabled ? "true" : "false");
  } catch {
    // localStorage unavailable (e.g. SSR context) — ignore silently
  }
}
