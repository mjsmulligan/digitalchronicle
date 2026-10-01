/**
 * Deduplication key builders.
 * Keys are namespaced by source so that e.g. a viaduct rail leg and a
 * manually-entered leg with the same route and date are stored as separate
 * records (each source owns its own key space).
 *
 * Format: <source>|<kind>|<date>|<discriminator…>
 * Example: viaduct|leg|2024-06-01|BHM|MAN
 */
import type { JEvent, Leg, Stay } from "../types";

export function legKey(l: Pick<Leg, "start" | "from" | "to">, source: string) {
  return `${source}|leg|${l.start.slice(0, 10)}|${l.from.toUpperCase()}|${l.to.toUpperCase()}`;
}

export function eventKey(e: Pick<JEvent, "start" | "artist">, source: string) {
  return `${source}|event|${e.start.slice(0, 10)}|${e.artist.toLowerCase()}`;
}

export function stayKey(s: Pick<Stay, "start" | "place">, source: string) {
  return `${source}|stay|${s.start.slice(0, 10)}|${s.place.toLowerCase()}`;
}
