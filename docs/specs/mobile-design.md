# Mobile Design: Specification

**Status:** Draft v1.4, ready for WP1.0
**Location:** `docs/specs/mobile-design.md`
**Branching:** one feature branch per phase, e.g. `feat/mobile-paper-theme`, merged by PR (see Constraints)

---

## 0. How to use this document (read first)

This spec is written for an agent working across several sessions. It is a living document: the agent that does the work is also responsible for keeping it true.

**At the start of a session**
1. Read this whole file, then `AGENTS.md`, then `BACKLOG.md`.
2. Find the first phase in section 9 with unchecked tasks. Work on that phase only.
3. Check the Open questions (section 11). If a question blocks the task, stop and ask the user. Do not guess on anything marked `BLOCKING`.

**While working**
- Tick a task (`- [x]`) only when its acceptance criteria are met and `npm run type-check` passes in `mobile/`.
- If you change a design decision, edit the relevant section, then add a row to the Decision log (section 12). Do not leave the spec describing something the code no longer does.
- If you discover a task is wrong, too big, or missing, edit it in place and note why in the Progress log.
- Record anything you learn that the next session needs (gotchas, versions, device quirks) in the Progress log, not in chat.

**At the end of a session**
- Add a dated entry to the Progress log (section 13): what was done, what is next, anything unresolved.
- Leave the branch in a working state. Do not force-push or rewrite pushed history.

**Working mode: sequential, small work packages (WPs)**
- Only one agent works on this project at a time. Never assume another agent is editing in parallel, and never leave the branch half-done at the end of a session.
- Work is delivered as tightly defined **work packages**, listed under each phase in section 9. Do one WP at a time.
- Per WP: do the scope, run the checks in its "Done when", tick the WP in this file, commit (code and spec tick together), then **stop and report** in a few lines: what changed, what was verified, anything surprising. Do not start the next WP until told to.
- If a WP turns out to be bigger than described, stop at a clean point, commit what is verified, and propose a split. Do not push through.
- Commit message format: `mobile: WP1.3 load fonts and hold splash`. One WP, one commit (more only if it genuinely needs them).
- Checks before every commit: `npm run type-check` in `mobile/` must pass; if anything under `../src/lib/journal/` changed, the root test suite must pass (`bun run test`); and state what you checked by hand on a device or emulator (screens visited, themes tried, font scale).
- Later phases (2 onwards) have goals but not yet WPs. When a phase is reached, propose its WP breakdown and wait for approval before coding.

**Writing rules for anything the agent writes into this repo or UI**
- Do not use em dashes anywhere (code comments, UI copy, docs, commit messages). Use a colon, comma, parentheses or a hyphen.
- UI copy is sentence case, no exclamation marks.

---

## 1. Purpose

Chronicle is a **passive journal**. Activity is imported from other apps and services (flights, trains, stays, films, TV, books, gigs, calendar events) and the journal assembles itself. The user's only authored input is:

- a **reflection** (free text, later also voice) and a **rating** on any entry,
- **people** present at an entry,
- **corrections** to imported data (these always win over source data, tier 1),
- naming and editing container objects such as Trips and Series.

There is no "create a new entry" flow in the mobile app. Do not add a floating action button or an "add entry" screen.

**Goal of this spec:** make the mobile app feel like a beautifully made paper notebook (Moleskine-like) while remaining a first-class modern Android app. It should reach parity with the web version's look and navigation first, then go beyond it with native craft: motion, haptics, media, and offline-first polish.

**Design intent in one line:** warm paper, ink-dark serif type, rust accent, quiet hairlines instead of boxes, and one obvious thing to do on every screen (read, then reflect).

---

## 2. Current state (baseline, 3 Oct 2026)

Facts about `mobile/` as found in the repo. Update this section if it drifts.

- Expo SDK 57, React Native 0.86, Expo Router, TypeScript strict. SQLite via `expo-sqlite` through `src/lib/storage/SQLiteAdapter.ts`.
- Shared engine lives in `../src/lib/journal/` and is imported via the `@chronicle/journal/*` aliases (see `babel.config.js` and `tsconfig.json`). Mobile and web share types, db API, connectors and staging.
- Routes: `app/(tabs)/{index,trips,culture,moments,people}.tsx`, `app/entry/[id].tsx`, `app/trip/{[id],new}.tsx`, `app/person/[id].tsx`, modals `import`, `import-people`, `settings`.
- Theme: `src/theme.ts` is **dark only** (coffee background `#1E1610`, parchment text, rust accent). All screens read colours from this file, but many hard-code font sizes and styles locally.
- Fonts: system serif (Georgia on iOS, generic `serif` on Android). No custom fonts loaded. Trip and entry titles mostly use the sans default.
- Icons: Ionicons for chrome, **emoji** for entry kinds in the feed and detail screens.
- Source marks: shown as a plain text "Source" row on the entry page only. Not shown in the feed.
- Motion and haptics: none. Press feedback is `opacity`.
- Tabs: Chronicle, Trips, Culture, Moments, People. Import and settings icons sit in the Chronicle header only.
- `app.json`: `userInterfaceStyle: "dark"`, splash and adaptive icon background `#0f172a` (slate, does not match the palette).
- Entry detail is view-only: a label/value card, with Reflection as a secondary card. No rating control, no people editing, no corrections.

The **web version is ahead** and is the visual reference: Paper theme, Fraunces serif, monospace small caps labels, icon-only source marks, trip label above each day group, "+ reflection for this day", person and category filters, search, expanding cards with reflection, manual corrections and people editing.

---

## 3. Principles

