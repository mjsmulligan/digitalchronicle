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
import { useMemo, useState, useCallback } from "react";
import {
  FlatList,
  LayoutAnimation,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  UIManager,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useJournal } from "@chronicle/journal/db";
import {
  type Film,
  type Episode,
  type Book,
  type JEvent,
  type Series,
} from "@chronicle/journal/types";
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

// Enable LayoutAnimation on Android
if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

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

// ── Books ─────────────────────────────────────────────────────────────────────

interface BookSeriesGroup {
  name: string;
  books: Book[];
}

function groupBooksBySeries(books: Book[]): { standalone: Book[]; series: BookSeriesGroup[] } {
  const seriesMap = new Map<string, Book[]>();
  const standalone: Book[] = [];
  for (const b of books) {
    if (b.series) {
      const arr = seriesMap.get(b.series) ?? [];
      arr.push(b);
      seriesMap.set(b.series, arr);
    } else {
      standalone.push(b);
    }
  }
  const series: BookSeriesGroup[] = [...seriesMap.entries()]
    .map(([name, bks]) => ({
      name,
      books: [...bks].sort((a, b) => (a.seriesNumber ?? 999) - (b.seriesNumber ?? 999)),
    }))
    .sort((a, b) => sortDate(b.books[0]).localeCompare(sortDate(a.books[0])));
  return { standalone, series };
}

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
    }
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

    // Group header (series name / show title / year) — non-collapsible
    groupHeader: {
      paddingHorizontal: spacingScale.base,
      paddingTop: spacingScale.md,
      paddingBottom: spacingScale.sm,
      flexDirection: "row",
      alignItems: "center",
      gap: spacingScale.sm,
    },
    // Collapsible group header — slightly more padding for tap target
    groupHeaderCollapsible: {
      paddingVertical: spacingScale.md,
    },
    groupHeaderPressed:    { opacity: 0.55 },
    groupHeaderTitle:      { ...textScale.smMd, fontFamily: fonts.serifMedium, fontWeight: "500", color: colors.textPrimary, flex: 1 },
    groupHeaderTitleFixed: { flex: undefined },
    groupHeaderSubtitle:   { fontSize: 10, fontFamily: fonts.mono, color: colors.textTertiary },

    // Entry row padding
    entryWrap: { paddingHorizontal: spacingScale.base },

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
  });
}

type Styles = ReturnType<typeof createStyles>;

