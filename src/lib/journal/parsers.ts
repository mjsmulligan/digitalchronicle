import { locate } from "./geo";
import { uid, type Entry, type EventCategory, type JEvent, type Leg, type Source, type Stay, type Tier } from "./types";

export function parseCSV(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') (cur += '"'), i++;
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") row.push(cur), (cur = "");
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur), rows.push(row), (row = []), (cur = "");
    } else cur += c;
  }
  if (cur || row.length) row.push(cur), rows.push(row);
  const clean = rows.filter((r) => r.some((c) => c.trim()));
  if (!clean.length) return [];
  const head = clean[0].map((h) => h.replace(/^\uFEFF/, "").trim());
  return clean.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim()])));
}

const nk = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
function pick(row: Record<string, unknown>, aliases: string[]): string {
  const keys = Object.keys(row);
  for (const a of aliases) {
    const k = keys.find((k) => nk(k) === nk(a));
    if (k && row[k] != null && String(row[k]).trim()) return String(row[k]).trim();
  }
  return "";
}

/** Normalise many date/time spellings to local wall-clock "YYYY-MM-DDTHH:mm" (keeps local time, no TZ shift). */
export function normDate(date: string, time = ""): string | null {
  let d = date.trim();
  let t = time.trim();
  const both = d.match(/^(.+?)[T ](\d{1,2}:\d{2}(:\d{2})?)/);
  if (both) (d = both[1]), (t = t || both[2]);
  let y: string, m: string, dd: string;
  let mm = d.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (mm) [, y, m, dd] = mm;
  else if ((mm = d.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) [, dd, m, y] = mm;
  else {
    const p = new Date(d);
    if (isNaN(p.getTime())) return null;
    y = String(p.getFullYear());
    m = String(p.getMonth() + 1);
    dd = String(p.getDate());
  }
  const base = `${y}-${m.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  const tm = t.match(/^(\d{1,2}):(\d{2})/);
  return tm ? `${base}T${tm[1].padStart(2, "0")}:${tm[2]}` : base;
}

export interface ParseResult {
  entries: { entry: Entry; warnings: string[] }[];
  errors: string[];
}

const now = () => new Date().toISOString();

function legKey(l: Pick<Leg, "start" | "from" | "to">) {
  return `leg|${l.start.slice(0, 10)}|${l.from.toUpperCase()}|${l.to.toUpperCase()}`;
}
function eventKey(e: Pick<JEvent, "start" | "artist">) {
  return `event|${e.start.slice(0, 10)}|${e.artist.toLowerCase()}`;
}
function stayKey(s: Pick<Stay, "start" | "place">) {
  return `stay|${s.start.slice(0, 10)}|${s.place.toLowerCase()}`;
}

function legWarnings(l: Leg): string[] {
  const w: string[] = [];
  if (!l.start.includes("T")) w.push("No departure time");
  if (l.end && l.end < l.start) w.push("Arrival earlier than departure (overnight or TZ?)");
  if (!locate(l.from)) w.push(`Unknown location "${l.from}" — won't appear on map`);
  if (!locate(l.to)) w.push(`Unknown location "${l.to}" — won't appear on map`);
  return w;
}

// ---------- Flightradar24 ----------
function airport(s: string): { code: string; name: string } {
  const m = s.match(/\(([A-Z0-9]{3})\/?[A-Z0-9]*\)/);
  const name = s.replace(/\s*\(.*\)\s*/, "").trim();
  return { code: m ? m[1] : s.trim().toUpperCase(), name };
}

export function parseFR24(text: string): ParseResult {
  const out: ParseResult = { entries: [], errors: [] };
  parseCSV(text).forEach((r, i) => {
    const start = normDate(pick(r, ["Date"]), pick(r, ["Dep time", "Departure time"]));
    if (!start) return out.errors.push(`Row ${i + 2}: unreadable date`);
    const from = airport(pick(r, ["From"]));
    const to = airport(pick(r, ["To"]));
    if (!from.code || !to.code) return out.errors.push(`Row ${i + 2}: missing airports`);
    const arr = pick(r, ["Arr time", "Arrival time"]);
    let end = arr ? normDate(start.slice(0, 10), arr) ?? undefined : undefined;
    if (end && end < start) {
      const d = new Date(start.slice(0, 10) + "T00:00");
      d.setDate(d.getDate() + 1);
      end = normDate(d.toISOString().slice(0, 10), arr) ?? end;
    }
    const leg: Leg = {
      id: uid(), kind: "leg", mode: "air", source: "fr24", tier: 2, start, end,
      from: from.code, to: to.code, fromName: from.name, toName: to.name,
      flightNumber: pick(r, ["Flight number", "Flight"]), aircraft: pick(r, ["Aircraft"]),
      operator: pick(r, ["Airline"]), seat: pick(r, ["Seat number"]), journal: pick(r, ["Note"]) || undefined,
      dedupeKey: "", createdAt: now(),
    };
    leg.dedupeKey = legKey(leg);
    out.entries.push({ entry: leg, warnings: legWarnings(leg) });
  });
  return out;
}

// ---------- Viaduct rail ----------
export function parseViaduct(text: string): ParseResult {
  const out: ParseResult = { entries: [], errors: [] };
  parseCSV(text).forEach((r, i) => {
    const date = pick(r, ["Date", "Travel date", "Departure date"]);
    const start = normDate(date || pick(r, ["Departure", "Departure time", "Departs"]), pick(r, ["Departure time", "Dep time", "Departs"]));
    if (!start) return out.errors.push(`Row ${i + 2}: unreadable date`);
    const from = pick(r, ["Origin", "From", "Departure station", "Origin station"]);
    const to = pick(r, ["Destination", "To", "Arrival station", "Destination station"]);
    if (!from || !to) return out.errors.push(`Row ${i + 2}: missing stations`);
    const arr = pick(r, ["Arrival time", "Arr time", "Arrives", "Arrival"]);
    const end = arr ? normDate(arr.length > 8 ? arr : start.slice(0, 10), arr.length > 8 ? "" : arr) ?? undefined : undefined;
    const leg: Leg = {
      id: uid(), kind: "leg", mode: "rail", source: "viaduct", tier: 2, start, end,
      from, to, operator: pick(r, ["Operator", "Company"]), trainNumber: pick(r, ["Train", "Train number", "Service"]),
      seat: pick(r, ["Seat", "Coach/Seat"]), journal: pick(r, ["Notes", "Note"]) || undefined,
      dedupeKey: "", createdAt: now(),
    };
    leg.dedupeKey = legKey(leg);
    out.entries.push({ entry: leg, warnings: legWarnings(leg) });
  });
  return out;
}

// ---------- setlist.fm ----------
type SetlistJSON = {
  eventDate?: string;
  artist?: { name?: string };
  venue?: { name?: string; city?: { name?: string; country?: { name?: string } } };
  tour?: { name?: string };
  sets?: { set?: { song?: { name?: string }[] }[] };
};
export function parseSetlist(text: string): ParseResult {
  const out: ParseResult = { entries: [], errors: [] };
  const trimmed = text.trim();
  let rows: Record<string, unknown>[] = [];
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const j = JSON.parse(trimmed);
    const arr: SetlistJSON[] = Array.isArray(j) ? j : j.setlist ?? j.setlists ?? [];
    rows = arr.map((s) => ({
      date: s.eventDate ?? "", artist: s.artist?.name ?? "", venue: s.venue?.name ?? "",
      city: s.venue?.city?.name ?? "", country: s.venue?.city?.country?.name ?? "", tour: s.tour?.name ?? "",
      songs: (s.sets?.set ?? []).flatMap((x) => (x.song ?? []).map((so) => so.name ?? "")).filter(Boolean),
    }));
  } else rows = parseCSV(trimmed);
  rows.forEach((r, i) => {
    const start = normDate(pick(r, ["date", "eventDate", "Event date"]));
    const artist = pick(r, ["artist", "Artist name"]);
    if (!start || !artist) return out.errors.push(`Entry ${i + 1}: missing date or artist`);
    const songs = Array.isArray(r.songs) ? (r.songs as string[]) : pick(r, ["songs", "setlist"]).split(/[;|]/).map((s) => s.trim()).filter(Boolean);
    const ev: JEvent = {
      id: uid(), kind: "event", category: "concert", source: "setlistfm", tier: 2, start, artist,
      venue: pick(r, ["venue", "Venue name"]) || "Unknown venue", city: pick(r, ["city", "City name"]),
      country: pick(r, ["country"]) || undefined, tour: pick(r, ["tour"]) || undefined,
      setlist: songs.length ? songs : undefined, dedupeKey: "", createdAt: now(),
    };
    ev.dedupeKey = eventKey(ev);
    const w: string[] = [];
    if (!ev.setlist) w.push("No setlist details");
    if (!locate(ev.city)) w.push(`City "${ev.city || "?"}" not on map`);
    out.entries.push({ entry: ev, warnings: w });
  });
  return out;
}

