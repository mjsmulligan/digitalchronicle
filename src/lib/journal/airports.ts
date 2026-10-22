// Offline airport gazetteer (OurAirports, public domain). No runtime lookups:
// the table is a bundled static JSON import, like stations.generated.json.
import AIRPORTS_JSON from "./airports.generated.json";

/** [name, municipality, ISO country, lat, lon, IANA timezone, size rank 3|2|1] */
type AirportTuple = [string, string, string, number, number, string, number];
const AIRPORTS = AIRPORTS_JSON as unknown as Record<string, AirportTuple>;

export interface Airport {
  code: string;
  name: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
  timezone: string;
  /** 3 large, 2 medium, 1 small. Breaks ties between airports in one city. */
  rank: number;
}

function toAirport(code: string, t: AirportTuple): Airport {
  return { code, name: t[0], city: t[1], country: t[2], lat: t[3], lon: t[4], timezone: t[5], rank: t[6] };
}

export function airportByCode(code: string): Airport | undefined {
  const key = code.trim().toUpperCase();
  const t = AIRPORTS[key];
  return t ? toAirport(key, t) : undefined;
}

export function isAirportCode(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(AIRPORTS, code.trim().toUpperCase());
}

/**
 * Resolve an IATA code to its municipality/city name.
 * Returns the original code unchanged when it isn't in the airports table
 * (e.g. train station codes, "???", free-text place names).
 *   "DUB" → "Dublin"
 *   "LHR" → "London"
 *   "PARIS GARE DU NORD" → "PARIS GARE DU NORD"  (no lookup)
 */
export function codeToCity(code: string): string {
  return airportByCode(code)?.city ?? code;
}

// ---------------------------------------------------------------------------
// Free-text resolution ("Dublin", "Faro Airport", "Milan Linate")
// ---------------------------------------------------------------------------

/** Lowercase, accent-free, punctuation-free, single-spaced. */
export function normText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Words that describe the facility rather than the place. */
const GENERIC_WORDS = new Set([
  "airport", "airports", "international", "intl", "regional", "municipal", "national",
  "aeropuerto", "aeroporto", "aeroport", "aeroporti", "flughafen", "lufthavn", "airfield",
  "terminal", "the", "city", "field", "airbase",
]);

function stripGeneric(norm: string): string {
  return norm.split(" ").filter((w) => w && !GENERIC_WORDS.has(w)).join(" ");
}

let INDEX: Map<string, Set<string>> | null = null;

function addKey(index: Map<string, Set<string>>, key: string, code: string) {
  if (key.length < 3) return;
  const set = index.get(key);
  if (set) set.add(code);
  else index.set(key, new Set([code]));
}

function buildIndex(): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const [code, t] of Object.entries(AIRPORTS)) {
    const [name, municipality] = t;
    // City: drop parentheticals and anything after a comma ("Paris (Orly, Val-de-Marne)").
    const city = municipality.replace(/\(.*?\)/g, "").split(",")[0];
    addKey(index, normText(city), code);
    // Airport name, whole and by " - " segment ("Faro - Gago Coutinho International Airport").
    addKey(index, stripGeneric(normText(name)), code);
    for (const part of name.split(/\s+-\s+/)) addKey(index, stripGeneric(normText(part)), code);
  }
  return index;
}

export interface AirportResolution {
  /** Set when exactly one airport fits (or one clearly outranks the rest). */
  code?: string;
  /** All airports that fit, best first. More than one with no `code` means ambiguous. */
  candidates: string[];
}

/**
 * Resolve a code or a free-text place to an airport.
 *   "DUB"                    -> DUB
 *   "Dublin Airport"         -> DUB (a small US airport also in a "Dublin" loses on size)
 *   "London"                 -> ambiguous (LHR, LGW, STN, ...)
 *   "Faro"                   -> FAO
 */
export function resolveAirportText(text: string): AirportResolution {
  const trimmed = text.trim();
  if (!trimmed) return { candidates: [] };

  if (/^[A-Za-z]{3}$/.test(trimmed) && isAirportCode(trimmed)) {
    const code = trimmed.toUpperCase();
    return { code, candidates: [code] };
  }

  INDEX ??= buildIndex();
  const norm = normText(trimmed);
  const key = stripGeneric(norm) || norm;
  const found = INDEX.get(key) ?? INDEX.get(norm);
  if (!found || found.size === 0) return { candidates: [] };

  const ranked = [...found].sort((a, b) => AIRPORTS[b][6] - AIRPORTS[a][6] || a.localeCompare(b));
  const topRank = AIRPORTS[ranked[0]][6];
  const top = ranked.filter((c) => AIRPORTS[c][6] === topRank);
  return top.length === 1 ? { code: top[0], candidates: ranked } : { candidates: ranked };
}
