/**
 * iCalendar (.ics) connector.
 *
 * Parses RFC 5545 iCal files (Google Calendar, Apple Calendar, Outlook exports)
 * and maps VEVENT blocks to Stay or JEvent entries.
 *
 * Classification rules:
 *   - All-day DTSTART + DTEND spanning ≥ 2 days → Stay (hotel, Airbnb, trip)
 *   - Summary contains "flight"/"fly" or two IATA codes → Leg (mode: air)
 *   - Summary contains "train"/"rail"/"eurostar"/etc. → Leg (mode: rail)
 *   - All-day single-day or timed event → JEvent
 *   - Events with RRULE (recurring) → skipped, warning emitted
 *
 * Tier 3: calendar files are secondary evidence — confirm or enrich in staging.
 */
import { uid } from "../../types";
import type { JEvent, Stay, Leg, EventCategory } from "../../types";
import { timezoneFor } from "../../geo";
import { localToUTC } from "../../tz";
import type { Connector, ParseResult } from "../types";
import { eventKey, stayKey, legKey } from "../keys";

const SOURCE = "icalendar" as const;
const now = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// iCal parsing helpers
// ---------------------------------------------------------------------------

/** Unfold iCal line continuations (RFC 5545 §3.1). */
function unfold(text: string): string {
  return text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
}

/** Extract the content between BEGIN:VEVENT / END:VEVENT markers. */
function extractVEvents(text: string): string[] {
  const events: string[] = [];
  const re = /BEGIN:VEVENT([\s\S]*?)END:VEVENT/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) events.push(m[1]);
  return events;
}

interface Prop { value: string; params: Record<string, string> }

/**
 * Parse a VEVENT block into a property map.
 * Only the first occurrence of each property name is stored (spec allows multiple
 * EXDATE etc., but we only care about the primary scheduling properties).
 */
function parseProps(block: string): Map<string, Prop> {
  const map = new Map<string, Prop>();
  for (const line of block.split(/\r?\n/)) {
    const ci = line.indexOf(":");
    if (ci < 0) continue;
    const namePart = line.slice(0, ci);
    // Unescape RFC 5545 text escapes
    const value = line
      .slice(ci + 1)
      .replace(/\\n/g, "\n")
      .replace(/\\,/g, ",")
      .replace(/\\;/g, ";")
      .replace(/\\\\/g, "\\");
    const parts = namePart.split(";");
    const name = parts[0].toUpperCase();
    const params: Record<string, string> = {};
    for (let i = 1; i < parts.length; i++) {
      const eq = parts[i].indexOf("=");
      if (eq >= 0) params[parts[i].slice(0, eq).toUpperCase()] = parts[i].slice(eq + 1);
    }
    if (!map.has(name)) map.set(name, { value, params });
  }
  return map;
}

interface DtParsed {
  /** YYYY-MM-DD */
  dateStr: string;
  /** HH:mm — only present for DATE-TIME values */
  timeStr?: string;
  /** IANA timezone id or "UTC" */
  tz?: string;
  isDateOnly: boolean;
}

function parseDt(prop: Prop | undefined): DtParsed | null {
  if (!prop) return null;
  const { value, params } = prop;
  const isDateOnly = params["VALUE"] === "DATE" || !value.includes("T");
  const d = value.slice(0, 8);
  const dateStr = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  if (isDateOnly) return { dateStr, isDateOnly: true };
  const timePart = value.split("T")[1] ?? "";
  const isUTC = timePart.endsWith("Z");
  const timeClean = timePart.replace("Z", "");
  const timeStr = `${timeClean.slice(0, 2)}:${timeClean.slice(2, 4)}`;
  const tz = params["TZID"] ?? (isUTC ? "UTC" : undefined);
  return { dateStr, timeStr, tz, isDateOnly: false };
}

/** Number of whole days between two YYYY-MM-DD strings. */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Category inference
// ---------------------------------------------------------------------------

const CATEGORY_MAP: Array<[string, EventCategory]> = [
  ["concert", "concert"],
  ["gig", "concert"],
  ["music", "concert"],
  ["show", "concert"],
  ["festival", "concert"],
  ["birthday", "celebration"],
  ["anniversary", "celebration"],
  ["wedding", "celebration"],
  ["engagement", "celebration"],
  ["party", "gathering"],
  ["dinner", "gathering"],
  ["gathering", "gathering"],
  ["drinks", "gathering"],
  ["graduation", "milestone"],
  ["milestone", "milestone"],
  ["activity", "activity"],
  ["hike", "activity"],
  ["sport", "activity"],
];

function inferCategory(summary: string, cats: string): EventCategory {
  const text = `${summary} ${cats}`.toLowerCase();
  for (const [kw, cat] of CATEGORY_MAP) {
    if (text.includes(kw)) return cat;
  }
  return "activity";
}

// ---------------------------------------------------------------------------
// Transport detection (flight + train → Leg)
// ---------------------------------------------------------------------------

/** IATA airport code — exactly 3 uppercase letters. */
const IATA_RE = /\b([A-Z]{3})\b/g;

