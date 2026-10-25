# Merge, dedup and source precedence: Specification

**Status:** Draft v0.1 (25 Oct 2026). Decisions 1 to 3 in section 9 are confirmed by the user. The rest are proposed and marked as such.
**Location:** `docs/specs/merge-dedup.md`
**Branching:** one feature branch, `feat/merge-dedup`, one commit per work package, merged to main at milestones (same working mode as `sources-page.md`).
**Platform focus:** shared engine in `src/lib/journal/`, mobile only for UI. Web gets no new work and will be dropped later (section 8).

---

## 0. How to use this document (read first)

**At the start of a session**
1. Read this file, then `AGENTS.md`, then `BACKLOG.md`.
2. Find the first work package (WP) in section 7 with unchecked tasks. Work on that WP only.
3. Check section 10 (Open questions). If a question blocks the WP, stop and ask the user. Do not guess.

**While working**
- One WP at a time. Per WP: do the scope, run the checks in "Done when", tick the WP here, commit (code and spec tick together), then stop and report in a few lines.
- If a design decision changes, edit the relevant section and add a row to the Decision log (section 9).
- Checks before every commit: `bun run test` at the root if anything under `src/lib/journal/` changed; `npm run type-check` in `mobile/` if anything under `mobile/` changed. State what was checked by hand on a device or emulator.
- Commit message format: `merge-dedup: WP1 remove tiers`. Do not add Claude session links to commit messages or PR descriptions.

**Writing rules for anything written into this repo or UI**
- No em dashes anywhere (code comments, UI copy, docs, commit messages). Use a colon, comma, parentheses or a hyphen.
- UI copy is sentence case, no exclamation marks.

**Hard constraints from AGENTS.md**
- Never delete or simplify files under `src/lib/journal/connectors/`. This spec edits them (removing the `tier` field), which is allowed. Keep every file and every test.
- `src/lib/journal/parsers.ts` is dead. Do not import from it and do not restore its use. Tier removal there is limited to keeping it compiling, or delete the `tier` reads if they block type-check.
- `src/lib/journal/staging.ts` stays deleted.
- `vitest.config.ts` and `src/lib/journal/__tests__/` stay, and `bun run test` must pass.

---

## 1. Purpose

Deduplication and merging in Chronicle grew organically and have three problems:

1. **Source precedence (tiers) has not been useful.** Tiers 2 and 3 are arbitrary, and a higher tier can silently win over richer data. The user wants it removed.
2. **Dedup only matches exact keys, and the keys are inconsistent.** The same film, flight or concert from two sources often fails to match, and manual entries never match anything.
3. **Merge is weak and split in two.** Import has one policy (`mergeEvaluation` plus the supersede branch), manual merge has another (`mergeEntries`), and the manual path loses data and provenance.

### Goals
- Remove tiers and the supersede/superseded model.
- One key module with one normaliser, and keys that match across sources.
- One merge policy used by import and by manual merge, with provenance kept.
- Detect likely duplicates that exact keys miss, and let the user resolve them. Never auto-merge on a guess.
- Manual merge is safe: same kind only, atomic, undoable.
- An auto-merge that was wrong can be split back into two events.

### Non-goals
- Automatic merging of near matches.
- Two-way sync with any source.
- Any web work (see section 8).
- Data migrations. The app is not live, so dev data can be reset and re-imported.

---

## 2. Current behaviour (baseline, 25 Oct 2026)

Findings from reading the code. Line numbers drift, search by name.

**Keys**
- `connectors/keys.ts` builds `leg`, `stay` and `event` keys with `toLowerCase()` only. `KIND_REGISTRY[kind].buildKey` in `kinds.ts` repeats the same logic, and uses `normalise()` (lowercase, spaces to hyphens) for event, film, episode and book.
- The Letterboxd connector has its own `filmKey` (lowercase and trim only), which differs from `KIND_REGISTRY.film.buildKey`.
- `AddEntryDialog.tsx` builds book and episode keys inline. Mobile `entry/edit/[id].tsx` gives new entries `${kind}|manual|${uid()}`, which can never match an import.
- Keys use the date only. Two same-route legs, or two same-artist events, on one day collapse into one (`batch-duplicate`, counted as `inFile`), and the second row is dropped without trace. This stays, but the second row will be merged and recorded instead of dropped (section 4.5).

