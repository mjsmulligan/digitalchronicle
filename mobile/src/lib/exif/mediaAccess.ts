/**
 * WP2 — Media access layer.
 *
 * Spec reference: docs/specs/Source spec_ Photo library (EXIF).md, sections 4 & 5.
 *
 * Reads photo metadata from the device's media library using expo-media-library and
 * expo-location (the latter for the Android location-metadata permission). Returns
 * normalised PhotoRecord batches so the rest of the EXIF pipeline stays off-device.
 *
 * Responsibilities:
 *  - Request and report media + location-metadata permissions
 *  - Apply the user's chosen scan scope (all, date range, or specific albums)
 *  - Yield photos in batches of BATCH_SIZE so a large scan can be cancelled / resumed
 *  - Normalise platform EXIF fields into the shared PhotoRecord shape
 *  - Never read assets outside the chosen scope
 *  - Set usedFallbackTime: true on records where file modified time replaced capture time
 *
 * Platform notes:
 *  - EXIF keys differ between iOS and Android (see exifFields.ts in the shared library)
 *  - On Android, GPS fields are null unless the separate location-metadata permission
 *    is granted (separate from the media read permission)
 *  - On iOS, the library returns GPS data with the media permission alone
 */

import * as MediaLibrary from "expo-media-library/legacy";
import * as Location from "expo-location";
import type { PhotoRecord, ScanScope } from "@chronicle/journal/sources/exif/types";
import { normaliseExif, resolveCoordinates } from "@chronicle/journal/sources/exif/exifFields";
import { buildAssetFilter, pageAcrossAlbums } from "@chronicle/journal/sources/exif/assetFilter";

// ─── Constants ────────────────────────────────────────────────────────────────

/** How many assets to fetch per MediaLibrary page. Large enough to amortise overhead. */
const BATCH_SIZE = 100;

// ─── Permission results ───────────────────────────────────────────────────────

export type MediaPermissionResult =
  | { status: "granted"; locationGranted: boolean }
  | { status: "denied"; canAskAgain: boolean }
  | { status: "limited" }   // iOS "selected photos" mode
  | { status: "unavailable" };

/**
 * Check media permissions without prompting the user.
 *
 * Used by the startup check (WP12b) to silently verify status before running
 * the scan. Returns the same MediaPermissionResult shape as requestMediaPermissions
 * so callers can handle both uniformly.
 *
 * Never calls requestPermissionsAsync; always uses getPermissionsAsync.
 */
export async function getMediaPermissions(): Promise<MediaPermissionResult> {
  if (!(await MediaLibrary.isAvailableAsync())) return { status: "unavailable" };

  const mediaPerm = await MediaLibrary.getPermissionsAsync(/* writeOnly */ false);

  if (mediaPerm.status === "denied" || mediaPerm.status === "undetermined") {
    return { status: "denied", canAskAgain: mediaPerm.canAskAgain ?? true };
  }

  if (mediaPerm.accessPrivileges === "limited") {
    return { status: "limited" };
  }

  if (mediaPerm.status !== "granted") {
    return { status: "denied", canAskAgain: false };
  }

  // locationGranted is unknown without requesting; treat as false.
  // The startup check only needs photos after a timestamp, not GPS re-check.
  return { status: "granted", locationGranted: false };
}

/**
 * Request all permissions needed by the EXIF source.
 *
 * Media library read is always requested. Location-metadata is requested separately
 * on Android (spec §4: "Android hides GPS from media reads without it"). On iOS, GPS
 * is included in the media permission and no separate location request is needed.
 *
 * If media permission is denied the source cannot run.
 * If location permission is denied the source runs in time-only mode (no places created).
 */
export async function requestMediaPermissions(): Promise<MediaPermissionResult> {
  if (!(await MediaLibrary.isAvailableAsync())) return { status: "unavailable" };

  const mediaPerm = await MediaLibrary.requestPermissionsAsync(/* writeOnly */ false);

  if (mediaPerm.status === "denied") {
    return { status: "denied", canAskAgain: mediaPerm.canAskAgain };
  }

  if (mediaPerm.accessPrivileges === "limited") {
    // iOS "selected photos" mode — we work with whatever is visible.
    return { status: "limited" };
  }

  // Request location-metadata permission separately (primarily for Android GPS).
  // We use foreground permission — we only need it while the app is active (scan runs in foreground).
  let locationGranted = false;
  try {
    const locPerm = await Location.requestForegroundPermissionsAsync();
    locationGranted = locPerm.status === "granted";
  } catch {
    // expo-location unavailable in this environment (e.g. emulator without Play Services).
    locationGranted = false;
  }

  return { status: "granted", locationGranted };
}

// ─── Album helpers ────────────────────────────────────────────────────────────

/** List all user albums. Returns an empty array if the permission isn't granted. */
export async function listAlbums(): Promise<MediaLibrary.Album[]> {
  try {
    return await MediaLibrary.getAlbumsAsync({ includeSmartAlbums: true });
  } catch {
    return [];
  }
}

