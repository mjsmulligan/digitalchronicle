# Sources page rework: Specification

**Status:** Draft v0.1. Layout decisions from the design session are folded in (section 12). Open questions in section 11 are small; only Q1 and Q2 touch a work package, and neither blocks WP1 to WP3.
**Location:** `docs/specs/sources-page.md`
**Branching:** one feature branch, `feat/sources-page`, for the whole feature. Commit and push after each work package, merge `main` into it now and then (never rebase pushed commits), and open a PR to `main` after WP3 (usable layout) and again after WP5. The branch must be in a working state at every commit.
**Platform focus:** mobile only (`mobile/app/sources.tsx`). No engine changes. The web import page is out of scope (section 1).
**Depends on:** `auto-import.md` (all WPs shipped). This spec reshapes the screen that spec left "messy and needing a future rework".

---

## 0. How to use this document (read first)

This spec follows the same working mode as `auto-import.md` and `mobile-design.md`.

**At the start of a session**
1. Read this file, then `AGENTS.md`, then `BACKLOG.md`.
2. Find the first work package (WP) in section 10 with unchecked tasks. Work on that WP only.
3. Check section 11 (Open questions). If a question blocks the WP, stop and ask the user. Do not guess.

**While working**
- One WP at a time. Per WP: do the scope, run the checks in "Done when", tick the WP here, commit (code and spec tick together), then stop and report in a few lines.
- If a design decision changes, edit the relevant section and add a row to the Decision log (section 12).
- Checks before every commit: `npm run type-check` in `mobile/` (the baseline has pre-existing errors, so the rule is "no new errors"); `bun run test` at the root if anything under `src/lib/journal/` changed. State what was checked by hand on a device or emulator.
- Commit message format: `sources-page: WP2 connect and manage sheets`. No Claude session link in commit messages or PR descriptions.

**Writing rules for anything written into this repo or UI**
- No em dashes anywhere (code comments, UI copy, docs, commit messages). Use a colon, comma, parentheses or a hyphen.
- UI copy is sentence case, no exclamation marks.
- Touch targets are at least 48dp. Text and state never rely on colour alone.

**Hard constraints from AGENTS.md**
- Never delete or simplify anything under `src/lib/journal/connectors/`.
- `parsers.ts` stays dead and `staging.ts` stays deleted.
- Do not rewrite pushed git history (the repo is connected to Lovable).
- All tests pass before committing engine changes. This spec should not need any.

---

## 1. Purpose

Import is now automatic: a file is one tap, and connected sources (photo library, device calendar, Goodreads) check themselves on every launch. The Sources screen has not caught up. It still reads as a list of equally weighted cards grouped by where data comes from (On device, Online, File import), but the sources now fall into two groups that **behave differently**:

- **Connected sources** are set up once, then run themselves. The user rarely visits them, and mostly wants to know "is it working?".
- **File imports** are run again and again by hand. The user visits to do something, and wants a short path from "I have a Netflix export" to "it is in my journal".

**Change:** reorganise the screen around that split. Connected sources become a short status list. File imports and new connections start from a grid of thumb-size tiles, one per supported source, so the supported sources are visible at a glance. Setup forms move into bottom sheets so cards stop expanding in place. Recent imports stay, but tighter, and gain a way to repeat a file import.

**Design intent in one line:** the page says what is running, lets you start something in one tap, and shows what just happened.

### Goals
1. A user can tell at a glance which sources are connected and whether each is healthy.
2. Every supported source is visible and one tap away, including Netflix, Letterboxd, Setlist.fm and Viaduct, plus a catch-all for other files.
3. One-time setup (connect) and repeatable import (pick a file) are visibly different actions.
4. Problems (expired permission, failed check) are shown on the row where they happen, with the fix one tap away.
5. No behaviour change in the import engine, the sync runner or the review model.

### Non-goals (this spec)
- Any change to `importFile`, `classify`, the sync runner (`connectedSources.ts`), `ImportRun`, or the review flags.
- New connectors. A new connector gets a tile by adding one entry to the tile registry (section 5.2).
- Remembering CSV column mappings per file shape. Deferred (Q3); the generic connector's current behaviour is unchanged.
- Web. `src/routes/import.tsx` already moved to `importFile` (auto-import WP13) and has its own layout.
- Moving phone contacts import. See Q1.
- Background sync, push notifications, direct API connectors.

