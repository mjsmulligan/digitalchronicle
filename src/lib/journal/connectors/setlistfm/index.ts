/**
 * setlist.fm JSON/CSV connector.
 * Logic moved verbatim from parsers.ts — no behaviour change.
 */
import { uid } from "../../types";
import type { JEvent } from "../../types";
import { locate, timezoneFor } from "../../geo";
import { localToUTC } from "../../tz";
import type { Connector, ParseResult } from "../types";
import { csvRows } from "../csv";
import { normDate } from "../dates";
import { pick, purposeFrom, companionsFrom } from "../fields";
import { eventKey } from "../keys";

const now = () => new Date().toISOString();

type SetlistJSON = {
  eventDate?: string;
  artist?: { name?: string };
  venue?: { name?: string; city?: { name?: string; country?: { name?: string } } };
  tour?: { name?: string };
  sets?: { set?: { song?: { name?: string }[] }[] };
};

function parseSetlist(text: string): ParseResult {
  const out: ParseResult = { entries: [], errors: [] };
  const trimmed = text.trim();
  let rows: {
    row: Record<string, unknown>;
    raw: Record<string, unknown>;
    sourceRow: number;
  }[] = [];
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const j = JSON.parse(trimmed) as SetlistJSON | SetlistJSON[];
    const arr: SetlistJSON[] = Array.isArray(j)
      ? j
      : (j as { setlist?: SetlistJSON[]; setlists?: SetlistJSON[] }).setlist ??
        (j as { setlist?: SetlistJSON[]; setlists?: SetlistJSON[] }).setlists ??
        [];
    rows = arr.map((s, i) => ({
      sourceRow: i + 1,
      raw: { ...s } as Record<string, unknown>,
      row: {
        date: s.eventDate ?? "",
        artist: s.artist?.name ?? "",
        venue: s.venue?.name ?? "",
        city: s.venue?.city?.name ?? "",
        country: s.venue?.city?.country?.name ?? "",
        tour: s.tour?.name ?? "",
        songs: (s.sets?.set ?? [])
          .flatMap((x) => (x.song ?? []).map((so) => so.name ?? ""))
          .filter(Boolean),
      },
    }));
  } else {
    rows = csvRows(text).map(({ row, sourceRow }) => ({
      row,
      raw: row,
      sourceRow,
    }));
  }
  rows.forEach(({ row: r, raw, sourceRow }) => {
    const start = normDate(pick(r, ["date", "eventDate", "Event date"]));
    const artist = pick(r, ["artist", "Artist name"]);
    if (!start || !artist)
      return out.errors.push(`Entry ${sourceRow}: missing date or artist`);
    const songs = Array.isArray(r.songs)
      ? (r.songs as string[])
      : pick(r, ["songs", "setlist"])
          .split(/[;|]/)
          .map((s) => s.trim())
          .filter(Boolean);
    const city = pick(r, ["city", "City name"]);
    const tz = timezoneFor(city);
    const ev: JEvent = {
      id: uid(),
      kind: "event",
      category: "concert",
      source: "setlistfm",
      tier: 2,
      start,
      artist,
      venue: pick(r, ["venue", "Venue name"]) || "Unknown venue",
      city,
      country: pick(r, ["country"]) || undefined,
      tour: pick(r, ["tour"]) || undefined,
      setlist: songs.length ? songs : undefined,
      dedupeKey: "",
      createdAt: now(),
      purpose: purposeFrom(r),
      companions: companionsFrom(r),
      startTz: tz,
      startUTC: localToUTC(start, tz),
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

export const connector: Connector = {
  id: "setlistfm",
  label: "setlist.fm JSON/CSV",
  kind: "file",
  tier: 2,
  accepts: [".json", ".csv"],
  sniff(name, head) {
    if (
      head.includes("eventdate") ||
      head.includes('"artist"') ||
      /setlist/i.test(name)
    )
      return 0.9;
    return 0;
  },
  parse({ text }) {
    return parseSetlist(text);
  },
};
