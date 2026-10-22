// Offline gazetteer — no external place lookups, keeps journal data local.
// Station data is a static JSON import so both Vite and Metro resolve it at
// bundle time without dynamic-import path issues.
import STATIONS_JSON from "./stations.generated.json";
import { airportByCode } from "./airports";

type StationTuple = [string, number, number, string]; // [name, lat, lon, timezone]
const STATIONS = STATIONS_JSON as unknown as Record<string, StationTuple>;

/** No-op on this side — data is already loaded statically.  Kept for API compat. */
export function loadStations(): Promise<void> {
  return Promise.resolve();
}

// The hand-curated entries take precedence over the bundled station dataset.
export interface PlaceInfo {
  name: string;
  /** Human-readable city name for display. Falls back to name when absent. */
  city?: string;
  lat: number;
  lon: number;
  /** IANA zone, e.g. "Europe/Dublin". Needed to compute UTC for this place's times. */
  timezone: string;
}

export const PLACES: Record<string, PlaceInfo> = {
  // ── Airports ──────────────────────────────────────────────────────────────
  LHR: { name: "London Heathrow",    city: "London",        lat: 51.47,  lon: -0.45,   timezone: "Europe/London" },
  LGW: { name: "London Gatwick",     city: "London",        lat: 51.15,  lon: -0.18,   timezone: "Europe/London" },
  BER: { name: "Berlin Brandenburg", city: "Berlin",        lat: 52.36,  lon: 13.5,    timezone: "Europe/Berlin" },
  CDG: { name: "Paris CDG",          city: "Paris",         lat: 49.01,  lon: 2.55,    timezone: "Europe/Paris" },
  AMS: { name: "Amsterdam Schiphol", city: "Amsterdam",     lat: 52.31,  lon: 4.76,    timezone: "Europe/Amsterdam" },
  FRA: { name: "Frankfurt Airport",  city: "Frankfurt",     lat: 50.04,  lon: 8.56,    timezone: "Europe/Berlin" },
  MUC: { name: "Munich Airport",     city: "Munich",        lat: 48.35,  lon: 11.79,   timezone: "Europe/Berlin" },
  DUB: { name: "Dublin Airport",     city: "Dublin",        lat: 53.42,  lon: -6.27,   timezone: "Europe/Dublin" },
  MAD: { name: "Madrid Barajas",     city: "Madrid",        lat: 40.47,  lon: -3.56,   timezone: "Europe/Madrid" },
  BCN: { name: "Barcelona El Prat",  city: "Barcelona",     lat: 41.3,   lon: 2.08,    timezone: "Europe/Madrid" },
  LIS: { name: "Lisbon Airport",     city: "Lisbon",        lat: 38.77,  lon: -9.13,   timezone: "Europe/Lisbon" },
  FCO: { name: "Rome Fiumicino",     city: "Rome",          lat: 41.8,   lon: 12.25,   timezone: "Europe/Rome" },
  JFK: { name: "New York JFK",       city: "New York",      lat: 40.64,  lon: -73.78,  timezone: "America/New_York" },
  LAX: { name: "Los Angeles",        city: "Los Angeles",   lat: 33.94,  lon: -118.41, timezone: "America/Los_Angeles" },
  SFO: { name: "San Francisco",      city: "San Francisco", lat: 37.62,  lon: -122.38, timezone: "America/Los_Angeles" },
  HND: { name: "Tokyo Haneda",       city: "Tokyo",         lat: 35.55,  lon: 139.78,  timezone: "Asia/Tokyo" },
  NRT: { name: "Tokyo Narita",       city: "Tokyo",         lat: 35.77,  lon: 140.39,  timezone: "Asia/Tokyo" },
  KIX: { name: "Osaka Kansai",       city: "Osaka",         lat: 34.43,  lon: 135.24,  timezone: "Asia/Tokyo" },
  HKG: { name: "Hong Kong",          city: "Hong Kong",     lat: 22.31,  lon: 113.91,  timezone: "Asia/Hong_Kong" },
  SIN: { name: "Singapore Changi",   city: "Singapore",     lat: 1.36,   lon: 103.99,  timezone: "Asia/Singapore" },
  DXB: { name: "Dubai",              city: "Dubai",         lat: 25.25,  lon: 55.36,   timezone: "Asia/Dubai" },
  SYD: { name: "Sydney Airport",     city: "Sydney",        lat: -33.94, lon: 151.18,  timezone: "Australia/Sydney" },

  // ── Cities (free-text place names stored by older connectors) ─────────────
  LONDON:     { name: "London",    city: "London",    lat: 51.51, lon: -0.13,  timezone: "Europe/London" },
  BERLIN:     { name: "Berlin",    city: "Berlin",    lat: 52.52, lon: 13.4,   timezone: "Europe/Berlin" },
  PARIS:      { name: "Paris",     city: "Paris",     lat: 48.86, lon: 2.35,   timezone: "Europe/Paris" },
  AMSTERDAM:  { name: "Amsterdam", city: "Amsterdam", lat: 52.37, lon: 4.9,    timezone: "Europe/Amsterdam" },
  PRAGUE:     { name: "Prague",    city: "Prague",    lat: 50.08, lon: 14.44,  timezone: "Europe/Prague" },
  HAMBURG:    { name: "Hamburg",   city: "Hamburg",   lat: 53.55, lon: 9.99,   timezone: "Europe/Berlin" },
  MANCHESTER: { name: "Manchester",city: "Manchester",lat: 53.48, lon: -2.24,  timezone: "Europe/London" },
  "NEW YORK": { name: "New York",  city: "New York",  lat: 40.71, lon: -74.0,  timezone: "America/New_York" },
  TOKYO:      { name: "Tokyo",     city: "Tokyo",     lat: 35.68, lon: 139.77, timezone: "Asia/Tokyo" },
  KYOTO:      { name: "Kyoto",     city: "Kyoto",     lat: 34.99, lon: 135.76, timezone: "Asia/Tokyo" },
  OSAKA:      { name: "Osaka",     city: "Osaka",     lat: 34.69, lon: 135.5,  timezone: "Asia/Tokyo" },
  "SHIN-OSAKA":{ name: "Shin-Osaka",city:"Osaka",     lat: 34.73, lon: 135.5,  timezone: "Asia/Tokyo" },

  // ── Rail stations (keyed by normalised name from calendar events) ─────────
  // Ireland
  "DUBLIN CONNOLLY":      { name: "Dublin Connolly",      city: "Dublin",   lat: 53.35, lon: -6.25, timezone: "Europe/Dublin" },
  "DUBLIN HEUSTON":       { name: "Dublin Heuston",       city: "Dublin",   lat: 53.35, lon: -6.29, timezone: "Europe/Dublin" },
  "DUBLIN PEARSE":        { name: "Dublin Pearse",        city: "Dublin",   lat: 53.34, lon: -6.25, timezone: "Europe/Dublin" },
  "CORK":                 { name: "Cork Kent",            city: "Cork",     lat: 51.9,  lon: -8.47, timezone: "Europe/Dublin" },
  "CORK KENT":            { name: "Cork Kent",            city: "Cork",     lat: 51.9,  lon: -8.47, timezone: "Europe/Dublin" },
  "GALWAY":               { name: "Galway",               city: "Galway",   lat: 53.27, lon: -9.06, timezone: "Europe/Dublin" },
  "LIMERICK":             { name: "Limerick",             city: "Limerick", lat: 52.66, lon: -8.63, timezone: "Europe/Dublin" },
  "LIMERICK JUNCTION":    { name: "Limerick Junction",    city: "Limerick", lat: 52.5,  lon: -8.16, timezone: "Europe/Dublin" },
  // UK — London termini
  "LONDON ST PANCRAS":            { name: "London St Pancras",          city: "London", lat: 51.53,  lon: -0.13,  timezone: "Europe/London" },
  "LONDON ST PANCRAS INTERNATIONAL":{ name: "St Pancras International", city: "London", lat: 51.53,  lon: -0.13,  timezone: "Europe/London" },
  "LONDON PADDINGTON":    { name: "London Paddington",    city: "London", lat: 51.52, lon: -0.18, timezone: "Europe/London" },
  "LONDON WATERLOO":      { name: "London Waterloo",      city: "London", lat: 51.5,  lon: -0.11, timezone: "Europe/London" },
  "LONDON VICTORIA":      { name: "London Victoria",      city: "London", lat: 51.5,  lon: -0.14, timezone: "Europe/London" },
  "LONDON EUSTON":        { name: "London Euston",        city: "London", lat: 51.53, lon: -0.13, timezone: "Europe/London" },
  "LONDON KINGS CROSS":   { name: "London King's Cross",  city: "London", lat: 51.53, lon: -0.12, timezone: "Europe/London" },
  "LONDON KING'S CROSS":  { name: "London King's Cross",  city: "London", lat: 51.53, lon: -0.12, timezone: "Europe/London" },
  "LONDON LIVERPOOL STREET":{ name: "London Liverpool Street", city: "London", lat: 51.52, lon: -0.08, timezone: "Europe/London" },
  "LONDON BRIDGE":        { name: "London Bridge",        city: "London", lat: 51.51, lon: -0.09, timezone: "Europe/London" },
  "LONDON CANNON STREET": { name: "London Cannon Street", city: "London", lat: 51.51, lon: -0.09, timezone: "Europe/London" },
  "LONDON CHARING CROSS": { name: "London Charing Cross", city: "London", lat: 51.51, lon: -0.12, timezone: "Europe/London" },
  "LONDON MARYLEBONE":    { name: "London Marylebone",    city: "London", lat: 51.52, lon: -0.16, timezone: "Europe/London" },
  "LONDON BLACKFRIARS":   { name: "London Blackfriars",   city: "London", lat: 51.51, lon: -0.1,  timezone: "Europe/London" },
  // UK — regional
  "EDINBURGH WAVERLEY":   { name: "Edinburgh Waverley",   city: "Edinburgh",  lat: 55.95, lon: -3.19,  timezone: "Europe/London" },
  "GLASGOW CENTRAL":      { name: "Glasgow Central",      city: "Glasgow",    lat: 55.86, lon: -4.26,  timezone: "Europe/London" },
  "GLASGOW QUEEN STREET": { name: "Glasgow Queen Street", city: "Glasgow",    lat: 55.86, lon: -4.25,  timezone: "Europe/London" },
  "MANCHESTER PICCADILLY":{ name: "Manchester Piccadilly",city: "Manchester", lat: 53.48, lon: -2.23,  timezone: "Europe/London" },
  "MANCHESTER VICTORIA":  { name: "Manchester Victoria",  city: "Manchester", lat: 53.49, lon: -2.24,  timezone: "Europe/London" },
  "BIRMINGHAM NEW STREET":{ name: "Birmingham New Street",city: "Birmingham", lat: 52.48, lon: -1.9,   timezone: "Europe/London" },
  "BRISTOL TEMPLE MEADS": { name: "Bristol Temple Meads", city: "Bristol",    lat: 51.45, lon: -2.58,  timezone: "Europe/London" },
  "LEEDS":                { name: "Leeds",                city: "Leeds",      lat: 53.79, lon: -1.55,  timezone: "Europe/London" },
  "SHEFFIELD":            { name: "Sheffield",            city: "Sheffield",  lat: 53.38, lon: -1.46,  timezone: "Europe/London" },
  "LIVERPOOL LIME STREET":{ name: "Liverpool Lime Street",city: "Liverpool",  lat: 53.41, lon: -2.98,  timezone: "Europe/London" },
  "EXETER ST DAVIDS":     { name: "Exeter St Davids",     city: "Exeter",     lat: 50.73, lon: -3.54,  timezone: "Europe/London" },
  "READING":              { name: "Reading",              city: "Reading",    lat: 51.46, lon: -0.97,  timezone: "Europe/London" },
  "CAMBRIDGE":            { name: "Cambridge",            city: "Cambridge",  lat: 52.19, lon: 0.14,   timezone: "Europe/London" },
  "OXFORD":               { name: "Oxford",               city: "Oxford",     lat: 51.75, lon: -1.27,  timezone: "Europe/London" },
  "CARDIFF CENTRAL":      { name: "Cardiff Central",      city: "Cardiff",    lat: 51.47, lon: -3.18,  timezone: "Europe/London" },
  "BATH SPA":             { name: "Bath Spa",             city: "Bath",       lat: 51.38, lon: -2.36,  timezone: "Europe/London" },
  "YORK":                 { name: "York",                 city: "York",       lat: 53.96, lon: -1.09,  timezone: "Europe/London" },
  "NEWCASTLE":            { name: "Newcastle",            city: "Newcastle",  lat: 54.97, lon: -1.62,  timezone: "Europe/London" },
  "BRIGHTON":             { name: "Brighton",             city: "Brighton",   lat: 50.83, lon: -0.14,  timezone: "Europe/London" },
  "SOUTHAMPTON CENTRAL":  { name: "Southampton Central",  city: "Southampton",lat: 50.91, lon: -1.41,  timezone: "Europe/London" },
  // France
  "PARIS NORD":           { name: "Paris Gare du Nord",   city: "Paris", lat: 48.88, lon: 2.36,  timezone: "Europe/Paris" },
  "PARIS GARE DU NORD":   { name: "Paris Gare du Nord",   city: "Paris", lat: 48.88, lon: 2.36,  timezone: "Europe/Paris" },
  "PARIS GARE DE LYON":   { name: "Paris Gare de Lyon",   city: "Paris", lat: 48.84, lon: 2.37,  timezone: "Europe/Paris" },
  "PARIS GARE DE L'EST":  { name: "Paris Gare de l'Est",  city: "Paris", lat: 48.88, lon: 2.36,  timezone: "Europe/Paris" },
  "PARIS MONTPARNASSE":   { name: "Paris Montparnasse",   city: "Paris", lat: 48.84, lon: 2.32,  timezone: "Europe/Paris" },
  "PARIS SAINT-LAZARE":   { name: "Paris Saint-Lazare",   city: "Paris", lat: 48.88, lon: 2.32,  timezone: "Europe/Paris" },
  "PARIS ST LAZARE":      { name: "Paris Saint-Lazare",   city: "Paris", lat: 48.88, lon: 2.32,  timezone: "Europe/Paris" },
  "LYON PART-DIEU":       { name: "Lyon Part-Dieu",       city: "Lyon",      lat: 45.76, lon: 4.86,  timezone: "Europe/Paris" },
  "MARSEILLE ST CHARLES": { name: "Marseille St-Charles", city: "Marseille", lat: 43.3,  lon: 5.38,  timezone: "Europe/Paris" },
  "BORDEAUX ST JEAN":     { name: "Bordeaux Saint-Jean",  city: "Bordeaux",  lat: 44.83, lon: -0.56, timezone: "Europe/Paris" },
  "LILLE FLANDRES":       { name: "Lille Flandres",       city: "Lille",     lat: 50.64, lon: 3.07,  timezone: "Europe/Paris" },
  "LILLE EUROPE":         { name: "Lille Europe",         city: "Lille",     lat: 50.64, lon: 3.08,  timezone: "Europe/Paris" },
  "STRASBOURG":           { name: "Strasbourg",           city: "Strasbourg",lat: 48.58, lon: 7.73,  timezone: "Europe/Paris" },
  "NICE VILLE":           { name: "Nice Ville",           city: "Nice",      lat: 43.7,  lon: 7.26,  timezone: "Europe/Paris" },
  // Belgium / Netherlands
  "BRUSSELS MIDI":        { name: "Brussels-Midi/Zuid",   city: "Brussels",  lat: 50.84, lon: 4.34, timezone: "Europe/Brussels" },
  "BRUSSELS CENTRAL":     { name: "Brussels Central",     city: "Brussels",  lat: 50.85, lon: 4.36, timezone: "Europe/Brussels" },
  "AMSTERDAM CENTRAAL":   { name: "Amsterdam Centraal",   city: "Amsterdam", lat: 52.38, lon: 4.9,  timezone: "Europe/Amsterdam" },
  "ROTTERDAM CENTRAAL":   { name: "Rotterdam Centraal",   city: "Rotterdam", lat: 51.92, lon: 4.47, timezone: "Europe/Amsterdam" },
  "UTRECHT CENTRAAL":     { name: "Utrecht Centraal",     city: "Utrecht",   lat: 52.09, lon: 5.11, timezone: "Europe/Amsterdam" },
  "ANTWERP CENTRAL":      { name: "Antwerp Central",      city: "Antwerp",   lat: 51.22, lon: 4.42, timezone: "Europe/Brussels" },
  // Germany
  "BERLIN HBF":           { name: "Berlin Hbf",           city: "Berlin",    lat: 52.52, lon: 13.37, timezone: "Europe/Berlin" },
  "HAMBURG HBF":          { name: "Hamburg Hbf",          city: "Hamburg",   lat: 53.55, lon: 10.01, timezone: "Europe/Berlin" },
  "MUNCHEN HBF":          { name: "München Hbf",          city: "Munich",    lat: 48.14, lon: 11.56, timezone: "Europe/Berlin" },
  "MUNCHEN HAUPTBAHNHOF": { name: "München Hbf",          city: "Munich",    lat: 48.14, lon: 11.56, timezone: "Europe/Berlin" },
  "FRANKFURT HBF":        { name: "Frankfurt Hbf",        city: "Frankfurt", lat: 50.11, lon: 8.66,  timezone: "Europe/Berlin" },
  "FRANKFURT HAUPTBAHNHOF":{ name: "Frankfurt Hbf",       city: "Frankfurt", lat: 50.11, lon: 8.66,  timezone: "Europe/Berlin" },
  "COLOGNE HBF":          { name: "Köln Hbf",             city: "Cologne",   lat: 50.94, lon: 6.96,  timezone: "Europe/Berlin" },
  "KOLN HBF":             { name: "Köln Hbf",             city: "Cologne",   lat: 50.94, lon: 6.96,  timezone: "Europe/Berlin" },
  "DUSSELDORF HBF":       { name: "Düsseldorf Hbf",       city: "Düsseldorf",lat: 51.22, lon: 6.79,  timezone: "Europe/Berlin" },
  "STUTTGART HBF":        { name: "Stuttgart Hbf",        city: "Stuttgart", lat: 48.78, lon: 9.18,  timezone: "Europe/Berlin" },
  "HAMBURG HAUPTBAHNHOF": { name: "Hamburg Hbf",          city: "Hamburg",   lat: 53.55, lon: 10.01, timezone: "Europe/Berlin" },
  "BERLIN HAUPTBAHNHOF":  { name: "Berlin Hbf",           city: "Berlin",    lat: 52.52, lon: 13.37, timezone: "Europe/Berlin" },
  "PRAHA HLAVNI NADRAZI": { name: "Praha hl.n.",          city: "Prague",    lat: 50.08, lon: 14.43, timezone: "Europe/Prague" },
  "PRAGUE HLAVNI NADRAZI":{ name: "Praha hl.n.",          city: "Prague",    lat: 50.08, lon: 14.43, timezone: "Europe/Prague" },
  // Switzerland / Austria
  "ZURICH HB":            { name: "Zürich HB",            city: "Zürich",    lat: 47.38, lon: 8.54,  timezone: "Europe/Zurich" },
  "ZURICH HAUPTBAHNHOF":  { name: "Zürich HB",            city: "Zürich",    lat: 47.38, lon: 8.54,  timezone: "Europe/Zurich" },
  "GENEVA":               { name: "Genève-Cornavin",      city: "Geneva",    lat: 46.21, lon: 6.14,  timezone: "Europe/Zurich" },
  "GENEVE CORNAVIN":      { name: "Genève-Cornavin",      city: "Geneva",    lat: 46.21, lon: 6.14,  timezone: "Europe/Zurich" },
  "BERN":                 { name: "Bern",                 city: "Bern",      lat: 46.95, lon: 7.44,  timezone: "Europe/Zurich" },
  "BASEL SBB":            { name: "Basel SBB",            city: "Basel",     lat: 47.55, lon: 7.59,  timezone: "Europe/Zurich" },
  "VIENNA HAUPTBAHNHOF":  { name: "Wien Hauptbahnhof",    city: "Vienna",    lat: 48.18, lon: 16.38, timezone: "Europe/Vienna" },
  "WIEN HAUPTBAHNHOF":    { name: "Wien Hauptbahnhof",    city: "Vienna",    lat: 48.18, lon: 16.38, timezone: "Europe/Vienna" },
  "VIENNA WESTBAHNHOF":   { name: "Wien Westbahnhof",     city: "Vienna",    lat: 48.2,  lon: 16.34, timezone: "Europe/Vienna" },
  "SALZBURG":             { name: "Salzburg",             city: "Salzburg",  lat: 47.81, lon: 13.04, timezone: "Europe/Vienna" },
  "INNSBRUCK HBF":        { name: "Innsbruck Hbf",        city: "Innsbruck", lat: 47.26, lon: 11.4,  timezone: "Europe/Vienna" },
  // Italy
  "ROME TERMINI":         { name: "Roma Termini",         city: "Rome",      lat: 41.9,  lon: 12.5,  timezone: "Europe/Rome" },
  "ROMA TERMINI":         { name: "Roma Termini",         city: "Rome",      lat: 41.9,  lon: 12.5,  timezone: "Europe/Rome" },
  "MILAN CENTRALE":       { name: "Milano Centrale",      city: "Milan",     lat: 45.49, lon: 9.2,   timezone: "Europe/Rome" },
  "MILANO CENTRALE":      { name: "Milano Centrale",      city: "Milan",     lat: 45.49, lon: 9.2,   timezone: "Europe/Rome" },
  "FLORENCE SMN":         { name: "Firenze S.M.N.",       city: "Florence",  lat: 43.78, lon: 11.25, timezone: "Europe/Rome" },
  "FIRENZE SMN":          { name: "Firenze S.M.N.",       city: "Florence",  lat: 43.78, lon: 11.25, timezone: "Europe/Rome" },
  "VENICE SANTA LUCIA":   { name: "Venezia S. Lucia",     city: "Venice",    lat: 45.44, lon: 12.32, timezone: "Europe/Rome" },
  "VENEZIA SANTA LUCIA":  { name: "Venezia S. Lucia",     city: "Venice",    lat: 45.44, lon: 12.32, timezone: "Europe/Rome" },
  "NAPLES CENTRALE":      { name: "Napoli Centrale",      city: "Naples",    lat: 40.85, lon: 14.27, timezone: "Europe/Rome" },
  "NAPOLI CENTRALE":      { name: "Napoli Centrale",      city: "Naples",    lat: 40.85, lon: 14.27, timezone: "Europe/Rome" },
  "BOLOGNA CENTRALE":     { name: "Bologna Centrale",     city: "Bologna",   lat: 44.51, lon: 11.34, timezone: "Europe/Rome" },
  "TURIN PORTA NUOVA":    { name: "Torino Porta Nuova",   city: "Turin",     lat: 45.06, lon: 7.68,  timezone: "Europe/Rome" },
  // Spain
  "MADRID ATOCHA":        { name: "Madrid Puerta de Atocha", city: "Madrid",    lat: 40.41, lon: -3.69, timezone: "Europe/Madrid" },
  "MADRID PUERTA DE ATOCHA":{ name: "Madrid Puerta de Atocha", city: "Madrid",  lat: 40.41, lon: -3.69, timezone: "Europe/Madrid" },
  "BARCELONA SANTS":      { name: "Barcelona Sants",      city: "Barcelona", lat: 41.38, lon: 2.14, timezone: "Europe/Madrid" },
  "BARCELONA PASSEIG DE GRACIA":{ name: "Barcelona Passeig de Gràcia", city: "Barcelona", lat: 41.39, lon: 2.16, timezone: "Europe/Madrid" },
  "SEVILLE SANTA JUSTA":  { name: "Sevilla Santa Justa",  city: "Seville",   lat: 37.39, lon: -5.98, timezone: "Europe/Madrid" },
  "VALENCIA JOAQUIN SOROLLA":{ name: "Valencia Joaquín Sorolla", city: "Valencia", lat: 39.47, lon: -0.38, timezone: "Europe/Madrid" },
  // USA
  "NEW YORK PENN STATION":    { name: "New York Penn Station",    city: "New York",  lat: 40.75,  lon: -73.99, timezone: "America/New_York" },
  "NEW YORK GRAND CENTRAL":   { name: "New York Grand Central",   city: "New York",  lat: 40.75,  lon: -73.98, timezone: "America/New_York" },
  "WASHINGTON UNION STATION": { name: "Washington Union Station", city: "Washington",lat: 38.9,   lon: -77.0,  timezone: "America/New_York" },
  "BOSTON SOUTH STATION":     { name: "Boston South Station",     city: "Boston",    lat: 42.35,  lon: -71.06, timezone: "America/New_York" },
  "CHICAGO UNION STATION":    { name: "Chicago Union Station",    city: "Chicago",   lat: 41.88,  lon: -87.64, timezone: "America/Chicago" },
  "LOS ANGELES UNION STATION":{ name: "Los Angeles Union Station",city: "Los Angeles",lat: 34.06, lon: -118.24,timezone: "America/Los_Angeles" },
};

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
  const curated = PLACES[key];
  if (curated) return curated;
  const station = STATIONS[key];
  if (station) {
    const [name, lat, lon, timezone] = station;
    return { name, lat, lon, timezone };
  }
  // Airports last: a bare 3-letter code that is not a curated place or a station.
  if (/^[A-Z]{3}$/.test(key)) {
    const airport = airportByCode(key);
    if (airport) return { name: airport.name, lat: airport.lat, lon: airport.lon, timezone: airport.timezone };
  }
  return undefined;
}