// ─── Scan cursor ─────────────────────────────────────────────────────────────

/**
 * Opaque cursor for resuming an interrupted scan.
 * Persisted by the caller (WP7 sync layer); passed back on resume.
 */
export interface ScanCursor {
  /** The MediaLibrary page cursor to resume from (undefined = start from beginning) */
  after?: string;
  /** For an albums scope, which selected album the cursor belongs to (default 0) */
  albumIndex?: number;
  /** Unix timestamp (ms) at which the scan started — used to detect newly-added assets */
  scanStartedAt: number;
  /** Total assets processed so far (for progress reporting) */
  processed: number;
}

// ─── Core scan function ───────────────────────────────────────────────────────

export type ScanProgressCallback = (processed: number, cursor: ScanCursor) => void;
export type CancelToken = { cancelled: boolean };

/**
 * Async generator that yields batches of normalised PhotoRecord values within
 * the requested scope.
 *
 * The caller drives pagination by iterating the generator; stopping iteration
 * (via `return` or `break`) cancels the scan. The generator also checks
 * `cancelToken.cancelled` on each batch so callers can cancel asynchronously.
 *
 * @param scope        Which assets to scan.
 * @param cursor       Resume cursor from a previous interrupted scan; pass undefined to start fresh.
 * @param onProgress   Optional callback invoked after each batch with the current count and cursor.
 * @param cancelToken  Mutable flag that stops the scan when set to true.
 *
 * Usage:
 *   for await (const batch of scanPhotos(scope)) {
 *     for (const photo of batch) { ... }
 *   }
 */
export async function* scanPhotos(
  scope: ScanScope,
  cursor?: ScanCursor,
  onProgress?: ScanProgressCallback,
  cancelToken?: CancelToken,
): AsyncGenerator<PhotoRecord[]> {
  const scanStartedAt = cursor?.scanStartedAt ?? Date.now();
  let processed = cursor?.processed ?? 0;

  const filter = buildAssetFilter(scope);

  // Resolve the selected albums up front. An albums scope that matches no album
  // reads nothing: it must never fall back to the whole library.
  let albums: MediaLibrary.Album[] | null = null;
  if (filter.albumIds !== null) {
    if (filter.albumIds.length === 0) return;
    const all = await listAlbums();
    albums = all.filter((a) => filter.albumIds!.includes(a.id));
    if (albums.length === 0) return;
  }

  const fetchPage = (album: MediaLibrary.Album | undefined, after: string | undefined) => {
    const query: MediaLibrary.AssetsQuery = {
      mediaType: MediaLibrary.MediaType.photo,
      first: BATCH_SIZE,
      after,
      sortBy: [MediaLibrary.SortBy.creationTime],
    };
    if (filter.createdAfter !== undefined) query.createdAfter = filter.createdAfter;
    if (filter.createdBefore !== undefined) query.createdBefore = filter.createdBefore;
    if (album) query.album = album;
    return MediaLibrary.getAssetsAsync(query);
  };

  const pages = pageAcrossAlbums(albums, fetchPage, {
    albumIndex: cursor?.albumIndex,
    after: cursor?.after,
  });

  for await (const page of pages) {
    if (cancelToken?.cancelled) break;

    const batch: PhotoRecord[] = [];

    for (const asset of page.assets) {
      if (cancelToken?.cancelled) break;

      // getAssetInfoAsync returns full EXIF data including GPS.
      let assetInfo: MediaLibrary.AssetInfo;
      try {
        assetInfo = await MediaLibrary.getAssetInfoAsync(asset, { shouldDownloadFromNetwork: false });
      } catch {
        // Asset unreadable, skip.
        continue;
      }

      const exifData = normaliseExif(assetInfo.exif as Record<string, unknown> | null);

      // Determine if we had to fall back to the asset's creation time.
      const usedFallbackTime = exifData.captureTimestamp === null;
      // If no EXIF capture time, use asset.creationTime (milliseconds from MediaLibrary).
      const captureTimestamp = exifData.captureTimestamp
        ?? (asset.creationTime ? asset.creationTime / 1000 : null);

      // The library's location field is signed decimal degrees and is preferred.
      // EXIF is the fallback, parsed from the platform's own format.
      const { latitude, longitude } = resolveCoordinates(exifData, assetInfo.location);

      batch.push({
        mediaId: asset.id,
        uri: asset.uri,
        captureTimestamp,
        tzOffset: exifData.tzOffset,
        latitude,
        longitude,
        cameraMake: exifData.cameraMake,
        cameraModel: exifData.cameraModel,
        ...(usedFallbackTime ? { usedFallbackTime: true } : {}),
        ...(asset.creationTime ? { createdAt: asset.creationTime } : {}),
      });

      processed++;
    }

    yield batch;

    const currentCursor: ScanCursor = {
      after: page.endCursor,
      albumIndex: page.albumIndex,
      scanStartedAt,
      processed,
    };
    onProgress?.(processed, currentCursor);
  }
}
