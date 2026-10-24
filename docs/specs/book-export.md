# Book Export (PDF and Markdown)

Status: Draft v2, 22 Oct 2026
Location in repo: `docs/specs/book-export.md`
Platform focus: mobile (Expo / React Native), with the book model kept in the shared engine so web can reuse it later.
Supersedes: the printer-ready draft (v1) of the same day.

## 1. Problem and goal

Chronicle builds a journal passively from imported sources, with reflections and ratings added on top. The end goal of the family journal has always been "a nicely presented document, possibly printed". Today that last step happens by hand in Google Docs. This feature turns what is in the main feed into a book: a PDF that reads well and can be printed anywhere, and a Markdown version that can be edited further before it becomes a physical book.

Goal: from the feed, export a book as a PDF and as Markdown plus images, without leaving the app and without sending personal data anywhere.

Success is personal, as for the rest of the app: he can produce a decade, a year or a single trip as a document he is happy to read, edit and print.

## 2. Non-goals (v1)

- Not printer-ready. No bleed, spine, cover spread, PDF/X, CMYK or printer profiles. A print shop or print-on-demand service can still take the PDF, but the app does not guarantee it passes a printer's validator.
- No ordering, payment or printer integration.
- No manual page layout editor. Layout is automatic.
- No new entry creation. The book only prints what is already in the journal (the app stays passive).
- No printed maps (later).
- No web renderer in v1.
- No round trip. Edited Markdown does not flow back into the journal.

## 3. Principles carried over

- Data model stays separate from presentation. The book is one more presentation of the same data, built through a pure intermediate model that both outputs read from.
- Local-first, no lookups that send personal data. Everything is generated on device. Files leave the device only through the OS share sheet or Save to Files, at the user's choice.
- Keep it simple, avoid one-way decisions. Printer-ready output can be added later as another renderer over the same model.
- Source-supplied reviews are read-only and shown as the source's review. The user's own reflection is shown separately.

## 4. Key decisions

| # | Decision | Why |
|---|---|---|
| D1 | Two outputs from one model: a PDF and a Markdown package. | PDF is the finished read. Markdown is the editable form, for the further editing he already does by hand in Google Docs. |
| D2 | Scope of a book is a saved "book definition": date range plus the feed filters (for example person, trip, type). Defaults to the current feed view. | One mechanism covers "2025", "Italy 2017" or "everything with Maia". |
| D3 | Two chapter modes, chosen per book: by year (default) or by trip. See section 6. | Both are wanted. The model groups entries once and the mode only changes the grouping step. |
| D4 | Exclusion is per book, not deletion. The user can untick individual entries in a review list before exporting. | The journal covers notable events only, and he knows which are not book material. Nothing in the journal changes. |
| D5 | PDF page size is A4 or A5 (user choice, default A4), fixed margins, no bleed. | Tables read better on A4. A5 is closer to a book. Both print on any ordinary printer or print shop. |
| D6 | Photos come from the media vault in v1. Library photos behind photo-place entries are later. | Vault files are app-owned and always readable. Library access at export time adds permission and performance questions. |
| D7 | The book is built through a device-independent `BookModel` (pure JSON). A PDF renderer and a Markdown renderer each read it. | Keeps the renderers swappable, and makes printer-ready output a later addition. |

## 5. User flow

1. In the feed, the user opens the Book action (header overflow menu, not a new tab).
2. The book builder opens with the current feed filters and visible date range prefilled.
3. User sets: title, subtitle, optional dedication, date range, filters, chapter mode (by year or by trip), page size (A4 or A5), cover photo (from the vault, optional).
4. Review list: entries grouped by chapter with a count, each with a tick to exclude. A page estimate is shown.
5. User taps Export and chooses PDF, Markdown or both. Progress is shown.
6. Files are saved in the app's document directory and offered through the share sheet and Save to Files.
7. The definition is saved so the book can be regenerated later, after new entries arrive.

## 6. Book structure

Front matter
- Title page (title, subtitle, date range, optional cover photo)
- Colophon: "Compiled by Chronicle from: " followed by the sources actually used (for example calendar, viaduct.world, Flightradar24, Goodreads, photo library), plus generation date
- Dedication (optional)
- Contents (PDF only; Markdown relies on headings)

Body: by year (default)
- One chapter per year, in date order.
- Inside a chapter, entries run in date order in the dated, almanac style already used in the journal: a date line, a short title, then the content.
- Trip containers become a section heading with the trip name and dates, with the existing "Day N of the journey" framing for days within it.

