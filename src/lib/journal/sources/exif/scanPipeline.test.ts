import { describe, it, expect } from "vitest";
import { InMemoryLocalityCache, ResolvingLocalityResolver } from "./localityResolver";
import {
  createdAtList,
  newestCreatedAt,
  nextMarkerTimestamp,
  resolvePhotoLocalities,
  UNRESOLVED_HOLD_MS,
} from "./scanPipeline";
import type { LocalityInfo, LocalityResolver, TimedPhotoRecord } from "./types";

const LONDON: LocalityInfo = {
  key: "gb:london" as LocalityInfo["key"],
  name: "London",
  region: "England",
  country: "United Kingdom",
  level: "locality",
};

function photo(id: string, over: Partial<TimedPhotoRecord> = {}): TimedPhotoRecord {
  return {
    mediaId: id,
    uri: `file:///${id}.jpg`,
    captureTimestamp: 1_752_487_200,
    tzOffset: null,
    latitude: 51.5074,
    longitude: -0.1278,
    cameraMake: null,
    cameraModel: null,
    localDay: "2025-07-14",
    timingRule: "gps-inferred",
    ...over,
  };
}

/** A geocoder that throws for the first `failures` calls, then answers. */
function flaky(failures: number, answer: LocalityInfo | null = LONDON) {
  let calls = 0;
  const inner: LocalityResolver = {
    resolve: async () => {
      calls++;
      if (calls <= failures) throw new Error("offline");
      return answer;
    },
  };
  return { inner, calls: () => calls };
}

function makeResolver(inner: LocalityResolver) {
  return new ResolvingLocalityResolver(inner, new InMemoryLocalityCache());
}

describe("ResolvingLocalityResolver offline behaviour", () => {
  it("makes one failed call per place, not one per photo", async () => {
    const g = flaky(Infinity);
    const resolver = makeResolver(g.inner);

    for (const day of ["2025-07-14", "2025-07-14", "2025-07-15"]) {
      expect(await resolver.resolve(51.5074, -0.1278, day)).toBeNull();
    }

    expect(g.calls()).toBe(1);
    expect(resolver.pendingCount).toBe(1);
  });

  it("clears the failure memory after a successful retry", async () => {
    const g = flaky(1);
    const resolver = makeResolver(g.inner);

    await resolver.resolve(51.5074, -0.1278, "2025-07-14");
    expect(resolver.hasPending(51.5074, -0.1278)).toBe(true);
    expect(resolver.peek(51.5074, -0.1278)).toBeUndefined();

    expect(await resolver.retryPending()).toBe(1);
    expect(resolver.hasPending(51.5074, -0.1278)).toBe(false);
    expect(resolver.peek(51.5074, -0.1278)?.key).toBe("gb:london");
  });

  it("keeps a place pending when the retry also fails", async () => {
    const resolver = makeResolver(flaky(Infinity).inner);
    await resolver.resolve(51.5074, -0.1278, "2025-07-14");
    await resolver.retryPending();
    expect(resolver.hasPending(51.5074, -0.1278)).toBe(true);
    expect(resolver.pendingCount).toBe(1);
  });
});

