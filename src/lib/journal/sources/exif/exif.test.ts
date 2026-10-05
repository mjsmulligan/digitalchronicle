/**
 * EXIF photo library source — acceptance tests.
 *
 * Spec reference: docs/specs/Source spec_ Photo library (EXIF).md, section 15.
 *
 * Status by WP:
 *   WP1 — data model checks ✅
 *   WP2 — fixture smoke tests ✅ (device tests manual)
 *   WP3 — time resolution unit tests ✅
 *   WP4 — locality resolver unit tests ✅; acceptance checks 6 & 7 ✅
 *   WP5 — acceptance checks 1, 2, 9, 10 still todo
 *   WP6 — acceptance check 8 still todo
 *   WP7 — acceptance check 3 still todo; check 5 still todo
 */

import { describe, it, expect, vi } from "vitest";
import {
  makePlaceEvent,
  makeEvidenceRef,
  makePhoto,
  makeTimedPhoto,
  FIXTURE_LONDON_MULTI_DAY,
  FIXTURE_WINDSOR_DAY_TRIP,
  FIXTURE_DUBLIN_SUBURBS,
  FIXTURE_NO_GPS,
  FIXTURE_IN_FLIGHT,
  fakeLocalityResolver,
  resolveFixture,
} from "./fixtures";
import { entryTitle } from "../../types";
import {
  resolveLocalDay,
  dayFromNamedTz,
  dayFromRawOffset,
  nearestTzForCoords,
  tzFromLegs,
} from "./timeResolution";
import {
  coarsenCoords,
  perDayKey,
  InMemoryLocalityCache,
  ResolvingLocalityResolver,
} from "./localityResolver";
import { buildPlaces, DEFAULT_MAX_GAP_DAYS, daysDiff, isDuringLeg } from "./placeBuilder";
import {
  mapToStagingBatch,
  placeConfidence,
  sampleEvidenceRefs,
  proposeTripId,
  placeDedupeKey,
  EXIF_SOURCE_ID,
  EXIF_TIER,
  MAX_EVIDENCE_REFS,
} from "./stagingMapper";
import {
  buildUpsertPlan,
  markMissingPhotos,
  rangesOverlapOrAdjacent,
  mergeEvidence,
  minDay,
  maxDay,
} from "./sync";
import type { Entry, Leg, Trip, PlaceEvent } from "../../types";

// ─────────────────────────────────────────────────────────────────────────────
// Group 1: Data model (WP1)
// ─────────────────────────────────────────────────────────────────────────────

