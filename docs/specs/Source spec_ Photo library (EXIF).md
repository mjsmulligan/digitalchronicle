# Source spec: Photo library (EXIF)

Status: draft 7. The first implementation (work packages WP1 to WP9 of draft 4) is built and done. This draft defines only the new work packages (WP10 to WP16). Section 2a lists what changes from the first implementation. Items are marked **Decided** (agreed in review), **Proposed** (my suggestion, needs your approval) or **Open**.

## 1. Purpose

Read photo metadata directly from the phone's photo library and offer the places you were, day by day, for you to confirm. Photos are evidence of time and place. The app proposes and the user decides what is significant, because significance is personal.

## 2. What the first implementation showed

The first implementation scanned a real library and produced 138 place events. Findings that shaped this draft:

- The geocoder does not return a consistent level. 34 of 138 places had the region as their locality ("County Dublin"), and one home area resolved to eight different keys.
- Regional trips fragmented into villages (nine places in four days in Cinque Terre), and spelling variants split keys ("Porto Venere" and "Portovenere", two spellings of Shenzhen).
- Merged date ranges ran through other trips (a 165-day run across trips to Croatia, Italy and Germany), and 174 of 671 covered days had more than one place.
- Size is not significance. Single airport photos mark flight starts and matter to the user, and most home days do not.

The conclusion is that the app cannot decide the right level or the importance of a place. It should record evidence faithfully and let the user decide.

## 2a. Changes from the first implementation (for agents)

This table is inferred from the first implementation's export and the earlier drafts. I have not seen the code, so confirm each row against the repo before changing anything. Section 13 lists the completed packages and the new ones that make these changes.

| Area | First implementation (as seen in the export) | This spec | Action |
| --- | --- | --- | --- |
| Place data | Flat `placeEvents` with `start` and `end` dates and a `localityKey` | A place container with parent links, holding one-day entries | Rework |
| Run building | Consecutive days merged into ranges, which ran through other trips | No ranges. Visits are derived for display | Remove |
| Creation | Place events created directly by the scan | Suggestions in the Staging Hub, confirmed per entry | Rework |
| Status | None seen | Pending, accepted, dismissed, plus a bin and minimal markers | New |
| Staging UI | None seen | Hierarchy browsing, batch actions, hint ordering, Bin view | New |
| Deduplication | `dedupeKey` of place, key and day | Place plus day, and also matching dismissed items by photo IDs | Rework |
| Locality | Geocoder result, with the region as a fallback, and unstable keys | Evidence at the deepest level returned, with parents. Keys normalised, remaining variants merged by the user | Rework |
| Time resolution | `timingRule` (GPS-inferred or fallback) | Same | Keep |
| Photo evidence | Up to 10 references per place event | Up to 10 per day entry | Keep, re-scope |
| Scope options | Albums, date range, scan all | Same | Keep |
| Where the scan lives | Settings page | Sources page | Move |
| Confidence | `approximate` or `inferred`, rule not specified | Dropped. Staging hints replace it | Remove |
| Single-photo flag | `singlePhoto` | Kept as data, never used to hide an entry | Keep |
| Precedence tier | `tier` 2 on every event | Unchanged. Precedence is being redesigned separately | Keep |
| Existing data | 138 place events from a real scan | The app is not live, so reset and rescan. Keep the export as a test fixture | Reset |

## 3. Model

### Place (container)

- **Decided:** a place is a container, like a trip or series. Places sit in a natural geographic hierarchy: country, then region, then locality. Evidence attaches at the deepest level the geocoder returned, and a place knows its parents.
- If the geocoder returns only a region, the evidence sits on the region place. Nothing has to be rolled up or merged by a rule.

### Place entry (one day)

- **Decided:** a place entry is a single dated fact: this place, this day. A two-day stay in London is one place with two entries. A weekend in London plus a day trip two weeks later is one place with three entries.
- An entry holds its place, local day, source, photo count and a small set of photo references as evidence (**Proposed:** up to 10).
- **Decided:** there are no date ranges and no run builder. Visits (consecutive days) and trip membership are derived for display and are not stored. A day outside any defined trip sits in the unassigned pool.
- **Decided:** city level is not enforced. Each village is a place if the user wants it.
- **Decided:** venue-level activities (museums, matches, and so on) are not places. They belong to the event ontology and come from sources that name the venue.

