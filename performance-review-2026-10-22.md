# Performance Review — Chronicle Mobile (2026-10-22)

Review of `mobile/` tab screens, root layout, artwork/image pipeline, storage layer, and background enrichment.  
Branch: `fix/code-review-cleanup` (all quality fixes from yesterday already merged).

---

## Feed Screen (`mobile/app/(tabs)/index.tsx`)

### 1. `renderItem` is not memoised — new function reference every render

**Location:** `ChronicleScreen`, FlatList `renderItem` prop (line ~680)

**Issue:** `renderItem` is an inline arrow function inside JSX. React Native's FlatList compares the `renderItem` reference: a new reference on every render causes the list to consider its item tree dirty and skip the `shouldComponentUpdate` optimisation on individual cells, adding avoidable reconciliation work.

**Fix:** Extract to `useCallback` (or extract as a named function above the component). Because `DayGroup` and `MonthHeader` are already receiving all data as props (no implicit closure state needed), this is a clean extraction:

```ts
const renderFeedItem = useCallback(({ item }: { item: FeedItem }) => {
  if (item.type === "month") return <MonthHeader ... />;
  return <DayGroup ... />;
}, [colors, fonts, router, handleEntryLongPress]);
```

**Impact:** Medium — avoids unnecessary reconciliation on every state change (filter toggle, search keystroke) for a potentially large list.

---

### 2. `allEntries(journal)` called twice outside `feedItems` useMemo

**Location:** Lines ~487–488 in render path:
```ts
const hasAnyData = allEntries(journal).length > 0;
const hasFilteredData = feedItems.some((i) => i.type === "day");
```

**Issue:** `allEntries()` iterates and concatenates all store arrays. It is called once already inside the `feedItems` useMemo (stable via the same `journal` dependency), but then called again on the naked render path for the empty-state check. The second call happens every render even when the first result is cached.

**Fix:** Hoist `hasAnyData` inside the `feedItems` memo or derive it from `feedItems` length (which is already computed):
```ts
// inside feedItems useMemo, add to the return:
return { items, hasAnyData: entries.length > 0 };
// or separate memo:
const hasAnyData = useMemo(() => allEntries(journal).length > 0, [journal]);
```
Since `feedItems` already has `[journal]` as a dependency the latter is free.

**Impact:** Low–Medium — each extra `allEntries()` call iterates N entries; on a large journal this adds up when the component re-renders (e.g. on every keypress in the search field).

---

### 3. `tripOf` runs `.find()` per day inside `feedItems` memo

**Location:** Lines ~381–382 inside `feedItems` useMemo:
```ts
const tripOf = (d: string) =>
  journal.trips.find((t) => d >= t.start && d <= t.end);
```

**Issue:** Called once per unique calendar day in the filtered result set. With a large journal (e.g. 5 years × 365 days) and many trips, this is O(days × trips). The trips array is small in practice, so the impact today is low — but it degrades linearly with trip count.

**Fix:** Build a day→trip Map once at the top of the memo rather than using `.find()` on every day. Given that trips span date ranges rather than discrete days, the cleanest approach is to pre-sort trips and binary-search, or build a lookup after the `sortedDays` list is already known:
```ts
const tripMap = new Map<string, string | undefined>();
for (const iso of sortedDays) {
  tripMap.set(iso, journal.trips.find((t) => iso >= t.start && iso <= t.end)?.title);
}
```
This keeps the same total work but makes the intent explicit and avoids repeated allocations of the closure.

**Impact:** Low (trips count is small), but worth tidying.

---

## Culture Tab (`mobile/app/(tabs)/culture.tsx`)

### 4. `PosterGrid` resolves all artwork via `Promise.all` on every mount

**Location:** `PosterGrid` component, `useEffect` lines ~418–465

**Issue:** Every time `PosterGrid` mounts or its `items` / `refreshKey` prop changes, it fires `Promise.all(items.map(...))` — one concurrent DB lookup per poster tile. With all-four-sections visible (film + TV + book + concert), this is 4 PosterGrid instances × N tiles each, all racing to hit the SQLite artwork store simultaneously on first mount.

The call sequence is: `resolveArtwork(key)` → `artworkStorage().getByKey(key)` → SQLite. Each `getByKey` goes through the serial queue in `SQLiteArtworkStore`, so the concurrent `Promise.all` turns into a serialised queue of N reads anyway — but they all enqueue on mount, producing a large burst of serial SQLite reads that can block the first interactive frame.

**Fix:** Two changes:
1. Replace `Promise.all` with the same concurrency-limited worker pattern that `enrichAll` uses (`ENRICH_CONCURRENCY = 3` concurrent slots). This limits the queue burst without losing parallelism:
```ts
const results: [string, string | null][] = [];
let i = 0;
async function worker() {
  while (i < items.length) {
    const item = items[i++];
    const uri = await resolveItemUri(item, kind, filmProvider, bookProvider);
    results.push([item.id, uri]);
  }
}
await Promise.all(Array.from({ length: Math.min(3, items.length) }, worker));
```
2. The `artworkStorage().getByKey()` path already deduplicates at the SQLite level, but consider reading all relevant keys in a single `WHERE id IN (...)` query via a `getByKeys(keys: string[])` method on `ArtworkStorage`. That reduces N serial reads to 1 batch read per PosterGrid mount.