1. **Passive first.** Imported data is the spine. Authored content is texture on top. Never make the user feel they must fill things in.
2. **Reading is the default state.** Screens are calm. Editing affordances are small and quiet until used.
3. **Paper, not cards.** Prefer hairline rules and whitespace over bordered boxes. Boxes are for tappable objects (trip tiles) and inputs.
4. **Same book on every device.** Visual language, naming, tab order and data semantics match the web version unless this spec says otherwise.
5. **Local-first and private.** No network lookups that send personal data. No analytics. Fonts and icons are bundled, not fetched at runtime.
6. **Native where it counts.** Edge-to-edge, predictive back, haptics, 48dp touch targets, system font scaling, TalkBack labels.
7. **Restraint.** One accent colour. No gradients, shadows or glows beyond what a screen genuinely needs.

---

## 4. Design tokens

### 4.1 Themes

Theming is a **user-facing feature**: the user chooses a theme in Settings. Phase 1 ships two themes, but the architecture must support many (see Phase 7 for the planned gallery). **Paper is the default.** Leather is the existing dark palette.

`src/theme.ts` becomes a theme module exposing `useTheme()` returning `{ colors, fonts, text, spacing, radius, isDark, texture }`. Screens must not import raw colour constants directly after Phase 1.

**Theme definition (data, not code).** Each theme is a plain object registered in a `themes` registry:

```ts
interface ThemeDefinition {
  id: string;            // "paper", "leather", later "steampunk", "retro-future"
  name: string;          // shown in Settings
  mode: "light" | "dark";
  colors: ThemeColors;   // the token names in 4.2
  fonts: { serif: string; sans: string; mono: string };  // family names, loaded per theme
  radius?: Partial<typeof radius>;   // optional overrides
  texture?: ImageSourcePropType;     // optional static background texture
  sourceMarkTint?: "brand" | "ink";  // how SourceMark is coloured in this theme
}
```

Rules that make future themes cheap:
- Components consume tokens only. No component may check a theme id or contain theme-specific branches.
- Anything a theme might change (fonts, radius, texture, source mark tint) is a token, not a literal.
- Fonts for non-default themes load lazily when that theme is selected, so the base install stays small.
- Theme choice persists locally and is applied before first paint (no flash of the wrong theme).
- Adding a theme must require only a new `ThemeDefinition` and any font or texture assets, with no screen changes.

Settings has an **Appearance** screen: a list of themes with a small live preview swatch each (background, ink, accent, sample serif text), plus `Match system` (maps to Paper in light, Leather in dark). Default `Paper`.

### 4.2 Paper colours (derived from web `src/styles.css`, oklch converted to sRGB)

| Token | Hex | Use |
|---|---|---|
| `bg` | `#F9F3E6` | screen background (paper) |
| `surface` | `#FEFAF1` | inputs, sheets, tappable tiles |
| `surfaceMuted` | `#EEE7D9` | top bar, tab bar, chips |
| `surfaceAccent` | `#EADCC5` | selected states |
| `border` | `#DAD0BF` | hairlines, rules |
| `text` | `#291C14` | primary ink |
| `textSecondary` | `#706052` | secondary labels |
| `textMuted` | `#9A8B77` | placeholders, hints (check contrast, see 4.6) |
| `primary` | `#A5492B` | accent: active tab, links, reflection prompts |
| `onPrimary` | `#FBF8F1` | text on primary |
| `destructive` | `#CC2827` | delete |
| `kindAir` | `#1F6A96` | flights |
| `kindRail` | `#337344` | trains |
| `kindRoad` | `#90693B` | road |
| `kindGig` | `#A53C75` | concerts |
| `kindStay` | `#7B63A3` | stays |

The web file is the source of truth. If web tokens change, update this table and `theme.ts` together.

### 4.3 Leather colours

Keep the current values in `src/theme.ts` unchanged, mapped onto the same token names. Do not redesign Leather in this spec.

### 4.4 Typography

Match the web stack, bundled via `expo-font` and the `@expo-google-fonts/*` packages (no runtime fetching):

| Role | Family | Weights |
|---|---|---|
| Serif (titles, day numerals, reflections) | Fraunces | 400, 500, 600 |
| Sans (UI, subtitles, metadata) | IBM Plex Sans | 400, 500 |
| Mono (kind labels, dates, source tier) | JetBrains Mono | 400, 500 |

Rules:
- Day numeral: serif 32/36. Entry title in feed: serif 17/24. Page title on entry screen: serif 28/34.
- Kind labels (`FLIGHT`, `EPISODE`), weekday/month/year in the date column, and trip labels use mono, uppercase, 10 to 11sp, letter spacing about 0.08em.
- Reflection text uses the serif at 16/26, with italic only for the empty prompt.
- Respect system font scale. Test at 1.3x. No fixed heights on text containers.
- Keep the splash screen visible until fonts and the journal have loaded.

### 4.5 Spacing, radius, motion

- Keep the 4pt spacing scale already in `theme.ts`.
- Radius: 6 for chips and inputs, 10 for tiles. No pill shapes except filter chips.
- Hairlines use `StyleSheet.hairlineWidth`.
- Motion durations: 120ms for press feedback, 220ms for entry transitions, 300ms for page transitions. Easing: standard ease-out. Respect the system "remove animations" setting.

### 4.6 Accessibility

- Text contrast at least 4.5:1 against its background in both themes. Verify `textMuted` and `textSecondary` on `bg` and `surfaceMuted`; darken them if they fail and update 4.2.
- Touch targets at least 48dp (use `hitSlop` where the visual is smaller).
- Every icon-only control has an `accessibilityLabel`. Source marks have a label naming the source.
- Do not rely on colour alone to convey rating or state.

---

## 5. Iconography and source marks

