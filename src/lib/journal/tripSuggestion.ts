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
 *   4. A confirmed home-arriving leg must close the window (≤ MAX_TRIP_DAYS).
 *      Suggestions without a return leg are suppressed — open-ended windows
 *      produce false positives when the return journey is missing from the data.
 *   5. The window is rejected if any other leg in it arrives home before the
 *      return leg, which means the traveller came back mid-window and the
 *      candidate is actually two separate trips stitched together.
 *   6. Title is derived from the unique non-home `toName`/`to` values of legs
 *      within the window.
 */
import { allEntries } from "./db";
import { view } from "./types";
import type { JournalData } from "./types";
import { codeToCity } from "./airports";

export const MAX_TRIP_DAYS  = 30;  // most holidays are ≤ 4 weeks; was 90
const HOME_RADIUS_KM        = 75;

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
    if (homeCoords.some((h) => h.code === upper)) return true;
    if (homeCoords.length) {
      const g = journal.gazetteer.find((e) => e.code.toUpperCase() === upper);
      if (g && homeCoords.some((h) => haversineKm(h.lat, h.lon, g.lat, g.lon) < HOME_RADIUS_KM)) {
        return true;
      }
    }
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
    const vOut = view(outLeg);
    if (!isHomeCode(vOut.from)) continue;

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

    // Require a confirmed return — open-ended windows produce false positives
    // when the return journey (e.g. a train home) is absent from the data.
    if (!retLeg) continue;

    const endDay = retLeg.start.slice(0, 10);

    // Collect all legs in the window for validity checks and title building.
    const windowLegs = unlinkedLegs.filter((l) => {
      const d = l.start.slice(0, 10);
      return d >= outDay && d <= endDay;
    });

    // Reject if any leg OTHER than outLeg and retLeg arrives home within the window.
    // This means the traveller came back mid-window — the candidate is really
    // two trips stitched together by a coincidentally close return flight.
    const hasIntermediateHomeArrival = windowLegs.some(
      (l) => l.id !== outLeg.id && l.id !== retLeg.id && isHomeCode(view(l).to)
    );
    if (hasIntermediateHomeArrival) continue;

    // Count every unlinked entry (all kinds) in the date window.
    const inRange = allEntries(journal).filter((e) => {
      if (e.tripId) return false;
      const d = e.start.slice(0, 10);
      return d >= outDay && d <= endDay;
    });

    // Build a title from the true destinations within the window.
    // Remove stopovers: a code is a stopover if it appears as the `from` of
    // another leg in the same window (the traveller only passed through it).
    const departureCodes = new Set(windowLegs.map((l) => view(l).from.toUpperCase()));

    const trueDestLegs = windowLegs.filter((l) => {
      const vl = view(l);
      return !isHomeCode(vl.to) && !departureCodes.has(vl.to.toUpperCase());
    });

    const destLegs = trueDestLegs.length > 0
      ? trueDestLegs
      : windowLegs.filter((l) => !isHomeCode(view(l).to));

    const uniqueDests = [...new Set(destLegs.map((l) => {
      const vl = view(l);
      return vl.toName ?? codeToCity(vl.to);
    }))];
    const title = uniqueDests.length
      ? uniqueDests.slice(0, 2).join(" · ")
      : (vOut.toName ?? codeToCity(vOut.to));

    used.add(outLeg.id);
    used.add(retLeg.id);

    suggestions.push({ title, start: outDay, end: endDay, entryCount: inRange.length });
  }

  return suggestions;
}
