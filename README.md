# Chronicle

Build a local-first journal application where all data remains strictly in browser storage (IndexedDB/local store) with zero cloud sync for complete privacy, designed around ingesting multi-source CSV and JSON exports.

Key specifications from the project discovery and data model:

1. Local-First Architecture & Storage:
- All data stored locally in the browser with full privacy.
- Robust Backup & Restore: complete database export to JSON and one-click restore so data is portable and safe.
- Core Data Model:
  * Trips: clusters of travel/events with date ranges, destinations, title, notes, and cover summary.
  * Legs: transit segments (Air: flight number, airports, departure/arrival times, aircraft; Rail: origin, destination, times; Road).
  * Stays: accommodation/lodgings with place, dates, check-in/out, notes.
  * Events: activities, concerts, gigs (artist, venue, city, date, setlist details).
  * Manual Overrides & Notes: sovereign Tier 1 overrides and personal journal reflections attached to days or trips.

2. Ingestion & Staging Pipeline:
- Dedicated Staging Hub where uploaded files are parsed, previewed, and reviewed before committing to the main store.
- Built-in format parsers and presets:
  * Flightradar24 personal flight CSV export
  * Viaduct rail CSV export (handles station names, local timestamps)
  * setlist.fm concert attendance export (JSON/CSV)
  * Generic / Cleaned CSV & JSON parser for pre-processed custom datasets
- Staging Review step:
  * Shows parsed records with preview, validation warnings, and duplicate detection.
  * Suggested Trip Clustering: automatically clusters transit legs and events by proximity and timeline into candidate trips that the user can confirm, adjust, or split.
  * Conflict resolution adhering to precedence tiers (User manual edits > Primary transit records > Secondary order/calendar records).
  * Batch or selective commit of staged records into the primary data store.

3. Views Powered by the Local Store:
- Timeline & Daily Journal: chronological view with rich expandable cards for flights, train journeys, concerts, and daily notes.
- Trips Explorer: summary of trips with stats, legs, and stops.
- Places & Map View: visual map and place list of destinations visited.
- Staging / Importers Manager: drag-and-drop dropzone, sample data loader (to test Flightradar24, Viaduct, and setlist.fm data immediately), and staging queue.
- Backup & Data Management: storage metrics, full JSON export/import, and database reset options.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://digitalchronicle.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/30a7100b-c0e5-4305-b385-c4ab8a135ba5).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