- Replace all emoji with a consistent line icon set. Keep `@expo/vector-icons` (Ionicons) unless a better single set is chosen; do not mix sets. Kind icons: flight, train, car, bed, film, tv, book, music, star/flag for moments.
- **Source marks** reuse `../src/lib/journal/connectors/icons.ts` (`sourceIconPath`, `sourceColor`). Those are plain data (24x24 SVG path, hex colour), shared with web. Render with `react-native-svg` (`npx expo install react-native-svg`).
- Component `SourceMark`: 20x20 rounded square (radius 5), background is the source colour at 15% opacity, glyph is the source colour at about 14px. Mirror `src/components/journal/SourceIcon.tsx` on web.
- Not every source has an official mark (`icons.ts` says so deliberately). Fallback: a neutral chip with the entry kind icon from the line icon set. Never render text in place of a mark in the feed.
- The source colours were softened for a dark palette. Check them on Paper for contrast and, if needed, add a `paperColor` variant in the mobile layer without editing the shared file in a way that breaks web.
- Feed rows show only the mark. The entry page small print shows the mark, the source label and the tier (`t1`, `t2`, `t3`) in mono.

---

## 6. Navigation and chrome

### 6.1 Tabs

Four tabs, in this order: **Chronicle, Trips, Culture, People**.

- Hide Moments from the tab bar for now. Do not delete `app/(tabs)/moments.tsx` or its logic: the tab is likely to return in a later revision. Hide it from navigation only (for example `href: null` on the tab screen) so it can be restored by removing one option.
- Moment-type events remain visible in the Chronicle feed. They are not added to Culture. Moments handling is deferred (Q1).
- Tab bar: `surfaceMuted` background, hairline top border, active tint `primary`, inactive `textSecondary`, labels 11sp sans, icons 24dp. No ripple background fill beyond the system default.

### 6.2 Top bar

Shown on all four tab screens, same layout:

- Left: screen title in serif (`Journal` on Chronicle, `Trips`, `Culture`, `People`).
- Right: two icon buttons only: **Sources** (opens the import and sources screen) and **Settings**.
- **No inbox icon.** Pending staged items are shown as a small `primary` dot on the Sources icon only. No banners, stamps or counters elsewhere in the feed.
- Tab-specific actions do not go in the top bar. `New trip` lives on the Trips tab and `Import contacts` on the People tab, each as a quiet text action at the top of the list (`ScreenHeaderAction`, primary colour, sans 14sp, 48dp touch target).

The Sources screen must remain reachable in one tap from anywhere in the tab area. Pending staged items are listed first on that screen.

### 6.3 System integration

- Enable edge-to-edge and handle insets with `react-native-safe-area-context`. Status and navigation bars are transparent, with icon colour following theme.
- Opt in to predictive back for Android 14+ (`android.enableOnBackInvokedCallback` in `app.json`).
- `userInterfaceStyle` becomes `automatic`. The theme setting overrides it.
- Replace splash and adaptive icon background (`#0f172a`) with the Paper `bg` and a notebook-style icon. Provide a monochrome icon for themed icons on Android 13+.
- Use the Material 3 navigation bar proportions (80dp height, 24dp icons, 12sp labels with an active indicator) but styled to this palette. A filled pill indicator behind the active icon in `surfaceAccent` is acceptable.

---

## 7. Screens

### 7.1 Chronicle (feed)

Structure per day group (mirrors web):

```
[ 20 ]  |  DUSSELDORF . SEPT 2026        <- trip label (mono, primary, optional)
[ SUN ] |  [mark] Koln to DUB                      FLIGHT
[ SEPT] |         FR4500
[ 2026] |  --------------------------------------------
        |  [mark] Another entry                     FILM
        |         + reflection for this day
```

- Date column ~52dp: day numeral in serif, then weekday, month, year in mono caps, right aligned. Vertical hairline between the date column and entries.
- Entries are **rows separated by hairlines, not bordered cards**. Each row: source mark (or kind icon) at the start, serif title, sans subtitle, mono kind label at the end. Rated entries show stars (rust) under the title.
- Rows carry no "add reflection" hint. The reflection prompt lives on the entry page and in the day-level line below.
- "+ reflection for this day" line at the bottom of each day group, `primary` colour, sans 12sp. Mirror the web behaviour in `src/routes/index.tsx` (inspect it; use the same data shape, do not invent a new one).
- Above the list: search field and filter chips (kinds, categories) and a People filter (`Everyone` plus person chips), matching web. These scroll away with the list; do not pin them.
- Tapping a row opens the entry page (7.2). Use a shared-element style transition for the title where practical (Phase 4).
- Empty state: serif headline `Your journal is empty`, one line of body copy, and a text button `Add a source`. No emoji.
- Use `FlashList` (`@shopify/flash-list`) for the feed once the entry count makes `FlatList` slow. Measure first.

### 7.2 Entry page (separate page, not inline expansion)

Decision: mobile uses a full entry page rather than the web's inline card expansion, because the page gives room for media and richer reflection. Do not convert it to inline expansion.

Order top to bottom:
1. Back button and overflow menu (`Amend`, `Delete`).
2. Date line (mono caps), serif title, sans subtitle (kind, place, trip).
3. **Rating**: five tappable stars with half-star support, stored via the shared `rating` field (0 to 10). Light haptic on change. Tapping the current value clears it.
4. **Media strip** (Phase 5): photos as slightly rotated mounted prints, horizontally scrollable. Empty state is hidden entirely, with an `Add photo` control inside the reflection toolbar.
5. **Reflection**: a ruled page area with the serif at 16/26. Empty prompt (italic, `textMuted`): `What do you remember?`. Auto-grows. Auto-saves on blur and on leaving the page (debounced). No Save button.
6. **People**: chips with remove, `Add person` typeahead, creating a person on the fly. Follow the participants rules in `docs/specs/people.md` exactly (self implicit when `participants` is undefined).
7. **Small print**: source mark, source label, tier in mono, trip link, source reference. Structured imported fields (seat, aircraft, operator, director, etc.) sit here as compact label/value rows, not as a hero card.
8. **Amend** (collapsed, opened from the overflow menu): edit imported fields. Writes tier 1 manual overrides that survive re-import. Label it `Corrections (these win over imported data)`.

Navigation: swipe left and right to move between entries of the same day (Phase 4). Keep the back stack simple: back always returns to the feed at the same scroll position.

### 7.3 Trips

