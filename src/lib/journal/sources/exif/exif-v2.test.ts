/**
 * WP16 — Acceptance tests for the draft 7 EXIF pipeline.
 *
 * Spec reference: docs/specs/Source spec_ Photo library (EXIF).md, section 12.
 *
 * Each test corresponds to one of the 14 acceptance checks. Tests are marked
 * `todo` and filled in as WP11 through WP15 land. WP10 fixtures and factories
 * are wired up now so the stubs can be extended without restructuring.
 *
 * Suggested fill order (spec section 13):
 *   WP10 + WP16  ← this file (stubs)
 *   WP11 + WP12  ← checks 9, 14, plus 1 and 2 (entry builder)
 *   WP13         ← checks 3, 4, 5, 6, 7
 *   WP14 + WP15  ← checks 8, 11, 12, 13
 */

import { describe, it, expect, todo } from "vitest";

import {
  FIXTURE_LONDON_WEEKEND_PLUS_DAY_TRIP,
  FIXTURE_HOME_AREA_VARIANTS,
  FIXTURE_CINQUE_TERRE,
  FIXTURE_PORTO_VENERE_SPELLING_A,
  FIXTURE_PORTO_VENERE_SPELLING_B,
  FIXTURE_NO_GPS,
  FIXTURE_LONDON_MULTI_DAY,
  makePlace,
  makePlaceEntry,
  makePlaceBinMarker,
  fakeLocalityResolverV2,
  fakeLocalityResolverPortoVenereB,
  resolveFixtureV2,
} from "./fixtures";

// ─── Smoke: fixtures and factories compile ────────────────────────────────────

describe("WP16 smoke: fixtures and factories", () => {
  it("weekend + day trip fixture has 6 photos across 3 days", () => {
    const days = new Set(FIXTURE_LONDON_WEEKEND_PLUS_DAY_TRIP.map((p) => p.localDay));
    expect(days.size).toBe(3);
    expect(FIXTURE_LONDON_WEEKEND_PLUS_DAY_TRIP.length).toBe(6);
  });

  it("Cinque Terre fixture has photos in 5 different localities", async () => {
    const { located } = await resolveFixtureV2(FIXTURE_CINQUE_TERRE);
    const keys = new Set(located.map((p) => p.locality.key));
    expect(keys.size).toBe(5);
  });

  it("Porto Venere spelling variants resolve to different keys (before WP11 normalisation)", async () => {
    const { located: a } = await resolveFixtureV2(FIXTURE_PORTO_VENERE_SPELLING_A, fakeLocalityResolverV2);
    const { located: b } = await resolveFixtureV2(FIXTURE_PORTO_VENERE_SPELLING_B, fakeLocalityResolverPortoVenereB);
    const keyA = a[0]?.locality.key;
    const keyB = b[0]?.locality.key;
    // Before WP11: different keys. After WP11 normalisation they will share one key.
    expect(keyA).toBe("it:porto-venere");
    expect(keyB).toBe("it:portovenere");
  });

  it("makePlace, makePlaceEntry, makePlaceBinMarker produce valid objects", () => {
    const place = makePlace({ locality: "Rome", country: "Italy", localityKey: "it:rome" });
    expect(place.kind).toBe("place");
    expect(place.localityKey).toBe("it:rome");

    const entry = makePlaceEntry({ placeId: place.id, localityKey: "it:rome", localDay: "2025-06-01" });
    expect(entry.kind).toBe("place-entry");
    expect(entry.start).toBe(entry.localDay); // Base.start mirrors localDay

    const marker = makePlaceBinMarker({ localityKey: "it:rome", localDay: "2025-06-01" });
    expect(marker.localityKey).toBe("it:rome");
  });
});

// ─── Acceptance check 1 ───────────────────────────────────────────────────────

describe("Check 1: London weekend + day trip → one place, three entries, two visits", () => {
  /**
   * A London weekend (Sat 2025-07-05 + Sun 2025-07-06) plus a day trip on
   * Sat 2025-07-19 produces ONE Place container with THREE PlaceEntries.
   * Two derived visits: the consecutive weekend (05–06) and the lone day (19).
   * No date ranges are stored; visits are derived for display.
   *
   * Depends on: WP12 (entry builder).
   */
  it.todo("produces one London Place with three PlaceEntries");
  it.todo("entries have localDay 2025-07-05, 2025-07-06 and 2025-07-19");
  it.todo("derives two visits: [05–06] and [19]");
  it.todo("no Base.end is set on any PlaceEntry");
});

