/**
 * Source marks — brand chips for known data sources and transport operators.
 * Shared by web (SourceIcon.tsx) and mobile (SourceMark.tsx) renderers.
 *
 * Two mark types:
 *   PathMarkDef — an SVG path glyph rendered inside a faint tinted chip (24×24 viewBox).
 *                 Used for media/streaming sources with official Simple Icons glyphs (CC0).
 *   TextMarkDef — a solid-colour chip with a short text label (IATA code, operator initials).
 *                 Used for airlines and train operators where a glyph mark is impractical
 *                 at the ~14 dp chip size.
 *
 * Viaduct (the import connector) gets a custom chevron glyph in their brand green.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type PathMarkDef = {
  type: "path";
  /** SVG path `d` string for a 24×24 viewBox. */
  d: string;
  /** Brand hue (hex). Chip bg = color at 15 % opacity; glyph = solid color. */
  color: string;
};

export type TextMarkDef = {
  type: "text";
  /** 1–4 character label (IATA code, rail operator initials, etc.). */
  label: string;
  /** Solid chip background color (hex). */
  bg: string;
  /** Text color (hex). Typically white; yellow for dark-navy chips. */
  fg: string;
};

export type SourceMarkDef = PathMarkDef | TextMarkDef;

// ── Registry ─────────────────────────────────────────────────────────────────

