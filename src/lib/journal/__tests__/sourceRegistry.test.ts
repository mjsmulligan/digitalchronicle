/**
 * Tests for the Sources page registry and state helper
 * (mobile/src/lib/sourceRegistry.ts). See docs/specs/sources-page.md WP1.
 */
import { describe, test, expect } from "vitest";
import {
  SOURCE_TILES,
  deriveSourceView,
  fmtRelative,
  tileForConnector,
  tileForConnectedSource,
  type SourceViewInput,
} from "../../../../mobile/src/lib/sourceRegistry";
import { getConnector } from "../connectors/registry";
import { SOURCE_MARKS } from "../connectors/icons";

const NOW = new Date("2026-10-19T18:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function view(over: Partial<SourceViewInput> = {}) {
  return deriveSourceView({
    autoCheck: true,
    lastCheckedAt: ago(2 * HOUR),
    lastError: null,
    active: false,
    now: NOW,
    ...over,
  });
}

describe("tile registry", () => {
  test("order: Connect tiles, then File tiles, Any file last", () => {
    expect(SOURCE_TILES.map((t) => t.id)).toEqual([
      "photos", "calendar", "goodreads",
      "netflix", "letterboxd", "viaduct", "setlistfm",
      "any-file",
    ]);
    const kinds = SOURCE_TILES.map((t) => t.kind);
    const firstFile = kinds.indexOf("file");
    expect(kinds.slice(0, firstFile).every((k) => k === "connect")).toBe(true);
    expect(kinds.slice(firstFile).every((k) => k === "file")).toBe(true);
  });

  test("ids are unique", () => {
    const ids = SOURCE_TILES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every named file tile forces a registered connector", () => {
    for (const t of SOURCE_TILES) {
      if (t.kind !== "file" || !t.connector) continue;
      expect(getConnector(t.connector), t.id).toBeDefined();
    }
  });

  test("Any file has no forced connector, so detection runs", () => {
    const any = SOURCE_TILES.find((t) => t.id === "any-file");
    expect(any?.kind).toBe("file");
    if (any?.kind === "file") expect(any.connector).toBeUndefined();
  });

  test("every markId exists in SOURCE_MARKS", () => {
    for (const t of SOURCE_TILES) {
      if (t.markId) expect(SOURCE_MARKS[t.markId], t.id).toBeDefined();
    }
  });

  test("Connect tiles map to the three sync-runner sources", () => {
    const ids = SOURCE_TILES.flatMap((t) => (t.kind === "connect" ? [t.connectedSourceId] : []));
    expect(ids).toEqual(["photo-library", "icalendar", "goodreads"]);
  });

  test("lookups map a run's source back to its tile", () => {
    expect(tileForConnector("netflix")?.id).toBe("netflix");
    expect(tileForConnector("icalendar")).toBeUndefined();
    expect(tileForConnectedSource("icalendar")?.id).toBe("calendar");
    expect(tileForConnectedSource("netflix")).toBeUndefined();
  });

  test("UI copy has no em dashes", () => {
    for (const t of SOURCE_TILES) {
      const text = [t.label, t.caption, t.kind === "file" ? t.wrongFileMessage : ""].join(" ");
      expect(text).not.toContain("—");
    }
  });
});

describe("fmtRelative", () => {
  test("just now under a minute, and for a future time", () => {
    expect(fmtRelative(ago(20_000), NOW)).toBe("just now");
    expect(fmtRelative(ago(-5 * MIN), NOW)).toBe("just now");
  });
  test("minutes and hours, singular and plural", () => {
    expect(fmtRelative(ago(MIN), NOW)).toBe("1 minute ago");
    expect(fmtRelative(ago(5 * MIN), NOW)).toBe("5 minutes ago");
    expect(fmtRelative(ago(HOUR), NOW)).toBe("1 hour ago");
    expect(fmtRelative(ago(2 * HOUR), NOW)).toBe("2 hours ago");
  });
  test("yesterday, days, then a short date from a week out", () => {
    expect(fmtRelative(ago(DAY), NOW)).toBe("yesterday");
    expect(fmtRelative(ago(3 * DAY), NOW)).toBe("3 days ago");
    expect(fmtRelative("2026-10-12T09:00:00Z", NOW)).toBe("12 Oct");
  });
  test("an unparseable value reads as just now", () => {
    expect(fmtRelative("not a date", NOW)).toBe("just now");
  });
});

describe("deriveSourceView", () => {
  test("healthy and checked: active with relative time", () => {
    expect(view()).toEqual({
      state: "active",
      statusLine: "Checked 2 hours ago",
      needsReconnect: false,
    });
  });

  test("never checked: active, not checked yet", () => {
    expect(view({ lastCheckedAt: null }).statusLine).toBe("Not checked yet");
  });

  test("item count is appended, pluralised and grouped", () => {
    expect(view({ itemCount: 4812 }).statusLine).toBe("Checked 2 hours ago, 4,812 items");
    expect(view({ itemCount: 1 }).statusLine).toBe("Checked 2 hours ago, 1 item");
    expect(view({ itemCount: 0 }).statusLine).toBe("Checked 2 hours ago");
  });

  test("running check wins over everything else", () => {
    const v = view({ active: true, lastError: "Error: Permission needed", autoCheck: false });
    expect(v).toEqual({ state: "checking", statusLine: "Checking now", needsReconnect: false });
  });

  test("permission error needs reconnect and the Error prefix is removed", () => {
    const v = view({ lastError: "Error: Permission needed" });
    expect(v.state).toBe("attention");
    expect(v.needsReconnect).toBe(true);
    expect(v.statusLine).toBe("Permission needed");
  });

  test("Goodreads missing or private profile needs reconnect", () => {
    expect(view({ lastError: "Error: Goodreads profile not found. Check the ID." }).needsReconnect).toBe(true);
    expect(view({ lastError: "Error: Goodreads returned HTTP 403. Is the profile public?" }).needsReconnect).toBe(true);
  });

  test("transient failures need retry, not reconnect", () => {
    const v = view({ lastError: "TypeError: Network request failed" });
    expect(v.state).toBe("attention");
    expect(v.needsReconnect).toBe(false);
    expect(v.statusLine).toBe("Network request failed");
    expect(view({ lastError: "Error: Goodreads returned HTTP 503. Is the profile public?" }).needsReconnect).toBe(true);
  });

  test("an error outranks paused", () => {
    expect(view({ autoCheck: false, lastError: "Error: boom" }).state).toBe("attention");
  });

  test("auto check off with no error is paused", () => {
    expect(view({ autoCheck: false })).toEqual({
      state: "paused",
      statusLine: "Automatic checks are off",
      needsReconnect: false,
    });
  });
});
