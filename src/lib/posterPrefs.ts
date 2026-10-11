/**
 * Web artwork preferences — persisted in localStorage.
 *
 * fetchPosters:     whether to call TMDB to look up film/show poster images.
 * fetchBookCovers:  whether to call Open Library to look up book cover images.
 *
 * Default: true for both. Turning either off stops new network requests;
 * already-cached images continue to display.
 */

const KEY_POSTERS = "chronicle-fetch-posters";
const KEY_BOOK_COVERS = "chronicle-fetch-book-covers";

/** Read the "Fetch posters" toggle from localStorage. Defaults to true. */
export function getPosterFetchEnabledPref(): boolean {
  try {
    const v = localStorage.getItem(KEY_POSTERS);
    return v !== "false";
  } catch {
    return true;
  }
}

/** Persist the "Fetch posters" toggle to localStorage. */
export function setPosterFetchEnabledPref(enabled: boolean): void {
  try {
    localStorage.setItem(KEY_POSTERS, enabled ? "true" : "false");
  } catch {
    // localStorage unavailable (e.g. SSR context) — ignore silently
  }
}

/** Read the "Fetch book covers" toggle from localStorage. Defaults to true. */
export function getBookCoverFetchEnabledPref(): boolean {
  try {
    const v = localStorage.getItem(KEY_BOOK_COVERS);
    return v !== "false";
  } catch {
    return true;
  }
}

/** Persist the "Fetch book covers" toggle to localStorage. */
export function setBookCoverFetchEnabledPref(enabled: boolean): void {
  try {
    localStorage.setItem(KEY_BOOK_COVERS, enabled ? "true" : "false");
  } catch {
    // localStorage unavailable (e.g. SSR context) — ignore silently
  }
}
