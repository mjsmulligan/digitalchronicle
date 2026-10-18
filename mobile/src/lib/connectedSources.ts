/**
 * Sync runner for connected sources.
 *
 * A "connected" source is one the user has set up (Goodreads, device calendar,
 * photo library). Once connected, it is checked once per app launch, silently,
 * with a 6-hour per-source throttle so a user who opens the app many times a
 * day does not trigger many checks.
 *
 * This module is pure TypeScript (no native dependencies) so it can be tested
 * in Node. The FileSystem-backed prefs storage lives in syncPrefsStorage.ts.
 * Production code calls setDefaultStorage() during boot; tests inject their own.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SourceDef {
  id: string;
  /** Returns true when the source has been configured by the user. */
  isConnected(): Promise<boolean>;
  /**
   * Runs one silent check. MUST NOT set commitProgress or show any UI.
   * Use trigger "startup" when calling importFile.
   */
  check(): Promise<void>;
}

export interface SyncStorage {
  get(key: string): Promise<string | null>;
  /** Pass null to delete the key (revert to default). */
  set(key: string, value: string | null): Promise<void>;
}

export interface SourceState {
  lastCheckedAt: string | null;
  lastError: string | null;
  autoCheck: boolean;
}

// ── Storage injection ─────────────────────────────────────────────────────────

let _defaultStorage: SyncStorage | null = null;

/**
 * Set the default prefs storage used when functions are called without an
 * explicit storage argument. Call this during app boot before the startup
 * hook fires. Tests inject their own in-memory storage here.
 */
export function setDefaultStorage(s: SyncStorage): void {
  _defaultStorage = s;
}

function requireStorage(): SyncStorage {
  if (!_defaultStorage) {
    throw new Error(
      "[connectedSources] storage not initialised — call setDefaultStorage() before using this module"
    );
  }
  return _defaultStorage;
}

// ── Source registry ───────────────────────────────────────────────────────────

export const _registry: SourceDef[] = [];

export function registerSource(def: SourceDef): void {
  if (_registry.some((s) => s.id === def.id)) return; // idempotent
  _registry.push(def);
}

/** Remove all registered sources. Tests only. */
export function _resetRegistry(): void {
  _registry.length = 0;
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

// ── Single-flight guard ───────────────────────────────────────────────────────

let _runningCheck: Promise<void> | null = null;

// ── Runner ────────────────────────────────────────────────────────────────────

/**
 * Run all registered connected sources sequentially and silently.
 *
 * @param sources Override the registry (pass for testing).
 * @param storage Override the default storage (pass for testing).
 */
export function runConnectedSources(
  sources: SourceDef[] = _registry,
  storage: SyncStorage = requireStorage()
): Promise<void> {
  if (_runningCheck) return _runningCheck;
  _runningCheck = _doRun(sources, storage).finally(() => {
    _runningCheck = null;
  });
  return _runningCheck;
}

async function _doRun(sources: SourceDef[], storage: SyncStorage): Promise<void> {
  const masterEnabled = (await storage.get("autoCheckMasterEnabled")) !== "false";
  if (!masterEnabled) return;

  const now = Date.now();

  for (const source of sources) {
    const autoCheck = (await storage.get(`autoCheck_${source.id}`)) !== "false";
    if (!autoCheck) continue;

    const connected = await source.isConnected();
    if (!connected) continue;

    const lastCheckedAt = await storage.get(`lastCheckedAt_${source.id}`);
    if (lastCheckedAt) {
      const elapsed = now - new Date(lastCheckedAt).getTime();
      if (elapsed < SIX_HOURS_MS) continue; // within throttle window
    }

    try {
      await source.check();
      // Advance timestamp ONLY on success
      await storage.set(`lastCheckedAt_${source.id}`, new Date().toISOString());
      await storage.set(`lastError_${source.id}`, null);
    } catch (err) {
      // Do NOT advance lastCheckedAt on failure so the next launch retries
      await storage.set(`lastError_${source.id}`, String(err));
      console.warn(`[connectedSources] ${source.id} check failed:`, err);
    }
  }
}

// ── Manual "Check now" ────────────────────────────────────────────────────────

/**
 * Run a single source immediately, bypassing the throttle.
 * Re-throws on failure so the UI can show the error.
 */
export async function runSourceNow(
  id: string,
  storage: SyncStorage = requireStorage(),
  sources: SourceDef[] = _registry
): Promise<void> {
  const source = sources.find((s) => s.id === id);
  if (!source) return;
  try {
    await source.check();
    await storage.set(`lastCheckedAt_${id}`, new Date().toISOString());
    await storage.set(`lastError_${id}`, null);
  } catch (err) {
    await storage.set(`lastError_${id}`, String(err));
    throw err;
  }
}

// ── Prefs accessors ───────────────────────────────────────────────────────────

export async function getSourceState(
  id: string,
  storage: SyncStorage = requireStorage()
): Promise<SourceState> {
  return {
    lastCheckedAt: await storage.get(`lastCheckedAt_${id}`),
    lastError: await storage.get(`lastError_${id}`),
    autoCheck: (await storage.get(`autoCheck_${id}`)) !== "false",
  };
}

export async function setSourceAutoCheck(
  id: string,
  enabled: boolean,
  storage: SyncStorage = requireStorage()
): Promise<void> {
  // Store "false" to disable; null (delete) to enable (the default is true)
  await storage.set(`autoCheck_${id}`, enabled ? null : "false");
}

export async function getMasterAutoCheck(
  storage: SyncStorage = requireStorage()
): Promise<boolean> {
  return (await storage.get("autoCheckMasterEnabled")) !== "false";
}

export async function setMasterAutoCheck(
  enabled: boolean,
  storage: SyncStorage = requireStorage()
): Promise<void> {
  await storage.set("autoCheckMasterEnabled", enabled ? null : "false");
}
