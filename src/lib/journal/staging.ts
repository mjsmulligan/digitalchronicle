import { allEntries, getState, putMany, removeMany, storeFor } from "./db";
import { detectConnector, getConnector, UNSUPPORTED_FORMATS } from "./connectors/registry";
import { loadStations, locate } from "./geo";
import {
  uid, view, type Entry, type StagedRecord, type StagingBatch,
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
  if (v.kind === "film") return v.title;
  if (v.kind === "episode") return v.showTitle;
  if (v.kind === "book") return v.title;
  return v.city || v.venue;
}

export async function stageFile(filename: string, text: string, forced?: string) {
  const header = text.replace(/^﻿/, "").split(/\r?\n/, 1)[0].toLowerCase();

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
  const batch: StagingBatch = { id: uid(), source, filename, createdAt: new Date().toISOString(), records, errors: res.errors };
  await putMany("staging", [batch]);
  return batch;
}

export async function saveBatch(b: StagingBatch) {
  await putMany("staging", [b]);
}

export async function commitBatch(b: StagingBatch) {
  const s = getState();
  const byId = new Map(allEntries(s).map((e) => [e.id, e]));
  const writes: Record<string, Entry[]> = { legs: [], stays: [], events: [], films: [], episodes: [], books: [] };
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
    writes[storeFor(e)].push(e);
    count++;
  }
  await putMany("legs", writes.legs);
  await putMany("stays", writes.stays);
  await putMany("events", writes.events);
  await putMany("films", writes.films);
  await putMany("episodes", writes.episodes);
  await putMany("books", writes.books);
  await removeMany("staging", [b.id]);
  return { count };
}
