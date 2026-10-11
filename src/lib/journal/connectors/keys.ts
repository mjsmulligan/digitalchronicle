/**
 * Deduplication key builders.
 *
 * All keys are source-agnostic so that the tier system can arbitrate when the
 * same entry arrives from two different connectors (e.g. a setlist.fm import
 * and a generic CSV both recording the same concert).
 *
 * Format:
 *   leg:   leg|<date>|<FROM>|<TO>
 *   stay:  stay|<date>|<place>
 *   event: event|<date>|<artist>
 */
import type { JEvent, Leg, Stay } from "../types";

export function legKey(l: Pick<Leg, "start" | "from" | "to">) {
  return `leg|${l.start.slice(0, 10)}|${l.from.toUpperCase()}|${l.to.toUpperCase()}`;
}

export function eventKey(e: Pick<JEvent, "start" | "artist">) {
  return `event|${e.start.slice(0, 10)}|${e.artist.toLowerCase()}`;
}

export function stayKey(s: Pick<Stay, "start" | "place">) {
  return `stay|${s.start.slice(0, 10)}|${s.place.toLowerCase()}`;
}
