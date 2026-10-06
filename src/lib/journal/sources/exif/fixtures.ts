/**
 * EXIF source — test fixture factories.
 *
 * Covers fixture sets for WP9 (draft 4 acceptance checks) and WP16 (draft 7):
 *
 * WP9 fixtures:
 *   A. Multi-day city trip (London, two days)
 *   B. Day trip to a nearby town (Windsor, one day)
 *   C. Suburbs of one city (Dublin suburbs → should resolve to Dublin)
 *   D. Photos with no GPS
 *
 * WP16 fixtures:
 *   E. London weekend (Sat + Sun) plus a day trip two weeks later (check 1)
 *   F. Home-area variants — County Dublin vs Dublin from the geocoder (WP11)
 *   G. Cinque Terre villages — Vernazza, Monterosso, Riomaggiore, Corniglia, Manarola
 *      (spec §2: these should remain separate localities — personal significance)
 *   H. Spelling variants — "Porto Venere" vs "Portovenere" (WP11 key normalisation)
 *
 * Also provides factories for constructing PlaceEvent, Place, PlaceEntry and
 * PlaceBinMarker values in unit tests.
 */

import type { PhotoRecord, TimedPhotoRecord, LocatedPhotoRecord, UnlocatedPhotoRecord, LocalityResolver, LocalityInfo } from "./types";
// fakeLocalityResolver is declared later in the file — references below are fine
import type { PlaceEvent, Place, PlaceEntry, PlaceBinMarker, PhotoEvidenceRef, JEvent } from "../../types";
import { uid } from "../../types";

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
  "51.51,-0.13":  { name: "London", region: "England", country: "United Kingdom", key: "gb:london", level: "locality" },
  "51.50,-0.12":  { name: "London", region: "England", country: "United Kingdom", key: "gb:london", level: "locality" },
  "51.52,-0.13":  { name: "London", region: "England", country: "United Kingdom", key: "gb:london", level: "locality" },
  "51.51,-0.08":  { name: "London", region: "England", country: "United Kingdom", key: "gb:london", level: "locality" },
  // Windsor
  "51.48,-0.60":  { name: "Windsor", region: "Berkshire", country: "United Kingdom", key: "gb:windsor", level: "locality" },
  // Dublin suburbs (all → Dublin)
  "53.32,-6.26":  { name: "Dublin", region: "Leinster", country: "Ireland", key: "ie:dublin", level: "locality" },
  "53.33,-6.22":  { name: "Dublin", region: "Leinster", country: "Ireland", key: "ie:dublin", level: "locality" },
  "53.37,-6.21":  { name: "Dublin", region: "Leinster", country: "Ireland", key: "ie:dublin", level: "locality" },
};

function coarsen(lat: number, lon: number): string {
  return `${(Math.round(lat * 100) / 100).toFixed(2)},${(Math.round(lon * 100) / 100).toFixed(2)}`;
}

export const fakeLocalityResolver: LocalityResolver = {
  async resolve(lat, lon) {
    const key = coarsen(lat, lon);
    return FAKE_LOCALITY_TABLE[key] ?? null;
  },
};

// ─── Photo resolution helper ─────────────────────────────────────────────────

/**
 * Run TimedPhotoRecords through the fake resolver to produce the LocatedPhotoRecord /
 * UnlocatedPhotoRecord split that WP5 (buildPlaces) needs as input.
 *
 * Usage in tests:
 *   const { located, unlocated } = await resolveFixture(FIXTURE_LONDON_MULTI_DAY);
 *   const places = buildPlaces(located, unlocated, [], []);
 */