/** Flight number — 1–3 letter airline code + 1–4 digits (e.g. BA123, LH4567). */
const FLIGHT_NUM_RE = /\b([A-Z]{1,3}\s?\d{1,4})\b/;

/** Common false-positive IATA-shaped words to ignore. */
const IATA_IGNORE = new Set([
  "MON","TUE","WED","THU","FRI","SAT","SUN",
  "JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC",
  "THE","AND","FOR","VIA","UTC","GMT",
]);

/**
 * Try to extract departure/arrival IATA codes from a summary.
 * "BA123 LHR → CDG"  |  "Flight LHR-CDG"  |  "LHR to CDG"
 * Returns null if fewer than two valid codes are found.
 */
function extractIata(summary: string): { from: string; to: string; serviceNumber?: string } | null {
  const upper = summary.toUpperCase();
  const codes: string[] = [];
  let m: RegExpExecArray | null;
  IATA_RE.lastIndex = 0;
  while ((m = IATA_RE.exec(upper)) !== null) {
    if (!IATA_IGNORE.has(m[1])) codes.push(m[1]);
  }
  if (codes.length < 2) return null;
  const fnMatch = FLIGHT_NUM_RE.exec(upper);
  const serviceNumber = fnMatch ? fnMatch[1].replace(/\s/, "") : undefined;
  return { from: codes[0], to: codes[1], serviceNumber };
}

/** Train keywords that unambiguously signal a rail leg. */
const TRAIN_KW_RE = /\b(train|rail|eurostar|tgv|intercity|amtrak|sprinter|sleeper)\b/i;

/** Common train service number prefixes (IC, ICE, RE, TGV, etc.). */
const TRAIN_NUM_RE = /\b(IC|ICE|EC|EN|RE|RB|TER|TGV|AVE|ITA|Amtrak|Eurostar)\s*\d+\b/i;

/**
 * Try to extract free-text from/to for trains using arrow or keyword-anchored
 * "to" patterns (trains lack IATA-style codes):
 *   "Eurostar London → Paris"
 *   "Train London Paddington to Bristol Temple Meads"
 */
function extractTrainFromTo(summary: string): { from: string; to: string } | null {
  // Arrow patterns: "X → Y" or "X -> Y"
  const arrowMatch = /^(.*?)\s*(?:→|->)\s*(.+)$/.exec(summary.trim());
  if (arrowMatch) {
    const rawFrom = arrowMatch[1].trim().replace(TRAIN_KW_RE, "").trim();
    const to = arrowMatch[2].trim();
    if (rawFrom && to) return { from: rawFrom, to };
  }
  // Keyword-anchored "to": "Train London to Edinburgh"
  const toMatch = /^(?:.*\b(?:train|rail|eurostar|tgv|intercity|amtrak|sprinter|sleeper)\b\s*)(.+?)\s+to\s+(.+)$/i.exec(summary.trim());
  if (toMatch) return { from: toMatch[1].trim(), to: toMatch[2].trim() };
  return null;
}

interface TransportInfo {
  mode: "air" | "rail";
  from: string;
  to: string;
  /** Flight or train service number, if parseable. */
  serviceNumber?: string;
}

/**
 * Return transport info if the event summary looks like a flight or train,
 * otherwise null (→ falls through to JEvent classification).
 */
