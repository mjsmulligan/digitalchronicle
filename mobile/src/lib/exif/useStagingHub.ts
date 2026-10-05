/**
 * WP14 — useStagingHub hook.
 *
 * Reads localityPlaces + placeEntries + placeBinMarkers from the journal store
 * and exposes:
 *   - Hierarchy: grouped by country → region → locality (Place)
 *   - Sorted pending entries per place (significance hints)
 *   - Bin entries (dismissed entries, sorted chronologically)
 *   - Async actions: acceptPlace, dismissPlace, acceptRegion, dismissRegion,
 *     acceptEntry, dismissEntry, restoreEntry, emptyBin, resetDecisions,
 *     mergePlaces
 *
 * All actions write back to the DB via putMany/removeMany and trigger a
 * re-render via the useJournal subscription.
 */

import { useMemo } from "react";
import { useJournal, putMany, removeMany } from "@chronicle/journal/db";
import type { Place, PlaceEntry, PlaceBinMarker } from "@chronicle/journal/types";
import {
  acceptEntry as _accept,
  dismissEntry as _dismiss,
  restoreEntry as _restore,
  acceptPlaceEntries,
  dismissPlaceEntries,
  acceptRegionEntries,
  dismissRegionEntries,
  mergePlaces as _merge,
  emptyBin as _emptyBin,
  resetDecisions as _resetDecisions,
} from "../../../../src/lib/journal/sources/exif/stagingService";
import {
  sortEntriesByHints,
  partitionByRoutine,
} from "../../../../src/lib/journal/sources/exif/stagingHints";

// ─── Derived hierarchy types ──────────────────────────────────────────────────

export interface PlaceGroup {
  place:    Place;
  pending:  PlaceEntry[];   // hint-sorted — unusual first, routine last
  unusual:  PlaceEntry[];
  routine:  PlaceEntry[];
  accepted: PlaceEntry[];
}

export interface RegionGroup {
  region:      string;
  country:     string;
  places:      PlaceGroup[];
  pendingCount: number;
}

export interface CountryGroup {
  country:     string;
  regions:     RegionGroup[];
  pendingCount: number;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useStagingHub() {
  const journal = useJournal();

  const places   = journal.localityPlaces  ?? [];
  const entries  = journal.placeEntries    ?? [];
  const markers  = journal.placeBinMarkers ?? [];
  const events   = journal.events          ?? [];

  // ── Derived hierarchy (memo to avoid re-computing on every render) ──────────
  const { hierarchy, binEntries } = useMemo(() => {
    // Group entries by placeId
    const pendingByPlace  = new Map<string, PlaceEntry[]>();
    const acceptedByPlace = new Map<string, PlaceEntry[]>();
    const dismissed: PlaceEntry[] = [];

    for (const e of entries) {
      if (e.status === "pending") {
        if (!pendingByPlace.has(e.placeId)) pendingByPlace.set(e.placeId, []);
        pendingByPlace.get(e.placeId)!.push(e);
      } else if (e.status === "accepted") {
        if (!acceptedByPlace.has(e.placeId)) acceptedByPlace.set(e.placeId, []);
        acceptedByPlace.get(e.placeId)!.push(e);
      } else {
        dismissed.push(e);
      }
    }

    // Build PlaceGroup for each place
    const placeGroups = new Map<string, PlaceGroup>();
    for (const p of places) {
      const pendingRaw = pendingByPlace.get(p.id) ?? [];
      const sorted     = sortEntriesByHints(pendingRaw, entries, events);
      const { unusual, routine } = partitionByRoutine(sorted, entries);
      placeGroups.set(p.id, {
        place:    p,
        pending:  sorted,
        unusual,
        routine,
        accepted: acceptedByPlace.get(p.id) ?? [],
      });
    }

    // Group by country → region
    const byCountry = new Map<string, Map<string, PlaceGroup[]>>();
    for (const [, pg] of placeGroups) {
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
        const pendingCount = pgs.reduce((n, pg) => n + pg.pending.length, 0);
        regions.push({ region, country, places: pgs, pendingCount });
      }
      // Sort regions: those with pending first, then alphabetically
      regions.sort((a, b) => {
        if (b.pendingCount !== a.pendingCount) return b.pendingCount - a.pendingCount;
        return a.region.localeCompare(b.region);
      });
      const pendingCount = regions.reduce((n, r) => n + r.pendingCount, 0);
      hierarchy.push({ country, regions, pendingCount });
    }
    // Sort countries: most pending first
    hierarchy.sort((a, b) => b.pendingCount - a.pendingCount);

    // Bin entries sorted reverse-chronologically
    const binEntries = dismissed.slice().sort((a, b) => b.localDay.localeCompare(a.localDay));

    return { hierarchy, binEntries };
  }, [places, entries, events]);

