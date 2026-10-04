# Trip Functionality: Web vs Mobile Parity Analysis

_Generated 2026-10-04 — completed 2026-10-04_

---

## Feature-by-Feature Comparison

| Capability | Web | Mobile | Status |
|---|---|---|---|
| **Trips list** — title, dates, nights | ✅ | ✅ | — |
| **Trips list** — entry type breakdown (flights/trains/stays/events) | ✅ | ✅ | ✅ WP-T6 |
| **Trips list** — purpose badge/icon | ✅ Badge | ✅ KindIcon | Equivalent |
| **Trips list** — cover image | ❌ Not implemented | ❌ Not implemented | Both missing |
| **Trips list** — suggested count badge | Partial | ✅ | ✅ WP-T7 |
| **Trip creation** — title, start/end, purpose, notes | ✅ | ✅ | — |
| **Trip creation** — native date picker | ✅ `<input type="date">` | ✅ Native picker | ✅ WP-T2 |
| **Trip creation** — new trip from empty state | ✅ | ✅ | ✅ WP-T1 fix |
| **Trip detail** — dedicated screen | ❌ Expands inline | ✅ Full-screen route | Web lacking |
| **Trip detail** — entries grouped by day | ❌ Flat list | ✅ Grouped by day | Web lacking |
| **Trip detail** — entry type breakdown + suggested count | ❌ | ✅ | ✅ WP-T6/T7 |
| **Trip detail** — suggested entries with per-entry add | ❌ Count + bulk only | ✅ Per-day grouped, per-entry add | Web lacking |
| **Trip editing** — title, dates, purpose, notes | ✅ Edit dialog | ✅ Edit screen | ✅ WP-T1 |
| **Delete / dissolve trip** | ✅ With confirmation | ✅ With confirmation | ✅ WP-T3 |
| **Remove entry from trip** | ✅ Per-entry link | ✅ Long-press to unlink | ✅ WP-T4 |
| **Manually attach arbitrary entry to trip** | ✅ Dropdown of all unassigned | ❌ Date-window suggestions only | Deferred — WP-T5 |
| **Sorting** (newest-first) | ✅ | ✅ | — |
| **Filtering / search** | ❌ | ❌ | Both missing |
| **Cover image UI** | ❌ Field exists, no UI | ❌ Field exists, no UI | Both missing |
| **Notes editing post-creation** | ✅ Via Edit dialog | ✅ Via Edit screen | ✅ WP-T1 |
| **Purpose editing post-creation** | ✅ Via Edit dialog | ✅ Via Edit screen | ✅ WP-T1 |

---

## Summary

**Mobile ahead of web:**
- Dedicated full-screen trip detail route with better structure
- Per-day chronological grouping of linked entries in detail view
- Rich suggestions section with day grouping, kind icons, and per-entry add buttons
- Two-column date/card layout consistent with journal aesthetic

**Remaining gaps (neither platform / deferred):**
- WP-T5: Manually attach an entry outside the trip date window — mobile only surfaces in-window suggestions; web has a dropdown of all unassigned entries. Deferred — medium complexity.
- Cover image UI — field exists in data model on both platforms, no UI on either
- Trip list filtering / search — neither platform has this
- Map or timeline visualization — neither platform has this

---

## Work Package Delivery Log

| ID | Title | Status | Branch |
|---|---|---|---|
| WP-T1 | Trip Edit Screen + empty state fix | ✅ Done | `feat/trip-edit-screen` |
| WP-T2 | Native Date Picker | ✅ Done | `feat/native-date-picker` |
| WP-T3 | Dissolve / Delete Trip | ✅ Done | `feat/dissolve-trip` |
| WP-T4 | Remove Entry from Trip (long-press) | ✅ Done | `feat/remove-entry-from-trip` |
| WP-T5 | Manual Entry Attach (outside date window) | ⏸ Deferred | — |
| WP-T6 | Per-Type Entry Breakdown (list + detail) | ✅ Done | `feat/trip-entry-stats` |
| WP-T7 | Suggestions Count Badge (list + detail) | ✅ Done | `feat/trip-entry-stats` |

### Key implementation notes
- `mobile/app/trip/edit/[id].tsx` — new edit screen; adapted from `new.tsx`; pencil icon in trip detail header navigates here
- `mobile/src/components/DateField.tsx` — reusable date picker component; iOS: bottom-sheet modal with spinner; Android: native dialog via `onValueChange`/`onDismiss`
- `@react-native-community/datetimepicker` added to `mobile/package.json` and registered as plugin in `app.config.js`; install requires `--legacy-peer-deps` due to monorepo `@types/react` version conflict
- Dissolve trip: `removeMany("trips", [id])` + `putMany` all linked entries with `tripId: undefined`, grouped by store
- Long-press to remove: optional `onLongPress` added to `EntryRow`; threaded through `EntryDayGroup` via `onRemove` prop
- Stat breakdown derived from `entries` filtered by `kind`/`mode`; computed in both `trips.tsx` (list) and `[id].tsx` (detail header)
