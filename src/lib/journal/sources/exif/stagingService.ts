/**
 * WP13 — Staging service (pure).
 *
 * Spec reference: docs/specs/Source spec_ Photo library (EXIF).md, §4, §9, draft 7.
 *
 * Responsibilities:
 *   1. buildStagingPlan  — given BuiltPlaceEntry[] + current journal stores, produce
 *                          the minimal set of writes needed: new Places, new pending
 *                          PlaceEntries, and evidence additions to accepted entries.
 *   2. Status actions    — acceptEntry, dismissEntry, restoreEntry (→ pending).
 *   3. Batch actions     — accept/dismiss all pending for a Place or region.
 *   4. mergePlaces       — absorb one Place's key into another as an alias.
 *   5. emptyBin          — produce PlaceBinMarkers from dismissed entries, delete entries.
 *   6. resetDecisions    — return dismissed entries to pending, delete all markers.
 *
 * Deduplication rules (spec §9):
 *   - If a PlaceEntry with the same dedupeKey exists and is dismissed → skip.
 *   - If a PlaceEntry with the same dedupeKey exists and is pending   → skip.
 *   - If a PlaceEntry with the same dedupeKey exists and is accepted
 *     AND new photos are present → add evidence (no new staging item).
 *   - If all photos for a day are covered by a PlaceBinMarker         → skip
 *     (dismissed by photo IDs, even if the geocoder named the place differently).
 *   - Otherwise → create a new pending PlaceEntry (and a Place if needed).
 *
 * No network calls, no device APIs, no React Native imports in this file.
 */

import type { LocalityKey } from "../../types";
import type { Place, PlaceEntry, PlaceBinMarker, PhotoEvidenceRef, PlaceStatus } from "../../types";
import { uid } from "../../types";
import type { BuiltPlaceEntry, LocatedPhotoRecord } from "./types";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum number of photo evidence references stored per PlaceEntry. */
export const MAX_EVIDENCE_REFS = 10;

// ─── Plan builder ─────────────────────────────────────────────────────────────

/** The result of a staging plan run — all three arrays should be written to the DB. */
export interface StagingPlan {
  /** New Place containers to create in the localityPlaces store. */
  newPlaces: Place[];
  /**
   * New pending PlaceEntries to create in the placeEntries store.
   * All have status "pending".
   */
  newEntries: PlaceEntry[];
  /**
   * Existing PlaceEntries with additional photo evidence.
   * These are accepted entries where new photos appeared for the same day.
   * Write these back to the placeEntries store (putMany overwrites by id).
   */
  updatedEntries: PlaceEntry[];
}

/**
 * Build the staging plan for a batch of BuiltPlaceEntry records.
 *
 * @param built            Entry builder output (WP12).
 * @param existingPlaces   Current Place containers in the journal (localityPlaces).
 * @param existingEntries  Current PlaceEntries in the journal (placeEntries).
 * @param existingMarkers  PlaceBinMarkers from emptied-bin operations (placeBinMarkers).
 * @returns                StagingPlan — apply its three arrays to the DB.
 */
