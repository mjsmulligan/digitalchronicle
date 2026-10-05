# Source spec: Photo library (EXIF)

Status: draft 4. City-level places, date ranges, and the phone's own geocoder are decided. Items marked **Open** still need a call or a check on real data.

## 1. Purpose

Read photo metadata directly from the phone's photo library and turn it into `place` events at city level: evidence that you were in a given city over a given range of days. Photos are evidence of time and place, not events in themselves.

## 2. Source type

On-device source. No account and no upload. The only network activity is the anonymous locality lookup described in section 8, which uses the phone's own geocoder. Output goes to the Staging Hub in the same staged item shape as other sources.

## 3. Event type: `place`

A new event type, not a reuse of `stay` (which implies lodging, nights and check-in/out) and not a photo-specific `moment`. It is source-agnostic, so calendar locations, bookings and receipts can also produce `place` events.

- **Level (decided):** city level. A trip to London covering the British Museum, the National Gallery and a football match is one place, London, not three. Venue-level entries would be noisy.
- **Dating (decided):** a date range (for example, London over one or two days).
- **Trips (decided):** a place can belong to a trip or stand alone.
- **Evidence:** photos are attached to the place as evidence references, not as payload.
- **Venue-level activities** (museums, matches, and so on) are not places. They belong to the event ontology and come from sources that name the venue, such as tickets, check-ins and calendar entries.

## 4. Scope and permissions

- **Scan scope (decided):** the user chooses at setup between selected albums, a date range, or **scan all**. Scan all is always available. It can be a heavy operation, and that is the user's call. The app does not block it or hide it.
- **Scan all behaviour:** show a short heads-up before starting (it may take a while and use battery), run in batches, show progress, allow cancel, and resume from where it stopped if interrupted. No photo outside the chosen scope is ever read.
- Request media library read access on first use, with a plain explanation of why.
- Request the location-metadata permission separately (Android hides GPS from media reads without it). If declined, run in time-only mode (section 7).
- Support limited (selected photos) access: the source works on whatever is visible and reports how many photos it can see.

## 5. Fields read

| Field | Use |
| --- | --- |
| Capture time | Placement on the timeline |
| Timezone offset (if present) | Resolve local vs UTC |
| GPS latitude and longitude | Locality lookup |
| Camera make and model | Distinguish camera photos from other images |
| Media ID and file path or URI | Reference back to the photo |

Everything else is ignored and never stored.

## 6. Time handling

Each photo is assigned a local day.

1. Use the offset from EXIF where present.
2. Otherwise infer the timezone from GPS where present.
3. Otherwise use the nearest known trip leg or the phone's timezone at scan time.
4. Record which rule was used on each photo, so a wrong guess is traceable.

## 7. Missing or poor data

- **No GPS:** the photo does not create a place. It attaches as evidence to a place whose date range covers its local day. If none does, it is held as unlocated evidence and nothing is staged for it.
- **Location permission declined:** time-only mode. No places are created, and photos attach by day to existing places only.
- **No capture time:** fall back to file modified time and mark the photo low confidence.
- **Screenshots and saved images** are not evidence of being somewhere. A missing camera make and model is the signal. **Open:** exclude these photos, or include them at low confidence.
- **Photos taken during a known leg** (a flight or train journey) are excluded from place building, since the leg already covers that time.

## 8. Locality resolution

Each photo with GPS is resolved to a locality (the city or town it is in). Administrative boundaries decide, not a radius, so there is no user-defined distance anywhere in this source.

- **Resolver interface (decided):** a small interface takes coordinates and returns a locality name, region, country and a locality key. The provider can be swapped later without touching the rest of the source.
- **First implementation (decided):** the phone's own geocoder (Android and iOS built-in reverse geocoding, via the Expo location module). No API key and no billing. Google Maps Platform APIs are not used: their terms limit storing results, and the journal keeps place names permanently.
- **Anonymous lookups (decided):** send only coarsened coordinates, one lookup per distinct coarsened location per day rather than per photo, with no timestamps, photo IDs or account details. Results are cached in the app database as the journal's own record.
- **Which level counts as the city:** use the locality or city field the geocoder returns. If absent, fall back to the sub-region, then the region. **Open:** the platform geocoders can return different levels (suburbs or boroughs rather than the city) and can differ between Android and iOS. Test on real photos on both before fixing the rule.
- **Open:** confirm the storage terms of the platform geocoders for permanently keeping results.
- **Lookup fails or the phone is offline:** the photos stay pending with their coordinates and are retried on the next scan. No place is created until resolved.

