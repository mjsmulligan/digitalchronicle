/**
 * WP15 — Persisted scan marker for the photo library source.
 *
 * Stores an ExifScanMarker (lastScannedAt + scope) in the same local prefs
 * file used by other app settings (chronicle-prefs.json via expo-file-system).
 *
 * Pattern mirrors goodreadsPrefs.ts.
 */

import * as FileSystem from "expo-file-system/legacy";
import type { ExifScanMarker, ScanScope } from "../../../../src/lib/journal/sources/exif/types";

const PREFS_PATH = (FileSystem.documentDirectory ?? "") + "chronicle-prefs.json";

const SCAN_MARKER_KEY = "photoLibraryScanMarker";

async function readPrefs(): Promise<Record<string, unknown>> {
  try {
    const text = await FileSystem.readAsStringAsync(PREFS_PATH);
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function writePrefs(prefs: Record<string, unknown>): Promise<void> {
  await FileSystem.writeAsStringAsync(PREFS_PATH, JSON.stringify(prefs));
}

/**
 * Read the persisted ExifScanMarker from prefs.
 * Returns null if no scan has been completed yet.
 */
export async function getScanMarker(): Promise<ExifScanMarker | null> {
  const prefs = await readPrefs();
  const raw = prefs[SCAN_MARKER_KEY];
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Partial<ExifScanMarker>;
  if (!m.lastScannedAt || !m.scope) return null;
  return { sourceId: "photo-library", lastScannedAt: m.lastScannedAt, scope: m.scope };
}

/**
 * Persist a completed scan's marker.
 * Called after a scan finishes (phase === "done").
 */
export async function setScanMarker(scope: ScanScope): Promise<void> {
  const prefs = await readPrefs();
  const marker: ExifScanMarker = {
    sourceId: "photo-library",
    lastScannedAt: new Date().toISOString(),
    scope,
  };
  prefs[SCAN_MARKER_KEY] = marker;
  await writePrefs(prefs);
}

/**
 * Clear the scan marker (e.g. after a database reset).
 */
export async function clearScanMarker(): Promise<void> {
  const prefs = await readPrefs();
  delete prefs[SCAN_MARKER_KEY];
  await writePrefs(prefs);
}