**Classification** (`classify.ts`)
- Statuses: `batch-duplicate`, `new`, `removed`, `supersedes`, `superseded`, `duplicate`. The last three are decided by comparing `entry.tier` with `match.tier`.
- `buildDedupeIndex` keeps one entry per key. If duplicates already exist, the last one wins.

**Import** (`import.ts`)
- `new`: written, flagged `unreviewed: "new"`.
- `supersedes`: the incoming record replaces the old one, keeping `id`, `tripId`, `overrides`, `participants` and (via `mergeEvaluation`) the user's `reflection`. Flagged `updated`.
- `superseded` and `duplicate`: skipped and counted. Data from the second source is lost, and `additionalSources` is never populated by import.
- The only fuzzy rule: a leg with no `from` on a day that already has legs is imported with `POSSIBLE_DUPLICATE_NOTE`.

**Manual merge** (`merge.ts`, used only by `mobile/app/entry/[id].tsx`)
- Winner keeps its id and kind fields. Reflections concatenated, `review` and `rating` winner-first, overrides and participants unioned, `additionalSources` collected.
- The caller then forces `source: "manual"` and `tier: 1`, which discards the winner's original source and blocks any later source refresh. The winner is saved, then the loser is hidden, in two separate calls.
- The loser's review (when the winner has one) and its kind-specific fields (flight number, venue and so on) are dropped. There is no check that the two entries are the same kind. There is no record of the merge, so no undo.
- The `rating` comment in `merge.ts` describes a source-lock check that the code does not perform. `seriesId` is read through a cast.

**Other tier uses**
- `Tier = 1 | 2 | 3` and `Base.tier` in `types.ts`; `connector.tier` in `connectors/types.ts` and in every connector; the `tier` column in generic CSV (also in `samples.ts` and the import page text); `db.ts` duplicate clean-up picks the record with the lowest tier; mobile edit and merge set `tier: 1`; roughly 15 test files assert tiers.

---

## 3. Principles

- **A source never overwrites another source.** The first entry is the base. Later matches add information, they do not replace it.
- **The same source can correct itself.** Re-importing a source refreshes its own entries.
- **The user always wins.** Edits live in `overrides`, reflections and participants belong to the user. No flag such as `tier: 1` or `source: "manual"` is needed to protect them.
- **Provenance is never lost.** Every source that contributed stays visible on the entry.
- **A guess is never merged.** Near matches are flagged for the user to confirm.
- **One policy.** Import enrichment and manual merge use the same merge function.
- Keep it simple, and avoid one-way decisions (hidden entries stay recoverable).

---

## 4. Design

### 4.1 Remove tiers

- Delete `Tier`, `Base.tier`, `connector.tier`, and the `tier` assignment in every connector. Keep all connector files and tests (update the tier assertions).
- Generic CSV: ignore a `tier` column if present (no error). Remove it from `samples.ts`, the import page copy and `import-guide.md`.
- `db.ts` duplicate clean-up: replace "lowest tier" with "has reflection, then earlier `createdAt`" (the existing tie-breakers).
- Mobile edit and merge stop setting `tier` and `source`.
- Existing stored entries may still carry a `tier` property. It is ignored and dropped on the next write. No migration.

### 4.2 Classification

`classify()` stays one exported, swappable function. New statuses:

| Status | Meaning | Import action |
|---|---|---|
| `batch-duplicate` | same key seen earlier in this file | merge into the earlier planned entry (4.5), count as `inFile` |
| `new` | no match in the journal | write, flag `new` |
| `removed` | matches a hidden entry | skip, count as `removed` |
| `refresh` | match from the same source (`entry.source === match.source`) and the source fields changed | replace source fields (4.4), flag `updated` |
| `enrich` | match from a different source | fill gaps and add to `additionalSources` (4.4). Flag `updated` only if something changed |
| `duplicate` | match with nothing to change | skip, count as `duplicate` |

