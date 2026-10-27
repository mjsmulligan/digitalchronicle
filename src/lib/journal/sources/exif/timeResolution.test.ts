import { describe, it, expect } from "vitest";
import { normaliseExif } from "./exifFields";
import { resolveLocalDay } from "./timeResolution";
import { isDuringLeg } from "./entryBuilder";
import { makePhoto } from "./fixtures";
import type { Leg } from "../../types";

const DUBLIN = { latitude: 53.35, longitude: -6.26 };
const TOKYO = { latitude: 35.68, longitude: 139.69 };

/** Build a photo the way mediaAccess does: from an EXIF dictionary plus a creation time. */
function photoFromExif(
  exif: Record<string, unknown>,
  coords: { latitude: number | null; longitude: number | null } = {
    latitude: null,
    longitude: null,
  },
  creationMs?: number,
) {
  const e = normaliseExif(exif);
  return makePhoto({
    captureTimestamp: e.captureTimestamp ?? (creationMs !== undefined ? creationMs / 1000 : null),
    localCaptureTime: e.localCaptureTime ?? undefined,
    tzOffset: e.tzOffset,
    latitude: coords.latitude,
    longitude: coords.longitude,
  });
}

describe("resolveLocalDay uses the EXIF wall-clock date", () => {
  // 23:30 on a July evening in Dublin is 22:30 UTC. The old code read 23:30 as UTC and then
  // shifted it by the offset again, which moved the photo to the next day.
  const lateEvening = { DateTimeOriginal: "2025:07:14 23:30:00" };

  it("with an EXIF offset", () => {
    const p = photoFromExif({ ...lateEvening, OffsetTimeOriginal: "+01:00" }, DUBLIN);
    const r = resolveLocalDay(p, [], "Europe/Dublin");
    expect(r.localDay).toBe("2025-07-14");
    expect(r.timingRule).toBe("exif-offset");
  });

  it("with GPS but no offset", () => {
    const p = photoFromExif(lateEvening, DUBLIN, Date.UTC(2025, 6, 14, 22, 30));
    const r = resolveLocalDay(p, [], "Europe/Dublin");
    expect(r.localDay).toBe("2025-07-14");
    expect(r.timingRule).toBe("gps-inferred");
  });

  it("with neither offset nor GPS", () => {
    const p = photoFromExif(lateEvening, undefined, Date.UTC(2025, 6, 14, 22, 30));
    const r = resolveLocalDay(p, [], "Europe/Dublin");
    expect(r.localDay).toBe("2025-07-14");
    expect(r.timingRule).toBe("fallback");
  });

  it("just after midnight stays on the new day", () => {
    const p = photoFromExif(
      { DateTimeOriginal: "2025:07:15 00:10:00", OffsetTimeOriginal: "+01:00" },
      DUBLIN,
    );
    expect(resolveLocalDay(p, [], "Europe/Dublin").localDay).toBe("2025-07-15");
  });

  it("west of UTC: a photo taken in the afternoon in Honolulu is not moved to the next day", () => {
    const p = photoFromExif({
      DateTimeOriginal: "2025:07:14 16:00:00",
      OffsetTimeOriginal: "-10:00",
    });
    expect(resolveLocalDay(p, [], "Europe/Dublin").localDay).toBe("2025-07-14");
  });
});

describe("resolveLocalDay with only a creation time (no EXIF capture time)", () => {
  // 22:30 UTC on 14 July.
  const instant = Date.UTC(2025, 6, 14, 22, 30) / 1000;

  it("applies an EXIF offset to the instant", () => {
    const p = makePhoto({
      captureTimestamp: instant,
      tzOffset: "+02:00",
      latitude: null,
      longitude: null,
    });
    expect(resolveLocalDay(p, [], "Europe/Dublin").localDay).toBe("2025-07-15");
  });

  it("converts the instant to the timezone inferred from GPS", () => {
    const p = makePhoto({ captureTimestamp: instant, tzOffset: null, ...TOKYO });
    const r = resolveLocalDay(p, [], "Europe/Dublin");
    expect(r.localDay).toBe("2025-07-15"); // 07:30 in Tokyo
    expect(r.timingRule).toBe("gps-inferred");
  });

  it("converts the instant to the phone timezone when nothing else is known", () => {
    const p = makePhoto({
      captureTimestamp: instant,
      tzOffset: null,
      latitude: null,
      longitude: null,
    });
    const r = resolveLocalDay(p, [], "Europe/Dublin");
    expect(r.localDay).toBe("2025-07-14"); // 23:30 in Dublin
    expect(r.timingRule).toBe("fallback");
  });
});