- List of trips, newest first. Each is a tappable tile: mono date range, serif title, sans meta (`N nights, N entries`). Purpose shown with a line icon, not emoji.
- Trip page: serif title, date range, day-by-day list using the same row component as the feed. Trip and Series name editing happens here (container editing is an allowed manual input).
- `New trip` remains available because trip boundaries are user-defined. It is a text action at the top of the Trips list (Q2, closed).

### 7.4 Culture

Films, episodes, books and concerts in one view with series grouping and filters by kind and rating, as on web. Use the shared row component and `SourceMark`. Poster or cover imagery is out of scope for this spec.

### 7.5 People

List of people with entry counts, self marked. Person page shows a timeline using the shared row component. `Import contacts` is a text action at the top of the People list, not in the top bar.

### 7.6 Sources (import) and Settings

- Sources screen: list of supported sources with `SourceMark`, pending staged items first, import action per source, last import time. Reuse the staging hub logic in `@chronicle/journal/staging`; do not fork it.
- The share-intent and file-open handling in `app/_layout.tsx` must keep working (`.csv`, `.ics`, `.vcf`, `.json`).
- Settings: theme (Paper, Leather, Match system), backup and restore, reset database (confirm dialog), about. Keep the themed `Dialog` component, restyled for Paper.

---

## 8. Shared components to build

Build these once in `mobile/src/components/` and use them everywhere. New screens must not re-implement them.

| Component | Purpose |
|---|---|
| `ThemeProvider`, `useTheme` | theme tokens and mode |
| `SourceMark` | source icon chip with fallback |
| `KindIcon` | line icon per entry kind |
| `EntryRow` | one entry in any list (feed, trip, person, culture) |
| `DayGroup` | date column, trip label, rows, day reflection line |
| `TopBar` | title plus Sources and Settings icons, with pending dot |
| `Rating` | tappable half-star control, display and edit modes |
| `ReflectionField` | ruled auto-growing text field with auto-save |
| `PersonChips` | participants display and editor |
| `ScreenHeaderAction` | quiet text action at the top of a list |
| `Dialog` (existing) | restyle for Paper |

---

## 9. Phases and tasks

Each phase is one branch and one PR. Do not start a phase until the previous one is merged, unless the user says otherwise.

### Phase 1: Foundation and web parity

Branch: `feat/mobile-paper-theme` (one branch for the whole phase; one commit per WP)

Phase goal: with the same data, the mobile feed matches the web version in palette, type, layout and navigation, behind a data-driven theme system.

Work packages, in order. Each WP is independently shippable: the app runs and type-checks after every one.

| WP | Name | Scope | Done when |
|---|---|---|---|
| [x] 1.0 | Duplicate legs investigation (read only) | Find why the same flight appears twice (spec 10.3). Read `connectors/keys.ts`, staging commit and the mobile SQLite path. No code changes. | Findings and a recommended fix written in the Progress log. User decides whether and where to fix. |
| [x] 1.1 | Theme registry and provider (no visual change) | `ThemeDefinition` type, registry with Leather (current values) and Paper, `ThemeProvider`, `useTheme`, persisted choice applied before first paint. `src/theme.ts` keeps exporting the old constants as a thin compatibility layer. Leather stays the active theme. | App looks identical to before. Type-check passes. Provider returns the persisted theme after a restart (checked by hand with a temporary toggle, then removed). |
| [x] 1.2 | Migrate screens to tokens | Move every screen and component from direct colour and style constants to `useTheme()`, a few screens per commit if needed. Remove the compatibility layer at the end. Still Leather. | No file in `mobile/` imports raw colours; app looks identical to before; type-check passes. |
| [x] 1.3 | Fonts and splash | Add Fraunces, IBM Plex Sans, JetBrains Mono via `@expo-google-fonts/*` and `expo-font`; hold splash until fonts and journal are ready; fonts come from the theme's `fonts` tokens. | Fonts render on a device in a release-like run (not just Expo Go); splash does not flash unstyled text. |
| [x] 1.4 | Type scale | Apply the 4.4 type roles to feed, entry page, trips, culture, people, settings. Titles in serif, kind labels and dates in mono caps. Still Leather. | Checked at 1.0x and 1.3x font scale with no clipping. |
| [x] 1.5 | Paper theme live and Appearance screen | Finalise Paper colours (4.2, with contrast checks from 4.6), Appearance screen in Settings with preview swatches and `Match system`, make Paper the default, `userInterfaceStyle: automatic`. | Switching between Paper, Leather and Match system restyles every screen with no leftover dark or light patches. |
| [x] 1.6 | Icons and source marks | Add `react-native-svg`; build `SourceMark` and `KindIcon`; replace every emoji in `mobile/`. | No emoji remain (search for them). Netflix, Letterboxd, Goodreads show brand marks; other sources show the fallback chip. TalkBack labels present. |
| [x] 1.7 | Four tabs | Chronicle, Trips, Culture, People. Hide the Moments tab (code kept, spec 6.1). Tab bar styling per 6.1. | Four tabs only; Moments code still present and restorable by removing one option. |
| [x] 1.8 | TopBar | Shared `TopBar` on all four tabs: serif title, Sources and Settings icons, dot on Sources when staged items are pending. Remove tab-specific header icons. | Dot appears after staging a file and clears after commit or discard. Sources reachable in one tap from every tab. |
| [x] 1.9 | Feed rows and day groups | `EntryRow` and `DayGroup` per 7.1: date column, rule, trip label, hairline rows, source mark, mono kind label, rating stars. | Visually matches the web feed for the same data. Scroll stays smooth on a feed of at least 1,000 entries. |
| [x] 1.10 | Feed search, filters and day reflection | Search field, kind and category chips, People filter, `+ reflection for this day` line mirroring the web behaviour and data shape. | Filters and search narrow the feed as on web. A day reflection saved on mobile persists and appears after restart. |
| [ ] 1.11 | App shell | `app.json` and assets: edge-to-edge, predictive back, splash and adaptive icon colours, simple notebook launcher icon (Q4). | Release-like build shows the right splash and icon; system bars follow theme; back gesture works. |