function detectTransport(summary: string): TransportInfo | null {
  const lower = summary.toLowerCase();

  // --- Flight: keyword or two IATA codes ---
  const isFlightKw = /\bfl(ight|y)\b/.test(lower);
  const iata = extractIata(summary);
  if (isFlightKw || iata) {
    return { mode: "air", from: iata?.from ?? "???", to: iata?.to ?? "???", serviceNumber: iata?.serviceNumber };
  }

  // --- Train: keyword or recognisable service number (IC, ICE, TGV, etc.) ---
  if (TRAIN_KW_RE.test(lower) || TRAIN_NUM_RE.test(summary)) {
    const fromTo = extractTrainFromTo(summary);
    const numMatch = TRAIN_NUM_RE.exec(summary);
    return {
      mode: "rail",
      from: fromTo?.from ?? "???",
      to:   fromTo?.to   ?? "???",
      serviceNumber: numMatch ? numMatch[0].replace(/\s+/, "") : undefined,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Location parsing
// ---------------------------------------------------------------------------

/**
 * Split a LOCATION value into venue + city.
 * Common format: "Venue Name, City" or "Venue, Street, City".
 * Falls back to using the whole string as the venue.
 */
function parseLocation(loc: string): { venue: string; city: string } {
  if (!loc) return { venue: "", city: "" };
  const parts = loc.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) return { venue: parts[0], city: parts[parts.length - 1] };
  return { venue: loc, city: "" };
}

// ---------------------------------------------------------------------------
// Main parse function
// ---------------------------------------------------------------------------

function parseIcs(text: string): ParseResult {
  const out: ParseResult = { entries: [], errors: [] };
  const unfolded = unfold(text);
  const vevents = extractVEvents(unfolded);

  vevents.forEach((block, idx) => {
    const sourceRow = idx + 1;
    const props = parseProps(block);

    const summary = props.get("SUMMARY")?.value.trim() ?? "";
    if (!summary) {
      out.errors.push(`Event ${sourceRow}: no SUMMARY — skipped`);
      return;
    }

    // Skip recurring events — they produce too many entries; user should add
    // the significant occurrences manually.
    if (props.has("RRULE")) {
      out.errors.push(`"${summary}": recurring event skipped — add significant dates manually`);
      return;
    }

    const dtstart = parseDt(props.get("DTSTART"));
    if (!dtstart) {
      out.errors.push(`"${summary}": missing or unreadable DTSTART — skipped`);
      return;
    }

    const dtend = parseDt(props.get("DTEND"));
    const description = props.get("DESCRIPTION")?.value.trim() || undefined;
    const location = props.get("LOCATION")?.value ?? "";
    const categories = props.get("CATEGORIES")?.value ?? "";

    const base = {
      id: uid(),
      source: SOURCE,
      tier: 3 as const,
      createdAt: now(),
      reflection: description,
    };

    // --- Classify: multi-day all-day → Stay ---
    if (
      dtstart.isDateOnly &&
      dtend &&
      dtend.isDateOnly &&
      daysBetween(dtstart.dateStr, dtend.dateStr) >= 2
    ) {
      const { venue, city } = parseLocation(location);
      const resolvedCity = city || venue || undefined;
      const tz = resolvedCity ? timezoneFor(resolvedCity) : undefined;
      const s: Stay = {
        ...base,
        kind: "stay",
        place: summary,
        city: resolvedCity,
        start: dtstart.dateStr,
        // iCal DTEND for all-day is exclusive (check-out day) — store as-is
        end: dtend.dateStr,
        startTz: tz,
        endTz: tz,
        startUTC: localToUTC(dtstart.dateStr, tz),
        endUTC: localToUTC(dtend.dateStr, tz),
        dedupeKey: "",
      };
      s.dedupeKey = stayKey(s);
      out.entries.push({
        entry: s,
        warnings: city ? [] : ["No city detected in LOCATION — check the place name"],
        sourceRow,
      });
      return;
    }

    // --- Transport detection (flight or train) → Leg ---
    const transport = detectTransport(summary);
    if (transport) {
      const startStr = dtstart.timeStr
        ? `${dtstart.dateStr}T${dtstart.timeStr}`
        : dtstart.dateStr;
      const endStr = dtend
        ? dtend.timeStr ? `${dtend.dateStr}T${dtend.timeStr}` : dtend.dateStr
        : undefined;
      const tzFrom = timezoneFor(transport.from) || undefined;
      const tzTo   = timezoneFor(transport.to)   || undefined;
      const leg: Leg = {
        ...base,
        kind: "leg",
        mode: transport.mode,
        from: transport.from,
        to:   transport.to,
        flightNumber: transport.mode === "air"  ? transport.serviceNumber : undefined,
        trainNumber:  transport.mode === "rail" ? transport.serviceNumber : undefined,
        start:    startStr,
        end:      endStr,
        startTz:  dtstart.tz ?? tzFrom,
        endTz:    dtend?.tz  ?? tzTo,
        startUTC: localToUTC(startStr, dtstart.tz ?? tzFrom),
        endUTC:   endStr ? localToUTC(endStr, dtend?.tz ?? tzTo) : undefined,
        dedupeKey: "",
      };
      leg.dedupeKey = legKey(leg);
      const warnings: string[] = [];
      if (transport.from === "???") {
        const label = transport.mode === "air" ? "airport codes" : "station names";
        warnings.push(`No ${label} found — fill in From/To before confirming`);
      }
      out.entries.push({ entry: leg, warnings, sourceRow });
      return;
    }

    // --- Everything else → JEvent ---
    const startStr = dtstart.timeStr
      ? `${dtstart.dateStr}T${dtstart.timeStr}`
      : dtstart.dateStr;

    // Prefer the explicit TZID from DTSTART (including "UTC" for Z-suffixed
    // timestamps); only fall back to city-based lookup for floating times.
    const { venue, city } = parseLocation(location);
    const tzId = dtstart.tz;
    const tz = tzId ?? (timezoneFor(city || "") || undefined);

    const category = inferCategory(summary, categories);

    const e: JEvent = {
      ...base,
      kind: "event",
      category,
      artist: summary,
      venue,
      city,
      start: startStr,
      startTz: tz,
      startUTC: localToUTC(startStr, tz),
      dedupeKey: "",
    };
    e.dedupeKey = eventKey(e, SOURCE);
    out.entries.push({ entry: e, warnings: [], sourceRow });
  });

  return out;
}

// ---------------------------------------------------------------------------
// Connector export
// ---------------------------------------------------------------------------

export const connector: Connector = {
  id: "icalendar",
  label: "iCalendar (.ics)",
  kind: "file",
  tier: 3,
  accepts: [".ics"],

  sniff(name, head) {
    if (name.endsWith(".ics")) return 0.95;
    if (head.includes("begin:vcalendar")) return 0.99;
    return 0;
  },

  parse({ text }) {
    return parseIcs(text);
  },
};
