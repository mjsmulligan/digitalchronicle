/**
 * Culture tab — films, TV episodes, books, and concerts.
 *
 * Matches the web layout: separate sections per category with series grouping.
 *   · Concerts — grouped by year
 *   · Films    — grouped by title series (text before ":"), standalone otherwise
 *   · TV       — grouped by Series container (seriesId → journal.series), fallback to showTitle
 *   · Books    — grouped by series field, standalone interleaved by date
 *
 * Series/show groups are collapsible (collapsed by default) for easy scanning.
 * Filter pills narrow to a single category; all sections show when "All" is active.
 */
import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import {
  Animated,
  FlatList,
  Image,
  LayoutAnimation,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useJournal } from "@chronicle/journal/db";
import {
  view,
  entryTitle,
  type Film,
  type Episode,
  type Book,
  type JEvent,
  type Series,
} from "@chronicle/journal/types";
import { eventToArtworkKey, bookToArtworkKey, artistToArtworkKey } from "@chronicle/journal/artwork";
import {
  useTheme,
  type ThemeColors,
  type ThemeFonts,
  text as textScale,
  spacing as spacingScale,
  radius as radiusScale,
} from "../../src/components/ThemeProvider";
import { KindIcon, StarRating } from "../../src/components/KindIcon";
import { EntryRow } from "../../src/components/EntryRow";
import { PosterCard } from "../../src/components/PosterCard";
import { resolveArtwork, resolveBookCoverForEntry, resolveArtistImage } from "@chronicle/journal/artworkEnrichment";
import { getArtworkProvider } from "@chronicle/journal/artworkProvider";
import { getBookCoverProvider } from "@chronicle/journal/bookCoverProvider";
import { getArtistImageProvider } from "@chronicle/journal/artistImageProvider";


// ── types & helpers ───────────────────────────────────────────────────────────

type CultureKind = "film" | "episode" | "book" | "concert";
type Filter = "all" | CultureKind;

type CultureEntry = Film | Episode | Book | JEvent;

function sortDate(e: CultureEntry): string {
  return (e.overrides?.start ?? e.start) || "0000";
}

function avgRating(entries: CultureEntry[]): number | null {
  const rated = entries.filter((e) => e.rating !== undefined);
  if (!rated.length) return null;
  return rated.reduce((sum, e) => sum + e.rating!, 0) / rated.length;
}

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all",     label: "All" },
  { id: "film",    label: "Films" },
  { id: "episode", label: "TV" },
  { id: "book",    label: "Books" },
  { id: "concert", label: "Concerts" },
];

// ── grouping helpers ──────────────────────────────────────────────────────────

// ── Films ─────────────────────────────────────────────────────────────────────

interface FilmSeriesGroup {
  name: string;
  films: Film[];
}

function groupFilmsBySeries(films: Film[]): { standalone: Film[]; series: FilmSeriesGroup[] } {
  const seriesMap = new Map<string, Film[]>();
  const standalone: Film[] = [];
  for (const f of films) {
    const colonIdx = f.title.indexOf(":");
    if (colonIdx > 0) {
      const name = f.title.slice(0, colonIdx).trim();
      const arr = seriesMap.get(name) ?? [];
      arr.push(f);
      seriesMap.set(name, arr);
    } else {
      standalone.push(f);
    }
  }
  const series: FilmSeriesGroup[] = [];
  for (const [name, fs] of seriesMap.entries()) {
    if (fs.length === 1) {
      standalone.push(fs[0]);
    } else {
      series.push({
        name,
        films: [...fs].sort((a, b) => sortDate(b).localeCompare(sortDate(a))),
      });
    }
  }
  series.sort((a, b) => sortDate(b.films[0]).localeCompare(sortDate(a.films[0])));
  return { standalone, series };
}

// ── TV / Episodes ─────────────────────────────────────────────────────────────

interface ShowGroup {
  title: string;
  episodes: Episode[];
  latestDate: string;
}