export async function resolveFixture(photos: TimedPhotoRecord[]): Promise<{
  located: LocatedPhotoRecord[];
  unlocated: UnlocatedPhotoRecord[];
}> {
  const located: LocatedPhotoRecord[] = [];
  const unlocated: UnlocatedPhotoRecord[] = [];
  for (const photo of photos) {
    if (photo.latitude !== null && photo.longitude !== null) {
      const info = await fakeLocalityResolver.resolve(photo.latitude, photo.longitude);
      if (info) {
        located.push({ ...photo, locality: info });
      } else {
        unlocated.push({ ...photo, locality: null });
      }
    } else {
      unlocated.push({ ...photo, locality: null });
    }
  }
  return { located, unlocated };
}

// ─── WP16 Fixture E: London weekend + day trip (acceptance check 1) ───────────

/**
 * Fixture E: London weekend (Sat 2025-07-05 + Sun 2025-07-06) plus a day trip
 * on Sat 2025-07-19. Produces one London Place with three PlaceEntries.
 *
 * Used to verify: one place, three entries, two derived visits (consecutive group
 * + lone day), no date ranges stored.
 */
export const FIXTURE_LONDON_WEEKEND: TimedPhotoRecord[] = [
  makeTimedPhoto({ localDay: "2025-07-05", latitude: 51.5074, longitude: -0.1278, mediaId: "lon-wknd-1" }),
  makeTimedPhoto({ localDay: "2025-07-05", latitude: 51.5033, longitude: -0.1195, mediaId: "lon-wknd-2" }),
  makeTimedPhoto({ localDay: "2025-07-06", latitude: 51.5194, longitude: -0.1270, mediaId: "lon-wknd-3" }),
  makeTimedPhoto({ localDay: "2025-07-06", latitude: 51.5081, longitude: -0.0759, mediaId: "lon-wknd-4" }),
];

export const FIXTURE_LONDON_DAY_TRIP: TimedPhotoRecord[] = [
  makeTimedPhoto({ localDay: "2025-07-19", latitude: 51.5074, longitude: -0.1278, mediaId: "lon-trip-1" }),
  makeTimedPhoto({ localDay: "2025-07-19", latitude: 51.5033, longitude: -0.1195, mediaId: "lon-trip-2" }),
];

/** Combined: weekend + day trip → one place, three entries */
export const FIXTURE_LONDON_WEEKEND_PLUS_DAY_TRIP = [
  ...FIXTURE_LONDON_WEEKEND,
  ...FIXTURE_LONDON_DAY_TRIP,
];

// ─── WP16 Fixture F: Home-area variants (County Dublin / Dublin) ──────────────

/**
 * Fixture F: Photos from rural and urban Dublin.
 *
 * Rural coordinates (Malahide, Swords) may return "County Dublin" from the
 * Android geocoder. Urban coordinates return "Dublin".
 *
 * After WP11 hierarchy support these should sit under the same region parent.
 * Before WP11 they produce separate keys; the test for this fixture is todo until WP11.
 */
export const FIXTURE_HOME_AREA_VARIANTS: TimedPhotoRecord[] = [
  // Urban Dublin — geocoder returns "Dublin"
  makeTimedPhoto({ localDay: "2025-09-01", latitude: 53.3498, longitude: -6.2603, mediaId: "home-city-1" }),
  makeTimedPhoto({ localDay: "2025-09-01", latitude: 53.3389, longitude: -6.2574, mediaId: "home-city-2" }),
  // North County Dublin — geocoder returns "County Dublin"
  makeTimedPhoto({ localDay: "2025-09-02", latitude: 53.4503, longitude: -6.1536, mediaId: "home-county-1" }), // Malahide
  makeTimedPhoto({ localDay: "2025-09-02", latitude: 53.4597, longitude: -6.2181, mediaId: "home-county-2" }), // Swords
];

// ─── WP16 Fixture G: Cinque Terre villages ────────────────────────────────────

/**
 * Fixture G: Photos from each of the five Cinque Terre villages over four days.
 *
 * Key insight from the spec (section 2): "significance is not size but personal
 * significance to a memory or an event." These are separate localities and must
 * stay separate — do not merge them into a single "Cinque Terre" place.
 *
 * After WP11 each village is a locality under the Liguria region parent.
 */
