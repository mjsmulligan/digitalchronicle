/**
 * Generic / cleaned CSV + JSON connector.
 * Logic moved verbatim from parsers.ts — no behaviour change.
 */
import { uid } from "../../types";
import type { JEvent, Leg, Stay, EventCategory, Tier } from "../../types";
import { timezoneFor } from "../../geo";
import { localToUTC } from "../../tz";
import type { Connector, ParseResult } from "../types";
import { csvRows } from "../csv";
import { normDate } from "../dates";
import { pick, purposeFrom, companionsFrom } from "../fields";
import { legKey, eventKey, stayKey } from "../keys";
import { withTiming, legWarnings } from "../timing";

const now = () => new Date().toISOString();

const EVENT_TYPES: Record<string, EventCategory> = {
  event: "activity",
  activity: "activity",
  concert: "concert",
  gig: "concert",
  show: "concert",
  gathering: "gathering",
  party: "gathering",
  dinner: "gathering",
  social: "gathering",
  celebration: "celebration",
  birthday: "celebration",
  wedding: "celebration",
  anniversary: "celebration",
  milestone: "milestone",
  life: "milestone",
  memory: "memory",
  moment: "memory",
};

function parseGeneric(text: string): ParseResult {
  const out: ParseResult = { entries: [], errors: [] };
  const t = text.trim();
  const rows: { row: Record<string, unknown>; sourceRow: number }[] =
    t.startsWith("[") || t.startsWith("{")
      ? (() => {
          const j = JSON.parse(t) as
            | Record<string, unknown>[]
            | { records?: Record<string, unknown>[]; data?: Record<string, unknown>[] };
          const data: Record<string, unknown>[] = Array.isArray(j)
            ? j
            : (j as { records?: Record<string, unknown>[]; data?: Record<string, unknown>[] })
                .records ??
              (j as { records?: Record<string, unknown>[]; data?: Record<string, unknown>[] })
                .data ??
              [];
          return data.map((row, i) => ({ row, sourceRow: i + 1 }));
        })()
      : csvRows(text);
  rows.forEach(({ row: r, sourceRow }) => {
    const type = pick(r, ["type", "kind", "category"]).toLowerCase();
    const start = normDate(
      pick(r, ["start", "date", "checkin", "departure"]),
      pick(r, ["time", "starttime"]),
    );
    if (!start)
      return out.errors.push(`Row ${sourceRow}: unreadable start/date`);
    const endRaw = pick(r, ["end", "checkout", "arrival", "enddate"]);
    const end = endRaw ? (normDate(endRaw) ?? undefined) : undefined;
    const tierN = Number(pick(r, ["tier"]));
    const tier = (tierN === 2 || tierN === 3 ? tierN : 3) as Tier;
    const purpose = purposeFrom(r);
    const companions = companionsFrom(r);
    const raw = r;
    const base = {
      id: uid(),
      source: "generic",
      tier,
      start,
      end,
      createdAt: now(),
      reflection: pick(r, ["notes", "note", "journal", "reflection"]) || undefined,
      purpose,
      companions,
      raw,
    };
    if (
      ["leg", "flight", "train", "rail", "air", "road", "drive", "bus"].includes(
        type,
      )
    ) {
      const mode =
        type === "flight" || type === "air"
          ? "air"
          : type === "train" || type === "rail"
            ? "rail"
            : type === "leg"
              ? ((pick(r, ["mode"]) as Leg["mode"]) || "road")
              : "road";
      const leg: Leg = {
        ...base,
        source: "generic",
        kind: "leg",
        mode,
        from: pick(r, ["from", "origin"]),
        to: pick(r, ["to", "destination"]),
        flightNumber: pick(r, ["flightnumber", "flight_number", "flight"]) || undefined,
        operator: pick(r, ["operator", "airline"]) ||
          // Derive from IATA carrier prefix (e.g. "FR3670" → "FR") when no
          // explicit operator column exists (Google Wallet CSV, etc.)
          (pick(r, ["flightnumber", "flight_number", "flight"]) || "").match(/^([A-Z]{2})/)?.[1] ||
          undefined,
        dedupeKey: "",
      };
      if (!leg.from || !leg.to)
        return out.errors.push(`Row ${sourceRow}: leg missing from/to`);
      withTiming(leg);
      leg.dedupeKey = legKey(leg);
      out.entries.push({ entry: leg, warnings: legWarnings(leg), sourceRow });
    } else if (
      ["stay", "hotel", "lodging", "accommodation"].includes(type)
    ) {
      const city = pick(r, ["city"]) || undefined;
      const tz = city ? timezoneFor(city) : undefined;
      const s: Stay = {
        ...base,
        source: "generic",
        kind: "stay",
        place: pick(r, ["place", "name", "hotel", "title"]) || "Stay",
        city,
        dedupeKey: "",
        startTz: tz,
        endTz: tz,
        startUTC: localToUTC(start, tz),
        endUTC: end ? localToUTC(end, tz) : undefined,
      };
      s.dedupeKey = stayKey(s);
      out.entries.push({
        entry: s,
        warnings: end ? [] : ["No check-out date"],
        sourceRow,
      });
    } else if (type in EVENT_TYPES) {
      const city = pick(r, ["city"]);
      const tz = timezoneFor(city);
      const e: JEvent = {
        ...base,
        source: "generic",
        kind: "event",
        category: EVENT_TYPES[type]!,
        artist: pick(r, ["title", "artist", "name"]) || "Moment",
        venue: pick(r, ["venue", "place"]),
        city,
        people: companions,
        dedupeKey: "",
        startTz: tz,
        startUTC: localToUTC(start, tz),
        endTz: end ? tz : undefined,
        endUTC: end ? localToUTC(end, tz) : undefined,
      };
      e.dedupeKey = eventKey(e, "generic");
      out.entries.push({ entry: e, warnings: [], sourceRow });
    } else
      out.errors.push(
        `Row ${sourceRow}: unknown type "${type}" (use flight/train/stay/concert/gathering/birthday/milestone/memory…)`,
      );
  });
  return out;
}

export const connector: Connector = {
  id: "generic",
  label: "Generic / cleaned CSV or JSON",
  kind: "file",
  tier: 3,
  accepts: [".csv", ".json", ".txt"],
  // No sniff — generic is always the fallback in detectConnector.
  parse({ text }) {
    return parseGeneric(text);
  },
};