### Status and the bin

- **Decided:** every entry is pending, accepted or dismissed. Dismissed entries sit in a bin the user can review (soft delete).
- **Decided:** soft delete applies to photo entries only for now, with the design kept general so it can extend to other event types later.
- **Proposed:** restoring an entry from the bin returns it to pending.
- **Proposed:** emptying the bin removes the details but keeps a minimal marker (the key and the photo IDs), so a re-scan still skips it. A "reset decisions" option clears the markers for anything the user wants offered again.

## 4. Staging

- **Decided:** photo places are never created automatically. They arrive in the Staging Hub as suggestions.
- **Decided:** staging is ordered by the hierarchy (country, region, locality). The user can accept or dismiss at any level, so accepting a region can take its localities with it, and accepting two villages out of five is fine.
- **Decided:** a new entry waits in staging for confirmation even when its place is already accepted. The place is the same, but the day is a separate claim.
- **Decided:** dismissing means the entries, never the place going forward. A batch dismiss clears everything pending for a place, and a later day still arrives for review. Home is therefore an ordinary place with a very different accept rate. There is no home zone and no special flag.
- **Decided:** the user can merge two suggested places into one, for spelling variants that key normalisation cannot catch. **Proposed:** the merged place keeps the other key as an alias, so a re-scan maps later photos in either spelling to it.
- **Proposed:** batch actions at every level: accept or dismiss all pending days for a place, region or country, with the dates visible before confirming.
- **Proposed:** significance hints, used for ordering and never for hiding:
  - photo count relative to the place's own typical day (a day at home with 40 photos stands out against a norm of 3),
  - an existing calendar entry on that date (for example a birthday),
  - absolute photo count.
- **Proposed:** unusual days surface first, with routine days collapsed below for a bulk dismiss. Single-photo days, such as airports, are never hidden.

## 5. Source type and scope

- **Decided:** on-device source. The only network activity is the anonymous locality lookup in section 8.
- **Decided:** the scan lives on the **Sources page**, as a source alongside the importers, and not on the Settings page (where the first implementation put it). The photo library entry shows its status, last scanned time, a Scan now action, progress with cancel, the pending count, and its scope settings. Results flow into the Staging Hub, so the dot on the sources icon covers photo suggestions too.
- **Proposed:** Settings keeps only global items for this source, such as the permission status and the privacy explanation.
- The Sources page is due a rework, so build the photo entry as a self-contained component that can move without changes to the scan itself.
- **Decided:** scan scope is selected albums, a date range, or **scan all**. Scan all is always available. It can be heavy, and that is the user's call.
- **Scan all behaviour:** a short heads-up before starting, batched processing with progress, cancel at any time, and resume from where it stopped. No photo outside the chosen scope is ever read.
- Request media library read access with a plain explanation. Request the location-metadata permission separately (Android hides GPS from media reads without it). If declined, run in time-only mode.
- Support limited (selected photos) access, and report how many photos are visible.

## 6. Fields read

| Field | Use |
| --- | --- |
| Capture time | Placement on the timeline |
| Timezone offset (if present) | Resolve local vs UTC |
| GPS latitude and longitude | Locality lookup |
| Media ID and file path or URI | Reference back to the photo |

Everything else is ignored and never stored.

## 7. Time and missing data

- Each photo is assigned a local day: use the EXIF offset if present, otherwise infer from GPS, otherwise use the nearest known trip leg or the phone's timezone. The rule used is recorded on each photo. (In the first export every photo with GPS used the GPS rule, so offsets are rare.)
- **No GPS:** the photo never creates a place. **Proposed:** it attaches as evidence to the entry for its day when exactly one place has an entry that day. Otherwise it is held as unlocated evidence for that day.
- **Location permission declined:** time-only mode. No entries are created, and photos attach to existing entries by day.
- **No capture time:** fall back to file modified time.
- **Decided:** screenshots and saved images are excluded. They should not carry GPS, so they never create an entry and no separate filter or camera field is needed.
- **Out of scope here:** whether photos taken around a flight attach to the leg as time evidence (for example an airport photo marking departure). This needs legs loaded and is a later piece of work.

## 8. Locality resolution

