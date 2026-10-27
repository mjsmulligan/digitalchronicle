/**
 * EXIF field normalisation (pure).
 *
 * Moved out of mobile/src/lib/exif/mediaAccess.ts so it can be unit tested without
 * expo-media-library. mediaAccess feeds it the platform EXIF dictionary and gets back
 * a platform-neutral shape.
 *
 * Platform notes:
 *   - iOS (Photos framework) uses dot-notation keys: "{Exif}.DateTimeOriginal",
 *     "{GPS}.Latitude" (signed or unsigned decimal degrees) and "{GPS}.LatitudeRef".
 *   - Android (ExifInterface) uses plain keys: "DateTimeOriginal", "GPSLatitude" and
 *     "GPSLatitudeRef". GPSLatitude is the EXIF rational triple as a string, for example
 *     "51/1,30/1,2650/100", not a decimal number.
 */

export interface NormalisedExif {
  captureTimestamp: number | null;
  tzOffset: string | null;
  latitude: number | null;
  longitude: number | null;
  cameraMake: string | null;
  cameraModel: string | null;
}

/**
 * Parse one GPS coordinate component into decimal degrees.
 *
 * Accepts:
 *   - a finite number                      51.5074
 *   - a decimal string                     "51.5074", "-0.1278"
 *   - EXIF rationals, degrees,minutes,secs "51/1,30/1,2650/100"
 *   - plain DMS triples                    "51,30,26.5" or "51 30 26.5"
 *   - degrees and decimal minutes          "51,30.44"
 *
 * Returns null for anything it cannot read. A string with separators is never read
 * as a bare decimal: parseFloat("51,30,26") is 51, which would silently throw away
 * the minutes and seconds and put the photo about 110 km from where it was taken.
 */
export function parseCoordinate(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;

  const str = value.trim();
  if (!str) return null;

  // A single plain decimal, with no separators between components.
  if (/^[+-]?\d+(\.\d+)?$/.test(str)) {
    const n = Number(str);
    return Number.isFinite(n) ? n : null;
  }

  // Otherwise expect two or three components split by commas, whitespace or semicolons.
  const parts = str.split(/[\s,;]+/).filter(Boolean);
  if (parts.length < 2 || parts.length > 3) return null;

  const nums = parts.map(parseComponent);
  if (nums.some((n) => n === null)) return null;

  const [deg, min, sec = 0] = nums as number[];
  if (min < 0 || sec < 0) return null;

  const sign = deg < 0 || parts[0].startsWith("-") ? -1 : 1;
  return sign * (Math.abs(deg) + min / 60 + sec / 3600);
}

/** One component: a decimal ("30.5") or an EXIF rational ("2650/100"). */
function parseComponent(part: string): number | null {
  const rational = part.match(/^([+-]?\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
  if (rational) {
    const num = Number(rational[1]);
    const den = Number(rational[2]);
    if (den === 0) return null;
    const n = num / den;
    return Number.isFinite(n) ? n : null;
  }
  if (/^[+-]?\d+(\.\d+)?$/.test(part)) return Number(part);
  return null;
}

/** True when the pair is a usable latitude/longitude. */
function validCoordinates(lat: number | null, lon: number | null): lat is number {
  return (
    lat !== null && lon !== null &&
    Number.isFinite(lat) && Number.isFinite(lon) &&
    Math.abs(lat) <= 90 && Math.abs(lon) <= 180
  );
}

/**
 * Choose the coordinates for a photo.
 *
 * The library's own location field is already signed decimal degrees, so it wins
 * when present. EXIF is the fallback (Android only exposes the location field when
 * the location-metadata permission is granted). A pair that is out of range is
 * treated as missing, and (0, 0) is rejected because phones write it when they have
 * no fix.
 */
export function resolveCoordinates(
  exifCoords: { latitude: number | null; longitude: number | null },
  location: { latitude?: number | null; longitude?: number | null } | null | undefined,
): { latitude: number | null; longitude: number | null } {
  const candidates = [
    { latitude: location?.latitude ?? null, longitude: location?.longitude ?? null },
    exifCoords,
  ];
  for (const c of candidates) {
    if (validCoordinates(c.latitude, c.longitude) && !(c.latitude === 0 && c.longitude === 0)) {
      return { latitude: c.latitude, longitude: c.longitude };
    }
  }
  return { latitude: null, longitude: null };
}

/**
 * Normalise the platform EXIF dictionary.
 *
 * The capture timestamp handling is unchanged from the original mediaAccess
 * implementation: the EXIF wall-clock time is read as if it were UTC and the time
 * resolver applies the offset afterwards. (That interaction is reviewed separately.)
 */
export function normaliseExif(exif: Record<string, unknown> | null | undefined): NormalisedExif {
  if (!exif) {
    return { captureTimestamp: null, tzOffset: null, latitude: null, longitude: null, cameraMake: null, cameraModel: null };
  }

  // ── Capture timestamp ──
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
  let latitude: number | null = null;
  let longitude: number | null = null;

  const latNum = parseCoordinate(exif["{GPS}.Latitude"] ?? exif["GPSLatitude"]);
  const lonNum = parseCoordinate(exif["{GPS}.Longitude"] ?? exif["GPSLongitude"]);

  if (latNum !== null && lonNum !== null) {
    const latRef = String((exif["{GPS}.LatitudeRef"] ?? exif["GPSLatitudeRef"] ?? "N") as string).toUpperCase();
    const lonRef = String((exif["{GPS}.LongitudeRef"] ?? exif["GPSLongitudeRef"] ?? "E") as string).toUpperCase();
    latitude = latRef === "S" ? -Math.abs(latNum) : Math.abs(latNum);
    longitude = lonRef === "W" ? -Math.abs(lonNum) : Math.abs(lonNum);
  }

  // ── Camera make / model ──
  const cameraMake = String(exif["Make"] ?? exif["{TIFF}.Make"] ?? "").trim() || null;
  const cameraModel = String(exif["Model"] ?? exif["{TIFF}.Model"] ?? "").trim() || null;

  return { captureTimestamp, tzOffset, latitude, longitude, cameraMake, cameraModel };
}
