/**
 * WP4 — Device geocoder implementation.
 *
 * Spec reference: docs/specs/Source spec_ Photo library (EXIF).md, section 8.
 *
 * Implements the LocalityResolver interface using the phone's built-in reverse
 * geocoder via expo-location. No API key, no billing, no external service.
 *
 * Key spec requirements implemented here:
 *  - Only coarsened coordinates are ever sent to the geocoder (coarsening happens
 *    in ResolvingLocalityResolver before this function is called).
 *  - The locality level returned is the city/town (spec: "the locality or city field
 *    the geocoder returns; if absent, fall back to the sub-region, then the region").
 *  - The LocalityKey is derived from the geocoder output as "{countryCode}:{city}".
 *
 * Open questions from spec (still to decide on real devices — see spec §8):
 *  - Which admin level the platform geocoders return (suburbs vs. city) on each platform.
 *  - Storage terms for platform geocoders for permanently keeping results.
 */

import * as Location from "expo-location";
import { normaliseLocalityKey } from "../../../../src/lib/journal/sources/exif/localityResolver";
import type { LocalityResolver, LocalityInfo } from "../../../../src/lib/journal/sources/exif/types";

/**
 * Pick the best locality name from an Address object, along with its hierarchy level.
 *
 * Preference (spec §8, WP11): city/district → subregion → region.
 * The exact fields present differ between iOS (uses "city", "district") and
 * Android (uses "city", "subregion", "region"). This function is robust to either.
 *
 * Returns the name and the level at which it was found so callers can set
 * LocalityInfo.level accordingly.
 */
function pickLocality(
  addr: Location.LocationGeocodedAddress,
): { name: string; level: "locality" | "region" | "country" } | null {
  // "city" is the most consistently named field across platforms.
  // "district" (iOS) can resolve to a suburb — we try city first.
  if (addr.city)      return { name: addr.city,      level: "locality" };
  if (addr.district)  return { name: addr.district,  level: "locality" };
  // Subregion / region returns county-level results (e.g. "County Dublin").
  if (addr.subregion) return { name: addr.subregion, level: "region" };
  if (addr.region)    return { name: addr.region,    level: "region" };
  return null;
}

/**
 * The device geocoder implementation of LocalityResolver.
 *
 * expo-location's reverseGeocodeAsync() calls the platform's built-in geocoder:
 *  - iOS: CLGeocoder (Apple)
 *  - Android: Geocoder (Android OS)
 *
 * Returns null if the geocoder returns no results (e.g. open ocean) or if
 * the result can't be normalised to city level.
 *
 * Note: ResolvingLocalityResolver (localityResolver.ts) coarsens coordinates
 * before calling this. Raw GPS coordinates never reach this function.
 */
export const deviceGeocoder: LocalityResolver = {
  async resolve(lat: number, lon: number): Promise<LocalityInfo | null> {
    let results: Location.LocationGeocodedAddress[];
    try {
      results = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lon });
    } catch {
      // Geocoder threw (offline, permissions revoked, rate limit) — propagate so
      // ResolvingLocalityResolver can add to retry queue.
      throw new Error(`Geocoder failed for ${lat},${lon}`);
    }

    if (!results.length) return null;

    const addr = results[0];
    const picked = pickLocality(addr);
    const isoCode = addr.isoCountryCode;

    if (!picked || !isoCode) return null;

    const key = normaliseLocalityKey(isoCode, picked.name);

    return {
      name: picked.name,
      region: addr.region ?? undefined,
      country: addr.country ?? undefined,
      key,
      level: picked.level,
    };
  },
};
