# Import Guide

Your journal lives entirely in your browser — no data is sent anywhere. Everything you import is processed immediately and entries are added inline with a review indicator.

## How importing works

1. Open the import panel and drop or select a file.
2. The app detects the source automatically and parses it.
3. Each record is checked against existing entries — new and updated entries are written to your journal and marked **New** or **Updated** so you can review them on the main feed.
4. Duplicate and already-hidden entries are skipped automatically.

### When two sources describe the same thing

No source outranks another. What happens depends on where the matching record comes from:

| Situation | What happens |
|-----------|--------------|
| The same source sends the record again | The entry is refreshed with the source's latest values. Your edits, reflection, trip and people stay. |
| A different source describes the same thing (for example Letterboxd and Netflix both log a film) | The existing entry fills in only the fields it is missing, and the other source is added to its source list. Nothing is overwritten. |
| The same thing appears twice in one file | The rows are merged into one entry that keeps both source references. |
| The records look similar but do not match exactly (a hotel under two names, a film logged a day apart) | Both are kept. The newer one is flagged **Possible duplicate**, and you choose Merge or Not a duplicate. |

You can also merge two entries of the same kind by hand from the entry screen, and undo the merge later. Your manual edits and reflections are always preserved.

---

## Travel — Legs

Legs are individual transport segments: a flight, a train ride, or a road trip.

### Viaduct

