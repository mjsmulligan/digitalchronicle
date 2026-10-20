/**
 * Tests for the connected-sources sync runner (mobile/src/lib/connectedSources.ts).
 *
 * Verifies: sequential execution, 6-hour throttle, master switch, per-source
 * autoCheck, lastCheckedAt advances only on success, lastError set on failure.
 */
import { describe, test, expect, beforeEach } from "vitest";
import {
  runConnectedSources,
  markSourceChecked,
  setDefaultStorage,
  _resetRegistry,
  SIX_HOURS_MS,
  type SourceDef,
  type SyncStorage,
} from "../../../../mobile/src/lib/connectedSources";

// ── In-memory storage ─────────────────────────────────────────────────────────

class MapStorage implements SyncStorage {
  private _map = new Map<string, string>();
  async get(key: string) { return this._map.get(key) ?? null; }
  async set(key: string, value: string | null) {
    if (value === null) this._map.delete(key);
    else this._map.set(key, value);
  }
  /** Seed a value directly (helper for test setup). */
  seed(key: string, value: string) { this._map.set(key, value); }
}

// ── Fake source factory ───────────────────────────────────────────────────────

function makeSource(
  id: string,
  opts: {
    connected?: boolean;
    check?: () => Promise<void>;
    checkSync?: () => void;
  } = {}
): SourceDef & { calls: number } {
  let calls = 0;
  return {
    id,
    calls: 0 as number,
    async isConnected() { return opts.connected ?? true; },
    async check() {
      calls++;
      (this as { calls: number }).calls = calls;
      if (opts.checkSync) opts.checkSync();
      if (opts.check) await opts.check();
    },
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

let storage: MapStorage;

beforeEach(() => {
  storage = new MapStorage();
  setDefaultStorage(storage);
  _resetRegistry();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("runConnectedSources", () => {

  test("runs connected sources sequentially — source B starts after source A finishes", async () => {
    const order: string[] = [];
    let aRunning = false;

    const a = makeSource("a", {
      check: async () => {
        aRunning = true;
        await Promise.resolve(); // yield
        order.push("a");
        aRunning = false;
      },
    });
    const b = makeSource("b", {
      check: async () => {
        // B must not start while A is still running
        expect(aRunning).toBe(false);
        order.push("b");
      },
    });

    await runConnectedSources([a, b], storage);
    expect(order).toEqual(["a", "b"]);
  });

  test("skips a source whose lastCheckedAt is within the 6-hour window", async () => {
    const recent = new Date(Date.now() - SIX_HOURS_MS + 60_000).toISOString();
    storage.seed("lastCheckedAt_s", recent);
    const s = makeSource("s");
    await runConnectedSources([s], storage);
    expect(s.calls).toBe(0);
  });

  test("runs a source whose lastCheckedAt is older than 6 hours", async () => {
    const old = new Date(Date.now() - SIX_HOURS_MS - 60_000).toISOString();
    storage.seed("lastCheckedAt_s", old);
    const s = makeSource("s");
    await runConnectedSources([s], storage);
    expect(s.calls).toBe(1);
  });

  test("runs a source with no lastCheckedAt (first launch)", async () => {
    const s = makeSource("s");
    await runConnectedSources([s], storage);
    expect(s.calls).toBe(1);
  });

  test("skips a source that is not connected", async () => {
    const s = makeSource("s", { connected: false });
    await runConnectedSources([s], storage);
    expect(s.calls).toBe(0);
  });

  test("skips a source whose autoCheck is turned off", async () => {
    storage.seed("autoCheck_s", "false");
    const s = makeSource("s");
    await runConnectedSources([s], storage);
    expect(s.calls).toBe(0);
  });

  test("skips all sources when the master switch is off", async () => {
    storage.seed("autoCheckMasterEnabled", "false");
    const a = makeSource("a");
    const b = makeSource("b");
    await runConnectedSources([a, b], storage);
    expect(a.calls).toBe(0);
    expect(b.calls).toBe(0);
  });

  test("advances lastCheckedAt on success", async () => {
    const s = makeSource("s");
    const before = Date.now();
    await runConnectedSources([s], storage);
    const stored = await storage.get("lastCheckedAt_s");
    expect(stored).not.toBeNull();
    expect(new Date(stored!).getTime()).toBeGreaterThanOrEqual(before);
    expect(await storage.get("lastError_s")).toBeNull();
  });

  test("does NOT advance lastCheckedAt on failure, but stores lastError", async () => {
    const s = makeSource("s", {
      check: async () => { throw new Error("network down"); },
    });
    await runConnectedSources([s], storage);
    expect(await storage.get("lastCheckedAt_s")).toBeNull();
    expect(await storage.get("lastError_s")).toMatch("network down");
  });

  test("failure in one source does not prevent subsequent sources from running", async () => {
    const failing = makeSource("failing", {
      check: async () => { throw new Error("boom"); },
    });
    const passing = makeSource("passing");
    await runConnectedSources([failing, passing], storage);
    expect(passing.calls).toBe(1);
  });

  test("single-flight: a second call while one is running returns the same promise", async () => {
    let checkCount = 0;
    const s = makeSource("s", {
      check: async () => {
        checkCount++;
        await new Promise<void>((r) => setTimeout(r, 10));
      },
    });

    const p1 = runConnectedSources([s], storage);
    const p2 = runConnectedSources([s], storage);
    expect(p1).toBe(p2);
    await p1;
    expect(checkCount).toBe(1);
  });

  test("markSourceChecked records a manual success and clears an old error", async () => {
    await storage.set("lastError_s", "Error: Permission needed");
    await markSourceChecked("s", storage);
    expect(await storage.get("lastError_s")).toBeNull();
    const stored = await storage.get("lastCheckedAt_s");
    expect(stored).not.toBeNull();
    expect(Math.abs(Date.now() - new Date(stored!).getTime())).toBeLessThan(5000);
  });

});
