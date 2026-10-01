# Journal: Backlog & Roadmap

A local-first, privacy-focused personal journal and lifelog. All data remains strictly in browser IndexedDB with zero cloud sync.

---

## Recently completed

- [x] **Shared `rating`, `reflection`, `datePrecision`, `sourceRef` fields** on Base — normalised across all entry types.
- [x] **Film & Episode types** (`film`, `episode`) with `Series` container, rewatch flag, season/episode parsing.
- [x] **Book type** (`book`) with clean title, author, series/seriesNumber.
- [x] **Connector architecture** — registry, tier system, staging hub, dedup by source-agnostic keys.
- [x] **Letterboxd connector** (tier 2) — `diary.csv` and `reviews.csv`; half-star ratings doubled to 0–10; rewatch flag.
- [x] **Netflix connector** (tier 3) — `NetflixViewingHistory.csv`; auto-detects Film vs. Episode from title structure.
- [x] **Goodreads connector** (tier 2) — `goodreads_library_export.csv`; read shelf only; series suffix parsing; date fallback with unknown precision.
- [x] **Setlist.fm connector** (tier 2) — concert history with setlists.
- [x] **Viaduct connector** (tier 2) — flights, trains, road segments.
- [x] **Manual tier 1 overrides** — field-level corrections that survive re-imports.
- [x] **Culture view** — films, TV episodes, books, and concerts in one view; series grouping; filter by kind or rating.
- [x] **Moments view** — gatherings, celebrations, milestones, memories, activities; category filter pills.
- [x] **Star rendering** — `rating` (0–10) displayed as half-stars in EntryCard and list views.
- [x] **Book & Episode in quick-add dialog** — both kinds available in the manual add flow.
- [x] **`dateStarted` UI** — optional reading-start date on Book entries.
- [x] **iCalendar connector** (tier 3) — `.ics` files from Google/Apple/Outlook Calendar; multi-day all-day events → Stays; single-day → JEvents with keyword-inferred categories.
- [x] **Import guide** (`docs/import-guide.md`) — per-source export instructions for all supported connectors.
- [x] **People store** — `Person` records in IndexedDB with `isSelf` flag for journal owner; `participants?: string[]` on Base (undefined = self implicit, `[]` = self explicitly removed).
- [x] **Contacts import** — vCard (`.vcf`) and Google Contacts CSV parser; preview and select before writing.
- [x] **`/people` route** — self setup, people index with entry counts, contacts import section.
- [x] **Participant picker on entry cards** — add/remove participants with typeahead search; create person on the fly; self shown by default.
- [x] **`/people/:id` timeline** — per-person entry timeline with All / Trips / Culture / Moments filter pills; linked from the people index.

---

## 1. Active Priorities (Up Next)

### People — remaining

- [ ] **People filter pills on Chronicle, Culture, and Moments** — a "person" pill that narrows the feed to entries a specific person was part of. Mirrors how category filters work today.
- [ ] **Name resolution on import** — when a connector surfaces companion names, match against existing People by name/alias. Suggestions only; never auto-linked.

### Trip Management

- [ ] **Reads and watches inside trips** — books, films, and episodes that fall within a trip's date window are not currently surfaced in the trip view. Surface them as suggestions alongside transport and stays.

---

## 2. Importers (Remaining)

All importers feed into the Staging Hub for preview, duplicate detection, and tier-based conflict resolution before writing to IndexedDB.

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

- [ ] **Field-level dedup resolution** — the current tier model assigns precedence to a whole entry. Cross-source imports (e.g. Netflix has the accurate watch date; Letterboxd has the rating and review) could benefit from field-level merging. The `reflection` field is already preserved this way in `commitBatch`; generalise the pattern.
- [ ] **`Read Count` from Goodreads** — a count > 1 implies re-reads that aren't individually dated. Currently imported as a single entry; consider surfacing the count as metadata or prompting the user to add re-read entries.
- [ ] **Private Notes from Goodreads** — currently dropped. Consider mapping to a second reflection or a private tag.

---

## 5. Mobile & Packaging (Future)

- [ ] **Capacitor Hybrid Shell** — package the client bundle into an Android APK with native performance and offline-first reliability.
- [ ] **Android System "Share To" Intent** — register the app to accept `.csv`, `.ics`, and `.json` files directly from mobile downloads or email attachments into the Staging Hub.
- [ ] **Persistent Storage Durability** — explore Origin Private File System (OPFS) or a native SQLite plugin via Capacitor to prevent accidental browser cache eviction.

---

## 6. Infrastructure & Developer Experience

- [ ] **Automated Backup Reminders** — local banner reminding users to export a JSON snapshot after significant batch commits.