## 9. Building places from photos

1. Resolve each photo to a local day and a locality key.
2. Group consecutive days with the same locality key into a run. The run's start and end days become the place's date range.
3. A run ends when a different locality appears on a later day, or a trip boundary is crossed. Days with no photos do not end a run.
4. A long gap in days also ends a run, so two separate visits to the same city are not merged. This is a fixed internal value, not a user setting. **Open:** the value.
5. If two localities appear on the same day (London in the morning, Windsor in the afternoon), both places include that day. Ranges may overlap.
6. A single photo is enough to create a place, at low confidence.

## 10. Mapping to staged items

- **Type:** `place` (locality name, region, country, date range, evidence references).
- **Evidence:** photo count and a small set of representative photo references.
- **Link proposal:** if the date range falls inside a known trip, propose attaching it. Otherwise it stands alone.
- **Confidence:** derived from photo count, GPS presence and time quality.
- **Open:** whether photos are also attached as evidence to venue-level events (a ticketed visit, a calendar entry) in this source, or left for a later one.

## 11. Source precedence

- **Decided:** photo place events sit at equal precedence with calendar entries.
- **No conflict handling for `place` (decided):** a photo place and a calendar place can exist side by side with no flag and no tie-break. Only the user has the context to know which is right (a calendar entry may name Germany while the photos are in Dublin), so the system does not try to detect or resolve disagreement. Nothing is merged, overridden or discarded automatically.
- Tickets and bookings still win on timings. Photos are strongest on "was here", weakest on purpose and what happened.

## 12. Privacy

- Everything runs on the device except the anonymous locality lookup described in section 8.
- **Decided:** no home exclusion zone. The scope the user chooses at setup is the control. With scan all, long runs in the home city are an honest record, not an error.
- Store references and derived metadata only. No copies of photos and no thumbnails in the journal database.

## 13. Sync and re-import

- Keep a last-scanned marker per source.
- Re-scan is incremental (new or changed photos in the selected scope since the marker).
- Staging is idempotent. A place is identified by its locality key plus date range. If new photos extend or fill an existing run, the existing place is updated rather than a second one created. A run that already exists as a staged item is matched by locality key and overlapping or adjacent dates.
- Deleted photos: keep the place, mark the reference as missing.

## 14. Out of scope (for now)

- Face or object recognition.
- Cloud photo libraries accessed through an account.
- Video metadata.
- Venue-level visit detection from photos alone. It would need offline places data and would be offered as a suggestion, not created automatically.
- Google Maps Platform APIs, and Google Timeline as a source (a separate spec).

## 15. Acceptance checks

1. Photos in one city across two days produce one place with that date range, attached to the trip if one covers it.
2. Photos with no GPS attach to the place covering their day and never create a place.
3. Re-scan creates zero duplicates. Adding photos on an adjacent day extends the existing place.
4. With location permission declined, the source runs in time-only mode and creates no places.
5. Photos outside the chosen scope (albums, date range, or all) are never read. With scan all, a scan can be cancelled and resumed without duplicates.
6. A lookup sends only coarsened coordinates, with no timestamps or identifiers, and no more than one lookup per distinct place per day.
7. With the phone offline or a lookup failing, photos stay pending, are retried later, and no wrong place is created.
8. A photo place in a different city from a calendar entry on the same day produces two items, unflagged, with nothing merged or dropped.
9. Photos taken during a known leg do not create places.
10. Two suburbs of the same city resolve to one place.

## 16. Work packages

Each package is sized for one agent. Packages marked pure have no device or permission dependencies and can be built and tested against fixtures.

