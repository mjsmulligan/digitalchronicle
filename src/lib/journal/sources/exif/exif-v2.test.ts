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

import { describe, it, expect } from "vitest";

import {
  FIXTURE_LONDON_WEEKEND_PLUS_DAY_TRIP,
  FIXTURE_LONDON_WEEKEND,
  FIXTURE_LONDON_DAY_TRIP,
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
import { normaliseLocalityKey } from "./localityResolver";
import { buildPlaceEntries } from "./entryBuilder";
import {
  buildStagingPlan,
  acceptEntry,
  dismissEntry,
  restoreEntry,
  acceptPlaceEntries,
  dismissPlaceEntries,
  acceptRegionEntries,
  mergePlaces,
  emptyBin,
  resetDecisions,
} from "./stagingService";

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

  it("Porto Venere spelling variants normalise to two distinct keys (cannot be merged algorithmically)", async () => {
    const { located: a } = await resolveFixtureV2(FIXTURE_PORTO_VENERE_SPELLING_A, fakeLocalityResolverV2);
    const { located: b } = await resolveFixtureV2(FIXTURE_PORTO_VENERE_SPELLING_B, fakeLocalityResolverPortoVenereB);
    const keyA = a[0]?.locality.key;
    const keyB = b[0]?.locality.key;
    // WP11 normalisation: spaces → hyphens, so "Porto Venere" → "it:porto-venere"
    // but "Portovenere" → "it:portovenere" (no space to convert).
    // These are different spellings, not just different capitalisation — normalisation
    // cannot merge them. The user merges them via aliasKeys in the staging UI (check 14).
    expect(keyA).toBe("it:porto-venere");
    expect(keyB).toBe("it:portovenere");
    expect(keyA).not.toBe(keyB); // explicitly document the expected difference
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
  it("produces three BuiltPlaceEntries for London, one per day", async () => {
    const { located, unlocated } = await resolveFixtureV2(FIXTURE_LONDON_WEEKEND_PLUS_DAY_TRIP);
    const entries = buildPlaceEntries(located, unlocated, []);

    // All entries should be for London
    expect(entries.every((e) => e.localityKey === "gb:london")).toBe(true);
    // Three distinct days — one entry per day
    expect(entries).toHaveLength(3);
    const days = entries.map((e) => e.localDay).sort();
    expect(days).toEqual(["2025-07-05", "2025-07-06", "2025-07-19"]);
  });

  it("each entry carries the photos taken on that day", async () => {
    const { located, unlocated } = await resolveFixtureV2(FIXTURE_LONDON_WEEKEND_PLUS_DAY_TRIP);
    const entries = buildPlaceEntries(located, unlocated, []);

    const byDay = new Map(entries.map((e) => [e.localDay, e]));
    // Weekend days have 2 photos each; day trip has 2 photos
    expect(byDay.get("2025-07-05")?.photos).toHaveLength(2);
    expect(byDay.get("2025-07-06")?.photos).toHaveLength(2);
    expect(byDay.get("2025-07-19")?.photos).toHaveLength(2);
  });

  it("no BuiltPlaceEntry has a dateEnd field — visits are derived, not stored", async () => {
    const { located, unlocated } = await resolveFixtureV2(FIXTURE_LONDON_WEEKEND_PLUS_DAY_TRIP);
    const entries = buildPlaceEntries(located, unlocated, []);

    // BuiltPlaceEntry has localDay (single day) — no dateEnd in the shape
    for (const entry of entries) {
      expect("dateEnd" in entry).toBe(false);
    }
  });
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
  it("no-GPS photos alone produce zero BuiltPlaceEntries", async () => {
    // FIXTURE_NO_GPS has no lat/lon — all go to unlocated; no entries created
    const { located, unlocated } = await resolveFixtureV2(FIXTURE_NO_GPS);
    const entries = buildPlaceEntries(located, unlocated, []);

    expect(entries).toHaveLength(0);
  });

  it("no-GPS photos attach to the day's entry when exactly one place resolves that day", async () => {
    // Combine London multi-day (has GPS) with no-GPS photos on the same day (2025-07-14)
    const combined = [...FIXTURE_LONDON_MULTI_DAY, ...FIXTURE_NO_GPS];
    const { located, unlocated } = await resolveFixtureV2(combined);
    const entries = buildPlaceEntries(located, unlocated, []);

    // Still only London entries (no-GPS creates no new places)
    expect(entries.every((e) => e.localityKey === "gb:london")).toBe(true);

    // No-GPS photos are on 2025-07-14 — exactly one locality (London) has an entry that day
    const jul14 = entries.find((e) => e.localDay === "2025-07-14");
    expect(jul14?.unlocatedPhotos.length).toBe(FIXTURE_NO_GPS.length);
  });

  it("no-GPS photos on a day with two different localities are not attached (ambiguous)", async () => {
    // Use Cinque Terre: Vernazza and Monterosso both have photos on 2025-08-10
    const { located, unlocated } = await resolveFixtureV2(FIXTURE_CINQUE_TERRE);
    // Inject an unlocated photo on 2025-08-10 (same day as Vernazza + Monterosso)
    const noGpsOnSharedDay = [{ ...FIXTURE_NO_GPS[0], localDay: "2025-08-10", mediaId: "no-gps-ct" }];
    const allUnlocated = [...unlocated, ...noGpsOnSharedDay.map((p) => ({ ...p, locality: null as null }))];
    const entries = buildPlaceEntries(located, allUnlocated, []);

    // Two localities on 2025-08-10 → no-GPS photo is not attached to either
    const aug10 = entries.filter((e) => e.localDay === "2025-08-10");
    expect(aug10.length).toBe(2); // Vernazza + Monterosso
    const totalUnlocated = aug10.reduce((n, e) => n + e.unlocatedPhotos.length, 0);
    expect(totalUnlocated).toBe(0); // not attached — ambiguous
  });
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
  it("second scan of the same photos creates zero new PlaceEntries", async () => {
    const { located, unlocated } = await resolveFixtureV2(FIXTURE_LONDON_WEEKEND_PLUS_DAY_TRIP);
    const built = buildPlaceEntries(located, unlocated, []);

    // First scan
    const plan1 = buildStagingPlan(built, [], [], []);
    expect(plan1.newEntries.length).toBeGreaterThan(0);

    // Second scan — same photos, existing entries from first scan
    const plan2 = buildStagingPlan(built, plan1.newPlaces, plan1.newEntries, []);
    expect(plan2.newEntries).toHaveLength(0);
    expect(plan2.newPlaces).toHaveLength(0);
    expect(plan2.updatedEntries).toHaveLength(0);
  });

  it("dismissed entry is not re-offered on re-scan (dedupeKey match)", async () => {
    const { located, unlocated } = await resolveFixtureV2(FIXTURE_LONDON_WEEKEND_PLUS_DAY_TRIP);
    const built = buildPlaceEntries(located, unlocated, []);

    // First scan → pending entries
    const plan1 = buildStagingPlan(built, [], [], []);
    // Dismiss all entries
    const dismissed = plan1.newEntries.map(dismissEntry);

    // Second scan — dismissed entries exist, no markers yet
    const plan2 = buildStagingPlan(built, plan1.newPlaces, dismissed, []);
    expect(plan2.newEntries).toHaveLength(0); // dismissed → not re-offered
  });

  it("dismissed entry not re-offered when geocoder returns different name (matched by photo IDs via marker)", async () => {
    // Original scan with "Porto Venere" spelling
    const { located: a } = await resolveFixtureV2(FIXTURE_PORTO_VENERE_SPELLING_A, fakeLocalityResolverV2);
    const builtA = buildPlaceEntries(a, [], []);
    const plan1 = buildStagingPlan(builtA, [], [], []);
    // Dismiss and empty bin → creates marker with photo IDs
    const dismissed1 = plan1.newEntries.map(dismissEntry);
    const { markersToCreate } = emptyBin(dismissed1);

    // Re-scan returns same coords but geocoder now says "Portovenere" (different key)
    const { located: b } = await resolveFixtureV2(
      FIXTURE_PORTO_VENERE_SPELLING_A, // same photos, same coords
      fakeLocalityResolverPortoVenereB, // but different geocoder result
    );
    const builtB = buildPlaceEntries(b, [], []);
    // Same photos → different locality key, but markers cover all photo IDs
    const plan2 = buildStagingPlan(builtB, [], [], markersToCreate);
    expect(plan2.newEntries).toHaveLength(0); // all photos covered by marker → skip
  });
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
  it("new day for an accepted place arrives as a pending PlaceEntry", async () => {
    // First scan: weekend only (05 + 06)
    const { located: l1, unlocated: u1 } = await resolveFixtureV2(FIXTURE_LONDON_WEEKEND);
    const built1 = buildPlaceEntries(l1, u1, []);
    const plan1 = buildStagingPlan(built1, [], [], []);
    // Accept the weekend entries
    const acceptedEntries = plan1.newEntries.map(acceptEntry);

    // Second scan: day trip on 2025-07-19 is new
    const { located: l2, unlocated: u2 } = await resolveFixtureV2(FIXTURE_LONDON_DAY_TRIP);
    const built2 = buildPlaceEntries(l2, u2, []);
    const plan2 = buildStagingPlan(built2, plan1.newPlaces, acceptedEntries, []);

    // New day → new pending entry (even though the Place is already accepted)
    expect(plan2.newEntries).toHaveLength(1);
    expect(plan2.newEntries[0].localDay).toBe("2025-07-19");
    expect(plan2.newEntries[0].status).toBe("pending");
    expect(plan2.newEntries[0].placeId).toBe(plan1.newPlaces[0].id); // same Place
  });

  it("new photos on an accepted day add evidence without creating a new staging item", async () => {
    // First scan: one photo on 2025-07-05
    const onePhoto = [FIXTURE_LONDON_WEEKEND[0]]; // lon-wknd-1
    const { located: l1, unlocated: u1 } = await resolveFixtureV2(onePhoto);
    const built1 = buildPlaceEntries(l1, u1, []);
    const plan1 = buildStagingPlan(built1, [], [], []);
    const accepted = plan1.newEntries.map(acceptEntry);
    expect(accepted[0].photoCount).toBe(1);

    // Second scan: two more photos on the same day
    const { located: l2, unlocated: u2 } = await resolveFixtureV2(FIXTURE_LONDON_WEEKEND.slice(0, 2));
    const built2 = buildPlaceEntries(l2, u2, []);
    const plan2 = buildStagingPlan(built2, plan1.newPlaces, accepted, []);

    // No new staging item — existing accepted entry gets updated evidence
    expect(plan2.newEntries).toHaveLength(0);
    expect(plan2.updatedEntries).toHaveLength(1);
    // Photo count increases
    expect(plan2.updatedEntries[0].photoCount).toBe(2);
  });
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
  it("accepting the Liguria region accepts all pending entries under its village localities", async () => {
    const { located, unlocated } = await resolveFixtureV2(FIXTURE_CINQUE_TERRE);
    const built = buildPlaceEntries(located, unlocated, []);
    const plan = buildStagingPlan(built, [], [], []);

    // All entries should be pending initially
    expect(plan.newEntries.every((e) => e.status === "pending")).toBe(true);
    // 5 villages × up to 2 days each = 9 photos → multiple entries
    const allEntries = plan.newEntries;
    const allPlaces  = plan.newPlaces;

    // Batch-accept by Liguria region
    const changed = acceptRegionEntries(allEntries, allPlaces, "Liguria");
    expect(changed.length).toBe(allEntries.length); // all CT entries are in Liguria
    expect(changed.every((e) => e.status === "accepted")).toBe(true);
  });

  it("accepting two of five Cinque Terre villages leaves the other three pending", async () => {
    const { located, unlocated } = await resolveFixtureV2(FIXTURE_CINQUE_TERRE);
    const built = buildPlaceEntries(located, unlocated, []);
    const { newEntries, newPlaces } = buildStagingPlan(built, [], [], []);

    // Find Vernazza and Monterosso places and accept their entries only
    const vernazzaPlace    = newPlaces.find((p) => p.localityKey === "it:vernazza");
    const monterossoPlace  = newPlaces.find((p) => p.localityKey === "it:monterosso");
    expect(vernazzaPlace).toBeDefined();
    expect(monterossoPlace).toBeDefined();

    const acceptedV = acceptPlaceEntries(newEntries, vernazzaPlace!.id);
    const acceptedM = acceptPlaceEntries(newEntries, monterossoPlace!.id);

    const otherEntries = newEntries.filter(
      (e) => e.placeId !== vernazzaPlace!.id && e.placeId !== monterossoPlace!.id,
    );
    // Three remaining villages still pending
    const otherKeys = new Set(
      newPlaces
        .filter((p) => p.localityKey !== "it:vernazza" && p.localityKey !== "it:monterosso")
        .map((p) => p.id),
    );
    const stillPending = otherEntries.filter((e) => otherKeys.has(e.placeId));
    expect(stillPending.length).toBeGreaterThan(0);
    expect(stillPending.every((e) => e.status === "pending")).toBe(true);
    expect(acceptedV.length + acceptedM.length).toBeGreaterThan(0);
  });
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
  it("dismissing all pending entries for a place does not block future days", async () => {
    // First scan: London weekend (05 + 06), dismiss all
    const { located: l1, unlocated: u1 } = await resolveFixtureV2(FIXTURE_LONDON_WEEKEND);
    const built1 = buildPlaceEntries(l1, u1, []);
    const plan1 = buildStagingPlan(built1, [], [], []);
    const dismissed = plan1.newEntries.map(dismissEntry);

    // Second scan: new day 2025-07-19 — dismissed entries have no bin marker yet
    const { located: l2, unlocated: u2 } = await resolveFixtureV2(FIXTURE_LONDON_DAY_TRIP);
    const built2 = buildPlaceEntries(l2, u2, []);
    const plan2 = buildStagingPlan(built2, plan1.newPlaces, dismissed, []);

    // New day should still appear — dismissed status only blocks its own dedupeKey
    expect(plan2.newEntries).toHaveLength(1);
    expect(plan2.newEntries[0].localDay).toBe("2025-07-19");
  });

  it("a later scan for a new day creates a fresh pending entry for the same place", async () => {
    // Dismiss the weekend, empty the bin (creates markers for 05 + 06 photo IDs)
    const { located: l1, unlocated: u1 } = await resolveFixtureV2(FIXTURE_LONDON_WEEKEND);
    const built1 = buildPlaceEntries(l1, u1, []);
    const plan1 = buildStagingPlan(built1, [], [], []);
    const dismissed = plan1.newEntries.map(dismissEntry);
    const { markersToCreate } = emptyBin(dismissed);

    // Re-scan with day trip photos — these are NEW photo IDs not in the markers
    const { located: l2, unlocated: u2 } = await resolveFixtureV2(FIXTURE_LONDON_DAY_TRIP);
    const built2 = buildPlaceEntries(l2, u2, []);
    // No existing entries (they were deleted when bin was emptied), markers present
    const plan2 = buildStagingPlan(built2, plan1.newPlaces, [], markersToCreate);

    // New day trip is a brand-new pending entry
    expect(plan2.newEntries).toHaveLength(1);
    expect(plan2.newEntries[0].status).toBe("pending");
    expect(plan2.newEntries[0].localDay).toBe("2025-07-19");
    // It links to the same Place (key-match finds existing place)
    expect(plan2.newEntries[0].placeId).toBe(plan1.newPlaces[0].id);
  });
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
  it("restoring a dismissed entry sets its status back to pending", async () => {
    const { located, unlocated } = await resolveFixtureV2(FIXTURE_LONDON_WEEKEND);
    const built = buildPlaceEntries(located, unlocated, []);
    const { newEntries } = buildStagingPlan(built, [], [], []);

    const dismissed = newEntries.map(dismissEntry);
    expect(dismissed.every((e) => e.status === "dismissed")).toBe(true);

    const restored = dismissed.map(restoreEntry);
    expect(restored.every((e) => e.status === "pending")).toBe(true);
  });

  it("emptying the bin returns IDs to delete and a marker for each dismissed entry", async () => {
    const { located, unlocated } = await resolveFixtureV2(FIXTURE_LONDON_WEEKEND);
    const built = buildPlaceEntries(located, unlocated, []);
    const { newEntries } = buildStagingPlan(built, [], [], []);

    const dismissed = newEntries.map(dismissEntry);
    const { entriesToDelete, markersToCreate } = emptyBin(dismissed);

    // One marker per dismissed entry
    expect(entriesToDelete).toHaveLength(dismissed.length);
    expect(markersToCreate).toHaveLength(dismissed.length);
    // Each marker covers the photo IDs from its entry
    for (const marker of markersToCreate) {
      const src = dismissed.find((e) => e.localityKey === marker.localityKey && e.localDay === marker.localDay);
      expect(src).toBeDefined();
      const expectedIds = src!.photoEvidence.map((r) => r.mediaId);
      expect(marker.photoIds).toEqual(expect.arrayContaining(expectedIds));
    }
  });

  it("re-scan after bin is emptied skips photos whose IDs are in the marker", async () => {
    const { located, unlocated } = await resolveFixtureV2(FIXTURE_LONDON_WEEKEND);
    const built = buildPlaceEntries(located, unlocated, []);
    const plan1 = buildStagingPlan(built, [], [], []);
    const dismissed = plan1.newEntries.map(dismissEntry);
    const { markersToCreate } = emptyBin(dismissed);

    // Re-scan same photos — entries deleted, markers present
    const plan2 = buildStagingPlan(built, plan1.newPlaces, [], markersToCreate);
    expect(plan2.newEntries).toHaveLength(0);
    expect(plan2.newPlaces).toHaveLength(0);
  });

  it("reset decisions removes markers and returns dismissed entries to pending", async () => {
    const { located, unlocated } = await resolveFixtureV2(FIXTURE_LONDON_WEEKEND);
    const built = buildPlaceEntries(located, unlocated, []);
    const plan1 = buildStagingPlan(built, [], [], []);
    const dismissed = plan1.newEntries.map(dismissEntry);
    const { markersToCreate } = emptyBin(dismissed);

    // Reset: markers deleted, entries restored to pending
    const { updatedEntries, markerIdsToDelete } = resetDecisions(dismissed, markersToCreate);
    expect(updatedEntries.every((e) => e.status === "pending")).toBe(true);
    expect(markerIdsToDelete).toHaveLength(markersToCreate.length);

    // Re-scan with no markers and restored entries → treated as pending (no new entries)
    const plan3 = buildStagingPlan(built, plan1.newPlaces, updatedEntries, []);
    expect(plan3.newEntries).toHaveLength(0); // already in pending staging
    expect(plan3.newPlaces).toHaveLength(0);
  });
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
  it("normaliseLocalityKey produces consistent lowercase-hyphenated keys", () => {
    expect(normaliseLocalityKey("GB", "London")).toBe("gb:london");
    expect(normaliseLocalityKey("IE", "Dublin")).toBe("ie:dublin");
    expect(normaliseLocalityKey("IE", "County Dublin")).toBe("ie:county-dublin");
    expect(normaliseLocalityKey("IT", "Vernazza")).toBe("it:vernazza");
    expect(normaliseLocalityKey("IT", "Monterosso")).toBe("it:monterosso");
    expect(normaliseLocalityKey("IT", "Porto Venere")).toBe("it:porto-venere");
    expect(normaliseLocalityKey("IT", "Portovenere")).toBe("it:portovenere");
    expect(normaliseLocalityKey("DE", "München")).toBe("de:munchen");
    expect(normaliseLocalityKey("BR", "São Paulo")).toBe("br:sao-paulo");
  });

  it("County Dublin has level 'region'; Dublin city has level 'locality'", async () => {
    const { located } = await resolveFixtureV2(FIXTURE_HOME_AREA_VARIANTS);
    const dublinEntries = located.filter((p) => p.locality.key === "ie:dublin");
    const countyEntries = located.filter((p) => p.locality.key === "ie:county-dublin");

    expect(dublinEntries.length).toBeGreaterThan(0);
    expect(countyEntries.length).toBeGreaterThan(0);

    expect(dublinEntries.every((p) => p.locality.level === "locality")).toBe(true);
    expect(countyEntries.every((p) => p.locality.level === "region")).toBe(true);
  });

  it("five Cinque Terre villages produce five distinct BuiltPlaceEntries", async () => {
    const { located, unlocated } = await resolveFixtureV2(FIXTURE_CINQUE_TERRE);
    const entries = buildPlaceEntries(located, unlocated, []);

    const keys = new Set(entries.map((e) => e.localityKey));
    expect(keys).toContain("it:vernazza");
    expect(keys).toContain("it:monterosso");
    expect(keys).toContain("it:riomaggiore");
    expect(keys).toContain("it:corniglia");
    expect(keys).toContain("it:manarola");
    expect(keys.size).toBe(5); // all five are separate — no merging
  });

  it("Vernazza and Monterosso on the same day are two separate entries, not one merged entry", async () => {
    const { located, unlocated } = await resolveFixtureV2(FIXTURE_CINQUE_TERRE);
    const entries = buildPlaceEntries(located, unlocated, []);

    // 2025-08-10: photos in both Vernazza and Monterosso
    const aug10 = entries.filter((e) => e.localDay === "2025-08-10");
    expect(aug10).toHaveLength(2);
    const keys10 = new Set(aug10.map((e) => e.localityKey));
    expect(keys10).toContain("it:vernazza");
    expect(keys10).toContain("it:monterosso");
  });

  it("all Cinque Terre village entries carry the Liguria region", async () => {
    const { located, unlocated } = await resolveFixtureV2(FIXTURE_CINQUE_TERRE);
    const entries = buildPlaceEntries(located, unlocated, []);

    expect(entries.every((e) => e.region === "Liguria")).toBe(true);
    expect(entries.every((e) => e.country === "Italy")).toBe(true);
  });
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
  it("merging Porto Venere and Portovenere produces one Place with both keys", async () => {
    // First: scan with "Porto Venere" spelling → one Place created
    const { located: a } = await resolveFixtureV2(FIXTURE_PORTO_VENERE_SPELLING_A, fakeLocalityResolverV2);
    const builtA = buildPlaceEntries(a, [], []);
    const planA = buildStagingPlan(builtA, [], [], []);
    expect(planA.newPlaces).toHaveLength(1);
    const portoVenerePlace = planA.newPlaces[0];
    expect(portoVenerePlace.localityKey).toBe("it:porto-venere");

    // Second: scan with "Portovenere" spelling → new distinct Place
    const { located: b } = await resolveFixtureV2(FIXTURE_PORTO_VENERE_SPELLING_B, fakeLocalityResolverPortoVenereB);
    const builtB = buildPlaceEntries(b, [], []);
    const planB = buildStagingPlan(builtB, planA.newPlaces, planA.newEntries, []);
    expect(planB.newPlaces).toHaveLength(1);
    const portovenerePlace = planB.newPlaces[0];
    expect(portovenerePlace.localityKey).toBe("it:portovenere");

    // Merge: "Portovenere" absorbed into "Porto Venere"
    const merged = mergePlaces(portoVenerePlace, portovenerePlace);
    expect(merged.localityKey).toBe("it:porto-venere"); // survivor keeps its key
    expect(merged.aliasKeys).toContain("it:portovenere"); // absorbed key becomes alias
    expect(merged.aliasKeys).not.toContain("it:porto-venere"); // own key not in aliases
  });

  it("re-scan with the Portovenere resolver maps new photos to the merged Porto Venere place", async () => {
    // Set up merged place (survivor = Porto Venere, alias = Portovenere)
    const { located: a } = await resolveFixtureV2(FIXTURE_PORTO_VENERE_SPELLING_A, fakeLocalityResolverV2);
    const builtA = buildPlaceEntries(a, [], []);
    const planA = buildStagingPlan(builtA, [], [], []);
    const portoVenerePlace = planA.newPlaces[0];

    const { located: b } = await resolveFixtureV2(FIXTURE_PORTO_VENERE_SPELLING_B, fakeLocalityResolverPortoVenereB);
    const builtB = buildPlaceEntries(b, [], []);
    const planB = buildStagingPlan(builtB, planA.newPlaces, planA.newEntries, []);
    const portovenerePlace = planB.newPlaces[0];

    const mergedPlace = mergePlaces(portoVenerePlace, portovenerePlace);
    // Journal now has one merged place (portovenerePlace deleted), both sets of entries
    const allEntries = [...planA.newEntries, ...planB.newEntries];

    // Re-scan with Portovenere resolver — new photos with "it:portovenere" key
    const { located: c } = await resolveFixtureV2(FIXTURE_PORTO_VENERE_SPELLING_B, fakeLocalityResolverPortoVenereB);
    const builtC = buildPlaceEntries(c, [], []);
    // Use only the merged place — alias map routes "it:portovenere" to survivor
    const planC = buildStagingPlan(builtC, [mergedPlace], allEntries, []);

    // No new places — alias routing found the survivor
    expect(planC.newPlaces).toHaveLength(0);
    // No new pending entries — same photos, already in staging
    expect(planC.newEntries).toHaveLength(0);
  });
});