- **Decided:** a small resolver interface takes coordinates and returns a locality name, region, country and a key. The first implementation uses the phone's own geocoder (Android and iOS built-in reverse geocoding via the Expo location module). Google Maps Platform APIs are not used, because their terms limit storing results.
- **Decided:** lookups are anonymous: coarsened coordinates only, one lookup per distinct coarsened location per day, no timestamps or identifiers. Results are cached in the app database, which also keeps resolution stable between scans.
- **Decided:** key stability. Keys are normalised for case, accents, spaces and hyphens, so Portovenere and Porto Venere share a key. Variants that normalisation cannot catch (for example two transliterations of one Chinese city) are left to the user to merge in staging. There is no position-based matching.
- **Open:** confirm the storage terms of the platform geocoders for keeping results permanently.
- **If a lookup fails or the phone is offline:** the photos stay pending with their coordinates and are retried on the next scan. No entry is created until resolved.

## 9. Re-scan, matching and deduplication

- An entry is identified by place plus local day.
- **Decided:** dismissed entries are not offered again on the next scan.
- **Proposed:** a candidate also counts as dismissed when all its photos were in a dismissed entry, even if the geocoder named the place differently this time.
- **Proposed:** new photos on an accepted day add evidence to the existing entry with no new staging item. New photos on a dismissed day leave it dismissed.
- A new day for an accepted place creates a new pending entry (section 4).
- Re-scan is incremental, using a last-scanned marker per source, and is idempotent.
- Deleted photos: keep the entry and mark the reference as missing.

## 10. Source precedence and privacy

- **Decided:** photo place entries sit at equal precedence with calendar entries, with no conflict handling. A photo place and a calendar place can both exist with no flag, because only the user has the context to know which is right. Tickets and bookings still win on timings.
- Everything runs on the device except the anonymous lookup. Store references and derived metadata only. No copies of photos and no thumbnails.

## 11. Out of scope (for now)

- Venue-level visit detection from photos alone (it would need offline places data and would be offered as a suggestion).
- Soft delete beyond photo entries.
- The rework of the Sources page itself (planned separately).
- Face or object recognition, cloud photo libraries, video metadata.
- Google Maps Platform APIs, and Google Timeline as a source (a separate spec).

## 12. Acceptance checks

