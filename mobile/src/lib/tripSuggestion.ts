/**
 * Trip suggestion — scans unlinked legs to find candidate trips based on the
 * user's home airport code(s) from preferences.
 *
 * Algorithm:
 *   1. Look up each home airport code in the gazetteer to get coordinates.
 *   2. A leg's `from`/`to` is "home" if its code matches exactly, OR if the
 *      gazetteer entry for that code is within HOME_RADIUS_KM of home.
 *      This means one airport code covers nearby rail stations automatically.
 *   3. Each home-departing unlinked leg starts a candidate trip window.
 *   4. The nearest subsequent home-arriving unlinked leg closes it (≤ MAX_TRIP_DAYS).
 *   5. Title is derived from the unique non-home `toName`/`to` values of legs
 *      within the window.
 */
import { allEntries } from "@chronicle/journal/db";
import { view } from "@chronicle/journal/types";
import type { JournalData } from "@chronicle/journal/types";

const HOME_RADIUS_KM = 75;
const MAX_TRIP_DAYS  = 90;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R      = 6371;
  const toRad  = (d: number) => (d * Math.PI) / 180;
  const dLat   = toRad(lat2 - lat1);
  const dLon   = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function daysBetween(a: string, b: string): number {
  return Math.round(
    (+new Date(b + "T12:00:00") - +new Date(a + "T12:00:00")) / 86_400_000
  );
}

export interface TripSuggestion {
  title: string;
  start: string; // YYYY-MM-DD
  end: string;   // YYYY-MM-DD
  entryCount: number;
}

export function suggestTrips(
  journal: JournalData,
  homeAirports: string[]
): TripSuggestion[] {
  if (!homeAirports.length) return [];

  // Resolve coordinates for each home airport from the gazetteer.
  const homeCoords = homeAirports.flatMap((code) => {
    const g = journal.gazetteer.find(
      (e) => e.code.toUpperCase() === code.toUpperCase()
    );
    return g ? [{ code: g.code.toUpperCase(), lat: g.lat, lon: g.lon }] : [];
  });

  // Determine whether a given code is "home".
  // Falls back to exact match when the gazetteer hasn't been populated yet.
  function isHomeCode(code: string): boolean {
    const upper = code.toUpperCase();
    // Exact match on a resolved home coord
    if (homeCoords.some((h) => h.code === upper)) return true;
    // Gazetteer-proximity match (covers nearby stations)
    if (homeCoords.length) {
      const g = journal.gazetteer.find((e) => e.code.toUpperCase() === upper);
      if (g && homeCoords.some((h) => haversineKm(h.lat, h.lon, g.lat, g.lon) < HOME_RADIUS_KM)) {
        return true;
      }
    }
    // Plain exact match fallback (gazetteer empty or code not indexed)
    return homeAirports.some((h) => h.toUpperCase() === upper);
  }

  // Only consider unlinked, visible legs, sorted chronologically.
  const unlinkedLegs = [...journal.legs]
    .filter((l) => !l.tripId && !l.hidden)
    .sort((a, b) => a.start.localeCompare(b.start));

  const used        = new Set<string>();
  const suggestions: TripSuggestion[] = [];

  for (const outLeg of unlinkedLegs) {
    if (used.has(outLeg.id)) continue;
    const vOut   = view(outLeg);
    if (!isHomeCode(vOut.from)) continue;  // not a home departure

    const outDay = vOut.start.slice(0, 10);

    // Find the nearest home-arriving leg that closes this trip.
    const retLeg = unlinkedLegs.find(
      (l) =>
        !used.has(l.id) &&
        l.id !== outLeg.id &&
        isHomeCode(view(l).to) &&
        l.start.slice(0, 10) >= outDay &&
        daysBetween(outDay, l.start.slice(0, 10)) <= MAX_TRIP_DAYS
    );

    const endDay = retLeg
      ? retLeg.start.slice(0, 10)
      : outLeg.end
      ? outLeg.end.slice(0, 10)
      : outDay;

    // Count every unlinked entry (all kinds) in the date window.
    const inRange = allEntries(journal).filter((e) => {
      if (e.tripId) return false;
      const d = e.start.slice(0, 10);
      return d >= outDay && d <= endDay;
    });

    // Build a title from the true destinations within the window.
    // Collect all legs in the window, then remove stopovers: a code is a
    // stopover if it appears as the `from` of another leg in the same window
    // (i.e. the traveller only passed through it).
    const windowLegs = unlinkedLegs.filter((l) => {
      const d = l.start.slice(0, 10);
      return d >= outDay && d <= endDay;
    });

    const departureCodes = new Set(windowLegs.map((l) => view(l).from.toUpperCase()));

    const trueDestLegs = windowLegs.filter((l) => {
      const vl = view(l);
      const toCode = vl.to.toUpperCase();
      // Keep only non-home, non-stopover destinations
      return !isHomeCode(vl.to) && !departureCodes.has(toCode);
    });

    // Fall back to all non-home destinations if the stopover filter removed
    // everything (e.g. a round-trip through the same city with no true endpoint)
    const destLegs = trueDestLegs.length > 0
      ? trueDestLegs
      : windowLegs.filter((l) => !isHomeCode(view(l).to));

    const uniqueDests = [...new Set(destLegs.map((l) => view(l).toName ?? view(l).to))];
    const title = uniqueDests.length
      ? uniqueDests.slice(0, 2).join(" · ")
      : (vOut.toName ?? vOut.to);

    used.add(outLeg.id);
    if (retLeg) used.add(retLeg.id);

    suggestions.push({ title, start: outDay, end: endDay, entryCount: inRange.length });
  }

  return suggestions;
}