---

## 2. Current behaviour (baseline, 19 Oct 2026)

Verified in code, so the next agent does not have to rediscover it.

**Screen structure.** `mobile/app/sources.tsx` is one 1,551 line file with the screen and five card components inline. Sections, in order:
1. **On device:** `PhotoSourceEntry` (its own file, 436 lines, owns the scan UI and scope picker), `CalendarSourceCard`, `ContactsSourceCard` (plus the inline `ContactsReviewPanel` when reviewing).
2. **Online:** `GoodreadsSourceCard`.
3. **File import:** `FileSourceCard`, one card that opens the document picker for "CSV, ICS, VCF".
4. **Recent imports:** one `RecentImportCard` per `ImportRun`, newest first, all of them, each with `Keep all` and `Undo import`.

**Card chrome.** All cards share `SourceCard` (36dp icon, title, status line, one action button). Connected and file cards therefore look the same although one is "set up once" and the other is "do it again".

**Inline forms.** The calendar picker (list of calendars with checkboxes) and the Goodreads username field expand inside their card and push everything below them down. The calendar card also carries a "Manual range" picker, an auto-check switch and a Disconnect link, so a connected card can hold four or five rows of controls.

**Status and errors.** Status is one muted line under the title ("Connected - last checked 12 Oct"). Errors are 11pt red text under the controls, truncated to two lines. A revoked calendar permission surfaces only as the text "Permission needed" thrown by the source's `check()`.

**Sources and connectors (registry).** File connectors in `CONNECTORS`: `setlistfm`, `viaduct`, `letterboxd`, `netflix`, `goodreads`, `icalendar`, `generic`, detected by sniffing. `importFile(filename, text, { forced })` accepts a connector id to skip detection. `UNSUPPORTED_FORMATS` rejects Flightradar24 exports (the message says to use a generic flight CSV) and contacts CSVs. Brand marks exist in `SOURCE_MARKS` for `netflix`, `letterboxd`, `goodreads` and `viaduct`, rendered by `SourceMark`; other sources have no mark.

**Connected sources.** Registered with `registerSource` in `_layout.tsx`: Goodreads, device calendar, photo library. `getSourceState(id)` returns `{ lastCheckedAt, lastError, autoCheck }`; `setSourceAutoCheck` and `runSourceNow` exist. Connection state lives in prefs: `goodreadsPrefs.ts` (user id), `calendarPrefs.ts` (`connected`, `calendarIds`), `scanPrefs.ts` (scan marker with `lastScannedAt` and `scope`). Photo Places management is reached from a link inside the photo card, shown only after the first scan.

**Run history.** `ImportRun` has `source`, `filename`, `trigger` (`manual` or `startup`), counts and `status`. Runs are only stored when something was added or updated, so a quiet startup check leaves nothing.

**Things that matter for this change**
1. **Files are not kept.** Import reads the picked file through `fetch(uri)` from the picker cache and stores no copy. A run knows the source and file name but cannot be replayed. "Re-import" must therefore mean "open the picker again with this connector chosen", not "run it again".
2. **Forced connector is already supported** (`importFile(..., { forced })`), so a Netflix tile can skip sniffing and give a clearer error if the file is the wrong shape.
3. **Contacts are not entries.** Phone contacts create People, not journal entries, and have their own review panel. `mobile-design.md` (Q2, closed) moved `Import contacts` into the People tab; the card on Sources has not been removed yet. See Q1.
4. **There is no bottom sheet dependency.** `mobile/package.json` has no `@gorhom/bottom-sheet`. `Dialog.tsx` and a few screens use React Native `Modal`. A sheet built on `Modal` avoids a new native dependency (Q2).
5. **Status vocabulary exists in the runner only as data.** There is no single function that turns `{ connected, permission, lastError, autoCheck, active }` into a state. WP1 adds one so rows, tiles and sheets agree.

---

## 3. Principles

