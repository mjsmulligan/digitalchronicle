import { locate, timezoneFor } from "./geo";
import { localToUTC } from "./tz";
import { uid, type Entry, type EventCategory, type JEvent, type Leg, type Purpose, type Source, type Stay, type Tier } from "./types";

/** Attach timezone + UTC to a leg from its resolved origin/destination, in place. */
function withTiming(leg: Leg): Leg {
  leg.startTz = timezoneFor(leg.from);
  leg.endTz = timezoneFor(leg.to);
  leg.startUTC = localToUTC(leg.start, leg.startTz);
  leg.endUTC = leg.end ? localToUTC(leg.end, leg.endTz) : undefined;
  return leg;
}

const PURPOSE_VALUES: Purpose[] = ["work", "family", "leisure", "other"];
function purposeFrom(row: Record<string, unknown>): Purpose | undefined {
  const v = pick(row as Record<string, string>, ["purpose"]).toLowerCase();
  return (PURPOSE_VALUES as string[]).includes(v) ? (v as Purpose) : undefined;
}
function companionsFrom(row: Record<string, unknown>): string[] | undefined {
  const v = pick(row as Record<string, string>, ["companions", "with", "people", "guests"]);
  const list = v.split(/[;|,]/).map((x) => x.trim()).filter(Boolean);
  return list.length ? list : undefined;
}
function csvRows(text: string): { row: Record<string, string>; sourceRow: number }[] {
  const rows: { cells: string[]; line: number }[] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  let line = 1;
  let rowLine = 1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        cur += '"';
        i++;
      }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(cur);
      cur = "";
    }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur);
      rows.push({ cells: row, line: rowLine });
      row = [];
      cur = "";
      rowLine = line + 1;
    } else cur += c;
    if (c === "\r" || (c === "\n" && text[i - 1] !== "\r")) line++;
  }
  if (cur || row.length) {
    row.push(cur);
    rows.push({ cells: row, line: rowLine });
  }
  const clean = rows.filter(({ cells }) => cells.some((c) => c.trim()));
  if (!clean.length) return [];
  const head = clean[0].cells.map((h) => h.replace(/^\uFEFF/, "").trim());
  return clean.slice(1).map(({ cells, line }) => ({
    row: Object.fromEntries(head.map((h, i) => [h, (cells[i] ?? "").trim()])),
    sourceRow: line,
  }));
}

