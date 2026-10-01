# Journal: Backlog & Roadmap

A local-first, privacy-focused personal journal and lifelog. All data remains strictly in browser IndexedDB with zero cloud sync.

---

## 0. Data Model Decisions (apply to all categories)

Agreed design decisions that cut across event types. Build these before or alongside the Books, Films and importer work so they are not retrofitted per category.

- [ ] **Shared `rating` field on every event type.** Single optional number, normalised to 0-10 internally and displayed as stars (value / 2). Blank means unrated, never a default. The original value and scale from the source are kept in the provenance record (for example "4 of 5", "8.6 of 10"). One decimal place allowed.
- [ ] **Shared `reflection` field on every event type.** Free text, generalising the existing Manual Overrides & Notes idea beyond days and trips. Imported reviews (Goodreads, Letterboxd) land here with a provenance marker. If edited in the app, the edit becomes the current text and the imported original is kept as the source version, so a re-import never overwrites it (same principle as Tier 1 manual overrides).
- [ ] **Date precision flag** (day, month, year, unknown) on every entry. UTC, local time and timezone only where a real time exists. Needed for date-only sources such as Goodreads and Letterboxd.
- [ ] **Provenance on every imported fact** (source name plus original row reference), consistent with the existing parsed-source-record retention.
- [ ] **Participants:** names found in source data are offered as suggestions to add, never pre-seeded. Lightweight add/edit of people on any entry.

---

## 1. Active Priorities (Up Next)

### Trip Management (Phase 1)
- [x] **Manual Trip Creation:** Dedicated "+ New Trip" modal on `/trips` (title, start/end dates, destinations, purpose tag).
- [x] **Entry Assignment & Detachment:** Dropdown/dialog to add existing flights, stays, concerts, or memories to a trip, or remove an item without dissolving the whole trip.
- [x] **Smart Date Gathering:** One-click button on a trip card to detect and associate unassigned entries falling within that trip's date window. Reads and watches (books, films) that fall inside the window are surfaced as suggestions, never assigned automatically.
- [x] **Trip Selector on Manual Entries:** Add trip picker directly into the "+ Add Entry" dialog.

---

## 2. New Categories & Culture Logging

Rating and reflection use the shared fields from section 0, not category-specific ones.

- [ ] **Books (`book` category):**
  * Data model: a Book record (title, author, ISBN, page count) plus Read events that point at it. A re-read is simply another Read event on the same Book.
  * Completion date as the event date, at day precision (see date precision flag).
  * UI: Book icon, star badge rendering, filter pill on Chronicle and Events views.
- [ ] **Films (`film` category):**
  * Data model: a Film record (director, year) plus Watch events that point at it. A rewatch is another Watch event.
  * UI: Film/clapperboard icon, star badge rendering, filter pill.

---

## 3. Importers & Parsers (File-Drop via Staging Hub)

All importers feed into the Staging Hub for preview, duplicate detection, and tier-based conflict resolution before writing to IndexedDB.

- [ ] **iCalendar (`.ics`):** Universal calendar format. Automatically parses events and detects multi-day reservations (hotels/Airbnb) as Stays vs. single-day moments as Events.
- [ ] **Goodreads (`goodreads_library_export.csv`):**
  * Import only the `read` shelf as events. To-read is possibilities, not what happened, so it is ignored. Currently-reading is a state, not an event.
  * Date Read is the event date at day precision. If blank, import with unknown precision instead of dropping the row. Date Added is a low-confidence fallback only and must be flagged as such.
  * My Rating of 0 means unrated: map to blank. Ratings 1 to 5 map to 2, 4, 6, 8, 10.
  * My Review goes to reflection. Private Notes go to a second reflection or a tag.
  * Read Count indicates how many Read events to expect for a book.
  * Dedup key: Book Id plus date read, so importing a fresh export never duplicates events.
  * ISBN lookups for covers and page counts are acceptable (non-personal reference data); keep the privacy policy on place names in mind for anything else.
  * Verify the column names against a real export before building the parser.
- [ ] **Letterboxd (`diary.csv`):**
  * Ingests logged movies, release years, watch dates and ratings. Half-star ratings (0.5 to 5) map onto the 0-10 scale by doubling.
  * Verify which export file holds review text. Believed to be `reviews.csv` rather than `diary.csv`; confirm against a real export.
  * Rewatch flag maps to additional Watch events on the same Film.
- [ ] **Resident Advisor / Songkick:** Club nights, DJ sets, and concert tickets.
- [ ] **Foursquare / Swarm:** Restaurant, cafe, and cultural venue check-ins with companion mentions.
- [ ] **Strava / GPX (Selective):** Major hikes and cycling routes without everyday workout clutter.
- [ ] **Booking.com reviews (if available in an export):** review scores are 10-point and map straight onto the shared rating for Stays.

---

## 4. Direct Local Integrations (Zero-Cloud Sync)

Direct browser-to-service connections without any intermediary backend server. All tokens and credentials remain strictly on-device in browser storage.

- [ ] **Architecture & Staging Policy:**
  * Client-side credentials (user API keys or OAuth tokens) stored in IndexedDB/localStorage.
  * "Check for updates" / "Pull latest" actions deposit records into the **Staging Hub** rather than auto-committing, preserving intentional curation.
- [ ] **Webcal / Private iCal Feeds:** Periodic client-side fetch of private calendar subscription links (e.g. Google Calendar secret iCal URL).
- [ ] **setlist.fm API:** Direct username lookup to pull attended concerts and full song setlists automatically.
- [ ] **Strava OAuth (PKCE flow):** Pure browser-based authentication to fetch milestone outdoor journeys.

---

## 5. Mobile & Packaging (Future Exploration)

- [ ] **Capacitor Hybrid Shell:** Package the client bundle into an Android APK with native performance and offline-first reliability.
- [ ] **Android System "Share To" Intent:** Register the app to accept `.csv`, `.ics`, and `.json` files directly from mobile downloads or email attachments into the Staging Hub.
- [ ] **Persistent Storage Durability:** Explore Origin Private File System (OPFS) or a native SQLite plugin via Capacitor to prevent accidental browser cache eviction.

---

## 6. Infrastructure & Developer Experience

- [ ] **GitHub Two-Way Sync:** Connect repository to GitHub for smooth local collaboration with Git and Claude Code.
- [ ] **Automated Backup Reminders:** Local banner reminding users to export a JSON snapshot after significant batch commits.
