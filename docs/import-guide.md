# Import Guide

Your journal lives entirely in your browser — no data is sent anywhere. Everything you import goes through a **staging review** where you can see exactly what will be added before committing it.

## How importing works

1. Open the import panel and drop or select a file.
2. The app detects the source automatically and parses it into a preview list.
3. Each record is checked against existing entries and marked as **New**, **Duplicate**, or **Supersedes** (a better-quality version of something already in your journal).
4. Review, deselect anything you don't want, then **Commit** to save.

### Source tiers

When two sources describe the same event, the higher-tier source always wins:

| Tier | Meaning | Examples |
|------|---------|---------|
| 1 | Your own manual edit — sovereign | Any entry you type directly |
| 2 | Primary curated record | Letterboxd, Goodreads, Setlist.fm, Viaduct |
| 3 | Automated secondary record | Netflix viewing history, iCalendar exports |

A tier 2 import of a film you already imported from Netflix will supersede the Netflix record. Your manual edits and reflections are always preserved regardless of tier.

---

## Travel — Legs

Legs are individual transport segments: a flight, a train ride, or a road trip.

### Viaduct (tier 2)

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

### Manual entry (tier 1)

Use **Add entry → Flight / Train / Road** in the journal.

Fill in From, To, date, and optionally a departure time. The app resolves timezones from the IATA code or city name.

---

## Stays

A stay is a period spent in one place — a hotel, an Airbnb, staying with friends.

### Viaduct (tier 2)

Viaduct is focused on rail journeys — accommodation bookings are not part of its export. Add stays manually or via the iCalendar connector if you have hotel bookings in your calendar.

**What you get:**
- Property name and city
- Check-in and check-out dates

### Manual entry (tier 1)

Use **Add entry → Stay** in the journal.

Fill in the place name, city, and optionally a check-out date.

---

## Events & Concerts

Events cover concerts, gatherings, celebrations, milestones, memories, and activities.

### Setlist.fm (tier 2)

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
- Setlist.fm has no official export API or download. The third-party tools vary in quality — check the staging preview carefully before committing.

### iCalendar (.ics) (tier 3)

Any calendar application can export an iCal file. This is useful for bulk-importing personal events from Google Calendar, Apple Calendar, or Outlook.

**How to export:**

*Google Calendar:* Settings → Import & Export → **Export**. Unzip the download and import the `.ics` file for the calendar you want.

*Apple Calendar:* File → Export → Export. Choose the calendar to export.

*Outlook:* File → Open & Export → Import/Export → Export to a file → iCalendar Format.

**What you get:**
- Timed events and all-day events as journal entries
- Multi-day all-day events (2+ days) automatically classified as **Stays** — useful for hotel bookings, trips, or time away from home
- Single-day events classified by keyword inference (concert, birthday, gathering, etc.)
- Event description imported as a reflection
- Venue and city extracted from the LOCATION field (split on the last comma)
- Timezones from DTSTART TZID parameters preserved

**What is skipped:**
- Recurring events (RRULE) — these produce too many entries. Add significant individual occurrences manually.
- Events without a SUMMARY (title)

**Tips:**
- Export only the calendars that contain personal life events — avoid importing work calendars unless you want to review and deselect meetings in staging.
- The staging review is your friend here: calendar exports typically include a lot of noise. Use **Select importable** to highlight only new entries, then deselect anything irrelevant before committing.

### Manual entry (tier 1)

Use **Add entry** and choose a category: Concert, Gathering, Celebration, Milestone, Memory, or Activity.

Fill in the title/artist, venue, city, and date. You can also record companions and link the entry to a trip.

### Generic CSV (tier 3)

For custom event data from other sources, you can import a generic CSV. The app attempts to map columns to event fields automatically.

Expected columns (headers are matched flexibly): `date`, `title` or `artist`, `venue`, `city`, `category`.

---

## Films

A film entry records a single viewing — rewatches are separate entries with their own date.

### Letterboxd (tier 2)

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

### Netflix (tier 3)

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
- No ratings, directors, or metadata — Letterboxd imports for the same film will supersede these entries.

### Manual entry (tier 1)

Films can't yet be added through the quick-add dialog. Use Letterboxd import, or add via staging with a single-row generic CSV.

---

## TV Episodes

An episode entry records a single episode viewing. Episodes are grouped under a series.

### Netflix (tier 3)

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
- A Letterboxd import for the same film will supersede a Netflix film entry; episode entries from Netflix have no higher-tier alternative currently.

### Manual entry (tier 1)

Use **Add entry → Episode** in the journal. Fill in show title, season, episode number, episode title, and watch date.

---

## Books

A book entry records a completed read. The read date is the anchor — "when this happened" — not the start date.

### Goodreads (tier 2)

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

### Manual entry (tier 1)

Use **Add entry → Book** in the journal. Fill in title, author, year, series details, rating, and read date. An optional "started reading" date can also be recorded.

---

## Tips

**Import order doesn't matter.** The tier system handles precedence automatically — you can import Netflix first and Letterboxd later, and Letterboxd entries will supersede the Netflix ones for the same films on review.

**Your reflections are never overwritten.** If you've written a reflection on an entry and a higher-tier import supersedes it, your reflection is preserved on the new record.

**Re-importing is safe.** Importing the same file twice will mark all entries as duplicates in staging — nothing will be added unless you've since deleted entries from your journal.

**Manual corrections always win.** Any field you've edited manually (via the corrections panel on an entry card) is stored as an override and will survive future re-imports of the same source.