describe("normaliseExif capture time", () => {
  it("returns the wall-clock time and a true instant when an offset is present", () => {
    const r = normaliseExif({
      DateTimeOriginal: "2025:07:14 10:00:00",
      OffsetTimeOriginal: "+01:00",
    });
    expect(r.localCaptureTime).toBe("2025-07-14T10:00:00");
    expect(r.captureTimestamp).toBe(Date.UTC(2025, 6, 14, 9, 0, 0) / 1000);
  });

  it("has no instant without an offset, since the wall-clock zone is unknown", () => {
    const r = normaliseExif({ DateTimeOriginal: "2025:07:14 10:00:00" });
    expect(r.localCaptureTime).toBe("2025-07-14T10:00:00");
    expect(r.captureTimestamp).toBeNull();
  });

  it("rejects impossible and zero dates", () => {
    expect(normaliseExif({ DateTimeOriginal: "0000:00:00 00:00:00" }).localCaptureTime).toBeNull();
    expect(normaliseExif({ DateTimeOriginal: "2025:13:40 10:00:00" }).localCaptureTime).toBeNull();
    expect(normaliseExif({ DateTimeOriginal: "2025:02:30 10:00:00" }).localCaptureTime).toBeNull();
    expect(normaliseExif({ DateTimeOriginal: "2025:07:14 25:00:00" }).localCaptureTime).toBeNull();
  });

  it("ignores an offset outside the real range", () => {
    expect(
      normaliseExif({ DateTimeOriginal: "2025:07:14 10:00:00", OffsetTimeOriginal: "+99:99" })
        .tzOffset,
    ).toBeNull();
    expect(
      normaliseExif({ DateTimeOriginal: "2025:07:14 10:00:00", OffsetTimeOriginal: "+05:45" })
        .tzOffset,
    ).toBe("+05:45");
  });

  it("reads the iOS key names", () => {
    const r = normaliseExif({
      "{Exif}.DateTimeOriginal": "2025:07:14 10:00:00",
      "{Exif}.OffsetTimeOriginal": "+01:00",
    });
    expect(r.localCaptureTime).toBe("2025-07-14T10:00:00");
    expect(r.tzOffset).toBe("+01:00");
  });
});

describe("isDuringLeg uses the true instant", () => {
  // Flight 21:00 to 22:00 UTC.
  const leg = {
    start: "2025-07-14",
    end: "2025-07-14",
    startUTC: "2025-07-14T21:00:00.000Z",
    endUTC: "2025-07-14T22:00:00.000Z",
  } as unknown as Leg;

  it("counts a photo taken at 22:30 local (21:30 UTC) as in flight", () => {
    const e = normaliseExif({
      DateTimeOriginal: "2025:07:14 22:30:00",
      OffsetTimeOriginal: "+01:00",
    });
    const timed = resolveLocalDay(
      makePhoto({
        captureTimestamp: e.captureTimestamp,
        localCaptureTime: e.localCaptureTime ?? undefined,
        tzOffset: e.tzOffset,
      }),
      [leg],
      "Europe/Dublin",
    );
    expect(isDuringLeg(timed, [leg])).toBe(true);
  });

  it("does not count a photo taken at 23:30 local (22:30 UTC)", () => {
    const e = normaliseExif({
      DateTimeOriginal: "2025:07:14 23:30:00",
      OffsetTimeOriginal: "+01:00",
    });
    const timed = resolveLocalDay(
      makePhoto({
        captureTimestamp: e.captureTimestamp,
        localCaptureTime: e.localCaptureTime ?? undefined,
        tzOffset: e.tzOffset,
      }),
      [leg],
      "Europe/Dublin",
    );
    expect(isDuringLeg(timed, [leg])).toBe(false);
  });
});