**Impact:** High — directly affects first-paint time for the Culture tab on cold launch.

---

### 5. `ArtistImage` runs a per-component resolve effect

**Location:** `ArtistImage` component, `useEffect` lines ~547–558

**Issue:** Each collapsed concert group header renders an `ArtistImage` component that fires its own `resolveArtistImage(artistName)` effect on mount. The Culture tab may have 20+ collapsed concert groups visible simultaneously, firing 20+ sequential SQLite reads (via the serial queue) plus potential network lookups.

**Fix:** Batch artist image resolution at the parent level, the same way `PosterGrid` batches film/TV poster resolution. Build a `uriMap` for all visible artists in the screen component and pass the resolved URI down to `ArtistImage` as a prop, removing the per-component effect entirely.

**Impact:** Medium — each mount fires a DB read; many headers visible at once serialises them.

---

### 6. `listItems` useMemo rebuilds on `expandedKeys` change

**Location:** `CultureScreen`, `listItems` useMemo, line ~880 dependency array:
```ts
}, [filter, allConcerts, concertGridItems, filmGridItems, tvGridItems, bookGridItems, journal.books, journal.films, journal.episodes]);
```

**Issue:** `expandedKeys` is correctly **not** in the dependency array — the memo reads `expandedKeys.has(key)` inside, but since `expandedKeys` is a `Set` the reference stays stable (it is replaced by a new `Set` on each `toggleSeries` call). However, `setExpandedKeys` returns a new Set, which does change the reference, which re-runs the memo. This means toggling a series triggers a full `listItems` rebuild (O(all entries)) just to flip one `collapsed` flag.

**Fix:** The simplest fix is to move the `collapsed` state out of `listItems` and into the rendered `groupHeader` item itself. Pass `expandedKeys` directly to the render function rather than baking it into the data array. The groupHeader items can be stable, and the collapsed/expanded state resolved at render time:

```ts
// listItems generates stable groupHeader items with no collapsed field
// renderItem resolves it: collapsed={!expandedKeys.has(item.seriesKey)}
```

This is a more significant refactor but eliminates the rebuild. A simpler fix is to `useRef` the `expandedKeys` and only bump a numeric `expandVersion` counter in `listItems`' deps — but the render-time resolution is cleaner.

**Impact:** Medium — on a large culture library with many series groups, the rebuild is O(entries). Every expand/collapse toggle triggers it today.

---

### 7. `LayoutAnimation.configureNext` on every toggle

**Location:** `toggleSeries` callback, line ~628:
```ts
LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
```

**Issue:** `LayoutAnimation` animates the entire layout tree, including elements that aren't changing. On Android this requires setting `UIManager.setLayoutAnimationEnabledExperimental(true)`. More importantly, it fires on every tap, including rapid repeated taps, queueing multiple layout animations. This can cause jank or stuttering on lower-end Android devices.

**Fix:** Use `Animated` + conditional `maxHeight` on the group body, or switch to `react-native-reanimated`'s `useAnimatedStyle` with a shared value for the expanded state. Both scope the animation to only the affected group, leaving the rest of the list unaffected.

**Impact:** Low on iOS (LayoutAnimation is well-optimised), Medium on Android.

---

## Trips Tab (`mobile/app/(tabs)/trips.tsx`)

### 8. O(trips × entries) `suggested` count computed inline per trip

**Location:** `trips` useMemo, line ~326–329:
```ts
const suggested = entries.filter(
  (e) => !e.tripId && e.start.slice(0, 10) >= t.start && e.start.slice(0, 10) <= t.end
).length;
```

**Issue:** For each trip, `entries.filter(...)` scans all entries. With T trips and E entries this is O(T × E). Today, trips and entries are few enough that this is fast; but it degrades quadratically if both grow.

**Fix:** Pre-bucket the untripped entries by date into a sorted array once, then binary-search for each trip's range:
```ts
const untripped = entries
  .filter((e) => !e.tripId)
  .map((e) => e.start.slice(0, 10))
  .sort();
// per trip: use bisect(untripped, t.start) .. bisect(untripped, t.end)
```

**Impact:** Low currently (trips and entries are small), but a clean fix.

---

## Root Layout / Boot (`mobile/app/_layout.tsx`)

### 9. `enrichAll()` fires on every boot with no staleness check

**Location:** `RootLayoutInner`, boot effect, line ~163:
```ts
enrichAll(allEntries(getState())).catch(...);
```

**Issue:** `enrichAll` iterates all entries, checks each artwork key against the SQLite cache (`getByKey` per key), and only skips already-resolved keys. On a journal with 2,000 film/TV/book entries, this is ~2,000 sequential SQLite reads on every cold launch before it can determine that everything is already cached and nothing needs fetching. These reads are serialised through the SQLiteArtworkStore queue, so they don't block the main thread but they do compete with the PosterGrid mounts that fire shortly after.

