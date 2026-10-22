# Chronicle Monorepo — General Quality Code Review
*2026-10-21*

---

## 1. Summary

The codebase is in genuinely good shape. The data model is well-designed and deliberately evolving; the shared journal library has a coherent separation between types, connectors, and storage; the mobile screens are well-structured with idiomatic React/RN patterns. The serial-queue pattern for SQLite is a clean solution to a real concurrency problem. The documentation comments (especially on `Base` fields and the evaluation rules) are excellent.

The issues below fall into a few clusters: one confirmed logic bug (Goodreads sniff), one layout-shift bug on the entry detail screen, a handful of `any`-typed props in the edit screen, fragile relative import paths in the EXIF pipeline, and a few pieces of accumulated technical debt (duplicate functions, dead variables, no mobile-side tests). Nothing is critical for production safety.

---

## 2. Type system & data model

**`AnyOverrides` union is cast away at usage sites.** In `kinds.ts` (lines 38–39, 61–62, 107–108), the `overrides` field is cast to `Record<string, unknown>` for key-checking in every `hasPlace` function. This defeats the typed override union introduced in DM8. A helper like `overrideHas(e: Entry, key: string): boolean` that does the cast once would centralise the ugliness.

**`mergeEntries` uses `(entry as any).seriesId`** (`merge.ts`, line 38). The comment acknowledges this. It can be replaced with `"seriesId" in winner ? winner.seriesId : undefined` — no `any` needed.

**`rating` merge comment misleads.** `merge.ts` line 20 says "if rating was source-locked and loser has a user rating, use loser's", but the code is just `winner.rating ?? loser.rating`. The source-lock check described in the comment doesn't actually run. The result is correct (winner wins) but the comment should be updated to match reality.

**`Purpose` type and `Base.purpose` are live but unused.** The `Purpose` type and `purpose?: Purpose` on `Base` are not used by any screen or connector. Add a `@deprecated` JSDoc or remove to avoid confusion.

**`Base.companions` has no `@deprecated` tag.** `companions?: string[]` is the old field that DM9 will consolidate into `participants`. Adding `@deprecated` now prevents new code accidentally using it.

**`JEvent.people?: string[]`** appears to be a legacy field separate from `Base.participants`. If it's truly dead, add `@deprecated`; if it's still written by any connector, it needs a migration path.

**`uid()` randomness is low.** `Math.random().toString(36).slice(2, 10)` gives ~40 bits of browser-quality pseudorandom. `crypto.randomUUID()` is available in Expo SDK 45+ / RN 0.73+ and gives 122 bits. With thousands of journal entries and potential future sync/backup merge, the collision risk grows.

---

## 3. Business logic — connectors, evaluation

**Goodreads `sniff()` has a confirmed case bug.** `connectors/goodreads/index.ts` line 161: `head.includes("Book Id")`. The `detectConnector()` function passes `text.slice(0, 400).toLowerCase()` as `head`. The string `"Book Id"` will never match a lowercased string. The file-name heuristic still catches files named `goodreads_library_export.csv`, so detection works in the common case — but any Goodreads file with a non-standard name falls back to generic. Fix: change `"Book Id"` → `"book id"`.

**`letterboxd.filmKey()` diverges from `KIND_REGISTRY.film.buildKey()`.** The letterboxd connector normalises with `title.toLowerCase().trim()`, but the registry's `buildKey` uses `normalise()` which also replaces spaces with hyphens. `"the bear"` vs `"the-bear"`. This means the `dedupeKey` written at import time and the key `buildKey` would compute from the same entry differ. If any code path rebuilds a key from an existing entry (e.g., for staging/dedup of a re-import), it will miss.

**`ImportRun.updated` is always `0` for photo scans.** Both `photoSource.ts` (line 170) and `useExifScan.ts` (line 168) always write `updated: 0`, even when `plan.updatedEntries.length > 0`. The Recent Imports screen and future undo logic will under-report photo evidence updates. Fix: `updated: plan.updatedEntries.length`.

**`photoSource.ts` and `useExifScan.ts` use fragile relative imports.** Both files import from `../../../../src/lib/journal/sources/exif/...` instead of the `@chronicle/journal/*` path aliases used everywhere else in the mobile app. Replace with the alias.

---

## 4. Mobile / React Native patterns

**`heroIsPortrait` is computed before `entry` is defined** (`entry/[id].tsx`, lines 425–428). The `entry` useMemo is defined well below the `useState(heroIsPortrait ? 2/3 : 1)` call, so `entry` is `undefined` at that point, `heroIsPortrait` is always `false` on mount, and `heroImgRatio` always initialises to `1`. The useEffect then corrects it on the next render — causing a visible layout shift on every film/book/episode detail open. Fix: move the `entry` useMemo above the `heroIsPortrait` line, or initialise `heroImgRatio` unconditionally to `2/3` and let the `onLoad` callback update it.