Change detection: compare the incoming entry with the match on source-derived fields only. Ignore `id`, `createdAt`, `sourceRef`, `importId`, `importNotes`, `unreviewed`, `overrides`, `reflection`, `participants`, `tripId`, `sourceLocked`. Re-importing an unchanged file must stay a zero-change no-op with no run row.

An entry created by the user (`source: "manual"`) counts as a different source from any connector, so an import that matches it is `enrich`.

### 4.3 Keys (one module)

- Extend `connectors/keys.ts` (it is load-bearing, keep the path) to be the only place keys are built. `KIND_REGISTRY[kind].buildKey`, every connector, `AddEntryDialog` and mobile edit call it. Delete the duplicated logic, not the file.
- One `normaliseText(s)`: Unicode NFKD, strip diacritics, lowercase, replace `&` with `and`, drop punctuation, collapse whitespace to a single hyphen. Used for every text part of every key.
- Keep the key shapes (`kind|date|...`). Dates remain the local date.
- Manual entries get a content key from the same builder, so a later import matches them.
- Same-day collisions (4.5): keep the date-only key for matching across sources.

### 4.4 Merge policy (`merge.ts`, one place)

Two exported functions, same module, same field rules.

**`refreshFromSource(old, incoming)`** (replaces the supersede branch in `import.ts`)
- Source-derived fields come from `incoming`.
- Kept from `old`: `id`, `tripId`, `seriesId`, `overrides`, `reflection`, `participants` (tag from incoming only if old has none), `additionalSources`, `mergedFrom`.
- Evaluation via the existing `mergeEvaluation` (source rating wins when the source supplies one, reflection never replaced).

**`mergeEntries(base, other)`** (import `enrich` and manual merge)
- `base` keeps its `id`, `source`, `sourceRef` and `kind`. Nothing is forced to `manual`.
- Fill gaps: any field empty on `base` (undefined, null, empty string or empty array) and present on `other` is copied, limited to the kind's `editableFields` plus `end`, `startTz`, `endTz`, `startUTC`, `endUTC`. Fields that differ and are not empty on both sides keep `base`'s value (conflicts are not stored).
- `reflection`: concatenated when both exist, de-duplicated if identical, separator as today.
- `review`: `base`'s wins. `other`'s review is dropped when both have one (decision 10). Two sources with different reviews of the same entry is a rare edge case.
- `rating`: `base`'s wins, else `other`'s, honouring `sourceLocked`. Fix the misleading comment.
- `overrides`: union, `base` wins on collision. `participants`: union. `tripId`, `seriesId`: `base` wins, else `other`'s.
- `additionalSources`: `base`'s existing, plus `other.source` and its own `additionalSources`, de-duplicated by source and `sourceRef`. The check compares against `base.source` only, and `source` is never overwritten.
- Remove the `as any` style cast for `seriesId`.

### 4.5 Same-day collisions

Two real entries can share a date-only key (two commutes on one route, two same-artist events). Decision: they are treated as one entry and merged, with both source references kept. No occurrence suffix.

- **Within one file:** a row whose key was already seen is not skipped. It is merged into the entry planned from the earlier row using `mergeEntries` (fill gaps only), and its `sourceRef` goes into `additionalSources`. It still counts as `inFile` in the import summary.
- **Across files or sources:** the normal `refresh` / `enrich` path, same result.
- **Same source twice:** `additionalSources` is de-duplicated by `source` plus `sourceRef`, not by `source` alone, so a second row from the same source is recorded.
- **Undoing a wrong auto-merge:** every auto-merge keeps what is needed to split it again (section 4.8), delivered in the last work package.

### 4.6 Near-match detection