// ── FilterPill ────────────────────────────────────────────────────────────────

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

  const concertsByYear = useMemo(() => {
    const map = new Map<string, JEvent[]>();
    for (const c of allConcerts) {
      const yr = (c.overrides?.start ?? c.start).slice(0, 4) || "????";
      const arr = map.get(yr) ?? [];
      arr.push(c);
      map.set(yr, arr);
    }
    return [...map.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([year, list]) => ({
        year,
        list: list.sort((a, b) => sortDate(b).localeCompare(sortDate(a))),
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
    return all.sort((a, b) => b.date.localeCompare(a.date));
  }, [journal.films]);

  const showGroups = useMemo(
    () => groupEpisodesBySeries(journal.episodes, journal.series),
    [journal.episodes, journal.series],
  );

  const bookSections = useMemo(() => {
    const { standalone, series } = groupBooksBySeries(journal.books);
    type Section =
      | { type: "series";     data: BookSeriesGroup; date: string }
      | { type: "standalone"; data: Book;            date: string };
    const all: Section[] = [
      ...series.map((sg) => ({ type: "series"     as const, data: sg, date: sortDate(sg.books[0]) })),
      ...standalone.map((b) => ({ type: "standalone" as const, data: b, date: sortDate(b) })),
    ];
    return all.sort((a, b) => b.date.localeCompare(a.date));
  }, [journal.books]);

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
          items.push({
            type: "groupHeader",
            id: `gh-${key}`,
            title: g.name,
            subtitle: countLabel(entries.length),
            avg: seriesAvg,
            collapsible: true,
            collapsed,
            seriesKey: key,
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
        items.push({ type: "sectionHeader", id: "sh-concerts", title: `Concerts · ${allConcerts.length}` });
      }
      concertsByYear.forEach(({ year, list }, yi) => {
        if (yi > 0) items.push({ type: "groupGap", id: `gap-c-${year}` });
        if (concertsByYear.length > 1 || !showHeaders) {
          items.push({
            type: "groupHeader",
            id: `gh-c-${year}`,
            title: year,
            subtitle: String(list.length),
            collapsible: false,
            collapsed: false,
          });
        }
        pushEntries(list);
      });
      if (showHeaders) items.push({ type: "sectionGap", id: "sgap-concerts" });
    }

    // ── Films ─────────────────────────────────────────────────────────────
    if ((filter === "all" || filter === "film") && journal.films.length > 0) {
      if (showHeaders) {
        items.push({ type: "sectionHeader", id: "sh-films", title: `Films · ${journal.films.length}` });
      }
      pushSeriesSection(
        filmSections,
        (g: FilmSeriesGroup) => g.films,
        (n) => `${n} films`,
      );
      if (showHeaders) items.push({ type: "sectionGap", id: "sgap-films" });
    }

    // ── TV ────────────────────────────────────────────────────────────────
    if ((filter === "all" || filter === "episode") && journal.episodes.length > 0) {
      if (showHeaders) {
        items.push({
          type: "sectionHeader",
          id: "sh-tv",
          title: `TV · ${journal.episodes.length} episodes · ${showGroups.length} shows`,
        });
      }
      showGroups.forEach(({ title, episodes: eps }, si) => {
        if (si > 0) items.push({ type: "groupGap", id: `gap-s-${si}` });
        const key = `show:${title}`;
        const collapsed = !expandedKeys.has(key);
        items.push({
          type: "groupHeader",
          id: `gh-s-${title}`,
          title,
          subtitle: `${eps.length} ep`,
          collapsible: true,
          collapsed,
          seriesKey: key,
        });
        if (!collapsed) pushEntries(eps);
      });
      if (showHeaders) items.push({ type: "sectionGap", id: "sgap-tv" });
    }

    // ── Books ─────────────────────────────────────────────────────────────
    if ((filter === "all" || filter === "book") && journal.books.length > 0) {
      if (showHeaders) {
        items.push({ type: "sectionHeader", id: "sh-books", title: `Books · ${journal.books.length}` });
      }
      pushSeriesSection(
        bookSections,
        (g: BookSeriesGroup) => g.books,
        (n) => `${n} ${n === 1 ? "book" : "books"} read`,
      );
    }

    return items;
  }, [filter, allConcerts, concertsByYear, filmSections, showGroups, bookSections, journal, expandedKeys]);

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

              case "groupHeader":
                if (item.collapsible) {
                  return (
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
                      <Ionicons
                        name={item.collapsed ? "chevron-forward" : "chevron-down"}
                        size={13}
                        color={colors.textTertiary}
                      />
                      <Text style={styles.groupHeaderTitle}>{item.title}</Text>
                      <Text style={styles.groupHeaderSubtitle}>{item.subtitle}</Text>
                      {item.avg != null && (
                        <StarRating rating={Math.round(item.avg * 2) / 2} color={colors.star} size={11} />
                      )}
                    </Pressable>
                  );
                }
                return (
                  <View style={styles.groupHeader}>
                    <Text style={[styles.groupHeaderTitle, styles.groupHeaderTitleFixed]}>{item.title}</Text>
                    <Text style={styles.groupHeaderSubtitle}>{item.subtitle}</Text>
                  </View>
                );

              case "entry":
                return (
                  <View style={styles.entryWrap}>
                    <EntryRow
                      entry={item.entry}
                      colors={colors}
                      fonts={fonts}
                      onPress={() => router.push(`/entry/${item.entry.id}`)}
                    />
                  </View>
                );

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