Body: by trip
- Chapters run in one chronological sequence. Each trip is its own chapter, containing that trip's entries in date order.
- Entries that belong to no trip (concerts, books, standalone place entries, unassigned legs) are grouped into the gaps between trips. Each run of such entries between two trips forms one chapter, titled by its date span (for example "March to June 2025"). A run that crosses a year boundary is split at 1 January so no gap chapter spans two years.
- Gap chapters with a single entry are still their own chapter, with no special casing.
- Entries appear exactly once, and the book reads in date order throughout.

Trip membership and grouping rules (both modes)
- An entry belongs to a trip only through its `tripId`, the explicit link the user confirmed. Date overlap with a trip does not count.
- A trip's entries always stay together, positioned where the trip's first included entry falls. An unlinked entry dated inside a trip's span therefore appears after the trip, never in the middle of it.
- An entry whose `tripId` matches no trip is treated as unlinked.
- In year mode a trip that crosses New Year appears in both year chapters, each time as a section with the whole-trip dates.
- Ties on start time sort by `dedupeKey`, then `id`, so output is stable.

Back matter
- Optional index of people (people with at least one printed entry). PDF includes page numbers; Markdown lists names only. Later if not cheap.

## 7. Entry rendering by event type

| Event type | Treatment |
|---|---|
| Flight and train legs | Table, one row per leg, one icon per leg (plane or train), columns: date/time, from, to, identifier (flight number or train code), connection note. Consecutive legs of one travel day sit in one table. Mirrors the transport table style already used in the journal. |
| Stays | Table with a hotel icon per row: place, check-in, check-out, nights (computed). Separate from the transport table, which holds legs only. |
| Place entries (photo source) | Short dated line: city, with the place container grouping consecutive days. |
| Concerts, football, other venue events | Table rows: date, event, venue, with whom, rating. Matches the concerts and football table style. Applies to concert and activity events that have a venue and no review or reflection. Anything with text, or with no venue, is a short narrative entry so the text stays attached to its event. Columns that are empty in every row are dropped. |
| Books, films and similar | Title, creator, date, rating, then the source review quoted with attribution to the source, then the user's reflection in italics if present. |
| Reflection (user text) | Italic paragraph under the entry. |
| Participants | "With: Name, Name". Names only, no roles. |
| Rating | Single number printed as "n/10" (for example "7.5/10"). Stars are deferred, because the glyph depends on the font chosen for the PDF. |
| Unknown or placeholder legs | Print what exists. Never invent mode or details. A leg with unknown mode uses a neutral icon. |
| Conflicts the user has not resolved | Print the stored value, no conflict markers. |

Other rules from the WP2 build
- Legs on one day share one table. A leg that starts where the previous leg in the table ended gets the note "Connects at <place>". The table has no date column because the date line above it carries the date.
- Text on a leg, stay or table row (a reflection, or a source review) prints under the table. With several legs in one table it does not say which leg it belongs to. Fix later if it matters in practice.
- Consecutive days at one place (photo source) read as one visit with a date range. A second place on the same day shares the first one's date line.
- Inside a trip, each narrative entry's date line carries "Day N of the journey". Table rows have their own date column and get no label.
- A year chapter opens a trip section with the trip name, dates and rating, then the trip's reflection. A trip chapter (trip mode) leaves the name out because the chapter title is the trip. A trip that crosses New Year prints its rating and reflection once, in the last year.
- A loosely dated entry (month or year precision) carries that precision so a renderer shows just the month or year rather than inventing a day.
- Series containers are not printed yet.

Not exported: "new" indicators, source icons, dismissed or hidden entries, staging state, raw source IDs.

Photos
- One or two photos inline per major entry (his stated preference), chosen from that entry's vault media, ordered by EXIF time, first wins. A cover photo is picked once in the builder.
- PDF: resampled to the placed size at no more than 150 ppi, JPEG, so the file stays easy to email.
- Markdown package: resized so the long edge is at most 1600 px, so it stays light to edit.
- Images processed one at a time to bound memory. Originals are never modified.

## 8. Technical approach

Pipeline: `feed query` -> `BookModel` -> `renderer` -> file.

`BookModel` (pure TypeScript, no React Native imports, lives with the shared engine in `src/lib/journal/`):
- `meta`: title, subtitle, dedication, language, date range, source list, chapter mode
- `chapters[]` with `sections[]` with `blocks[]`, block types: `heading`, `dateLine`, `paragraph`, `quote`, `table`, `photo`
- No layout or device decisions.

PDF renderer: HTML to PDF with `expo-print`, since the HTML is also a convenient intermediate for the Markdown work and gives good typography through CSS. Page size A4 or A5, fixed margins, embedded bundled fonts, running page numbers, chapter starts on a new page. WP0 confirms this works for a realistic book size on his phone. If it does not, switch to a JavaScript PDF library behind the same renderer interface; the `BookModel` does not change. Last-resort fallback is exporting the Markdown package and rendering on a computer.