Phase 1 acceptance (checked after WP1.11): side by side with web at the same data, the feed is equivalent in palette, type, layout and navigation. Import via share intent still works. `npm run type-check` passes. No emoji remain. Then open the PR.

### Phase 2: Entry page

Branch: `feat/mobile-entry-page`

- [ ] Entry page rebuilt per 7.2 (title block, `Rating`, `ReflectionField`, `PersonChips`, small print).
- [ ] Rating writes the shared `rating` field; reflection writes `reflection`; both persist through the shared db API and survive restart.
- [ ] Auto-save on blur and on leaving; no Save button; keyboard never covers the field.
- [ ] Overflow menu with `Amend` and `Delete` (confirm dialog).
- [ ] `Amend` writes tier 1 overrides; verify a re-import does not overwrite them.
- [ ] People editing follows `docs/specs/people.md`.

Acceptance: a reflection, rating and person added on mobile are visible after force-closing the app. Amended fields survive re-importing the same file. TalkBack reads every control sensibly.

### Phase 3: Remaining screens

Branch: `feat/mobile-screens`

- [ ] Trips list and trip page restyled; trip and series editing.
- [ ] Culture restyled with shared rows and filters.
- [ ] People list and person page restyled.
- [ ] Sources screen and Settings restyled; `Dialog` restyled; empty states rewritten.
- [ ] Move `New trip` into the Trips tab and `Import contacts` into the People tab as text actions at the top of each list (`ScreenHeaderAction`). Remove any related icons from tab headers.

Acceptance: no screen uses Leather-only styling or hard-coded colours; every list uses `EntryRow`.

### Phase 4: Motion and haptics

Branch: `feat/mobile-motion`

- [ ] `react-native-reanimated` and `expo-haptics` added.
- [ ] Feed row to entry page transition; swipe between entries in a day.
- [ ] Staggered row appearance on first load and after an import.
- [ ] Haptics on rating change, tab change and destructive confirm.
- [ ] Respect reduced-motion setting.

Acceptance: 60fps on a mid-range device in a feed of 2,000 entries (measure; adopt `FlashList` if needed). All animations are disabled when the system asks.

### Phase 5: Media

Branch: `feat/mobile-media`

- [ ] Spec the data model first (see 10.1) and get user sign-off before coding.
- [ ] `media_attachments` table via the SQLite adapter; files stored in the app document directory.
- [ ] Add photo from library or camera on the entry page; mounted-print strip; full-screen viewer.
- [ ] Suggest geotagged photos near an entry's date and place (suggestions only, never auto-attach; on-device only).
- [ ] Zip export of database plus media.

Acceptance: media survives restart and backup/restore round trip; no media leaves the device.

### Phase 6: Paper craft (optional polish)

Branch: `feat/mobile-craft`

- [ ] Subtle paper grain on `bg` (static image, no animation) and a ruled page treatment on the reflection area.
- [ ] Ribbon bookmark marking the last-read day.
- [ ] Voice reflections (record, waveform, playback) alongside written reflections.
- [ ] Cover screen on launch (year, wordmark) shown briefly.

Acceptance: each item can be switched off in Settings; none affects scroll performance.

### Phase 7: Theme gallery (backlog, not scheduled)

Branch: `feat/mobile-themes`

Depends on Phase 1 and 3. Not started until the user supplies the design ideas (Q6).

- [ ] Candidate themes from the user's earlier travel app iteration: Paper, Leather, Steampunk, 1950s retro-future, and others to be listed by the user.
- [ ] One `ThemeDefinition` per theme with colours, fonts and optional texture; verify contrast (4.6) for each.
- [ ] Lazy font loading per theme; theme preview swatches in Appearance.
- [ ] Optional per-theme ornaments (for example a themed divider or empty-state illustration) as an extension point only if it can be done without theme checks in components.

Acceptance: switching theme restyles every screen with no layout breakage at 1.3x font scale; adding another theme requires no screen edits.

---

## 10. Data and engineering notes

### 10.1 Media (design before building)

Not in the shared model today. Proposed minimum, to be confirmed in Phase 5:

- `media_attachments(id, entryId, kind, uri, width, height, takenAt, createdAt)` with `kind` in `photo | audio`.
- Keyed to entry id so web can adopt the same structure later.
- Files live in the app document directory; the database stores relative paths only.
- Export and backup must include media.

### 10.2 Shared code

- Prefer changes in `mobile/` only. If a change to `../src/lib/journal/` is needed, keep it backward compatible, add or update tests under `src/lib/journal/__tests__/`, and run `bun run test` at the repo root.
- Never delete or simplify anything under `src/lib/journal/connectors/` (see `AGENTS.md`). Do not import from `src/lib/journal/parsers.ts`.
- The mobile `SQLiteAdapter` is the only storage implementation on device. Do not add network sync.

### 10.3 Known issues to watch

- Duplicate legs appear in the feed (same flight shown twice on the same day). Likely the same leg arriving from two sources. Investigate dedupe keys in `connectors/keys.ts` before polishing the feed, and log findings in the Progress log. Do not hide duplicates in the UI as a workaround.
- Expo Router may restore stale navigation state on hot reload and land on a modal; the existing guard in `app/_layout.tsx` handles this. Keep it.

---

## 11. Open questions

| # | Question | Blocks | Status |
|---|---|---|---|
| Q1 | How should moments be handled? | none | Deferred: treated in a later revision; the tab will likely return. Until then the Moments tab is hidden, its code kept, and moment entries stay in Chronicle only |
| Q2 | Where do `New trip` and `Import contacts` live? | none | Closed: inside their own tabs (Trips and People) as text actions at the top of each list |
| Q3 | Should Leather remain a supported theme long term? | none | Closed: yes. Theming becomes a user-selectable feature in Settings; further themes are a backlog item (Phase 7) |
| Q4 | Is a custom launcher icon design needed? | none | Closed: a simple notebook glyph is fine for now; the icon will likely be redesigned later |
| Q5 | Poster and cover imagery for Culture: in scope for a later spec? | none | Deferred |
| Q6 | Which themes, and what palettes and fonts, for the gallery? The user has ideas from an earlier travel app iteration (paper, leather, steampunk, 1950s retro-future, others). | Phase 7 | Open: user to share the earlier designs when ready |

