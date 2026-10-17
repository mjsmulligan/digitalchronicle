# Auto-import and review in the feed: Specification

**Status:** Draft v0.1, open questions in section 10 need answers before WP1
**Location:** `docs/specs/auto-import.md`
**Branching:** one feature branch per work package, e.g. `feat/auto-import-wp1`, merged by PR
**Platform focus:** mobile first. The engine changes live in `src/lib/journal/` and are shared, so web is affected (see section 8).

---

## 0. How to use this document (read first)

This spec follows the same working mode as `mobile-design.md`.

**At the start of a session**
1. Read this file, then `AGENTS.md`, then `BACKLOG.md`.
2. Find the first work package (WP) in section 9 with unchecked tasks. Work on that WP only.
3. Check section 10 (Open questions). If a question blocks the WP, stop and ask the user. Do not guess.

**While working**
- One WP at a time. Per WP: do the scope, run the checks in "Done when", tick the WP here, commit (code and spec tick together), then stop and report in a few lines.
- If a design decision changes, edit the relevant section and add a row to the Decision log (section 11).
- Checks before every commit: `bun run test` at the root if anything under `src/lib/journal/` changed; `npm run type-check` in `mobile/` if anything under `mobile/` changed. State what was checked by hand on a device or emulator.
- Commit message format: `auto-import: WP2 classify against hidden entries`.

**Writing rules for anything written into this repo or UI**
- No em dashes anywhere (code comments, UI copy, docs, commit messages). Use a colon, comma, parentheses or a hyphen.
- UI copy is sentence case, no exclamation marks.

**Hard constraints from AGENTS.md**
- Never delete or simplify anything under `src/lib/journal/connectors/`.
- `parsers.ts` stays dead. `staging.ts` imports from `./connectors/registry`.
- `rating` and `reflection` stay universal and never calendar-level. Source-locked ratings stay read-only.
- `vitest.config.ts` and `src/lib/journal/__tests__/` stay. All tests pass before committing engine changes.

---

## 1. Purpose

Chronicle is a passive journal: activity is imported and the journal assembles itself. Today every import stops at a gate. The file is parsed into a `StagingBatch`, the user flips a switch per row, then presses commit. That gate protects the journal from noise, but it makes the most common action (bring my data in) a chore, and it hides the new material in a separate screen instead of showing it where the journal lives.

**Change:** remove the gate. After parsing and the dedup check, every record that is not a duplicate is written straight to the journal and marked as **new**. The user reviews it in the main feed: new entries carry a visible indicator, and the user keeps, corrects or removes each one in place.

**Design intent in one line:** import is one tap, review happens in the feed, and nothing is ever lost or locked in by the automatic step.

### Goals
1. One-step import for every file and device source (no staging screen on the happy path).
2. New and changed entries are visibly marked in the feed until the user has looked at them.
3. Safe by default: a rejected entry does not come back on the next sync, and a whole import can be undone.
4. Re-importing the same data is a no-op.

### Non-goals (this spec)
- Redesigning source precedence (tiers). `classify()` keeps its current rules and stays one swappable function, because the tier model is due its own spec.
- Photo library place entries (`PlaceEntry`). They keep their pending/accepted/dismissed model and Staging Hub (see Q1).
- Contacts import. It creates People, not entries, and keeps its review panel.
- Direct API connectors and background sync. This spec makes them easier later, but does not build them.

---

## 2. Current behaviour (baseline, 17 Oct 2026)

Facts verified in code, so the next agent does not have to rediscover them.

**Pipeline**
- `stageFile(filename, text, forced?)` in `src/lib/journal/staging.ts`: loads the gazetteer, rejects unsupported formats, picks a connector, parses, then classifies every record against `allEntries(getState())` by `dedupeKey`. It writes one `StagingBatch` to the `staging` store.
- Classification (`classify`): `batch-duplicate` (same key earlier in the file), `new` (no match), `supersedes` (match with a higher tier number), `superseded` (match with a lower tier number), `duplicate` (same tier). A fuzzy rule turns a `new` leg with `from === "???"` into `duplicate` when any leg exists on the same date.
- Only `new` and `supersedes` start selected. The UI can only select those two.
- `commitBatch(b)`: writes selected records in chunks of 100 with `commitProgress` updates, then deletes the batch. `new` is written as is (with `sourceLocked`). `supersedes` keeps the old `id`, `tripId` and `overrides`, and goes through `mergeEvaluation` (source rating and review win, user reflection survives).