1. **Separate by behaviour, not by origin.** "Set up once" and "do again" are different shapes of screen. On device versus online is an implementation detail.
2. **Rows manage, tiles start.** A row represents something that exists and is running. A tile represents something the user can begin.
3. **Status first, controls second.** A connected row shows state and one-line detail. Controls live one tap away in a sheet.
4. **Quiet unless something needs you.** Healthy rows are neutral. Only "Needs attention" is loud, and it carries its own fix (a Reconnect or Retry button on the row).
5. **Forms are sheets, not accordions.** Nothing on the page expands in place and pushes content down.
6. **Everything visible is a real source.** Tiles come from one registry, so adding a connector adds a tile with no layout work.
7. **Quiet UI, as in auto-import.** No banners, no top-of-feed notices, no new badge types. The existing dot on the sources icon still means "unreviewed entries exist".
8. **Reuse, do not rebuild.** Connect and scan logic stays where it is. The work is layout, state mapping and sheets.

---

## 4. Screen layout

Top to bottom, single scroll, header unchanged ("Sources").

### 4.1 Connected (rows)

Shown only when at least one source is connected. Section title `Connected` with a count at the trailing edge.

Each row, 72dp minimum: source mark or icon (40dp circle), name, one status line, state indicator, chevron. The whole row is one 48dp-plus target that opens the **manage sheet** (6.2).

**States** (one per source, computed by the helper in 5.3):

| State | Indicator | Status line example |
|---|---|---|
| `active` | filled dot and "Active" | `Checked 2 hours ago, 4,812 items` (calendar and Goodreads: `Checked yesterday`) |
| `checking` | small spinner and "Checking" | `Checking now` |
| `attention` | warning mark and "Needs attention" | `Calendar access has expired` |
| `paused` | hollow dot and "Paused" | `Automatic checks are off` |

- The indicator is always an icon plus a text label, never colour alone.
- An `attention` row adds an inline action strip under the status line with one button: `Reconnect` (permission or auth problem, opens the connect sheet in its permission step) or `Retry` (any other failure, calls `runSourceNow`). It is the only place on the page that uses the warning colour for a fill.
- Item counts are shown only when the source can give one cheaply (entries carrying that source). Otherwise the status line shows the last checked time alone.
- Rows are ordered: attention first, then by name.

### 4.2 Add a source (tile grid)

Section title `Add a source`. A grid of tiles, 3 per row on a phone, 4 per row at tablet width, gap 12dp.

**Tile:** minimum 104dp tall, full width of its column, rounded card. Contents centred: 44dp circular icon area (the brand mark from `SourceMark` where one exists, otherwise a line glyph), name (14sp, semibold), one caption line (12sp).

**Two kinds of tile**, distinguished by the caption and a small kind glyph, so they read differently without reading the section text:

| Kind | Sources | Caption | Tap does |
|---|---|---|---|
| Connect | Photos, Calendar, Goodreads | `Connect` (or `Connected` / `Needs attention` once set up) | Opens the connect sheet; once connected, opens the manage sheet |
| File | Netflix, Letterboxd, Setlist.fm, Viaduct (rail), Any file | `Import file` | Opens the document picker immediately with that connector forced (6.4) |

- **Connect** tiles show state through a corner badge: a tick when connected, an exclamation mark when attention is needed, with the matching caption. They stay in the grid so it is a stable, complete catalogue and nothing seems to disappear when connected (D3).
- **File** tiles carry no state. Tapping one is always "pick a file now".
- **Any file** is last, dashed outline, caption `Choose any file`. It covers generic CSV (including flight and rail lists not covered by a named connector), ICS and JSON, and auto-detects as today.
- Order: Connect tiles first (Photos, Calendar, Goodreads), then File tiles by likely frequency (Netflix, Letterboxd, Viaduct, Setlist.fm), then Any file. Frequency order is a constant, easy to change.
- A one-line help text under the grid: `A tick means set up once and checked automatically. Other tiles ask for a file each time.`

### 4.3 Recent imports (history)

Section title `Recent imports`, shown when any run exists.

