/**
 * Auto-import orchestrator (docs/specs/auto-import.md, section 5.1).
 *
 * importFile() replaces the stage-then-commit gate: it parses a file, classifies
 * every record against the journal (hidden entries included), and writes the
 * ones that are new, refresh an entry from the same source, or enrich an entry
 * from another source straight to the journal, flagged `unreviewed` so the feed can
 * show them for review. No source replaces another (docs/specs/merge-dedup.md).
 */
import {
  allEntries, allHiddenEntries, getState, putMany, setCommitProgress, storeFor,
} from "./db";
import { buildDedupeIndex, classify } from "./classify";
import { detectConnector, getConnector, UNSUPPORTED_FORMATS } from "./connectors/registry";
import { enrichAll } from "./artworkEnrichment";
import { loadStations } from "./geo";
import { sourceLocks } from "./evaluation";
import { enrichEntry, mergeEntries, refreshFromSource } from "./merge";
import { buildPeopleIndex, withMatchedPeople } from "./peopleMatch";
import {
  uid, type Entry, type ImportRun, type ImportSkipCounts, type Leg, type StoreName,
} from "./types";

export interface ImportResult {
  /** Absent when nothing was added or updated. */
  run?: ImportRun;
  added: number;
  updated: number;
  skipped: ImportSkipCounts;
  errors: string[];
}

export interface ImportOptions {
  /** Force a connector id instead of auto-detecting. */
  forced?: string;
  trigger?: "manual" | "startup";
  /** Aborts the follow-up artwork enrichment (never the import itself). */
  signal?: AbortSignal;
}

const WRITE_CHUNK = 100;
const CLASSIFY_CHUNK = 200;
/** Undo restores at most this many replaced entries per run (spec 4.2). */
export const MAX_REPLACED_SNAPSHOTS = 500;
const MAX_NOTES = 3;

export const POSSIBLE_DUPLICATE_NOTE = "Possible duplicate of an existing flight on this date";

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// ─── Single flight ───────────────────────────────────────────────────────────

/** One import at a time: a startup check waits for a manual import and the reverse. */
let tail: Promise<unknown> = Promise.resolve();