// ---------- Generic / cleaned ----------
const EVENT_TYPES: Record<string, EventCategory> = {
  event: "activity", activity: "activity", concert: "concert", gig: "concert", show: "concert",
  gathering: "gathering", party: "gathering", dinner: "gathering", social: "gathering",
  celebration: "celebration", birthday: "celebration", wedding: "celebration", anniversary: "celebration",
  milestone: "milestone", life: "milestone", memory: "memory", moment: "memory",
};
export function parseGeneric(text: string): ParseResult {
  const out: ParseResult = { entries: [], errors: [] };
  const t = text.trim();
  const rows: Record<string, unknown>[] = t.startsWith("[") || t.startsWith("{")
    ? (() => { const j = JSON.parse(t); return Array.isArray(j) ? j : j.records ?? j.data ?? []; })()
    : parseCSV(t);
  rows.forEach((r, i) => {
    const type = pick(r, ["type", "kind", "category"]).toLowerCase();
    const start = normDate(pick(r, ["start", "date", "checkin", "departure"]), pick(r, ["time", "starttime"]));
    if (!start) return out.errors.push(`Row ${i + 1}: unreadable start/date`);
    const endRaw = pick(r, ["end", "checkout", "arrival", "enddate"]);
    const end = endRaw ? normDate(endRaw) ?? undefined : undefined;
    const tierN = Number(pick(r, ["tier"]));
    const tier = (tierN === 2 || tierN === 3 ? tierN : 3) as Tier;
    const base = { id: uid(), source: "generic" as Source, tier, start, end, createdAt: now(), journal: pick(r, ["notes", "note", "journal"]) || undefined };
    if (["leg", "flight", "train", "rail", "air", "road", "drive", "bus"].includes(type)) {
      const mode = type === "flight" || type === "air" ? "air" : type === "train" || type === "rail" ? "rail" : type === "leg" ? ((pick(r, ["mode"]) as Leg["mode"]) || "road") : "road";
      const leg: Leg = { ...base, kind: "leg", mode, from: pick(r, ["from", "origin"]), to: pick(r, ["to", "destination"]), flightNumber: pick(r, ["flightnumber", "flight"]) || undefined, operator: pick(r, ["operator", "airline"]) || undefined, dedupeKey: "" };
      if (!leg.from || !leg.to) return out.errors.push(`Row ${i + 1}: leg missing from/to`);
      leg.dedupeKey = legKey(leg);
      out.entries.push({ entry: leg, warnings: legWarnings(leg) });
    } else if (["stay", "hotel", "lodging", "accommodation"].includes(type)) {
      const s: Stay = { ...base, kind: "stay", place: pick(r, ["place", "name", "hotel", "title"]) || "Stay", city: pick(r, ["city"]) || undefined, dedupeKey: "" };
      s.dedupeKey = stayKey(s);
      out.entries.push({ entry: s, warnings: end ? [] : ["No check-out date"] });
    } else if (type in EVENT_TYPES) {
      const people = pick(r, ["people", "with", "guests"]).split(/[;|]/).map((x) => x.trim()).filter(Boolean);
      const e: JEvent = { ...base, kind: "event", category: EVENT_TYPES[type], artist: pick(r, ["title", "artist", "name"]) || "Moment", venue: pick(r, ["venue", "place"]), city: pick(r, ["city"]), people: people.length ? people : undefined, dedupeKey: "" };
      e.dedupeKey = eventKey(e);
      out.entries.push({ entry: e, warnings: [] });
    } else out.errors.push(`Row ${i + 1}: unknown type "${type}" (use flight/train/stay/concert/gathering/birthday/milestone/memory…)`);
  });
  return out;
}

export const PARSERS: Record<Exclude<Source, "manual">, (t: string) => ParseResult> = {
  fr24: parseFR24,
  viaduct: parseViaduct,
  setlistfm: parseSetlist,
  generic: parseGeneric,
};

export function detectSource(filename: string, text: string): Exclude<Source, "manual"> {
  const head = text.slice(0, 400).toLowerCase();
  if (head.includes("flight number") && head.includes("aircraft")) return "fr24";
  if (head.includes("eventdate") || head.includes('"artist"') || /setlist/i.test(filename)) return "setlistfm";
  if (/viaduct/i.test(filename) || (head.includes("station") || (head.includes("origin") && head.includes("operator")))) return "viaduct";
  return "generic";
}

export { legKey, eventKey, stayKey };