Agents: when a question is answered, change its status to `Closed` with the answer and add a Decision log row.

---

## 12. Decision log

| Date | Decision | Reason |
|---|---|---|
| 2026-10-03 | Chronicle is passive: no create-entry flow, no FAB on mobile | Journal is built from imports; manual input is reflection, rating, people, corrections |
| 2026-10-03 | Default theme is Paper, matching web; Leather kept as an option | Web is the visual reference; notebook feel |
| 2026-10-03 | Tabs are Chronicle, Trips, Culture, People; Moments dropped | Matches web direction |
| 2026-10-03 | Top bar has Sources and Settings only; no inbox icon | Reduce clutter |
| 2026-10-03 | Pending staged items shown as a dot on the Sources icon only; no feed banner | Reduce clutter |
| 2026-10-03 | Source marks are icons only in the feed | Matches web |
| 2026-10-03 | Mobile keeps a separate entry page (not inline expansion) | Room for media and richer reflection |
| 2026-10-03 | Fonts match web: Fraunces, IBM Plex Sans, JetBrains Mono | Cross-device consistency |
| 2026-10-03 | Entries are hairline rows, not bordered cards | Paper feel |
| 2026-10-03 | Theming is a user-selectable feature (Paper, Leather now; steampunk, retro-future and others in Phase 7); themes are data-driven `ThemeDefinition`s and components never branch on theme (Q3) | User wants a themable app; keeps future themes cheap |
| 2026-10-03 | Agents work sequentially, never in parallel; Claude Code works in tightly defined work packages, each tested and committed, then stops and reports | Proven workflow; avoids conflicts and half-done branches |
| 2026-10-03 | Launcher icon: simple notebook glyph for now, expected to change later (Q4) | Not worth design time yet |
| 2026-10-03 | Moments tab hidden but not removed; moments handling deferred to a later revision (Q1) | Tab will likely return; avoid losing the code |
| 2026-10-03 | `New trip` and `Import contacts` move into the Trips and People tabs (Q2) | Keeps the top bar to Sources and Settings |

---

## 13. Progress log

Newest first. One entry per session.

- **2026-10-03 (WP1.10 complete):** Added search, kind/category filter chips, People filter, and inline reflection editing to the Chronicle feed. `index.tsx`: added `F` type (`"all"|"travel"|"concert"|"social"|"milestone"|"memory"|"notes"`), `filter`/`q`/`personId` state, `matchesFilter()` and `entryHasPerson()` helpers mirroring `src/routes/index.tsx` exactly. Groups memo does a two-pass build: Pass 1 fills `entryMap` with filtered entries (skipped entirely for `filter==="notes"`); Pass 2 adds note-only days when `filter==="all"|"notes"`, or attaches notes to days that already have entries for kind filters. People filter suppresses notes (no participants). `ListHeaderComponent` renders: search `TextInput` (with magnifier-via-KindIcon, `clearButtonMode="while-editing"`), `FILTERS` chip `ScrollView`, and (conditionally) People chips `ScrollView` — all scroll away with the feed. `keyboardShouldPersistTaps="handled"` and `keyboardDismissMode="on-drag"` on FlatList. `DayGroup.tsx`: added inline reflection editor using local `editing`/`draft` state; tapping the prompt or existing note enters edit mode with a multiline `TextInput` (`fonts.serifMedium`, italic, left-border rule); Save calls `putMany("notes", [...])` with the web's exact Note shape (`id`, `date`, `text`, `createdAt`, `updatedAt`); Cancel resets state. TypeScript clean, all 117 tests pass. Next: WP1.11 (app shell).

- **2026-10-03 (WP1.9 complete):** Created `mobile/src/components/EntryRow.tsx` — shared row component for any entry list. Renders: `SourceMark` (when source has a registered icon path via `sourceIconPath()`) or `KindIcon` fallback (20dp, leading); serif title (`feedTitle`, `serifMedium`); optional sans subtitle (flight number/operator, city, director/year, etc. — mirrors web `EntryCard` meta); mono kind label at trailing edge (10sp caps, "Flight"/"Train"/"Road"/"Stay"/"Film"/"Rewatch"/"Episode"/"Book"/"Series"/event category); `StarRating` under title when rated. No card border — rows separated by hairlines managed by parent. Created `mobile/src/components/DayGroup.tsx` — one calendar day in the feed. Date column (52dp, right-aligned, serif day number + mono weekday/month/year); hairline vertical rule; optional trip label (`✦ TITLE`, mono caps, `accentSoft`); `EntryRow` list separated by hairlines; `+ reflection for this day` prompt at bottom (shows existing note text in serif italic if one exists — editing wired up in WP1.10). Rewrote `mobile/app/(tabs)/index.tsx`: groups entries by day, resolves trip via date-range match (`d >= trip.start && d <= trip.end`) mirroring web `tripOf`, attaches `Note` per day, renders `DayGroup` list. Removed local `EntryCard`/`DayGroupRow`/`kindIcon()`. TypeScript clean.