**Fix:** Add a "last enriched" timestamp stored in AsyncStorage or a dedicated SQLite row. Only run `enrichAll` if:
- More than N hours have passed since the last run, **or**
- A new import has just completed (pass the new entries subset instead of all entries).

On app boot without a recent import, `enrichAll` can be skipped entirely since the per-entry `resolveArtwork` calls in `PosterCard` will handle any stragglers on demand.

```ts
const lastEnriched = await AsyncStorage.getItem("lastEnrichedAt");
const stale = !lastEnriched || Date.now() - new Date(lastEnriched).getTime() > 6 * 3600_000;
if (stale || hasNewImport) {
  enrichAll(entriesToEnrich).then(() =>
    AsyncStorage.setItem("lastEnrichedAt", new Date().toISOString())
  ).catch(...);
}
```

**Impact:** High — eliminates hundreds of serial SQLite reads on every app launch once the cache is warm.

---

## Artwork / Image Resolution

### 10. No `ArtworkStorage.getByKeys()` batch read method

**Location:** `src/lib/journal/artwork.ts` (interface) + `mobile/src/lib/storage/SQLiteArtworkStore.ts`

**Issue:** Every `resolveArtwork`, `resolveBookCoverForEntry`, and `resolveArtistImage` call issues a `getByKey(key)` — one SQL `SELECT … WHERE id = ?` per item. In batch contexts (PosterGrid mounting, enrichAll filtering), this means N serial reads on the queue. SQLite's `WHERE id IN (list)` can return all matching rows in a single round-trip.

**Fix:** Add `getByKeys(keys: string[]): Promise<Map<string, ArtworkMatch>>` to the `ArtworkStorage` interface and implement it in `SQLiteArtworkStore`. Use it in `enrichAll` for the initial cache-check pass and in `PosterGrid`'s resolution effect:
```ts
async getByKeys(keys: string[]): Promise<Map<string, ArtworkMatch>> {
  if (!keys.length) return new Map();
  const placeholders = keys.map(() => "?").join(", ");
  const rows = await this.db.getAllAsync<{ data: string }>(
    `SELECT data FROM artwork_match WHERE id IN (${placeholders})`,
    keys,
  );
  return new Map(rows.map((r) => {
    const m = JSON.parse(r.data) as ArtworkMatch;
    return [m.id, m];
  }));
}
```

**Impact:** High — replaces N serial reads with 1 batch read in every call site that processes multiple artwork keys.

---

## Storage Layer

The `SQLiteAdapter` is already well-optimised from yesterday's review: prepared statements in `putMany`/`replaceAll`, bulk `DELETE … WHERE id IN (...)` in `removeMany`, WAL mode enabled. No further issues found.

`SQLiteArtworkStore` follows the same patterns correctly. The serial queue is necessary to avoid "database is locked" from concurrent callers. The only gap is the missing `getByKeys` batch read described above.

---

## Connected Sources / Background Checks

`connectedSources.ts` is clean: single-flight guard prevents re-entrant runs, 6-hour per-source throttle limits I/O, `InteractionManager.runAfterInteractions` ensures it never runs before the first frame. No performance concerns.

---

## Import Screen (`mobile/app/import.tsx`)

The import screen is a thin wrapper over `importFile()`. No performance concerns — it is only displayed when a file is being processed, which is user-initiated.

---

## Top Priorities

These are the highest-impact changes, roughly ordered:

**1. Add `ArtworkStorage.getByKeys()` batch read** — `src/lib/journal/artwork.ts` + `SQLiteArtworkStore.ts`  
Replaces N serial SQLite reads with 1 `IN(...)` query in every call site that processes multiple artwork keys (enrichAll filter pass, PosterGrid mounts). Single most impactful storage change.

**2. Skip `enrichAll` on warm-cache boot** — `_layout.tsx`  
Add a `lastEnrichedAt` timestamp check. Once the cache is warm (typical after first launch + import), `enrichAll` on cold boot costs ~thousands of serial SQLite reads for zero network output. A 6-hour staleness gate eliminates all of that.

**3. Limit `PosterGrid` `Promise.all` burst with a concurrency cap** — `culture.tsx`  
Replace the unbounded `Promise.all` with a 3-worker pattern (matching `enrichAll`). Prevents the 4-grid × N-tile burst on Culture tab first mount from saturating the SQLite artwork queue.

**4. Batch `ArtistImage` resolution at the screen level** — `culture.tsx`  
Move `resolveArtistImage` out of per-`ArtistImage` component effects and into a single pass at the `CultureScreen` level, passing resolved URIs as props. Removes N mount-time SQLite reads when many concert groups are visible.

**5. Memoise `renderItem` in the Feed FlatList** — `index.tsx`  
Wrap in `useCallback`. Prevents the list from re-reconciling all visible cells on every filter/search keypress.

**6. Decouple `listItems` rebuild from `expandedKeys` in Culture** — `culture.tsx`  
Move collapsed/expanded resolution from the memo into `renderItem`, so toggling a series no longer triggers a full O(entries) list rebuild.
