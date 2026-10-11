/**
 * WP3 — Time resolution (pure).
 *
 * Spec reference: docs/specs/Source spec_ Photo library (EXIF).md, section 6.
 *
 * Takes a PhotoRecord + known trip legs + a fallback timezone and returns a
 * TimedPhotoRecord with a YYYY-MM-DD local day and the rule that was applied.
 *
 * Three rules in priority order:
 *   1. exif-offset  — EXIF OffsetTimeOriginal present (explicit UTC offset)
 *   2. gps-inferred — GPS present; timezone inferred by nearest-gazetteer lookup
 *   3. fallback     — nearest trip leg's destination tz, or the phone's own tz
 *
 * No network calls. No device APIs. All pure functions over data.
 */

import type { PhotoRecord, TimedPhotoRecord } from "./types";
import type { Leg } from "../../types";
import { PLACES } from "../../geo";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Convert a Unix timestamp (seconds) to a YYYY-MM-DD string in a named IANA
 * timezone. Falls back to UTC date if the timezone is unknown to the runtime.
 */
export function dayFromNamedTz(ts: number, tz: string): string {
  try {
    // en-CA produces YYYY-MM-DD natively — no manual formatting needed.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(ts * 1000));
  } catch {
    // Unknown or unsupported timezone — fall back to UTC date.
    const d = new Date(ts * 1000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
}

/**
 * Apply a raw EXIF UTC offset string to a Unix timestamp and return a YYYY-MM-DD.
 *
 * Offset format: "+HH:MM" or "-HH:MM" (from EXIF OffsetTimeOriginal / OffsetTime).
 * We do not need a named IANA timezone here — the raw offset is sufficient to
 * determine which local calendar day the photo belongs to.
 */
export function dayFromRawOffset(ts: number, tzOffset: string): string {
  const sign = tzOffset.startsWith("-") ? -1 : 1;
  const raw = tzOffset.replace(/^[+-]/, "");
  const [hh, mm = "0"] = raw.split(":");
  const offsetMinutes = sign * (Number(hh) * 60 + Number(mm));
  // Shift the UTC instant by the offset and read the UTC date fields.
  const localMs = ts * 1000 + offsetMinutes * 60_000;
  const d = new Date(localMs);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

const DEG_TO_RAD = Math.PI / 180;

/** Great-circle distance in km (Haversine formula) */
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * DEG_TO_RAD;
  const dLon = (lon2 - lon1) * DEG_TO_RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG_TO_RAD) * Math.cos(lat2 * DEG_TO_RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

/**
 * Find the IANA timezone of the nearest place in the shared gazetteer.
 *
 * This is an approximation (gazetteer is airports + major rail stations/cities)
 * but is good enough to determine the continent/timezone for date-day resolution.
 * A 2 500 km ceiling prevents matching a wildly wrong hemisphere.
 *
 * Returns null if no gazetteer entry is within 2 500 km.
 */
export function nearestTzForCoords(lat: number, lon: number): string | null {
  const MAX_KM = 2_500;
  let bestTz: string | null = null;
  let bestDist = Infinity;
  for (const p of Object.values(PLACES)) {
    const d = haversineKm(lat, lon, p.lat, p.lon);
    if (d < bestDist) {
      bestDist = d;
      bestTz = p.timezone;
    }
  }
  return bestDist <= MAX_KM ? bestTz : null;
}

/**
 * Pick a timezone from a list of Legs for a given Unix timestamp.
 *
 * Prefers a leg whose UTC window contains the timestamp (photo taken during transit);
 * if none contains it, picks the leg whose start is nearest in time.
 *
 * Returns null if the legs list is empty or no leg has a resolved endTz.
 */
export function tzFromLegs(ts: number, legs: Leg[]): string | null {
  const tsMs = ts * 1000;

  // First pass: is the photo timestamp inside any leg's UTC window?
  for (const leg of legs) {
    if (!leg.startUTC || !leg.endUTC || !leg.endTz) continue;
    const s = new Date(leg.startUTC).getTime();
    const e = new Date(leg.endUTC).getTime();
    if (tsMs >= s && tsMs <= e) return leg.endTz;
  }

  // Second pass: nearest leg by start time.
  let bestTz: string | null = null;
  let bestDist = Infinity;
  for (const leg of legs) {
    if (!leg.startUTC || !leg.endTz) continue;
    const d = Math.abs(tsMs - new Date(leg.startUTC).getTime());
    if (d < bestDist) {
      bestDist = d;
      bestTz = leg.endTz;
    }
  }
  return bestTz;
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * WP3: Resolve the local calendar day for a photo record.
 *
 * @param photo       Normalised photo record from the media access layer (WP2).
 * @param legs        All known trip legs from the journal — used as fallback tz source.
 * @param fallbackTz  IANA timezone to use when no other source is available.
 *                    Typically `Intl.DateTimeFormat().resolvedOptions().timeZone` at scan time.
 * @returns           The same record enriched with `localDay` (YYYY-MM-DD) and `timingRule`.
 */
export function resolveLocalDay(
  photo: PhotoRecord,
  legs: Leg[],
  fallbackTz: string,
): TimedPhotoRecord {
  // Use captureTimestamp when available; fall back to current time as last resort.
  // The access layer (WP2) should have substituted file modified time already when
  // captureTimestamp is null, setting usedFallbackTime: true on the record.
  const ts = photo.captureTimestamp ?? Date.now() / 1000;

  // Rule 1 — EXIF timezone offset (most accurate; available on most phones since ~2019)
  if (photo.tzOffset) {
    return {
      ...photo,
      localDay: dayFromRawOffset(ts, photo.tzOffset),
      timingRule: "exif-offset",
    };
  }

  // Rule 2 — GPS-inferred timezone (no EXIF offset, but GPS is present)
  if (photo.latitude !== null && photo.longitude !== null) {
    const tz = nearestTzForCoords(photo.latitude, photo.longitude) ?? fallbackTz;
    return {
      ...photo,
      localDay: dayFromNamedTz(ts, tz),
      timingRule: "gps-inferred",
    };
  }

  // Rule 3 — Fallback: nearest trip leg's destination timezone, or the phone's own tz
  const tz = tzFromLegs(ts, legs) ?? fallbackTz;
  return {
    ...photo,
    localDay: dayFromNamedTz(ts, tz),
    timingRule: "fallback",
  };
}
