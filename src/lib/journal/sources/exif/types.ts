/**
 * EXIF photo library source — internal types.
 *
 * These types describe the data flowing through the EXIF pipeline stages
 * (WP2 → WP3 → WP4 → WP5 → WP6). They are separate from the journal's
 * public `PlaceEvent` type (types.ts) which is the final output shape.
 */

import type { LocalityKey } from "../../types";

// ─── Media access layer (WP2) ─────────────────────────────────────────────────

/** Which assets the user chose to scan */
export type ScanScope =
  | { kind: "all" }
  | { kind: "date-range"; start: string; end: string } // YYYY-MM-DD
  | { kind: "albums"; albumIds: string[] };

/**
 * A normalised photo record as returned by the media access layer.
 * Only the fields that the EXIF source reads are present — everything else
 * is discarded at the access layer and never stored.
 */
export interface PhotoRecord {
  /** Platform media asset id (opaque string from the OS) */
  mediaId: string;
  /** File URI or content URI (content:// on Android, ph:// on iOS) */
  uri: string;
  /**
   * Capture time from EXIF DateTimeOriginal as a Unix timestamp (seconds).
   * null if no capture time could be read — file modified time is used instead.
   */
  captureTimestamp: number | null;
  /**
   * EXIF timezone offset string (e.g. "+01:00") or null if not present.
   * Present in EXIF 2.31+ (most phones since 2019).
   */
  tzOffset: string | null;
  /** GPS latitude, or null if absent or permission was declined */
  latitude: number | null;
  /** GPS longitude, or null if absent or permission was declined */
  longitude: number | null;
  /** EXIF Make field (e.g. "Apple") — absent in screenshots and downloaded images */
  cameraMake: string | null;
  /** EXIF Model field (e.g. "iPhone 15 Pro") */
  cameraModel: string | null;
  /** True if the file modified time was used because capture time was absent */
  usedFallbackTime?: boolean;
}

// ─── Time resolution (WP3) ────────────────────────────────────────────────────

/** Which of the three time-resolution rules was applied to a photo */
export type TimingRule = "exif-offset" | "gps-inferred" | "fallback";

/** A photo record enriched with a resolved local day and the rule used */
export interface TimedPhotoRecord extends PhotoRecord {
  /** YYYY-MM-DD local date at the capture location */
  localDay: string;
  timingRule: TimingRule;
}

// ─── Locality resolver (WP4) ─────────────────────────────────────────────────

/** The normalised result of a single reverse-geocode lookup */
export interface LocalityInfo {
  /** Human-readable city / town name */
  name: string;
  region?: string;
  country?: string;
  /** Stable opaque key for deduplication — matches across runs for the same city */
  key: LocalityKey;
  /**
   * Hierarchy level returned by the geocoder.
   *
   * "locality" — a city, town, suburb, or village (the usual case).
   * "region"   — a county, province, or administrative region (e.g. "County Dublin"
   *              when no finer city level is available).
   * "country"  — used as a last resort when only the country resolves.
   *
   * WP11: added to support the parent-place hierarchy in the staging UI.
   * Absent on pre-WP11 cached entries.
   */
  level?: "locality" | "region" | "country";
}

/**
 * Interface that the place builder depends on.
 * The real implementation uses the phone's built-in geocoder (WP4).
 * A fake implementation is used in tests (also WP4).
 */
export interface LocalityResolver {
  resolve(lat: number, lon: number): Promise<LocalityInfo | null>;
}

// ─── Photo record with locality (WP5 input) ──────────────────────────────────

/** A timed photo record that has also been resolved to a locality */
export interface LocatedPhotoRecord extends TimedPhotoRecord {
  locality: LocalityInfo;
}

/**
 * A photo record that has a local day but no GPS (or GPS resolution failed).
 * It can attach as evidence to an existing place but cannot create a new one.
 */
export interface UnlocatedPhotoRecord extends TimedPhotoRecord {
  locality: null;
}

export type ResolvedPhotoRecord = LocatedPhotoRecord | UnlocatedPhotoRecord;

// ─── Place builder (WP5 output) ───────────────────────────────────────────────

/**
 * An intermediate place (not yet a staged item) produced by the place builder.
 * WP6 maps these to PlaceEvent staged items.
 */
export interface BuiltPlace {
  localityKey: LocalityKey;
  locality: string;
  region?: string;
  country?: string;
  dateStart: string; // YYYY-MM-DD
  dateEnd: string;   // YYYY-MM-DD
  /** All photo records that contributed to this place (before sampling for evidence refs) */
  photos: LocatedPhotoRecord[];
  /** Photos with no GPS that were attached by day */
  unlocatedPhotos: UnlocatedPhotoRecord[];
}

// ─── Entry builder output (WP12) ─────────────────────────────────────────────

/**
 * An intermediate per-day place record produced by buildPlaceEntries() (WP12).
 * One BuiltPlaceEntry per (localityKey, localDay) pair.
 * Replaces BuiltPlace's date-range model with the one-entry-per-day model.
 * WP13 maps these to Place containers + PlaceEntry journal records.
 */
export interface BuiltPlaceEntry {
  localityKey: LocalityKey;
  locality: string;
  region?: string;
  country?: string;
  /** Hierarchy level from the geocoder — see LocalityInfo.level. */
  level?: "locality" | "region" | "country";
  /** YYYY-MM-DD — the local day all photos in this group were taken. */
  localDay: string;
  /** All located photos for this locality on this day. */
  photos: LocatedPhotoRecord[];
  /**
   * Unlocated photos attached to this entry.
   * Only populated when exactly one place exists for the day (spec §7).
   */
  unlocatedPhotos: UnlocatedPhotoRecord[];
}

// ─── Sync state (WP7) ────────────────────────────────────────────────────────

/** Persisted per-source scan marker for incremental re-scan */
export interface ExifScanMarker {
  sourceId: "photo-library";
  /** ISO 8601 timestamp of the last completed scan */
  lastScannedAt: string;
  /** The scope that was active on the last scan */
  scope: ScanScope;
}
