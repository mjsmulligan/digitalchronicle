/**
 * WP14 — useStagingHub hook.
 *
 * Reads localityPlaces + placeEntries from the journal store and exposes:
 *   - Hierarchy: grouped by country -> region -> locality (Place), filtered to
 *     places with unreviewed entries so the Places screen focuses on what needs
 *     attention (WP12c).
 *   - placeGroupsById: all place groups (including those with 0 unreviewed) so
 *     the detail screen can navigate to any place.
 *   - Async actions: keepEntry, hideEntry, keepPlace, hidePlace, keepRegion,
 *     hideRegion, keepCountry, hideCountry, mergePlaces.
 *
 * emptyBin and resetDecisions are retired from the UI (WP12c). Existing
 * PlaceBinMarker rows keep working: buildStagingPlan still skips photos covered
 * by a marker. The underlying engine functions remain in stagingService.ts.
 *
 * All write actions use hideMany/markReviewed/putMany/removeMany from the DB
 * module, which trigger a re-render via the useJournal subscription.
 */

import { useMemo } from "react";
import {
  useJournal,
  putMany,
  removeMany,
  hideMany,
  markReviewed,
} from "@chronicle/journal/db";
import type { Place, PlaceEntry } from "@chronicle/journal/types";
import {
  mergePlaces as _merge,
} from "@chronicle/journal/sources/exif/stagingService";
import {
  sortEntriesByHints,
  partitionByRoutine,
} from "@chronicle/journal/sources/exif/stagingHints";

// ─── Derived hierarchy types ──────────────────────────────────────────────────

export interface PlaceGroup {
  place:           Place;
  /** Unreviewed entries for this place, hint-sorted (unusual first, routine last). */
  unreviewed:      PlaceEntry[];
  unusual:         PlaceEntry[];
  routine:         PlaceEntry[];
  unreviewedCount: number;
}

export interface RegionGroup {
  region:          string;
  country:         string;
  places:          PlaceGroup[];
  unreviewedCount: number;
}