1. A London weekend (1st, 2nd) plus a day trip on the 14th produce one London place with three entries, and two derived visits.
2. Photos with no GPS never create an entry, and attach to the day's entry only when exactly one place has an entry that day.
3. Re-scan creates zero duplicates and adds nothing for dismissed entries, even if the geocoder names the place differently.
4. A new day in an accepted place appears as a pending entry. New photos on an accepted day only add evidence.
5. Accepting a region in staging accepts its localities. Accepting two of five villages leaves three pending.
6. Dismissing all pending days for a place does not hide a later day.
7. Restoring from the bin returns an entry to pending. After the bin is emptied, a re-scan still skips the entry, and "reset decisions" offers it again.
8. Unusual days (relative to the place's norm) appear before routine days, and single-photo days are never hidden.
9. Several suburbs of one city appear under one parent place, and several villages in one region appear under that region.
10. Same-day photos in two places produce an entry in each. A photo place differing from a calendar entry on the same day is not flagged.
11. Scope is respected for albums, a date range and scan all. A scan-all run can be cancelled and resumed without duplicates.
12. Lookups send only coarsened coordinates with no timestamps or identifiers, at most one per distinct place per day. With the phone offline, photos stay pending and are retried.
13. With location permission declined, the source runs in time-only mode and creates no entries.
14. Two suggested places that are spelling variants can be merged, and after a re-scan later photos in either spelling join the merged place.

## 13. Work packages

### Completed (first implementation)

These nine packages from draft 4 are built and done. They are not repeated. The descriptions below are from draft 4, and the code has not been reviewed here.

| Package | Built | Status after this spec |
| --- | --- | --- |
| WP1 Data model | Place events with date ranges | Done, superseded by WP10 |
| WP2 Media access layer | Scope (albums, date range, all) and batched reads | Done, unchanged |
| WP3 Time resolution | Local day and the rule used | Done, unchanged |
| WP4 Locality resolver | Platform geocoder, coarsening, cache, retry | Done, extended by WP11 |
| WP5 Place builder | Merges consecutive days into ranges | Done, replaced by WP12 |
| WP6 Staging mapper | Maps places to staged items | Done, replaced by WP13 |
| WP7 Sync and re-scan | Incremental scans and resume | Done, extended by WP15 |
| WP8 Settings UI | Scope and scan on the Settings page | Done, superseded by WP15 |
| WP9 Fixtures and acceptance tests | Tests for the draft 4 checks | Done, extended by WP16 |

### New work packages

Each package is sized for one agent. WP12 is pure and can be tested against fixtures without a device.

### WP10. Data model migration

- **Inputs:** section 3 and the table in 2a.
- **Outputs:** the place container with parent links (country, region, locality), alias keys for merged places, the one-day place entry (place, local day, source, photo evidence), the status (pending, accepted, dismissed), the minimal marker kept when the bin is emptied, and removal of the `confidence` field. The app is not live, so reset the dev data instead of migrating it.
- **Depends on:** nothing. Do first.
- **Done when:** types validate, existing sources are unaffected, and a London weekend plus a day trip is representable as one place with three entries.

### WP11. Locality hierarchy and key stability

- **Inputs:** section 8 and the variants found in the first export.
- **Outputs:** the resolver returns locality, region and country as a hierarchy. Evidence attaches at the deepest level returned, and a region is never relabelled as a locality. Keys are normalised for case, accents, spaces and hyphens. Variants that normalisation cannot catch are left for the user to merge (WP13).
- **Depends on:** WP10.
- **Done when:** the home-area variants resolve under their parents, the Cinque Terre villages stay separate localities under their region, and "Porto Venere" and "Portovenere" share one key. The two Shenzhen spellings are expected to stay separate until the user merges them.

### WP12. Entry builder (replaces the run builder)

- **Inputs:** photo records with local day and resolved locality, from the done packages.
- **Outputs:** place entries grouped by place and day with evidence attached to the hierarchy, and unlocated evidence for photos with no GPS. No date ranges.
- **Depends on:** WP10, WP11 (can be built against the fake resolver).
- **Done when:** fixtures cover multi-day stays, same-day multiple places, no-GPS photos and the London weekend plus day trip, and the run builder code is removed.

### WP13. Staging service

- **Inputs:** sections 3, 4 and 9, and the entries from WP12.
- **Outputs:** pending suggestions in the Staging Hub with no automatic creation, status changes, matching of candidates against dismissed items by key and by photo IDs, batch accept and dismiss at any hierarchy level, merging two places (the merged place keeps the other key as an alias), bin listing, restore, empty bin with markers, and reset decisions.
- **Depends on:** WP10, WP12.
- **Done when:** acceptance checks 3 to 7 pass.

### WP14. Staging UI and hints

- **Inputs:** section 4.
- **Outputs:** hierarchy browsing (country, region, locality), batch actions with the dates visible, a merge action for two places, ordering by significance hints (relative to the place's norm, a calendar entry on the date, absolute count) with routine days collapsed, and the Bin view.
- **Depends on:** WP13.
- **Done when:** a user can clear a trip in a few taps, restore from the bin, and sees unusual days first with nothing hidden.

### WP15. Sources page entry and re-scan changes

- **Inputs:** sections 5 and 9.
- **Outputs:** the photo source as a self-contained entry on the Sources page (status, last scanned, pending count, Scan now, progress, cancel, scope options) replacing the scan on Settings. Re-scan adds evidence silently to accepted days, creates pending entries for new days, and leaves dismissed days dismissed. The pending count reaches the dot on the sources icon.
- **Depends on:** WP13, and the existing sync and scope code.
- **Done when:** a scan runs from the Sources page, re-scan is idempotent, and checks 3, 4 and 11 pass.

### WP16. Fixtures and acceptance tests

- **Inputs:** section 12 and the first implementation's export.
- **Outputs:** fixtures (home-area variants, Cinque Terre villages, spelling variants, a day trip, no-GPS photos, a London weekend plus day trip) and an automated test for each of the fourteen checks.
- **Depends on:** WP10 first, then updated as WP11 to WP15 land.
- **Done when:** all fourteen checks run and pass.

### Suggested order

1. WP10 and WP16 (fixtures first).
2. WP11 and WP12 (WP12 against the fake resolver).
3. WP13.
4. WP14 and WP15.

## 14. Open and proposed items to settle

- Storage terms of the platform geocoders.
- Approval of the Proposed items: restore to pending, bin marker on emptying, matching dismissals by photo IDs, no-GPS attachment rule, hint ordering, the 10-reference cap.