# Film & Episode Import — Design Spec

Status: **draft** — agreed design, not yet implemented.

---

## Guiding principle

The watch IS the event. You don't "do a watch of a film" — you watched a film. The film
metadata (title, year, director) and the viewing record (date, rating, reflection) are the
same thing from the user's perspective. There is no separate Film record; the film fields
live on the event itself.

A rewatch is a separate event with a different date. Same title and year, different dedup key.

---

## New entry kinds

### `Film`

```ts
interface Film extends Base {
  kind: "film";
  title: string;           // normalised: trim, collapse whitespace
  year?: number;           // release year, not watch year
  director?: string;       // optional; not available from Netflix or Letterboxd diary
  rewatch?: boolean;       // true if source flags it as a rewatch
  // Inherits from Base:
  // start           — watch date (YYYY-MM-DD); datePrecision = "day" always for these sources
  // rating          — 0–10 (one decimal); blank = unrated
  // reflection      — from Letterboxd "My Review" / reviews.csv "Review"
  // source          — connector id: "letterboxd" | "netflix" | "appletv" | ...
  // tier            — 2 for Letterboxd; 3 for Netflix (accurate date but no curation)
  // dedupeKey       — see below
}
```

### `Episode`

```ts
interface Episode extends Base {
  kind: "episode";
  showTitle: string;       // series name, e.g. "Bridgerton"
  season?: string;         // raw season label, e.g. "Season 4", "Limited Series"
  episodeTitle?: string;   // episode name, e.g. "The Waltz"
  // Inherits from Base:
  // start           — watch date (YYYY-MM-DD)
  // source          — "netflix" | "appletv" | ...
  // tier            — 3 (automated play history; no curation)
  // dedupeKey       — see below
}
```

### `Show` (container, analogous to `Trip`)

```ts
interface Show {
  id: string;
  title: string;           // series name, normalised
  kind: "show";
  createdAt: string;
}
```

Episodes are assigned to a Show the same way legs/stays are assigned to a Trip —
via `showId` on the Episode entry. The import UI offers grouping suggestions on staging
(same as trip clustering), never auto-assigns.

---

## Dedup keys

Keys are **source-agnostic** so that the same watch logged in two systems deduplicates
correctly and the higher-tier entry wins.

| Kind    | Key format                                                 | Example |
|---------|------------------------------------------------------------|---------|
| Film    | `film\|{normTitle}\|{year}\|{watchedDate}`                 | `film\|deadpool & wolverine\|2024\|2024-08-11` |
| Episode | `episode\|{normShowTitle}\|{normSeason}\|{normEpTitle}\|{watchedDate}` | `episode\|bridgerton\|season 4\|the waltz\|2026-06-02` |

`normTitle` = lowercase, trimmed. Year is omitted from the key if unknown (rare).
Season and episode title are also lowercased and trimmed.

### Cross-source dedup behaviour (accepted limitation)

Netflix records the exact play date automatically; Letterboxd is user-entered and can be
misremembered. Despite this, Letterboxd is assigned **tier 2** (curated log with rating and
review) and Netflix **tier 3** (automated play history). This means when both sources
record the same film on the same date, Letterboxd supersedes Netflix.

This is a known simplification. See BACKLOG.md §0 "Field-level dedup resolution" for the
longer-term approach (field-level merging so Netflix wins on date, Letterboxd wins on
rating/reflection).

---

## Letterboxd connector

**Files:** `diary.csv` and/or `reviews.csv` (same connector handles both).

### Column map

| Source column  | Target field    | Notes |
|----------------|-----------------|-------|
| `Watched Date` | `start`         | YYYY-MM-DD; always day precision |
| `Name`         | `title`         | |
| `Year`         | `year`          | integer |
| `Rating`       | `rating`        | ×2 → 0–10. Empty or 0 → undefined (unrated) |
| `Rewatch`      | `rewatch`       | `"Yes"` → true, else false/omit |
| `Review`       | `reflection`    | Only present in `reviews.csv`; omit if blank |
| `Letterboxd URI` | `sourceRef`   | Store as row provenance |
| `Date`         | *(ignored)*     | Log date, not watch date; not relevant |
| `Tags`         | *(ignored for now)* | Could become labels/tags later |

### Merge behaviour (diary + reviews)

`diary.csv` has all watches; `reviews.csv` has the subset with written reviews (same
columns plus `Review`). The correct import workflow is:

1. Import `diary.csv` → all Film events, no reflection.
2. Import `reviews.csv` → same dedup keys; each entry staged as `supersedes` with the
   `Review` text now in `reflection`. Committing updates the existing entries.

This works automatically via the existing staging/commitBatch logic, which preserves
`old.reflection ?? new.reflection` on supersede. No special merge logic needed.

### Sniff heuristics

- Filename contains "letterboxd" → 0.9
- Header contains `watched date` and `letterboxd uri` → 0.95
- Header contains `watched date` and `rewatch` → 0.8

### Tier

`2` — user-curated personal viewing log.

---

## Netflix connector

**File:** `NetflixViewingHistory.csv`

### Column map

| Source column | Target field | Notes |
|---------------|--------------|-------|
| `Date`        | `start`      | M/D/YY format — parse to YYYY-MM-DD |
| `Title`       | parsed       | See title parsing below |

Netflix provides no rating, review, or rewatch flag.

### Title parsing

The `Title` field encodes show structure with colons. Parsing rules (applied in order):

1. Match `{Show}: Season {N}: {Episode}` → Episode entry, showTitle, season = "Season N"
2. Match `{Show}: Limited Series: {Episode}` → Episode entry, season = "Limited Series"
3. Match `{Show}: {SeasonLabel}: {Episode}` where SeasonLabel matches season-like patterns
   ("Season N", "Part N", "Volume N", "Chapter N") → Episode entry
4. No season pattern found → Film entry (standalone film, special, stand-up, documentary)

Edge cases:
- `"Show: Special Episode Title"` (two parts, no season) → treat as Film unless show is
  already known in the journal as a series. For now: default to Film; can be corrected manually.
- `"WWE SmackDown: 2025: January 24, 2025"` → matches rule 3 loosely (year as season label);
  treat as Episode with showTitle "WWE SmackDown", season "2025".

### Date parsing

Netflix exports dates as `M/D/YY` (e.g. `9/30/26`). Parse with the century anchor:
- Two-digit years 00–29 → 2000–2029; 30–99 → 1930–1999 (matches JS `Date` behaviour).

### Sniff heuristics

- Filename contains "netflix" or "netflixviewinghistory" → 0.95
- Header is exactly `Title,Date` and first data rows match Netflix title patterns → 0.85

### Tier

`3` — automated play history; accurate date but no curation, rating, or intent signal.

---

## IndexedDB changes

Two new object stores alongside the existing `legs`, `stays`, `events`:

| Store      | Key       | Contents |
|------------|-----------|----------|
| `films`    | `id`      | Film entries |
| `episodes` | `id`      | Episode entries |
| `shows`    | `id`      | Show containers (like `trips`) |

`DB_VERSION` bumps from current value + 1. `onupgradeneeded` creates the three stores.

---

## Implementation order

1. Add `Film`, `Episode`, `Show` types to `src/lib/journal/types.ts`
2. Add `films`, `episodes`, `shows` stores to `src/lib/journal/db.ts`; bump `DB_VERSION`
3. Implement `src/lib/journal/connectors/letterboxd/` connector
4. Implement `src/lib/journal/connectors/netflix/` connector
5. Wire both into `registry.ts`
6. Update staging and UI to handle the new entry kinds
