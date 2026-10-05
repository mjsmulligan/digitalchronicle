/**
 * EXIF source — test fixture factories.
 *
 * Covers the four fixture sets required by WP9:
 *   A. Multi-day city trip (London, two days)
 *   B. Day trip to a nearby town (Windsor, one day)
 *   C. Suburbs of one city (Dublin suburbs → should resolve to Dublin)
 *   D. Photos with no GPS
 *
 * Also provides helpers for constructing PlaceEvent and PhotoRecord values
 * in unit tests, and a FakeLocalityResolver for use in WP4-onwards tests.
 */

import type { PhotoRecord, TimedPhotoRecord, LocatedPhotoRecord, UnlocatedPhotoRecord, LocalityResolver, LocalityInfo } from "./types";
import type { PlaceEvent, PhotoEvidenceRef } from "../../types";

// ─── Low-level record factories ───────────────────────────────────────────────

let _seq = 0;

/** Build a minimal PhotoRecord with sensible defaults. Override any field. */
export function makePhoto(overrides: Partial<PhotoRecord> = {}): PhotoRecord {
  const id = `media-${++_seq}`;
  return {
    mediaId: id,
    uri: `content://media/external/images/media/${id}`,
    captureTimestamp: Date.UTC(2025, 6, 14, 10, 0, 0) / 1000, // 2025-07-14 10:00 UTC
    tzOffset: "+01:00",
    latitude: 51.5074,  // London (default)
    longitude: -0.1278,
    cameraMake: "Apple",
    cameraModel: "iPhone 15 Pro",
    ...overrides,
  };
}

/** Build a TimedPhotoRecord (PhotoRecord + resolved localDay + timingRule). */
export function makeTimedPhoto(overrides: Partial<PhotoRecord & TimedPhotoRecord> = {}): TimedPhotoRecord {
  const base = makePhoto(overrides);
  return {
    ...base,
    localDay: overrides.localDay ?? "2025-07-14",
    timingRule: overrides.timingRule ?? "exif-offset",
  };
}

// ─── Fixture set A: multi-day city trip (London, 2 days) ─────────────────────

/** Two days of photos in London: 2025-07-14 and 2025-07-15 */
export const FIXTURE_LONDON_MULTI_DAY: TimedPhotoRecord[] = [
  makeTimedPhoto({ localDay: "2025-07-14", latitude: 51.5074, longitude: -0.1278, mediaId: "london-1" }),
  makeTimedPhoto({ localDay: "2025-07-14", latitude: 51.5033, longitude: -0.1195, mediaId: "london-2" }), // Tate Modern
  makeTimedPhoto({ localDay: "2025-07-15", latitude: 51.5194, longitude: -0.1270, mediaId: "london-3" }), // British Museum
  makeTimedPhoto({ localDay: "2025-07-15", latitude: 51.5081, longitude: -0.0759, mediaId: "london-4" }), // Monument
];

// ─── Fixture set B: day trip to nearby town (Windsor, 1 day) ─────────────────

/** One day in Windsor: 2025-07-16 */
export const FIXTURE_WINDSOR_DAY_TRIP: TimedPhotoRecord[] = [
  makeTimedPhoto({ localDay: "2025-07-16", latitude: 51.4840, longitude: -0.6044, mediaId: "windsor-1" }),
  makeTimedPhoto({ localDay: "2025-07-16", latitude: 51.4826, longitude: -0.6076, mediaId: "windsor-2" }),
];

// ─── Fixture set C: suburbs of one city (Dublin) ─────────────────────────────

/**
 * Photos from Dublin suburbs that should all resolve to the same locality key.
 * Rationale: Ranelagh, Sandymount, and Clontarf are all Dublin suburbs; the
 * geocoder returns "Dublin" for all of them. WP4's FakeLocalityResolver maps
 * all three coordinates to the same key so the acceptance test can assert that
 * they produce one place, not three.
 */
export const FIXTURE_DUBLIN_SUBURBS: TimedPhotoRecord[] = [
  makeTimedPhoto({ localDay: "2025-08-01", latitude: 53.3239, longitude: -6.2614, mediaId: "dub-ranelagh" }),   // Ranelagh
  makeTimedPhoto({ localDay: "2025-08-01", latitude: 53.3293, longitude: -6.2235, mediaId: "dub-sandymount" }), // Sandymount
  makeTimedPhoto({ localDay: "2025-08-01", latitude: 53.3688, longitude: -6.2098, mediaId: "dub-clontarf" }),   // Clontarf
];

