# Trip Functionality: Web vs Mobile Parity Analysis

_Generated 2026-10-04 — basis for mobile work packages_

---

## Feature-by-Feature Comparison

| Capability | Web | Mobile | Gap |
|---|---|---|---|
| **Trips list** — title, dates, nights | ✅ | ✅ | — |
| **Trips list** — entry type breakdown (flights/trains/stays/events) | ✅ | ❌ Only total count | Mobile missing |
| **Trips list** — purpose badge/icon | ✅ Badge | ✅ KindIcon | Equivalent |
| **Trips list** — cover image | ❌ Not implemented | ❌ Not implemented | Both missing |
| **Trip creation** — title, start/end, purpose, notes | ✅ | ✅ | — |
| **Trip creation** — native date picker | ✅ `<input type="date">` | ❌ Raw text input | Mobile degraded |
| **Trip detail** — dedicated screen | ❌ Expands inline | ✅ Full-screen route | Web lacking |
| **Trip detail** — entries grouped by day | ❌ Flat list | ✅ Grouped by day | Web lacking |
| **Trip detail** — suggested entries with per-entry add | ❌ Count + bulk only | ✅ Per-day grouped, per-entry add | Web lacking |
| **Trip editing** — title, dates, purpose, notes | ✅ Edit dialog | ❌ Not implemented | Mobile missing |
| **Delete / dissolve trip** | ✅ With confirmation | ❌ Not implemented | Mobile missing |
| **Remove entry from trip** | ✅ Per-entry link | ❌ Not implemented | Mobile missing |
| **Manually attach arbitrary entry to trip** | ✅ Dropdown of all unassigned | ❌ Date-window suggestions only | Mobile missing |
| **Sorting** (newest-first) | ✅ | ✅ | — |
| **Filtering / search** | ❌ | ❌ | Both missing |
| **Suggestions count on list view** | Partial (shows on gather button when expanded) | ❌ Not surfaced | Both weak |
| **Cover image UI** | ❌ Field exists, no UI | ❌ Field exists, no UI | Both missing |
| **Notes editing post-creation** | ✅ Via Edit dialog | ❌ Set-once at creation | Mobile missing |
| **Purpose editing post-creation** | ✅ Via Edit dialog | ❌ Set-once at creation | Mobile missing |

---

## Summary

**Mobile ahead of web:**
- Dedicated full-screen trip detail route with better structure
- Per-day chronological grouping of linked entries in detail view
- Rich suggestions section with day grouping, kind icons, and per-entry add buttons
- Two-column date/card layout consistent with journal aesthetic

**Web ahead of mobile (gaps to close):**
- Trip editing (all fields)
- Trip deletion / dissolve
- Remove an entry from a trip
- Manually attach any unassigned entry (not just in-window suggestions)
- Per-type entry breakdown on list cards (flights/trains/stays/events)
- Native date picker instead of free-text input

**Neither platform has:**
- Cover image UI (field exists in data model)
- Trip list filtering or search
- Map or timeline visualization

---

## Proposed Work Packages

Work packages are sized for the mobile app. Each builds on previous work; they are listed in suggested priority order.

---

### WP-T1 — Trip Edit Screen

**Goal:** Allow editing all trip fields after creation.

The web `AddTripDialog` already handles edit mode — mobile needs the equivalent. The natural mobile pattern is a separate `/trip/edit/[id]` route (mirrors `trip/new.tsx`) rather than a modal, though a modal sheet is also workable.

**Scope:**
- New route `mobile/app/trip/edit/[id].tsx` (or modal inside `[id].tsx`)
- Pre-populate title, start, end, purpose, notes from existing trip
- Reuse the chip-row purpose picker and multiline notes input from `new.tsx`
- Add an edit button (pencil icon) to the trip detail header
- On save, `putMany("trips", [updated])` — same as web
- Validate end ≥ start

**Effort estimate:** Small — `new.tsx` is almost the full implementation; lift, modify for edit mode, wire up nav.

---

### WP-T2 — Native Date Picker in Trip Forms

**Goal:** Replace free-text YYYY-MM-DD inputs with a proper date picker.