export const SOURCE_MARKS: Record<string, SourceMarkDef> = {

  // ── Media / streaming connectors (PathMark — Simple Icons CC0) ────────────

  netflix: {
    type: "path",
    d: "m5.398 0 8.348 23.602c2.346.059 4.856.398 4.856.398L10.113 0H5.398zm8.489 0v9.172l4.715 13.33V0h-4.715zM5.398 1.5V24c1.873-.225 2.81-.312 4.715-.398V14.83L5.398 1.5z",
    color: "#d64545",
  },

  letterboxd: {
    type: "path",
    d: "M8.224 14.352a4.447 4.447 0 0 1-3.775 2.092C1.992 16.444 0 14.454 0 12s1.992-4.444 4.45-4.444c1.592 0 2.988.836 3.774 2.092-.427.682-.673 1.488-.673 2.352s.246 1.67.673 2.352zM15.101 12c0-.864.247-1.67.674-2.352-.786-1.256-2.183-2.092-3.775-2.092s-2.989.836-3.775 2.092c.427.682.674 1.488.674 2.352s-.247 1.67-.674 2.352c.786 1.256 2.183 2.092 3.775 2.092s2.989-.836 3.775-2.092A4.42 4.42 0 0 1 15.1 12zm4.45-4.444a4.447 4.447 0 0 0-3.775 2.092c.427.682.673 1.488.673 2.352s-.246 1.67-.673 2.352a4.447 4.447 0 0 0 3.775 2.092C22.008 16.444 24 14.454 24 12s-1.992-4.444-4.45-4.444z",
    color: "#e0913f",
  },

  goodreads: {
    type: "path",
    d: "M17.346.026c.422-.083.859.037 1.179.325.346.284.55.705.557 1.153-.023.457-.247.88-.612 1.156l-2.182 1.748a.601.601 0 0 0-.255.43.52.52 0 0 0 .11.424 5.886 5.886 0 0 1 .832 6.58c-1.394 2.79-4.503 3.99-7.501 2.927a.792.792 0 0 0-.499-.01c-.224.07-.303.18-.453.383l-.014.02-.941 1.254s-.792.985.457.935c3.027-.119 3.817-.119 5.439-.01 2.641.18 3.806 1.903 3.806 3.275 0 1.623-1.036 3.383-3.809 3.383a117.46 117.46 0 0 0-5.517-.03c-.31.005-.597.013-.835.02-.228.006-.41.011-.52.011-.712 0-1.648-.186-1.66-1.068-.008-.729.624-1.12 1.11-1.172.43-.045.815.007 1.24.064.252.034.518.07.815.088.185.011.366.025.552.038.53.038 1.102.08 1.926.087.427.005.759.01 1.025.015.695.012.941.016 1.28-.015 1.248-.112 1.832-.61 1.832-1.376 0-.805-.584-1.264-1.698-1.414-1.564-.213-2.33-.163-3.72-.074a87.66 87.66 0 0 1-1.669.095c-.608.029-2.449.026-2.682-1.492-.053-.416-.073-1.116.807-2.325l.75-1.003c.36-.49.582-.898.053-1.559 0 0-.39-.468-.52-.638-1.215-1.587-1.512-4.08-.448-6.114 1.577-3.011 5.4-4.26 8.37-2.581.253.143.438.203.655.163.201-.032.27-.167.363-.344.02-.04.042-.082.067-.126.004-.01.241-.465.535-1.028l.734-1.41a1.493 1.493 0 0 1 1.041-.785ZM9.193 13.243c1.854.903 3.912.208 5.254-2.47 1.352-2.699.827-5.11-1.041-6.023C10.918 3.537 8.81 5.831 8.017 7.41c-1.355 2.698-.717 4.886 1.147 5.818Z",
    color: "#c99a62",
  },

  // ── Trip import connector (PathMark — # mark, Viaduct brand green) ─────────
  // Viaduct uses the hash symbol as their brand mark.

  viaduct: {
    type: "path",
    d: "M7 2v6H4v3h3v2H4v3h3v6h3v-6h4v6h3v-6h3v-3H17v-2h3v-3H17V2h-3v6h-4V2H7Z",
    color: "#1c7251",
  },

  // ── Airlines (TextMark — IATA code, brand colours) ────────────────────────

  ryanair: { type: "text", label: "FR", bg: "#073590", fg: "#f5a900" },
  "aer-lingus": { type: "text", label: "EI", bg: "#006633", fg: "#ffffff" },
  "british-airways": { type: "text", label: "BA", bg: "#075AAA", fg: "#ffffff" },
  lufthansa: { type: "text", label: "LH", bg: "#05164D", fg: "#FEC000" },
  "air-france": { type: "text", label: "AF", bg: "#002157", fg: "#ffffff" },
  klm: { type: "text", label: "KL", bg: "#009BD4", fg: "#ffffff" },
  easyjet: { type: "text", label: "EJ", bg: "#FF6600", fg: "#ffffff" },
  "wizz-air": { type: "text", label: "W6", bg: "#C6006F", fg: "#ffffff" },
  "turkish-airlines": { type: "text", label: "TK", bg: "#C70A0C", fg: "#ffffff" },
  emirates: { type: "text", label: "EK", bg: "#D42027", fg: "#c8a951" },
  norwegian: { type: "text", label: "DY", bg: "#D51F2E", fg: "#ffffff" },
  iberia: { type: "text", label: "IB", bg: "#CC0000", fg: "#ffffff" },
  vueling: { type: "text", label: "VY", bg: "#F8C300", fg: "#333333" },
  "tap-air-portugal": { type: "text", label: "TP", bg: "#007840", fg: "#ffffff" },
  finnair: { type: "text", label: "AY", bg: "#003580", fg: "#ffffff" },
  "swiss-international": { type: "text", label: "LX", bg: "#C00000", fg: "#ffffff" },
  "austrian-airlines": { type: "text", label: "OS", bg: "#B40005", fg: "#ffffff" },
  "brussels-airlines": { type: "text", label: "SN", bg: "#0A1C5B", fg: "#ffffff" },
  "united-airlines": { type: "text", label: "UA", bg: "#004B87", fg: "#ffffff" },
  "american-airlines": { type: "text", label: "AA", bg: "#B1003A", fg: "#ffffff" },
  "delta-air-lines": { type: "text", label: "DL", bg: "#003A70", fg: "#ffffff" },
  qantas: { type: "text", label: "QF", bg: "#E31837", fg: "#ffffff" },
  "singapore-airlines": { type: "text", label: "SQ", bg: "#013A64", fg: "#c8a951" },
  "cathay-pacific": { type: "text", label: "CX", bg: "#003D6B", fg: "#ffffff" },
  "air-asia": { type: "text", label: "AK", bg: "#E21F26", fg: "#ffffff" },

  // ── Train operators (TextMark — operator initials, brand colours) ─────────

  trenitalia: { type: "text", label: "FS", bg: "#D2232A", fg: "#ffffff" },
  "db-fernverkehr": { type: "text", label: "DB", bg: "#E20313", fg: "#ffffff" },
  renfe: { type: "text", label: "RE", bg: "#C80C1F", fg: "#ffffff" },
  "china-railway": { type: "text", label: "CRH", bg: "#9E1A1A", fg: "#ffffff" },
  sncf: { type: "text", label: "SN", bg: "#C0003C", fg: "#ffffff" },
  eurostar: { type: "text", label: "ES", bg: "#2C2A29", fg: "#FBBC04" },
  obb: { type: "text", label: "ÖBB", bg: "#E2001A", fg: "#ffffff" },
  ns: { type: "text", label: "NS", bg: "#003082", fg: "#FFC917" },
  sbb: { type: "text", label: "SBB", bg: "#E30613", fg: "#ffffff" },
  thalys: { type: "text", label: "TH", bg: "#CC0044", fg: "#ffffff" },
  amtrak: { type: "text", label: "AM", bg: "#004B87", fg: "#ffffff" },
  "italo-treno": { type: "text", label: "IT", bg: "#EB0029", fg: "#ffffff" },
  "avlo": { type: "text", label: "AV", bg: "#8B1A4A", fg: "#ffffff" },
};