// ─── Fixture set D: photos with no GPS ────────────────────────────────────────

/** Photos that have no GPS — they should attach as evidence but not create a place */
export const FIXTURE_NO_GPS: TimedPhotoRecord[] = [
  makeTimedPhoto({ localDay: "2025-07-14", latitude: null, longitude: null, timingRule: "fallback", mediaId: "no-gps-1" }),
  makeTimedPhoto({ localDay: "2025-07-14", latitude: null, longitude: null, timingRule: "exif-offset", mediaId: "no-gps-2" }),
];

// ─── Fixture: photos taken during a known leg ─────────────────────────────────

/** Photos that land within a leg's time window — must be excluded from place building */
export const FIXTURE_IN_FLIGHT: TimedPhotoRecord[] = [
  // Flight from Dublin to London: 2025-07-13 11:30–12:45 UTC
  makeTimedPhoto({
    localDay: "2025-07-13",
    captureTimestamp: Date.UTC(2025, 6, 13, 12, 0, 0) / 1000, // mid-flight
    latitude: 52.4, longitude: -3.5, // somewhere over Wales
    mediaId: "inflight-1",
  }),
];

// ─── PlaceEvent factory ───────────────────────────────────────────────────────

/** Build a minimal valid PlaceEvent. Override any field. */
export function makePlaceEvent(overrides: Partial<PlaceEvent> = {}): PlaceEvent {
  const dateStart = overrides.start ?? "2025-07-14";
  const dateEnd = overrides.end ?? "2025-07-15";
  return {
    id: overrides.id ?? `place-${++_seq}`,
    kind: "place",
    source: "photo-library",
    tier: 2,
    start: dateStart,
    end: dateEnd,
    confidence: "inferred",
    locality: overrides.locality ?? "London",
    region: overrides.region ?? "England",
    country: overrides.country ?? "United Kingdom",
    localityKey: overrides.localityKey ?? "gb:london",
    photoEvidence: overrides.photoEvidence ?? [],
    photoCount: overrides.photoCount ?? 4,
    dedupeKey: overrides.dedupeKey ?? `place|${overrides.localityKey ?? "gb:london"}|${dateStart}`,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    ...overrides,
  };
}

/** Build a minimal PhotoEvidenceRef. */
export function makeEvidenceRef(overrides: Partial<PhotoEvidenceRef> = {}): PhotoEvidenceRef {
  return {
    mediaId: overrides.mediaId ?? `media-${++_seq}`,
    localDay: overrides.localDay ?? "2025-07-14",
    hasGps: overrides.hasGps ?? true,
    timingRule: overrides.timingRule ?? "exif-offset",
    ...overrides,
  };
}

// ─── Fake locality resolver ───────────────────────────────────────────────────

/**
 * A synchronous fake LocalityResolver for use in tests.
 *
 * The real WP4 implementation calls the device geocoder. This fake uses a
 * lookup table keyed by coarsened coordinates so tests are deterministic.
 *
 * Coarsening matches WP4's algorithm: round to 2 decimal places.
 */
const FAKE_LOCALITY_TABLE: Record<string, LocalityInfo> = {
  // London
  "51.51,-0.13":  { name: "London", region: "England", country: "United Kingdom", key: "gb:london" },
  "51.50,-0.12":  { name: "London", region: "England", country: "United Kingdom", key: "gb:london" },
  "51.52,-0.13":  { name: "London", region: "England", country: "United Kingdom", key: "gb:london" },
  "51.51,-0.08":  { name: "London", region: "England", country: "United Kingdom", key: "gb:london" },
  // Windsor
  "51.48,-0.60":  { name: "Windsor", region: "Berkshire", country: "United Kingdom", key: "gb:windsor" },
  // Dublin suburbs (all → Dublin)
  "53.32,-6.26":  { name: "Dublin", region: "Leinster", country: "Ireland", key: "ie:dublin" },
  "53.33,-6.22":  { name: "Dublin", region: "Leinster", country: "Ireland", key: "ie:dublin" },
  "53.37,-6.21":  { name: "Dublin", region: "Leinster", country: "Ireland", key: "ie:dublin" },
};

function coarsen(lat: number, lon: number): string {
  return `${Math.round(lat * 100) / 100},${Math.round(lon * 100) / 100}`;
}

export const fakeLocalityResolver: LocalityResolver = {
  async resolve(lat, lon) {
    const key = coarsen(lat, lon);
    return FAKE_LOCALITY_TABLE[key] ?? null;
  },
};
