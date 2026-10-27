/**
 * Scan scope to asset query (pure).
 *
 * Turns a ScanScope into the filters the media library query needs, and pages across
 * several albums. Kept free of expo-media-library so the scope rules can be tested.
 *
 * Spec §5: "No photo outside the chosen scope is ever read." Every rule here fails
 * closed: a scope that cannot be resolved reads nothing, never the whole library.
 */

import type { BaseScanScope, ScanScope } from "./types";

export interface AssetFilter {
  /** Only assets created after this time (ms since epoch). */
  createdAfter?: number;
  /** Only assets created before this time (ms since epoch). */
  createdBefore?: number;
  /**
   * Album ids to read. `null` means the whole library. An empty array means the
   * scope selected albums but none were chosen, so nothing may be read.
   */
  albumIds: string[] | null;
}

const DAY_MS = 86_400_000;

/** Start of a YYYY-MM-DD day, in UTC. NaN-safe: an unparseable date returns undefined. */
function dayStart(day: string): number | undefined {
  const t = Date.parse(`${day}T00:00:00Z`);
  return Number.isNaN(t) ? undefined : t;
}

/** The first instant after a YYYY-MM-DD day, in UTC, so the whole end day is included. */
function dayEndExclusive(day: string): number | undefined {
  const t = dayStart(day);
  return t === undefined ? undefined : t + DAY_MS;
}

function baseFilter(scope: BaseScanScope): AssetFilter {
  switch (scope.kind) {
    case "all":
      return { albumIds: null };
    case "albums":
      return { albumIds: [...new Set(scope.albumIds)] };
    case "date-range":
      return {
        createdAfter: dayStart(scope.start),
        createdBefore: dayEndExclusive(scope.end),
        albumIds: null,
      };
  }
}

/**
 * Build the asset filter for a scope.
 *
 * A "since" scope applies its base scope as well as the timestamp, so an incremental
 * check stays inside the albums or date range the user picked. A bad timestamp
 * returns an empty album list (read nothing) rather than dropping the limit.
 */
export function buildAssetFilter(scope: ScanScope): AssetFilter {
  if (scope.kind !== "since") return baseFilter(scope);

  const filter = baseFilter(scope.base ?? { kind: "all" });
  const since = Date.parse(scope.timestamp);
  if (Number.isNaN(since)) return { ...filter, albumIds: [] };

  filter.createdAfter = Math.max(filter.createdAfter ?? -Infinity, since);
  return filter;
}

// ─── Paging across albums ─────────────────────────────────────────────────────

export interface AssetPage<T> {
  assets: T[];
  endCursor?: string;
  hasNextPage: boolean;
}

export interface AlbumPageResult<T> {
  assets: T[];
  /** Index into the album list this page came from (0 when reading the whole library). */
  albumIndex: number;
  /** Cursor to pass back to resume after this page. */
  endCursor?: string;
}

/**
 * Page through every album in turn, or through the whole library when `albums` is null.
 *
 * - An empty album list yields nothing. It does not fall back to the whole library.
 * - A photo that sits in several albums is yielded once.
 * - `resume` restarts at an album and cursor from an earlier, interrupted scan.
 */
export async function* pageAcrossAlbums<T extends { id: string }, A>(
  albums: A[] | null,
  fetchPage: (album: A | undefined, after: string | undefined) => Promise<AssetPage<T>>,
  resume?: { albumIndex?: number; after?: string },
): AsyncGenerator<AlbumPageResult<T>> {
  const sources: Array<A | undefined> = albums === null ? [undefined] : albums;
  const seen = new Set<string>();

  for (let i = resume?.albumIndex ?? 0; i < sources.length; i++) {
    let after = i === (resume?.albumIndex ?? 0) ? resume?.after : undefined;

    while (true) {
      const page = await fetchPage(sources[i], after);
      if (!page.assets.length) break;

      const fresh = page.assets.filter((a) => !seen.has(a.id));
      for (const a of fresh) seen.add(a.id);

      yield { assets: fresh, albumIndex: i, endCursor: page.endCursor };

      if (!page.hasNextPage) break;
      after = page.endCursor;
    }
  }
}
