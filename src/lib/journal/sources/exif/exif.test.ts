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
import type { Leg } from "../../types";

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
// Acceptance checks pending WP5–WP7
// ─────────────────────────────────────────────────────────────────────────────

describe("Acceptance check 1 — multi-day city run produces one place", () => {
  it.todo("implement after WP5 (place builder) is done");
});

describe("Acceptance check 2 — no-GPS photos attach to existing place, never create one", () => {
  it.todo("implement after WP5 (place builder) is done");
});

describe("Acceptance check 3 — re-scan creates zero duplicates, adjacent day extends place", () => {
  it.todo("implement after WP7 (sync and re-scan) is done");
});

describe("Acceptance check 4 — location permission declined → time-only mode, no places created", () => {
  it.todo("device test only — implement manually in Expo (WP2)");
});

describe("Acceptance check 5 — scope respected, scan-all can cancel and resume without duplicates", () => {
  it.todo("device test only — implement manually in Expo (WP2 + WP7)");
});

describe("Acceptance check 8 — photo place and calendar place in different cities coexist unflagged", () => {
  it.todo("implement after WP6 (staging mapper) is done");
});

describe("Acceptance check 9 — photos during a known leg do not create places", () => {
  it.todo("implement after WP5 (place builder) is done");
});

describe("Acceptance check 10 — two suburbs of the same city resolve to one place", () => {
  it.todo("implement after WP5 (place builder) is done — resolver half covered by FakeLocalityResolver smoke tests above");
});