// ── Operator name aliases ─────────────────────────────────────────────────────
// Maps normalised operator strings (lower-cased, trimmed) → SOURCE_MARKS key.

const OPERATOR_ALIASES: Record<string, string> = {
  // Deutsche Bahn variants
  "db": "db-fernverkehr",
  "deutsche bahn": "db-fernverkehr",
  "db fernverkehr": "db-fernverkehr",
  "db ag": "db-fernverkehr",
  // Renfe variants
  "renfe-operadora": "renfe",
  "renfe operadora": "renfe",
  "red nacional de los ferrocarriles españoles": "renfe",
  // China Railway variants
  "china railway": "china-railway",
  "crh": "china-railway",
  "cr": "china-railway",
  "china railways": "china-railway",
  // Trenitalia variants
  "fs": "trenitalia",
  "ferrovie dello stato": "trenitalia",
  "fs italiane": "trenitalia",
  // OBB variants
  "obb": "obb",
  "öbb": "obb",
  "österreichische bundesbahnen": "obb",
  // Aer Lingus
  "aer lingus": "aer-lingus",
  // British Airways
  "british airways": "british-airways",
  // Air France
  "air france": "air-france",
  // Wizz Air
  "wizz air": "wizz-air",
  // Turkish Airlines
  "turkish airlines": "turkish-airlines",
  // easyJet
  "easyjet": "easyjet",
  // SNCF variants
  "sncf voyageurs": "sncf",
  "sncf réseau": "sncf",
  "inouï": "sncf",
  "intercités": "sncf",
  // NS variants
  "ns intercity": "ns",
  "ns hispeed": "ns",
  // SBB variants
  "sbb cff ffs": "sbb",
  "cff": "sbb",
  "ffs": "sbb",
  // Eurostar variants
  "eurostar international": "eurostar",
  // Swiss International
  "swiss": "swiss-international",
  "swiss international air lines": "swiss-international",
  "swiss air lines": "swiss-international",
  // Austrian Airlines
  "austrian": "austrian-airlines",
  // Italo
  "italo": "italo-treno",
  "nuovo trasporto viaggiatori": "italo-treno",
  "ntv": "italo-treno",
  // Thalys
  "thalys": "thalys",
  // United Airlines
  "united": "united-airlines",
  "united airlines": "united-airlines",
  // American Airlines
  "american": "american-airlines",
  "american airlines": "american-airlines",
  // Delta
  "delta": "delta-air-lines",
  "delta air lines": "delta-air-lines",
  // Singapore Airlines
  "singapore airlines": "singapore-airlines",
  // Cathay Pacific
  "cathay pacific": "cathay-pacific",
  "cathay pacific airways": "cathay-pacific",
  // Air Asia
  "airasia": "air-asia",
  "air asia": "air-asia",
  // Tap Air Portugal
  "tap": "tap-air-portugal",
  "tap air portugal": "tap-air-portugal",
  // Brussels Airlines
  "brussels airlines": "brussels-airlines",
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns the mark definition for a source connector ID (e.g. "viaduct",
 * "netflix"). Returns undefined for unrecognised sources.
 */
export function sourceMark(id: string): SourceMarkDef | undefined {
  return SOURCE_MARKS[id];
}

/**
 * Normalises a free-text operator name (from entry.operator) to a SOURCE_MARKS
 * key. Returns undefined if the operator is not in the registry.
 *
 * Example: "DB Fernverkehr" → "db-fernverkehr"
 *          "Renfe-Operadora" → "renfe"
 */
export function operatorMarkId(operator: string | undefined): string | undefined {
  if (!operator) return undefined;
  const slug = operator.trim().toLowerCase();
  // Direct match (already a canonical key)
  if (SOURCE_MARKS[slug]) return slug;
  // Alias match
  const via = OPERATOR_ALIASES[slug];
  if (via && SOURCE_MARKS[via]) return via;
  return undefined;
}

// ── Legacy helpers (kept for any external callers) ────────────────────────────

/** @deprecated Use sourceMark(id) instead. */
export function sourceIconPath(id: string): string | undefined {
  const m = SOURCE_MARKS[id];
  return m?.type === "path" ? m.d : undefined;
}

/** @deprecated Use sourceMark(id) instead. */
export function sourceColor(id: string): string | undefined {
  const m = SOURCE_MARKS[id];
  if (!m) return undefined;
  return m.type === "path" ? m.color : m.bg;
}