function groupEpisodesBySeries(episodes: Episode[], seriesContainers: Series[]): ShowGroup[] {
  const seriesById = new Map<string, Series>(seriesContainers.map((s) => [s.id, s]));
  const map = new Map<string, Episode[]>();
  for (const ep of episodes) {
    const key = ep.seriesId
      ? (seriesById.get(ep.seriesId)?.title ?? ep.showTitle)
      : ep.showTitle;
    const arr = map.get(key) ?? [];
    arr.push(ep);
    map.set(key, arr);
  }
  return [...map.entries()]
    .map(([title, eps]) => {
      const sorted = [...eps].sort((a, b) => sortDate(b).localeCompare(sortDate(a)));
      return { title, episodes: sorted, latestDate: sortDate(sorted[0]) };
    })
    .sort((a, b) => b.latestDate.localeCompare(a.latestDate));
}

// ── poster grid types ─────────────────────────────────────────────────────────

/** One tile in the poster grid — a film, film series, TV show, or book. */
interface PosterGridItem {
  id: string;
  title: string;
  /** Artwork cache key — empty string when key cannot be derived */
  artworkKey: string;
  /** Entry to navigate to when tapped (latest entry for series/show) */
  entryId: string;
  /**
   * Full Book entry for book grid tiles.
   * resolveBookCoverForEntry needs author + isbn13 which aren't in artworkKey.
   */
  bookEntry?: Book;
}

// ── flat list item types ─────────────────────────────────────────────────────

type ListItem =
  | { type: "sectionHeader"; id: string; title: string }
  | {
      type: "groupHeader";
      id: string;
      title: string;
      subtitle: string;
      avg?: number | null;
      /** When true, this group can be tapped to expand/collapse */
      collapsible: boolean;
      collapsed: boolean;
      /** Key passed to toggleSeries — only present when collapsible: true */
      seriesKey?: string;
      /** Kind icon to show on the left — only present when collapsible: true */
      kind?: CultureKind;
      /** Artwork cache key for inline poster (book series groups only) */
      artworkKey?: string;
      /** Raw artist name for concert groups — used to resolve TheAudioDB image */
      artistName?: string;
    }
  | { type: "posterGrid"; id: string; items: PosterGridItem[]; kind: "film" | "episode" | "book" | "concert" }
  | { type: "entry";      id: string; entry: CultureEntry }
  | { type: "separator";  id: string }
  | { type: "sectionGap"; id: string }
  | { type: "groupGap";   id: string };

// ── styles factory ────────────────────────────────────────────────────────────