- Shows the 5 most recent runs, newest first, with `Show all` revealing the rest in place.
- Each row: source mark or icon, file name or `Automatic` (trigger `startup`), date, summary (`14 new, 2 updated`), and a skipped note (`87 already in your journal`) when non-zero, using the counts already on `ImportRun.skipped`.
- Actions are unchanged in meaning (`Keep all`, `Undo import`) and move into a `...` overflow menu on the row so the list is quiet. Undone runs keep the `UNDONE` label and show no actions.
- Manual file runs add `Import again` to the menu: opens the picker with the same connector forced (6.4). It is not offered for startup runs or runs whose source has no file tile.

### 4.4 Empty states

- No connected sources: the Connected section is replaced by one line above the grid: `Nothing connected yet. Connect a source and it will check itself on every launch.` No empty card.
- No runs: the Recent imports section is omitted.

### 4.5 Phone contacts

Not a tile and not a connected source (it creates People, not entries). Until Q1 is answered, the existing `ContactsSourceCard` and review panel stay where they are, moved below Recent imports under the label `People`. No other change.

---

## 5. Structure and shared pieces

### 5.1 File layout

Split `sources.tsx` so the screen is composition only.

```
mobile/app/sources.tsx                      screen: loads state, composes sections
mobile/src/components/sources/
  ConnectedRow.tsx                          4.1 row
  SourceTile.tsx                            4.2 tile
  RecentImportRow.tsx                       4.3 row and overflow menu
  Sheet.tsx                                 bottom sheet wrapper (Q2)
  ConnectSheet.tsx                          6.1, one body per connect source
  ManageSheet.tsx                           6.2
mobile/src/lib/sourceRegistry.ts            tile registry (5.2) and state helper (5.3)
```

Existing logic moves with its component without behaviour change: the calendar picker and permission flow into the calendar connect body, the Goodreads username form into the Goodreads body, the photo scope picker and scan progress into the photo bodies.

### 5.2 Tile registry

One typed array, the single place that says what appears in the grid.

```ts
export type TileDef =
  | { id: string; kind: "connect"; label: string; markId?: string; glyph: GlyphName; connectedSourceId: "photo-library" | "icalendar" | "goodreads" }
  | { id: string; kind: "file"; label: string; markId?: string; glyph: GlyphName; connector?: string; caption: string };
```

- `markId` is a `SOURCE_MARKS` key (`netflix`, `letterboxd`, `goodreads`, `viaduct`). Where none exists the tile uses `glyph`, an Ionicons name, with the neutral icon colours from the theme.
- `connector` is the connector id passed as `forced`. It is absent for Any file, so detection runs as today.
- Adding a connector means adding one `file` entry here. The README in `connectors/` gains one line saying so (WP5).

### 5.3 State helper

```ts
export type SourceViewState = "active" | "checking" | "attention" | "paused";
export interface SourceView {
  state: SourceViewState;
  statusLine: string;
  needsReconnect: boolean;   // permission or credential problem, not a transient failure
}
export function deriveSourceView(input: {
  autoCheck: boolean; lastCheckedAt: string | null; lastError: string | null;
  active: boolean; now: Date; itemCount?: number;
}): SourceView;
```

Pure, no native imports, in `mobile/src/lib/sourceRegistry.ts`, unit-tested in Node from `src/lib/journal/__tests__/sourceRegistry.test.ts` (same arrangement as `connectedSources`). It takes no `id` or `connected` input: rows exist only for connected sources and the caller already knows the id. Rules: `active` flag wins (`checking`); a non-null `lastError` is `attention`, and `needsReconnect` is true when the error text is `Permission needed` or matches the existing permission and auth phrases; connected with `autoCheck` false is `paused`; otherwise `active`. Relative times use one formatter ("2 hours ago", "yesterday", "12 Oct"), shared with `PhotoSourceEntry`'s `fmtRelative`.

---

## 6. Sheets and flows

A bottom sheet built on `Modal` (Q2): scrim, rounded top corners, drag handle, max height 85 percent, content scrolls, back button and scrim tap dismiss. Safe-area aware. Reduced motion respected.

### 6.1 Connect sheet (one-time setup)

Opened from an unconnected Connect tile. Title is the source name; a short paragraph says what it will do and that nothing leaves the phone (Goodreads sends the username to Goodreads, as today).