export function parseCSV(text: string): Record<string, string>[] {
  return csvRows(text).map(({ row }) => row);
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
  entries: { entry: Entry; warnings: string[]; sourceRow: number }[];
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

// ---------- Viaduct rail ----------
export function parseViaduct(text: string): ParseResult {
  const out: ParseResult = { entries: [], errors: [] };
  csvRows(text).forEach(({ row: r, sourceRow }) => {
    const date = pick(r, ["Date", "Travel date", "Departure date"]);
    const start = normDate(date || pick(r, ["Departure", "Departure time", "Departs"]), pick(r, ["Departure time", "Dep time", "Departs"]));
    if (!start) return out.errors.push(`Row ${sourceRow}: unreadable date`);
    const from = pick(r, ["Origin", "From", "Departure station", "Origin station", "from_station_name"]);
    const to = pick(r, ["Destination", "To", "Arrival station", "Destination station", "to_station_name"]);
    if (!from || !to) return out.errors.push(`Row ${sourceRow}: missing stations`);
    const arr = pick(r, ["Arrival time", "Arr time", "Arrives", "Arrival"]);
    const arrivalDate = pick(r, ["arrival_date"]);
    const end = arrivalDate
      ? normDate(arrivalDate, arr) ?? undefined
      : arr ? normDate(arr.length > 8 ? arr : start.slice(0, 10), arr.length > 8 ? "" : arr) ?? undefined : undefined;
    const leg: Leg = {
      id: uid(), kind: "leg", mode: "rail", source: "viaduct", tier: 2, start, end,
      from, to, operator: pick(r, ["Operator", "Company"]), trainNumber: pick(r, ["Train", "Train number", "Service", "train_code"]),
      seat: pick(r, ["Seat", "Coach/Seat"]), reflection: pick(r, ["Notes", "Note"]) || undefined,
      dedupeKey: "", createdAt: now(),
      purpose: purposeFrom(r), companions: companionsFrom(r),
      raw: r,
    };
    withTiming(leg);
    leg.dedupeKey = legKey(leg);
    out.entries.push({ entry: leg, warnings: legWarnings(leg), sourceRow });
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
  let rows: { row: Record<string, unknown>; raw: Record<string, unknown>; sourceRow: number }[] = [];
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const j = JSON.parse(trimmed);
    const arr: SetlistJSON[] = Array.isArray(j) ? j : j.setlist ?? j.setlists ?? [];
    rows = arr.map((s, i) => ({
      sourceRow: i + 1,
      raw: { ...s },
      row: {
        date: s.eventDate ?? "", artist: s.artist?.name ?? "", venue: s.venue?.name ?? "",
        city: s.venue?.city?.name ?? "", country: s.venue?.city?.country?.name ?? "", tour: s.tour?.name ?? "",
        songs: (s.sets?.set ?? []).flatMap((x) => (x.song ?? []).map((so) => so.name ?? "")).filter(Boolean),
      },
    }));
  } else rows = csvRows(text).map(({ row, sourceRow }) => ({ row, raw: row, sourceRow }));
  rows.forEach(({ row: r, raw, sourceRow }) => {
    const start = normDate(pick(r, ["date", "eventDate", "Event date"]));
    const artist = pick(r, ["artist", "Artist name"]);
    if (!start || !artist) return out.errors.push(`Entry ${sourceRow}: missing date or artist`);
    const songs = Array.isArray(r.songs) ? (r.songs as string[]) : pick(r, ["songs", "setlist"]).split(/[;|]/).map((s) => s.trim()).filter(Boolean);
    const city = pick(r, ["city", "City name"]);
    const tz = timezoneFor(city);
    const ev: JEvent = {
      id: uid(), kind: "event", category: "concert", source: "setlistfm", tier: 2, start, artist,
      venue: pick(r, ["venue", "Venue name"]) || "Unknown venue", city,
      country: pick(r, ["country"]) || undefined, tour: pick(r, ["tour"]) || undefined,
      setlist: songs.length ? songs : undefined, dedupeKey: "", createdAt: now(),
      purpose: purposeFrom(r), companions: companionsFrom(r),
      startTz: tz, startUTC: localToUTC(start, tz),
      raw,
    };
    ev.dedupeKey = eventKey(ev);
    const w: string[] = [];
    if (!ev.setlist) w.push("No setlist details");
    if (!locate(ev.city)) w.push(`City "${ev.city || "?"}" not on map`);
    out.entries.push({ entry: ev, warnings: w, sourceRow });
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
  const rows: { row: Record<string, unknown>; sourceRow: number }[] = t.startsWith("[") || t.startsWith("{")
    ? (() => {
      const j = JSON.parse(t);
      const data: Record<string, unknown>[] = Array.isArray(j) ? j : j.records ?? j.data ?? [];
      return data.map((row, i) => ({ row, sourceRow: i + 1 }));
    })()
    : csvRows(text);
  rows.forEach(({ row: r, sourceRow }) => {
    const type = pick(r, ["type", "kind", "category"]).toLowerCase();
    const start = normDate(pick(r, ["start", "date", "checkin", "departure"]), pick(r, ["time", "starttime"]));
    if (!start) return out.errors.push(`Row ${sourceRow}: unreadable start/date`);
    const endRaw = pick(r, ["end", "checkout", "arrival", "enddate"]);
    const end = endRaw ? normDate(endRaw) ?? undefined : undefined;
    const tierN = Number(pick(r, ["tier"]));
    const tier = (tierN === 2 || tierN === 3 ? tierN : 3) as Tier;
    const purpose = purposeFrom(r);
    const companions = companionsFrom(r);
    const raw = r;
    const base = {
      id: uid(), source: "generic" as Source, tier, start, end, createdAt: now(),
      reflection: pick(r, ["notes", "note", "journal"]) || undefined, purpose, companions, raw,
    };
    if (["leg", "flight", "train", "rail", "air", "road", "drive", "bus"].includes(type)) {
      const mode = type === "flight" || type === "air" ? "air" : type === "train" || type === "rail" ? "rail" : type === "leg" ? ((pick(r, ["mode"]) as Leg["mode"]) || "road") : "road";
      const leg: Leg = { ...base, kind: "leg", mode, from: pick(r, ["from", "origin"]), to: pick(r, ["to", "destination"]), flightNumber: pick(r, ["flightnumber", "flight"]) || undefined, operator: pick(r, ["operator", "airline"]) || undefined, dedupeKey: "" };
      if (!leg.from || !leg.to) return out.errors.push(`Row ${sourceRow}: leg missing from/to`);
      withTiming(leg);
      leg.dedupeKey = legKey(leg);
      out.entries.push({ entry: leg, warnings: legWarnings(leg), sourceRow });
    } else if (["stay", "hotel", "lodging", "accommodation"].includes(type)) {
      const city = pick(r, ["city"]) || undefined;
      const tz = city ? timezoneFor(city) : undefined;
      const s: Stay = {
        ...base, kind: "stay", place: pick(r, ["place", "name", "hotel", "title"]) || "Stay", city, dedupeKey: "",
        startTz: tz, endTz: tz, startUTC: localToUTC(start, tz), endUTC: end ? localToUTC(end, tz) : undefined,
      };
      s.dedupeKey = stayKey(s);
      out.entries.push({ entry: s, warnings: end ? [] : ["No check-out date"], sourceRow });
    } else if (type in EVENT_TYPES) {
      const city = pick(r, ["city"]);
      const tz = timezoneFor(city);
      const e: JEvent = {
        ...base, kind: "event", category: EVENT_TYPES[type], artist: pick(r, ["title", "artist", "name"]) || "Moment",
        venue: pick(r, ["venue", "place"]), city, people: companions, dedupeKey: "",
        startTz: tz, startUTC: localToUTC(start, tz),
        endTz: end ? tz : undefined, endUTC: end ? localToUTC(end, tz) : undefined,
      };
      e.dedupeKey = eventKey(e);
      out.entries.push({ entry: e, warnings: [], sourceRow });
    } else out.errors.push(`Row ${sourceRow}: unknown type "${type}" (use flight/train/stay/concert/gathering/birthday/milestone/memory…)`);
  });
  return out;
}

export const PARSERS: Record<Exclude<Source, "manual">, (t: string) => ParseResult> = {
  viaduct: parseViaduct,
  setlistfm: parseSetlist,
  generic: parseGeneric,
};

export function detectSource(filename: string, text: string): Exclude<Source, "manual"> {
  const head = text.slice(0, 400).toLowerCase();
  if (head.includes("eventdate") || head.includes('"artist"') || /setlist/i.test(filename)) return "setlistfm";
  if (/viaduct/i.test(filename) || (head.includes("station") || (head.includes("origin") && head.includes("operator")))) return "viaduct";
  return "generic";
}

export { legKey, eventKey, stayKey };
