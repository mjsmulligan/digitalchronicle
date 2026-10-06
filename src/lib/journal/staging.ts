import { allEntries, getState, putMany, removeMany, setCommitProgress, storeFor } from "./db";
import { detectConnector, getConnector, UNSUPPORTED_FORMATS } from "./connectors/registry";
import { loadStations } from "./geo";
import {
  uid, view, type Entry, type Leg, type StagedRecord, type StagingBatch,
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
  if (v.kind === "leg") return v.toName ?? v.to;
  if (v.kind === "stay") return v.city ?? v.place;
  if (v.kind === "place") return v.locality;
  if (v.kind === "place-entry") return v.localDay;
  if (v.kind === "film") return v.title;
  if (v.kind === "episode") return v.showTitle;
  if (v.kind === "book") return v.title;
  // JEvent
  return v.city || v.venue;
}

export async function stageFile(filename: string, text: string, forced?: string) {
  // Connectors resolve place names against the gazetteer during parsing —
  // make sure it's loaded (lazy-loaded module) before we start.
  await loadStations();
  const header = text.replace(/^﻿/, "").split(/\r?\n/, 1)[0].toLowerCase();

  // Reject explicitly unsupported formats before any parsing.
  for (const fmt of UNSUPPORTED_FORMATS) {
    if (fmt.detect(header)) throw new Error(fmt.message);
  }

  const connector = forced
    ? getConnector(forced) ?? detectConnector(filename, text)
    : detectConnector(filename, text);
  const source = connector.id;

  let res;
  try {
    res = await connector.parse({ name: filename, text });
  } catch (err) {
    res = { entries: [], errors: [`Could not parse file: ${(err as Error).message}`] };
  }
  const existing = new Map(allEntries(getState()).map((e) => [e.dedupeKey, e]));
  const seen = new Set<string>();

  // Secondary index: date → existing legs, for fuzzy flight dedup (see below).
  const legsByDate = new Map<string, Entry[]>();
  for (const e of existing.values()) {
    if (e.kind === "leg") {
      const day = e.start.slice(0, 10);
      const bucket = legsByDate.get(day);
      if (bucket) bucket.push(e);
      else legsByDate.set(day, [e]);
    }
  }

  // Chunk the classify loop so the UI thread isn't starved on large imports
  // (e.g. 4000-row Netflix history). Yield every 200 entries.
  const CLASSIFY_CHUNK = 200;
  const records: StagedRecord[] = [];
  for (let i = 0; i < res.entries.length; i++) {
    if (i > 0 && i % CLASSIFY_CHUNK === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    const { entry, sourceRow } = res.entries[i];
    let { warnings } = res.entries[i];
    entry.sourceRef = `${filename}#row${sourceRow}`;
    let c = classify(entry, existing, seen);

    // Fuzzy flight dedup: a leg with ??? placeholder codes (airport codes
    // couldn't be parsed from the calendar summary) won't match any real leg by
    // dedupeKey. If another leg already exists on the same date, flag it as a
    // likely duplicate so the user reviews it rather than auto-committing.
    if (
      c.status === "new" &&
      entry.kind === "leg" &&
      (entry as Leg).from === "???"
    ) {
      const sameDayLegs = legsByDate.get(entry.start.slice(0, 10)) ?? [];
      if (sameDayLegs.length > 0) {
        c = { status: "duplicate", matchId: sameDayLegs[0].id };
        warnings = [
          ...warnings,
          "Airport codes couldn't be parsed — possible duplicate of an existing flight on this date. Verify before committing.",
        ];
      }
    }

    records.push({ entry, warnings, ...c, selected: c.status === "new" || c.status === "supersedes" });
  }
  const batch: StagingBatch = { id: uid(), source, filename, createdAt: new Date().toISOString(), records, errors: res.errors };
  await putMany("staging", [batch]);
  return batch;
}

export async function saveBatch(b: StagingBatch) {
  await putMany("staging", [b]);
}

const COMMIT_CHUNK = 100;

export async function commitBatch(b: StagingBatch) {
  const s = getState();
  const byId = new Map(allEntries(s).map((e) => [e.id, e]));
  const writes: Record<string, Entry[]> = { legs: [], stays: [], events: [], films: [], episodes: [], books: [], placeEvents: [], placeEntries: [] };
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

  // Flatten all entries to write so we can report progress across store types.
  const allWrites: { store: keyof typeof writes; entry: Entry }[] = [];
  for (const store of ["legs", "stays", "events", "films", "episodes", "books", "placeEvents", "placeEntries"] as const) {
    for (const entry of writes[store]) allWrites.push({ store, entry });
  }

  const total = allWrites.length;
  setCommitProgress({ batchId: b.id, done: 0, total });

  // Write in chunks, yielding between each so the UI can update the progress bar.
  for (let i = 0; i < allWrites.length; i += COMMIT_CHUNK) {
    const chunk = allWrites.slice(i, i + COMMIT_CHUNK);

    // Group this chunk by store for a single putMany call per store.
    const chunkByStore: Record<string, Entry[]> = {};
    for (const { store, entry } of chunk) {
      (chunkByStore[store] ??= []).push(entry);
    }
    for (const [store, entries] of Object.entries(chunkByStore)) {
      await putMany(store as "legs" | "stays" | "events" | "films" | "episodes" | "books" | "placeEvents", entries);
    }

    setCommitProgress({ batchId: b.id, done: Math.min(i + COMMIT_CHUNK, total), total });
    // Yield so React can re-render the progress bar before the next chunk.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  await removeMany("staging", [b.id]);
  setCommitProgress(null);
  return { count };
}
