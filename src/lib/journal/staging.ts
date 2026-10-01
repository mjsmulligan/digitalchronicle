import { allEntries, getState, putMany, removeMany, storeFor } from "./db";
import { PARSERS, detectSource } from "./parsers";
import { loadStations, locate } from "./geo";
import {
  uid, view, type Entry, type Source, type StagedRecord, type StagingBatch,
} from "./types";

/** Precedence: lower tier number wins (1 manual > 2 primary transit > 3 secondary). */
function classify(entry: Entry, existing: Map<string, Entry>, seen: Set<string>): Pick<StagedRecord, "status" | "matchId"> {
  if (seen.has(entry.dedupeKey)) return { status: "batch-duplicate" };
  seen.add(entry.dedupeKey);
  const m = existing.get(entry.dedupeKey);
  if (!m) return { status: "new" };
  if (entry.tier < m.tier) return { status: "supersedes", matchId: m.id };
  if (entry.tier > m.tier) return { status: "superseded", matchId: m.id };
  return { status: "duplicate", matchId: m.id };
}

export function placeLabel(e: Entry): string {
  const v = view(e);
  if (v.kind === "leg") return locate(v.to)?.name ?? v.toName ?? v.to;
  if (v.kind === "stay") return v.city ?? v.place;
  return v.city || v.venue;
}

export async function stageFile(filename: string, text: string, forced?: Exclude<Source, "manual">) {
  const header = text.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0].toLowerCase();
  const columns = new Set(header.split(",").map((cell) => cell.trim()));
  if (["flight number", "dep time", "arr time", "aircraft"].every((field) => columns.has(field))) {
    throw new Error("Flightradar24 exports are not supported. Use a generic flight CSV or add flights manually.");
  }
  const source = forced ?? detectSource(filename, text);
  await loadStations();
  let res;
  try {
    res = PARSERS[source](text);
  } catch (err) {
    res = { entries: [], errors: [`Could not parse file: ${(err as Error).message}`] };
  }
  const existing = new Map(allEntries(getState()).map((e) => [e.dedupeKey, e]));
  const seen = new Set<string>();
  const records: StagedRecord[] = res.entries.map(({ entry, warnings, sourceRow }) => {
    entry.sourceRef = `${filename}#row${sourceRow}`;
    const c = classify(entry, existing, seen);
    return { entry, warnings, ...c, selected: c.status === "new" || c.status === "supersedes" };
  });
  const batch: StagingBatch = { id: uid(), source, filename, createdAt: new Date().toISOString(), records, errors: res.errors, clusters: [], gapDays: 2 };
  batch.clusters = clusterRecords(records, batch.gapDays);
  await putMany("staging", [batch]);
  return batch;
}

export async function saveBatch(b: StagingBatch) {
  await putMany("staging", [b]);
}

export async function commitBatch(b: StagingBatch) {
  const s = getState();
  const byId = new Map(allEntries(s).map((e) => [e.id, e]));
  const idMap = new Map<string, string>();
  const writes: Record<string, Entry[]> = { legs: [], stays: [], events: [] };
  let count = 0;
  for (const r of b.records) {
    if (!r.selected) continue;
    let e: Entry;
    if (r.status === "new") e = r.entry;
    else if (r.status === "supersedes" && r.matchId && byId.get(r.matchId)) {
      const old = byId.get(r.matchId)!;
      // Replace source data but keep sovereign overrides, journal & trip link
      e = { ...r.entry, id: old.id, tripId: old.tripId, overrides: old.overrides, journal: old.journal ?? r.entry.journal } as Entry;
    } else continue;
    idMap.set(r.entry.id, e.id);
    writes[storeFor(e)].push(e);
    count++;
  }
  const trips: Trip[] = [];
  const all = Object.values(writes).flat();
  const find = (id: string) => all.find((e) => e.id === (idMap.get(id) ?? id));
  for (const c of b.clusters) {
    if (!c.accepted) continue;
    const members = c.recordIds.map(find).filter(Boolean) as Entry[];
    if (!members.length) continue;
    members.sort((a, b) => a.start.localeCompare(b.start));
    const trip: Trip = {
      id: uid(), title: c.title, start: day(members[0].start),
      end: day(members.reduce((m, e) => ((e.end ?? e.start) > m ? e.end ?? e.start : m), members[0].start)),
      destinations: [...new Set(members.map(placeLabel))], notes: "", cover: "", createdAt: new Date().toISOString(),
    };
    trip.cover = `${members.filter((e) => e.kind === "leg").length} legs · ${members.filter((e) => e.kind === "event").length} events · ${trip.destinations.length} places`;
    members.forEach((m) => (m.tripId = trip.id));
    trips.push(trip);
  }
  await putMany("legs", writes.legs);
  await putMany("stays", writes.stays);
  await putMany("events", writes.events);
  await putMany("trips", trips);
  await removeMany("staging", [b.id]);
  return { count, trips: trips.length };
}