- **Photos:** permission step, then scope choice (All time, Date range, Albums, as in `PhotoSourceEntry`), then `Scan` with the existing progress bar. On completion the sheet shows the summary (`1,204 places added`) with `Done`. The marker write that makes the source "connected" is done by the scan today and is unchanged.
- **Calendar:** permission step (the existing flow and its alerts), then the calendar checklist with the existing default exclusions, then `Connect`. First check starts after the sheet closes and shows the normal import summary.
- **Goodreads:** username field with the public-profile note, then `Save and sync`.

On success the sheet closes, the tile gains its tick, and a Connected row appears. On cancel nothing is persisted.

### 6.2 Manage sheet (for a connected source)

Opened from a Connected row or a connected Connect tile. Title is the source name; under it the status line and state indicator from 4.1. Controls, top to bottom:

1. `Check now` (primary button). Runs the same path as today and shows the usual import summary dialog.
2. `Check automatically on launch` switch (`setSourceAutoCheck`).
3. Source specific, only what exists today:
   - Photos: scope (read-only line with `Change`), `Manage places` (opens `/staging/places`), `Scan again` for a full rescan.
   - Calendar: calendars list with `Edit calendars` (reopens the checklist), manual range (Last year or All time).
   - Goodreads: username with `Change`.
4. `Last check` detail: time, and the last error in full (not truncated) when present.
5. `Disconnect` (destructive text button, confirm dialog). Disconnecting never removes entries already imported; the confirm says so.

### 6.3 Attention flow

An `attention` row shows its action inline (4.1). `Reconnect` opens the connect sheet at the permission step for calendar and photos, or the username step for Goodreads (private profile). `Retry` runs `runSourceNow` and shows `Checking` until done. A successful check clears `lastError` through the existing runner and the row returns to `active`.

### 6.4 File tile flow

Tap a File tile: open `DocumentPicker` immediately (same options as `pickFile` today), then call `importFile(filename, text, { forced: tile.connector })`, then show the existing summary dialog (`showImportSummary`). While the import runs the tile shows a spinner and the other tiles are disabled (the existing single active source rule). If the file does not match the forced connector the existing error is shown with the tile's source name: `That file does not look like a Netflix export. Try Any file if you are not sure.` (copy lives in the registry). `Import again` from Recent imports runs the same function with the run's source mapped back to a tile.

The share-intent path (`import.tsx`) and `?uri=` incoming links are unchanged and still auto-detect.

---

## 7. Accessibility and platform notes

- Every tile and row is a single accessible element with a label that includes state ("Calendar, needs attention, double tap to manage").
- State is conveyed by icon plus text. Warning colours meet 4.5:1 in all three themes (checked against the theme tokens, not hard-coded).
- Text scales: tile caption and name wrap to two lines at 1.3x font scale, and the grid drops to 2 columns when the width cannot fit 3 tiles at that scale.
- Sheets trap focus, announce their title on open, and return focus to the element that opened them.
- Android back closes a sheet before it leaves the screen.

---

## 8. Migration and compatibility

- No stored data changes. Prefs keys, `ImportRun`, entries and flags are untouched.
- The `/sources` route and its `uri` search param are unchanged, so the share intent, the tab header icon and the Settings links keep working.
- `PhotoSourceEntry` is split, not deleted: its scan hook usage, scope logic and progress bar move into the photo sheet bodies. `PhotoSourceEntry.tsx` is removed in WP4 once nothing imports it.
- `ContactsSourceCard` and `ContactsReviewPanel` are untouched (4.5).

---

## 9. Web impact

None. Web keeps its own import page. The tile registry is mobile only; if web later wants a similar grid, the registry can move to `src/lib/journal/` then (Q5).

---

## 10. Phases and work packages

Each WP is one commit unless it genuinely needs more. Do one at a time, then stop and report.

### Phase 1: foundations (no visible change)

- [x] **WP1: registry and state helper.** Add `sourceRegistry.ts` with the tile definitions (5.2) and `deriveSourceView` (5.3), plus unit tests. *Done when:* tests cover each state (checking, attention with and without reconnect, paused, active), relative time formatting, and the tile list order; `bun run test` green; mobile type-check shows no new errors.
- [ ] **WP2: sheet component** (code done, device check pending, so not ticked). Add `Sheet.tsx` on `Modal` (6) with scrim, handle, back handling, safe area, focus return, reduced motion. *Done when:* checked on a device in all three themes at 1.3x font scale: opens, scrolls long content, dismisses by scrim, back button and drag; a test screen or story is not required.

