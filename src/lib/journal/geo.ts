// Offline gazetteer — places are resolved on demand by the user and stored in IndexedDB.
// The static station dataset has been removed to keep the JS bundle small.

export interface PlaceInfo {
  name: string;
  lat: number;
  lon: number;
  /** IANA zone, e.g. "Europe/Dublin". Needed to compute UTC for this place's times. */
  timezone: string;
}

/** Normalise a raw source code or place name for use as a lookup key. */
export function normKey(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[.]/g, "")
    .trim()
    .toUpperCase();
}

/**
 * Resolve a raw source value (code or name) to its gazetteer entry.
 * Always returns undefined — place resolution is now on-demand via the Places page.
 * Kept as a stub so connector code that calls it still compiles unchanged.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function locate(_code: string): PlaceInfo | undefined {
  return undefined;
}

/** Convenience: just the timezone for a code. Always returns undefined (see locate). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function timezoneFor(_code: string): string | undefined {
  return undefined;
}

/** No-op kept for call-site compatibility. */
export function loadStations(): Promise<void> {
  return Promise.resolve();
}