// ─── Acceptance check 2 ───────────────────────────────────────────────────────

describe("Check 2: Photos with no GPS never create an entry", () => {
  /**
   * Photos with no GPS (latitude/longitude null) never create a new PlaceEntry.
   * They attach as evidence to the day's entry only when exactly one place has
   * an entry that day.
   *
   * Depends on: WP12 (entry builder).
   */
  it.todo("no-GPS photos do not create a PlaceEntry");
  it.todo("no-GPS photos attach to the day's entry when exactly one place has an entry that day");
  it.todo("no-GPS photos are held as unlocated evidence when multiple places exist for the day");
});

// ─── Acceptance check 3 ───────────────────────────────────────────────────────

describe("Check 3: Re-scan creates zero duplicates; dismissed entries not re-offered", () => {
  /**
   * Running the same scan twice produces no new PlaceEntries on the second pass.
   * Dismissed entries are not offered again, even if the geocoder names the place
   * differently this time (matched by photo IDs in the PlaceBinMarker).
   *
   * Depends on: WP13 (staging service).
   */
  it.todo("second scan of the same photos creates zero new PlaceEntries");
  it.todo("dismissed entry is not re-offered even with a different locality name");
  it.todo("dismissed entry matched by photo IDs when locality key differs");
});

// ─── Acceptance check 4 ───────────────────────────────────────────────────────

describe("Check 4: New day in accepted place appears pending; new photos on accepted day add evidence", () => {
  /**
   * A new calendar day for an already-accepted Place creates a new pending
   * PlaceEntry. New photos on a day where an entry already exists are added as
   * evidence to that entry without creating a new staging item.
   *
   * Depends on: WP13 (staging service).
   */
  it.todo("new day for an accepted place arrives as a pending PlaceEntry");
  it.todo("new photos on an accepted day add evidence, no new staging item");
});

// ─── Acceptance check 5 ───────────────────────────────────────────────────────

describe("Check 5: Accepting a region accepts its localities; partial accept is fine", () => {
  /**
   * Batch-accepting a region Place accepts all pending PlaceEntries under its
   * locality children. Accepting two of five Cinque Terre villages leaves the
   * other three pending.
   *
   * Depends on: WP13 (staging service), WP11 (hierarchy).
   */
  it.todo("accepting Liguria region accepts all pending entries under its localities");
  it.todo("accepting two of five villages leaves three pending");
});

// ─── Acceptance check 6 ───────────────────────────────────────────────────────

describe("Check 6: Dismissing all pending days for a place does not hide a later day", () => {
  /**
   * Dismissing every pending PlaceEntry for a Place does not prevent future
   * days from being offered. A later scan that finds a new day still creates
   * a pending entry.
   *
   * Depends on: WP13 (staging service).
   */
  it.todo("dismissing all pending entries for a place does not block future days");
  it.todo("a later scan for a new day creates a fresh pending entry for the same place");
});

// ─── Acceptance check 7 ───────────────────────────────────────────────────────

describe("Check 7: Restore from bin returns entry to pending; after bin emptied re-scan still skips", () => {
  /**
   * Restoring a PlaceEntry from the bin returns it to pending status.
   * After the bin is emptied a PlaceBinMarker is kept, so a re-scan still
   * skips the same photos. A "reset decisions" action removes markers,
   * allowing the entry to be offered again.
   *
   * Depends on: WP13 (staging service).
   */
  it.todo("restoring from the bin sets status back to pending");
  it.todo("emptying the bin deletes the PlaceEntry but keeps a PlaceBinMarker");
  it.todo("re-scan after bin emptied skips photos covered by the marker");
  it.todo("reset decisions removes the marker; re-scan offers the entry again");
});

// ─── Acceptance check 8 ───────────────────────────────────────────────────────