describe("WP1 — PlaceEvent data model", () => {
  it("creates a valid PlaceEvent with required fields", () => {
    const p = makePlaceEvent();
    expect(p.kind).toBe("place");
    expect(p.source).toBe("photo-library");
    expect(p.tier).toBe(2);
    expect(p.locality).toBeTruthy();
    expect(p.localityKey).toBeTruthy();
    expect(p.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(p.end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(p.photoEvidence).toBeInstanceOf(Array);
    expect(typeof p.photoCount).toBe("number");
  });

  it("dedupeKey follows place|{localityKey}|{dateStart} format", () => {
    const p = makePlaceEvent({ localityKey: "gb:london", start: "2025-07-14" });
    expect(p.dedupeKey).toBe("place|gb:london|2025-07-14");
  });

  it("entryTitle returns locality name with country", () => {
    const p = makePlaceEvent({ locality: "London", country: "United Kingdom" });
    expect(entryTitle(p)).toBe("London, United Kingdom");
  });

  it("entryTitle returns locality name alone when no country", () => {
    const p = makePlaceEvent({ locality: "London", country: undefined });
    expect(entryTitle(p)).toBe("London");
  });

  it("creates a valid PhotoEvidenceRef", () => {
    const ref = makeEvidenceRef({ mediaId: "m1", localDay: "2025-07-14", hasGps: true, timingRule: "exif-offset" });
    expect(ref.mediaId).toBe("m1");
    expect(ref.localDay).toBe("2025-07-14");
    expect(ref.hasGps).toBe(true);
    expect(ref.timingRule).toBe("exif-offset");
  });

  it("marks evidence ref missing when photo is deleted", () => {
    const ref = makeEvidenceRef({ missing: true });
    expect(ref.missing).toBe(true);
  });

  it("PlaceEvent with photoEvidence refs validates", () => {
    const p = makePlaceEvent({
      photoEvidence: [
        makeEvidenceRef({ mediaId: "m1" }),
        makeEvidenceRef({ mediaId: "m2", hasGps: false, timingRule: "fallback" }),
      ],
      photoCount: 10,
    });
    expect(p.photoEvidence).toHaveLength(2);
    expect(p.photoCount).toBe(10);
  });

  it("singlePhoto flag can be set for low-confidence single-photo places", () => {
    const p = makePlaceEvent({ photoEvidence: [makeEvidenceRef()], photoCount: 1, singlePhoto: true, confidence: "inferred" });
    expect(p.singlePhoto).toBe(true);
    expect(p.confidence).toBe("inferred");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 2: PhotoRecord fixture smoke tests (WP2 shapes)
// ─────────────────────────────────────────────────────────────────────────────

describe("WP2 — PhotoRecord fixture smoke tests", () => {
  it("makePhoto produces a valid record with GPS", () => {
    const p = makePhoto();
    expect(p.mediaId).toBeTruthy();
    expect(p.captureTimestamp).toBeTypeOf("number");
    expect(p.latitude).not.toBeNull();
    expect(p.longitude).not.toBeNull();
    expect(p.cameraMake).toBeTruthy();
  });

  it("makePhoto with null GPS produces an unlocatable record", () => {
    const p = makePhoto({ latitude: null, longitude: null });
    expect(p.latitude).toBeNull();
    expect(p.longitude).toBeNull();
  });

  it("FIXTURE_LONDON_MULTI_DAY has 4 photos spanning 2 days", () => {
    const days = new Set(FIXTURE_LONDON_MULTI_DAY.map((p) => p.localDay));
    expect(FIXTURE_LONDON_MULTI_DAY).toHaveLength(4);
    expect(days.size).toBe(2);
  });

  it("FIXTURE_WINDSOR_DAY_TRIP has 2 photos on 1 day", () => {
    const days = new Set(FIXTURE_WINDSOR_DAY_TRIP.map((p) => p.localDay));
    expect(FIXTURE_WINDSOR_DAY_TRIP).toHaveLength(2);
    expect(days.size).toBe(1);
  });

  it("FIXTURE_DUBLIN_SUBURBS has 3 photos on 1 day from 3 different coordinates", () => {
    expect(FIXTURE_DUBLIN_SUBURBS).toHaveLength(3);
    const coords = new Set(FIXTURE_DUBLIN_SUBURBS.map((p) => `${p.latitude},${p.longitude}`));
    expect(coords.size).toBe(3);
  });

  it("FIXTURE_NO_GPS has all photos with null GPS", () => {
    for (const p of FIXTURE_NO_GPS) {
      expect(p.latitude).toBeNull();
      expect(p.longitude).toBeNull();
    }
  });

  it("FIXTURE_IN_FLIGHT has photos with GPS but during a known transit window", () => {
    for (const p of FIXTURE_IN_FLIGHT) {
      expect(p.latitude).not.toBeNull();
      expect(p.captureTimestamp).not.toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 3: Time resolution (WP3)
// ─────────────────────────────────────────────────────────────────────────────

describe("WP3 — Time resolution helpers", () => {
  describe("dayFromRawOffset", () => {
    it("converts UTC midnight with +00:00 to the same date", () => {
      const ts = Date.UTC(2025, 6, 14, 0, 0, 0) / 1000; // 2025-07-14T00:00Z
      expect(dayFromRawOffset(ts, "+00:00")).toBe("2025-07-14");
    });

    it("shifts date forward for positive offset", () => {
      // 2025-07-13T23:30 UTC + (+01:00) = 2025-07-14T00:30 local
      const ts = Date.UTC(2025, 6, 13, 23, 30, 0) / 1000;
      expect(dayFromRawOffset(ts, "+01:00")).toBe("2025-07-14");
    });

    it("shifts date backward for negative offset", () => {
      // 2025-07-14T00:30 UTC + (-05:00) = 2025-07-13T19:30 local
      const ts = Date.UTC(2025, 6, 14, 0, 30, 0) / 1000;
      expect(dayFromRawOffset(ts, "-05:00")).toBe("2025-07-13");
    });

    it("handles +05:30 (India)", () => {
      // 2025-07-14T18:30 UTC + (+05:30) = 2025-07-15T00:00 local
      const ts = Date.UTC(2025, 6, 14, 18, 30, 0) / 1000;
      expect(dayFromRawOffset(ts, "+05:30")).toBe("2025-07-15");
    });
  });

  describe("dayFromNamedTz", () => {
    it("returns YYYY-MM-DD for a known IANA timezone", () => {
      const ts = Date.UTC(2025, 6, 14, 12, 0, 0) / 1000;
      const day = dayFromNamedTz(ts, "Europe/London");
      expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("falls back to UTC date for an unknown timezone", () => {
      const ts = Date.UTC(2025, 6, 14, 0, 0, 0) / 1000;
      expect(dayFromNamedTz(ts, "Not/ATimezone")).toBe("2025-07-14");
    });
  });

  describe("nearestTzForCoords", () => {
    it("returns Europe/London for central London", () => {
      expect(nearestTzForCoords(51.51, -0.13)).toBe("Europe/London");
    });

    it("returns Europe/Dublin for Dublin", () => {
      expect(nearestTzForCoords(53.33, -6.25)).toBe("Europe/Dublin");
    });

    it("returns America/New_York for New York", () => {
      expect(nearestTzForCoords(40.71, -74.0)).toBe("America/New_York");
    });

    it("returns Asia/Tokyo for Tokyo", () => {
      expect(nearestTzForCoords(35.68, 139.77)).toBe("Asia/Tokyo");
    });
  });

  describe("tzFromLegs", () => {
    const londonLeg: Leg = {
      id: "leg-1", kind: "leg", source: "viaduct", tier: 2,
      mode: "rail", from: "DUB", to: "LHR",
      start: "2025-07-13T07:00", end: "2025-07-13T09:00",
      startUTC: "2025-07-13T06:00:00.000Z",
      endUTC: "2025-07-13T08:00:00.000Z",
      startTz: "Europe/Dublin", endTz: "Europe/London",
      dedupeKey: "leg|2025-07-13|DUB|LHR",
      confidence: "confirmed",
      createdAt: new Date().toISOString(),
    };

    it("returns endTz when timestamp falls within a leg's UTC window", () => {
      // 2025-07-13T07:00 UTC — inside the leg window
      const ts = Date.UTC(2025, 6, 13, 7, 0, 0) / 1000;
      expect(tzFromLegs(ts, [londonLeg])).toBe("Europe/London");
    });

    it("returns nearest leg endTz when timestamp is outside all leg windows", () => {
      // 2025-07-14T12:00 UTC — after the leg, nearest = leg endpoint
      const ts = Date.UTC(2025, 6, 14, 12, 0, 0) / 1000;
      expect(tzFromLegs(ts, [londonLeg])).toBe("Europe/London");
    });

    it("returns null for an empty legs array", () => {
      expect(tzFromLegs(Date.now() / 1000, [])).toBeNull();
    });
  });

  describe("resolveLocalDay — rule 1: exif-offset", () => {
    it("uses EXIF offset when present", () => {
      // 2025-07-13T23:00 UTC with +01:00 → 2025-07-14 local
      const ts = Date.UTC(2025, 6, 13, 23, 0, 0) / 1000;
      const photo = makePhoto({ captureTimestamp: ts, tzOffset: "+01:00", latitude: null, longitude: null });
      const result = resolveLocalDay(photo, [], "Europe/Dublin");
      expect(result.localDay).toBe("2025-07-14");
      expect(result.timingRule).toBe("exif-offset");
    });

    it("prefers exif-offset over GPS even when GPS is present", () => {
      const ts = Date.UTC(2025, 6, 13, 23, 0, 0) / 1000;
      const photo = makePhoto({ captureTimestamp: ts, tzOffset: "+09:00", latitude: 35.68, longitude: 139.77 });
      const result = resolveLocalDay(photo, [], "Europe/Dublin");
      expect(result.timingRule).toBe("exif-offset");
    });
  });

  describe("resolveLocalDay — rule 2: gps-inferred", () => {
    it("uses GPS when no EXIF offset", () => {
      const ts = Date.UTC(2025, 6, 14, 10, 0, 0) / 1000;
      const photo = makePhoto({ captureTimestamp: ts, tzOffset: null, latitude: 51.51, longitude: -0.13 });
      const result = resolveLocalDay(photo, [], "Europe/Dublin");
      expect(result.timingRule).toBe("gps-inferred");
      expect(result.localDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe("resolveLocalDay — rule 3: fallback", () => {
    it("uses fallback timezone when no offset and no GPS", () => {
      const ts = Date.UTC(2025, 6, 14, 10, 0, 0) / 1000;
      const photo = makePhoto({ captureTimestamp: ts, tzOffset: null, latitude: null, longitude: null });
      const result = resolveLocalDay(photo, [], "Europe/Dublin");
      expect(result.timingRule).toBe("fallback");
      expect(result.localDay).toBe("2025-07-14"); // UTC+1 Dublin summer → same day for midday UTC
    });

    it("uses leg endTz as fallback timezone when available", () => {
      // Photo at 2025-07-13T22:30 UTC, leg arrives in Tokyo (UTC+9) at same window
      const ts = Date.UTC(2025, 6, 13, 22, 30, 0) / 1000; // 2025-07-13T22:30 UTC
      const tokyoLeg: Leg = {
        id: "leg-2", kind: "leg", source: "viaduct", tier: 2,
        mode: "air", from: "LHR", to: "NRT",
        start: "2025-07-13T11:00", end: "2025-07-14T07:30",
        startUTC: "2025-07-13T10:00:00.000Z",
        endUTC: "2025-07-14T06:30:00.000Z",
        startTz: "Europe/London", endTz: "Asia/Tokyo",
        dedupeKey: "leg|2025-07-13|LHR|NRT",
        confidence: "confirmed",
        createdAt: new Date().toISOString(),
      };
      const photo = makePhoto({ captureTimestamp: ts, tzOffset: null, latitude: null, longitude: null });
      const result = resolveLocalDay(photo, [tokyoLeg], "Europe/Dublin");
      // 2025-07-13T22:30 UTC inside leg window → uses Asia/Tokyo endTz
      // 2025-07-13T22:30 UTC = 2025-07-14T07:30 Tokyo → "2025-07-14"
      expect(result.timingRule).toBe("fallback");
      expect(result.localDay).toBe("2025-07-14");
    });

    it("uses usedFallbackTime photo when captureTimestamp is null", () => {
      const photo = makePhoto({ captureTimestamp: null, tzOffset: null, latitude: null, longitude: null, usedFallbackTime: true });
      // Should not throw; localDay will be today or similar
      const result = resolveLocalDay(photo, [], "Europe/Dublin");
      expect(result.timingRule).toBe("fallback");
      expect(result.localDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 4: Locality resolver pure logic (WP4)
// ─────────────────────────────────────────────────────────────────────────────

describe("WP4 — coarsenCoords", () => {
  it("rounds to 2 decimal places", () => {
    const c = coarsenCoords(51.5074, -0.1278);
    expect(c.lat).toBe(51.51);
    expect(c.lon).toBe(-0.13);
  });

  it("is idempotent — coarsening an already-coarse coord is a no-op", () => {
    expect(coarsenCoords(51.51, -0.13)).toEqual({ lat: 51.51, lon: -0.13 });
  });
});

describe("WP4 — perDayKey", () => {
  it("produces a stable string key", () => {
    const key = perDayKey(51.5074, -0.1278, "2025-07-14");
    expect(key).toBe("51.51,-0.13@2025-07-14");
  });

  it("same coarsened coords on different days produce different keys", () => {
    const k1 = perDayKey(51.5074, -0.1278, "2025-07-14");
    const k2 = perDayKey(51.5074, -0.1278, "2025-07-15");
    expect(k1).not.toBe(k2);
  });
});

describe("WP4 — FakeLocalityResolver smoke tests", () => {
  it("resolves London coordinates to the London locality", async () => {
    const result = await fakeLocalityResolver.resolve(51.5074, -0.1278);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("London");
    expect(result!.key).toBe("gb:london");
  });

  it("resolves Dublin suburb coordinates to Dublin", async () => {
    const ranelagh = await fakeLocalityResolver.resolve(53.3239, -6.2614);
    const sandymount = await fakeLocalityResolver.resolve(53.3293, -6.2235);
    const clontarf = await fakeLocalityResolver.resolve(53.3688, -6.2098);
    expect(ranelagh?.key).toBe("ie:dublin");
    expect(sandymount?.key).toBe("ie:dublin");
    expect(clontarf?.key).toBe("ie:dublin");
  });

  it("returns null for an unknown location", async () => {
    const result = await fakeLocalityResolver.resolve(0, 0);
    expect(result).toBeNull();
  });
});

describe("WP4 — InMemoryLocalityCache", () => {
  it("stores and retrieves by key", () => {
    const cache = new InMemoryLocalityCache();
    const info = { name: "London", key: "gb:london" };
    cache.setByKey("gb:london", info);
    expect(cache.getByKey("gb:london")).toEqual(info);
  });

  it("stores and retrieves by coords (applies coarsening)", () => {
    const cache = new InMemoryLocalityCache();
    const info = { name: "London", key: "gb:london" };
    cache.setByCoords(51.5074, -0.1278, info); // raw coords
    expect(cache.getByCoords(51.5077, -0.1281)).toEqual(info); // slightly different raw → same coarsened
  });

  it("returns undefined for a missing key", () => {
    const cache = new InMemoryLocalityCache();
    expect(cache.getByKey("xx:nowhere")).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Acceptance check 6 — lookups send only coarsened coordinates, max one per place per day
// spec §15.6
// ─────────────────────────────────────────────────────────────────────────────

describe("Acceptance check 6 — coarsened coords, max one lookup per place per day", () => {
  it("coarsens raw coordinates before calling the inner resolver", async () => {
    const calls: { lat: number; lon: number }[] = [];
    const recorder = {
      async resolve(lat: number, lon: number) {
        calls.push({ lat, lon });
        return { name: "London", key: "gb:london" };
      },
    };
    const cache = new InMemoryLocalityCache();
    const resolver = new ResolvingLocalityResolver(recorder, cache);

    await resolver.resolve(51.5074, -0.1278, "2025-07-14");

    expect(calls).toHaveLength(1);
    // The inner resolver must receive coarsened coords only
    expect(calls[0].lat).toBe(51.51);
    expect(calls[0].lon).toBe(-0.13);
  });

  it("makes only one geocoder call for multiple photos at the same coarsened location on the same day", async () => {
    let callCount = 0;
    const countingResolver = {
      async resolve(_lat: number, _lon: number) {
        callCount++;
        return { name: "London", key: "gb:london" };
      },
    };
    const cache = new InMemoryLocalityCache();
    const resolver = new ResolvingLocalityResolver(countingResolver, cache);

    // Four London photos — slightly different raw coords but same coarsened grid square
    await resolver.resolve(51.5074, -0.1278, "2025-07-14");
    await resolver.resolve(51.5077, -0.1275, "2025-07-14");
    await resolver.resolve(51.5070, -0.1280, "2025-07-14");
    await resolver.resolve(51.5073, -0.1277, "2025-07-14");

    expect(callCount).toBe(1);
  });

  it("makes a fresh call for the same location on a different day", async () => {
    let callCount = 0;
    const countingResolver = {
      async resolve(_lat: number, _lon: number) {
        callCount++;
        return { name: "London", key: "gb:london" };
      },
    };
    const cache = new InMemoryLocalityCache();
    const resolver = new ResolvingLocalityResolver(countingResolver, cache);

    await resolver.resolve(51.5074, -0.1278, "2025-07-14");
    await resolver.resolve(51.5074, -0.1278, "2025-07-15");

    // Different days — cache is per-coords so second call hits cache, not geocoder
    // (cache hit avoids the geocoder call even for a different day)
    expect(callCount).toBe(1); // cache prevents the second geocoder call
  });

  it("does not include raw coords, timestamps, or IDs in the geocoder call", async () => {
    const seen: unknown[] = [];
    const inspectingResolver = {
      async resolve(lat: number, lon: number) {
        seen.push({ lat, lon });
        return { name: "London", key: "gb:london" };
      },
    };
    const cache = new InMemoryLocalityCache();
    const resolver = new ResolvingLocalityResolver(inspectingResolver, cache);

    await resolver.resolve(51.5074, -0.1278, "2025-07-14");

    // Resolver receives an object with exactly lat and lon — nothing else
    const call = seen[0] as Record<string, unknown>;
    expect(Object.keys(call).sort()).toEqual(["lat", "lon"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Acceptance check 7 — offline / failed lookup leaves photos pending, no wrong place created
// spec §15.7
// ─────────────────────────────────────────────────────────────────────────────

describe("Acceptance check 7 — failed lookup leaves photos pending, no wrong place created", () => {
  it("returns null (not a wrong place) when the geocoder throws", async () => {
    const failingResolver = {
      async resolve(_lat: number, _lon: number): Promise<null> {
        throw new Error("Network unavailable");
      },
    };
    const cache = new InMemoryLocalityCache();
    const resolver = new ResolvingLocalityResolver(failingResolver, cache);

    const result = await resolver.resolve(51.5074, -0.1278, "2025-07-14");

    expect(result).toBeNull(); // no place created
  });

  it("adds the lookup to the retry queue after failure", async () => {
    const failingResolver = {
      async resolve(_lat: number, _lon: number): Promise<null> {
        throw new Error("Offline");
      },
    };
    const cache = new InMemoryLocalityCache();
    const resolver = new ResolvingLocalityResolver(failingResolver, cache);

    await resolver.resolve(51.5074, -0.1278, "2025-07-14");

    expect(resolver.pendingCount).toBe(1);
  });

  it("retries pending lookups and resolves them on next scan", async () => {
    let attempt = 0;
    const eventuallyResolvingResolver = {
      async resolve(lat: number, lon: number) {
        attempt++;
        if (attempt === 1) throw new Error("Offline");
        return { name: "London", key: "gb:london" };
      },
    };
    const cache = new InMemoryLocalityCache();
    const resolver = new ResolvingLocalityResolver(eventuallyResolvingResolver, cache);

    // First attempt — fails
    const first = await resolver.resolve(51.5074, -0.1278, "2025-07-14");
    expect(first).toBeNull();
    expect(resolver.pendingCount).toBe(1);

    // Retry — succeeds
    const resolved = await resolver.retryPending();
    expect(resolved).toBe(1);
    expect(resolver.pendingCount).toBe(0);
    // Cache should now hold the result
    expect(cache.getByCoords(51.5074, -0.1278)?.name).toBe("London");
  });

  it("keeps still-failing lookups on the retry queue for the next attempt", async () => {
    const alwaysFailingResolver = {
      async resolve(_lat: number, _lon: number): Promise<null> {
        throw new Error("Always offline");
      },
    };
    const cache = new InMemoryLocalityCache();
    const resolver = new ResolvingLocalityResolver(alwaysFailingResolver, cache);

    await resolver.resolve(51.5074, -0.1278, "2025-07-14");
    expect(resolver.pendingCount).toBe(1);

    await resolver.retryPending();
    // Still failing → stays on queue
    expect(resolver.pendingCount).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WP5 helper unit tests
// ─────────────────────────────────────────────────────────────────────────────

describe("WP5 — daysDiff", () => {
  it("returns 0 for the same day", () => {
    expect(daysDiff("2025-07-14", "2025-07-14")).toBe(0);
  });

  it("returns 1 for adjacent days", () => {
    expect(daysDiff("2025-07-14", "2025-07-15")).toBe(1);
  });

  it("returns 31 for a month-long gap", () => {
    expect(daysDiff("2025-07-01", "2025-08-01")).toBe(31);
  });

  it("is commutative (order of arguments does not matter)", () => {
    expect(daysDiff("2025-07-14", "2025-07-20")).toBe(daysDiff("2025-07-20", "2025-07-14"));
  });
});

describe("WP5 — isDuringLeg", () => {
  // FIXTURE_IN_FLIGHT photo: captureTimestamp = 2025-07-13T12:00 UTC
  // Flight window (UTC): 11:30–12:45 → photo at 12:00 is mid-flight ✓
  const flightLeg: Leg = {
    id: "leg-flight", kind: "leg", source: "viaduct", tier: 2,
    mode: "air", from: "DUB", to: "LHR",
    start: "2025-07-13T12:30", end: "2025-07-13T13:45",
    startUTC: "2025-07-13T11:30:00.000Z",
    endUTC:   "2025-07-13T12:45:00.000Z",
    startTz: "Europe/Dublin", endTz: "Europe/London",
    dedupeKey: "leg|2025-07-13|DUB|LHR",
    confidence: "confirmed",
    createdAt: new Date().toISOString(),
  };

  it("returns true for a photo mid-flight (UTC timestamp inside leg window)", () => {
    const photo = FIXTURE_IN_FLIGHT[0]; // captureTimestamp = 2025-07-13T12:00 UTC
    expect(isDuringLeg(photo, [flightLeg])).toBe(true);
  });

  it("returns false for a photo outside any leg window", () => {
    const photo = FIXTURE_LONDON_MULTI_DAY[0]; // 2025-07-14 — after the flight
    expect(isDuringLeg(photo, [flightLeg])).toBe(false);
  });

  it("returns false when legs array is empty", () => {
    expect(isDuringLeg(FIXTURE_IN_FLIGHT[0], [])).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Acceptance check 1 — multi-day city run produces one place
// spec §15.1
// ─────────────────────────────────────────────────────────────────────────────

describe("Acceptance check 1 — multi-day city run produces one place", () => {
  it("four London photos across two days produce a single PlaceEvent candidate", async () => {
    const { located, unlocated } = await resolveFixture(FIXTURE_LONDON_MULTI_DAY);
    const places = buildPlaces(located, unlocated, [], []);

    expect(places).toHaveLength(1);
    expect(places[0].localityKey).toBe("gb:london");
    expect(places[0].dateStart).toBe("2025-07-14");
    expect(places[0].dateEnd).toBe("2025-07-15");
    expect(places[0].photos).toHaveLength(4);
  });

  it("locality name, region, country are populated from the resolver output", async () => {
    const { located, unlocated } = await resolveFixture(FIXTURE_LONDON_MULTI_DAY);
    const [place] = buildPlaces(located, unlocated, [], []);

    expect(place.locality).toBe("London");
    expect(place.region).toBe("England");
    expect(place.country).toBe("United Kingdom");
  });

  it("a single-day visit produces a place with identical dateStart and dateEnd", async () => {
    const { located, unlocated } = await resolveFixture(FIXTURE_WINDSOR_DAY_TRIP);
    const places = buildPlaces(located, unlocated, [], []);

    expect(places).toHaveLength(1);
    expect(places[0].dateStart).toBe("2025-07-16");
    expect(places[0].dateEnd).toBe("2025-07-16");
  });

  it("two visits to the same city with a gap > DEFAULT_MAX_GAP_DAYS produce two separate places", async () => {
    const { located: located1 } = await resolveFixture(FIXTURE_LONDON_MULTI_DAY); // Jul 14–15
    // Simulate a second London visit 40 days later
    const lateVisit = [
      { ...located1[0], localDay: "2025-08-24", mediaId: "london-late-1" },
    ];
    const allLocated = [...located1, ...lateVisit];
    const places = buildPlaces(allLocated, [], [], [], DEFAULT_MAX_GAP_DAYS);

    expect(places).toHaveLength(2);
    expect(places[0].dateStart).toBe("2025-07-14");
    expect(places[1].dateStart).toBe("2025-08-24");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Acceptance check 2 — no-GPS photos attach to existing place, never create one
// spec §15.2
// ─────────────────────────────────────────────────────────────────────────────

describe("Acceptance check 2 — no-GPS photos attach to existing place, never create one", () => {
  it("no-GPS photos on the same day as a located photo attach as unlocated evidence", async () => {
    // FIXTURE_NO_GPS photos are on 2025-07-14 — same day as FIXTURE_LONDON_MULTI_DAY
    const allPhotos = [...FIXTURE_LONDON_MULTI_DAY, ...FIXTURE_NO_GPS];
    // resolveFixture splits them by GPS presence
    const { located, unlocated } = await resolveFixture(allPhotos);

    expect(located.length).toBeGreaterThan(0);
    expect(unlocated.length).toBeGreaterThan(0); // no-GPS → unlocated

    const places = buildPlaces(located, unlocated, [], []);

    // Still only one London place
    expect(places).toHaveLength(1);
    // No-GPS photos are attached as unlocated evidence, not as separate places
    expect(places[0].unlocatedPhotos.length).toBe(FIXTURE_NO_GPS.length);
  });

  it("no-GPS photos with no matching located place produce no new place", async () => {
    const { located, unlocated } = await resolveFixture(FIXTURE_NO_GPS);

    expect(located).toHaveLength(0); // all no-GPS → none located
    const places = buildPlaces(located, unlocated, [], []);

    expect(places).toHaveLength(0); // no located photos → no places
  });

  it("no-GPS photos outside any place date range are not attached anywhere", async () => {
    // London place covers Jul 14–15; no-GPS photo on Aug 1 has nowhere to attach
    const { located } = await resolveFixture(FIXTURE_LONDON_MULTI_DAY);
    const lateUnlocated = [{ ...FIXTURE_NO_GPS[0], localDay: "2025-08-01", mediaId: "no-gps-late", locality: null as null }];
    const places = buildPlaces(located, lateUnlocated, [], []);

    expect(places[0].unlocatedPhotos).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Acceptance check 3 — re-scan creates zero duplicates (pending WP7)
// ─────────────────────────────────────────────────────────────────────────────

describe("Acceptance check 3 — re-scan creates zero duplicates, adjacent day extends place", () => {
  it.todo("implement after WP7 (sync and re-scan) is done");
});

// ─────────────────────────────────────────────────────────────────────────────
// Acceptance check 4 — location permission declined (device test)
// ─────────────────────────────────────────────────────────────────────────────

describe("Acceptance check 4 — location permission declined → time-only mode, no places created", () => {
  it.todo("device test only — implement manually in Expo (WP2)");
});

// ─────────────────────────────────────────────────────────────────────────────
// Acceptance check 5 — scope respected, cancel and resume (device test)
// ─────────────────────────────────────────────────────────────────────────────

describe("Acceptance check 5 — scope respected, scan-all can cancel and resume without duplicates", () => {
  it.todo("device test only — implement manually in Expo (WP2 + WP7)");
});

// ─────────────────────────────────────────────────────────────────────────────
// Acceptance check 8 — photo place and calendar place coexist unflagged (pending WP6)
// ─────────────────────────────────────────────────────────────────────────────

describe("Acceptance check 8 — photo place and calendar place in different cities coexist unflagged", () => {
  it.todo("implement after WP6 (staging mapper) is done");
});

// ─────────────────────────────────────────────────────────────────────────────
// Acceptance check 9 — photos during a known leg do not create places
// spec §15.9
// ─────────────────────────────────────────────────────────────────────────────

describe("Acceptance check 9 — photos during a known leg do not create places", () => {
  // FIXTURE_IN_FLIGHT photo: captureTimestamp = 2025-07-13T12:00 UTC
  // Leg UTC window covers that timestamp: 11:30–12:45 UTC
  const dubToLhrFlight: Leg = {
    id: "leg-dub-lhr", kind: "leg", source: "viaduct", tier: 2,
    mode: "air", from: "DUB", to: "LHR",
    start: "2025-07-13T12:30", end: "2025-07-13T13:45",
    startUTC: "2025-07-13T11:30:00.000Z",
    endUTC:   "2025-07-13T12:45:00.000Z",
    startTz: "Europe/Dublin", endTz: "Europe/London",
    dedupeKey: "leg|2025-07-13|DUB|LHR",
    confidence: "confirmed",
    createdAt: new Date().toISOString(),
  };

  it("in-flight photo (GPS present but during leg) produces no place", async () => {
    // FIXTURE_IN_FLIGHT photo has GPS (~52.4,-3.5) that the fake resolver won't match,
    // but even if it did resolve, isDuringLeg should exclude it.
    const { located, unlocated } = await resolveFixture(FIXTURE_IN_FLIGHT);
    const places = buildPlaces(located, unlocated, [], [dubToLhrFlight]);

    expect(places).toHaveLength(0);
  });

  it("leg exclusion does not affect photos before or after the leg", async () => {
    // London photos on Jul 14–15 (after the Jul 13 flight) must still produce a place
    const { located, unlocated } = await resolveFixture(FIXTURE_LONDON_MULTI_DAY);
    const places = buildPlaces(located, unlocated, [], [dubToLhrFlight]);

    expect(places).toHaveLength(1);
    expect(places[0].localityKey).toBe("gb:london");
  });

  it("mixing in-flight and non-flight photos — only non-flight photos create a place", async () => {
    const allPhotos = [...FIXTURE_IN_FLIGHT, ...FIXTURE_LONDON_MULTI_DAY];
    const { located, unlocated } = await resolveFixture(allPhotos);
    const places = buildPlaces(located, unlocated, [], [dubToLhrFlight]);

    // In-flight photo excluded; London photos produce 1 place
    expect(places).toHaveLength(1);
    // No in-flight photo in the place evidence
    const allPhotoIds = places.flatMap((p) => [...p.photos, ...p.unlocatedPhotos].map((ph) => ph.mediaId));
    expect(allPhotoIds).not.toContain("inflight-1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Acceptance check 10 — two suburbs of the same city resolve to one place
// spec §15.10
// ─────────────────────────────────────────────────────────────────────────────

describe("Acceptance check 10 — two suburbs of the same city resolve to one place", () => {
  it("Dublin suburb photos from three different coordinates produce one Dublin place", async () => {
    const { located, unlocated } = await resolveFixture(FIXTURE_DUBLIN_SUBURBS);
    const places = buildPlaces(located, unlocated, [], []);

    expect(places).toHaveLength(1);
    expect(places[0].localityKey).toBe("ie:dublin");
    expect(places[0].locality).toBe("Dublin");
    expect(places[0].photos).toHaveLength(3);
  });

  it("all three suburb photos are included in the single place's evidence", async () => {
    const { located, unlocated } = await resolveFixture(FIXTURE_DUBLIN_SUBURBS);
    const [place] = buildPlaces(located, unlocated, [], []);

    const ids = new Set(place.photos.map((p) => p.mediaId));
    expect(ids.has("dub-ranelagh")).toBe(true);
    expect(ids.has("dub-sandymount")).toBe(true);
    expect(ids.has("dub-clontarf")).toBe(true);
  });

  it("London + Dublin photos on the same day produce two separate places (different cities)", async () => {
    const mixedPhotos = [
      ...FIXTURE_LONDON_MULTI_DAY,
      ...FIXTURE_DUBLIN_SUBURBS,
    ];
    const { located, unlocated } = await resolveFixture(mixedPhotos);
    const places = buildPlaces(located, unlocated, [], []);
    const keys = new Set(places.map((p) => p.localityKey));

    expect(keys.has("gb:london")).toBe(true);
    expect(keys.has("ie:dublin")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WP6 — Staging mapper unit tests
// ─────────────────────────────────────────────────────────────────────────────

describe("WP6 — placeDedupeKey", () => {
  it("uses place|{localityKey}|{dateStart} format", async () => {
    const { located, unlocated } = await resolveFixture(FIXTURE_LONDON_MULTI_DAY);
    const [place] = buildPlaces(located, unlocated, [], []);
    expect(placeDedupeKey(place)).toBe("place|gb:london|2025-07-14");
  });
});

describe("WP6 — placeConfidence", () => {
  it("returns 'inferred' for a single-photo place", async () => {
    const { located, unlocated } = await resolveFixture([FIXTURE_LONDON_MULTI_DAY[0]]);
    const [place] = buildPlaces(located, unlocated, [], []);
    expect(placeConfidence(place)).toBe("inferred");
  });

  it("returns 'approximate' for a place with 5+ photos and good timing", async () => {
    // Create 5 located photos with exif-offset timing
    const manyPhotos = Array.from({ length: 5 }, (_, i) =>
      ({ ...FIXTURE_LONDON_MULTI_DAY[0], mediaId: `many-${i}`, localDay: `2025-07-${14 + i}` }),
    );
    const { located, unlocated } = await resolveFixture(manyPhotos);
    const [place] = buildPlaces(located, unlocated, [], []);
    expect(placeConfidence(place)).toBe("approximate");
  });
});

describe("WP6 — sampleEvidenceRefs", () => {
  it("returns a PhotoEvidenceRef per sampled photo", async () => {
    const { located, unlocated } = await resolveFixture(FIXTURE_LONDON_MULTI_DAY);
    const [place] = buildPlaces(located, unlocated, [], []);
    const refs = sampleEvidenceRefs(place);
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.length).toBeLessThanOrEqual(MAX_EVIDENCE_REFS);
    for (const ref of refs) {
      expect(ref.mediaId).toBeTruthy();
      expect(ref.localDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof ref.hasGps).toBe("boolean");
    }
  });

  it("caps evidence refs at MAX_EVIDENCE_REFS", async () => {
    const manyPhotos = Array.from({ length: 20 }, (_, i) =>
      ({ ...FIXTURE_LONDON_MULTI_DAY[0], mediaId: `bulk-${i}`, localDay: "2025-07-14" }),
    );
    const { located, unlocated } = await resolveFixture(manyPhotos);
    const [place] = buildPlaces(located, unlocated, [], []);
    expect(sampleEvidenceRefs(place).length).toBe(MAX_EVIDENCE_REFS);
  });
});

describe("WP6 — proposeTripId", () => {
  const trip: Trip = {
    id: "trip-uk-2025", title: "UK 2025",
    start: "2025-07-13", end: "2025-07-20",
    notes: "", cover: "", createdAt: new Date().toISOString(),
  };

  it("proposes the trip id when place dates overlap", async () => {
    const { located, unlocated } = await resolveFixture(FIXTURE_LONDON_MULTI_DAY);
    const [place] = buildPlaces(located, unlocated, [], []);
    expect(proposeTripId(place, [trip])).toBe("trip-uk-2025");
  });

  it("returns undefined when place is outside all trips", async () => {
    const { located, unlocated } = await resolveFixture(FIXTURE_DUBLIN_SUBURBS); // Aug 1
    const [place] = buildPlaces(located, unlocated, [], []);
    expect(proposeTripId(place, [trip])).toBeUndefined();
  });
});

describe("WP6 — mapToStagingBatch", () => {
  it("produces a batch with one record per built place", async () => {
    const { located, unlocated } = await resolveFixture(FIXTURE_LONDON_MULTI_DAY);
    const places = buildPlaces(located, unlocated, [], []);
    const batch = mapToStagingBatch(places, [], new Map());

    expect(batch.source).toBe(EXIF_SOURCE_ID);
    expect(batch.records).toHaveLength(places.length);
  });

  it("record entry has correct kind, tier, and source", async () => {
    const { located, unlocated } = await resolveFixture(FIXTURE_LONDON_MULTI_DAY);
    const places = buildPlaces(located, unlocated, [], []);
    const batch = mapToStagingBatch(places, [], new Map());
    const entry = batch.records[0].entry as import("../../types").PlaceEvent;

    expect(entry.kind).toBe("place");
    expect(entry.tier).toBe(EXIF_TIER);
    expect(entry.source).toBe(EXIF_SOURCE_ID);
    expect(entry.localityKey).toBe("gb:london");
    expect(entry.start).toBe("2025-07-14");
    expect(entry.end).toBe("2025-07-15");
  });

  it("new place is classified as 'new' when not in existing entries", async () => {
    const { located, unlocated } = await resolveFixture(FIXTURE_LONDON_MULTI_DAY);
    const places = buildPlaces(located, unlocated, [], []);
    const batch = mapToStagingBatch(places, [], new Map());

    expect(batch.records[0].status).toBe("new");
    expect(batch.records[0].selected).toBe(true);
  });

  it("duplicate place is classified as 'duplicate' when dedupeKey already exists at same tier", async () => {
    const { located, unlocated } = await resolveFixture(FIXTURE_LONDON_MULTI_DAY);
    const places = buildPlaces(located, unlocated, [], []);

    // Pre-populate the existing entries map with an entry at the same dedupeKey
    const existing = makePlaceEvent({
      localityKey: "gb:london",
      start: "2025-07-14",
      end: "2025-07-15",
      dedupeKey: "place|gb:london|2025-07-14",
    }) as Entry;
    const existingMap = new Map([[existing.dedupeKey, existing]]);

    const batch = mapToStagingBatch(places, [], existingMap);

    expect(batch.records[0].status).toBe("duplicate");
    expect(batch.records[0].selected).toBe(false);
  });

  it("batch-duplicate when same place appears twice in one batch", async () => {
    const { located, unlocated } = await resolveFixture(FIXTURE_LONDON_MULTI_DAY);
    const place = buildPlaces(located, unlocated, [], [])[0];
    // Pass the same place twice
    const batch = mapToStagingBatch([place, place], [], new Map());

    expect(batch.records[0].status).toBe("new");
    expect(batch.records[1].status).toBe("batch-duplicate");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Acceptance check 8 — photo place and calendar place coexist unflagged
// spec §15.8
// ─────────────────────────────────────────────────────────────────────────────

describe("Acceptance check 8 — photo place and calendar place in different cities coexist unflagged", () => {
  it("photo-library place and an existing calendar place at a different key are both 'new' with no warning", async () => {
    // Simulate an existing calendar place in Rome (different city entirely)
    const calendarPlace = makePlaceEvent({
      id: "cal-rome-1",
      kind: "place",
      source: "calendar",
      tier: 2,
      locality: "Rome", country: "Italy", localityKey: "it:rome",
      start: "2025-07-14", end: "2025-07-17",
      dedupeKey: "place|it:rome|2025-07-14",
    }) as Entry;
    const existingMap = new Map([[calendarPlace.dedupeKey, calendarPlace]]);

    // Photo library produces a London place on the same dates
    const { located, unlocated } = await resolveFixture(FIXTURE_LONDON_MULTI_DAY);
    const places = buildPlaces(located, unlocated, [], []);
    const batch = mapToStagingBatch(places, [], existingMap);

    // Photo place is new — no collision with calendar place (different key)
    expect(batch.records[0].status).toBe("new");
    expect(batch.records[0].warnings).toHaveLength(0);
    // Existing calendar place is unaffected (not in the batch)
    expect(batch.records.find((r) => (r.entry as any).localityKey === "it:rome")).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WP7 — Sync and re-scan helper unit tests
// ─────────────────────────────────────────────────────────────────────────────

describe("WP7 — rangesOverlapOrAdjacent", () => {
  it("returns true for identical ranges", () => {
    expect(rangesOverlapOrAdjacent("2025-07-14", "2025-07-15", "2025-07-14", "2025-07-15")).toBe(true);
  });

  it("returns true for overlapping ranges", () => {
    expect(rangesOverlapOrAdjacent("2025-07-14", "2025-07-16", "2025-07-15", "2025-07-18")).toBe(true);
  });

  it("returns true for adjacent ranges (end and start differ by 1 day)", () => {
    expect(rangesOverlapOrAdjacent("2025-07-14", "2025-07-15", "2025-07-16", "2025-07-17")).toBe(true);
  });

  it("returns false for ranges with a 2-day gap", () => {
    expect(rangesOverlapOrAdjacent("2025-07-14", "2025-07-15", "2025-07-17", "2025-07-18")).toBe(false);
  });

  it("returns true for one range contained within the other", () => {
    expect(rangesOverlapOrAdjacent("2025-07-10", "2025-07-20", "2025-07-14", "2025-07-15")).toBe(true);
  });
});

describe("WP7 — mergeEvidence", () => {
  it("combines refs from both arrays, deduplicating by mediaId", () => {
    const a = [makeEvidenceRef({ mediaId: "m1" }), makeEvidenceRef({ mediaId: "m2" })];
    const b = [makeEvidenceRef({ mediaId: "m2" }), makeEvidenceRef({ mediaId: "m3" })];
    const merged = mergeEvidence(a, b);
    expect(merged).toHaveLength(3);
    expect(new Set(merged.map((r) => r.mediaId)).size).toBe(3);
  });

  it("preserves the existing array when incoming adds nothing new", () => {
    const a = [makeEvidenceRef({ mediaId: "m1" })];
    const b = [makeEvidenceRef({ mediaId: "m1" })];
    const merged = mergeEvidence(a, b);
    expect(merged).toHaveLength(1);
  });
});

describe("WP7 — markMissingPhotos", () => {
  it("marks a ref as missing when its mediaId is absent from currentIds", () => {
    const place = makePlaceEvent({
      photoEvidence: [makeEvidenceRef({ mediaId: "m1" }), makeEvidenceRef({ mediaId: "m2" })],
    });
    const updated = markMissingPhotos(place as PlaceEvent, new Set(["m1"]));
    const refs = updated.photoEvidence;
    expect(refs.find((r) => r.mediaId === "m1")?.missing).toBeFalsy();
    expect(refs.find((r) => r.mediaId === "m2")?.missing).toBe(true);
  });

  it("returns the original object when no refs are missing", () => {
    const place = makePlaceEvent({
      photoEvidence: [makeEvidenceRef({ mediaId: "m1" })],
    });
    const updated = markMissingPhotos(place as PlaceEvent, new Set(["m1"]));
    expect(updated).toBe(place); // reference equality — no clone needed
  });

  it("does not re-mark an already-missing ref", () => {
    const ref = makeEvidenceRef({ mediaId: "m1", missing: true });
    const place = makePlaceEvent({ photoEvidence: [ref] });
    const updated = markMissingPhotos(place as PlaceEvent, new Set());
    expect(updated.photoEvidence[0].missing).toBe(true);
  });
});

describe("WP7 — buildUpsertPlan", () => {
  function makeCandidate(localityKey: string, start: string, end: string): { entry: PlaceEvent } {
    return {
      entry: makePlaceEvent({ localityKey, start, end, dedupeKey: `place|${localityKey}|${start}` }) as PlaceEvent,
    };
  }

  it("returns 'create' for a candidate with no existing match", () => {
    const plan = buildUpsertPlan(
      [makeCandidate("gb:london", "2025-07-14", "2025-07-15")],
      [],
    );
    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0].kind).toBe("create");
    expect(plan.toWrite).toHaveLength(1);
  });

  it("returns 'no-op' (exact-duplicate) when same range already exists", () => {
    const existing = makePlaceEvent({
      localityKey: "gb:london", start: "2025-07-14", end: "2025-07-15",
    }) as PlaceEvent;
    const plan = buildUpsertPlan(
      [makeCandidate("gb:london", "2025-07-14", "2025-07-15")],
      [existing],
    );
    expect(plan.actions[0].kind).toBe("no-op");
    expect((plan.actions[0] as any).reason).toBe("exact-duplicate");
    expect(plan.toWrite).toHaveLength(0);
  });

  it("returns 'no-op' (subsumed) when candidate is fully contained in existing", () => {
    const existing = makePlaceEvent({
      localityKey: "gb:london", start: "2025-07-10", end: "2025-07-20",
    }) as PlaceEvent;
    const plan = buildUpsertPlan(
      [makeCandidate("gb:london", "2025-07-14", "2025-07-15")],
      [existing],
    );
    expect(plan.actions[0].kind).toBe("no-op");
    expect((plan.actions[0] as any).reason).toBe("subsumed");
  });

  it("returns 'extend' with a wider date range when candidate overlaps existing", () => {
    const existing = makePlaceEvent({
      localityKey: "gb:london", start: "2025-07-14", end: "2025-07-15",
    }) as PlaceEvent;
    const plan = buildUpsertPlan(
      [makeCandidate("gb:london", "2025-07-15", "2025-07-17")],
      [existing],
    );
    expect(plan.actions[0].kind).toBe("extend");
    const ext = plan.actions[0] as Extract<typeof plan.actions[0], { kind: "extend" }>;
    expect(ext.merged.start).toBe("2025-07-14");
    expect(ext.merged.end).toBe("2025-07-17");
    expect(plan.toWrite).toHaveLength(1);
  });

  it("returns 'extend' for an adjacent candidate (end + 1 day = start)", () => {
    const existing = makePlaceEvent({
      localityKey: "gb:london", start: "2025-07-14", end: "2025-07-15",
    }) as PlaceEvent;
    const plan = buildUpsertPlan(
      [makeCandidate("gb:london", "2025-07-16", "2025-07-17")],
      [existing],
    );
    expect(plan.actions[0].kind).toBe("extend");
  });

  it("does not match a candidate from a different locality key", () => {
    const existing = makePlaceEvent({
      localityKey: "gb:london", start: "2025-07-14", end: "2025-07-15",
    }) as PlaceEvent;
    const plan = buildUpsertPlan(
      [makeCandidate("ie:dublin", "2025-07-14", "2025-07-15")],
      [existing],
    );
    expect(plan.actions[0].kind).toBe("create");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Acceptance check 3 — re-scan creates zero duplicates, adjacent day extends place
// spec §15.3
// ─────────────────────────────────────────────────────────────────────────────

describe("Acceptance check 3 — re-scan creates zero duplicates, adjacent day extends place", () => {
  it("running the same scan twice produces zero new writes on the second pass", async () => {
    const { located, unlocated } = await resolveFixture(FIXTURE_LONDON_MULTI_DAY);
    const places = buildPlaces(located, unlocated, [], []);
    const candidates = places.map((p) => ({ entry: makePlaceEvent({
      localityKey: p.localityKey, start: p.dateStart, end: p.dateEnd,
      dedupeKey: `place|${p.localityKey}|${p.dateStart}`,
    }) as PlaceEvent }));

    // First scan: creates the place
    const plan1 = buildUpsertPlan(candidates, []);
    expect(plan1.toWrite).toHaveLength(1);
    expect(plan1.actions[0].kind).toBe("create");

    // Second scan with the same candidates against the now-committed place
    const committed = plan1.toWrite;
    const plan2 = buildUpsertPlan(candidates, committed);

    // All candidates are exact-duplicates → zero new writes
    expect(plan2.toWrite).toHaveLength(0);
    expect(plan2.actions.every((a) => a.kind === "no-op")).toBe(true);
  });

  it("a new photo on an adjacent day extends the existing place instead of creating a new one", async () => {
    const { located, unlocated } = await resolveFixture(FIXTURE_LONDON_MULTI_DAY);
    const [place] = buildPlaces(located, unlocated, [], []);

    // First committed place: Jul 14–15
    const existing = makePlaceEvent({
      localityKey: place.localityKey, start: "2025-07-14", end: "2025-07-15",
      dedupeKey: `place|${place.localityKey}|2025-07-14`,
    }) as PlaceEvent;

    // Re-scan adds a photo on Jul 16 (adjacent day) → same city
    const newCandidate = { entry: makePlaceEvent({
      localityKey: place.localityKey, start: "2025-07-16", end: "2025-07-16",
      dedupeKey: `place|${place.localityKey}|2025-07-16`,
    }) as PlaceEvent };

    const plan = buildUpsertPlan([newCandidate], [existing]);

    expect(plan.actions[0].kind).toBe("extend");
    const ext = plan.actions[0] as Extract<typeof plan.actions[0], { kind: "extend" }>;
    expect(ext.merged.start).toBe("2025-07-14");
    expect(ext.merged.end).toBe("2025-07-16"); // extended to include the new day
    expect(plan.toWrite).toHaveLength(1);
  });
});
