# Spec: Book cover images

Status: draft v1.0 — ready for implementation
Target location: docs/specs/book-covers.md
Applies to: shared engine (src/lib/journal/), mobile entry page (mobile/), web EntryCard (src/)

---

## 1. Summary

Show a cover image on the entry page and card for Book entries, reusing the artwork
infrastructure built for film and episode posters (see docs/specs/event-posters.md).
Covers are fetched from Open Library using ISBN (when available) or title plus author as
a fallback. No API key is required; no personal data is sent.

---

## 2. Goals and non-goals

**Goals**
- A cover image appears on the Book entry page (mobile) and expanded EntryCard (web),
  styled consistently with the PosterCard treatment used for films.
- ISBN-keyed lookups send only the ISBN, which contains no personal information.
  Title/author fallback sends only title and author.
- Covers are cached in the same separate artwork database used for posters and are
  never included in journal backups.
- Reuses ArtworkStorage, ArtworkMatch, normaliseTitle, resolveArtwork, enrichAll,
  and the storage wiring already in place. The only new code is the provider and the
  small Book type change below.

**Non-goals (this spec)**
- Covers in the Culture list or Trips views.
- Author photos, synopsis, publisher or any other metadata beyond the cover image.
- Combining the film/poster settings toggle and the book covers toggle into one UI.
  They may be split (books need no API key so the toggle framing is different).
- Series covers or edition-specific covers (one cover per title).

---

## 3. Key decisions

1. **Provider: Open Library Covers API.** Free, no API key, adequate coverage.
   Attribution is not required but a brief link in the attribution section of Settings
   is courteous (see WP4).
2. **ISBN path is authoritative.** `https://covers.openlibrary.org/b/isbn/{isbn13}-L.jpg`
   is a deterministic URL. If it returns a 200 with image bytes, the cover exists and no
   search is needed. If it 404s, fall through to the title/author search.
3. **Title/author search fallback.**
   `GET https://openlibrary.org/search.json?title={normTitle}&author={author}&fields=key,cover_i&limit=5`
   Returns a `cover_i` integer; cover URL is `https://covers.openlibrary.org/b/id/{cover_i}-L.jpg`.
   Accept only an exact normalised title match; if multiple qualify take the highest
   `editions_count` as a proxy for popularity.
4. **No confidence threshold change.** ISBN matches use confidence 1.0; title/author
   matches use the same 0.5 threshold as TMDB (exact normalised title match required).
5. **`isbn13` added to the `Book` type.** The Goodreads connector already parses it;
   it just needs to be persisted on the entry rather than left in `raw`. This is the
   only change to shared types.
6. **Separate `BookCoverProvider` interface.** The existing `ArtworkProvider` interface
   is TMDB-shaped (findMovie / findTv / byExternalId). Rather than adding findBook to it
   and requiring TmdbProvider to stub it, define a parallel `BookCoverProvider` interface.
   Both providers share `ArtworkStorage` and `ArtworkMatch` unchanged.
7. **Separate in-memory slot.** Add `setBookCoverProvider` / `getBookCoverProvider` in
   artwork.ts alongside the existing film provider slot. The enrichment service picks up
   whichever slots are populated.
8. **Artwork key format for books.** `"book|{normTitle}|{year_or_empty}"` — same
   pattern as films. The normalised title uses the existing `normaliseTitle` function.

---

## 4. Data model changes

### 4.1 Book type (src/lib/journal/types.ts)

Add one optional field:

```ts
/** ISBN-13, cleaned of any Excel formatting artifact. Populated by the Goodreads connector. */
isbn13?: string;
```

### 4.2 Goodreads connector (src/lib/journal/connectors/goodreads/index.ts)

The connector already parses `isbn13` into `r.raw`. Persist it directly on the Book
entry (alongside the existing `goodreadsId` field). One-line change.

### 4.3 ArtworkStorage, ArtworkMatch, stores

No changes. The existing `artwork_match` table and IDB store handle `book|...` keys
without modification.

---

## 5. New interfaces and types

### BookCoverProvider (src/lib/journal/artwork.ts or artworkProvider.ts)

