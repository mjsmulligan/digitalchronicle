// Offline gazetteer — no external place lookups, keeps journal data local.
// stations.generated.ts is lazy-loaded only when needed (e.g. on the Places page).
type Stations = typeof import("./stations.generated").STATIONS;
let stations: Stations | undefined;
let stationPromise: Promise<void> | undefined;

export function loadStations(): Promise<void> {
  if (stations) return Promise.resolve();
  stationPromise ??= import("./stations.generated")
    .then(({ STATIONS }) => {
      stations = STATIONS;
    })
    .catch((error: unknown) => {
      stationPromise = undefined;
      throw error;
    });
  return stationPromise;
}

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
 * Requires loadStations() to have been called first for station lookups.
 */
export function locate(code: string): PlaceInfo | undefined {
  const key = normKey(code);
  const station = stations?.[key];
  if (!station) return undefined;
  const [name, lat, lon, timezone] = station;
  return { name, lat, lon, timezone };
}

/** Convenience: just the timezone for a code. Returns undefined if stations not loaded. */
export function timezoneFor(code: string): string | undefined {
  return locate(code)?.timezone;
}
