/**
 * EXIF photo library source — acceptance tests.
 *
 * Spec reference: docs/specs/Source spec_ Photo library (EXIF).md, section 15.
 *
 * Tests are structured in two groups:
 *   1. Data model checks (WP1) — pass now.
 *   2. Acceptance checks (WP3–WP7) — marked it.todo() until those WPs land.
 *
 * As each WP is implemented, replace the corresponding it.todo() with a real
 * implementation test and import the new module.
 */

import { describe, it, expect } from "vitest";
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

// ─────────────────────────────────────────────────────────────────────────────
// Group 1: Data model (WP1) — verifiable without any pipeline logic
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
// Group 2: PhotoRecord model (WP2 input shape) — fixture smoke tests
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
// Group 3: FakeLocalityResolver (WP4 test double) — smoke test
// ─────────────────────────────────────────────────────────────────────────────

describe("WP4 — FakeLocalityResolver", () => {
  it("resolves London coordinates to the London locality", async () => {
    const result = await fakeLocalityResolver.resolve(51.5074, -0.1278);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("London");
    expect(result!.key).toBe("gb:london");
  });

  it("resolves Dublin suburb coordinates to Dublin", async () => {
    // All three Dublin suburb photos should resolve to the same key
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

// ─────────────────────────────────────────────────────────────────────────────
// Group 4: Acceptance checks (WP3–WP7) — pending implementation
// ─────────────────────────────────────────────────────────────────────────────

describe("Acceptance check 1 — multi-day city run produces one place", () => {
  // spec §15.1: Photos in one city across two days produce one place with that
  // date range, attached to the trip if one covers it.
  it.todo("implement after WP5 (place builder) is done");
});

describe("Acceptance check 2 — no-GPS photos attach to existing place, never create one", () => {
  // spec §15.2: Photos with no GPS attach to the place covering their day and
  // never create a place.
  it.todo("implement after WP5 (place builder) is done");
});

describe("Acceptance check 3 — re-scan creates zero duplicates, adjacent day extends place", () => {
  // spec §15.3: Re-scan creates zero duplicates. Adding photos on an adjacent
  // day extends the existing place.
  it.todo("implement after WP7 (sync and re-scan) is done");
});

describe("Acceptance check 4 — location permission declined → time-only mode, no places created", () => {
  // spec §15.4: With location permission declined, the source runs in time-only
  // mode and creates no places.
  it.todo("implement after WP2 (media access layer) is done");
});

describe("Acceptance check 5 — scope respected, scan-all can cancel and resume without duplicates", () => {
  // spec §15.5: Photos outside the chosen scope are never read. With scan all,
  // a scan can be cancelled and resumed without duplicates.
  it.todo("implement after WP2 (media access layer) and WP7 (sync) are done");
});

describe("Acceptance check 6 — lookups send only coarsened coordinates, max one per place per day", () => {
  // spec §15.6: A lookup sends only coarsened coordinates, with no timestamps
  // or identifiers, and no more than one lookup per distinct place per day.
  it.todo("implement after WP4 (locality resolver) is done");
});

describe("Acceptance check 7 — offline / failed lookup leaves photos pending, no wrong place created", () => {
  // spec §15.7: With the phone offline or a lookup failing, photos stay pending,
  // are retried later, and no wrong place is created.
  it.todo("implement after WP4 (locality resolver) is done");
});

describe("Acceptance check 8 — photo place and calendar place in different cities coexist unflagged", () => {
  // spec §15.8: A photo place in a different city from a calendar entry on the
  // same day produces two items, unflagged, with nothing merged or dropped.
  it.todo("implement after WP6 (staging mapper) is done");
});

describe("Acceptance check 9 — photos during a known leg do not create places", () => {
  // spec §15.9: Photos taken during a known leg do not create places.
  it.todo("implement after WP5 (place builder) is done");
});

describe("Acceptance check 10 — two suburbs of the same city resolve to one place", () => {
  // spec §15.10: Two suburbs of the same city resolve to one place.
  // Note: this acceptance check is about the combination of WP4 resolver
  // output + WP5 grouping. The FakeLocalityResolver above already covers the
  // resolver half; the grouping half is covered once WP5 exists.
  it.todo("implement after WP5 (place builder) is done — resolver half covered by FakeLocalityResolver smoke tests above");
});
