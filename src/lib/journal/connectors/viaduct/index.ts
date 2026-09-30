/**
 * Viaduct rail CSV connector.
 * Logic moved verbatim from parsers.ts — no behaviour change.
 */
import { uid } from "../../types";
import type { Leg } from "../../types";
import type { Connector, ParseResult } from "../types";
import { csvRows } from "../csv";
import { normDate } from "../dates";
import { pick, confidenceFrom, purposeFrom, companionsFrom } from "../fields";
import { legKey } from "../keys";
import { withTiming, legWarnings } from "../timing";

const now = () => new Date().toISOString();

function parseViaduct(text: string): ParseResult {
  const out: ParseResult = { entries: [], errors: [] };
  csvRows(text).forEach(({ row: r, sourceRow }) => {
    const date = pick(r, ["Date", "Travel date", "Departure date"]);
    const start = normDate(
      date || pick(r, ["Departure", "Departure time", "Departs"]),
      pick(r, ["Departure time", "Dep time", "Departs"]),
    );
    if (!start) return out.errors.push(`Row ${sourceRow}: unreadable date`);
    const from = pick(r, [
      "Origin",
      "From",
      "Departure station",
      "Origin station",
      "from_station_name",
    ]);
    const to = pick(r, [
      "Destination",
      "To",
      "Arrival station",
      "Destination station",
      "to_station_name",
    ]);
    if (!from || !to)
      return out.errors.push(`Row ${sourceRow}: missing stations`);
    const arr = pick(r, ["Arrival time", "Arr time", "Arrives", "Arrival"]);
    const arrivalDate = pick(r, ["arrival_date"]);
    const end = arrivalDate
      ? (normDate(arrivalDate, arr) ?? undefined)
      : arr
        ? (normDate(
            arr.length > 8 ? arr : start.slice(0, 10),
            arr.length > 8 ? "" : arr,
          ) ?? undefined)
        : undefined;
    const leg: Leg = {
      id: uid(),
      kind: "leg",
      mode: "rail",
      source: "viaduct",
      tier: 2,
      start,
      end,
      from,
      to,
      operator: pick(r, ["Operator", "Company"]),
      trainNumber: pick(r, [
        "Train",
        "Train number",
        "Service",
        "train_code",
      ]),
      seat: pick(r, ["Seat", "Coach/Seat"]),
      journal: pick(r, ["Notes", "Note"]) || undefined,
      dedupeKey: "",
      createdAt: now(),
      confidence: confidenceFrom(r, "confirmed"),
      purpose: purposeFrom(r),
      companions: companionsFrom(r),
      raw: r,
    };
    withTiming(leg);
    leg.dedupeKey = legKey(leg);
    out.entries.push({ entry: leg, warnings: legWarnings(leg), sourceRow });
  });
  return out;
}

export const connector: Connector = {
  id: "viaduct",
  label: "Viaduct rail CSV",
  kind: "file",
  tier: 2,
  accepts: [".csv"],
  sniff(name, head) {
    if (
      /viaduct/i.test(name) ||
      head.includes("station") ||
      (head.includes("origin") && head.includes("operator"))
    )
      return 0.8;
    return 0;
  },
  parse({ text }) {
    return parseViaduct(text);
  },
};