describe("Check 8: Unusual days appear before routine days; single-photo days never hidden", () => {
  /**
   * The staging UI orders entries by significance hints:
   *   1. Photo count relative to the place's own typical day (unusual = above norm)
   *   2. Calendar entry on that date
   *   3. Absolute photo count
   * Routine days are collapsed below (never hidden). Single-photo days (airports)
   * are always visible — never hidden or pre-dismissed.
   *
   * Depends on: WP14 (staging UI).
   */
  it.todo("a day with 10x the place's norm appears before days at norm");
  it.todo("a day with one photo is still in the list (never hidden)");
  it.todo("a day matching a calendar entry is surfaced before unmatched days");
});

// ─── Acceptance check 9 ───────────────────────────────────────────────────────

describe("Check 9: Suburbs under one parent; Cinque Terre villages under their region", () => {
  /**
   * Several suburbs of one city appear under one parent Place. The five Cinque
   * Terre villages each remain separate locality places, all under the Liguria
   * region parent.
   *
   * Depends on: WP11 (locality hierarchy), WP12 (entry builder).
   */
  it.todo("Dublin suburbs resolve under one Dublin parent Place");
  it.todo("County Dublin entries appear under a Leinster or Ireland parent, separate from Dublin city");
  it.todo("five Cinque Terre villages each have their own Place under Liguria");
  it.todo("Vernazza and Monterosso on the same day are two entries, not one merged entry");
});

// ─── Acceptance check 10 ─────────────────────────────────────────────────────

describe("Check 10: Same-day photos in two places produce one entry each; no conflict flag", () => {
  /**
   * If photos on the same day resolve to two different localities each gets
   * its own PlaceEntry. A photo-library place coexisting with a calendar entry
   * on the same day is not flagged as a conflict.
   *
   * Depends on: WP12 (entry builder), WP13 (staging).
   */
  it.todo("same-day photos in Vernazza and Monterosso produce two PlaceEntries");
  it.todo("a photo place and a calendar entry on the same day coexist without a conflict flag");
});

// ─── Acceptance check 11 ─────────────────────────────────────────────────────

describe("Check 11: Scan scope respected; scan-all can be cancelled and resumed", () => {
  /**
   * Album scope, date-range scope, and scan-all each scan only the appropriate
   * assets. A scan-all run that is cancelled and resumed produces no duplicates
   * and picks up from where it left off.
   *
   * Depends on: WP15 (Sources page entry and re-scan).
   */
  it.todo("album scope only processes assets in the specified album");
  it.todo("date-range scope only processes assets within the date range");
  it.todo("cancelling and resuming a scan-all run produces no duplicates");
});

// ─── Acceptance check 12 ─────────────────────────────────────────────────────

describe("Check 12: Geocoder sends only coarsened coordinates; offline photos stay pending", () => {
  /**
   * Locality lookups send coarsened coordinates (2 decimal places) with no
   * timestamps or identifiers. At most one lookup per distinct coarsened cell
   * per day. With the phone offline photos stay pending and are retried on
   * the next scan.
   *
   * Depends on: WP11 (locality resolver), WP15 (re-scan).
   */
  it.todo("coarsened coordinates match 2-decimal-place rounding");
  it.todo("two photos with the same coarsened cell on the same day trigger one lookup");
  it.todo("offline failure keeps photos pending; next scan resolves them");
});

// ─── Acceptance check 13 ─────────────────────────────────────────────────────

describe("Check 13: Location permission declined → time-only mode, no entries created", () => {
  /**
   * When location permission is declined the source runs in time-only mode.
   * No PlaceEntries are created, but photos attach to existing entries by day.
   *
   * Depends on: WP15 (Sources page entry).
   */
  it.todo("declining location permission puts the source in time-only mode");
  it.todo("time-only mode creates no PlaceEntries");
});

// ─── Acceptance check 14 ─────────────────────────────────────────────────────

describe("Check 14: Spelling variants can be merged; re-scan maps later photos to merged place", () => {
  /**
   * Two suggested places that are spelling variants ("Porto Venere" / "Portovenere")
   * can be merged by the user. After the merge the other key becomes an alias on
   * the surviving Place. A subsequent scan with photos that resolve to either key
   * maps them to the same Place.
   *
   * Depends on: WP13 (staging service — merge action + aliasKeys).
   */
  it.todo("merging Porto Venere and Portovenere produces one Place with aliasKeys");
  it.todo("re-scan with the Portovenere resolver maps photos to the merged Porto Venere place");
});
