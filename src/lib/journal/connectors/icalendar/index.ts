/**
 * iCalendar (.ics) connector.
 *
 * Parses RFC 5545 iCal files (Google Calendar, Apple Calendar, Outlook exports)
 * and maps VEVENT blocks to Stay or JEvent entries.
 *
 * Classification rules:
 *   - All-day DTSTART + DTEND spanning ≥ 2 days → Stay (hotel, Airbnb, trip)
 *   - Summary contains "flight"/"fly", two airport codes, or a flight number with a route
 *     → Leg (mode: air). Airports are resolved from SUMMARY, DESCRIPTION and LOCATION
 *     against the bundled airport table (see flights.ts).
 *   - ATTENDEE/ORGANIZER display names are kept as free-text `companions`; matching them
 *     to people happens at import time (peopleMatch.ts).
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
import { parseFlight } from "./flights";

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

/** Train keywords that unambiguously signal a rail leg. */
/** Train keyword pattern — any of these words signal a rail leg. */
const TRAIN_KW_RE = /\b(train|rail|eurostar|tgv|thalys|intercity|inter[- ]city|amtrak|sprinter|sleeper|night\s+train|dart|iarnrod|irish\s+rail|railjet|nightjet|ouigo|frecciarossa|italo)\b/i;

/** Common train service number prefixes (IC, ICE, RE, TGV, etc.). */
const TRAIN_NUM_RE = /\b(IC|ICE|EC|EN|RE|RB|NJ|RJ|TER|TGV|AVE|ITA|FA|FR|Amtrak|Eurostar|DART)\s*\d+\b/i;

/**
 * Try to extract free-text from/to station names for rail legs.
 * Trains lack IATA-style codes, so we parse the calendar event summary.
 *
 * Handles:
 *   "Eurostar London → Paris"             arrow (→ or ->)
 *   "Train London – Paris"                en-dash
 *   "Train London — Paris"                em-dash
 *   "Train London to Edinburgh"           keyword + "to"
 *   "from London Paddington to Bristol"   explicit "from … to …"
 *   "Eurostar to Paris"                   destination-only (from stays empty)
 *   "IC72 Berlin München"                 service number + two city names
 */
function extractTrainFromTo(summary: string): { from: string; to: string } | null {
  const s = summary.trim();

  // 1. Any dash/arrow separator: "X → Y", "X -> Y", "X – Y", "X — Y", "X - Y"
  //    Strip leading keyword/service-number noise from the left side.
  const sepMatch = /^(.*?)\s*(?:→|->|–|—)\s*(.+)$/.exec(s);
  if (sepMatch) {
    const rawFrom = sepMatch[1].trim()
      .replace(TRAIN_KW_RE, "")
      .replace(TRAIN_NUM_RE, "")
      .trim();
    const to = sepMatch[2].trim();
    if (to) return { from: rawFrom, to };
  }

  // 2. Explicit "from X to Y"
  const fromToMatch = /\bfrom\s+(.+?)\s+to\s+(.+)$/i.exec(s);
  if (fromToMatch) {
    const from = fromToMatch[1].trim();
    const to   = fromToMatch[2].trim();
    if (from && to) return { from, to };
  }

  // 3. Keyword-anchored "to": "Train London to Edinburgh"
  //    The keyword group eats the train word; everything before "to" is the origin.
  const kwToMatch = /^(?:.*?\b(?:train|rail|eurostar|tgv|thalys|intercity|amtrak|sprinter|sleeper|night\s+train|dart|railjet|nightjet|ouigo|frecciarossa|italo)\b\s+)(.+?)\s+to\s+(.+)$/i.exec(s);
  if (kwToMatch) {
    const from = kwToMatch[1].trim();
    const to   = kwToMatch[2].trim();
    if (from && to) return { from, to };
  }

  // 4. Service-number-anchored "to": "IC72 Berlin to München" or "IC72 to München"
  const numToMatch = /\b(?:IC|ICE|EC|EN|RE|RB|NJ|RJ|TER|TGV|AVE|ITA|FA|FR|Amtrak|Eurostar|DART)\s*\d+\s+(?:(.+?)\s+to\s+(.+)|to\s+(.+))$/i.exec(s);
  if (numToMatch) {
    if (numToMatch[1] && numToMatch[2]) return { from: numToMatch[1].trim(), to: numToMatch[2].trim() };
    if (numToMatch[3]) return { from: "", to: numToMatch[3].trim() };
  }

  // 5. Destination-only: "Keyword to Destination" with no parseable origin.
  //    Return empty from so the user is prompted to fill it in.
  const destOnlyMatch = /\b(?:train|rail|eurostar|tgv|thalys|intercity|amtrak|sprinter|sleeper|dart|railjet|nightjet|ouigo|frecciarossa|italo)\b\s+to\s+(.+)$/i.exec(s);
  if (destOnlyMatch) return { from: "", to: destOnlyMatch[1].trim() };

  return null;
}

