# Auto-import and review in the feed: Specification

**Status:** Draft v0.5. Decisions from the review so far are folded in (section 12). The remaining open questions in section 11 are small and none of them blocks a work package.
**Location:** `docs/specs/auto-import.md`
**Branching:** one feature branch per work package, e.g. `feat/auto-import-wp1`, merged by PR
**Platform focus:** mobile first. The engine changes live in `src/lib/journal/` and are shared, so web is affected (see section 9).

---

## 0. How to use this document (read first)

This spec follows the same working mode as `mobile-design.md`.

**At the start of a session**
1. Read this file, then `AGENTS.md`, then `BACKLOG.md`.
2. Find the first work package (WP) in section 10 with unchecked tasks. Work on that WP only.
3. Check section 11 (Open questions). If a question blocks the WP, stop and ask the user. Do not guess.

**While working**
- One WP at a time. Per WP: do the scope, run the checks in "Done when", tick the WP here, commit (code and spec tick together), then stop and report in a few lines.
- If a design decision changes, edit the relevant section and add a row to the Decision log (section 12).
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
- AGENTS.md currently says "Imports go through staging batches". WP15 updates that line when staging is removed.

---

## 1. Purpose

Chronicle is a passive journal: activity is imported and the journal assembles itself. Today every import stops at a gate. The file is parsed into a `StagingBatch`, the user flips a switch per row, then presses commit. That gate protects the journal from noise, but it makes the most common action (bring my data in) a chore, and it hides the new material in a separate screen instead of showing it where the journal lives.

**Change:** remove the gate. After parsing and the dedup check, every record that is not a duplicate is written straight to the journal and marked as **new**. The user reviews it in the main feed: new entries carry a visible indicator, and the user keeps, corrects or hides each one in place.

**Going further for connected sources:** sources that need no file (Goodreads, device calendar, photo library) are checked silently on every app start once connected, so the journal keeps itself current with no user action at all. The photo library joins the same model: its day-level place entries are added to the feed as new entries instead of waiting in a Staging Hub, and the one-time cost of the first scan is accepted.

**Design intent in one line:** import is one tap or no tap, review happens in the feed, and nothing is ever lost or locked in by the automatic step.

### Goals
1. One-step import for every file and device source (no staging screen).
2. Connected sources, including the photo library, are checked silently on startup.
3. New and changed entries are visibly marked in the feed until the user has looked at them.
4. Safe by default: a hidden entry does not come back on the next sync, a whole import can be undone, and a bulk "mark all new as read" exists for when volume is high.
5. Re-importing the same data is a no-op.

### Non-goals (this spec)
- Redesigning source precedence (tiers). `classify()` keeps its current rules and stays one swappable function, because the tier model is due its own spec.
- Contacts import. It creates People, not entries, and keeps its review panel.
- Hard deletion of entries. Hide (soft delete) is the only removal (D5), including for photo place entries (D12).
- Background sync while the app is closed, push notifications, or direct API connectors beyond the three above.

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

**Connected sources today (all manual)**
- **Goodreads:** the user id is saved in `chronicle-prefs.json` (`goodreadsPrefs.ts`). `fetchGoodreadsShelfCsv` pages through the public RSS feed (up to 20 pages, stops when a page adds nothing new) and the result is staged.
- **Device calendar:** `readDeviceCalendar(pastDays, futureDays)` calls `requestCalendarPermissionsAsync` (this would show a permission prompt, so it is not safe to call at startup), reads all event calendars, skips recurring events and untitled events, and builds `.ics` text for the iCalendar connector. Nothing about the connection is persisted.
- **Photo library:** `useExifScan` runs the scan and `scanPrefs.ts` persists a scan marker (`lastScannedAt`, `scope`). `ScanScope` supports `all`, `date-range` and `albums`. `buildStagingPlan` (`sources/exif/stagingService.ts`) turns the built day-level entries into new `PlaceEntry` rows with status `pending`, skips entries that are already `pending` or `dismissed`, skips photos covered by a `PlaceBinMarker`, and only extends the photo evidence of `accepted` entries. The scan writes straight to `placeEntries` (it does not use the `staging` store).
- **Startup:** `mobile/app/_layout.tsx` boots the adapter, `initJournal`, artwork providers and `enrichAll` (fire and forget), then handles an initial share-intent URL.

**Things that matter for this change**
1. **Hidden entries do not block re-import.** `stageFile` builds its `existing` map from `allEntries`, which filters out `hidden` entries. Re-importing a file resurrects anything the user hid. With a manual gate this is an annoyance. With automatic and silent import it would undo every hide on every launch, so it must be fixed here (section 5.2).
2. **No import history exists.** Once a batch commits, nothing records which entries came from which import, so there is nothing to group, accept in bulk or undo.
3. **Row warnings are transient.** `StagedRecord.warnings` live only in the batch. Without a gate they need to be stored on the entry or they are lost.
4. **Enrichment runs at app start.** `enrichAll` (posters, covers) is called from `mobile/app/_layout.tsx` on boot. New entries would wait for the next launch unless the import triggers it.
5. **Database rule.** `db.ts` documents a migration rule (bump `DB_VERSION`, add an IDB upgrade, a boot migration, a `SQLiteAdapter` equivalent, and an idempotence test) for any change to stored record shapes. Adding a store is covered by it. Adding optional fields that default to "absent means reviewed" needs no backfill.
6. **Hide already has a home.** `hideMany` and `unhideMany` exist in `db.ts`, and Settings has a Hidden Entries screen (`mobile/app/hidden-entries.tsx`) with a count. Nothing new is needed to review and unhide.
7. **Photo place entries have a second lifecycle.** `allEntries` includes a `PlaceEntry` only when its status is `accepted`, so `pending` and `dismissed` entries are invisible to the feed. Dismissing is a separate removal path from hide, and `emptyBin` hard-deletes dismissed entries and keeps only a `PlaceBinMarker` (photo ids) so a rescan skips them. The scan writes directly to `placeEntries`, so it also has no run record. The user already has scan results on the device from the first implementation.

---

## 3. Principles

