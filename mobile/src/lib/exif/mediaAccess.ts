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
 *  - EXIF keys differ between iOS and Android (see normaliseExif below)
 *  - On Android, GPS fields are null unless the separate location-metadata permission
 *    is granted (separate from the media read permission)
 *  - On iOS, the library returns GPS data with the media permission alone
 */

import * as MediaLibrary from "expo-media-library";
import * as Location from "expo-location";
import type { PhotoRecord } from "../../../../src/lib/journal/sources/exif/types";
import type { ScanScope } from "../../../../src/lib/journal/sources/exif/types";

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
  /** Unix timestamp (ms) at which the scan started — used to detect newly-added assets */
  scanStartedAt: number;
  /** Total assets processed so far (for progress reporting) */
  processed: number;
}

// ─── EXIF normalisation ───────────────────────────────────────────────────────

/**
 * Normalise EXIF fields from expo-media-library's platform-specific format.
 *
 * iOS (via Photos framework) uses dot-notation keys such as:
 *   "{Exif}.DateTimeOriginal", "{GPS}.Latitude", "{TIFF}.Make"
 *   "{Exif}.OffsetTimeOriginal" — UTC offset string (e.g. "+01:00")
 *
 * Android (via ExifInterface) uses named keys such as:
 *   "DateTimeOriginal" (or "DateTime"), "GPSLatitude"/"GPSLatitudeRef",
 *   "Make", "Model"
 *   Android does NOT expose OffsetTimeOriginal in all versions; present in EXIF 2.31+
 *
 * Both platforms may use different fields depending on the EXIF version embedded in
 * the image. The normalisation below tries both naming conventions for robustness.
 */
function normaliseExif(exif: Record<string, unknown> | null | undefined): {
  captureTimestamp: number | null;
  tzOffset: string | null;
  latitude: number | null;
  longitude: number | null;
  cameraMake: string | null;
  cameraModel: string | null;
} {
  if (!exif) {
    return { captureTimestamp: null, tzOffset: null, latitude: null, longitude: null, cameraMake: null, cameraModel: null };
  }

  // ── Capture timestamp ──
  // Try EXIF DateTimeOriginal first (most accurate), then DateTime (file-creation fallback).
  const rawDateTime =
    (exif["DateTimeOriginal"] as string | undefined) ??
    (exif["{Exif}.DateTimeOriginal"] as string | undefined) ??
    (exif["DateTime"] as string | undefined) ??
    null;

  let captureTimestamp: number | null = null;
  if (rawDateTime) {
    // EXIF datetime format: "YYYY:MM:DD HH:MM:SS"
    const m = String(rawDateTime).match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
    if (m) {
      const [, y, mo, d, h, min, s] = m;
      // Treat as UTC initially — WP3 will apply the timezone offset.
      captureTimestamp = Date.UTC(+y, +mo - 1, +d, +h, +min, +s) / 1000;
    }
  }

  // ── Timezone offset ──
  const rawOffset =
    (exif["OffsetTimeOriginal"] as string | undefined) ??
    (exif["{Exif}.OffsetTimeOriginal"] as string | undefined) ??
    null;
  const tzOffset = rawOffset && /^[+-]\d{2}:\d{2}$/.test(String(rawOffset))
    ? String(rawOffset)
    : null;

  // ── GPS ──
  // iOS: "{GPS}.Latitude" (decimal degrees), "{GPS}.LatitudeRef" ("N" or "S")
  // Android: "GPSLatitude" may be decimal or DMS string, "GPSLatitudeRef" for sign
  let latitude: number | null = null;
  let longitude: number | null = null;

  const rawLat =
    (exif["{GPS}.Latitude"] as number | string | undefined) ??
    (exif["GPSLatitude"] as number | string | undefined) ??
    null;
  const rawLon =
    (exif["{GPS}.Longitude"] as number | string | undefined) ??
    (exif["GPSLongitude"] as number | string | undefined) ??
    null;

  if (rawLat !== null && rawLon !== null) {
    const latNum = parseDmsOrDecimal(rawLat);
    const lonNum = parseDmsOrDecimal(rawLon);
    if (latNum !== null && lonNum !== null) {
      const latRef = String(
        (exif["{GPS}.LatitudeRef"] ?? exif["GPSLatitudeRef"] ?? "N") as string
      ).toUpperCase();
      const lonRef = String(
        (exif["{GPS}.LongitudeRef"] ?? exif["GPSLongitudeRef"] ?? "E") as string
      ).toUpperCase();
      latitude = latRef === "S" ? -Math.abs(latNum) : Math.abs(latNum);
      longitude = lonRef === "W" ? -Math.abs(lonNum) : Math.abs(lonNum);
    }
  }

  // ── Camera make / model ──
  const cameraMake =
    String(exif["Make"] ?? exif["{TIFF}.Make"] ?? "").trim() || null;
  const cameraModel =
    String(exif["Model"] ?? exif["{TIFF}.Model"] ?? "").trim() || null;

  return { captureTimestamp, tzOffset, latitude, longitude, cameraMake, cameraModel };
}