export function buildStagingPlan(
  built: BuiltPlaceEntry[],
  existingPlaces: Place[],
  existingEntries: PlaceEntry[],
  existingMarkers: PlaceBinMarker[],
): StagingPlan {
  // ── Index existing data ────────────────────────────────────────────────────

  // Place lookup: localityKey → Place (also from aliasKeys, for post-merge routing)
  const placeByKey = new Map<LocalityKey, Place>(
    existingPlaces.flatMap((p): [LocalityKey, Place][] => [
      [p.localityKey, p],
      ...((p.aliasKeys ?? []).map((ak) => [ak, p] as [LocalityKey, Place])),
    ]),
  );

  // Entry lookup by dedupeKey
  const entryByDedupeKey = new Map<string, PlaceEntry>(
    existingEntries.map((e) => [e.dedupeKey, e]),
  );

  // All photo IDs covered by any PlaceBinMarker (for dismiss-by-photo-IDs, spec §9)
  const coveredByMarker = new Set<string>(
    existingMarkers.flatMap((m) => m.photoIds),
  );

  // ── Accumulate results ────────────────────────────────────────────────────

  const newPlaces:      Place[]       = [];
  const newEntries:     PlaceEntry[]  = [];
  const updatedEntries: PlaceEntry[]  = [];

  // Track newly created places so we don't duplicate within a single plan run
  const addedPlaceKeys = new Map<LocalityKey, Place>();

  for (const b of built) {
    const dedupeKey = `place-entry|${b.localityKey}|${b.localDay}`;
    const allPhotoIds = b.photos.map((p) => p.mediaId);

    // ── Rule 1: bin-match — all photos already covered by a marker ─────────
    if (allPhotoIds.length > 0 && allPhotoIds.every((id) => coveredByMarker.has(id))) {
      continue; // previously dismissed; skip even if geocoder name changed
    }

    // ── Rule 2: matching existing PlaceEntry by dedupeKey ─────────────────
    const existing = entryByDedupeKey.get(dedupeKey);
    if (existing) {
      if (existing.status === "dismissed" || existing.status === "pending") {
        continue; // dismissed: leave it; pending: already in staging
      }
      // status === "accepted" — check for new evidence
      const existingPhotoIds = new Set(existing.photoEvidence.map((r) => r.mediaId));
      const newPhotos = b.photos.filter((p) => !existingPhotoIds.has(p.mediaId));
      if (newPhotos.length === 0) {
        continue; // exact duplicate — no new photos
      }
      // Add new evidence refs (up to the cap)
      const updated = addEvidence(existing, newPhotos);
      if (updated !== existing) updatedEntries.push(updated);
      continue;
    }

    // ── Rule 3: no existing entry → create pending ─────────────────────────
    // Find or create the Place container (check locally-added ones first)
    let place =
      addedPlaceKeys.get(b.localityKey) ??
      placeByKey.get(b.localityKey);

    if (!place) {
      place = {
        id: uid(),
        kind: "place",
        localityKey: b.localityKey,
        locality: b.locality,
        region: b.region,
        country: b.country,
        createdAt: new Date().toISOString(),
      };
      addedPlaceKeys.set(b.localityKey, place);
      newPlaces.push(place);
    }

    // Sample evidence refs for the new entry
    const totalPhotos = b.photos.length + b.unlocatedPhotos.length;
    const evidenceRefs: PhotoEvidenceRef[] = [
      ...b.photos.slice(0, MAX_EVIDENCE_REFS).map((p) => ({
        mediaId: p.mediaId,
        localDay: p.localDay,
        hasGps: true as const,
        timingRule: p.timingRule,
      })),
      ...b.unlocatedPhotos
        .slice(0, Math.max(0, MAX_EVIDENCE_REFS - b.photos.length))
        .map((p) => ({
          mediaId: p.mediaId,
          localDay: p.localDay,
          hasGps: false as const,
          timingRule: p.timingRule,
        })),
    ];

    newEntries.push({
      id: uid(),
      kind: "place-entry",
      source: "photo-library",
      tier: 2,
      start: b.localDay,
      placeId: place.id,
      localityKey: b.localityKey,
      localDay: b.localDay,
      photoEvidence: evidenceRefs,
      photoCount: totalPhotos,
      singlePhoto: totalPhotos === 1,
      status: "pending",
      dedupeKey,
      createdAt: new Date().toISOString(),
    });
  }

  return { newPlaces, newEntries, updatedEntries };
}

// ─── Evidence helper ──────────────────────────────────────────────────────────

/**
 * Return a copy of `entry` with new located photos appended to its evidence,
 * up to MAX_EVIDENCE_REFS. Returns the original object unchanged if nothing was added.
 */
function addEvidence(entry: PlaceEntry, newPhotos: LocatedPhotoRecord[]): PlaceEntry {
  const slots = Math.max(0, MAX_EVIDENCE_REFS - entry.photoEvidence.length);
  if (slots === 0) {
    // Cap already hit — only update photoCount
    return { ...entry, photoCount: entry.photoCount + newPhotos.length };
  }
  const newRefs: PhotoEvidenceRef[] = newPhotos.slice(0, slots).map((p) => ({
    mediaId: p.mediaId,
    localDay: p.localDay,
    hasGps: true as const,
    timingRule: p.timingRule,
  }));
  return {
    ...entry,
    photoEvidence: [...entry.photoEvidence, ...newRefs],
    photoCount: entry.photoCount + newPhotos.length,
  };
}

// ─── Status actions ───────────────────────────────────────────────────────────

/** Accept a single pending PlaceEntry. */
export function acceptEntry(entry: PlaceEntry): PlaceEntry {
  if (entry.status === "accepted") return entry;
  return { ...entry, status: "accepted" as PlaceStatus };
}

/** Dismiss a single pending PlaceEntry (moves it to the bin). */
export function dismissEntry(entry: PlaceEntry): PlaceEntry {
  if (entry.status === "dismissed") return entry;
  return { ...entry, status: "dismissed" as PlaceStatus };
}

/** Restore a dismissed PlaceEntry back to pending. */
export function restoreEntry(entry: PlaceEntry): PlaceEntry {
  if (entry.status !== "dismissed") return entry;
  return { ...entry, status: "pending" as PlaceStatus };
}

// ─── Batch actions ────────────────────────────────────────────────────────────

/**
 * Accept all pending PlaceEntries for a specific Place.
 * Returns only the entries that changed; unchanged entries are omitted.
 */
export function acceptPlaceEntries(
  entries: PlaceEntry[],
  placeId: string,
): PlaceEntry[] {
  return entries
    .filter((e) => e.placeId === placeId && e.status === "pending")
    .map(acceptEntry);
}