**Callers**
- Mobile: `mobile/app/sources.tsx` (file picker, device calendar, Goodreads sync), `mobile/app/import.tsx` (share intent, stages then redirects to Sources), `BatchReview.tsx` and `ReviewPanel.tsx` (switch per row).
- Web: `src/routes/import.tsx` (`stageFile`, `saveBatch`, `commitBatch`, sample loaders).
- Badge: `mobile/app/(tabs)/_layout.tsx` shows one dot on the sources icon for `staging.length` plus pending `PlaceEntry` rows.

**Things that matter for this change**
1. **Hidden entries do not block re-import.** `stageFile` builds its `existing` map from `allEntries`, which filters out `hidden` entries. Re-importing a file resurrects anything the user hid. With a manual gate this is an annoyance. With automatic import it would undo every rejection on every sync, so it must be fixed here (section 5.2).
2. **No import history exists.** Once a batch commits, nothing records which entries came from which import, so there is nothing to group, accept in bulk or undo.
3. **Row warnings are transient.** `StagedRecord.warnings` live only in the batch. Without a gate they need to be stored on the entry or they are lost.
4. **Enrichment runs at app start.** `enrichAll` (posters, covers) is called from `mobile/app/_layout.tsx` on boot. New entries would wait for the next launch unless the import triggers it.
5. **Database rule.** `db.ts` documents a migration rule (bump `DB_VERSION`, add an IDB upgrade, a boot migration, a `SQLiteAdapter` equivalent, and an idempotence test) for any change to stored record shapes. Adding a store is covered by it. Adding optional fields that default to "absent means reviewed" needs no backfill.

---

## 3. Principles

1. **Import never asks, review never blocks.** The automatic step makes no judgement calls beyond the existing tier rules.
2. **Absent means reviewed.** New flags are optional and are only ever set to a truthy value or removed, mirroring `hidden?: true`. Existing data needs no migration.
3. **The user's words and corrections are sovereign.** An automatic replacement (`supersedes`) keeps `id`, `tripId`, `overrides`, `reflection`, `participants` exactly as `commitBatch` does today.
4. **Rejection is remembered.** Anything the user removes stays recognisable to the classifier.
5. **Every automatic write is reversible.** Either the entry is still flagged and can be removed, or the run holds a snapshot to restore.
6. **Quiet UI.** Per the mobile design decisions: no inbox icon in the top bar and no "new pages added" banner at the top of the feed. The signal is a mark on the entry, a count on the existing dot, and a filter chip.

---

## 4. Data model

### 4.1 Fields on `Base` (all optional)

```ts
/**
 * Set by automatic import. Absent means the user has seen this entry.
 * "new"     was added by an import and has not been looked at.
 * "updated" an import replaced the source data of an entry that was already reviewed.
 * Never set to false: clear it by deleting the key (same convention as `hidden`).
 * Not to be confused with `review`, which is source-supplied text.
 */
unreviewed?: "new" | "updated";
/** Id of the ImportRun that last wrote this entry. */
importId?: string;
/** Short notes from import that the user may want to see (e.g. possible duplicate). Max 3. */
importNotes?: string[];
```

Flag rules when a later import touches an entry:
- Entry already `unreviewed: "new"` stays `"new"` (still unseen).
- Entry reviewed (flag absent) and superseded by a higher-precedence record becomes `"updated"`.
- A `duplicate`, `superseded` or `batch-duplicate` record writes nothing and changes no flag.

### 4.2 New store: `importRuns`

```ts
export interface ImportRun {
  id: string;
  source: Source;            // connector id
  filename: string;
  startedAt: string;         // ISO
  finishedAt?: string;       // absent while running or if interrupted
  status: "running" | "done" | "undone";
  added: number;
  updated: number;
  skipped: {
    duplicate: number;       // same or lower precedence than what exists
    inFile: number;          // repeated inside the same file
    removed: number;         // matches an entry the user hid
  };
  errors: string[];          // parse errors from the connector
  /** Prior versions of entries this run replaced, so undo can restore them. */
  replaced: { store: StoreName; before: Entry }[];
}
```

