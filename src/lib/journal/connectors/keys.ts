/**
 * Deduplication key builders.
 * Moved verbatim from parsers.ts — no behaviour change.
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
