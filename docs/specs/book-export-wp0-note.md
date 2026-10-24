# Book export WP0: expo-print spike

Status: desktop baseline done, device run pending. 23 Oct 2026.
Spec: `docs/specs/book-export.md`, section 8 and WP0.

## Question

Can `expo-print` (HTML to PDF) produce the interior PDF for a 100 page book with about 30 photos on a real phone, with embedded fonts, the right page size, chapter openings on right-hand pages and page numbers, without the app being killed?

## What was built

- `src/lib/journal/book/spike/` (`data.ts`, `html.ts`): a seeded journal generator and an HTML builder that reads the WP1 `BookModel`. It uses the layout features the real renderer needs: base64 `@font-face`, `@page` size and margins, a page number margin box, `break-before: right`, tables, quotes, italic reflections and inline photos that avoid splitting across pages.
- `scripts/book-spike-html.ts`: writes the same HTML to disk so any browser engine can render it. This gave the desktop baseline below.
- `mobile/src/lib/bookSpike.ts` and `mobile/app/book-spike.tsx`: the on-device run. Settings has a "Book export spike" row. It takes your most recent library photos, resizes each to 150 ppi at the placed size one at a time, builds the book, calls `printToFileAsync`, then reports timings, the page count from expo-print, the page count and page size read back from the PDF bytes, and the fonts found in the file. "Open PDF" shares the file so you can look at it; "Share result" sends the numbers as text.

## Desktop baseline (headless Chromium 141, not a phone)

Same HTML, 30 photos of about 160 KB each, Lora and Fraunces embedded. This shows the approach is sound. It says nothing about phone memory, speed or the Android WebView.

| Run | Entries | Pages | PDF size | Print time |
|---|---|---|---|---|
| A4, chapters on right page, page numbers | 803 | 101 | 5.4 MB | 2.2 s |
| A4, plain page break instead of right | 803 | 101 | not measured | not measured |
| A5, chapters on right page, page numbers | 803 | 150 | 5.4 MB | not measured |

The HTML itself is 7.4 MB, mostly photos inlined as data URIs.

Checked in the A4 output: page size 595.9 x 841.9 pt, all fonts embedded as subsets (Lora regular, italic and bold, Fraunces semibold), page numbers print at the bottom of every page, the first chapter opens on page 5 (a right-hand page), tables and photos flow across pages without splitting.

## What the expo-print documentation limits

From the SDK 57 type definitions:
- `margins` works on iOS only. On Android the margins have to come from CSS `@page`, which is what the spike does by default. The "Native margins" option appears on iOS only.
- `numberOfPages` is returned on both platforms, so page count can be read without parsing the PDF.
- Page width and height are in points at 72 ppi (A4 is 595 x 842).
- iOS cannot print local file URLs in the HTML, so photos are inlined as data URIs.

## Unknowns only the device can answer

1. Does the app survive an 8 MB HTML string and about 100 pages on a mid-range Android phone? How long does it take?
2. Does the Android System WebView print path honour the `@page` margin box for page numbers and `break-before: right`? Both are recent Chromium features, so older WebView versions may ignore them.
3. Does iOS ignore `@page` margins as expected, and does "Native margins" fix it?
4. Is the page size exactly A4 or A5 on both platforms?

## How to run on the phone

1. In `mobile/`: `npm install` (three new packages: `expo-print`, `expo-image-manipulator`, `expo-sharing`).
2. Rebuild the dev client, because these are native modules: `npx expo run:android`.
3. Settings, then "Book export spike". Defaults are A4, 800 entries, 30 photos. Tap Run spike and keep the app open.
4. Tap "Open PDF" and check page numbers, a chapter opening and a photo page. Tap "Share result" and send me the text.

## Decision rule

Keep `expo-print` (candidate A) if, on the Android phone: the run finishes, the page count is close to 100, the page size matches, the fonts are embedded, and page numbers and right-hand chapter openings look right. Also repeat once on iOS if there is a device to hand.

Switch to a JavaScript PDF library (candidate B) if the run is killed or takes minutes, or if page numbers and right-hand openings do not work on Android, since those cannot be fixed from HTML on an old WebView.

Either way the `BookModel` and the Markdown renderer are unaffected.

## Cleanup after the decision

Delete `mobile/app/book-spike.tsx`, `mobile/src/lib/bookSpike.ts`, the Settings row, and (if candidate A wins) keep `src/lib/journal/book/spike/` only as the starting point for the real PDF renderer in WP5.
