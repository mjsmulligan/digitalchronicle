# Spec: Movie and TV posters on the event screen

Status: draft for agent implementation
Target location: docs/specs/event-posters.md
Applies to: shared engine (src/lib/journal/), mobile entry page (mobile/), web event view (src/routes/*)

## 1. Summary

Show a poster on the event screen for events that are a movie or a TV show. Posters are reference artwork fetched from a public movie database using only the title, year and type. No personal data is sent. The result is cached so each title is looked up once.

The journal is passive: this feature adds no manual input. It enriches events that already exist from sources such as Letterboxd, Netflix and cinema tickets.

## 2. Goals and non-goals

Goals
- A poster appears on the event screen for matched movie and TV events, styled as part of the journal look (a print tipped into a notebook page).
- Lookups send title, year and media type only, consistent with the "no lookups that send PII" rule.
- Works offline once a poster has been seen. A missing poster never blocks or breaks the screen.
- A wrong match can be corrected (last work package, optional for first release).
- The design is a generic "artwork" layer behind a provider interface, so books (Goodreads covers) and other types can reuse it later without a rework.

Non-goals (this spec)
- Posters on timeline cards, Culture tab lists or Trips. Follow-up once the event screen is proven.
- Backdrops, cast, synopsis, TMDB ratings or any other metadata. Ratings and reflections stay as per the existing rule (source-supplied is read-only, user rating only where source has none).
- Book covers, concert imagery, album art.
- Storing posters inside the exported chronicle zip. Posters are re-fetchable reference data.
- Any change to source precedence.

## 3. Key decisions (proposed, change if you disagree)

1. Provider: TMDB (themoviedb.org). Free for non-commercial use, covers both movies and TV, supports search by title and year. Attribution is mandatory (see WP5). The provider sits behind an interface so it can be swapped (avoids a one-way decision).
2. Artwork is enrichment, not source data. It lives in its own table with provenance (provider, fetched_at). It never overwrites event fields.
3. Matches are keyed by title identity (media type, normalised title, year), not by event. Two viewings of the same film share one match, and a manual correction applies to all of them.
4. Wrong poster is worse than no poster. Low-confidence matches are stored as "no match" and show nothing.
5. No placeholder box when there is no poster. The layout simply omits the poster.
6. Image bytes are cached by the image component (expo-image disk cache on mobile, browser cache on web). The database stores only ids and the poster path, which is tiny. Revisit if the Phase 4 media vault should own them.
7. Lookup timing: background enrichment after import, plus a lazy fallback when an event screen opens for an unmatched title.
8. A Settings toggle "Fetch posters" controls all network use for this feature. Default on.
9. TMDB API key: read from build configuration for now. A user-supplied key field in Settings is an easy later addition. Do not hard-code the key in source.

## 4. Assumptions the agent must verify in the code (WP0)

I do not have the code in front of me. Confirm each before building and record findings in section 9.

- How a movie and a TV show are represented as events (event type or category enum, Culture tab mapping).
- Which fields hold title, year (release year, not watch date), and any external ids (Letterboxd URI, IMDb id, TMDB id) per source.
- How Netflix rows represent series (likely "Show: Season N: Episode title") and whether a parser already exists.
- Whether cinema events from tickets or calendar carry a film title in a reliable field.
- Where the mobile entry page and web event view components live, and the existing styling tokens for the Moleskine look.
- Database access conventions: expo-sqlite on mobile, IndexedDB only via src/lib/journal/db.ts on web.

## 5. Data model

New table or store `artwork_match` (shared concept, per-platform storage)

| Field | Notes |
|---|---|
| key | media_type + "|" + normalised_title + "|" + year (year may be empty for TV) |
| media_type | movie or tv |
| status | matched, none, or manual |
| provider | "tmdb" |
| provider_id | TMDB id when matched |
| poster_path | TMDB relative path, nullable |
| title_matched | title as returned, for display in the correction picker |
| confidence | numeric, for debugging only |
| fetched_at | UTC timestamp |

Events are not modified. The event screen derives the key from the event and looks up the match.

Provenance: provider and fetched_at satisfy the existing "provenance marker on facts" principle.

Dev data can be reset, so no migration path is needed (app is not live).

## 6. Matching rules

- Normalise titles: lowercase, strip accents, collapse spaces and hyphens, strip leading "the"/"a" for comparison only, strip trailing "(year)".
- Movies: search by title with year filter. Accept exact normalised title match with release year within 1 year of the source year. If several candidates qualify, take the highest popularity.
- If a source supplies an IMDb id or TMDB id, use the direct lookup and skip search.
- TV: search by series name. For episode style titles, parse out the series name first. Poster is the series poster. Season posters are out of scope.
- No year available: accept only an exact normalised title match with a clear popularity lead, otherwise status none.
- Negative results are cached with status none and retried after 30 days.

## 7. Work packages

Each package is independently testable and committed on its own. Branch: feature/event-posters (not concurrent with a Lovable build prompt on the same branch). Open a PR when WP6 or WP7 is done, then a second PR for the rest.

### WP0: Discovery and record
Scope: answer section 4 by reading the code. Write findings into section 9 of this doc. Propose any change to this spec the findings require, then stop for review before WP1.
Done when: section 9 is filled in and no assumption in section 4 is left unconfirmed.

### WP1: Types, schema and storage
Scope
- Define the ArtworkMatch type and key builder in src/lib/journal/ (shared).
- Add the artwork_match store on both platforms (expo-sqlite table on mobile, IndexedDB store via db.ts on web).
- CRUD functions: getByKey, upsert, deleteByKey, listStaleNone.
Acceptance
- Unit tests for key building and round trip storage.
- Dev reset still works.
Depends on: WP0

### WP2: Event to key resolver
Scope
- Function eventToArtworkKey(event) returns a key or null for events that are not movie or TV.
- Title normaliser as specified in section 6.
- Series name parser for Netflix style episode titles; reuse any existing parser found in WP0.
Acceptance
- Table driven unit tests with real samples from Letterboxd, Netflix and cinema events (include accents, subtitles, "The" prefixes, year suffixes, episode titles, non-film events returning null).
Depends on: WP0 (can run alongside WP1)

### WP3: Poster provider interface and TMDB implementation
Scope
- ArtworkProvider interface: findMovie, findTv, byExternalId, imageUrl(path, size).
- TmdbProvider implementing it, including section 6 ranking and confidence.
- Image size choice: w342 for the event screen, defined as a constant.
- Config for API key from build env. Clear error if missing; the feature disables itself quietly.
- Basic request throttling and one retry with backoff on 429 and 5xx.
Acceptance
- Unit tests against recorded fixtures (no live network in tests).
- A manual smoke script or dev screen that resolves five known titles, including one TV series, one ambiguous title and one non-existent title.
- Verified that requests contain no identifiers beyond title, year, type.
Depends on: WP1, WP2

### WP4: Enrichment service
Scope
- resolveArtwork(key): returns cached match or fetches, stores, returns. Respects the Settings toggle and the 30 day negative cache.
- enrichAll(): finds distinct unmatched keys across events and resolves them in the background with a small concurrency limit. Called after an import completes and on app start, and safe to interrupt.
- Offline or network failure leaves the key unresolved without writing a negative result.
Acceptance
- Unit tests with a mock provider: cache hit, miss then store, negative cache expiry, offline failure, toggle off makes no calls.
- Importing a Letterboxd file in dev results in matches without opening any event.
Depends on: WP3

### WP5: Settings and attribution
Scope
- Settings toggle "Fetch posters" with one line explaining that only film or show titles and years are sent to TMDB.
- TMDB attribution text and logo in Settings (About area), using the wording TMDB requires: "This product uses the TMDB API but is not endorsed or certified by TMDB."
- Turning the toggle off stops fetching; already cached posters still display.
Acceptance
- Toggle persists across restart on both platforms.
- Attribution visible and legible in the active theme.
Depends on: WP4 (can run alongside WP6)

### WP6: Mobile event page
Scope
- Poster component on the entry page for movie and TV events: 2:3 ratio, rounded corners, paper-print treatment with a slight rotation and corner mounts consistent with the journal theme. Respect the theme chosen in Settings.
- Uses expo-image with disk caching and a quiet loading state (no layout jump; reserve the space only while a fetch is in flight, collapse it if the result is none).
- Triggers resolveArtwork for the event key on open if there is no stored match.
- No poster means no poster section at all.
- Accessible label: "Poster for {title}".
Acceptance
- Screenshots (light and dark, at least two themes) for: matched movie, matched series, no match, offline with cached poster, toggle off.
- No visible layout shift when a poster arrives.
- No regression to the rating and reflection areas on the page.
Depends on: WP4

### WP7: Web event view
Scope
- Same poster component behaviour in the inline expanded card on the web Chronicle and Culture views.
- Image loaded from the TMDB image CDN via the stored poster path.
- Same rules for loading, no match and toggle off.
Acceptance
- Screenshots as in WP6, narrow and wide layouts.
Depends on: WP4

### WP8 (optional): Wrong poster correction
Scope
- "Change poster" action on the event screen opening a picker of up to 10 TMDB search results (poster, title, year), with a free text search box.
- Selection stores status manual for the key, which applies to all events with that key and is never overwritten by enrichment.
- "No poster" option stores status manual with a null poster.
- Search runs only when the user opens the picker.
Acceptance
- Correction survives restart, re-import and enrichAll.
- Works on mobile and web.
Depends on: WP6 and WP7

### WP9: Wrap up
Scope
- Add tests for any gaps found while building; run full suite.
- Update docs/import-guide.md and the Journal backlog file: note that posters are an enrichment layer and list book covers (Goodreads) as the next reuse.
- Update docs/specs/mobile-design.md with the poster component.
- Confirm the chronicle export JSON does not carry image bytes, and that import of an older export simply re-enriches.
Depends on: all

## 8. Order and parallelism

WP0, then WP1 and WP2 together, then WP3, WP4, then WP5, WP6 and WP7 in parallel, then WP8, WP9. Because Claude Code works best on tightly defined packages, give it one package per session with this spec and the section 9 findings as context.

## 9. Findings from WP0 (agent to complete)

(empty)

## 10. Open questions for Mike

1. Default for "Fetch posters": on (proposed) or off until the user enables it?
2. TMDB key: build-time config (proposed) or a user-entered key in Settings from day one?
3. Should WP8 (correction) ship with the first release or follow it? Matching errors will show up quickly on obscure titles, so I would ship it soon after.
4. For series, is the series poster enough, or do you want season posters later?