export const FIXTURE_CINQUE_TERRE: TimedPhotoRecord[] = [
  // Day 1: Vernazza
  makeTimedPhoto({ localDay: "2025-08-10", latitude: 44.2322, longitude: 9.6839, mediaId: "ct-vernazza-1" }),
  makeTimedPhoto({ localDay: "2025-08-10", latitude: 44.2319, longitude: 9.6842, mediaId: "ct-vernazza-2" }),
  // Day 1 also: Monterosso
  makeTimedPhoto({ localDay: "2025-08-10", latitude: 44.1455, longitude: 9.6546, mediaId: "ct-monterosso-1" }),
  // Day 2: Riomaggiore
  makeTimedPhoto({ localDay: "2025-08-11", latitude: 44.0997, longitude: 9.7400, mediaId: "ct-riomaggiore-1" }),
  makeTimedPhoto({ localDay: "2025-08-11", latitude: 44.1000, longitude: 9.7403, mediaId: "ct-riomaggiore-2" }),
  // Day 2 also: Corniglia
  makeTimedPhoto({ localDay: "2025-08-11", latitude: 44.1698, longitude: 9.7180, mediaId: "ct-corniglia-1" }),
  // Day 3: Manarola
  makeTimedPhoto({ localDay: "2025-08-12", latitude: 44.1066, longitude: 9.7289, mediaId: "ct-manarola-1" }),
  makeTimedPhoto({ localDay: "2025-08-12", latitude: 44.1068, longitude: 9.7291, mediaId: "ct-manarola-2" }),
  // Day 4: back to Vernazza
  makeTimedPhoto({ localDay: "2025-08-13", latitude: 44.2322, longitude: 9.6839, mediaId: "ct-vernazza-3" }),
];

// ─── WP16 Fixture H: Spelling variants ───────────────────────────────────────

/**
 * Fixture H: Porto Venere ("Porto Venere" vs "Portovenere" — two geocoder spellings).
 *
 * Before WP11 key normalisation these produce two separate locality keys:
 *   "it:porto-venere" and "it:portovenere"
 * After WP11 normalisation (spaces/hyphens stripped) they share one key.
 *
 * The Shenzhen spelling variants ("Shenzhen" vs "Shen Zhen") are expected to remain
 * separate until the user merges them in staging (spec §8).
 */
export const FIXTURE_PORTO_VENERE_SPELLING_A: TimedPhotoRecord[] = [
  // Geocoder will return "Porto Venere" for this scan
  makeTimedPhoto({ localDay: "2025-06-15", latitude: 44.0502, longitude: 9.8382, mediaId: "pv-a-1" }),
  makeTimedPhoto({ localDay: "2025-06-15", latitude: 44.0507, longitude: 9.8374, mediaId: "pv-a-2" }),
];

export const FIXTURE_PORTO_VENERE_SPELLING_B: TimedPhotoRecord[] = [
  // Geocoder will return "Portovenere" for this scan
  makeTimedPhoto({ localDay: "2025-06-16", latitude: 44.0502, longitude: 9.8382, mediaId: "pv-b-1" }),
  makeTimedPhoto({ localDay: "2025-06-16", latitude: 44.0507, longitude: 9.8374, mediaId: "pv-b-2" }),
];

// ─── WP16 Extended fake locality resolver ────────────────────────────────────

/**
 * Extended locality lookup table for WP16 fixtures.
 * Extends the WP9 table with Cinque Terre villages, Porto Venere variants, and
 * Dublin county-level entries.
 *
 * Note: Porto Venere entries intentionally return different name strings ("Porto Venere"
 * vs "Portovenere") with the same coordinates to exercise WP11 key normalisation.
 */