describe("resolvePhotoLocalities", () => {
  it("moves photos whose first lookup failed into located once the retry works", async () => {
    const resolver = makeResolver(flaky(1).inner);
    const photos = [photo("a"), photo("b"), photo("c")];

    const out = await resolvePhotoLocalities(photos, resolver);

    expect(out!.located.map((p) => p.mediaId).sort()).toEqual(["a", "b", "c"]);
    expect(out!.unlocated).toHaveLength(0);
    expect(out!.unresolved).toHaveLength(0);
  });

  it("reports photos still waiting after a failed retry, and keeps them as evidence", async () => {
    const resolver = makeResolver(flaky(Infinity).inner);

    const out = await resolvePhotoLocalities([photo("a"), photo("b")], resolver);

    expect(out!.located).toHaveLength(0);
    expect(out!.unresolved.map((p) => p.mediaId)).toEqual(["a", "b"]);
    expect(out!.unlocated.map((p) => p.mediaId)).toEqual(["a", "b"]);
  });

  it("does not hold back photos the geocoder simply has no answer for", async () => {
    const resolver = makeResolver(flaky(0, null).inner);

    const out = await resolvePhotoLocalities([photo("ocean")], resolver);

    expect(out!.unresolved).toHaveLength(0);
    expect(out!.unlocated).toHaveLength(1);
  });

  it("puts photos without GPS straight into unlocated", async () => {
    const g = flaky(0);
    const resolver = makeResolver(g.inner);

    const out = await resolvePhotoLocalities(
      [photo("nogps", { latitude: null, longitude: null })],
      resolver,
    );

    expect(g.calls()).toBe(0);
    expect(out!.unlocated).toHaveLength(1);
    expect(out!.unresolved).toHaveLength(0);
  });

  it("returns null when cancelled", async () => {
    const resolver = makeResolver(flaky(0).inner);
    const out = await resolvePhotoLocalities([photo("a")], resolver, { shouldCancel: () => true });
    expect(out).toBeNull();
  });

  it("reports pending counts through onProgress", async () => {
    const resolver = makeResolver(flaky(Infinity).inner);
    const seen: number[] = [];
    await resolvePhotoLocalities([photo("a")], resolver, { onProgress: (n) => seen.push(n) });
    expect(seen[0]).toBe(1);
  });
});

describe("nextMarkerTimestamp", () => {
  const T0 = Date.UTC(2025, 6, 20, 12, 0, 0);
  const prev = new Date(Date.UTC(2025, 6, 10)).toISOString();

  it("starts from when the scan began, so photos added mid-scan are not skipped", () => {
    expect(nextMarkerTimestamp({ previous: prev, scanStartedAt: T0 })).toBe(
      new Date(T0).toISOString(),
    );
  });

  it("stops at the newest photo processed when the cap was hit", () => {
    const newest = Date.UTC(2025, 6, 12);
    const out = nextMarkerTimestamp({
      previous: prev,
      scanStartedAt: T0,
      capped: true,
      newestProcessedAt: newest,
    });
    expect(out).toBe(new Date(newest - 1).toISOString());
  });

  it("does not move the marker when capped and the stop point is unknown", () => {
    expect(nextMarkerTimestamp({ previous: prev, scanStartedAt: T0, capped: true })).toBe(prev);
  });

  it("stays just behind a photo whose lookup failed", () => {
    const failed = Date.UTC(2025, 6, 15);
    const out = nextMarkerTimestamp({
      previous: prev,
      scanStartedAt: T0,
      unresolvedCreatedAt: [Date.UTC(2025, 6, 18), failed],
    });
    expect(out).toBe(new Date(failed - 1).toISOString());
  });

  it("gives up on a failed photo after the hold period", () => {
    const old = T0 - UNRESOLVED_HOLD_MS - 1;
    const out = nextMarkerTimestamp({
      previous: null,
      scanStartedAt: T0,
      unresolvedCreatedAt: [old],
    });
    expect(out).toBe(new Date(T0).toISOString());
  });

  it("never moves earlier than the previous marker on an incremental scan", () => {
    const early = Date.UTC(2025, 6, 9);
    const out = nextMarkerTimestamp({
      previous: prev,
      scanStartedAt: T0,
      unresolvedCreatedAt: [early],
    });
    expect(out).toBe(prev);
  });

  it("a manual scan with no previous marker can hold the marker back", () => {
    const failed = Date.UTC(2025, 6, 5);
    const out = nextMarkerTimestamp({
      previous: null,
      scanStartedAt: T0,
      unresolvedCreatedAt: [failed],
    });
    expect(out).toBe(new Date(failed - 1).toISOString());
  });
});

describe("creation time helpers", () => {
  it("ignore photos that report no creation time", () => {
    const photos = [{ createdAt: 5 }, {}, { createdAt: 9 }];
    expect(newestCreatedAt(photos)).toBe(9);
    expect(createdAtList(photos)).toEqual([5, 9]);
    expect(newestCreatedAt([{}])).toBeUndefined();
  });
});
