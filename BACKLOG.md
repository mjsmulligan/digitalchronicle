# Journal — Backlog & Roadmap

A local-first, privacy-focused personal journal and lifelog. All data remains strictly in browser IndexedDB with zero cloud sync.

---

## 1. Active Priorities (Up Next)

### Trip Management (Phase 1)
- [ ] **Manual Trip Creation:** Dedicated "+ New Trip" modal on `/trips` (title, start/end dates, destinations, purpose tag).
- [ ] **Entry Assignment & Detachment:** Dropdown/dialog to add existing flights, stays, concerts, or memories to a trip, or remove an item without dissolving the whole trip.
- [ ] **Smart Date Gathering:** One-click button on a trip card to detect and associate unassigned entries falling within that trip's date window.
- [ ] **Trip Selector on Manual Entries:** Add trip picker directly into the "+ Add Entry" dialog.

---

## 2. New Categories & Culture Logging

- [ ] **Books (`book` category):**
  - Data model: Author, rating (1–5 stars), completion date, personal review.
  - UI: Book icon, star badge rendering, filter pill on Chronicle and Events views.
- [ ] **Films (`film` category):**
  - Data model: Director/year, rating (1–5 stars), watch date, diary/review reflection.
  - UI: Film/clapperboard icon, star badge rendering, filter pill.

---

## 3. Importers & Parsers (File-Drop via Staging Hub)

All importers feed into the Staging Hub for preview, duplicate detection, and tier-based conflict resolution before writing to IndexedDB.

- [ ] **iCalendar (`.ics`):** Universal calendar format. Automatically parses events and detects multi-day reservations (hotels/Airbnb) as Stays vs. single-day moments as Events.
- [ ] **Goodreads (`goodreads_library_export.csv`):** Ingests read books, read dates, 1–5 star ratings, and personal reviews.
- [ ] **Letterboxd (`diary.csv`):** Ingests logged movies, release years, watch dates, ratings, and reviews.
- [ ] **Resident Advisor / Songkick:** Club nights, DJ sets, and concert tickets.
- [ ] **Foursquare / Swarm:** Restaurant, cafe, and cultural venue check-ins with companion mentions.
- [ ] **Strava / GPX (Selective):** Major hikes and cycling routes without everyday workout clutter.

---

## 4. Direct Local Integrations (Zero-Cloud Sync)

Direct browser-to-service connections without any intermediary backend server. All tokens and credentials remain strictly on-device in browser storage.

- [ ] **Architecture & Staging Policy:**
  - Client-side credentials (user API keys or OAuth tokens) stored in IndexedDB/localStorage.
  - "Check for updates" / "Pull latest" actions deposit records into the **Staging Hub** rather than auto-committing, preserving intentional curation.
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