const FAKE_LOCALITY_TABLE_V2: Record<string, LocalityInfo> = {
  // ── From WP9 table ──
  "51.51,-0.13":  { name: "London",  region: "England",   country: "United Kingdom", key: "gb:london",  level: "locality" },
  "51.50,-0.12":  { name: "London",  region: "England",   country: "United Kingdom", key: "gb:london",  level: "locality" },
  "51.52,-0.13":  { name: "London",  region: "England",   country: "United Kingdom", key: "gb:london",  level: "locality" },
  "51.51,-0.08":  { name: "London",  region: "England",   country: "United Kingdom", key: "gb:london",  level: "locality" },
  "51.48,-0.60":  { name: "Windsor", region: "Berkshire", country: "United Kingdom", key: "gb:windsor", level: "locality" },
  "53.32,-6.26":  { name: "Dublin",  region: "Leinster",  country: "Ireland",        key: "ie:dublin",  level: "locality" },
  "53.33,-6.22":  { name: "Dublin",  region: "Leinster",  country: "Ireland",        key: "ie:dublin",  level: "locality" },
  "53.37,-6.21":  { name: "Dublin",  region: "Leinster",  country: "Ireland",        key: "ie:dublin",  level: "locality" },
  // ── Fixture E: London weekend (same cells as WP9) ──
  "51.50,-0.08":  { name: "London",  region: "England",   country: "United Kingdom", key: "gb:london",  level: "locality" },
  // ── Fixture F: Home-area variants ──
  // Urban Dublin → city level
  "53.35,-6.26":  { name: "Dublin",         region: "Leinster", country: "Ireland", key: "ie:dublin",        level: "locality" },
  "53.34,-6.26":  { name: "Dublin",         region: "Leinster", country: "Ireland", key: "ie:dublin",        level: "locality" },
  // North County Dublin → subregion/county level (Android geocoder returns "County Dublin" when no city field)
  "53.45,-6.15":  { name: "County Dublin",  region: "Leinster", country: "Ireland", key: "ie:county-dublin", level: "region" },
  "53.46,-6.22":  { name: "County Dublin",  region: "Leinster", country: "Ireland", key: "ie:county-dublin", level: "region" },
  // ── Fixture G: Cinque Terre ──
  "44.23,9.68":   { name: "Vernazza",    region: "Liguria", country: "Italy", key: "it:vernazza",    level: "locality" },
  "44.15,9.65":   { name: "Monterosso", region: "Liguria", country: "Italy", key: "it:monterosso",  level: "locality" },
  "44.10,9.74":   { name: "Riomaggiore",region: "Liguria", country: "Italy", key: "it:riomaggiore", level: "locality" },
  "44.17,9.72":   { name: "Corniglia",   region: "Liguria", country: "Italy", key: "it:corniglia",   level: "locality" },
  "44.11,9.73":   { name: "Manarola",    region: "Liguria", country: "Italy", key: "it:manarola",    level: "locality" },
  // ── Fixture H: Porto Venere spelling variants ──
  // Both point to the same coordinates; the geocoder may return different name strings.
  // "Porto Venere" normalises to "it:porto-venere"; "Portovenere" to "it:portovenere".
  // These remain distinct keys after WP11 normalisation — different spellings, not just
  // different capitalisation. User merges them via aliasKeys (acceptance check 14).
  "44.05,9.84":   { name: "Porto Venere", region: "Liguria", country: "Italy", key: "it:porto-venere", level: "locality" },
};

/**
 * Variant that returns "Portovenere" for the same Porto Venere coordinates.
 * Use this to simulate a second scan that gets a different geocoder response.
 */
const FAKE_LOCALITY_TABLE_V2_PORTOVENERE: Record<string, LocalityInfo> = {
  ...FAKE_LOCALITY_TABLE_V2,
  "44.05,9.84": { name: "Portovenere", region: "Liguria", country: "Italy", key: "it:portovenere", level: "locality" },
};

function coarsenV2(lat: number, lon: number): string {
  return `${(Math.round(lat * 100) / 100).toFixed(2)},${(Math.round(lon * 100) / 100).toFixed(2)}`;
}