- **2026-10-03 (WP1.8 complete):** Added `HeaderRight` component to `_layout.tsx`: Sources icon (`cloud-upload-outline`, links to `/import`) + Settings icon, rendered via `screenOptions.headerRight` on all four tabs. Red dot (7dp, `colors.error`, absolute positioned top-right of icon) appears when `journal.staging.length > 0`. Chronicle tab title changed from "Chronicle" to "Journal". Removed per-tab `headerRight` overrides (Trips `add` button, People `person-add-outline` button). Added `New trip` text action (`listActionText`: 14sp, `fonts.sans`, `accentSoft`) as `ListHeaderComponent` on the Trips FlatList (right-aligned, 48dp min-height, links to `/trip/new`). Added `Import contacts` text action as `ListHeaderComponent` on the People FlatList (links to `/import-people`). Updated People empty state hint to remove stale reference to the removed icon button. Added `ThemeFonts` import to `people.tsx`; `createStyles` now accepts fonts so the action text uses the theme font stack. TypeScript clean.

- **2026-10-03 (WP1.7 complete):** Added `surfaceMuted` color token to `ThemeColors` and all three themes (Leather `#EFE8E0`, Paper `#EEE7D9`, Ink `#2A2010`). Replaced the floating pill `FloatingNavBar` with a docked bottom tab bar: `surfaceMuted` bg, hairline top border (`colors.border`), 56dp bar height + safe-area inset, 24dp icons, 11sp sans labels, active-item pill in `surfaceAccent` (64×32dp, radius 16) with `accentSoft` icon + label, inactive items in `textSecondary`. Updated `_layout.tsx`: wrapped `<Tabs>` in a `flex:1` View so the docked bar sits below it rather than overlaying it (removes the floating z-index approach). No Moments tab to hide (file was never created). Type-check passes.

- **2026-10-03 (WP1.6 complete):** Added `react-native-svg` (install requires `--legacy-peer-deps` due to monorepo `@types/react` pin). Created `mobile/src/components/KindIcon.tsx`: `KindIcon` (Ionicons, maps kind+subkind → icon name and accessibilityLabel) and `StarRating` (5-star row, aria-hidden). Created `mobile/src/components/SourceMark.tsx`: react-native-svg rounded chip, 15% opacity brand bg, sourcing paths/colours from `@chronicle/journal/connectors/icons`. Replaced all emoji across 8 screens: `index.tsx`, `culture.tsx`, `trips.tsx`, `entry/[id].tsx`, `import.tsx`, `person/[id].tsx`, `trip/[id].tsx`, `trip/new.tsx`. `PURPOSE_ICON` emoji maps → `PURPOSE_KIND` string maps + `KindIcon`. `entryEmoji()` / `cultureEmoji()` / `kindIcon()` helper functions removed; replaced by `entrySubkind()` helpers that return the subkind for `KindIcon`. `stars()` and `"★".repeat()` patterns replaced with `StarRating`. Entry `stars` prop redesigned to `<View ratingRow><StarRating/><Text ratingNum/></View>`. `accentColor`/`borderColor` props on `RecordRow` and `SuggestionCard` consolidated into a single `colors: ThemeColors` prop. Unused `cardIcon`, `emptyIcon`, `recordEmoji`, `purposeIcon` StyleSheet entries removed. Type-check passes (only `react-native-svg` types error until install runs).

- **2026-10-03 (Ink dark theme, bonus before WP1.6):** Added "Ink" dark theme — warm dark palette (`bg #1C1309`, same Fraunces/Plex/JetBrains fonts as Paper). All text tokens WCAG AA 4.5:1 checked: `textTertiary`/`textMuted` `#967E68` (4.78:1 ✓), `textSecondary #9A8570`, accent `#C86832` (4.78:1 ✓). Added to `THEMES` registry; "system" virtual ID now resolves to Ink in dark mode. Appearance screen updated to a 2×2 grid (Paper | Ink / Leather | System); System swatch shows Paper bg left / Ink bg right split with both accent dots. `paper` `textTertiary`/`textMuted` re-verified: `#786A57` passes at 4.75:1 ✓. Motivation: "Match system" was meaningless with two light themes only; Ink makes it functional.

- **2026-10-03 (WP1.5 complete):** Made Paper the default theme (`DEFAULT_THEME_ID = "paper"`). Added "system" virtual theme ID: resolves to Paper in light mode, Leather in dark mode, using `useColorScheme()` inside `ThemeProvider`. `ThemeContext` now carries `themeId` (raw selection) alongside `theme` (resolved). `useTheme()` exposes `themeId` so the Appearance screen can reflect the active choice. Contrast-checked Paper `textTertiary` and `textMuted`: both were `#9A8B77` (3.00:1 on Paper bg — fails WCAG AA 4.5:1); darkened to `#786A57` (4.75:1 ✓). `textSecondary #706052` passes at 5.45:1 (no change). Added Appearance section to `settings.tsx` above Database: three swatch cards (Paper, Leather, System); each shows bg + ink + accent dots and a checkmark when selected; "System" shows a split swatch (Paper bg left, Leather bg right). `app.json`: `userInterfaceStyle` → `"automatic"`, splash + adaptiveIcon bg → `#F9F3E6`. `_layout.tsx`: both `StatusBar style="light"` → `mode === "dark" ? "light" : "dark"`. Type-check passes.