[Viaduct](https://viaduct.world) is a free, web-based digital logbook and mapping platform for train enthusiasts and travellers to record, track, and visualise their rail journeys.

**How to export:**
1. Log in to your Viaduct account at [viaduct.world](https://viaduct.world).
2. Go to your logbook and use the export option to download your journey history as a CSV.

**What you get:**
- Rail segments with operator and train number
- Departure and arrival times in local timezones
- Station names used as origin and destination

**Notes:**
- Times are imported as local wall-clock time and stored with IANA timezone data.
- If a station name can't be resolved to a timezone, the time is stored as date-only.

### Manual entry

Use **Add entry → Flight / Train / Road** in the journal.

Fill in From, To, date, and optionally a departure time. The app resolves timezones from the IATA code or city name.

---

## Stays

A stay is a period spent in one place — a hotel, an Airbnb, staying with friends.

### Viaduct

Viaduct is focused on rail journeys — accommodation bookings are not part of its export. Add stays manually or via the iCalendar connector if you have hotel bookings in your calendar.

**What you get:**
- Property name and city
- Check-in and check-out dates

### Manual entry

Use **Add entry → Stay** in the journal.

Fill in the place name, city, and optionally a check-out date.

---

## Events & Concerts

Events cover concerts, gatherings, celebrations, milestones, memories, and activities.

### Setlist.fm

Setlist.fm tracks concerts you've attended. It doesn't offer a native export, but third-party scripts can generate a compatible CSV or JSON from your attended shows page.

**How to export:**
- Search for "setlist.fm export" or "setlistfm attended concerts scraper" — several community tools exist that produce a file compatible with this connector.
- The connector accepts both CSV and JSON formats.

**What you get:**
- Artist name
- Venue and city
- Concert date
- Setlist (song-by-song, where available in the source data)

**Notes:**
- Setlist.fm has no official export API or download. The third-party tools vary in quality. Review new entries in your feed after importing.

### iCalendar (.ics)

Any calendar application can export an iCal file. This is useful for bulk-importing personal events from Google Calendar, Apple Calendar, or Outlook.

**How to export:**

*Google Calendar:* Settings → Import & Export → **Export**. Unzip the download and import the `.ics` file for the calendar you want.

*Apple Calendar:* File → Export → Export. Choose the calendar to export.

*Outlook:* File → Open & Export → Import/Export → Export to a file → iCalendar Format.

**What you get:**
- Timed events and all-day events as journal entries
- Multi-day all-day events (2+ days) automatically classified as **Stays** — useful for hotel bookings, trips, or time away from home
- Booking-site events (a description with a date range such as `(2026.10.12 00:00 - 2026.10.14 00:00)` plus a "Booked for" or "Booking code" line) become **Stays** with the dates from that range, even when the calendar times are odd. Other timed multi-day items stay events
- Single-day events classified by keyword inference (concert, birthday, gathering, etc.)
- Event description imported as a reflection
- Venue and city extracted from the LOCATION field (split on the last comma)
- Timezones from DTSTART TZID parameters preserved

**What is skipped:**
- Recurring events (RRULE) — these produce too many entries. Add significant individual occurrences manually.
- Events without a SUMMARY (title)

**Tips:**
- Export only the calendars that contain personal life events — avoid importing work calendars or use the **New** filter on the main feed to review and hide anything irrelevant after importing.
- Calendar exports typically include noise. Use the **New** filter on the main feed after import and hide entries you don't want to keep.

### Manual entry

Use **Add entry** and choose a category: Concert, Gathering, Celebration, Milestone, Memory, or Activity.

Fill in the title/artist, venue, city, and date. You can also record companions and link the entry to a trip.

### Generic CSV

For custom event data from other sources, you can import a generic CSV. The app attempts to map columns to event fields automatically.

Expected columns (headers are matched flexibly): `date`, `title` or `artist`, `venue`, `city`, `category`.

---

## Films

A film entry records a single viewing — rewatches are separate entries with their own date.

### Letterboxd

Letterboxd is the primary source for film data. It provides clean metadata alongside your ratings and reviews.

**How to export:**
1. Go to [letterboxd.com/settings/data](https://letterboxd.com/settings/data).
2. Click **Export your data** and download the ZIP.
3. Unzip it — you'll find `diary.csv` (films with watch dates) and `reviews.csv` (films with written reviews).

**What you get:**
- Film title and release year
- Watch date
- Your rating (stored on a 0–10 scale; Letterboxd's 0.5–5 stars are doubled)
- Rewatch flag
- Your written review imported as a reflection
- Letterboxd URI as a source reference

**Import either `diary.csv` or `reviews.csv`** — or both. Entries with the same film and date will deduplicate correctly.

### Netflix

Netflix provides a raw viewing history export. It has no ratings or metadata beyond title and date, but it's useful for filling in gaps.

**How to export:**
1. Go to [netflix.com/account](https://netflix.com/account).
2. Under **Profile & Parental Controls**, select your profile.
3. Scroll to **Viewing activity → Download all**.
4. Download `NetflixViewingHistory.csv`.

**What you get:**
- Title and watch date
- Film vs. episode detected automatically from the title format

**Notes:**
- Netflix titles use the format `Show: Season N: Episode` for TV — these are parsed into Episode entries automatically.
- Two-part titles like `Show: Something` that don't match the season pattern are treated as Films.
- No ratings, directors, or metadata — a Letterboxd import for the same film adds its details to the entry.

### Manual entry

Films can't yet be added through the quick-add dialog. Use Letterboxd import, or add via a single-row generic CSV import.

---

## TV Episodes

An episode entry records a single episode viewing. Episodes are grouped under a series.

### Netflix

Same export file as for Films — `NetflixViewingHistory.csv`. Episodes and films are parsed from the same file automatically.

**Title parsing rules (applied in order):**

| Title format | Result |
|---|---|
| `Show: Season N: Episode title` | Episode |
| `Show: Limited Series: Episode title` | Episode (season = "Limited Series") |
| `Show: Part N: Episode title` | Episode |
| `Show: 2024: Episode title` | Episode (year as season label) |
| `Show: Anything else` | Film (not enough info to confirm episode) |

**What you get:**
- Show title and season label
- Episode title
- Watch date

**Notes:**
- No episode numbers from Netflix — the title is parsed but numbering within a season isn't available.
- A Letterboxd import for the same film fills in the missing details on the Netflix entry; episode entries have no other source currently.

### Manual entry

Use **Add entry → Episode** in the journal. Fill in show title, season, episode number, episode title, and watch date.

---

## Books

A book entry records a completed read. The read date is the anchor — "when this happened" — not the start date.

### Goodreads

Goodreads is the primary source for book data.

**How to export:**
1. Go to [goodreads.com/review/import](https://www.goodreads.com/review/import).
2. Click **Export Library**.
3. Download `goodreads_library_export.csv`.

**What you get:**
- Title (series suffix like `(Bridgertons, #6)` is stripped into structured `series` and `seriesNumber` fields)
- Author
- Original publication year
- Your rating (stored on a 0–10 scale; Goodreads 1–5 stars are doubled)
- Your review imported as a reflection
- Series name and position (including decimals like 7.5 for novellas)

**Filtering:**
- Only books on your **read** shelf are imported. Books marked `to-read` or `currently-reading` are skipped.

**Books without a read date:**
- If Goodreads has no Date Read for a book (common for older imports), the Date Added is used as a fallback. The entry is flagged with `datePrecision: unknown` so you know the date is approximate.

**Notes:**
- ISBN data is cleaned of an Excel formatting artifact (`="..."` wrapping) automatically.
- Ratings of 0 (unrated in Goodreads) are imported without a rating rather than as a zero.
- If a book has an ISBN-13, it is used to look up a cover image from Open Library. Books without an ISBN fall back to a title + author search. No personal data is sent — only the ISBN or title/author string.

### Manual entry

Use **Add entry → Book** in the journal. Fill in title, author, year, series details, rating, and read date. An optional "started reading" date can also be recorded.

---

## Tips

**Import order doesn't matter.** You can import Netflix first and Letterboxd later: the second source fills in what the first lacked and both are kept as sources of the entry.

**Your reflections are never overwritten.** If you've written a reflection on an entry, no import changes it.

**Re-importing is safe.** Importing the same file twice will skip all entries as duplicates — nothing will be added unless you have since hidden entries from your journal.

**Manual corrections always win.** Any field you've edited manually (via the corrections panel on an entry card) is stored as an override and will survive future re-imports of the same source.

---

## Enrichment layer

After import, the journal can fetch supplemental data that is not part of any connector export. This data is stored in a **separate database** and is never included in your JSON backup — if you restore a backup or import on a new device, enrichment simply re-runs automatically.

### Film and episode posters (TMDB)

When a TMDB API key is configured, the journal automatically fetches poster images for film and episode entries and caches them locally. Posters appear on the entry detail page (mobile) and in the expanded entry card (web). The toggle to enable or disable fetching is in Settings (mobile) and the Backup page (web).

Posters are an enrichment layer: they are not part of your journal data, are not exported, and re-enriching from scratch after a restore is lossless.

**Next enrichment source planned:** book cover images via Goodreads, reusing the same `ArtworkStorage` and `ArtworkProvider` architecture.