Markdown renderer:
- One file, `book.md`, plus a `media/` folder, delivered as a single zip through the existing zip export machinery.
- Heading levels: `#` book title, `##` chapter, `###` trip or section, `####` entry.
- Tables as standard pipe tables. Icons as plain text labels (for example "Flight", "Train", "Stay") because emoji and icon fonts are unreliable across editors.
- Source reviews as blockquotes with attribution. Reflections in italics.
- Images as `![caption](media/<file>.jpg)` with relative paths so the folder can be moved.
- Plain Markdown only, no HTML, so it opens in any Markdown editor or converter.

Fonts: bundled, open licence, embedded in the PDF. One serif family for body and one for headings.

Storage
- New table `books` in `chronicle.db`: id, title, definition JSON (range, filters, chapter mode, page size, excluded entry ids, cover media id), timestamps.
- Generated files stored under the document directory in `books/<id>/` and included in the existing zip export.
- No migration concern while the app is not live.

## 9. Acceptance criteria

1. From the feed, a user can create a book definition and export a PDF and a Markdown package for a full year of entries on a mid-range Android phone without the app being killed.
2. PDF pages are all the chosen size (A4 or A5), fonts are embedded, and chapters start on a new page.
3. The Markdown package opens in a standard Markdown editor with all headings, tables and images intact and no broken image links.
4. Excluded entries never appear. Hidden and dismissed photo-place entries never appear. "New" indicators never appear.
5. In both chapter modes every included entry appears exactly once.
6. A source-supplied review is shown as the source's review and a user reflection is shown separately, never merged.
7. No network request is made during generation.
8. Regenerating the same definition with unchanged data produces the same content.

## 10. Work packages

Each package is tested and committed on one branch (`feat/book-export`), in order.

- [x] **WP0 Spike.** *Device run done by Mike on his phone and the result looked good, so `expo-print` is kept (no PDF library needed).* See `docs/specs/book-export-wp0-note.md`.* Produce a 100 page PDF with `expo-print` from realistic data and about 30 resampled photos on the real device. Check page size, font embedding, memory and time. Output: a short decision note on whether `expo-print` is good enough or a PDF library is needed.
- [x] **WP1 `BookModel` and query.** Build the model from a date range and filters over the existing feed query, including both chapter modes, exclusions and the sources list. Pure functions, unit tested with fixture data from the existing importers. *Built in* `src/lib/journal/book/` (`types.ts`, `build.ts`) with the feed predicates shared in `src/lib/journal/feedFilter.ts`. Sections list entries by id; WP2 fills `blocks`. The generation date is an input, so the same data and definition always give the same model.
- [x] **WP2 Block mapping.** Event type to block mapping from section 7, including transport and event tables, ratings, reflections, participants. *Built in* `src/lib/journal/book/blocks.ts`; `buildBookModel` now fills every section's `blocks`.
- [x] **WP3 Markdown renderer.** `book.md` plus `media/` and the zip package. *Renderer and package builder are pure (`book/markdown.ts`, `book/package.ts`); the zip is written by `mobile/src/lib/bookMarkdownZip.ts` using fflate. Image loading and resizing arrive with WP4. Images that cannot be loaded are dropped from book.md rather than left as broken links.*
- [ ] **WP4 Photos.** *Deferred: there is no media vault in the app yet, so books export without photos. The renderers already accept photos through a resolver, so WP4 only has to supply them.* Vault media selection, resampling for both outputs, caching, memory limits, EXIF ordering.
- [x] **WP5 PDF renderer.** *`book/html.ts` (pure, tested) and `mobile/src/lib/bookPdf.ts`. Contents lists chapters without page numbers (Chromium print has no target-counter); icons print as text labels; front matter carries no page number. Photos come through the resolver once WP4 exists.* Implement the renderer WP0 selected: title page, colophon, contents, page numbers, chapter breaks, A4 and A5.
- [ ] **WP6 Builder UI.** Feed overflow entry point, builder screen, chapter mode and page size options, review list with exclusions, page estimate, progress, saved `books` definitions, share sheet and Save to Files.
- [ ] **WP7 Real run.** Export one real year (suggested 2025) in both chapter modes, read the PDF, edit the Markdown, and record what to fix. Spec is done after this.

## 11. Later (not v1)

- Printer-ready output (bleed, cover spread, spine, PDF/X) as another renderer over the same model.
- Library photos behind photo-place entries.
- Printed schematic route map per trip from stored coordinates, offline.
- Print themes tied to app themes (paper, leather and so on).
- Web renderer reusing `BookModel` via print CSS.
- People index, if not included in v1.

## 12. Open questions

None open. Decided 22 Oct 2026: in by-trip mode, entries outside trips are interleaved chronologically between trip chapters (section 6).
