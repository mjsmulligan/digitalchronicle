import { describe, it, expect } from "vitest";
import { normaliseExif, parseCoordinate, resolveCoordinates } from "./exifFields";

describe("parseCoordinate", () => {
  it("passes numbers and plain decimal strings through", () => {
    expect(parseCoordinate(51.5074)).toBe(51.5074);
    expect(parseCoordinate("51.5074")).toBeCloseTo(51.5074, 6);
    expect(parseCoordinate("-0.1278")).toBeCloseTo(-0.1278, 6);
  });

  it("reads Android EXIF rationals as degrees, minutes and seconds", () => {
    // 51 deg 30 min 26.64 sec = 51.5074 (London)
    expect(parseCoordinate("51/1,30/1,2664/100")).toBeCloseTo(51.5074, 4);
  });

  it("reads plain DMS triples, comma or space separated", () => {
    expect(parseCoordinate("51,30,26.64")).toBeCloseTo(51.5074, 4);
    expect(parseCoordinate("51 30 26.64")).toBeCloseTo(51.5074, 4);
  });

  it("reads degrees and decimal minutes", () => {
    expect(parseCoordinate("51,30.444")).toBeCloseTo(51.5074, 4);
  });

  it("does not truncate a DMS string to whole degrees", () => {
    // The old parser returned 51 here, about 55 km short.
    expect(parseCoordinate("51/1,30/1,0/1")).toBeCloseTo(51.5, 6);
    expect(parseCoordinate("51/1,30/1,0/1")).not.toBe(51);
  });

  it("keeps the sign of a negative degrees component", () => {
    expect(parseCoordinate("-0,7,40.08")).toBeCloseTo(-0.1278, 4);
  });

  it("rejects anything it cannot read", () => {
    expect(parseCoordinate("")).toBeNull();
    expect(parseCoordinate("north")).toBeNull();
    expect(parseCoordinate("51/0,30/1,0/1")).toBeNull();
    expect(parseCoordinate("1,2,3,4")).toBeNull();
    expect(parseCoordinate(Number.NaN)).toBeNull();
    expect(parseCoordinate(undefined)).toBeNull();
    expect(parseCoordinate({})).toBeNull();
  });
});

describe("resolveCoordinates", () => {
  const exif = { latitude: 51.5, longitude: -0.12 };

  it("prefers the library location over EXIF", () => {
    expect(resolveCoordinates(exif, { latitude: 51.5074, longitude: -0.1278 }))
      .toEqual({ latitude: 51.5074, longitude: -0.1278 });
  });

  it("falls back to EXIF when the library has no location", () => {
    expect(resolveCoordinates(exif, null)).toEqual(exif);
    expect(resolveCoordinates(exif, { latitude: null, longitude: null })).toEqual(exif);
  });

  it("returns nulls when neither source has a usable pair", () => {
    expect(resolveCoordinates({ latitude: null, longitude: null }, undefined))
      .toEqual({ latitude: null, longitude: null });
  });

  it("rejects out of range and the no-fix (0, 0) pair", () => {
    expect(resolveCoordinates({ latitude: 95, longitude: 10 }, null))
      .toEqual({ latitude: null, longitude: null });
    expect(resolveCoordinates({ latitude: 0, longitude: 0 }, null))
      .toEqual({ latitude: null, longitude: null });
  });

  it("uses EXIF when the library location is invalid", () => {
    expect(resolveCoordinates(exif, { latitude: 0, longitude: 0 })).toEqual(exif);
  });
});

describe("normaliseExif GPS", () => {
  it("reads Android rational strings with hemisphere refs", () => {
    const r = normaliseExif({
      GPSLatitude: "51/1,30/1,2664/100",
      GPSLatitudeRef: "N",
      GPSLongitude: "0/1,7/1,4008/100",
      GPSLongitudeRef: "W",
    });
    expect(r.latitude).toBeCloseTo(51.5074, 4);
    // 0 deg 7 min 40.08 sec west = -0.1278
    expect(r.longitude).toBeCloseTo(-0.1278, 4);
  });

  it("reads iOS decimal keys with refs", () => {
    const r = normaliseExif({
      "{GPS}.Latitude": 33.8688,
      "{GPS}.LatitudeRef": "S",
      "{GPS}.Longitude": 151.2093,
      "{GPS}.LongitudeRef": "E",
    });
    expect(r.latitude).toBeCloseTo(-33.8688, 4);
    expect(r.longitude).toBeCloseTo(151.2093, 4);
  });

  it("leaves coordinates null when only one axis is present", () => {
    const r = normaliseExif({ GPSLatitude: "51.5" });
    expect(r.latitude).toBeNull();
    expect(r.longitude).toBeNull();
  });

  it("handles a missing EXIF dictionary", () => {
    expect(normaliseExif(null).latitude).toBeNull();
    expect(normaliseExif(undefined).captureTimestamp).toBeNull();
  });

  it("still reads the capture time and offset as before", () => {
    const r = normaliseExif({
      DateTimeOriginal: "2025:07:14 10:00:00",
      OffsetTimeOriginal: "+01:00",
    });
    expect(r.captureTimestamp).toBe(Date.UTC(2025, 6, 14, 10, 0, 0) / 1000);
    expect(r.tzOffset).toBe("+01:00");
  });
});
