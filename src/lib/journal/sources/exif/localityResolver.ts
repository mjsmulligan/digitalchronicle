/**
 * WP4 — Locality resolver (pure logic layer).
 *
 * Spec reference: docs/specs/Source spec_ Photo library (EXIF).md, section 8.
 *
 * This module contains:
 *   - coarsenCoords()           — anonymise GPS before sending to geocoder
 *   - perDayKey()               — dedup key (one lookup per coarsened location per day)
 *   - LocalityCache interface   — storage contract for persisting results
 *   - InMemoryLocalityCache     — in-memory implementation for tests
 *   - ResolvingLocalityResolver — caching + dedup + retry wrapper around any resolver
 *
 * The actual device geocoder implementation lives in mobile/src/lib/exif/deviceGeocoder.ts
 * and is injected at runtime. Tests use FakeLocalityResolver from fixtures.ts.
 *
 * No network calls, no device APIs, no React Native imports in this file.
 */

import type { LocalityKey } from "../../types";
import type { LocalityInfo, LocalityResolver } from "./types";

// ─── Key normalisation (WP11) ─────────────────────────────────────────────────

/**
 * Derive a stable, normalised LocalityKey from a geocoder result.
 *
 * Algorithm (spec §8 WP11):
 *   1. NFD decompose so accented characters become base + combining accent.
 *   2. Strip all combining diacritics (U+0300–U+036F).
 *   3. Lowercase and trim.
 *   4. Replace runs of whitespace, hyphens, en-dashes, or em-dashes with a
 *      single ASCII hyphen.
 *   5. Remove any remaining characters that are not a–z, 0–9, or hyphen.
 *   6. Prefix with the lowercase ISO 3166-1 alpha-2 country code.
 *
 * Examples:
 *   normaliseLocalityKey("GB", "London")       → "gb:london"
 *   normaliseLocalityKey("IT", "Porto Venere") → "it:porto-venere"
 *   normaliseLocalityKey("IT", "Portovenere")  → "it:portovenere"   // different spelling
 *   normaliseLocalityKey("DE", "München")      → "de:munchen"
 *   normaliseLocalityKey("BR", "São Paulo")    → "br:sao-paulo"
 *
 * Note: "Porto Venere" and "Portovenere" remain distinct after normalisation
 * (different number of hyphens in the name). They are merged by the user via
 * aliasKeys in the staging UI (acceptance check 14).
 */
export function normaliseLocalityKey(isoCode: string, name: string): LocalityKey {
  const normName = name
    .normalize("NFD")                              // decompose: é → e + U+0301
    .replace(/[̀-ͯ]/g, "")              // drop combining diacritics
    .toLowerCase()
    .trim()
    .replace(/[-\s–—]+/g, "-")          // space / hyphen / en-dash / em-dash → "-"
    .replace(/-+/g, "-")                           // collapse consecutive hyphens
    .replace(/[^a-z0-9-]/g, "");                  // strip anything else
  const normIso = isoCode.toLowerCase().trim();
  return `${normIso}:${normName}` as LocalityKey;
}

// ─── Coordinate coarsening ────────────────────────────────────────────────────

/**
 * Coarsen GPS coordinates to 2 decimal places (≈1.1 km precision at the equator).
 *
 * Spec §8: "send only coarsened coordinates… no timestamps, photo IDs or account details".
 * The resolver interface always receives coarsened coords; the raw coords are never
 * passed to any external service.
 */
export function coarsenCoords(lat: number, lon: number): { lat: number; lon: number } {
  return {
    lat: Math.round(lat * 100) / 100,
    lon: Math.round(lon * 100) / 100,
  };
}

/**
 * Build the per-day dedup key for a coarsened location.
 *
 * Spec §8: "one lookup per distinct coarsened location per day rather than per photo".
 * Multiple photos at (51.51, -0.13) on 2025-07-14 cost exactly one geocoder call.
 */
export function perDayKey(lat: number, lon: number, day: string): string {
  const c = coarsenCoords(lat, lon);
  return `${c.lat},${c.lon}@${day}`;
}

// ─── Cache interface ──────────────────────────────────────────────────────────

/**
 * Persistence contract for resolved locality data.
 *
 * The production implementation (WP7) will back this with the app's SQLite store.
 * Tests use InMemoryLocalityCache.
 *
 * Two access patterns:
 *   - by LocalityKey (name lookup — for the staging mapper, WP6)
 *   - by coarsened coords (avoiding a geocoder re-call for coords already seen)
 */
export interface LocalityCache {
  /** Retrieve a locality by its stable key */
  getByKey(key: LocalityKey): LocalityInfo | undefined;
  /** Persist a locality result by its stable key */
  setByKey(key: LocalityKey, info: LocalityInfo): void;
  /** Retrieve a locality by its coarsened coordinates */
  getByCoords(lat: number, lon: number): LocalityInfo | undefined;
  /** Persist a locality result by its coarsened coordinates */
  setByCoords(lat: number, lon: number, info: LocalityInfo): void;
}