1. **Import never asks, review never blocks.** The automatic step makes no judgement calls beyond the existing tier rules.
2. **Absent means reviewed.** New flags are optional and are only ever set to a truthy value or removed, mirroring `hidden?: true`. Existing data needs no migration.
3. **The user's words and corrections are sovereign.** An automatic replacement (`supersedes`) keeps `id`, `tripId`, `overrides`, `reflection`, `participants` exactly as `commitBatch` does today.
4. **Hiding is remembered.** Anything the user hides stays recognisable to the classifier, so no source can bring it back. Unhiding is the only way back.
5. **Every automatic write is reversible.** Either the entry is still flagged and can be hidden, or the run holds a snapshot to restore.
6. **Silent means silent.** Automatic checks never show a dialog, toast or progress screen, never prompt for permissions, and never fail loudly.
7. **Quiet UI.** Per the mobile design decisions: no inbox icon in the top bar and no "new pages added" banner at the top of the feed. The signal is a mark on the entry, a dot on the existing sources icon, and a filter chip.

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
- A `duplicate`, `superseded`, `batch-duplicate` or `removed` record writes nothing and changes no flag.

Hiding an entry clears `unreviewed` and `importNotes` (the user has acted). Unhiding returns it as a normal reviewed entry.

### 4.2 New store: `importRuns`