- Add `"importRuns"` to `STORES` and `JournalData`. It is part of the JSON backup.
- Added entries are found by `entry.importId === run.id`, so the run does not duplicate a long id list.
- `replaced` holds full prior records. Supersedes are rare (they need a higher-precedence source over an existing record), so the cost is small. Cap at 500 snapshots per run; beyond that, undo restores what it has and says so.
- Migration rule applies: bump `DB_VERSION` to 9, add the store in `IDBAdapter.onupgradeneeded`, add the table in `SQLiteAdapter`, test idempotence. The `staging` store stays for now (section 7).

### 4.3 Classification result

Extend `StageStatus` with one value and keep the rest:

```ts
type StageStatus = "new" | "duplicate" | "supersedes" | "superseded" | "batch-duplicate" | "removed";
```

`removed` means the `dedupeKey` matches a `hidden` entry. It is skipped and counted.

---

## 5. Engine behaviour

All of this goes in `src/lib/journal/` so mobile and web share it.

### 5.1 New entry point

```ts
// src/lib/journal/import.ts
export async function importFile(
  filename: string, text: string, forced?: string,
): Promise<ImportRun>;
```

Steps:
1. Same preamble as `stageFile`: load gazetteer, reject unsupported formats, pick the connector, parse.
2. Build the lookup map from **all** entries including hidden ones (5.2).
3. Classify each record with the existing `classify()` plus the `removed` rule, yielding to the UI every 200 records as today.
4. Write the `ImportRun` with `status: "running"` **before** any entry is written.
5. Write `new` and `supersedes` records in chunks of 100 with `commitProgress` updates (reuse the current progress mechanism). Set `unreviewed`, `importId`, `importNotes`. For `supersedes`, keep the existing merge behaviour and push the prior record into `run.replaced`.
6. Update the run with counts, `finishedAt`, `status: "done"`.
7. Kick off enrichment for the new entries (5.5).
8. Return the run. The caller shows the summary (6.1).

`stageFile`, `saveBatch` and `commitBatch` stay exported and unchanged until the web and cleanup phases (sections 8 and 9). Tests that call `stageFile` keep passing.

**Interruption.** The run record is written first, so a killed app leaves a `running` run with some entries already flagged. Re-running the same import finishes the job because the written records now classify as `duplicate`. On boot, any run still `running` is closed as `done` with counts recomputed from entries carrying its `importId`.

### 5.2 Classify against hidden entries

- Add `allHiddenEntries` to the lookup map in the import path (it already exists in `db.ts`).
- A record whose key matches a hidden entry gets `removed`, regardless of tier. It is never written and never flagged.
- The existing `stageFile` path gets the same fix in the same WP, since it is the same bug.
- Restoring a hidden entry from Settings clears its `hidden` flag and makes it a normal entry again. No flag is set (the user chose to restore it).

### 5.3 Suspected duplicate flights

Today a `???` leg with another leg on the same date is classified `duplicate`, so it is silently dropped. Under auto-import that loses a possibly real second flight. Proposed rule (see Q5): classify it `new`, write it flagged `"new"` with `importNotes: ["Possible duplicate of an existing flight on this date"]`, and let the user decide in the feed.

### 5.4 Clearing the flag (user-authored writes)

The flag clears when the user does any of the following to an entry: accepts it, edits a field (any `overrides` change), writes or edits a `reflection`, sets a `rating`, changes `participants`, attaches or detaches it from a trip, or restores it from hidden. One helper does it:

```ts
// db.ts
export async function markReviewed(store: StoreName, ids: string[]): Promise<void>;
export async function markRunReviewed(runId: string): Promise<number>;
```

WP4 lists every UI call site that writes user edits (entry edit screen, reflection editor, participant picker, trip attach) and routes it through one `saveUserEdit(entry)` that strips `unreviewed` and `importNotes` before `putMany`. Connector writes and imports never go through it.

### 5.5 Enrichment after import

After step 6, call `enrichAll` for the new entries only, with the existing abort signal pattern and the existing settings toggles. Failure is logged and never fails the import.

### 5.6 Undo an import

```ts
export async function undoRun(runId: string): Promise<{ removed: number; restored: number; kept: number }>;
```

