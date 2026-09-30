/**
 * Leg timing helpers (UTC resolution + warnings).
 * Moved verbatim from parsers.ts — no behaviour change.
 */
import { locate, timezoneFor } from "../geo";
import { localToUTC } from "../tz";
import type { Leg } from "../types";

/** Attach timezone + UTC to a leg from its resolved origin/destination, in place. */
export function withTiming(leg: Leg): Leg {
  leg.startTz = timezoneFor(leg.from);
  leg.endTz = timezoneFor(leg.to);
  leg.startUTC = localToUTC(leg.start, leg.startTz);
  leg.endUTC = leg.end ? localToUTC(leg.end, leg.endTz) : undefined;
  return leg;
}

export function legWarnings(l: Leg): string[] {
  const w: string[] = [];
  if (!l.start.includes("T")) w.push("No departure time");
  if (l.end && l.end < l.start)
    w.push("Arrival earlier than departure (overnight or TZ?)");
  if (!locate(l.from))
    w.push(`Unknown location "${l.from}" — won't appear on map`);
  if (!locate(l.to))
    w.push(`Unknown location "${l.to}" — won't appear on map`);
  return w;
}
