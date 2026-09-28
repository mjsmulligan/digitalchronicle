// Small offline gazetteer — no network lookups, keeps everything local.
export const PLACES: Record<string, { name: string; lat: number; lon: number }> = {
  LHR: { name: "London Heathrow", lat: 51.47, lon: -0.45 },
  LGW: { name: "London Gatwick", lat: 51.15, lon: -0.18 },
  BER: { name: "Berlin Brandenburg", lat: 52.36, lon: 13.5 },
  CDG: { name: "Paris CDG", lat: 49.01, lon: 2.55 },
  AMS: { name: "Amsterdam Schiphol", lat: 52.31, lon: 4.76 },
  FRA: { name: "Frankfurt", lat: 50.04, lon: 8.56 },
  MUC: { name: "Munich", lat: 48.35, lon: 11.79 },
  DUB: { name: "Dublin", lat: 53.42, lon: -6.27 },
  MAD: { name: "Madrid", lat: 40.47, lon: -3.56 },
  BCN: { name: "Barcelona", lat: 41.3, lon: 2.08 },
  LIS: { name: "Lisbon", lat: 38.77, lon: -9.13 },
  FCO: { name: "Rome Fiumicino", lat: 41.8, lon: 12.25 },
  JFK: { name: "New York JFK", lat: 40.64, lon: -73.78 },
  LAX: { name: "Los Angeles", lat: 33.94, lon: -118.41 },
  SFO: { name: "San Francisco", lat: 37.62, lon: -122.38 },
  HND: { name: "Tokyo Haneda", lat: 35.55, lon: 139.78 },
  NRT: { name: "Tokyo Narita", lat: 35.77, lon: 140.39 },
  KIX: { name: "Osaka Kansai", lat: 34.43, lon: 135.24 },
  HKG: { name: "Hong Kong", lat: 22.31, lon: 113.91 },
  SIN: { name: "Singapore", lat: 1.36, lon: 103.99 },
  DXB: { name: "Dubai", lat: 25.25, lon: 55.36 },
  SYD: { name: "Sydney", lat: -33.94, lon: 151.18 },
  // Rail stations / cities (keyed by normalised name)
  "LONDON ST PANCRAS": { name: "London St Pancras", lat: 51.53, lon: -0.13 },
  "PARIS NORD": { name: "Paris Nord", lat: 48.88, lon: 2.36 },
  "BRUSSELS MIDI": { name: "Brussels Midi", lat: 50.84, lon: 4.34 },
  "AMSTERDAM CENTRAAL": { name: "Amsterdam Centraal", lat: 52.38, lon: 4.9 },
  "BERLIN HBF": { name: "Berlin Hbf", lat: 52.52, lon: 13.37 },
  "HAMBURG HBF": { name: "Hamburg Hbf", lat: 53.55, lon: 10.01 },
  "MUNCHEN HBF": { name: "München Hbf", lat: 48.14, lon: 11.56 },
  "PRAHA HLAVNI NADRAZI": { name: "Praha hl.n.", lat: 50.08, lon: 14.43 },
  "TOKYO": { name: "Tokyo", lat: 35.68, lon: 139.77 },
  "KYOTO": { name: "Kyoto", lat: 34.99, lon: 135.76 },
  "OSAKA": { name: "Osaka", lat: 34.69, lon: 135.5 },
  "SHIN-OSAKA": { name: "Shin-Osaka", lat: 34.73, lon: 135.5 },
  "LONDON": { name: "London", lat: 51.51, lon: -0.13 },
  "BERLIN": { name: "Berlin", lat: 52.52, lon: 13.4 },
  "PARIS": { name: "Paris", lat: 48.86, lon: 2.35 },
  "AMSTERDAM": { name: "Amsterdam", lat: 52.37, lon: 4.9 },
  "PRAGUE": { name: "Prague", lat: 50.08, lon: 14.44 },
  "HAMBURG": { name: "Hamburg", lat: 53.55, lon: 9.99 },
  "MANCHESTER": { name: "Manchester", lat: 53.48, lon: -2.24 },
  "NEW YORK": { name: "New York", lat: 40.71, lon: -74.0 },
};

export function normKey(s: string) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.]/g, "")
    .trim()
    .toUpperCase();
}

export function locate(code: string) {
  return PLACES[normKey(code)];
}