- Entries with `importId === runId` and still `unreviewed: "new"` are deleted outright (not hidden: undoing a whole import should leave no trace, and a later re-import should bring them back).
- Entries the user has since reviewed or edited are kept, and counted in `kept`.
- Entries in `run.replaced` are restored to their prior version unless the user edited them after the import (detected by the flag being cleared and `overrides` or `reflection` differing from the snapshot); those are kept and counted.
- Run `status` becomes `"undone"`.

### 5.7 Entry removal semantics

- **Remove** on a flagged entry = `hideMany` (soft delete). This is what makes rejection stick (5.2). It appears under the existing Hidden entries screen in Settings and can be restored there.
- This differs from the earlier "delete stays a hard delete" decision and needs the user's confirmation (Q9).

---

## 6. UI (mobile first)

### 6.1 Import summary

After any import (file picker, share intent, device calendar, Goodreads sync) show one dialog, then stay where the user is:

> Import complete
> 14 new, 2 updated. 230 already in your journal, 1 you removed earlier were skipped.
> [Review new] [Done]

- `Review new` opens the Chronicle feed with the New filter on (6.3).
- If there were parse errors, add "3 rows could not be read" with a Details link listing `run.errors`.
- If nothing was added or updated, say so plainly: "Nothing new. Everything in this file is already in your journal."
- The share-intent screen (`mobile/app/import.tsx`) imports, then routes to the feed with the summary, instead of routing to Sources.

### 6.2 The indicator on entries

- `EntryRow` shows a small rust dot before the title and a mono label `NEW` (or `UPDATED`) at the trailing edge, in the same slot style as the kind label. Not colour alone: the text label is required for accessibility.
- `importNotes` render as a single line of secondary text under the subtitle (for example "Possible duplicate of an existing flight on this date").
- `DayGroup` and the Culture and Trips lists use the same component, so the mark appears everywhere an entry does. Series and trip rows show a mark if any child is unreviewed.
- `accessibilityLabel` includes "new" or "updated".

### 6.3 Reviewing in the feed

- **Entry page** (`mobile/app/entry/[id].tsx`): a slim bar at the top when flagged: `New from {source label}, {date}` with two actions, `Keep` (calls `markReviewed`) and `Remove` (calls `hideMany`, with the existing confirm dialog). Any edit also clears the flag (5.4).
- **Quick actions on the row**: long-press menu with `Keep` and `Remove`, matching the existing long-press pattern on trips.
- **Filter chip**: add `New` to the feed `FILTERS` (`F` type in `index.tsx`), with a count, shown only when the count is above zero. `matchesFilter` gets `unreviewed !== undefined`.
- **Bulk keep**: when the New filter is on, the list header offers `Keep all {n}`. A confirm dialog shows the count. Per import: Sources shows a Recent imports list (6.5) with `Keep all from this import`.
- **Order**: the feed stays chronological by event date. Imports of old history (a 2019 book, a 2022 flight) appear at their real dates, which is why the filter chip is the primary way to find them.

### 6.4 Signalling

- The dot on the sources icon is replaced by one rule: show the dot when `unreviewed` count is above zero, or pending place entries exist, or legacy staged batches exist. No count badge, no banner at the top of the feed, no inbox icon, per the earlier mobile decisions.
- The Chronicle tab itself does not get a badge.

### 6.5 Sources screen

- Remove the Pending review section from the happy path. Each source card becomes: choose or sync, then the summary dialog.
- Add a **Recent imports** section: source mark, filename, date, "14 new, 2 updated", with `Keep all` and `Undo import`. `Undo import` confirms with the counts it will remove and restore.
- A **Legacy pending imports** card appears only while old `StagingBatch` rows exist (section 7) and uses the current `BatchReview` unchanged.
- Progress uses the existing slim bar and `commitProgress`.

---

## 7. Migration and compatibility

- Existing entries: no change. Flag absent means reviewed.
- Existing `staging` batches (Q6): keep the store and the current `BatchReview` behind a Legacy pending card until the user clears it. A later cleanup WP removes the card and the store.
- Backup/restore: `importRuns` and the new `Base` fields are plain user data and travel in the JSON export. A restored journal keeps its flags.
- Old backups without `importRuns`: `emptyJournalData` and `replaceAll` already default missing stores to empty.
- `STORES` change follows the migration rule in `db.ts` (bump to 9, IDB upgrade, SQLite table, idempotence test).
- Trip suggestions (`suggestTrips`, in-window suggestions on trip detail) keep using `allEntries`, so flagged entries take part. This is intentional: a freshly imported flight can start a suggested trip.