function createStyles(colors: ThemeColors, fonts: ThemeFonts) {
  return StyleSheet.create({
    container:   { flex: 1, backgroundColor: colors.bg },
    list:        { flex: 1 },
    listContent: { paddingBottom: spacingScale["3xl"] },

    // Filter pills
    pills:        { flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderFaint },
    pillsContent: { padding: spacingScale.md, gap: spacingScale.sm, flexDirection: "row" },
    pill: {
      paddingHorizontal: spacingScale.md2,
      paddingVertical: spacingScale.sm2,
      borderRadius: radiusScale.pill,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      flexDirection: "row",
      alignItems: "center",
      gap: spacingScale.xs,
    },
    pillActive:      { backgroundColor: colors.surfaceAccent, borderColor: colors.accent },
    pillText:        { ...textScale.smMd, color: colors.textSecondary, fontWeight: "600" },
    pillTextActive:  { color: colors.accentSubtle },
    pillCount:       { fontSize: 10, fontFamily: fonts.mono, color: colors.textTertiary },
    pillCountActive: { color: colors.accentSubtle, opacity: 0.75 },

    // Section header (Concerts · N, Films · N, TV · N episodes · M shows, Books · N)
    sectionHeader: {
      paddingHorizontal: spacingScale.base,
      paddingTop: spacingScale.xl,
      paddingBottom: spacingScale.sm,
    },
    sectionHeaderText: {
      fontSize: 10,
      fontFamily: fonts.mono,
      fontWeight: "700",
      letterSpacing: 1,
      textTransform: "uppercase",
      color: colors.textTertiary,
    },

    // Group header (series name / show title / year)
    groupHeader: {
      paddingHorizontal: spacingScale.base,
      paddingTop: spacingScale.md,
      paddingBottom: spacingScale.sm,
      flexDirection: "row",
      alignItems: "center",
      gap: spacingScale.sm,
    },
    // Collapsible group header — slightly more vertical padding for tap target
    groupHeaderCollapsible: {
      paddingVertical: spacingScale.md,
    },
    groupHeaderPressed: { opacity: 0.55 },
    // Icon placeholder matching EntryRow's markWrap
    groupHeaderMark: {
      width: 20,
      height: 20,
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
    },
    groupHeaderTitle:      { ...textScale.feedTitle, fontFamily: fonts.serifMedium, fontWeight: "500", color: colors.textPrimary, flex: 1 },
    groupHeaderTitleFixed: { flex: undefined },
    // Trailing: count label + chevron
    groupHeaderTrailing: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacingScale.xs,
      flexShrink: 0,
    },
    groupHeaderSubtitle: { fontSize: 10, fontFamily: fonts.mono, color: colors.textTertiary },

    // Entry row padding
    entryWrap: { paddingHorizontal: spacingScale.base },

    // Compact poster indent — matches entry/group content left edge
    posterWrap: { paddingHorizontal: spacingScale.base },

    // Hairline between consecutive entries
    separator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.borderFaint,
      marginHorizontal: spacingScale.base,
    },

    // Vertical rhythm
    sectionGap: { height: spacingScale["2xl"] },
    groupGap:   { height: spacingScale.md },

    // Empty state
    empty: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: spacingScale["2xl"],
    },
    emptyTitle: {
      fontSize: 18,
      fontFamily: fonts.serifSemiBold,
      fontWeight: "600",
      color: colors.textPrimary,
      marginTop: spacingScale.base,
      marginBottom: spacingScale.sm,
    },
    emptyHint: { ...textScale.md, color: colors.textTertiary, textAlign: "center" },
    ctaBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacingScale.sm2,
      marginTop: spacingScale.xl,
      paddingHorizontal: spacingScale.lg,
      paddingVertical: spacingScale.md,
      borderRadius: radiusScale.pill,
      backgroundColor: colors.accentBold,
    },
    ctaBtnText: { color: colors.white, fontSize: 15, fontWeight: "700" },
  });
}

type Styles = ReturnType<typeof createStyles>;

// ── PosterGrid ────────────────────────────────────────────────────────────────

const NUM_COLS = 3;

function createGridStyles(colors: ThemeColors, fonts: ThemeFonts, cellW: number, cellH: number) {
  return StyleSheet.create({
    gridContainer: {
      paddingHorizontal: spacingScale.base,
      paddingBottom: spacingScale.md,
    },
    grid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacingScale.sm,
    },
    cell:        { width: cellW },
    cellPressed: { opacity: 0.7 },
    posterBg: {
      width: cellW,
      height: cellH,
      borderRadius: radiusScale.md,
      backgroundColor: colors.border,
      overflow: "hidden",
      marginBottom: spacingScale.xs,
    },
    posterImg: { width: cellW, height: cellH },
    cellTitle: {
      ...textScale.xs,
      fontFamily: fonts.sans,
      color: colors.textSecondary,
      lineHeight: 16,
    },
    // No-artwork rows below the grid
    noArtSection: {
      marginTop: spacingScale.md,
      paddingTop: spacingScale.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.borderFaint,
    },
    noArtSep: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.borderFaint,
    },
    noArtRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacingScale.sm,
      paddingVertical: spacingScale.md,
    },
    noArtRowPressed: { opacity: 0.55 },
    noArtTitle: {
      ...textScale.feedTitle,
      fontFamily: fonts.serifMedium,
      fontWeight: "500" as const,
      color: colors.textSecondary,
      flex: 1,
    },
  });
}

/**
 * Resolves artwork for all items in parallel, then renders a 3-column poster
 * grid. Items whose poster could not be resolved are shown as plain rows below
 * the grid once resolution is complete.
 */