/**
 * Dismiss all pending PlaceEntries for a specific Place.
 * Returns only the entries that changed.
 */
export function dismissPlaceEntries(
  entries: PlaceEntry[],
  placeId: string,
): PlaceEntry[] {
  return entries
    .filter((e) => e.placeId === placeId && e.status === "pending")
    .map(dismissEntry);
}

/**
 * Accept all pending PlaceEntries for all localities in a given region.
 *
 * "Region" is matched against the `region` field of the Place container.
 * This implements spec §4: "accepting a region can take its localities with it".
 *
 * @param entries    All PlaceEntries in the journal.
 * @param places     All Place containers (to find localities by region).
 * @param regionName Region name to match (e.g. "Liguria", "Leinster").
 * @returns          Entries that were changed (all → "accepted").
 */
export function acceptRegionEntries(
  entries: PlaceEntry[],
  places: Place[],
  regionName: string,
): PlaceEntry[] {
  const regionPlaceIds = new Set(
    places
      .filter((p) => p.region === regionName)
      .map((p) => p.id),
  );
  return entries
    .filter((e) => regionPlaceIds.has(e.placeId) && e.status === "pending")
    .map(acceptEntry);
}

/**
 * Dismiss all pending PlaceEntries for all localities in a given region.
 * Returns only the entries that changed.
 */
export function dismissRegionEntries(
  entries: PlaceEntry[],
  places: Place[],
  regionName: string,
): PlaceEntry[] {
  const regionPlaceIds = new Set(
    places
      .filter((p) => p.region === regionName)
      .map((p) => p.id),
  );
  return entries
    .filter((e) => regionPlaceIds.has(e.placeId) && e.status === "pending")
    .map(dismissEntry);
}

// ─── Merge ────────────────────────────────────────────────────────────────────

/**
 * Merge two Place containers by absorbing one into the other.
 *
 * The absorbed place's localityKey (and any existing aliasKeys) become aliasKeys
 * on the survivor. After calling this:
 *   - Replace the survivor in localityPlaces with the returned value.
 *   - Delete the absorbed Place from localityPlaces.
 *
 * Future scans: the updated placeByKey map in buildStagingPlan will route both
 * keys to the survivor, so new entries use the survivor's id as placeId.
 *
 * @param survivor  The Place to keep.
 * @param absorbed  The Place to absorb (its key becomes an alias).
 * @returns         Updated survivor with absorbed key(s) in aliasKeys.
 */
export function mergePlaces(survivor: Place, absorbed: Place): Place {
  const aliases = new Set<string>([
    ...(survivor.aliasKeys ?? []),
    absorbed.localityKey,
    ...(absorbed.aliasKeys ?? []),
  ]);
  aliases.delete(survivor.localityKey); // survivor's own key is never an alias
  return {
    ...survivor,
    aliasKeys: aliases.size > 0 ? ([...aliases] as LocalityKey[]) : undefined,
  };
}

// ─── Bin lifecycle ────────────────────────────────────────────────────────────

/**
 * Empty the bin: produce PlaceBinMarkers for each dismissed PlaceEntry, then
 * signal that the entries should be deleted.
 *
 * The markers record the locality key, local day, and photo IDs so future scans
 * can skip the same photos even if the geocoder names the place differently.
 *
 * @param entries  All PlaceEntries in the journal (only dismissed ones are processed).
 * @returns        { entriesToDelete, markersToCreate } — apply both to the DB.
 */
export function emptyBin(entries: PlaceEntry[]): {
  entriesToDelete: string[];
  markersToCreate: PlaceBinMarker[];
} {
  const dismissed = entries.filter((e) => e.status === "dismissed");

  return {
    entriesToDelete: dismissed.map((e) => e.id),
    markersToCreate: dismissed.map((e) => ({
      id: uid(),
      localityKey: e.localityKey,
      localDay: e.localDay,
      photoIds: e.photoEvidence.map((r) => r.mediaId),
    })),
  };
}

/**
 * Reset decisions: return all dismissed entries to pending, and signal that all
 * PlaceBinMarkers should be deleted.
 *
 * After this, a re-scan will offer the same photos again.
 *
 * @param entries  All PlaceEntries in the journal.
 * @param markers  All PlaceBinMarkers in the journal.
 * @returns        { updatedEntries, markerIdsToDelete } — apply both to the DB.
 */
export function resetDecisions(
  entries: PlaceEntry[],
  markers: PlaceBinMarker[],
): {
  updatedEntries: PlaceEntry[];
  markerIdsToDelete: string[];
} {
  return {
    updatedEntries: entries
      .filter((e) => e.status === "dismissed")
      .map(restoreEntry),
    markerIdsToDelete: markers.map((m) => m.id),
  };
}