/** In-memory cache for tests and single-session scans */
export class InMemoryLocalityCache implements LocalityCache {
  private byKey = new Map<LocalityKey, LocalityInfo>();
  private byCoords = new Map<string, LocalityInfo>();

  getByKey(key: LocalityKey): LocalityInfo | undefined {
    return this.byKey.get(key);
  }

  setByKey(key: LocalityKey, info: LocalityInfo): void {
    this.byKey.set(key, info);
  }

  getByCoords(lat: number, lon: number): LocalityInfo | undefined {
    const c = coarsenCoords(lat, lon);
    return this.byCoords.get(`${c.lat},${c.lon}`);
  }

  setByCoords(lat: number, lon: number, info: LocalityInfo): void {
    const c = coarsenCoords(lat, lon);
    this.byCoords.set(`${c.lat},${c.lon}`, info);
  }

  /** Test helper: return all cached entries */
  entries(): LocalityInfo[] {
    return [...new Set(this.byKey.values())];
  }
}

// ─── Retry queue ─────────────────────────────────────────────────────────────

/** A pending locality lookup that failed (e.g. offline) and needs retry */
export interface PendingLookup {
  /** Coarsened latitude */
  lat: number;
  /** Coarsened longitude */
  lon: number;
  /** Local day for dedup accounting */
  day: string;
}

// ─── Resolving wrapper ────────────────────────────────────────────────────────

/**
 * A locality resolver that wraps any inner resolver with:
 *
 *   1. Coordinate coarsening (anonymous lookup — raw coords never leave the device)
 *   2. Per-day dedup (spec: max one lookup per distinct coarsened location per day)
 *   3. Cache lookup (avoid repeat geocoder calls for already-resolved coords)
 *   4. Retry queue (failed lookups are queued rather than producing wrong places)
 *
 * This class is instantiated once per scan and reused across batches.
 * Call resetDayDedup() at the start of a new scan day if the scan spans midnight.
 */
export class ResolvingLocalityResolver {
  /** Per-day dedup set — keys are perDayKey() strings */
  private readonly seenThisScan = new Set<string>();
  /** Lookups that failed and should be retried on the next scan */
  private readonly retryQueue: PendingLookup[] = [];

  constructor(
    private readonly inner: LocalityResolver,
    private readonly cache: LocalityCache,
  ) {}

  /**
   * Resolve a GPS coordinate pair to a LocalityInfo.
   *
   * @param rawLat  Raw latitude (will be coarsened before lookup)
   * @param rawLon  Raw longitude (will be coarsened before lookup)
   * @param day     YYYY-MM-DD local day — used for per-day dedup.
   *                Optional but recommended so the dedup rule is correctly enforced.
   * @returns       LocalityInfo if resolved, null if the lookup failed or was deduped
   *                without a cache hit.
   */
  async resolve(rawLat: number, rawLon: number, day?: string): Promise<LocalityInfo | null> {
    const { lat, lon } = coarsenCoords(rawLat, rawLon);

    // Per-day dedup: if we already looked up this coarsened coord today, use cache.
    const dedupKey = day ? perDayKey(rawLat, rawLon, day) : null;
    if (dedupKey && this.seenThisScan.has(dedupKey)) {
      return this.cache.getByCoords(lat, lon) ?? null;
    }

    // Cache hit: no geocoder call needed.
    const cached = this.cache.getByCoords(lat, lon);
    if (cached !== undefined) {
      if (dedupKey) this.seenThisScan.add(dedupKey);
      return cached;
    }

    // Geocoder call — with coarsened coords only (spec §8: anonymous lookup).
    try {
      const result = await this.inner.resolve(lat, lon);
      if (result) {
        this.cache.setByCoords(lat, lon, result);
        this.cache.setByKey(result.key, result);
      }
      if (dedupKey) this.seenThisScan.add(dedupKey);
      return result;
    } catch {
      // Lookup failed (offline / timeout / geocoder error).
      // Spec §8: "stay pending… retried on the next scan. No place is created until resolved."
      if (day !== undefined) {
        this.retryQueue.push({ lat, lon, day });
      }
      return null;
    }
  }

  /**
   * Retry all pending lookups from the queue.
   * Call at the start of the next scan session or when connectivity is restored.
   * Successfully resolved items are removed from the queue; still-failing ones stay.
   */
  async retryPending(): Promise<number> {
    const pending = [...this.retryQueue];
    this.retryQueue.length = 0;
    let resolved = 0;
    for (const { lat, lon, day } of pending) {
      try {
        const result = await this.inner.resolve(lat, lon);
        if (result) {
          this.cache.setByCoords(lat, lon, result);
          this.cache.setByKey(result.key, result);
          resolved++;
        } else {
          // Geocoder returned null (unknown location) — don't keep retrying.
        }
      } catch {
        // Still failing — put back on the queue.
        this.retryQueue.push({ lat, lon, day });
      }
    }
    return resolved;
  }

  /** Reset the per-scan dedup set (e.g. at the start of a new scan). */
  resetDedup(): void {
    this.seenThisScan.clear();
  }

  /** How many lookups are waiting to be retried. */
  get pendingCount(): number {
    return this.retryQueue.length;
  }
}