A per-kind function `findNearMatches(entry, journal)` returns candidates with a reason. It looks only at entries on the same day (plus or minus one day for films, episodes and books, because a self-reported date can differ from an absolute timestamp). Exact-key matches never reach this stage.

| Kind | Near match when |
|---|---|
| leg | same day and mode, and (same flight number, or from/to equal after normalisation, or either side has a placeholder from/to) |
| stay | stay dates overlap, and place names share their significant tokens or the city matches |
| event | same day, and one normalised artist/title contains the other, or the venue matches |
| film, episode, book | normalised title equal (year equal when both have one), within one day |
| place-entry | none (exact only) |

On import a near match is written as `new`, with `possibleDuplicateOf: <id>` and a short `importNotes` entry. It is never merged automatically. The old `POSSIBLE_DUPLICATE_NOTE` rule is replaced by this.

The user can mark a pair as "not a duplicate". Store `notDuplicateOf: string[]` on the entry so it does not reappear.

### 4.7 Manual merge

- The picker offers only entries of the same kind as the current entry, same day plus or minus one (suggested ones from `possibleDuplicateOf` first).
- The merge is one atomic write: the merged base and the hidden loser go in together (single transaction on SQLite, one `putMany` batch on IndexedDB where possible, otherwise write the loser's hide first and roll back on failure).
- The base gets `mergedFrom: string[]` (loser ids). The hidden loser gets `mergedInto: { id, baseBefore }` where `baseBefore` is a snapshot of the base before the merge.
- Undo: restore the base from `baseBefore`, unhide the loser, clear `mergedInto`. Available from the merged entry and from Hidden Entries.
- The merged entry is saved through `saveUserEdit`, which clears the review flag. The base's `source`, `sourceRef` and `sourceLocked` are unchanged, so a later refresh from its own source still works.
- Re-import of the loser's source row stays `removed` because the loser remains hidden and keeps its key.

### 4.8 Splitting an auto-merge (last work package)

An auto-merge (same-file duplicate row, `enrich`) can be wrong. The user can split the entry back into two.

- **What is kept at merge time (WP3):** `absorbed: Array<{ source, sourceRef, entry }>` holds a snapshot of each incoming row folded into this entry (capped, oldest dropped after 5). `fieldSources: Record<string, string>` records, for every field filled from another row, the `sourceRef` it came from. This also gives per-field provenance.
- **Split action:** on the entry detail, each absorbed source has "Split into a separate entry". It creates a new entry from the snapshot (new id, flagged `new`), removes the row from `additionalSources` and `absorbed`, and clears every field on the original that `fieldSources` attributes to that row. Trip link, participants, overrides and reflection stay with the original.
- **Re-import must not re-merge a split row.** The split records a marker so classification routes that row to the new entry and never absorbs it again (mechanism in open question Q5).
- The two entries are marked `notDuplicateOf` each other so near-match detection (4.6) stays quiet.

---

## 5. Data model changes

On `Base` (all optional): `mergedFrom?: string[]`, `mergedInto?: { id: string; baseBefore: Entry }`, `possibleDuplicateOf?: string`, `notDuplicateOf?: string[]`, `absorbed?: Array<{ source: string; sourceRef?: string; entry: Entry }>`, `fieldSources?: Record<string, string>`, `separateRows?: string[]` (hashes of rows the user split apart). Removed: `tier`. Add the new fields to `backup` export and import and to the SQLite adapter's JSON column handling (check whether `tier` is a real column there and drop it).

---

## 6. Tests

- Keep the characterization snapshots stable except where tiers appear. Review each snapshot diff by hand.
- Rewrite `review.test.ts` (tier-3 copies) and the connector tier assertions.
- New: key module table tests (accents, punctuation, `&`, case, whitespace, cross-source film and concert matches), classify statuses, refresh change detection (unchanged re-import is a no-op), enrich fills gaps and never overwrites, merge function property tests (idempotent, base fields never lost, provenance kept), near-match table tests per kind, manual merge atomicity and undo.
- Add a test factory (`makeEntry(kind, overrides)`) so fixtures stop using `as unknown as Entry`.

---

## 7. Phases and work packages

Each WP is one commit unless it genuinely needs more. Do one at a time, then stop and report.

### Phase 1: tiers and classification

- [ ] **WP1: remove tiers.** Section 4.1 and 4.2. `classify()` returns `new`, `removed`, `batch-duplicate`, `refresh`, `enrich`, `duplicate`. Until WP3, `enrich` is treated as `duplicate` (skip) so behaviour is safe in between. Mobile edit and merge stop setting `tier` and `source`. Update connector tests, `review.test.ts`, `db.ts` clean-up, `samples.ts`, import page copy. *Done when:* no `tier` reference remains in `src/` or `mobile/` except a comment explaining the ignored legacy CSV column; unchanged re-import is a zero-change no-op (test); same-source changed row becomes `updated` with reflection, overrides and participants kept (test); `bun run test` and mobile type-check green.

### Phase 2: keys

- [ ] **WP2: one key module.** Section 4.3 and 4.5. `normaliseText`, a single builder per kind in `connectors/keys.ts`, `KIND_REGISTRY` and all connectors and entry-creation call sites use it, manual entries get content keys. Fix the Letterboxd `filmKey` divergence. No occurrence suffix: same-key rows are merged (4.5, delivered in WP3). *Done when:* table tests for each kind pass, including a Letterboxd and Netflix pair and a calendar and setlist.fm pair producing equal keys where intended; grep shows no key built outside the module; characterization snapshots reviewed and updated.

### Phase 3: merge

- [ ] **WP3: unified merge and enrich on import.** Section 4.4. Extract `refreshFromSource` from `import.ts`, rewrite `mergeEntries` per the policy, populate `additionalSources` on `enrich`, make `enrich` real. Same-file duplicate rows merge into the earlier row (4.5) instead of being skipped. Record `absorbed` snapshots and `fieldSources` on every auto-merge (4.8). Fix the rating comment and the `seriesId` cast. *Done when:* tests cover fill-gaps-only, conflicts keep base, provenance kept, idempotence, an import of a second source adding `additionalSources` and flagging `updated` only when something changed, two same-key rows in one file producing one entry with two source references, and `absorbed` and `fieldSources` being written; `evaluation-dm5` tests still pass.
- [ ] **WP4: manual merge rework (mobile).** Section 4.7 and section 5 fields. Same-kind picker, atomic write, `mergedFrom`, `mergedInto` with snapshot, undo, no forced `source` or `tier`. *Done when:* tests cover atomic failure (nothing half applied), undo restores both entries exactly, a later refresh from the base's own source still works; checked on a device.

### Phase 4: near matches

- [ ] **WP5: near-match engine and import flagging.** Section 4.6, `possibleDuplicateOf`, `notDuplicateOf`, replace `POSSIBLE_DUPLICATE_NOTE`. *Done when:* per-kind table tests pass; import writes a near match as `new` with the link and note; an exact-key match never reaches the near-match stage; a dismissed pair does not come back.
- [ ] **WP6: possible duplicates in the feed (mobile).** A way to see entries with `possibleDuplicateOf`, with Merge and "Not a duplicate" actions that reuse WP4. Surface through the existing review flag and entry detail, not a new tab. *Done when:* checked on a device with a seeded pair; merge from here and dismiss both work.

### Phase 5: cleanup

- [ ] **WP7: docs and cleanup.** Update `AGENTS.md` (replace the tier line), `connectors/README.md`, `import-guide.md`, `auto-import.md` (precedence notes and Q5), `BACKLOG.md`. Remove dead code left by WP1 to WP6. *Done when:* docs describe source-vs-source behaviour in section 4.2 terms; a final grep for `tier`, `superseded` and `supersedes` is clean.

### Phase 6: undoing auto-merges

- [ ] **WP8: split a merged entry.** Section 4.8. A "Split into a separate entry" action per absorbed source on the entry detail (mobile). Creates the new entry from the `absorbed` snapshot, clears the fields attributed to that row via `fieldSources`, updates `additionalSources`, sets `notDuplicateOf` both ways, and stops a re-import of that row from merging again (Q5). Depends on WP3 and WP4. *Done when:* tests cover a split after a same-file merge and after a cross-source enrich (original restored to its pre-merge fields, new entry matches the snapshot, trip link, participants, overrides and reflection stay on the original), re-importing the same file does not re-merge the split row, and splitting the last absorbed row leaves no empty `absorbed`; checked on a device.

### Phase 7: calendar kind inference (independent of Phases 3 to 6 after WP2)

Calendar items often describe something that is not an event. Stays first, films later (decision 13). Can be done at any point after WP2, because matching a calendar stay with a Booking.com stay needs the shared normaliser (accents: "Hôtel" must equal "Hotel").

- [ ] **WP9: calendar stay detection.** In `connectors/icalendar/index.ts`, add a second booking layout beside `parseHotelBooking` (keep that one). Real example from the user (anonymise it before it goes in a fixture: this repo is public, so no booking codes, emails or real names): a timed event (for example Mon 22:59 to Wed 11:00, not all-day) whose SUMMARY is the hotel name, LOCATION is a street address with postcode, city and country, and whose DESCRIPTION is:
  - line 1: hotel name; line 2: address;
  - a parenthesised range `(YYYY.MM.DD HH:MM - YYYY.MM.DD HH:MM)`, for example `(2026.10.12 00:00 - 2026.10.14 00:00)`;
  - `Booked for: <name>` and `Booking code: <code>`.
  Rules: (a) a DESCRIPTION with that range plus at least one of `Booked for:` or `Booking code:` is a stay, even though the event is timed and the existing multi-day all-day rule does not fire. (b) Stay `start` and `end` come from the date part of the description range, not from DTSTART and DTEND (the calendar times are an artefact, here 22:59 and 11:00). Nights are the difference between those dates. (c) `place` is the first description line, falling back to SUMMARY. (d) City comes from the address and must skip the postcode (the example gives Paris, not 75008). (e) No broader guessing: a timed multi-day item without a booking layout stays an event, because conferences look the same. Check what the attendee list produces too: in the example the user appears twice (organiser and a second guest with the same name), and he should not become a companion of his own stay. *Done when:* the anonymised fixture imports as one stay with the right dates, nights, place and city, no companions; a stay from another source with the same accent-stripped name and dates matches it (`enrich`, not a second stay); existing hotel-booking and multi-day all-day tests unchanged; a conference-style multi-day timed event is still an event.
- [ ] **WP10: convert kind and cross-kind near match.** For entries already imported with the wrong kind. Near-match (4.6) gains event vs stay on overlapping dates with a normalised title and place match. A `convertKind` action (event to stay, keeping `raw`, `source`, `sourceRef`, trip link, participants, overrides and reflection) on the entry detail, after which the normal same-kind merge applies. `mergeEntries` itself stays same-kind only. Depends on WP4 and WP5. *Done when:* tests cover the conversion keeping all user data, a converted entry merging with a Booking.com stay, and a refused cross-kind merge; checked on a device.
- Films from the calendar (and any other kind inference) are deferred and need a design decision first (Q4).

---

## 8. Web impact

Web is not a focus and will be dropped completely at a later point. This spec adds no web UI and no web-specific work. The shared engine changes still affect web imports (tier removal, enrich), so while web exists keep it compiling and `bun run test` green. The only web edit is the minimal copy fix for the removed `tier` column in `src/routes/import.tsx` (WP1). Do not spend effort on web behaviour beyond that.

---

## 9. Decision log

| # | Date | Decision | Status |
|---|---|---|---|
| 1 | 25 Oct 2026 | Remove source tiers entirely. They have not been useful. | Confirmed |
| 2 | 25 Oct 2026 | Different source matching an existing entry: the first entry stays as base, the new row fills empty fields only and is added to `additionalSources`. | Confirmed |
| 3 | 25 Oct 2026 | Same source re-imported: the entry refreshes from the source. User edits live in `overrides`, so `tier: 1` and forcing `source: "manual"` are no longer needed. | Confirmed |
| 4 | 25 Oct 2026 | Near matches are flagged, never auto-merged. | Proposed |
| 5 | 25 Oct 2026 | Manual merge is same kind only, atomic and undoable, with the pre-merge snapshot stored on the hidden loser. | Proposed |
| 6 | 25 Oct 2026 | Keep `connectors/keys.ts` as the single key module (load-bearing path), delete duplicated logic only. | Proposed |
| 7 | 25 Oct 2026 | No data migration: the app is not live, dev data is reset and re-imported. | Proposed |
| 8 | 25 Oct 2026 | Same-day same-key rows (same file or different sources) are merged into one entry with both source references. No occurrence suffix. | Confirmed |
| 9 | 25 Oct 2026 | A final work package adds splitting a merged entry back into two events when the auto-merge was wrong. Auto-merges therefore record `absorbed` snapshots and per-field provenance (`fieldSources`). | Confirmed (WP) / Proposed (mechanism) |
| 10 | 25 Oct 2026 | When two sources both have a review, keep the first and drop the other. | Confirmed |
| 12 | 25 Oct 2026 | Keep a split row split with a hash stored on both entries (`separateRows`), checked before the key lookup. | Confirmed |
| 13 | 25 Oct 2026 | Calendar items that are really stays should be recognised as stays. Calendar movies are deferred until the user has thought about them. Merge stays same-kind only. | Confirmed (stays, deferral) / Proposed (approach) |
| 11 | 25 Oct 2026 | No web work in this spec. Web support will be dropped later. | Confirmed |

---

## 10. Open questions

- **Q1: resolved.** Same-day collisions are merged with both source references (decision 8).
- **Q5: resolved.** Use a hash (decision 12). On a split, store a hash of the split row's key fields plus `raw` as `separateRows` on both entries. `classify()` checks it before the key lookup, so that row routes to the new entry and is never absorbed again.
- **Q2: resolved.** Keep the first review, drop the other (decision 10).
- **Q3: resolved.** No web work. Web support will be dropped completely later (decision 11).
- **Q4: calendar stays that arrive as events.** There is a real case (user, 25 Oct 2026): calendar items that are really stays are often imported as events. Cause in `connectors/icalendar/index.ts`: an item only becomes a stay if its DESCRIPTION has the hotel-booking layout, or it is all-day and spans 2 or more days. Anything else (a one-night or timed item such as a hotel or Airbnb name) falls through to `JEvent`. A stay from another source then never matches it, because keys start with `stay|` and `event|`. Proposed approach: (1) widen stay detection in the iCal connector, the way `detectTransport` does for legs, with fixtures; (2) near-match across kinds for event vs stay (4.6); (3) keep `mergeEntries` same-kind only, and add a separate `convertKind` action (event to stay, keeping `raw`) so a mis-kinded entry can be converted and then merged normally. The same pattern applies to films: the user has also seen movies listed as calendar activities, so they arrive as events and never match a Letterboxd or Netflix film (same cause, different kind). Treat this as one problem, calendar kind inference, and cover stay and film together. Open: should a calendar movie item become a film entry, merge into the matching Letterboxd or Netflix film, or stay an event (the outing) alongside the film (the watch)? Stay example received (25 Oct 2026), see WP9 for the rules drawn from it. Films are deferred: the user wants to think about them first.

---

## 11. Progress log

- 25 Oct 2026: Q1 answered (merge same-key rows with both source references) and WP8 (split a merged entry) added. Section 4.5 rewritten, 4.8 added.
- 25 Oct 2026: spec drafted from a read of `classify.ts`, `import.ts`, `merge.ts`, `evaluation.ts`, `kinds.ts`, `connectors/keys.ts` and the mobile entry screen. No code changed yet.