```ts
export interface ImportRun {
  id: string;
  source: Source;            // connector id
  filename: string;
  /** "manual" for user-started imports, "startup" for silent checks of connected sources. */
  trigger: "manual" | "startup";
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

- A run is only persisted when it adds or updates at least one entry (5.1). A check that finds nothing leaves no trace.
- Add `"importRuns"` to `STORES` and `JournalData`. It is part of the JSON backup.
- Added entries are found by `entry.importId === run.id`, so the run does not duplicate a long id list.
- `replaced` holds full prior records. Supersedes are rare (they need a higher-precedence source over an existing record), so the cost is small. Cap at 500 snapshots per run; beyond that, undo restores what it has and says so.
- Migration rule applies: bump `DB_VERSION` to 9, add the store in `IDBAdapter.onupgradeneeded`, add the table in `SQLiteAdapter`, test idempotence. The `staging` store stays until WP15 because web still uses it.

### 4.3 Classification result

Extend `StageStatus` with one value and keep the rest:

```ts
type StageStatus = "new" | "duplicate" | "supersedes" | "superseded" | "batch-duplicate" | "removed";
```

`removed` means the `dedupeKey` matches a `hidden` entry. It is skipped and counted.

### 4.4 Photo place entries

- New `PlaceEntry` rows from a scan are written with `status: "accepted"` and `unreviewed: "new"`, with `importId` pointing at an `ImportRun` (`source: "photo-library"`, `filename: "Photo library scan"`). They appear in the feed like any other entry.
- `pending` and `dismissed` are no longer produced. Hiding a place entry uses the same `hidden` flag as every other entry (D12). `PlaceBinMarker` rows that already exist keep working: a rescan still skips photos covered by a marker. No new markers are created and `emptyBin` is retired (WP12c).
- Extending the photo evidence of an existing entry changes no flag.
- No per-place mute in v1 (D14). Revisit after real use of the photo source.
- Existing `pending` and `dismissed` rows are migrated at boot (section 8).

---

## 5. Engine behaviour

All of this goes in `src/lib/journal/` so mobile and web share it.

### 5.1 New entry point

```ts
// src/lib/journal/import.ts
export interface ImportResult {
  run?: ImportRun;           // absent when nothing was added or updated
  added: number; updated: number;
  skipped: ImportRun["skipped"];
  errors: string[];
}
export async function importFile(
  filename: string, text: string,
  opts?: { forced?: string; trigger?: "manual" | "startup" },
): Promise<ImportResult>;
```

Steps:
1. Same preamble as `stageFile`: load gazetteer, reject unsupported formats (an unsupported format throws on a manual import, and is swallowed and logged on a startup check), pick the connector, parse.
2. Build the lookup map from **all** entries including hidden ones (5.2).
3. Classify each record with the existing `classify()` plus the `removed` rule, yielding to the UI every 200 records as today. Nothing is written yet.
4. If there is nothing to add or update, return the counts with no `run`. No record is persisted.
5. Otherwise write the `ImportRun` with `status: "running"` **before** any entry is written.
6. Write `new` and `supersedes` records in chunks of 100. Set `unreviewed`, `importId`, `importNotes`. For `supersedes`, keep the existing merge behaviour and push the prior record into `run.replaced`. For `trigger: "manual"`, update `commitProgress` as today. For `trigger: "startup"`, do not set `commitProgress` (no progress UI).
7. Update the run with counts, `finishedAt`, `status: "done"`.
8. Kick off enrichment for the new entries (5.5).
9. Return the result. Manual callers show the summary (7.1). Startup callers show nothing.

`stageFile`, `saveBatch` and `commitBatch` stay exported and unchanged until WP15. Tests that call `stageFile` keep passing.

**Interruption.** The run record is written before the entries, so a killed app leaves a `running` run with some entries already flagged. Re-running the same import finishes the job because the written records now classify as `duplicate`. On boot, any run still `running` is closed as `done` with counts recomputed from entries carrying its `importId`.

**Single flight.** One import runs at a time. A shared lock (module-level promise chain) makes a startup check wait for a manual import and the reverse.

### 5.2 Classify against hidden entries

- Add `allHiddenEntries` to the lookup map in the import path (it already exists in `db.ts`).
- A record whose key matches a hidden entry gets `removed`, regardless of tier. It is never written and never flagged.
- The existing `stageFile` path gets the same fix in the same WP, since it is the same bug.
- Unhiding from Settings clears `hidden` and the entry is a normal reviewed entry again.

### 5.3 Suspected duplicate flights

Today a `???` leg with another leg on the same date is classified `duplicate`, so it is silently dropped. Under auto-import that loses a possibly real second flight. Proposed rule (see Q4): classify it `new`, write it flagged `"new"` with `importNotes: ["Possible duplicate of an existing flight on this date"]`, and let the user decide in the feed.

### 5.4 Clearing the flag (user-authored writes)

The flag clears when the user does any of the following to an entry: keeps it, hides it, edits a field (any `overrides` change), writes or edits a `reflection`, sets a `rating`, changes `participants`, or attaches or detaches it from a trip (Q2). Helpers in `db.ts`:

```ts
export async function markReviewed(store: StoreName, ids: string[]): Promise<void>;
export async function markRunReviewed(runId: string): Promise<number>;
export async function markAllReviewed(): Promise<number>;   // Settings: mark all new as read
```

WP4 lists every UI call site that writes a user edit (entry edit screen, reflection editor, participant picker, trip attach, hide) and routes it through one `saveUserEdit(entry)` that strips `unreviewed` and `importNotes` before `putMany`. Connector writes and imports never go through it.

`markAllReviewed` clears `unreviewed` and `importNotes` on every entry that has them, in chunks, and returns the count. It covers photo place entries too, since they carry the same flag.

### 5.5 Enrichment after import

After step 7, call `enrichAll` for the new entries only, with the existing abort signal pattern and the existing settings toggles. Failure is logged and never fails the import.

### 5.6 Undo an import (hide, never delete)

```ts
export async function undoRun(runId: string): Promise<{ hidden: number; restored: number; kept: number }>;
```

- Entries with `importId === runId` and still `unreviewed: "new"` are **hidden** (flag cleared). They appear in Settings > Hidden Entries and can be unhidden there. Because they are hidden, a later import of the same data skips them as `removed`, which matches the intent of "I did not want this import".
- Entries the user has since reviewed or edited are kept, and counted in `kept`.
- Entries in `run.replaced` are restored to their prior version unless the user edited them after the import (the flag cleared and `overrides` or `reflection` differ from the snapshot); those are kept and counted.
- Run `status` becomes `"undone"`.

### 5.7 Hide semantics

- **Hide** on a flagged or reviewed entry is `hideMany` (soft delete), the only removal in the app (D5). It appears in Settings > Hidden Entries and can be unhidden there.
- There is no hard delete of entries from any screen. `removeMany` on entry stores stays an engine-only operation (migrations that merge true duplicates).

---

## 6. Connected sources: silent check on startup

A source is **connected** once the user has set it up. From then on it is checked on every app start, silently, with no further action.

### 6.1 What "connected" means

| Source | Connected when | Persisted in `chronicle-prefs.json` |
|---|---|---|
| Goodreads | a user id is saved | `goodreadsUserId` (exists), `goodreadsLastCheckedAt` |
| Device calendar | the user pressed Connect in Sources, picked calendars, and permission is granted | `calendarConnected`, `calendarIds`, `calendarLastCheckedAt` |
| Photo library | a first scan has completed (marker exists) and permission is still granted | `photoLibraryScanMarker` (exists) |

Each connected source also has `autoCheck` (default true once connected). It is a switch on the source's card in Sources and a master switch in Settings: "Check connected sources on startup".

### 6.2 When it runs

- Once per app launch, after `initJournal` and the artwork init, and after the first screen has rendered (use `InteractionManager.runAfterInteractions`, never before the splash hides).
- Sources run one after another, never in parallel, through the single-flight lock (5.1).
- Per-source minimum interval of 6 hours (a constant), so a user who opens the app ten times a day does not trigger ten checks. A failed check does not advance `lastCheckedAt`.
- Only while the app is in the foreground. No background tasks in this spec.

### 6.3 What each source does

**Goodreads**
- Fetch page 1 of the public read-shelf RSS. If every book on the page is already in the journal (match on `goodreadsId`), stop. Otherwise continue to later pages until a page has no unknown books (cap 20), then pass the rows to the existing connector through `importFile(..., { trigger: "startup" })`.
- This means a normal launch costs one small request. The fetch helper gets a `knownIds` option for this (WP11).
- Known limit: a later change to a book already imported (a new rating) is not picked up, because the dedup key already matches. That is unchanged from today.

**Device calendar**
- Never prompts. The startup check uses `getCalendarPermissionsAsync`; if permission is not granted it does nothing and the source card shows "Permission needed".
- Reads only the calendars the user chose at Connect (`calendarIds`). The default selection at Connect excludes calendars that do not allow modifications (typically holidays, birthdays and subscribed calendars), to be confirmed on a device in WP11.
- Window: from `calendarLastCheckedAt` minus 7 days (overlap, dedup absorbs it) up to now. The first check after Connect uses the backfill range the user picked (default past year, as today).
- Only events that have already ended are imported by startup checks. The journal records what happened, so future and in-progress events wait for a later launch. Manual imports keep their current window.
- Recurring and untitled events stay excluded, as today.
- Known limit: renaming an event in the calendar after it was imported creates a second entry, because the title is part of the key. The first one stays as it is and the user can hide it.

**Photo library**
- Needs a new scan scope, `{ kind: "since"; timestamp: string }`, applied on top of the stored scope (albums or date range) so only photos added after `lastScannedAt` are read and geocoded (WP12b).
- Results are added to the feed. New day-level place entries are written as `accepted` and flagged `new` (4.4), the same as every other source, and recorded in an `ImportRun`. The user accepted the flooding risk for photos (D11): the first scan is a one-time cost, and after that each launch only adds the days since the last check.
- Cap of 500 new photos per startup check (a constant). The rest are picked up on the next launch. A manual scan is not capped.
- The scan marker advances only when a check completes.

### 6.4 Silence and errors

- No dialog, no toast, no progress bar for startup checks. `commitProgress` is not set.
- Results show up through the normal signals only: the dot on the sources icon, `New` marks in the feed, and the `New` chip count.
- Errors (offline, private Goodreads profile, revoked permission, unsupported format) are caught, logged with `console.warn`, and stored as `lastError` on the source. The source card shows "Last check failed" with a retry action. The next launch tries again.
- The source card shows "Checked automatically, last checked 2 hours ago". A manual pull on the card still works and shows the normal summary.

### 6.5 Volume

Silent checks and large files can add many entries at once (a first Goodreads connect, a 4,000 row Netflix history, a calendar backfill, the first photo library scan). There is no size threshold and no per-source gate (D3). The mitigations are:
- **Settings > Mark all new as read** (7.5): one action clears every flag.
- `Keep all` in the New filter, `Keep all from this import` and `Undo import` in Recent imports (7.3, 7.4).
- For photos, bulk hide by place, region or country in the Places screen (7.7), targets the usual noise source, the home place. A per-place mute is deferred until real use shows it is needed (D14).
- The flag never blocks anything: unreviewed entries are ordinary entries for search, trips, culture and enrichment.

### 6.6 Privacy

All reading is on-device. The only network call is the Goodreads RSS request, which exists today and sends the saved user id to Goodreads. Calendar and photo data never leave the phone. No new lookups are introduced.

---

## 7. UI (mobile first)

### 7.1 Import summary (manual imports only)

After a user-started import (file picker, share intent, Connect or Check now on a source card) show one dialog, then stay where the user is:

> Import complete
> 14 new, 2 updated. 230 already in your journal, 1 you hid earlier were skipped.
> [Review new] [Done]

- `Review new` opens the Chronicle feed with the New filter on (7.3).
- If there were parse errors, add "3 rows could not be read" with a Details link listing `errors`.
- If nothing was added or updated, say so plainly: "Nothing new. Everything in this file is already in your journal."
- The share-intent screen (`mobile/app/import.tsx`) imports, then routes to the feed with the summary, instead of routing to Sources.
- Startup checks never show this dialog (6.4).

### 7.2 The indicator on entries

- `EntryRow` shows a small rust dot before the title and a mono label `NEW` (or `UPDATED`) at the trailing edge, in the same slot style as the kind label. Not colour alone: the text label is required for accessibility.
- `importNotes` render as a single line of secondary text under the subtitle (for example "Possible duplicate of an existing flight on this date").
- `DayGroup` and the Culture and Trips lists use the same component, so the mark appears everywhere an entry does. Series and trip rows show a mark if any child is unreviewed.
- `accessibilityLabel` includes "new" or "updated".

### 7.3 Reviewing in the feed

- **Entry page** (`mobile/app/entry/[id].tsx`): a slim bar at the top when flagged: `New from {source label}, {date}` with two actions, `Keep` (calls `markReviewed`) and `Hide` (calls `hideMany`, with the existing confirm dialog). Any edit also clears the flag (5.4).
- **Quick actions on the row**: long-press menu with `Keep` and `Hide`, matching the existing long-press pattern on trips.
- **Filter chip**: add `New` to the feed `FILTERS` (`F` type in `index.tsx`), with a count (capped at "99+"), shown only when the count is above zero. `matchesFilter` gets `unreviewed !== undefined`.
- **Bulk keep**: when the New filter is on, the list header offers `Keep all {n}`. A confirm dialog shows the count.
- **Order**: the feed stays chronological by event date. Imports of old history (a 2019 book, a 2022 flight) appear at their real dates, which is why the filter chip is the primary way to find them.

### 7.4 Signalling

- The dot on the sources icon shows when the `unreviewed` count is above zero. Pending place entries no longer exist, so they no longer contribute. No count badge, no banner at the top of the feed, no inbox icon, per the earlier mobile decisions.
- The Chronicle tab itself does not get a badge.

### 7.5 Settings

- **Sources section** (existing): add the master switch "Check connected sources on startup", and a row "New entries" showing the count with the action `Mark all as read`. The action confirms with the count ("Mark 342 entries as read?") and calls `markAllReviewed`. It is disabled at zero.
- **Database section** (existing): Hidden Entries already shows the count and opens the review and unhide screen. No change needed beyond making sure entries hidden from the feed land there (they do, it is the same `hidden` flag).

### 7.6 Sources screen

- The Pending review section is removed. Each source card becomes: connect or choose, then the summary dialog (manual) or nothing (startup).
- Each connected card shows its status line, an auto-check switch, "Check now", and the last error if any.
- Add a **Recent imports** section: source mark, filename or "automatic", date, "14 new, 2 updated", with `Keep all from this import` and `Undo import`. `Undo import` confirms with the counts: "Hide 14 entries you have not reviewed and restore 2 that were replaced? Hidden entries can be restored in Settings." (5.6).
- Progress for manual imports uses the existing slim bar and `commitProgress`.
- There is no legacy pending card: no staged batches exist (D4).

### 7.7 Places screen (replaces the photo Staging Hub)

The screens under `mobile/app/staging/` become a Places screen for managing what photo scans have added. Triage is no longer a gate, so this is optional housekeeping.

- Same hierarchy as today (country, region, place), with entry counts and the unusual versus routine ordering from `stagingHints.ts`, which still helps decide what to hide.
- Actions replace accept and dismiss: `Hide all` for a place, region or country (calls `hideMany`, clears flags) and `Keep all` (calls `markReviewed`). Per entry: Keep and Hide, as in the feed.
- `Merge places` stays (spelling variants, `mergePlaces`).
- The bin is removed. Hidden place entries are reviewed and unhidden in Settings > Hidden Entries, like everything else. `emptyBin` and `resetDecisions` are retired; existing markers keep working.
- The entry point stays on the Sources photo card ("Manage places"). It has no count dot of its own.

---

## 8. Migration and compatibility

- Existing entries: no change. Flag absent means reviewed.
- No legacy staging data exists, so mobile drops `BatchReview` outright in WP5.
- Backup/restore: `importRuns` and the new `Base` fields are plain user data and travel in the JSON export. A restored journal keeps its flags.
- Old backups without `importRuns`: `emptyJournalData` and `replaceAll` already default missing stores to empty.
- `STORES` change follows the migration rule in `db.ts` (bump to 9, IDB upgrade, SQLite table, idempotence test).
- Trip suggestions (`suggestTrips`, in-window suggestions on trip detail) keep using `allEntries`, so flagged entries take part. This is intentional: a freshly imported flight can start a suggested trip.
- Prefs additions in `chronicle-prefs.json` are optional keys with defaults, so no migration.
- Photo place entries: a boot migration (idempotent, in `db.ts`, with a `SQLiteAdapter` path and a test) maps `pending` to `accepted` with `unreviewed: "new"`, and `dismissed` to `accepted` with `hidden: true`. Scan results already on the device then show up in the feed and earlier dismissals stay hidden (D13). Existing `PlaceBinMarker` rows are left alone.

---

## 9. Web impact

Web is not the focus, but the engine change touches it.

- Phase 1 engine work does not break web: `stageFile` and `commitBatch` stay.
- `src/routes/import.tsx` moves to `importFile` in its own WP after mobile ships (WP13): drop the staging queue, show the summary inline, keep the sample loaders.
- `EntryCard` gets the same New and Updated mark and Keep and Hide actions (WP14). Filter pills on `src/routes/index.tsx` gain `New`.
- Connected-source startup checks are mobile only. Web has no device calendar or photo library access and its Goodreads path is file based.
- Until WP13, web keeps staging and mobile imports automatically. Both write the same entry shapes, so the stores stay compatible.

---

## 10. Phases and work packages

Each WP is one commit unless it genuinely needs more. Do one at a time, then stop and report.

### Phase 1: engine (shared, no UI)

- [x] **WP1: data model and run store.** Add `unreviewed`, `importId`, `importNotes` to `Base`. Add `ImportRun` (with `trigger`), `"importRuns"` to `STORES` and `JournalData`, `emptyJournalData`. Bump `DB_VERSION` to 9 with the IDB upgrade, add the `SQLiteAdapter` table, add backup export/import coverage. *Done when:* idempotence test for the upgrade passes; backup round trip keeps `importRuns`; `bun run test` green; mobile type-check green.
- [x] **WP2: classify against hidden entries.** Add `removed` status; build the lookup map from visible plus hidden entries; apply to `stageFile` as well. Extract `classify()` into its own exported function so the precedence redesign can swap it. *Done when:* a new test proves a hidden entry is not resurrected by re-import; existing characterization snapshots unchanged.
- [x] **WP3: `importFile` orchestrator.** Implement section 5.1: classify first, no persisted run when nothing changes, run record before writes, chunked writes, flag rules from 4.1, `replaced` snapshots, `trigger`, single-flight lock, boot-time closing of interrupted runs, the suspected-duplicate rule (5.3), enrichment (5.5). *Done when:* tests cover new, supersedes (flag becomes `updated`, `reflection` and `overrides` survive), duplicate re-import is a zero-change no-op with no run row, batch duplicate, removed, interrupted run recovery, startup trigger sets no `commitProgress`; `stageFile` tests still pass.
- [x] **WP4: review helpers.** `markReviewed`, `markRunReviewed`, `markAllReviewed`, `undoRun` (hides, never deletes), and a single `saveUserEdit` used by every user-edit call site including hide (list them in the Progress log). *Done when:* tests cover undo (new hidden, edited kept, replaced restored, edited-after-replace kept), flag cleared by edit and by hide, `markAllReviewed` count and chunking; grep shows no UI call site writes a user edit without the helper (result recorded).

### Phase 2: mobile UI for manual import and review

- [x] **WP5: one-tap import and summary.** Switch `sources.tsx` (file, calendar, Goodreads) and `import.tsx` (share intent) to `importFile`. Add the summary dialog (7.1). Delete `BatchReview.tsx` and the Pending review section; keep `ReviewPanel` if the contacts or place cards still use it. *Done when:* each of the four entry points imports without a review screen; summary text is correct for added, updated, skipped, errors and nothing-new; checked on a device with a real CSV, the calendar and Goodreads sync.
- [x] **WP6: indicator and entry actions.** `EntryRow` mark and label, `importNotes` line, entry page bar with Keep and Hide, long-press menu, accessibility labels. *Done when:* verified in all three themes and at 1.3x font scale; Keep clears the flag; Hide moves the entry to Settings > Hidden Entries and a re-import of the same file does not bring it back (manual check recorded); Unhide returns it as a normal entry.
- [ ] **WP7: New filter, bulk keep, signalling.** `New` chip with count, `Keep all` in the filtered header, dot rule from 7.4. *Done when:* chip hides at zero; `Keep all` confirm shows the right count; dot clears when nothing needs attention.
- [ ] **WP8: Settings actions.** "New entries" row with `Mark all as read` and its confirm (7.5). *Done when:* the count matches the New chip; action clears every flag; disabled at zero; tested with 1,000+ flagged entries without freezing the UI.
- [ ] **WP9: Recent imports and undo.** Sources section from 7.6 with `Keep all from this import` and `Undo import`. *Done when:* undo of a run with a mix of untouched, edited and replaced entries gives the counts in 5.6 and the right data afterwards; hidden entries from an undo appear in Settings > Hidden Entries.

### Phase 3: connected sources, silent startup check

- [ ] **WP10: sync runner.** A `connectedSources` module in `mobile/src/lib/` with the source registry, prefs keys, 6 hour throttle, foreground-only guard, single-flight use, `lastError`, and the startup hook in `mobile/app/_layout.tsx` (after `runAfterInteractions`). Add the per-source auto-check switch and "Check now" and status line on cards, and the master switch in Settings. *Done when:* a fake source proves the runner is sequential, throttled, silent on success and failure, and does not advance `lastCheckedAt` on failure; no dialog or progress UI appears on startup.
- [ ] **WP11: Goodreads and calendar sources.** Goodreads: `knownIds` option on `fetchGoodreadsShelfCsv`, startup path through `importFile`. Calendar: persist Connect state and chosen calendars, calendar picker at Connect with the default exclusion rule, silent permission check (`getCalendarPermissionsAsync`), incremental window with 7 day overlap, ended events only. *Done when:* verified on a device: a normal launch makes one Goodreads request when nothing is new; a revoked calendar permission produces no prompt and shows "Permission needed"; a new calendar event appears flagged `new` after the next launch.
- [ ] **WP12a: photo entries join auto-import (engine and migration).** Change `buildStagingPlan` to create `accepted` entries flagged `new` with `importId`, write an `ImportRun` (`source: "photo-library"`) when entries are added, keep the marker rule and evidence extension. Add the boot migration for legacy `pending` and `dismissed` rows. Update `useExifScan` to write the run. *Done when:* `exif-v2.test.ts` is updated and green; tests cover a new entry flagged, a re-scan being a no-op with no run row, evidence extension changing no flag, marker skip, and the migration being idempotent on both adapter paths; `bun run test` green.
- [ ] **WP12b: photo startup check.** Add the `{ kind: "since" }` scope, register the photo source with the sync runner (WP10), apply the 500 photo cap, advance the marker on completion only, never prompt if permission is revoked. *Done when:* verified on a device: new photos since the last scan produce flagged entries on the next launch with no dialog; revoked permission shows "Permission needed" and no prompt.
- [ ] **WP12c: Places screen.** Rework `mobile/app/staging/*` into the Places screen (7.7): bulk Keep and Hide by place, region and country, per-entry actions, merge places; retire the bin, `emptyBin` and `resetDecisions`; remove pending place entries from the tab dot. *Done when:* hiding a place hides all its entries and they appear in Hidden Entries; unhide returns them; the dot reflects only `unreviewed`; checked in all three themes.

### Phase 4: web

- [ ] **WP13: web import page on `importFile`.** Remove the staging queue from `src/routes/import.tsx`; keep sample loaders and drag and drop; show the summary inline.
- [ ] **WP14: web feed and cards.** Mark, Keep and Hide on `EntryCard`; `New` pill on `src/routes/index.tsx`.

### Phase 5: cleanup (after WP13)

- [ ] **WP15: remove staging.** Delete `stageFile`, `saveBatch`, `commitBatch`, the `staging` store and its `STORES` entry (with a migration), and update `AGENTS.md` ("Imports go through staging batches"), `BACKLOG.md` and `docs/import-guide.md`.

Later phases have goals but not yet detailed tasks. Propose the breakdown and wait for approval before starting a phase.

---

## 11. Open questions

Recommendations are mine. Anything marked BLOCKING stops its WP.

- **Q1 (closed, deferred): mute a place?** Not in v1 (D14). The home place will add entries on most days, which is accepted for now. Revisit with real usage; the options then are an optional `Place.muted` switch or relying on bulk hide and Mark all as read.
- **Q2: what clears the flag.** Recommend any user-authored change including hide and trip attach (5.4). Alternative: trip links do not count.
- **Q3: flag replaced entries as Updated?** Recommend yes, so an automatic replacement is never silent. Alternative: replace silently when the user has not touched the entry.
- **Q4: suspected duplicate flights.** Recommend import with a note (5.3) rather than skip. Alternative: keep skipping and count them in the summary.
- **Q5: precedence redesign.** The tier model is due its own spec. Auto-applying `supersedes` depends on it. This spec isolates `classify()` so the redesign can replace it, and marks replaced entries `updated` so a change of source data stays visible either way.
- **Q6: is the app live?** `db.ts` still carries the go-live migration rule. This spec treats the `importRuns` store as a normal migration. If dev data can still be reset, WP1 can skip upgrade tests for old versions.
- **Q7: tunable defaults.** Startup interval 6 hours, photo cap 500 per launch, calendar overlap 7 days, default calendar selection excludes non-modifiable calendars. Confirm or adjust.
- **Q8 (closed): photo migration mapping.** Confirmed (D13): `pending` become flagged new and `dismissed` become hidden.

---

## 12. Decision log

| # | Date | Decision | Why |
|---|------|----------|-----|
| D1 | 2026-10-17 | Replace stage-then-commit with auto-import plus review in the feed | Import is the core action; review belongs where the journal lives |
| D2 | 2026-10-17 | Only non-duplicates are written; duplicates, lower tier and in-file repeats are counted, not stored | Same outcomes the staging UI already made unselectable |
| D3 | 2026-10-17 | No per-source gate and no size threshold. Flooding is accepted and mitigated by Settings "Mark all new as read", plus Keep all and Undo import | User decision. Applies to connected sources and large files alike |
| D4 | 2026-10-17 | No legacy staged data to migrate, so no legacy review card on mobile | User confirmed nothing is staged |
| D5 | 2026-10-17 | Hide (soft delete) is the only removal. Settings > Hidden Entries reviews and unhides. Undo import hides rather than deletes | User decision. Hidden entries are remembered by the classifier so rejections stick |
| D6 | 2026-10-17 | Connected sources (Goodreads, device calendar, photo library) are checked silently on every app start once connected | User decision. Journal keeps itself current with no action |
| D7 | 2026-10-17 | Flag is `unreviewed?: "new" \| "updated"`, absent means reviewed | No backfill; mirrors `hidden`; avoids clash with the `review` text field |
| D8 | 2026-10-17 | Add `importRuns` store with replaced snapshots, persisted only when a run changes something | Needed for undo, bulk keep and the summary; silent checks leave no clutter |
| D9 | 2026-10-17 | Classification includes hidden entries (`removed`) | Hiding must survive re-import and silent checks |
| D10 | 2026-10-17 | Keep `stageFile` and `commitBatch` until web moves (WP15) | Avoid a big-bang change and keep tests green |
| D11 | 2026-10-17 | Photo place entries are auto-added as accepted and flagged new, like every other source. Flooding risk accepted: a one-time cost at the first scan, then only the days since the last check | User decision. Replaces the earlier rule that each place entry waits for confirmation |
| D12 | 2026-10-17 | The photo bin and dismiss are replaced by hide. Existing `PlaceBinMarker` rows keep working, no new ones are created | Extends D5 to photos: one removal model |
| D13 | 2026-10-17 | Legacy `pending` and `dismissed` place entries are migrated at boot: pending become flagged new, dismissed become hidden | Scan results from the first implementation already exist on the device |
| D14 | 2026-10-17 | No per-place mute in v1. Revisit after real use of the photo source | User decision: gather real usage before adding a control. Bulk hide in the Places screen covers the home place meanwhile |

---

## 13. Progress log

Newest first. One entry per session.

- **2026-10-18 (WP6 complete: indicator and entry actions):** `EntryRow` reads `entry.unreviewed` and `entry.importNotes` directly from the entry object. When `unreviewed` is set: a 6dp rust dot (`colors.accent`) appears before the title text (dot + title in a flex row inside the body), the trailing mono label shows "NEW" or "UPDATED" in accent color instead of the kind label, and the first `importNote` (if any) renders as an italic muted line below the subtitle. `accessibilityLabel` includes "new" or "updated". `DayGroup` gains `onEntryLongPress?: (entry: Entry) => void` which is threaded to `EntryRow.onLongPress`. The Chronicle feed screen (`index.tsx`) adds a `handleEntryLongPress` handler: if the entry is unreviewed, shows a dialog with "Keep" (`markReviewed`) and "Hide" (`hideMany`) actions; does nothing for reviewed entries. `entry/[id].tsx` gains `handleKeep` (calls `markReviewed`) and a slim review bar rendered at the top of `contentCards` when `entry.unreviewed` is set: shows "New/Updated from {source}, {date}" with "Keep" and "Hide" buttons; the import date is looked up from `journal.importRuns` via the entry's `importId`. `markReviewed` added to the db import. Root suite: 409 passed, 2 todo (unchanged). Mobile type-check: 24 errors (same set). Nothing checked on a device yet. Next: WP7 (New filter, bulk keep, signalling).
- **2026-10-18 (WP5 complete: one-tap import and summary):** `sources.tsx` switches all three entry points (file picker, device calendar, Goodreads sync) from `stageFile` to `importFile`. A `showImportSummary(result)` helper formats the `ImportResult` into the dialog described in section 7.1: "X new, Y updated. Z already in your journal, W you hid earlier were skipped." with "Review new" (navigates to the Chronicle feed) and "Done" actions; if nothing was added or updated, a plain "Nothing new" alert shows instead. `import.tsx` (share intent) is rewritten: instead of staging and routing to Sources it calls `importFile`, then shows the result on-screen with the same summary text and "Review new" / "Done" buttons that both navigate to `/(tabs)`. The "Pending review" section (batch review cards) is removed from sources.tsx; `BatchReview.tsx` is deleted. `PlaceStagingCard` is kept inline in the "On device" section (conditional on pending count) until WP12c. `useDialog` gains a `show(config)` method and `DialogConfig` is exported. `@chronicle/journal/import` alias added to `babel.config.js` and `tsconfig.json`. Root suite: 409 passed, 2 todo (unchanged). Mobile type-check: 24 errors before and after, same set. Nothing checked on a device yet. Next: WP6 (indicator and entry actions).
- **2026-10-18 (WP4 complete: review helpers):** `db.ts` gains `saveUserEdit(entry | entries)`, `markReviewed(store, ids)`, `markRunReviewed(runId)`, `markAllReviewed()` and `undoRun(runId)`. `saveUserEdit` strips `unreviewed` and `importNotes` and keeps `importId` (provenance). The three `mark*` helpers share one chunked writer (100 per `putMany`, yielding between chunks) and return the number of entries cleared. Hide: `hideMany` now strips the flags itself, so every hide path clears them with no per-screen change; `unhideMany` returns a normal reviewed entry. `undoRun` hides entries the run added that are still `"new"`, restores `run.replaced` snapshots, keeps anything the user reviewed or edited, sets the run to `undone`, never deletes, and is a no-op the second time. Decisions: (1) an entry the run replaced is restored from its snapshot unless the user edited it since, judged against the snapshot: `overrides`, `reflection`, `participants`, `tripId`, or `rating` (not when source-locked) differ, or it was hidden; a plain Keep (flag cleared, nothing else changed) is not an edit and is restored, which is slightly wider than the spec's "overrides or reflection" because a supersede preserves those other fields; (2) an entry that was `"new"` from an earlier run and then replaced by this one is restored, not hidden. **Call sites routed through `saveUserEdit`** (Q2 taken as recommended, so trip attach and detach count): mobile `entry/[id].tsx` (merge, participants), `entry/edit/[id].tsx` (field edit, cross-kind replacement), `trip/[id].tsx` (remove from trip, add one, add all), `trip/confirm.tsx` (link on create); web `EntryCard.tsx` (save evaluation, overrides and participants; set trip), `routes/trips.tsx` (attach, remove from trip). Hide call sites already go through `hideMany`: mobile `entry/[id].tsx`, `entry/edit/[id].tsx`, web `EntryCard.tsx`. **Writes to entry stores deliberately left as plain `putMany`**: dissolving a trip (mobile `trip/[id].tsx`, web `routes/trips.tsx`) and deleting a person (mobile `person/[id].tsx`), because they change entries as a side effect the user has not looked at; `AddEntryDialog` (a new manual entry has no flag); `useExifScan` (the scan is an import, reworked in WP12a); `useStagingHub` (photo triage, replaced by Keep and Hide in WP12c, which must use these helpers). Grep recorded: `putMany(` against entry stores outside `src/lib/journal/` matches only those sites. Tests in `__tests__/review.test.ts` (15): flag cleared by `saveUserEdit` and by hide and `markReviewed`, `markRunReviewed` and `markAllReviewed` counts and chunking (100, 100, 50), and undo for new hidden, edited kept, replaced restored, edited-after-replace kept, hidden-after-replace stays hidden, a mixed run, a later import skipping what undo hid, and double undo. Mutation-checked: dropping the edit check, dropping the flag strip in `hideMany`, and changing the chunk size each fail tests. Root suite: 409 passed, 2 todo (was 394). Root `tsc` still has the same 13 baseline errors. `mobile` type-check: 24 errors before and after, same set (installed with `npm install --no-package-lock --legacy-peer-deps`). Nothing checked on a device. Next: WP5 (one-tap import and summary).
- **2026-10-18 (WP3 complete: `importFile` orchestrator):** New `src/lib/journal/import.ts` implements section 5.1. It parses, classifies everything against visible plus hidden entries with nothing written, and returns the counts with no run when nothing changes. Otherwise it writes the `ImportRun` (`running`) first, then writes `new` and `supersedes` records in chunks of 100, and closes the run as `done`. Flags follow 4.1: new records are `unreviewed: "new"`, a superseded entry that was already reviewed becomes `"updated"`, one still `"new"` stays `"new"`. A supersede keeps `id`, `tripId`, `overrides`, `participants` and (via `mergeEvaluation`) `reflection`, and pushes the prior record into `run.replaced` (cap 500). Snapshots are saved to the run before each chunk is written, so an interrupted run can still be undone. Skip counts: `duplicate` covers `duplicate` and `superseded`, `inFile` is `batch-duplicate`, `removed` is hidden matches. `manual` sets `commitProgress` (cleared in a `finally`); `startup` never does. An unsupported format throws on manual and is logged and returned as an error on startup. A single-flight promise chain serialises imports and survives a rejected one. `enrichAll` is fired for the added entries only, never awaited, and its failure is only logged. Boot recovery is `closeInterruptedRuns` in `db.ts`, called from `initJournal`: a `running` run becomes `done` with `added` and `updated` recomputed from entries carrying its `importId` and `replaced.length`. Decisions taken inside the WP scope: (1) the 5.3 rule is implemented as proposed (Q4): a `???` leg with a visible leg on the same date is imported flagged `new` with the note "Possible duplicate of an existing flight on this date", and the `stageFile` fuzzy rule is left as it was until WP15; (2) connector row warnings are kept as `importNotes` (max 3) because they would otherwise be lost (section 2, item 3); (3) Q3 is taken as yes (replaced entries become `updated`), as the WP's own done-when requires. New tests in `__tests__/import.test.ts` (25) cover new, chunking, run-before-entries ordering, zero-change re-import with no run row and no writes, in-file repeats, lower-precedence skips, removed, supersedes (flag, survivors, snapshot, still-new stays new, 500 cap), the 5.3 rule, trigger and `commitProgress`, unsupported formats, single flight, crash then re-import, boot recovery (and a second boot not touching runs), and enrichment. Mutation check: removing the lock fails the single-flight test. Root suite: 394 passed, 2 todo (was 369); `tsc` still has the same 13 baseline errors, none in the files touched. No mobile files changed, so no mobile type-check; nothing checked on a device. Open for WP4: `undoRun` needs `run.replaced` entries with `store`, which this WP provides, and `markRunReviewed` can find entries by `importId`. Next: WP4 (review helpers).
- **2026-10-18 (WP2 complete: classify against hidden entries):** `classify()` is extracted from `staging.ts` into `src/lib/journal/classify.ts`, exported, with the tier rules unchanged and a new `buildDedupeIndex(entries)` that builds the lookup. `StageStatus` gains `removed`: a record whose key matches a hidden entry is skipped whatever its tier, and `matchId` points at the hidden entry. `stageFile` now builds its lookup from `allEntries` plus `allHiddenEntries`, so re-importing a file no longer resurrects anything the user hid (the bug in section 2, item 1). If a visible and a hidden entry share a key (old data from before this fix), the visible one wins, so that import is classified against what the user can see. The fuzzy `???` flight rule is unchanged for now and only looks at visible legs; WP3 replaces it (5.3). UI consumers of `StageStatus` are updated: the web import page shows "hidden earlier" and now locks any record that is not `new` or `supersedes`, and mobile `BatchReview` shows the same label. Both screens are removed or reworked in later work packages. New tests in `__tests__/classify.test.ts` (16): the tier matrix, `removed` for every hidden and incoming tier pair, batch duplicates, index precedence, and four end-to-end tests through the real `stageFile`, `commitBatch`, `hideMany` and `unhideMany` (hide one of four imported legs, re-import, get 3 duplicate and 1 removed, commit writes nothing, unhide restores normal handling), plus the fuzzy rule with a visible versus a hidden same-day leg. I mutation-checked them: removing hidden entries from the lookup fails the two end-to-end tests, and removing the visible-only filter fails the fuzzy test. Root suite: 369 passed, 2 todo (was 353); no new type errors in root or `mobile`; characterization snapshots untouched. Useful for WP3 and WP4: the end-to-end tests use a small in-memory `StorageAdapter` with `setAdapter` and `initJournal`, which lets the real pipeline run in node (the old comment in `characterization.test.ts` saying `stageFile` cannot run in the test environment no longer applies); copy it rather than mocking `db.ts`. Note for the WP3 summary counts: when a file contains a hidden key twice, the first row is `removed` and the second is `batch-duplicate`, so the second counts as "repeated in file", not "hid earlier". Next: WP3 (`importFile` orchestrator).
- **2026-10-17 (WP1 complete: data model and run store):** Added `unreviewed`, `importId` and `importNotes` to `Base`, the `ImportRun` and `ImportSkipCounts` types, the `importRuns` store in `STORES` and `JournalData`, and bumped `DB_VERSION` to 9. The IndexedDB upgrade is now an exported pure function, `applyUpgrade(db, oldVersion)` in `db.ts`, so it can be tested without a browser. The SQLite table comes from the shared `storeTableSql(store)` in `storage.ts` (`CREATE TABLE IF NOT EXISTS`, driven by `STORES`), so `importRuns` is created on the next launch with no separate migration. The new `Base` fields are optional and absent means reviewed, so there is no boot backfill. Backup: the web route built its export from a hand-written list of stores, which is how a new store gets missed, so it now uses `toBackupData` and `fromBackupData` (new `src/lib/journal/backup.ts`), both driven by `STORES`. New tests in `__tests__/importRuns.test.ts` (15): upgrade idempotence, fresh install, legacy store removal, SQL helper, backup round trip including `replaced` snapshots and an older backup without `importRuns`, and the new fields surviving JSON and `view()`. Root suite: 353 passed, 2 todo (was 338). Gotchas for the next session: (1) `bun install --frozen-lockfile` and `npm ci` both fail on main because the root lockfiles are out of sync with `package.json` (`@lovable.dev/vite-tanstack-config` 2.24.0 locked, 2.25.3 required); install with `npm install --no-package-lock` and do not commit lockfile changes unless asked. In `mobile/` use `npm install --no-package-lock --legacy-peer-deps`. (2) Type-check was not clean before this WP: root `tsc` has 13 errors (StarRating, artworkProvider and three test files) and `mobile` has 24 (EntryRow, entry and trip screens, PhotoSourceEntry, mediaAccess); this WP adds none. The "type-check passes" rule in section 0 cannot be met literally until those are fixed, so the check used is "no new errors". (3) The web Backup page lists a tile per store, so `importRuns` now shows there with its count. Next: WP2 (classify against hidden entries).
- **2026-10-17 (design session, no code, update 4):** Deferred the per-place mute until there is real usage (D14, Q1 closed) and confirmed the photo migration mapping (D13, Q8 closed). WP12a no longer waits on a question. Next: WP1.
- **2026-10-17 (design session, no code, update 3):** Photo place entries now join auto-import: added as accepted and flagged new, bin and dismiss replaced by hide (D11, D12). Read `buildStagingPlan` and `useExifScan` to ground this: the scan currently creates `pending` entries invisible to the feed and writes straight to `placeEntries`. Split WP12 into 12a (engine and migration), 12b (startup check), 12c (Places screen). New open questions: Q1 (mute a place, to handle the home place) and Q8 (migration mapping). Next: answer Q1, then WP1.

- **2026-10-17 (design session, no code, update 2):** Folded in the first round of decisions: connected sources check silently on startup (new section 6), Settings "Mark all new as read" as the volume mitigation, no legacy staging data, hide as the only removal with Settings review and unhide (undo now hides). Added WP8 and WP10 to WP12, renumbered web and cleanup. Open: Q1 (photo check), Q2 to Q7. Next: answer Q1, then WP1.
- **2026-10-17 (design session, no code):** Reviewed `staging.ts`, `db.ts`, `types.ts`, the connector contract, mobile Sources, share intent, BatchReview, the place staging hub and the feed. Found that hidden entries are not part of the dedup lookup (section 2, item 1). Wrote the first draft of this spec.