**Scope:**
- Swap the `TextInput` date fields in `new.tsx` (and `edit/[id].tsx` from WP-T1) for `@react-native-community/datetimepicker` or the equivalent Expo-compatible approach
- Display the selected date in a human-readable format; store `YYYY-MM-DD` in the model as before
- Should work on both iOS and Android

**Effort estimate:** Small-Medium — primarily a component swap with some UX polish needed.

---

### WP-T3 — Dissolve / Delete Trip

**Goal:** Allow deleting a trip from mobile (mirroring web's "Dissolve trip").

**Scope:**
- Add a delete action to the trip detail screen — a trash icon in the nav bar header, behind a confirmation `Dialog` (using the existing `useDialog()` hook)
- Behaviour: remove trip from the `trips` store, set `tripId: undefined` on all linked entries — same logic as web
- After deletion, navigate back to the trips list

**Effort estimate:** Very small — one button, one dialog, two store writes.

---

### WP-T4 — Remove Entry from Trip

**Goal:** Allow unlinking individual entries from a trip on mobile.

**Scope:**
- Add a "Remove from trip" action to each `EntryRow` in the trip detail linked-entries list
- Could be a swipe-to-reveal action (right-to-left swipe) or a long-press context menu; a swipe gesture matches common mobile patterns
- Write: set `tripId: undefined` on the entry
- Should not remove the entry from the journal — same behaviour as web

**Effort estimate:** Small-Medium — depends on whether swipe-to-reveal exists elsewhere in the app or needs to be built fresh.

---

### WP-T5 — Manual Entry Attach (Outside Date Window)

**Goal:** Allow attaching any unassigned entry to a trip, not just those within the date range.

The current suggestions logic only surfaces entries where `start >= trip.start && start <= trip.end`. For entries slightly outside the window (a late-night arrival after midnight, a pre-trip activity), there is no way to attach them on mobile.

**Scope:**
- Add an "Attach entry…" button to the trip detail screen (e.g., in the header card below the stats)
- Opens a searchable bottom sheet or modal listing all unassigned entries, sorted by date
- Selecting an entry sets `tripId` on it and dismisses the sheet
- This mirrors web's manual-attach dropdown, but with search/filter given the potentially large entry set

**Effort estimate:** Medium — requires a bottom sheet with a searchable list; reusable component investment.

---

### WP-T6 — Per-Type Entry Breakdown on Trip List Cards

**Goal:** Show flights / trains / stays / events counts on each card in the trips list, matching web.

**Scope:**
- In `(tabs)/trips.tsx`, derive per-kind counts from `allEntries(journal)` filtered to each trip's id
- Render a compact stat row in the trip card: e.g. `✈ 3  🚂 1  🏨 4  🎵 2` using KindIcons and mono numbers
- Show only non-zero counts; hide the row if a trip has only one entry type to avoid clutter

**Effort estimate:** Small — pure UI addition, data is already available.

---

### WP-T7 — Pending Suggestions Count on List View

**Goal:** Surface a "N unattached entries" hint on trip list cards so users know a trip needs attention without opening it.

**Scope:**
- For each trip, count entries where `start` falls within the date window and `tripId` is undefined
- If count > 0, show a subtle badge or secondary text on the list card: e.g. `3 suggested` in a muted accent
- This parallels the parenthetical count on web's "Gather" button

**Effort estimate:** Very small — one derived value per trip, minimal UI change.

---

## Recommended Delivery Order

```
WP-T1  Trip Edit Screen          ← highest user value; unblocks post-creation corrections
WP-T3  Delete Trip               ← pairs naturally with WP-T1 (destroy vs modify)
WP-T4  Remove Entry from Trip    ← completes the entry management triad
WP-T2  Native Date Picker        ← UX polish; can be done alongside any other WP
WP-T6  Per-Type Breakdown        ← quick win for list view richness
WP-T7  Suggestions Count Badge   ← quick win
WP-T5  Manual Attach             ← most complex; lower urgency given suggestions already work
```

Cover image UI and trip filtering/search are excluded from this plan — both are absent on web too, so they belong in a separate cross-platform feature initiative.