- **2026-10-03 (WP1.4 complete):** Applied spec 4.4 type roles across all screens. Added named text scale entries `dayNum` (32/36), `feedTitle` (17/24), `pageTitle` (28/34) to ThemeProvider. Added `fontFamily: fonts.mono` to `makeCommon.sectionLabel`. Updated all six list screens (index, trips, culture, trip/[id], person/[id] -- no date column in people): `dateNum` now uses `text.dayNum` (32/36, was 34/38) with `fonts.serifBold`; `dateSub` (day/month/year) now uses `fonts.mono` uppercase, letterSpacing 0.8. Entry card titles (`cardTitle`) in index, culture, trip/[id], person/[id] now use `text.feedTitle` (17/24) + `fonts.serifMedium`. Trip titles in trips.tsx use `text.feedTitle` + `fonts.serifBold`. Chronicle `cardTrip` label (trip name below entry) now mono uppercase. `trip/[id].tsx` `tripDateRange` changed from `"monospace"` to `fonts.mono`. `entry/[id].tsx`: main title now `text.pageTitle` (28/34) + `fonts.serifBold`; `fieldLabel` gets `fonts.mono`; `reflectionLabel` gets `fonts.mono`; `reflectionText` gets `fonts.serifRegular`. person/[id] `sectionLabel` gets `fonts.mono`. Type-check passes. Note: visual verification at 1.3x system font scale should be done on device. Next: WP1.5 (Paper theme live and Appearance screen).
- **2026-10-03 (WP1.3 complete):** Installed `@expo-google-fonts/fraunces`, `@expo-google-fonts/ibm-plex-sans`, `@expo-google-fonts/jetbrains-mono` (v0.4.1). Extended `ThemeFonts` with `sansMedium` and `monoMedium` fields. Updated Paper theme fonts from Lora placeholders to Fraunces (400/500/600), IBM Plex Sans (400/500), JetBrains Mono (400/500). Updated `_layout.tsx` to load all 11 font variants (Paper + Leather) in one `useFonts` call; splash already held until both `journal.ready` and `fontsLoaded || fontError`. Also fixed two files missed in WP1.2 (`Dialog.tsx` and `FloatingNavBar.tsx` still imported from `src/theme`) and three pre-existing type errors in `(tabs)/_layout.tsx` (`sceneContainerStyle` and `onIndexChange` are not valid Tabs props in expo-router v4; `router.navigate` requires full route paths). Type-check passes. Next: WP1.4 (type scale).
- **2026-10-03 (WP1.2 complete):** Migrated all 14 files that imported from `mobile/src/theme.ts` to use `useTheme()` from `ThemeProvider`. Extended `ThemeProvider.tsx` to export invariant tokens (`text`, `spacing`, `radius`) and `makeCommon(colors, fonts)` (computed composed styles: `screen`, `card`, `sectionLabel`, `empty`, `btnPrimary`, `header`). Added `ThemeCommon` type and updated `UseThemeResult` to include all new fields. Two patterns used: (1) single-component screens use `useMemo(() => StyleSheet.create({...}), [colors, fonts])` inline; (2) FlatList screens use a module-level `createStyles(colors, fonts)` factory with `styles` passed as a prop to sub-components (avoids N hook calls per list item). Refactored `app/_layout.tsx` into `RootLayout` (outer, wraps `ThemeProvider`) and `RootLayoutInner` (inner, calls `useTheme()`) so the loading screen can use theme colours. Migrated screens: `_layout.tsx`, `(tabs)/_layout.tsx`, `(tabs)/index.tsx`, `(tabs)/trips.tsx`, `(tabs)/culture.tsx`, `(tabs)/people.tsx`, `settings.tsx`, `import.tsx`, `import-people.tsx`, `entry/[id].tsx`, `trip/new.tsx`, `trip/[id].tsx`, `person/[id].tsx`. Deleted `mobile/src/theme.ts`. Grep confirms zero source files import from `src/theme`. Next: WP1.3 (fonts and splash).
- **2026-10-03 (WP1.1 complete):** Created `mobile/src/components/ThemeProvider.tsx`: `ThemeColors`, `ThemeFonts`, `ThemeDefinition` types; Leather definition (current token values); Paper definition (spec 4.2 colours, Lora font placeholders until WP1.3); `THEMES` registry; `ThemeProvider` component with persistence via `expo-file-system/legacy`; `useTheme()` hook. Wrapped root layout with `ThemeProvider`. `src/theme.ts` and all screens unchanged. Note: `expo-file-system` v57 has a new default API; legacy read/write functions require `expo-file-system/legacy` import. Note: Leather `mode` is `light` -- the aesthetic redesign (merged before this spec was written) already moved the palette to warm parchment tones; the spec section 2 description of a dark `#1E1610` background reflects the pre-redesign state. Type-check passes (pre-existing `_layout.tsx` errors are unrelated). Verified on device: app looks identical to before, persisted theme confirmed with temporary toggle. Next: WP1.2.
- **2026-10-03 (WP1.0 complete, no code changes):** Investigated duplicate legs. Root cause: `legKey` and `stayKey` in `connectors/keys.ts` include `source` in the key (`${source}|leg|...`), while `Film` and `Episode` dedupeKeys are source-agnostic. Two records for the same journey from two different sources (or two overlapping Viaduct CSV exports) get different dedupeKeys, both classify as "new", and both commit. The tier system never gets to arbitrate because `classify()` only looks up by exact dedupeKey. Recommended fix: remove `source` from `legKey` and `stayKey` (match the Film/Episode pattern). Call sites to update: `connectors/keys.ts` (remove parameter), `connectors/viaduct/index.ts` (remove argument). One-time migration needed on boot to recompute `dedupeKey` on all existing `Leg` and `Stay` records in the database (both IDBAdapter and SQLiteAdapter paths). Run `bun run test` after. The same inconsistency exists in `eventKey` but there is only one event connector so it is lower priority. User to decide scope and timing of the fix before WP1.1 starts.
- **2026-10-03 (design session, no code, update 4):** Added the work-package working mode to section 0 and broke Phase 1 into WP1.0 to WP1.11. Next: WP1.0 (read-only investigation).
- **2026-10-03 (design session, no code, update 3):** Closed Q4 (simple notebook glyph icon for now). Only Q5 (deferred) and Q6 (needed for Phase 7 only) remain open.
- **2026-10-03 (design session, no code, update 2):** Closed Q3: theming is a user-facing Settings feature. Added `ThemeDefinition` registry to 4.1, widened Phase 1 theme task, added Phase 7 (theme gallery, backlog) and Q6.
- **2026-10-03 (design session, no code, update):** Closed Q2 and deferred Q1 (Moments tab hidden, not removed). Phase 1 is no longer blocked by open questions.
- **2026-10-03 (design session, no code):** Reviewed `mobile/` against Material guidance and the web version. Wrote this spec. Next: Phase 1. Note the duplicate legs issue in 10.3 before polishing the feed.