**`sourceLabel()` is duplicated in `entry/[id].tsx`** (lines 100–111). A hardcoded label map mirrors the shared registry. These will drift as connectors are added. Use the shared `sourceLabel(id)` from `connectors/registry.ts` directly.

**`DetailStyles` fields typed as `object`** (`entry/[id].tsx`, lines 116–126). Use `StyleProp<ViewStyle>` and `StyleProp<TextStyle>` for the respective fields.

**Form sub-component props are all `any`** (`edit/[id].tsx`, lines 99–103 and throughout). `styles: any`, `colors: any`, `fonts: any`, `spacing: any`, `radius: any` appear in every form component. Extract a shared `FormProps` interface using `ReturnType<typeof createStyles>` for `styles` and the existing theme types for the rest. This is the biggest type-safety gap in the mobile app.

**`targetStore` is a dead variable** (`edit/[id].tsx`, line 808). `const targetStore = storeFor(newEntry)` is assigned but never used. Remove it.

**`MenuRow` is defined inside the render function** (`sources.tsx`, lines 1086–1110). Works due to hoisting but is surprising and makes the file hard to navigate. Move to a top-level component.

**Suppressed exhaustive-deps warning in `sources.tsx`** (line 685). If the intent is "run once per mount", document it clearly. If `incomingUri` can change, the deps are actually wrong.

---

## 5. Storage layer

**`removeMany` deletes one-by-one** (`SQLiteAdapter.ts`, lines 102–110). Each ID gets its own `DELETE ... WHERE id = ?`. For bulk operations, a single `DELETE FROM "${store}" WHERE id IN (?,?,...)` would be substantially faster.

**`replaceAll` doesn't use prepared statements** (lines 113–128). The `putMany` path uses a prepared statement for performance, but `replaceAll` re-compiles `INSERT INTO ... VALUES (?, ?)` for every row. For a full backup restore with thousands of entries, this is the slow path. The prepared-statement pattern from `putMany` should be applied here too.

---

## 6. Testing

**No mobile-side unit tests visible.** The shared library has solid coverage for `merge`, `evaluation`, `backup`, and connectors. But `connectedSources.ts` was explicitly designed to be testable (injected storage, overridable registry) and has no tests. `SQLiteAdapter` and the EXIF pipeline (`buildStagingPlan`, `buildPlaceEntries`) appear testable but untested.

**Test fixtures use `as unknown as Entry` casts** (evaluation-dm5.test.ts, backup.test.ts). Minimal test objects bypass required `Base` fields. A test factory (`makeFilm(overrides?: Partial<Film>): Film`) would catch future additions to required fields and reduce boilerplate.

**`backup.test.ts` line 20** uses `(parsed.data as unknown as Record<string, unknown>)[store]`. Since `StoreName` is a keyof `JournalData`, `parsed.data[store]` works directly — the double cast is unnecessary.

---

## 7. Minor / polish

**`SHEET_CLOSE_DELAY_MS` should be a named constant.** `setTimeout(fn, 280)` appears at `sources.tsx` lines 447, 785, 829, and 1047. Extract to a constant at the top of the file.

**Unused `day` import in `entry/[id].tsx`.** A local variable `day` (line 92 in `fmt()`) shadows the `day` import from `@chronicle/journal/types` (line 21), which is imported but never used. Remove the unused import.

**`PlaceDetail` component references `PlaceEvent`** (`entry/[id].tsx`, line 273). `PlaceEvent` is not in the current `Entry` union. This component handles the legacy `"place"` kind that no longer appears. It's probably unreachable from the feed but still compiles, creating a false sense that the old kind is supported. Add a comment marking it as legacy or remove it.

---

## 8. Recommended priority actions

| Priority | Finding | Location | Fix |
|----------|---------|----------|-----|
| 1 | **Goodreads sniff case bug** | `connectors/goodreads/index.ts:161` | Change `"Book Id"` → `"book id"` |
| 2 | **`heroIsPortrait` layout shift** | `mobile/app/entry/[id].tsx` | Move `entry` useMemo before `heroIsPortrait` / initialise `heroImgRatio` to `2/3` |
| 3 | **Fragile EXIF relative imports** | `mobile/src/lib/exif/photoSource.ts`, `useExifScan.ts` | Replace `../../../../src/lib/journal/...` with path alias |
| 4 | **Form props all `any`** | `mobile/app/entry/edit/[id].tsx` | Extract `FormProps` interface with proper theme types |
| 5 | **`ImportRun.updated` always 0** | `photoSource.ts:170`, `useExifScan.ts:168` | Change `updated: 0` → `updated: plan.updatedEntries.length` |