### Phase 2: new page, rows and tiles

- [ ] **WP3: layout split.** Split `sources.tsx` per 5.1 with no behaviour change, then replace the section layout with Connected rows (4.1), the tile grid (4.2), and Recent imports (4.3, 4.4). Connect tiles and rows temporarily open the existing inline cards inside a sheet so nothing is lost; File tiles run the 6.4 flow. Contacts moves under `People` (4.5). *Done when:* every action available before is still reachable; File tiles import with the forced connector and show the summary dialog; rows and tiles show correct state for each of: nothing connected, one healthy, one with attention; checked on a device.
- [ ] **WP4: connect and manage sheets.** Build `ConnectSheet` and `ManageSheet` per 6.1 to 6.3, move the calendar picker, Goodreads field and photo scope and scan UI into them, delete the inline expanding cards and `PhotoSourceEntry.tsx`. *Done when:* no card expands in place; connect then disconnect then reconnect works for all three sources; the attention strip appears for a revoked calendar permission and `Reconnect` recovers it; `Manage places` still opens the Places screen; checked on a device in all three themes.
- [ ] **WP5: recent imports and polish.** Overflow menu, `Show all`, skipped note, `Import again`; empty states; accessibility labels and 1.3x font scale grid fallback; one line added to `connectors/README.md` about tile registration. *Done when:* `Import again` opens the picker with the right connector and imports; Keep all and Undo import behave as before; screen reader pass recorded in the Progress log.

Later phases have goals but not yet detailed tasks. Propose the breakdown and wait for approval before starting a phase.

---

## 11. Open questions

Recommendations are mine. Anything marked BLOCKING stops its WP.

- **Q1: phone contacts on Sources.** `mobile-design.md` moved `Import contacts` into the People tab. The card still exists on Sources. Recommend removing it from Sources in a small follow-up once the People tab path is confirmed to cover both device and file import, and keeping it under `People` meanwhile (4.5). Does not block WP1 to WP3; blocks nothing but the tidy-up.
- **Q2: sheet implementation.** Recommend a `Modal` based `Sheet.tsx` (no new native dependency, works in Expo Go). Alternative: add `@gorhom/bottom-sheet`, which has better gestures but needs `react-native-reanimated` and gesture handler configuration. BLOCKING for WP2 only if the user prefers the library.
- **Q3: remember CSV mappings.** The idea was to remember column mappings per file shape so repeat generic imports are one tap. The generic connector's mapping behaviour needs a read before this can be specced. Recommend a separate small spec after WP5.
- **Q4: connected tile behaviour.** Recommend tapping a connected tile opens the manage sheet (same as its row). Alternative: connected tiles are inert and the row is the only way in. Recommend the former so a tile is never a dead end.
- **Q5: where the registry lives.** Mobile only for now (5.2). Move to `src/lib/journal/` if web wants the same grid.
- **Q6: how many recent imports.** Recommend 5 with `Show all` (4.3). Alternative: show everything as today. A busy week of startup checks could otherwise push the page long.
- **Q7: Flightradar24.** The registry rejects Flightradar24 exports, so flights go through Any file today. If Flightradar24 support is added later, it becomes a `file` tile (one registry entry). No action now.

---

## 12. Decision log

| # | Date | Decision | Why |
|---|------|----------|-----|
| D1 | 2026-10-19 | Reorganise Sources around two behaviours: Connected (set up once) and File import (repeatable), not around device versus online | The sources now behave differently; the old grouping hid that |
| D2 | 2026-10-19 | Add sources from a grid of thumb-size icon tiles, one per supported source, including Netflix, Letterboxd, Setlist.fm, Viaduct and an Any file catch-all | User decision. Supported sources become visible; Any file is last |
| D3 | 2026-10-19 | Connected Connect tiles stay in the grid with a tick or attention badge instead of disappearing | Keeps the grid a stable catalogue; nothing seems to vanish |
| D4 | 2026-10-19 | Connected sources get a status list above the grid; a row opens a manage sheet | Status first, controls one tap away |
| D5 | 2026-10-19 | Setup and manage forms live in bottom sheets, nothing expands in place | Avoids cards that grow to five rows and push content |
| D6 | 2026-10-19 | `Import again` means reopen the picker with the same connector, not replay a stored file | Files are not kept (section 2, item 1) |
| D7 | 2026-10-19 | Errors surface on the row with a Reconnect or Retry action | Fix is one tap from where the problem shows |
| D8 | 2026-10-19 | No engine, runner or data changes in this spec | Layout only; keeps risk low and tests untouched |
| D9 | 2026-10-19 | Contacts stay out of the grid and remain a separate People block until Q1 | Creates People, not entries |