```ts
export interface BookCoverProvider {
  /** True when the provider can make network requests. */
  readonly enabled: boolean;
  /**
   * Look up a book cover by ISBN (preferred) or normalised title + author (fallback).
   * @param normTitle  Output of normaliseTitle() applied to the book title.
   * @param author     Raw author string (used for search disambiguation only).
   * @param isbn13     If present, tried first via the deterministic ISBN URL.
   */
  findBook(
    normTitle: string,
    author: string,
    isbn13?: string,
  ): Promise<ArtworkProviderResult | null>;
  /** Construct the full image URL for a cover path returned by findBook. */
  imageUrl(path: string): string;
}
```

### bookToArtworkKey (src/lib/journal/artwork.ts)

```ts
/** Returns the artwork key for a Book entry, or null if the entry is not a book. */
export function bookToArtworkKey(entry: Entry): string | null {
  if (entry.kind !== "book") return null;
  const v = view(entry) as Book;
  const norm = normaliseTitle(v.title);
  if (!norm) return null;
  return `book|${norm}|${v.year ?? ""}`;
}
```

---

## 6. Work packages

Each package is independently testable. Branch: `feat/book-covers-wp1-wpN`.

---

### WP1: Book type + Goodreads connector

**Scope**
- Add `isbn13?: string` to `Book` in `types.ts`.
- In `goodreads/index.ts`, copy the parsed `isbn13` from `raw` onto the mapped Book entry.
- Add `bookToArtworkKey` to `artwork.ts` alongside `eventToArtworkKey`. Return
  `"book|{normTitle}|{year}"` using the existing `normaliseTitle`.