---

## 8. Web impact

Web is not the focus, but the engine change touches it.

- Phase 1 engine work does not break web: `stageFile` and `commitBatch` stay.
- `src/routes/import.tsx` moves to `importFile` in its own WP after mobile ships (WP9): drop the staging queue, show the summary inline, keep the sample loaders.
- `EntryCard` gets the same New and Updated mark and Keep and Remove actions (WP10). Filter pills on `src/routes/index.tsx` gain `New`.
- Until WP9, web keeps staging and mobile imports automatically. Both write the same entry shapes, so the stores stay compatible.

---

## 9. Phases and work packages

Each WP is one commit unless it genuinely needs more. Do one at a time, then stop and report.

### Phase 1: engine (shared, no UI)

- [ ] **WP1: data model and run store.** Add `unreviewed`, `importId`, `importNotes` to `Base`. Add `ImportRun`, `"importRuns"` to `STORES` and `JournalData`, `emptyJournalData`. Bump `DB_VERSION` to 9 with the IDB upgrade, add the `SQLiteAdapter` table, add backup export/import coverage. *Done when:* idempotence test for the upgrade passes; backup round trip keeps `importRuns`; `bun run test` green; mobile type-check green.
- [ ] **WP2: classify against hidden entries.** Add `removed` status; build the lookup map from visible plus hidden entries; apply to `stageFile` as well. Extract `classify()` into its own exported function so the precedence redesign can swap it. *Done when:* tests prove a hidden entry is not resurrected by re-import (new test), existing characterization snapshots unchanged.
- [ ] **WP3: `importFile` orchestrator.** Implement section 5.1 including the run record first, chunked writes with `commitProgress`, flag rules from 4.1, `replaced` snapshots, boot-time closing of interrupted runs, and the suspected-duplicate rule (5.3). Fire enrichment (5.5). *Done when:* tests cover new, supersedes (flag becomes `updated`, `reflection` and `overrides` survive), duplicate re-import is a zero-change no-op, batch duplicate, removed, interrupted run recovery; `stageFile` tests still pass.
- [ ] **WP4: review helpers.** `markReviewed`, `markRunReviewed`, `undoRun`, and a single `saveUserEdit` used by every user-edit call site (list them in the Progress log). *Done when:* tests cover undo (new deleted, edited kept, replaced restored, edited-after-replace kept), flag cleared by edit, reflection and rating writes; no UI call site writes a user edit without going through the helper (grep result recorded).

### Phase 2: mobile UI

- [ ] **WP5: one-tap import and summary.** Switch `sources.tsx` (file, calendar, Goodreads) and `import.tsx` (share intent) to `importFile`. Add the summary dialog (6.1). Move `BatchReview` into the Legacy pending card. *Done when:* each of the four entry points imports without a review screen; summary text is correct for added, updated, skipped, errors and nothing-new; checked on a device with a real CSV, the calendar and Goodreads sync.
- [ ] **WP6: indicator and entry actions.** `EntryRow` mark and label, `importNotes` line, entry page bar with Keep and Remove, long-press menu, accessibility labels. *Done when:* verified in all three themes and at 1.3x font scale; Keep clears the flag; Remove hides and a re-import of the same file does not bring it back (manual check recorded).
- [ ] **WP7: New filter, bulk keep, signalling.** `New` chip with count, `Keep all` in the filtered header, dot rule from 6.4. *Done when:* chip hides at zero; `Keep all` confirm shows the right count; dot clears when nothing needs attention.
- [ ] **WP8: Recent imports and undo.** Sources section from 6.5 with `Keep all from this import` and `Undo import`. *Done when:* undo of a run with a mix of untouched, edited and replaced entries gives the counts in 5.6 and the right data afterwards.

### Phase 3: web

- [ ] **WP9: web import page on `importFile`.** Remove the staging queue from `src/routes/import.tsx`; keep sample loaders and drag and drop; show the summary inline.
- [ ] **WP10: web feed and cards.** Mark, Keep and Remove on `EntryCard`; `New` pill on `src/routes/index.tsx`.

### Phase 4: cleanup (after the user confirms nothing is pending)

