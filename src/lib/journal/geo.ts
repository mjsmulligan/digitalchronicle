// Offline gazetteer — no external place lookups, keeps journal data local.
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

// The hand-curated entries take precedence over the bundled station dataset.
export interface PlaceInfo {
  name: string;
  lat: number;
  lon: number;
  /** IANA zone, e.g. "Europe/Dublin". Needed to compute UTC for this place's times. */
  timezone: string;
}

export const PLACES: Record<string, PlaceInfo> = {
  LHR: { name: "London Heathrow", lat: 51.47, lon: -0.45, timezone: "Europe/London" },
  LGW: { name: "London Gatwick", lat: 51.15, lon: -0.18, timezone: "Europe/London" },
  BER: { name: "Berlin Brandenburg", lat: 52.36, lon: 13.5, timezone: "Europe/Berlin" },
  CDG: { name: "Paris CDG", lat: 49.01, lon: 2.55, timezone: "Europe/Paris" },
  AMS: { name: "Amsterdam Schiphol", lat: 52.31, lon: 4.76, timezone: "Europe/Amsterdam" },
  FRA: { name: "Frankfurt", lat: 50.04, lon: 8.56, timezone: "Europe/Berlin" },
  MUC: { name: "Munich", lat: 48.35, lon: 11.79, timezone: "Europe/Berlin" },
  DUB: { name: "Dublin", lat: 53.42, lon: -6.27, timezone: "Europe/Dublin" },
  MAD: { name: "Madrid", lat: 40.47, lon: -3.56, timezone: "Europe/Madrid" },
  BCN: { name: "Barcelona", lat: 41.3, lon: 2.08, timezone: "Europe/Madrid" },
  LIS: { name: "Lisbon", lat: 38.77, lon: -9.13, timezone: "Europe/Lisbon" },
  FCO: { name: "Rome Fiumicino", lat: 41.8, lon: 12.25, timezone: "Europe/Rome" },
  JFK: { name: "New York JFK", lat: 40.64, lon: -73.78, timezone: "America/New_York" },
  LAX: { name: "Los Angeles", lat: 33.94, lon: -118.41, timezone: "America/Los_Angeles" },
  SFO: { name: "San Francisco", lat: 37.62, lon: -122.38, timezone: "America/Los_Angeles" },
  HND: { name: "Tokyo Haneda", lat: 35.55, lon: 139.78, timezone: "Asia/Tokyo" },
  NRT: { name: "Tokyo Narita", lat: 35.77, lon: 140.39, timezone: "Asia/Tokyo" },
  KIX: { name: "Osaka Kansai", lat: 34.43, lon: 135.24, timezone: "Asia/Tokyo" },
  HKG: { name: "Hong Kong", lat: 22.31, lon: 113.91, timezone: "Asia/Hong_Kong" },
  SIN: { name: "Singapore", lat: 1.36, lon: 103.99, timezone: "Asia/Singapore" },
  DXB: { name: "Dubai", lat: 25.25, lon: 55.36, timezone: "Asia/Dubai" },
  SYD: { name: "Sydney", lat: -33.94, lon: 151.18, timezone: "Australia/Sydney" },
  // Rail stations / cities (keyed by normalised name)
  "LONDON ST PANCRAS": { name: "London St Pancras", lat: 51.53, lon: -0.13, timezone: "Europe/London" },
  "PARIS NORD": { name: "Paris Nord", lat: 48.88, lon: 2.36, timezone: "Europe/Paris" },
  "BRUSSELS MIDI": { name: "Brussels Midi", lat: 50.84, lon: 4.34, timezone: "Europe/Brussels" },
  "AMSTERDAM CENTRAAL": { name: "Amsterdam Centraal", lat: 52.38, lon: 4.9, timezone: "Europe/Amsterdam" },
  "BERLIN HBF": { name: "Berlin Hbf", lat: 52.52, lon: 13.37, timezone: "Europe/Berlin" },
  "HAMBURG HBF": { name: "Hamburg Hbf", lat: 53.55, lon: 10.01, timezone: "Europe/Berlin" },
  "MUNCHEN HBF": { name: "München Hbf", lat: 48.14, lon: 11.56, timezone: "Europe/Berlin" },
  "PRAHA HLAVNI NADRAZI": { name: "Praha hl.n.", lat: 50.08, lon: 14.43, timezone: "Europe/Prague" },
  TOKYO: { name: "Tokyo", lat: 35.68, lon: 139.77, timezone: "Asia/Tokyo" },
  KYOTO: { name: "Kyoto", lat: 34.99, lon: 135.76, timezone: "Asia/Tokyo" },
  OSAKA: { name: "Osaka", lat: 34.69, lon: 135.5, timezone: "Asia/Tokyo" },
  "SHIN-OSAKA": { name: "Shin-Osaka", lat: 34.73, lon: 135.5, timezone: "Asia/Tokyo" },
  LONDON: { name: "London", lat: 51.51, lon: -0.13, timezone: "Europe/London" },
  BERLIN: { name: "Berlin", lat: 52.52, lon: 13.4, timezone: "Europe/Berlin" },
  PARIS: { name: "Paris", lat: 48.86, lon: 2.35, timezone: "Europe/Paris" },
  AMSTERDAM: { name: "Amsterdam", lat: 52.37, lon: 4.9, timezone: "Europe/Amsterdam" },
  PRAGUE: { name: "Prague", lat: 50.08, lon: 14.44, timezone: "Europe/Prague" },
  HAMBURG: { name: "Hamburg", lat: 53.55, lon: 9.99, timezone: "Europe/Berlin" },
  MANCHESTER: { name: "Manchester", lat: 53.48, lon: -2.24, timezone: "Europe/London" },
  "NEW YORK": { name: "New York", lat: 40.71, lon: -74.0, timezone: "America/New_York" },
};

export function normKey(s: string) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.]/g, "")
    .trim()
    .toUpperCase();
}

/** Resolve a raw source value (code or name) to its gazetteer entry, if known. */
export function locate(code: string): PlaceInfo | undefined {
  const key = normKey(code);
  const curated = PLACES[key];
  if (curated) return curated;
  const station = stations?.[key];
  if (!station) return undefined;
  const [name, lat, lon, timezone] = station;
  return { name, lat, lon, timezone };
}

/** Convenience: just the timezone, for wiring up UTC conversion in the parsers. */
export function timezoneFor(code: string): string | undefined {
  return locate(code)?.timezone;
}