### WP1. Data model

- **Inputs:** sections 3 and 10 of this spec, plus the existing staged item schema.
- **Outputs:** the `place` event type with a date range, the evidence reference type, and the staged item shape for photo places.
- **Depends on:** nothing. Do this first.
- **Done when:** types are defined, existing sources are unaffected, and a hand-written sample `place` item validates.

### WP2. Media access layer

- **Inputs:** section 4 (scope and permissions) and section 5 (fields read).
- **Outputs:** a module that lists albums, applies the chosen scope (albums, date range, or all), and returns normalised photo records (time, offset, GPS if present, media ID, camera make and model), in batches so a scan-all run can be resumed.
- **Depends on:** WP1 for the record type.
- **Done when:** it handles permission granted, location permission declined and limited access, never reads outside the chosen scope, and a large scan can be cancelled and resumed.

### WP3. Time resolution (pure)

- **Inputs:** a photo record plus known trip legs and a fallback timezone.
- **Outputs:** a local day and the rule used (offset, GPS inference, or fallback).
- **Depends on:** WP1.
- **Done when:** fixtures cover each rule and the missing-time fallback, and the rule used is always recorded.

### WP4. Locality resolver

- **Inputs:** section 8, and photo records with GPS.
- **Outputs:** the resolver interface, coordinate coarsening, per-day deduplication of lookups, a cache in the app database, retry for pending photos, and a first implementation on the phone's geocoder. A fake resolver for tests.
- **Depends on:** WP1.
- **Done when:** lookups send only coarsened coordinates, repeated places on a day cost one lookup, failures leave photos pending without creating places, and the level-selection rule is tested on real photos on both Android and iOS.

### WP5. Place builder (pure)

- **Inputs:** photo records with local day and locality key, known trips and legs.
- **Outputs:** places with date ranges, evidence references and a stable identity, following section 9.
- **Depends on:** WP1, WP3. Can be built against the fake resolver from WP4.
- **Done when:** fixtures cover multi-day runs, same-day overlaps, trip boundary splits, long-gap splits, photos during legs, and no-GPS photos attaching by day.

### WP6. Staging mapper

- **Inputs:** places from WP5 and the known trips.
- **Outputs:** staged `place` items with a proposed trip link or standalone, and confidence.
- **Depends on:** WP1, WP5.
- **Done when:** a trip's photos attach to that trip, nothing is flagged against calendar places, and no duplicate items are created.

### WP7. Sync and re-scan

- **Inputs:** section 13, the mapper output, the last-scanned marker, and the existing staged items.
- **Outputs:** incremental scans that update or create items without duplicates, extend existing places when new photos arrive, and mark references to deleted photos as missing.
- **Depends on:** WP2, WP6.
- **Done when:** re-scan creates zero duplicates and adjacent-day photos extend the existing place.

### WP8. Settings UI

- **Inputs:** section 4.
- **Outputs:** setup flow with the albums, date range and scan all options (including the scan-all heads-up and progress), scope editing, and a way to trigger a re-scan. There are no threshold or radius controls.
- **Depends on:** WP2.
- **Done when:** a user can pick any scope including scan all, see progress and cancel, and trigger a re-scan.

### WP9. Fixtures and acceptance tests

- **Inputs:** section 15.
- **Outputs:** a fixture set of sample photo metadata (including a multi-day city trip, a day trip to a nearby town, suburbs of one city, and photos with no GPS) and an automated test for each acceptance check.
- **Depends on:** WP1 first, then updated as WP3 to WP7 land.
- **Done when:** all ten acceptance checks run and pass.

### Suggested order

1. WP1 and WP9 (fixtures first).
2. WP2, WP3 and WP4 in parallel.
3. WP5 (can start early against the fake resolver), then WP6.
4. WP7, then WP8.

### Open

- Which locality level counts as the city, checked on real photos on both Android and iOS.
- Storage terms of the platform geocoders.
- The maximum day gap before a run ends.
- Whether screenshots and saved images are excluded or included at low confidence.
- Whether photos also attach to venue-level events in this source.