/** Extended fake resolver for WP16 tests — covers all WP9 and WP16 fixture localities. */
export const fakeLocalityResolverV2: LocalityResolver = {
  async resolve(lat, lon) {
    return FAKE_LOCALITY_TABLE_V2[coarsenV2(lat, lon)] ?? null;
  },
};

/**
 * Variant that returns "Portovenere" spelling — for testing WP11 normalisation.
 * A scan using this resolver produces key "it:portovenere" instead of "it:porto-venere".
 */
export const fakeLocalityResolverPortoVenereB: LocalityResolver = {
  async resolve(lat, lon) {
    return FAKE_LOCALITY_TABLE_V2_PORTOVENERE[coarsenV2(lat, lon)] ?? null;
  },
};

/** Run TimedPhotoRecords through the v2 resolver (helper for WP16 tests). */
export async function resolveFixtureV2(
  photos: TimedPhotoRecord[],
  resolver: LocalityResolver = fakeLocalityResolverV2,
): Promise<{ located: LocatedPhotoRecord[]; unlocated: UnlocatedPhotoRecord[] }> {
  const located: LocatedPhotoRecord[] = [];
  const unlocated: UnlocatedPhotoRecord[] = [];
  for (const photo of photos) {
    if (photo.latitude !== null && photo.longitude !== null) {
      const info = await resolver.resolve(photo.latitude, photo.longitude);
      if (info) located.push({ ...photo, locality: info });
      else       unlocated.push({ ...photo, locality: null });
    } else {
      unlocated.push({ ...photo, locality: null });
    }
  }
  return { located, unlocated };
}

// ─── WP10 type factories ──────────────────────────────────────────────────────

/** Build a minimal valid Place container. Override any field. */
export function makePlace(overrides: Partial<Place> = {}): Place {
  return {
    id: overrides.id ?? `place-${uid()}`,
    kind: "place",
    localityKey: overrides.localityKey ?? "gb:london",
    locality: overrides.locality ?? "London",
    region: overrides.region ?? "England",
    country: overrides.country ?? "United Kingdom",
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    ...overrides,
  };
}

/** Build a minimal valid PlaceEntry. Override any field. */
export function makePlaceEntry(overrides: Partial<PlaceEntry> = {}): PlaceEntry {
  const localDay = overrides.localDay ?? "2025-07-05";
  return {
    id: overrides.id ?? `entry-${uid()}`,
    kind: "place-entry",
    source: "photo-library",
    tier: 2,
    start: localDay,           // Base.start mirrors localDay
    placeId: overrides.placeId ?? "place-london",
    localityKey: overrides.localityKey ?? "gb:london",
    localDay,
    photoEvidence: overrides.photoEvidence ?? [],
    photoCount: overrides.photoCount ?? 2,
    status: overrides.status ?? "pending",
    dedupeKey: overrides.dedupeKey ?? `place-entry|${overrides.localityKey ?? "gb:london"}|${localDay}`,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    ...overrides,
  };
}

/** Build a minimal valid PlaceBinMarker. Override any field. */
export function makePlaceBinMarker(overrides: Partial<PlaceBinMarker> = {}): PlaceBinMarker {
  return {
    id: overrides.id ?? `marker-${uid()}`,
    localityKey: overrides.localityKey ?? "gb:london",
    localDay: overrides.localDay ?? "2025-07-05",
    photoIds: overrides.photoIds ?? ["media-1", "media-2"],
    ...overrides,
  };
}

/** Build a minimal valid JEvent (calendar/diary event). Override any field. */
export function makeJEvent({ start, ...rest }: Partial<JEvent> & { start: string }): JEvent {
  return {
    id: `event-${uid()}`,
    kind: "event",
    source: "icalendar",
    tier: 1,
    start,
    category: rest.category ?? "activity",
    artist:   rest.artist   ?? "Event",
    venue:    rest.venue    ?? "Venue",
    city:     rest.city     ?? "London",
    createdAt: new Date().toISOString(),
    ...rest,
  } as JEvent;
}