interface TransportInfo {
  mode: "air" | "rail";
  /** IATA code, free-text place name, or "" when unknown. Never "???". */
  from: string;
  /** IATA code, free-text place name, or "" when unknown. Never "???". */
  to: string;
  /** Flight or train service number, if parseable. */
  serviceNumber?: string;
  warnings: string[];
}

/**
 * Return transport info if the event looks like a flight or train,
 * otherwise null (→ falls through to JEvent classification).
 * Flights are resolved from SUMMARY, DESCRIPTION and LOCATION (see flights.ts).
 */
function detectTransport(summary: string, location: string, description: string | undefined): TransportInfo | null {
  // --- Flight: keyword, two airport codes, or flight number + route ---
  const flight = parseFlight({ summary, location, description });
  if (flight) {
    // When a side resolved to a code, store the code in `from`/`to`.
    // When no code but a place name was extracted (e.g. "London" — ambiguous),
    // store the name directly rather than "???" so it is readable in the UI.
    // When nothing at all was extracted, store "" (displays as "–").
    return {
      mode: "air",
      from: flight.from.code ?? flight.from.name ?? "",
      to:   flight.to.code   ?? flight.to.name   ?? "",
      serviceNumber: flight.flightNumber,
      warnings: flight.warnings,
    };
  }

  // --- Train: keyword or recognisable service number (IC, ICE, TGV, etc.) ---
  if (TRAIN_KW_RE.test(summary) || TRAIN_NUM_RE.test(summary)) {
    const fromTo = extractTrainFromTo(summary);
    const numMatch = TRAIN_NUM_RE.exec(summary);
    // Warn only when we have no destination at all (partial matches with a known
    // destination are still useful — the user just needs to fill in the origin).
    const missingDest = !fromTo?.to;
    const missingFrom = !fromTo?.from;
    const warnings: string[] = [];
    if (missingDest) warnings.push("No station names found — fill in From/To before confirming");
    else if (missingFrom) warnings.push("Origin station unknown — fill in From before confirming");
    return {
      mode: "rail",
      from: fromTo?.from ?? "",
      to:   fromTo?.to   ?? "",
      serviceNumber: numMatch ? numMatch[0].replace(/\s+/, "") : undefined,
      warnings,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Attendees
// ---------------------------------------------------------------------------

/**
 * Display names from ATTENDEE and ORGANIZER lines (CN parameter). Rooms and
 * resources are skipped, and so are common-name values that are just an email.
 * parseProps keeps only the first occurrence of a property, so these are read separately.
 */
function parseAttendeeNames(block: string): string[] {
  const names: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (!/^(ATTENDEE|ORGANIZER)[;:]/i.test(line)) continue;
    if (/;CUTYPE=(RESOURCE|ROOM)/i.test(line)) continue;
    const cn = /;CN=(?:"([^"]*)"|([^;:]*))/i.exec(line);
    if (!cn) continue;
    const name = (cn[1] ?? cn[2] ?? "").replace(/\\,/g, ",").replace(/\s+/g, " ").trim();
    if (!name || name.includes("@") || names.includes(name)) continue;
    names.push(name);
  }
  return names;
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

    const attendees = parseAttendeeNames(block);
    const base = {
      id: uid(),
      source: SOURCE,
      tier: 3 as const,
      createdAt: now(),
      review: description,
      // Free-text names from the invite. Matching them to people happens at import.
      ...(attendees.length ? { companions: attendees } : {}),
      // Source text kept for name matching and later reprocessing.
      raw: { summary, ...(location ? { location } : {}), ...(description ? { description } : {}) },
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
    const transport = detectTransport(summary, location, description);
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
      const warnings = transport.warnings;
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
    e.dedupeKey = eventKey(e);
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