function singleFlight<T>(task: () => Promise<T>): Promise<T> {
  const result = tail.then(task, task);
  // Keep the chain alive whether the task resolves or rejects.
  tail = result.then(() => undefined, () => undefined);
  return result;
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export function importFile(filename: string, text: string, opts: ImportOptions = {}): Promise<ImportResult> {
  return singleFlight(() => runImport(filename, text, opts));
}

interface PlannedWrite {
  store: StoreName;
  entry: Entry;
  /** Prior version, for records that refresh or enrich an existing entry. */
  before?: Entry;
}

const emptySkips = (): ImportSkipCounts => ({ duplicate: 0, inFile: 0, removed: 0 });

async function runImport(filename: string, text: string, opts: ImportOptions): Promise<ImportResult> {
  const trigger = opts.trigger ?? "manual";
  const startedAt = new Date().toISOString();

  // 1. Detect unsupported formats and resolve connector.
  await loadStations();
  const header = text.replace(/^﻿/, "").split(/\r?\n/, 1)[0].toLowerCase();
  for (const fmt of UNSUPPORTED_FORMATS) {
    if (fmt.detect(header)) {
      // A manual import tells the user; a silent startup check only logs.
      if (trigger === "manual") throw new Error(fmt.message);
      console.warn(`auto-import: ${filename}: ${fmt.message}`);
      return { added: 0, updated: 0, skipped: emptySkips(), errors: [fmt.message] };
    }
  }

  const connector = opts.forced
    ? getConnector(opts.forced) ?? detectConnector(filename, text)
    : detectConnector(filename, text);

  let parsed;
  try {
    parsed = await connector.parse({ name: filename, text });
  } catch (err) {
    parsed = { entries: [], errors: [`Could not parse file: ${(err as Error).message}`] };
  }

  // 2. Lookup from ALL entries, hidden included, so a hide survives re-import (5.2).
  const journal = getState();
  const visible = allEntries(journal);
  const existing = buildDedupeIndex([...visible, ...allHiddenEntries(journal)]);
  const byId = new Map(visible.map((e) => [e.id, e]));
  // People known to the journal, for tagging attendees and names found in events.
  const peopleIndex = buildPeopleIndex(journal.people);

  // Fuzzy flight rule (5.3) looks at legs the user can see.
  const legsByDate = new Map<string, Entry[]>();
  for (const e of visible) {
    if (e.kind !== "leg") continue;
    const day = e.start.slice(0, 10);
    const bucket = legsByDate.get(day);
    if (bucket) bucket.push(e);
    else legsByDate.set(day, [e]);
  }

  // 3. Classify. Nothing is written yet.
  const skipped = emptySkips();
  const plan: PlannedWrite[] = [];
  const seen = new Set<string>();
  const runId = uid();
  const plannedByKey = new Map<string, PlannedWrite>();

  /** Plan the write of an entry that changed an existing one, flagged for review. */
  const addPlanned = (key: string, merged: Entry, old: Entry) => {
    // An entry nobody has looked at yet stays "new"; a reviewed one becomes "updated".
    const stillUnseen = old.unreviewed === "new";
    const written: Entry = {
      ...merged,
      unreviewed: stillUnseen ? "new" : "updated",
      importId: runId,
      ...(stillUnseen && old.importNotes?.length ? { importNotes: old.importNotes } : {}),
    };
    const p: PlannedWrite = { store: storeFor(written), entry: written, before: old };
    plan.push(p);
    plannedByKey.set(key, p);
  };

  for (let i = 0; i < parsed.entries.length; i++) {
    if (i > 0 && i % CLASSIFY_CHUNK === 0) await yieldToUi();
    const { entry, sourceRow } = parsed.entries[i];
    entry.sourceRef = `${filename}#row${sourceRow}`;
    entry.sourceLocked = sourceLocks(entry);
    const c = classify(entry, existing, seen);

    if (c.status === "removed") { skipped.removed++; continue; }

    // A second row with the same key in this file is the same thing seen twice: fold it
    // into the entry the first row produced (or matched), keeping both source references.
    if (c.status === "batch-duplicate") {
      skipped.inFile++;
      const row = withMatchedPeople(entry, peopleIndex);
      const target = plannedByKey.get(entry.dedupeKey);
      if (target) { target.entry = mergeEntries(target.entry, row, { absorb: true }); continue; }
      const match = existing.get(entry.dedupeKey);
      const old = match && !match.hidden ? byId.get(match.id) : undefined;
      if (!old) continue;
      const { entry: merged, changed } = enrichEntry(old, row);
      if (changed) addPlanned(entry.dedupeKey, merged, old);
      continue;
    }

    if (c.status === "duplicate") { skipped.duplicate++; continue; }

    if (c.status === "new") {
      const notes = [...(parsed.entries[i].warnings ?? [])];
      // A leg with placeholder codes and another leg on the same date might be a
      // repeat of a flight we already have. Import it flagged, with a note (5.3).
      if (entry.kind === "leg" && !(entry as Leg).from && (legsByDate.get(entry.start.slice(0, 10))?.length ?? 0) > 0) {
        notes.push(POSSIBLE_DUPLICATE_NOTE);
      }
      const written: Entry = {
        ...withMatchedPeople(entry, peopleIndex),
        unreviewed: "new",
        importId: runId,
        ...(notes.length ? { importNotes: notes.slice(0, MAX_NOTES) } : {}),
      };
      const p: PlannedWrite = { store: storeFor(written), entry: written };
      plan.push(p);
      plannedByKey.set(entry.dedupeKey, p);
      continue;
    }

    const old = c.matchId ? byId.get(c.matchId) : undefined;
    if (!old) { skipped.duplicate++; continue; }

    if (c.status === "enrich") {
      // Another source describes the same thing: fill gaps and record the source. The
      // entry is only touched (and flagged) when that changed something.
      const { entry: merged, changed } = enrichEntry(old, withMatchedPeople(entry, peopleIndex));
      if (!changed) { skipped.duplicate++; continue; }
      addPlanned(entry.dedupeKey, merged, old);
      continue;
    }

    // refresh: the same source says something new. Keep the user's id, trip, series,
    // overrides, reflection, participants, extra sources and anything another source filled in.
    // Keep the user's participants; if they have none, tag from the new source data.
    const incoming = old.participants === undefined ? withMatchedPeople(entry, peopleIndex) : entry;
    addPlanned(entry.dedupeKey, refreshFromSource(old, incoming), old);
  }

  const added = plan.filter((p) => !p.before).length;
  const updated = plan.length - added;
  const errors = parsed.errors ?? [];

  // 4. Nothing to write: no run is persisted.
  if (plan.length === 0) return { added: 0, updated: 0, skipped, errors };

  // 5. The run record goes in before any entry, so a killed app leaves evidence.
  const run: ImportRun = {
    id: runId,
    source: connector.id,
    filename,
    trigger,
    startedAt,
    status: "running",
    added: 0,
    updated: 0,
    skipped,
    errors,
    replaced: [],
  };
  await putMany("importRuns", [run]);

  // 6. Chunked writes.
  const progress = trigger === "manual";
  if (progress) setCommitProgress({ batchId: runId, done: 0, total: plan.length });
  try {
    for (let i = 0; i < plan.length; i += WRITE_CHUNK) {
      const chunk = plan.slice(i, i + WRITE_CHUNK);

      // Snapshots go into the run before the entries they protect are overwritten.
      let snapshotsChanged = false;
      for (const p of chunk) {
        if (p.before && run.replaced.length < MAX_REPLACED_SNAPSHOTS) {
          run.replaced.push({ store: p.store, before: p.before });
          snapshotsChanged = true;
        }
      }
      if (snapshotsChanged) await putMany("importRuns", [{ ...run }]);

      const byStore = new Map<StoreName, Entry[]>();
      for (const p of chunk) {
        const list = byStore.get(p.store);
        if (list) list.push(p.entry);
        else byStore.set(p.store, [p.entry]);
      }
      for (const [store, entries] of byStore) await putMany(store, entries);

      if (progress) setCommitProgress({ batchId: runId, done: Math.min(i + WRITE_CHUNK, plan.length), total: plan.length });
      await yieldToUi();
    }

    // 7. Close the run.
    run.added = added;
    run.updated = updated;
    run.finishedAt = new Date().toISOString();
    run.status = "done";
    await putMany("importRuns", [{ ...run }]);
  } finally {
    if (progress) setCommitProgress(null);
  }

  // 8. Artwork for the new entries only. Never fails the import (5.5).
  const newEntries = plan.filter((p) => !p.before).map((p) => p.entry);
  if (newEntries.length) {
    try {
      void Promise.resolve(enrichAll(newEntries, opts.signal)).catch((err) => {
        console.warn("auto-import: enrichment failed", err);
      });
    } catch (err) {
      console.warn("auto-import: enrichment failed", err);
    }
  }

  return { run: { ...run }, added, updated, skipped, errors };
}