- Update `eventToArtworkKey` to delegate to `bookToArtworkKey` for `kind === "book"`
  (or keep them separate — caller's choice; update the test to reflect whichever).

**Done when**
- `npx vitest run` passes.
- Unit tests: `bookToArtworkKey` for a book with year, without year, with accented title,
  with leading "The"; `eventToArtworkKey` no longer returns null for a Book entry.
- Type-check passes in both `mobile/` and root.
- Existing Goodreads tests still pass and isbn13 is present on the output entry.

**Depends on:** nothing (pure data model work)

---

### WP2: BookCoverProvider interface + OpenLibraryProvider

**Scope**
- Add `BookCoverProvider` interface to `artworkProvider.ts` (or a new `bookCoverProvider.ts`).
- Add `setBookCoverProvider` / `getBookCoverProvider` to `artwork.ts`.
- Implement `OpenLibraryProvider` class:
  - ISBN path: HEAD (or GET) `https://covers.openlibrary.org/b/isbn/{isbn13}-L.jpg`;
    if the response is an image (Content-Type image/* or status 200 with body > 1 KB),
    return `ArtworkProviderResult` with `poster_path = "/b/isbn/{isbn13}-L"` and
    `confidence = 1.0`. Note: Open Library returns a 1x1 transparent GIF for missing
    covers rather than a proper 404 — check Content-Length > 1000 bytes or
    use the JSON API: `https://openlibrary.org/api/books?bibkeys=ISBN:{isbn13}&format=json`
    returns `{}` for unknown ISBNs.
  - Title/author search path: fetch
    `https://openlibrary.org/search.json?title={encodeURIComponent(normTitle)}&author={encodeURIComponent(author)}&fields=key,cover_i,title,edition_count&limit=5`,
    normalise each `title` in results, accept only an exact match, take highest
    `edition_count`, return `poster_path = "/b/id/{cover_i}-L"` and `confidence = 0.8`.
  - `imageUrl(path)` returns `https://covers.openlibrary.org${path}.jpg`.
  - Throttle: minimum 200ms between requests (Open Library requests ~5 req/s max).
  - One retry on 5xx. No retry on 404.
  - `enabled` is always `true` (no key required).

**Done when**
- Unit tests against recorded JSON fixtures — ISBN hit, ISBN miss (falls through to
  search), search exact match, search no match, network error handling.
- Verified requests contain only ISBN or title/author, no entry id, user id or date.
- `npx vitest run` passes.

**Depends on:** WP1

---

### WP3: Enrichment wiring (mobile + web boot)

**Scope**
- In `mobile/app/_layout.tsx` boot useEffect: `setBookCoverProvider(new OpenLibraryProvider())`.
  No API key parameter needed.
- In `src/routes/__root.tsx` RootComponent useEffect: same.
- `enrichAll` in `artworkEnrichment.ts` currently only iterates film/episode entries.
  Extend it to also iterate book entries using `bookToArtworkKey` and the book cover
  provider slot. Guard: skip if no book cover provider is set.
- Settings toggle: add a "Fetch book covers" switch in Settings (mobile) and Backup page
  (web) below the existing poster toggle. Persist with key `"chronicle-fetch-book-covers"`
  in `chronicle-prefs.json` (mobile) / `localStorage` (web). Wire to a new
  `setFetchBookCoversEnabled` flag checked in the enrichment path.
- Attribution: add a line in the attribution section: "Book cover images from
  Open Library (openlibrary.org), freely available under the Open Library license."
  No formal attribution requirement exists, but it is good practice.

**Done when**
- Switching the toggle off and back on disables / re-enables enrichment calls in the
  hook and in `enrichAll`.
- Type-check passes in `mobile/`.

**Depends on:** WP2

---

### WP4: Display

**Scope**

**Mobile (`mobile/app/entry/[id].tsx`)**
- In `BookDetail`, compute `const artworkKey = bookToArtworkKey(e)` and render
  `<PosterCard artworkKey={artworkKey} title={v.title} />` before `<Divider>`,
  identical to the film/episode pattern already in place.
- PosterCard is already generic (takes any artworkKey string) so no changes needed there.

**Web (`src/components/journal/EntryCard.tsx`)**
- In the `usePoster` hook call site, extend the `artworkKey` derivation to also handle
  `entry.kind === "book"` using `bookToArtworkKey`.
- Use `getBookCoverProvider()` for the `imageUrl` call (not `getArtworkProvider()`).
  Add a helper or inline it.

**Done when**
- Opening a Book entry on mobile shows a cover (when enrichment has run or runs lazily).
- Expanding a Book entry card on web shows the cover.
- `npx vitest run` passes; no new TypeScript errors.

**Depends on:** WP3

---

### WP5: Wrap-up

**Scope**
- Run full test suite; fill any gaps found.
- Update `docs/import-guide.md` Enrichment layer section to mention book covers.
- Update `BACKLOG.md`: mark book covers done in section 3, note album art / concert
  imagery as the next potential enrichment source.
- Update `docs/specs/mobile-design.md` progress log.
- Confirm chronicle export JSON contains no cover image bytes (code inspection;
  same verification pattern as poster WP9).
- Commit as `chore/book-covers-wp5`.

**Done when**
- Full suite passes. Docs updated. Export confirmed clean.

**Depends on:** WP4

---

## 7. Open questions

| # | Question | Blocks |
|---|---|---|
| Q1 | Open Library returns a 1x1 GIF rather than 404 for unknown ISBNs. Confirm the best detection method (Content-Length check vs JSON API `api/books` probe) before building WP2. | WP2 |
| Q2 | Should book covers share the existing "Fetch posters" toggle or have their own? Proposal: own toggle (different framing — "Fetch book covers", no API key, always available). Revisit if the Settings UI gets cluttered. | WP3 |
| Q3 | `enrichAll` currently processes film/episode entries via a single provider slot. With two provider types, does it need a unified "enrichment registry" or is two slots enough? Two slots is simpler and sufficient for now. | WP3 |

---

## 8. Decision log

| Date | Decision | Reason |
|---|---|---|
| 2026-10-11 | Open Library over Google Books | No API key required; simpler; adequate coverage for Goodreads-imported titles |
| 2026-10-11 | ISBN path checked via api/books JSON probe, not Content-Length heuristic | More reliable; Q1 |
| 2026-10-11 | Separate BookCoverProvider interface, not extending ArtworkProvider | Avoids forcing TmdbProvider to stub findBook; cleaner separation |
| 2026-10-11 | isbn13 added to Book type | Goodreads connector already parses it; persisting it unlocks the fast ISBN cover path |

---

## 9. Progress log

Newest first.

- **2026-10-11 (spec written):** Draft v1.0. Open questions Q1–Q3 to resolve before WP2. WP1 can start immediately.