- [ ] **WP11: remove legacy staging.** Delete `BatchReview`, `ReviewPanel` use for batches, `stageFile`, `saveBatch`, `commitBatch`, the `staging` store and its `STORES` entry (with a migration), and update `AGENTS.md`, `BACKLOG.md` and `docs/import-guide.md`. Keep `ReviewPanel` if the contacts and place cards still use it.

Later phases have goals but not yet detailed tasks. Propose the breakdown and wait for approval before starting a phase.

---

## 10. Open questions

Recommendations are mine. Anything marked BLOCKING stops its WP.

- **Q1 (BLOCKING WP5): do photo place entries stay out?** Recommend yes. A phone library produces thousands of day-level place entries, which is the case the pending/accepted/dismissed hierarchy exists for. Auto-adding them would flood the feed. They keep their Staging Hub and are untouched by this spec.
- **Q2: calendar noise.** The device calendar and `.ics` imports (tier 3) bring in lots of low-value events that the gate used to filter. Recommend shipping auto for every connector, relying on `Undo import`, Remove, and remembered removals. If it proves too noisy, add an optional `intake: "auto" | "staged"` on `Connector` so one source can keep a gate. Confirm no flag in v1.
- **Q3: what clears the flag.** Recommend any user-authored change including trip attach (5.4). Alternative: only Keep, Remove and edits to content, not trip links.
- **Q4: flag replaced entries as Updated?** Recommend yes, so an automatic replacement is never silent. Alternative: replace silently when the user has not touched the entry.
- **Q5: suspected duplicate flights.** Recommend import with a note (5.3) rather than skip. Alternative: keep skipping and count them in the summary.
- **Q6: staged batches at upgrade.** Is anything real sitting in staging on your devices? If not, drop the Legacy card and delete the store in WP5. If yes, keep the card until drained.
- **Q7: very large imports.** A 4,000 row Netflix history becomes 4,000 flagged entries. Recommend no threshold: `Keep all from this import` handles it in one tap. Alternative: auto-mark imports over N rows as reviewed.
- **Q8: banner at the top of the feed.** The earlier decision was no "new pages added" line and no inbox icon. This spec follows it (dot, filter chip, summary dialog). Say if you now want a banner.
- **Q9: Remove = hide, not hard delete.** The earlier decision said delete stays a hard delete and re-import may bring an entry back. With automatic import that would resurrect every rejection on each sync, so this spec uses the existing soft delete for Remove. Hard delete stays available from the Hidden entries screen if you want it.
- **Q10: precedence redesign.** The tier model is due its own spec. Auto-applying `supersedes` depends on it. This spec isolates `classify()` so the redesign can replace it, and marks replaced entries `updated` so changes of source data stay visible either way.
- **Q11: data safety net.** Is the app live? `db.ts` still carries the go-live migration rule. This spec treats the `importRuns` store as a normal migration. If dev data can still be reset, WP1 can skip the idempotence test for old versions.

---

## 11. Decision log

| # | Date | Decision | Why |
|---|------|----------|-----|
| D1 | 2026-10-17 | Replace stage-then-commit with auto-import plus review in the feed | Import is the core action; review belongs where the journal lives |
| D2 | 2026-10-17 | Only non-duplicates are written; duplicates, lower tier and in-file repeats are counted, not stored | Same outcomes the staging UI already made unselectable |
| D3 | 2026-10-17 | Flag is `unreviewed?: "new" \| "updated"`, absent means reviewed | No backfill; mirrors `hidden`; avoids clash with `review` text field |
| D4 | 2026-10-17 | Add `importRuns` store with replaced snapshots | Needed for undo, bulk keep and the summary |
| D5 | 2026-10-17 | Classification includes hidden entries (`removed`) | Rejection must survive re-import |
| D6 | 2026-10-17 | Keep `stageFile` and `commitBatch` until web moves and legacy batches drain | Avoid a big-bang change and keep tests green |
| D7 | 2026-10-17 | Photo place entries stay on their own staging model (proposed, Q1) | Volume and significance are personal |

---

## 12. Progress log

Newest first. One entry per session.

- **2026-10-17 (design session, no code):** Reviewed `staging.ts`, `db.ts`, `types.ts`, the connector contract, mobile Sources, share intent, BatchReview, the place staging hub and the feed. Found that hidden entries are not part of the dedup lookup (section 2, item 1). Wrote this spec. Next: answer Q1, Q2, Q6 and Q9, then WP1.
