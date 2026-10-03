/**
 * iCalendar (.ics) connector.
 *
 * Parses RFC 5545 iCal files (Google Calendar, Apple Calendar, Outlook exports)
 * and maps VEVENT blocks to Stay or JEvent entries.
 *
 * Classification rules:
 *   - All-day DTSTART + DTEND spanning ≥ 2 days → Stay (hotel, Airbnb, trip)
 *   - All-day single-day or timed event → JEvent
 *   - Events with RRULE (recurring) → skipped, warning emitted
 *
 * Tier 3: calendar files are secondary evidence — confirm or enrich in staging.
 */
import { uid } from "../../types";
import type { JEvent, Stay, EventCategory } from "../../types";
import { timezoneFor } from "../../geo";
import { localToUTC } from "../../tz";
import type { Connector, ParseResult } from "../types";
import { eventKey, stayKey } from "../keys";

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
  return "memory";
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
      confidence: "inferred" as const,
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
