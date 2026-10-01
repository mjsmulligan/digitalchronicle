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
| 3 | Automated secondary record | Netflix viewing history |

A tier 2 import of a film you already imported from Netflix will supersede the Netflix record. Your manual edits and reflections are always preserved regardless of tier.

---

## Travel — Legs

Legs are individual transport segments: a flight, a train ride, or a road trip.

### Viaduct (tier 2)

Viaduct is a travel booking aggregator. It exports a structured CSV of all your bookings.

**How to export:**
1. Log in to your Viaduct account.
2. Go to **My Trips → Export**.
3. Download `viaduct_export.csv`.

**What you get:**
- Flight segments with airline, flight number, aircraft type, and seat
- Train segments with operator and train number
- Road segments
- Departure and arrival times in local timezones
- Trip groupings carried over from Viaduct

**Notes:**
- Times are imported as local wall-clock time and stored with IANA timezone data.
- If a city or airport code can't be resolved to a timezone, the time is stored as date-only.

### Manual entry (tier 1)

Use **Add entry → Flight / Train / Road** in the journal.

Fill in From, To, date, and optionally a departure time. The app resolves timezones from the IATA code or city name.

---

## Stays

A stay is a period spent in one place — a hotel, an Airbnb, staying with friends.

### Viaduct (tier 2)

Viaduct exports include accommodation bookings alongside flights and trains. Same export file as for Legs — stays are parsed out automatically.

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

Setlist.fm tracks concerts you've attended. It exports a CSV of your attended shows.

**How to export:**
1. Log in at [setlist.fm](https://www.setlist.fm).
2. Go to your profile → **Attended concerts**.
3. Use the export option to download your concert history CSV.

**What you get:**
- Artist name
- Venue and city
- Concert date
- Setlist (song-by-song, where available)

**Notes:**
- Only concerts with a confirmed setlist are exported — shows you marked as attended without a setlist may not appear.

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

Use **Add entry → Film** (not yet in the quick-add dialog; can be added via import staging with a single-row CSV).

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

Episodes can't currently be added through the quick-add dialog — use the Netflix import or add via staging.

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

Books can't currently be added through the quick-add dialog — use the Goodreads import.

---

## Tips

**Import order doesn't matter.** The tier system handles precedence automatically — you can import Netflix first and Letterboxd later, and Letterboxd entries will supersede the Netflix ones for the same films on review.

**Your reflections are never overwritten.** If you've written a reflection on an entry and a higher-tier import supersedes it, your reflection is preserved on the new record.

**Re-importing is safe.** Importing the same file twice will mark all entries as duplicates in staging — nothing will be added unless you've since deleted entries from your journal.

**Manual corrections always win.** Any field you've edited manually (via the corrections panel on an entry card) is stored as an override and will survive future re-imports of the same source.