---

## 13. Progress log

Newest first. One entry per session.

- **2026-10-19 (WP2 code written, device check pending):** Added `mobile/src/components/sources/Sheet.tsx`, a `Modal` based bottom sheet (Q2 taken as recommended, no new dependency). Props: `visible`, `title`, `onClose`, optional `returnFocusRef`, `children`. Behaviour: scrim and slide animation (timing, native driver), max height 85 percent of the window, scrolling content, dismiss by scrim, a 48dp close button, dragging the handle and header down (90dp or fast flick), and the Android back button (all call `onClose`; the parent owns `visible`). It stays mounted through the close animation, honours the system reduce motion setting (zero duration), announces its title on open, sets `accessibilityViewIsModal`, returns screen reader focus to `returnFocusRef` after closing, lifts above the keyboard on iOS (`KeyboardAvoidingView`; Android relies on the window resizing), and pads the bottom by the safe-area inset. Mobile type-check: 22 errors before and after, same set. **Not ticked:** the done-when needs a device check in all three themes at 1.3x font scale (open, scroll long content, dismiss by scrim, back button and drag), which has not been done. There is no test screen, so the first place to see the sheet is WP3 or WP4; check it there and tick WP2 then. Next: WP3.
- **2026-10-19 (branching change):** Switched from one branch per WP to a single `feat/sources-page` branch (the WP1 branch was renamed and the spec branch folded in). See the Branching line.
- **2026-10-19 (WP1 complete: registry and state helper):** Added `mobile/src/lib/sourceRegistry.ts` with `SOURCE_TILES` (8 tiles in the 4.2 order), `tileForConnector`, `tileForConnectedSource`, `fmtRelative` and `deriveSourceView`, and `src/lib/journal/__tests__/sourceRegistry.test.ts` (21 tests): tile order, unique ids, every forced connector exists in the registry, every `markId` exists in `SOURCE_MARKS`, relative time, and each state (checking wins over everything, attention with and without reconnect, paused, active with and without item counts). Decisions inside the WP: (1) `deriveSourceView` drops the `id` and `connected` fields from the draft in 5.3 (not needed, see 5.3); (2) the reconnect pattern matches what the sources actually throw: `Permission needed`, the Goodreads profile not found and `Is the profile public` messages, and HTTP 401, 403 and 404; (3) the status line for an error is the thrown message with its `Error:` prefix removed, since the helper does not know the source name (the row can prefix it); (4) relative times use "12 Oct" (day then month) from a week out, formatted by hand so output does not depend on device locale. `PhotoSourceEntry.fmtRelative` is left as is and goes with that file in WP4. Wrong-file copy lives on each file tile. Root suite: 497 passed, 2 todo. Mobile type-check: 22 errors before and after, same set (baseline). Nothing to check on a device (no UI). Install note: tests that import `mobile/` code need `npm install --no-package-lock --legacy-peer-deps` in `mobile/` first, or vite fails to load `expo/tsconfig.base`. Next: WP2 (sheet component).
- **2026-10-19 (design session, no code):** Reviewed `mobile/app/sources.tsx`, `PhotoSourceEntry.tsx`, `connectedSources.ts`, the connector registry and `auto-import.md`. Reviewed a layout mockup with the user (Connected rows, Add a source tile grid, Recent imports) and agreed it as the direction. Found that the app keeps no copy of imported files (so `Import again` reopens the picker), that Flightradar24 is unsupported (so no Flights tile), and that brand marks exist for Netflix, Letterboxd, Goodreads and Viaduct. Wrote this draft. Next: WP1.