function PosterGrid({
  items,
  kind,
  colors,
  fonts,
  onPress,
}: {
  items: PosterGridItem[];
  kind: "film" | "episode" | "book" | "concert";
  colors: ThemeColors;
  fonts: ThemeFonts;
  onPress: (entryId: string) => void;
}) {
  const { width: screenW } = useWindowDimensions();
  const cellW = Math.floor(
    (screenW - 2 * spacingScale.base - (NUM_COLS - 1) * spacingScale.sm) / NUM_COLS,
  );
  // Artist tiles are square; all other media uses portrait (3:2) ratio
  const cellH = kind === "concert" ? cellW : Math.floor(cellW * 1.5);

  const [uriMap, setUriMap]     = useState<Map<string, string | null>>(new Map());
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const filmProvider = getArtworkProvider();
    const bookProvider = getBookCoverProvider();
    Promise.all(
      items.map(async (item) => {
        let uri: string | null = null;
        if (kind === "concert") {
          // Artist images — poster_path IS the full URL (TheAudioDB, no imageUrl() needed)
          const match = await resolveArtistImage(item.title);
          uri = match?.poster_path ?? null;
        } else if (item.bookEntry) {
          // Books: use resolveBookCoverForEntry + Open Library image URL
          const match = await resolveBookCoverForEntry(item.bookEntry);
          uri = match?.poster_path && bookProvider
            ? bookProvider.imageUrl(match.poster_path)
            : null;
        } else if (item.artworkKey) {
          // Films / TV: use resolveArtwork + TMDB image URL
          const match = await resolveArtwork(item.artworkKey);
          uri = match?.poster_path && filmProvider
            ? filmProvider.imageUrl(match.poster_path)
            : null;
        }
        return [item.id, uri] as const;
      }),
    ).then((results) => {
      if (cancelled) return;
      setUriMap(new Map(results));
      setResolved(true);
    });
    return () => { cancelled = true; };
  }, [items, kind]);

  // Before resolution: show all as shimmer. After: split poster / no-poster.
  const posterItems    = resolved ? items.filter((i) => uriMap.get(i.id))  : items;
  const noArtItems     = resolved ? items.filter((i) => !uriMap.get(i.id)) : [];

  const gs = useMemo(
    () => createGridStyles(colors, fonts, cellW, cellH),
    [colors, fonts, cellW, cellH],
  );

  return (
    <View style={gs.gridContainer}>
      <View style={gs.grid}>
        {posterItems.map((item) => {
          const uri = uriMap.get(item.id);
          return (
            <Pressable
              key={item.id}
              style={({ pressed }) => [gs.cell, pressed && gs.cellPressed]}
              onPress={() => onPress(item.entryId)}
              accessibilityRole="button"
              accessibilityLabel={item.title}
            >
              <View style={gs.posterBg}>
                {uri ? (
                  <Image source={{ uri }} style={gs.posterImg} resizeMode="cover" />
                ) : null /* shimmer — backgroundColor on posterBg provides the placeholder */}
              </View>
              <Text style={gs.cellTitle} numberOfLines={2}>{item.title}</Text>
            </Pressable>
          );
        })}
      </View>

      {noArtItems.length > 0 && (
        <View style={gs.noArtSection}>
          {noArtItems.map((item, idx) => (
            <View key={item.id}>
              {idx > 0 && <View style={gs.noArtSep} />}
              <Pressable
                style={({ pressed }) => [gs.noArtRow, pressed && gs.noArtRowPressed]}
                onPress={() => onPress(item.entryId)}
                accessibilityRole="button"
                accessibilityLabel={item.title}
              >
                <KindIcon
                  kind={kind === "episode" ? "episode" : kind === "book" ? "book" : kind === "concert" ? "event" : "film"}
                  subkind={kind === "concert" ? "concert" : undefined}
                  size={16}
                  color={colors.textTertiary}
                  accessibilityLabel=""
                />
                <Text style={gs.noArtTitle}>{item.title}</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ── FilterPill ────────────────────────────────────────────────────────────────

// ── ArtistImage ───────────────────────────────────────────────────────────────

/**
 * Compact artist photo for collapsed concert group headers.
 * Resolves via TheAudioDB (poster_path is a full URL for artist images).
 * Renders nothing until resolved; fades in when found.
 */
function ArtistImage({
  artistName,
  colors,
}: {
  artistName: string;
  colors: ThemeColors;
}) {
  const [uri, setUri] = useState<string | null>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let cancelled = false;
    resolveArtistImage(artistName).then((match) => {
      if (cancelled || !match?.poster_path) return;
      // TheAudioDB stores full URLs directly as poster_path
      const provider = getArtistImageProvider();
      const imageUri = provider ? provider.imageUrl(match.poster_path) : match.poster_path;
      setUri(imageUri);
      Animated.timing(fadeAnim, { toValue: 1, duration: 250, useNativeDriver: true }).start();
    });
    return () => { cancelled = true; };
  }, [artistName]);

  if (!uri) return null;

  return (
    <Animated.View
      style={{
        opacity: fadeAnim,
        width: 48,
        height: 48,
        borderRadius: 24,
        overflow: "hidden",
        marginLeft: spacingScale.base,
        marginBottom: spacingScale.sm,
        backgroundColor: colors.border,
      }}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Photo of ${artistName}`}
    >
      <Image source={{ uri }} style={{ width: 48, height: 48 }} resizeMode="cover" />
    </Animated.View>
  );
}

function FilterPill({
  label,
  count,
  active,
  onPress,
  styles,
}: {
  label: string;
  count: number;
  active: boolean;
  onPress: () => void;
  styles: Styles;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.pill, active && styles.pillActive]}>
      <Text style={[styles.pillText, active && styles.pillTextActive]}>{label}</Text>
      <Text style={[styles.pillCount, active && styles.pillCountActive]}>{count}</Text>
    </Pressable>
  );
}

// ── screen ───────────────────────────────────────────────────────────────────

export default function CultureScreen() {
  const journal = useJournal();
  const router  = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const { colors, fonts } = useTheme();
  const styles = useMemo(() => createStyles(colors, fonts), [colors, fonts]);

  // Track which series are expanded (default: all collapsed)
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  const toggleSeries = useCallback((key: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // ── base entry sets ───────────────────────────────────────────────────────

  const allConcerts = useMemo(
    () => journal.events.filter((e) => e.category === "concert") as JEvent[],
    [journal.events],
  );

  const counts = useMemo(() => ({
    all:     journal.films.length + journal.episodes.length + journal.books.length + allConcerts.length,
    film:    journal.films.length,
    episode: journal.episodes.length,
    book:    journal.books.length,
    concert: allConcerts.length,
  }), [journal, allConcerts]);

  // ── grouped data ──────────────────────────────────────────────────────────

  /** Concerts grouped by artist, artists sorted A→Z, shows within each artist oldest→newest. */
  const concertsByArtist = useMemo(() => {
    const map = new Map<string, JEvent[]>();
    for (const c of allConcerts) {
      const artist = (view(c).kind === "event" ? view(c).artist : c.artist) || "Unknown";
      const arr = map.get(artist) ?? [];
      arr.push(c);
      map.set(artist, arr);
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([artist, list]) => ({
        artist,
        list: list.sort((a, b) => sortDate(a).localeCompare(sortDate(b))),
      }));
  }, [allConcerts]);

  const filmSections = useMemo(() => {
    const { standalone, series } = groupFilmsBySeries(journal.films);
    type Section =
      | { type: "series";     data: FilmSeriesGroup; date: string }
      | { type: "standalone"; data: Film;            date: string };
    const all: Section[] = [
      ...series.map((sg) => ({ type: "series"     as const, data: sg, date: sortDate(sg.films[0]) })),
      ...standalone.map((f) => ({ type: "standalone" as const, data: f, date: sortDate(f) })),
    ];
    // Library sort: alphabetical by title (series name / standalone title)
    return all.sort((a, b) => {
      const titleA = a.type === "series" ? (a.data as FilmSeriesGroup).name : entryTitle(view(a.data as Film));
      const titleB = b.type === "series" ? (b.data as FilmSeriesGroup).name : entryTitle(view(b.data as Film));
      return titleA.localeCompare(titleB);
    });
  }, [journal.films]);

  const showGroups = useMemo(
    () => groupEpisodesBySeries(journal.episodes, journal.series),
    [journal.episodes, journal.series],
  );

  /**
   * Stable grid item lists for PosterGrid — one item per standalone film or
   * film-series, and one per TV show. Stable references prevent unnecessary
   * artwork re-resolution when unrelated state (e.g. book toggles) changes.
   */
  const filmGridItems = useMemo<PosterGridItem[]>(
    () =>
      filmSections.map((sec) => {
        if (sec.type === "standalone") {
          const f = sec.data as Film;
          return {
            id: f.id,
            title: entryTitle(view(f)),
            artworkKey: eventToArtworkKey(f) ?? "",
            entryId: f.id,
          };
        }
        const sg = sec.data as FilmSeriesGroup;
        const latest = sg.films[0];
        return {
          id: `series:${sg.name}`,
          title: sg.name,
          artworkKey: eventToArtworkKey(latest) ?? "",
          entryId: latest.id,
        };
      }),
    [filmSections],
  );

  const tvGridItems = useMemo<PosterGridItem[]>(
    () =>
      [...showGroups]
        .sort((a, b) => a.title.localeCompare(b.title))
        .map(({ title, episodes: eps }) => ({
          id: `show:${title}`,
          title,
          artworkKey: eventToArtworkKey(eps[0]) ?? "",
          entryId: eps[0].id,
        })),
    [showGroups],
  );

  /**
   * Book grid: one tile per book — no series grouping.
   * Library sort: alphabetical by author, then by title within each author.
   */
  const bookGridItems = useMemo<PosterGridItem[]>(
    () =>
      [...journal.books]
        .sort((a, b) => {
          const authorCmp = (a.author ?? "").localeCompare(b.author ?? "");
          if (authorCmp !== 0) return authorCmp;
          return a.title.localeCompare(b.title);
        })
        .map((b) => ({
          id: b.id,
          title: entryTitle(view(b)),
          artworkKey: bookToArtworkKey(b) ?? "",
          entryId: b.id,
          bookEntry: b,
        })),
    [journal.books],
  );

  /** One grid tile per artist (A→Z). Tapping navigates to the most recent concert. */
  const concertGridItems = useMemo<PosterGridItem[]>(
    () =>
      concertsByArtist.map(({ artist, list }) => ({
        id: `artist:${artist}`,
        title: artist,
        artworkKey: artistToArtworkKey(artist) ?? "",
        // Navigate to the most recent concert for this artist
        entryId: list[list.length - 1].id,
      })),
    [concertsByArtist],
  );

  // ── build flat list ───────────────────────────────────────────────────────

  const listItems = useMemo<ListItem[]>(() => {
    const items: ListItem[] = [];
    const showHeaders = filter === "all";

    // Push entries with hairlines between them
    function pushEntries(entries: CultureEntry[]) {
      entries.forEach((e, i) => {
        if (i > 0) items.push({ type: "separator", id: `sep-${e.id}` });
        items.push({ type: "entry", id: e.id, entry: e });
      });
    }

    // Push a series section (films or books): series groups (collapsible) interleaved with standalone
    function pushSeriesSection<
      G extends { name: string },
      E extends CultureEntry,
    >(
      sections: Array<
        | { type: "series"; data: G; date: string }
        | { type: "standalone"; data: E; date: string }
      >,
      getEntries: (g: G) => E[],
      countLabel: (n: number) => string,
      kind: CultureKind,
      /** Optional: derive poster artwork key from the series group's entries */
      getArtworkKey?: (entries: E[]) => string | null,
    ) {
      sections.forEach((sec, si) => {
        if (si > 0) {
          const prev = sections[si - 1];
          if (sec.type === "series" || prev.type === "series") {
            items.push({ type: "groupGap", id: `gap-sec-${si}` });
          } else {
            items.push({ type: "separator", id: `sep-sec-${si}` });
          }
        }
        if (sec.type === "series") {
          const g      = sec.data as G;
          const entries = getEntries(g);
          const key    = `series:${g.name}`;
          const collapsed = !expandedKeys.has(key);
          const seriesAvg = avgRating(entries);
          const ak = getArtworkKey ? (getArtworkKey(entries) ?? undefined) : undefined;
          items.push({
            type: "groupHeader",
            id: `gh-${key}`,
            title: g.name,
            subtitle: countLabel(entries.length),
            avg: seriesAvg,
            collapsible: true,
            collapsed,
            seriesKey: key,
            kind,
            artworkKey: ak,
          });
          if (!collapsed) pushEntries(entries);
        } else {
          const e = sec.data as E;
          items.push({ type: "entry", id: e.id, entry: e });
        }
      });
    }

    // ── Concerts ──────────────────────────────────────────────────────────
    if ((filter === "all" || filter === "concert") && allConcerts.length > 0) {
      if (showHeaders) {
        items.push({
          type: "sectionHeader",
          id: "sh-concerts",
          title: `Concerts · ${allConcerts.length} shows · ${concertsByArtist.length} artists`,
        });
      }
      items.push({ type: "posterGrid", id: "grid-concerts", items: concertGridItems, kind: "concert" });
      if (showHeaders) items.push({ type: "sectionGap", id: "sgap-concerts" });
    }

    // ── Films (poster grid) ───────────────────────────────────────────────
    if ((filter === "all" || filter === "film") && journal.films.length > 0) {
      if (showHeaders) {
        items.push({ type: "sectionHeader", id: "sh-films", title: `Films · ${journal.films.length}` });
      }
      items.push({ type: "posterGrid", id: "grid-films", items: filmGridItems, kind: "film" });
      if (showHeaders) items.push({ type: "sectionGap", id: "sgap-films" });
    }

    // ── TV (poster grid) ──────────────────────────────────────────────────
    if ((filter === "all" || filter === "episode") && journal.episodes.length > 0) {
      if (showHeaders) {
        items.push({
          type: "sectionHeader",
          id: "sh-tv",
          title: `TV · ${journal.episodes.length} episodes · ${showGroups.length} shows`,
        });
      }
      items.push({ type: "posterGrid", id: "grid-tv", items: tvGridItems, kind: "episode" });
      if (showHeaders) items.push({ type: "sectionGap", id: "sgap-tv" });
    }

    // ── Books (poster grid) ───────────────────────────────────────────────
    if ((filter === "all" || filter === "book") && journal.books.length > 0) {
      if (showHeaders) {
        items.push({ type: "sectionHeader", id: "sh-books", title: `Books · ${journal.books.length}` });
      }
      items.push({ type: "posterGrid", id: "grid-books", items: bookGridItems, kind: "book" });
      if (showHeaders) items.push({ type: "sectionGap", id: "sgap-books" });
    }

    return items;
  }, [filter, allConcerts, concertGridItems, filmGridItems, tvGridItems, bookGridItems, journal.books, journal.films, journal.episodes]);

  const isEmpty = counts.all === 0;

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      {/* Filter pills */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.pills}
        contentContainerStyle={styles.pillsContent}
      >
        {FILTERS.map((f) => (
          <FilterPill
            key={f.id}
            label={f.label}
            count={f.id === "all" ? counts.all : counts[f.id as CultureKind]}
            active={filter === f.id}
            onPress={() => setFilter(f.id)}
            styles={styles}
          />
        ))}
      </ScrollView>

      {isEmpty ? (
        <View style={styles.empty}>
          <KindIcon kind="film" size={48} color={colors.textTertiary} accessibilityLabel="" />
          <Text style={styles.emptyTitle}>Nothing here yet</Text>
          <Text style={styles.emptyHint}>
            Import Letterboxd, Netflix, or Goodreads data to populate Culture.
          </Text>
          <Pressable style={styles.ctaBtn} onPress={() => router.push("/import")}>
            <Ionicons name="add" size={18} color="white" />
            <Text style={styles.ctaBtnText}>Import culture</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          style={styles.list}
          data={listItems}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => {
            switch (item.type) {

              case "sectionHeader":
                return (
                  <View style={styles.sectionHeader}>
                    <Text style={styles.sectionHeaderText}>{item.title}</Text>
                  </View>
                );

              case "posterGrid":
                return (
                  <PosterGrid
                    items={item.items}
                    kind={item.kind}
                    colors={colors}
                    fonts={fonts}
                    onPress={(entryId) => router.push(`/entry/${entryId}`)}
                  />
                );

              case "groupHeader":
                if (item.collapsible) {
                  return (
                    <View>
                      <Pressable
                        onPress={() => toggleSeries(item.seriesKey!)}
                        style={({ pressed }) => [
                          styles.groupHeader,
                          styles.groupHeaderCollapsible,
                          pressed && styles.groupHeaderPressed,
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel={`${item.collapsed ? "Expand" : "Collapse"} ${item.title}`}
                      >
                        {/* Leading icon — mirrors EntryRow's markWrap position */}
                        <View style={styles.groupHeaderMark}>
                          <KindIcon
                            kind={item.kind === "episode" ? "episode" : item.kind === "book" ? "book" : item.kind === "concert" ? "event" : "film"}
                            subkind={item.kind === "concert" ? "concert" : undefined}
                            size={18}
                            color={colors.textTertiary}
                            accessibilityLabel=""
                          />
                        </View>
                        <Text style={styles.groupHeaderTitle}>{item.title}</Text>
                        {/* Trailing: avg stars + count + chevron */}
                        <View style={styles.groupHeaderTrailing}>
                          {item.avg != null && (
                            <StarRating rating={Math.round(item.avg * 2) / 2} color={colors.star} size={11} />
                          )}
                          <Text style={styles.groupHeaderSubtitle}>{item.subtitle}</Text>
                          <Ionicons
                            name={item.collapsed ? "chevron-forward" : "chevron-down"}
                            size={13}
                            color={colors.textTertiary}
                          />
                        </View>
                      </Pressable>
                      {/* Poster — only shown when collapsed; reveals the artwork without crowding the episode list */}
                      {item.collapsed && item.artworkKey && (
                        <View style={styles.posterWrap}>
                          <PosterCard
                            artworkKey={item.artworkKey}
                            title={item.title}
                            variant="compact"
                          />
                        </View>
                      )}
                      {/* Artist photo — shown when concert group is collapsed */}
                      {item.collapsed && item.artistName && (
                        <ArtistImage artistName={item.artistName} colors={colors} />
                      )}
                    </View>
                  );
                }
                return (
                  <View style={styles.groupHeader}>
                    <Text style={[styles.groupHeaderTitle, styles.groupHeaderTitleFixed]}>{item.title}</Text>
                    <Text style={styles.groupHeaderSubtitle}>{item.subtitle}</Text>
                  </View>
                );

              case "entry": {
                // Standalone films get a compact poster below their row.
                // (Books are now in the poster grid, not as list entries.)
                const entryAk =
                  item.entry.kind === "film"
                    ? (eventToArtworkKey(item.entry) ?? undefined)
                    : undefined;
                return (
                  <View style={styles.entryWrap}>
                    <EntryRow
                      entry={item.entry}
                      colors={colors}
                      fonts={fonts}
                      onPress={() => router.push(`/entry/${item.entry.id}`)}
                    />
                    {entryAk && (
                      <PosterCard
                        artworkKey={entryAk}
                        title={entryTitle(view(item.entry))}
                        variant="compact"
                      />
                    )}
                  </View>
                );
              }

              case "separator":
                return <View style={styles.separator} />;

              case "groupGap":
                return <View style={styles.groupGap} />;

              case "sectionGap":
                return <View style={styles.sectionGap} />;

              default:
                return null;
            }
          }}
          contentContainerStyle={styles.listContent}
          removeClippedSubviews
        />
      )}
    </View>
  );
}