export interface CountryGroup {
  country:         string;
  regions:         RegionGroup[];
  unreviewedCount: number;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useStagingHub() {
  const journal = useJournal();

  const places  = journal.localityPlaces  ?? [];
  const entries = journal.placeEntries    ?? [];
  const events  = journal.events          ?? [];

  // ── Derived hierarchy ────────────────────────────────────────────────────
  const { hierarchy, placeGroupsById } = useMemo(() => {
    // Collect unreviewed (non-hidden) entries per place
    const unreviewedByPlace = new Map<string, PlaceEntry[]>();
    for (const e of entries) {
      if (e.hidden || e.unreviewed === undefined) continue;
      if (!unreviewedByPlace.has(e.placeId)) unreviewedByPlace.set(e.placeId, []);
      unreviewedByPlace.get(e.placeId)!.push(e);
    }

    // Build a PlaceGroup for every place (even those with 0 unreviewed entries
    // so the detail screen can open any place by ID).
    const placeGroupsById = new Map<string, PlaceGroup>();
    for (const p of places) {
      const unreviewedRaw = unreviewedByPlace.get(p.id) ?? [];
      const sorted        = sortEntriesByHints(unreviewedRaw, entries, events);
      const { unusual, routine } = partitionByRoutine(sorted, entries);
      placeGroupsById.set(p.id, {
        place:           p,
        unreviewed:      sorted,
        unusual,
        routine,
        unreviewedCount: sorted.length,
      });
    }

    // Build hierarchy only from places that have at least one unreviewed entry
    const byCountry = new Map<string, Map<string, PlaceGroup[]>>();
    for (const [, pg] of placeGroupsById) {
      if (pg.unreviewedCount === 0) continue;
      const country = pg.place.country ?? "Unknown";
      const region  = pg.place.region  ?? "—";
      if (!byCountry.has(country)) byCountry.set(country, new Map());
      const byRegion = byCountry.get(country)!;
      if (!byRegion.has(region)) byRegion.set(region, []);
      byRegion.get(region)!.push(pg);
    }

    const hierarchy: CountryGroup[] = [];
    for (const [country, byRegion] of byCountry) {
      const regions: RegionGroup[] = [];
      for (const [region, pgs] of byRegion) {
        const unreviewedCount = pgs.reduce((n, pg) => n + pg.unreviewedCount, 0);
        regions.push({ region, country, places: pgs, unreviewedCount });
      }
      // Most unreviewed first, then alphabetical
      regions.sort((a, b) => {
        if (b.unreviewedCount !== a.unreviewedCount) return b.unreviewedCount - a.unreviewedCount;
        return a.region.localeCompare(b.region);
      });
      const unreviewedCount = regions.reduce((n, r) => n + r.unreviewedCount, 0);
      hierarchy.push({ country, regions, unreviewedCount });
    }
    hierarchy.sort((a, b) => b.unreviewedCount - a.unreviewedCount);

    return { hierarchy, placeGroupsById };
  }, [places, entries, events]);

  // ── Total unreviewed count ────────────────────────────────────────────────
  const totalUnreviewed = useMemo(
    () => entries.filter((e) => !e.hidden && e.unreviewed !== undefined).length,
    [entries],
  );

  // ── Actions ────────────────────────────────────────────────────────────────
  // All actions are immediate: no staging, no commit step.
  // hideMany clears unreviewed flags. markReviewed clears them without hiding.

  async function keepEntry(entry: PlaceEntry) {
    if (entry.unreviewed === undefined) return;
    await markReviewed("placeEntries", [entry.id]);
  }

  async function hideEntry(entry: PlaceEntry) {
    if (entry.hidden) return;
    await hideMany("placeEntries", [entry.id]);
  }

  async function keepPlace(placeId: string) {
    const ids = entries
      .filter((e) => e.placeId === placeId && !e.hidden && e.unreviewed !== undefined)
      .map((e) => e.id);
    if (ids.length) await markReviewed("placeEntries", ids);
  }

  async function hidePlace(placeId: string) {
    // Hides all non-hidden entries for this place (reviewed and unreviewed).
    const ids = entries
      .filter((e) => e.placeId === placeId && !e.hidden)
      .map((e) => e.id);
    if (ids.length) await hideMany("placeEntries", ids);
  }

  async function keepRegion(regionName: string) {
    const regionPlaceIds = new Set(
      places.filter((p) => p.region === regionName).map((p) => p.id)
    );
    const ids = entries
      .filter((e) => regionPlaceIds.has(e.placeId) && !e.hidden && e.unreviewed !== undefined)
      .map((e) => e.id);
    if (ids.length) await markReviewed("placeEntries", ids);
  }

  async function hideRegion(regionName: string) {
    const regionPlaceIds = new Set(
      places.filter((p) => p.region === regionName).map((p) => p.id)
    );
    const ids = entries
      .filter((e) => regionPlaceIds.has(e.placeId) && !e.hidden)
      .map((e) => e.id);
    if (ids.length) await hideMany("placeEntries", ids);
  }

  async function keepCountry(countryName: string) {
    const countryPlaceIds = new Set(
      places.filter((p) => p.country === countryName).map((p) => p.id)
    );
    const ids = entries
      .filter((e) => countryPlaceIds.has(e.placeId) && !e.hidden && e.unreviewed !== undefined)
      .map((e) => e.id);
    if (ids.length) await markReviewed("placeEntries", ids);
  }

  async function hideCountry(countryName: string) {
    const countryPlaceIds = new Set(
      places.filter((p) => p.country === countryName).map((p) => p.id)
    );
    const ids = entries
      .filter((e) => countryPlaceIds.has(e.placeId) && !e.hidden)
      .map((e) => e.id);
    if (ids.length) await hideMany("placeEntries", ids);
  }

  async function mergePlaces(survivorId: string, absorbedId: string) {
    const survivor = places.find((p) => p.id === survivorId);
    const absorbed = places.find((p) => p.id === absorbedId);
    if (!survivor || !absorbed) return;

    const merged = _merge(survivor, absorbed);
    // Move absorbed entries to survivor
    const movedEntries = entries
      .filter((e) => e.placeId === absorbedId)
      .map((e) => ({ ...e, placeId: survivorId }));

    await putMany("localityPlaces", [merged]);
    await removeMany("localityPlaces", [absorbedId]);
    if (movedEntries.length > 0) await putMany("placeEntries", movedEntries);
  }

  return {
    // Data
    hierarchy,
    placeGroupsById,
    totalUnreviewed,
    places,
    entries,
    // Actions
    keepEntry,
    hideEntry,
    keepPlace,
    hidePlace,
    keepRegion,
    hideRegion,
    keepCountry,
    hideCountry,
    mergePlaces,
  };
}