/** Convenience: just the timezone for a code. Returns undefined if stations not loaded. */
export function timezoneFor(code: string): string | undefined {
  return locate(code)?.timezone;
}

/**
 * Best human-readable city/place name for a raw `from`/`to` leg value.
 *
 * Resolution order:
 *   1. Empty string or "???" sentinel → returns "" (caller should show "–" or hide the field)
 *   2. Bare IATA airport code (3 letters) → airport.city from the bundled airports table
 *   3. Curated PLACES entry (airport code or normalised station name) → entry.city ?? entry.name
 *   4. Trainline station dataset (52k entries) → station name as stored (already readable)
 *   5. Fallback → the input value unchanged
 *
 * This is a read-time display helper — it never modifies stored data.
 */
export function locationLabel(code: string): string {
  if (!code || code === "???") return "";

  // 1. IATA airport code — use the airport's city field for a clean city name.
  const key = normKey(code);
  if (/^[A-Z]{3}$/.test(key)) {
    const airport = airportByCode(key);
    if (airport) return airport.city;
  }

  // 2. Curated PLACES (airports with overridden display or rail stations).
  const curated = PLACES[key];
  if (curated) return curated.city ?? curated.name;

  // 3. Trainline stations dataset — name is canonical but city-level phrasing
  //    is not guaranteed; return it as-is since it is still more readable than
  //    a raw code.
  const station = STATIONS[key];
  if (station) return station[0]; // [name, lat, lon, timezone]

  // 4. Fallback — the value is already free text (e.g. typed city name).
  return code;
}