  // ── Total pending count ────────────────────────────────────────────────────
  const totalPending = useMemo(
    () => entries.filter((e) => e.status === "pending").length,
    [entries],
  );

  // ── Actions ────────────────────────────────────────────────────────────────

  async function acceptSingleEntry(entry: PlaceEntry) {
    const updated = _accept(entry);
    await putMany("placeEntries", [updated]);
  }

  async function dismissSingleEntry(entry: PlaceEntry) {
    const updated = _dismiss(entry);
    await putMany("placeEntries", [updated]);
  }

  async function restoreSingleEntry(entry: PlaceEntry) {
    const updated = _restore(entry);
    await putMany("placeEntries", [updated]);
  }

  async function acceptPlace(placeId: string) {
    const changed = acceptPlaceEntries(entries, placeId);
    if (changed.length > 0) await putMany("placeEntries", changed);
  }

  async function dismissPlace(placeId: string) {
    const changed = dismissPlaceEntries(entries, placeId);
    if (changed.length > 0) await putMany("placeEntries", changed);
  }

  async function acceptRegion(regionName: string) {
    const changed = acceptRegionEntries(entries, places, regionName);
    if (changed.length > 0) await putMany("placeEntries", changed);
  }

  async function dismissRegion(regionName: string) {
    const changed = dismissRegionEntries(entries, places, regionName);
    if (changed.length > 0) await putMany("placeEntries", changed);
  }

  async function mergePlaces(survivorId: string, absorbedId: string) {
    const survivor = places.find((p) => p.id === survivorId);
    const absorbed = places.find((p) => p.id === absorbedId);
    if (!survivor || !absorbed) return;

    const merged = _merge(survivor, absorbed);
    // Move absorbed's entries to survivor
    const movedEntries = entries
      .filter((e) => e.placeId === absorbedId)
      .map((e) => ({ ...e, placeId: survivorId }));

    await putMany("localityPlaces", [merged]);
    await removeMany("localityPlaces", [absorbedId]);
    if (movedEntries.length > 0) await putMany("placeEntries", movedEntries);
  }

  async function emptyBin() {
    const { entriesToDelete, markersToCreate } = _emptyBin(entries);
    if (markersToCreate.length > 0) await putMany("placeBinMarkers", markersToCreate);
    if (entriesToDelete.length > 0) await removeMany("placeEntries", entriesToDelete);
  }

  async function resetDecisions() {
    const { updatedEntries, markerIdsToDelete } = _resetDecisions(entries, markers);
    if (updatedEntries.length > 0)  await putMany("placeEntries", updatedEntries);
    if (markerIdsToDelete.length > 0) await removeMany("placeBinMarkers", markerIdsToDelete);
  }

  return {
    // Data
    hierarchy,
    binEntries,
    totalPending,
    places,
    entries,
    markers,
    // Actions
    acceptSingleEntry,
    dismissSingleEntry,
    restoreSingleEntry,
    acceptPlace,
    dismissPlace,
    acceptRegion,
    dismissRegion,
    mergePlaces,
    emptyBin,
    resetDecisions,
  };
}
