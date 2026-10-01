# Journal: Backlog & Roadmap

A local-first, privacy-focused personal journal and lifelog. All data remains strictly in browser IndexedDB with zero cloud sync.

---

## Recently completed

- [x] **Shared `rating`, `reflection`, `datePrecision`, `sourceRef` fields** on Base — normalised across all entry types.
- [x] **Film & Episode types** (`film`, `episode`) with `Show`→`Series` container, rewatch flag, season/episode parsing.
- [x] **Book type** (`book`) with clean title, author, series/seriesNumber, `dateStarted` for future span tracking.
- [x] **Connector architecture** — registry, tier system, staging hub, dedup by source-agnostic keys.
- [x] **Letterboxd connector** (tier 2) — `diary.csv` and `reviews.csv`; half-star ratings doubled to 0–10; rewatch flag.
- [x] **Netflix connector** (tier 3) — `NetflixViewingHistory.csv`; auto-detects Film vs. Episode from title structure.
- [x] **Goodreads connector** (tier 2) — `goodreads_library_export.csv`; read shelf only; series suffix parsing; date fallback with unknown precision.
- [x] **Setlist.fm connector** (tier 2) — concert history with setlists.
- [x] **Viaduct connector** (tier 2) — flights, trains, road segments, stays.
- [x] **Manual tier 1 overrides** — field-level corrections that survive re-imports.
- [x] **AGENTS.md guardrails** — protects connector architecture from AI co-author regressions.
- [x] **Import guide** (`docs/import-guide.md`) — per-source instructions for all supported connectors.

---

## 1. Active Priorities (Up Next)

### Books & Films UI

The data model and connectors are in place; the views haven't been built yet.

- [ ] **Books view** — filtered journal view or dedicated tab showing read books. Sortable by date read, author, rating. Series grouping (all entries in a series together with progress indicator).
- [ ] **Films/Episodes view** — filtered view for watched films and TV episodes. Group episodes by show, sort by watch date or rating.
- [ ] **Series browser** — list of series (book and TV) with read/watched count vs. total, so you can see where you are in a series at a glance.
- [ ] **Book & Episode in quick-add dialog** — Books and Episodes can currently only be added via file import. Add manual entry paths for both.
- [ ] **Star rendering** — display `rating` (0–10) as stars (value ÷ 2) in EntryCard and list views. Half-star display where the value has a decimal.
- [ ] **`dateStarted` UI** — expose the optional reading start date on Book entries so spans can be tracked.

### People

A `companions` string array already exists on every entry type but is purely free-text with no lookup, dedup, or person-centric view.

- [ ] **People store** — a `Person` record in IndexedDB (id, name, aliases, notes). Not a contact book; just enough to link entries to the same individual across imports and manual adds.
- [ ] **Name resolution on import** — when a connector surfaces companion names (e.g. Foursquare, future sources), match against existing People by name/alias rather than creating duplicate strings. Suggestions only; never auto-linked.
- [ ] **Companion picker in entry UI** — replace the free-text companions input with a typeahead that resolves against the People store and falls back to creating a new person on the fly.
- [ ] **Person view** — all entries associated with a person in a single timeline: trips travelled together, concerts attended, meals shared. Accessible from any entry card that lists them.
- [ ] **People index** — a browsable list of people with a count of shared events and the most recent one. Entry point to individual person views.
- [ ] **Privacy note** — people data is stored only in browser IndexedDB alongside all other journal data. No names or associations leave the device.

### Trip Management
- [x] **Manual Trip Creation**
- [x] **Entry Assignment & Detachment**
- [x] **Smart Date Gathering**
- [x] **Trip Selector on Manual Entries**
- [ ] **Reads and watches inside trips** — books, films, and episodes that fall within a trip's date window are currently not surfaced in the trip view. Surface them as suggestions alongside transport and stays.

---

## 2. Importers (Remaining)

All importers feed into the Staging Hub for preview, duplicate detection, and tier-based conflict resolution before writing to IndexedDB.

- [ ] **iCalendar (`.ics`)** — universal calendar format. Parse events; detect multi-day reservations (hotels/Airbnb) as Stays vs. single-day moments as Events.
- [ ] **Resident Advisor / Songkick** — club nights, DJ sets, and concert tickets as alternatives to Setlist.fm.
- [ ] **Foursquare / Swarm** — restaurant, café, and cultural venue check-ins with companion mentions.
- [ ] **Strava / GPX (selective)** — major hikes and cycling routes without everyday workout clutter.
- [ ] **Booking.com reviews** — if available in an export; review scores are 10-point and map directly to the shared rating for Stays.

---

## 3. Direct Local Integrations (Zero-Cloud Sync)

Direct browser-to-service connections. All tokens and credentials stay on-device in browser storage.

- [ ] **Architecture & Staging Policy** — client-side credentials in IndexedDB/localStorage; "pull latest" deposits into Staging rather than auto-committing.
- [ ] **Webcal / Private iCal feeds** — periodic client-side fetch of private calendar subscription links (e.g. Google Calendar secret iCal URL).
- [ ] **setlist.fm API** — direct username lookup to pull attended concerts and full setlists automatically, replacing the manual CSV export.
- [ ] **Strava OAuth (PKCE flow)** — pure browser-based auth to fetch milestone outdoor journeys.

---

## 4. Data Model (Outstanding)

- [ ] **Field-level dedup resolution** — the current tier model assigns precedence to a whole entry. Cross-source imports (e.g. Netflix has the accurate watch date; Letterboxd has the rating and review) could benefit from field-level merging: take the non-null value for each field from the higher-quality source. The `reflection` field is already preserved this way in `commitBatch`; generalise the pattern. Accepted limitation for now: Letterboxd (tier 2) supersedes Netflix (tier 3) wholesale.
- [ ] **`Read Count` from Goodreads** — Goodreads exports a `Read Count` column. A count > 1 implies re-reads that aren't individually dated. Currently imported as a single entry; consider surfacing the count as metadata or prompting the user to add re-read entries.
- [ ] **Private Notes from Goodreads** — currently dropped. Consider mapping to a second reflection or a private tag.

---

## 5. Mobile & Packaging (Future)

- [ ] **Capacitor Hybrid Shell** — package the client bundle into an Android APK with native performance and offline-first reliability.
- [ ] **Android System "Share To" Intent** — register the app to accept `.csv`, `.ics`, and `.json` files directly from mobile downloads or email attachments into the Staging Hub.
- [ ] **Persistent Storage Durability** — explore Origin Private File System (OPFS) or a native SQLite plugin via Capacitor to prevent accidental browser cache eviction.

---

## 6. Infrastructure & Developer Experience

- [ ] **Automated Backup Reminders** — local banner reminding users to export a JSON snapshot after significant batch commits.
- [ ] **GitHub Two-Way Sync** — smoother local collaboration with Git and the Lovable AI editor.