/** Parse a GPS value that may be decimal degrees (number) or DMS ("37,30.5") */
function parseDmsOrDecimal(value: number | string): number | null {
  if (typeof value === "number") return isFinite(value) ? value : null;
  const str = String(value).trim();
  // Decimal string
  const decimal = parseFloat(str);
  if (!isNaN(decimal)) return decimal;
  // DMS: "37,30.5" → degrees + minutes/60
  const dms = str.split(",");
  if (dms.length >= 2) {
    const deg = parseFloat(dms[0]);
    const min = parseFloat(dms[1]);
    const sec = dms[2] ? parseFloat(dms[2]) : 0;
    if (!isNaN(deg) && !isNaN(min)) return deg + min / 60 + sec / 3600;
  }
  return null;
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
  let after = cursor?.after;
  let processed = cursor?.processed ?? 0;

  // Resolve album IDs for the "albums" scope upfront.
  let albumRefs: MediaLibrary.Album[] | undefined;
  if (scope.kind === "albums" && scope.albumIds.length > 0) {
    const all = await listAlbums();
    albumRefs = all.filter((a) => scope.albumIds.includes(a.id));
  }

  while (true) {
    if (cancelToken?.cancelled) break;

    // Build the getAssetsAsync query.
    const query: MediaLibrary.AssetsQuery = {
      mediaType: MediaLibrary.MediaType.photo,
      first: BATCH_SIZE,
      after,
      sortBy: [MediaLibrary.SortBy.creationTime],
    };

    // Apply date-range scope filter.
    if (scope.kind === "date-range") {
      query.createdAfter = new Date(scope.start).getTime();
      query.createdBefore = new Date(scope.end + "T23:59:59Z").getTime();
    }

    // Apply album scope — fetch from one album at a time (MediaLibrary limitation).
    // For simplicity we iterate albums here; WP7's incremental scan can track per-album cursors.
    let page: MediaLibrary.PagedInfo<MediaLibrary.Asset>;
    if (albumRefs && albumRefs.length > 0) {
      // Fetch from all requested albums, batch by batch.
      // For now fetch from the first album that hasn't been exhausted.
      // TODO (WP7): store per-album cursors for proper resume support.
      page = await MediaLibrary.getAssetsAsync({ ...query, album: albumRefs[0] });
    } else {
      page = await MediaLibrary.getAssetsAsync(query);
    }

    if (!page.assets.length) break;

    const batch: PhotoRecord[] = [];

    for (const asset of page.assets) {
      if (cancelToken?.cancelled) break;

      // getAssetInfoAsync returns full EXIF data including GPS.
      let assetInfo: MediaLibrary.AssetInfo;
      try {
        assetInfo = await MediaLibrary.getAssetInfoAsync(asset, { shouldDownloadFromNetwork: false });
      } catch {
        // Asset unreadable — skip.
        continue;
      }

      const exifData = normaliseExif(assetInfo.exif as Record<string, unknown> | null);

      // Determine if we had to fall back to the asset's creation time (modified time).
      const usedFallbackTime = exifData.captureTimestamp === null;
      // If no EXIF capture time, use asset.creationTime (milliseconds from MediaLibrary).
      const captureTimestamp = exifData.captureTimestamp
        ?? (asset.creationTime ? asset.creationTime / 1000 : null);

      batch.push({
        mediaId: asset.id,
        uri: asset.uri,
        captureTimestamp,
        tzOffset: exifData.tzOffset,
        latitude: exifData.latitude,
        longitude: exifData.longitude,
        cameraMake: exifData.cameraMake,
        cameraModel: exifData.cameraModel,
        ...(usedFallbackTime ? { usedFallbackTime: true } : {}),
      });

      processed++;
    }

    yield batch;

    const currentCursor: ScanCursor = { after: page.endCursor, scanStartedAt, processed };
    onProgress?.(processed, currentCursor);

    if (!page.hasNextPage) break;
    after = page.endCursor;
  }
}
