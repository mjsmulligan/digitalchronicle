/**
 * Converting an entry to another kind (docs/specs/merge-dedup.md, WP10).
 *
 * Only event to stay is supported: a calendar item that is really a hotel night arrives
 * as an event and never matches a stay from another source. The conversion is a new entry
 * of the other kind (a new id and key); the caller hides the old one, which keeps the old
 * key so re-importing the calendar row is `removed`, not a second event. `mergeEntries`
 * stays same-kind only: convert first, then merge normally.
 */
import { stayKey } from "./connectors/keys";
import { uid, type Entry, type JEvent, type Stay } from "./types";

const dayOf = (iso: string) => iso.slice(0, 10);

/** The stay an event would be. Keeps everything the user owns and the source's own data. */
export function eventToStay(event: JEvent, id: string = uid()): Stay {

  // Overrides that still mean something on a stay; the headline becomes the place.
  const o = (event.overrides ?? {}) as Record<string, unknown>;
  const overrides: Record<string, unknown> = {};
  if ("artist" in o) overrides.place = o.artist;
  for (const k of ["city", "start", "end"]) if (k in o) overrides[k] = k === "city" ? o[k] : dayOf(String(o[k]));

  const carry = [
    "source", "sourceRef", "sourceLocked", "raw", "createdAt", "additionalSources",
    "tripId", "participants", "companions", "reflection", "rating", "review",
    "startTz", "endTz", "notDuplicateOf", "possibleDuplicateOf",
  ] as const;
  const out: Record<string, unknown> = {};
  for (const k of carry) {
    const val = (event as unknown as Record<string, unknown>)[k];
    if (val !== undefined) out[k] = val;
  }
  const stay = {
    ...out,
    id,
    kind: "stay",
    place: event.artist,
    ...(event.city ? { city: event.city } : {}),
    start: dayOf(event.start),
    ...(event.end && dayOf(event.end) > dayOf(event.start) ? { end: dayOf(event.end) } : {}),
    ...(Object.keys(overrides).length ? { overrides } : {}),
    dedupeKey: "",
  } as unknown as Stay;
  // Keys come from the source's values, never from the user's overrides.
  stay.dedupeKey = stayKey({ start: event.start, place: event.artist });
  return stay;
}

export type ConvertTarget = "stay";

/** Kinds an entry of `kind` can be converted to. */
export const canConvert = (e: Entry, to: ConvertTarget) => to === "stay" && e.kind === "event";
