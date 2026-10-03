/**
 * Deduplication key builders.
 *
 * Leg and Stay keys are source-agnostic so that the tier system can arbitrate
 * when the same journey arrives from two different connectors (e.g. a Viaduct
 * CSV and a generic import). Film and Episode keys already follow this pattern.
 *
 * Event keys remain source-namespaced for now because there is only one event
 * connector; that can be revisited if a second event source is added.
 *
 * Format:
 *   leg:   leg|<date>|<FROM>|<TO>
 *   stay:  stay|<date>|<place>
 *   event: <source>|event|<date>|<artist>
 */
import type { JEvent, Leg, Stay } from "../types";

export function legKey(l: Pick<Leg, "start" | "from" | "to">) {
  return `leg|${l.start.slice(0, 10)}|${l.from.toUpperCase()}|${l.to.toUpperCase()}`;
}

export function eventKey(e: Pick<JEvent, "start" | "artist">, source: string) {
  return `${source}|event|${e.start.slice(0, 10)}|${e.artist.toLowerCase()}`;
}

export function stayKey(s: Pick<Stay, "start" | "place">) {
  return `stay|${s.start.slice(0, 10)}|${s.place.toLowerCase()}`;
}
