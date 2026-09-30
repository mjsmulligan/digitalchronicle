import { allEntries, getState, putMany, removeMany, storeFor } from "./db";
import { detectConnector, getConnector, UNSUPPORTED_FORMATS } from "./connectors/registry";
import { loadStations, locate } from "./geo";
import {
  day, uid, view, type Cluster, type Entry, type StagedRecord, type StagingBatch, type Trip,
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
  if (v.kind === "leg") return locate(v.to)?.name.replace(/ (Heathrow|Gatwick|Brandenburg|CDG|Schiphol|Haneda|Narita|Kansai|JFK|Fiumicino|Hbf|Centraal|Nord|Midi|St Pancras|hl\.n\.)$/, "") ?? v.toName ?? v.to;
  if (v.kind === "stay") return v.city ?? v.place;
  return v.city || v.venue;
}

export function clusterRecords(records: StagedRecord[], gapDays: number): Cluster[] {
  const items = records.filter((r) => r.selected && (r.status === "new" || r.status === "supersedes")).map((r) => r.entry).sort((a, b) => a.start.localeCompare(b.start));
  const clusters: Entry[][] = [];
  let lastEnd = 0;
  for (const e of items) {
    const s = new Date(day(e.start) + "T00:00").getTime();
    const en = new Date(day(e.end ?? e.start) + "T00:00").getTime();
    if (!clusters.length || s - lastEnd > gapDays * 86400000) clusters.push([]);
    clusters[clusters.length - 1].push(e);
    lastEnd = Math.max(s === lastEnd ? lastEnd : s, en);
  }
  return clusters.map((c) => ({ id: uid(), title: suggestTitle(c), recordIds: c.map((e) => e.id), accepted: c.some((e) => e.kind !== "event") }));
}

export function suggestTitle(c: Entry[]): string {
  const origin = c.find((e) => e.kind === "leg");
  const home = origin?.kind === "leg" ? placeLabel({ ...origin, to: origin.from } as Entry) : "";
  const dests = [...new Set(c.map(placeLabel))].filter((d) => d && d !== home);
  const month = new Date(day(c[0].start) + "T00:00").toLocaleDateString("en-GB", { month: "short", year: "numeric" });
  return `${dests.slice(0, 3).join(" · ") || "Trip"} — ${month}`;
}

export async function stageFile(filename: string, text: string, forced?: string) {
  const header = text.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0].toLowerCase();

  // Reject explicitly unsupported formats before any parsing.
  for (const fmt of UNSUPPORTED_FORMATS) {
    if (fmt.detect(header)) throw new Error(fmt.message);
  }

  const connector = forced
    ? getConnector(forced) ?? detectConnector(filename, text)
    : detectConnector(filename, text);
  const source = connector.id;

  await loadStations();
  let res;
  try {
    res = await connector.parse({ name: filename, text });
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
      // Replace source data but keep sovereign overrides, reflection & trip link
      e = { ...r.entry, id: old.id, tripId: old.tripId, overrides: old.overrides, reflection: old.reflection ?? r.entry.reflection } as Entry;
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
