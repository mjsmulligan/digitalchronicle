import { describe, it, expect } from "vitest";
import { buildAssetFilter, pageAcrossAlbums, type AssetPage } from "./assetFilter";

describe("buildAssetFilter", () => {
  it("all reads the whole library with no date limits", () => {
    expect(buildAssetFilter({ kind: "all" })).toEqual({ albumIds: null });
  });

  it("albums keeps the selected ids and removes duplicates", () => {
    expect(buildAssetFilter({ kind: "albums", albumIds: ["a", "b", "a"] }))
      .toEqual({ albumIds: ["a", "b"] });
  });

  it("an albums scope with no albums selected reads nothing, not everything", () => {
    expect(buildAssetFilter({ kind: "albums", albumIds: [] }).albumIds).toEqual([]);
  });

  it("date-range includes the whole last day", () => {
    const f = buildAssetFilter({ kind: "date-range", start: "2025-07-01", end: "2025-07-31" });
    expect(f.createdAfter).toBe(Date.UTC(2025, 6, 1));
    expect(f.createdBefore).toBe(Date.UTC(2025, 7, 1)); // first instant of 1 Aug, exclusive
    expect(f.albumIds).toBeNull();
  });

  it("since without a base covers the whole library after the timestamp", () => {
    const f = buildAssetFilter({ kind: "since", timestamp: "2025-07-10T00:00:00.000Z" });
    expect(f).toEqual({ createdAfter: Date.UTC(2025, 6, 10), albumIds: null });
  });

  it("since keeps the albums of its base scope", () => {
    const f = buildAssetFilter({
      kind: "since",
      timestamp: "2025-07-10T00:00:00.000Z",
      base: { kind: "albums", albumIds: ["a"] },
    });
    expect(f.albumIds).toEqual(["a"]);
    expect(f.createdAfter).toBe(Date.UTC(2025, 6, 10));
  });

  it("since inside a date range uses the later start and keeps the end", () => {
    const base = { kind: "date-range" as const, start: "2025-07-01", end: "2025-07-31" };
    const later = buildAssetFilter({ kind: "since", timestamp: "2025-07-10T00:00:00.000Z", base });
    expect(later.createdAfter).toBe(Date.UTC(2025, 6, 10));
    expect(later.createdBefore).toBe(Date.UTC(2025, 7, 1));

    const earlier = buildAssetFilter({ kind: "since", timestamp: "2025-06-01T00:00:00.000Z", base });
    expect(earlier.createdAfter).toBe(Date.UTC(2025, 6, 1));
  });

  it("an unreadable since timestamp reads nothing rather than dropping the limit", () => {
    const f = buildAssetFilter({ kind: "since", timestamp: "not a date" });
    expect(f.albumIds).toEqual([]);
  });
});

type Asset = { id: string };

/** A fetcher over fixed pages per album. Album undefined is the whole library. */
function fakeLibrary(data: Record<string, string[][]>) {
  const calls: Array<{ album: string | undefined; after: string | undefined }> = [];
  const fetchPage = async (album: string | undefined, after: string | undefined): Promise<AssetPage<Asset>> => {
    calls.push({ album, after });
    const pages = data[album ?? "*"] ?? [];
    const idx = after ? Number(after) : 0;
    const page = pages[idx] ?? [];
    return {
      assets: page.map((id) => ({ id })),
      endCursor: String(idx + 1),
      hasNextPage: idx + 1 < pages.length,
    };
  };
  return { fetchPage, calls };
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of gen) out.push(v);
  return out;
}

describe("pageAcrossAlbums", () => {
  it("reads every selected album, not only the first", async () => {
    const lib = fakeLibrary({ A: [["a1", "a2"]], B: [["b1"]], C: [["c1"]] });
    const pages = await collect(pageAcrossAlbums(["A", "B", "C"], lib.fetchPage));
    expect(pages.flatMap((p) => p.assets.map((a) => a.id))).toEqual(["a1", "a2", "b1", "c1"]);
    expect(pages.map((p) => p.albumIndex)).toEqual([0, 1, 2]);
  });

  it("follows pages within an album", async () => {
    const lib = fakeLibrary({ A: [["a1"], ["a2"], ["a3"]] });
    const pages = await collect(pageAcrossAlbums(["A"], lib.fetchPage));
    expect(pages.flatMap((p) => p.assets.map((a) => a.id))).toEqual(["a1", "a2", "a3"]);
  });

  it("yields a photo that sits in two albums once", async () => {
    const lib = fakeLibrary({ A: [["x", "a1"]], B: [["x", "b1"]] });
    const pages = await collect(pageAcrossAlbums(["A", "B"], lib.fetchPage));
    expect(pages.flatMap((p) => p.assets.map((a) => a.id))).toEqual(["x", "a1", "b1"]);
  });

  it("an empty album list reads nothing and never queries the library", async () => {
    const lib = fakeLibrary({ "*": [["everything"]] });
    const pages = await collect(pageAcrossAlbums([], lib.fetchPage));
    expect(pages).toEqual([]);
    expect(lib.calls).toEqual([]);
  });

  it("null reads the whole library", async () => {
    const lib = fakeLibrary({ "*": [["p1", "p2"]] });
    const pages = await collect(pageAcrossAlbums<Asset, string>(null, lib.fetchPage));
    expect(pages.flatMap((p) => p.assets.map((a) => a.id))).toEqual(["p1", "p2"]);
    expect(lib.calls[0].album).toBeUndefined();
  });

  it("resumes at the stored album and cursor", async () => {
    const lib = fakeLibrary({ A: [["a1"]], B: [["b1"], ["b2"], ["b3"]] });
    const pages = await collect(
      pageAcrossAlbums(["A", "B"], lib.fetchPage, { albumIndex: 1, after: "1" }),
    );
    expect(pages.flatMap((p) => p.assets.map((a) => a.id))).toEqual(["b2", "b3"]);
    expect(lib.calls.some((c) => c.album === "A")).toBe(false);
  });
});
