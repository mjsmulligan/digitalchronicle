/**
 * Culture tab — films, TV episodes, books, and concerts in the two-column
 * journal layout, grouped by day. Filter pills at the top narrow by kind.
 */
import { useMemo, useState } from "react";
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useJournal } from "@chronicle/journal/db";
import { view, type Entry, type Film, type Episode, type Book, type JEvent } from "@chronicle/journal/types";
import { useTheme, type ThemeColors, type ThemeFonts, text as textScale, spacing as spacingScale, radius as radiusScale } from "../../src/components/ThemeProvider";
import { KindIcon, StarRating } from "../../src/components/KindIcon";

// ── types & helpers ───────────────────────────────────────────────────────────

type CultureKind = "film" | "episode" | "book" | "concert";
type Filter = "all" | CultureKind;

type CultureEntry = Film | Episode | Book | JEvent;

function isCulture(e: Entry): e is CultureEntry {
  return (
    e.kind === "film" ||
    e.kind === "episode" ||
    e.kind === "book" ||
    (e.kind === "event" && (e as JEvent).category === "concert")
  );
}

function cultureTitle(e: CultureEntry): string {
  const v = view(e);
  if (v.kind === "film") return v.year ? `${v.title} (${v.year})` : v.title;
  if (v.kind === "episode") return v.episodeTitle ? `${v.showTitle}: ${v.episodeTitle}` : v.showTitle;
  if (v.kind === "book") return `${v.title}${v.author ? ` — ${v.author}` : ""}`;
  return (v as JEvent).artist;
}

function cultureSubkind(e: CultureEntry): string | undefined {
  if (e.kind === "event") return "concert";
  return undefined;
}

const MONTHS_SHORT = ["JAN","FEB","MAR","APR","MAY","JUN",
                      "JUL","AUG","SEP","OCT","NOV","DEC"];
const DAYS_SHORT   = ["SUN","MON","TUE","WED","THU","FRI","SAT"];

function parseDay(iso: string) {
  const d = new Date(iso + "T12:00:00");
  return {
    num:   d.getDate().toString(),
    day:   DAYS_SHORT[d.getDay()],
    month: MONTHS_SHORT[d.getMonth()],
    year:  d.getFullYear().toString(),
  };
}

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all",     label: "All" },
  { id: "film",    label: "Films" },
  { id: "episode", label: "TV" },
  { id: "book",    label: "Books" },
  { id: "concert", label: "Concerts" },
];

// ── data ─────────────────────────────────────────────────────────────────────

interface DayGroup {
  iso: string;
  items: CultureEntry[];
}

// ── styles factory ────────────────────────────────────────────────────────────

const DATE_COL_W = 52;

function createStyles(colors: ThemeColors, fonts: ThemeFonts) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    list: { flex: 1 },
    listContent: { paddingBottom: spacingScale["3xl"] },

    // Filter pills
    pills: { flexGrow: 0, borderBottomWidth: 1, borderBottomColor: colors.borderFaint },
    pillsContent: { padding: spacingScale.md, gap: spacingScale.sm, flexDirection: "row" },
    pill: {
      paddingHorizontal: spacingScale.md2,
      paddingVertical: spacingScale.sm2,
      borderRadius: radiusScale.pill,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    pillActive: { backgroundColor: colors.surfaceAccent, borderColor: colors.accent },
    pillText: { ...textScale.smMd, color: colors.textSecondary, fontWeight: "600" },
    pillTextActive: { color: colors.accentSubtle },

    // Day group row
    dayGroup: {
      flexDirection: "row",
      paddingHorizontal: spacingScale.base,
      paddingTop: spacingScale.xl,
      paddingBottom: spacingScale.sm,
    },

    // Date column
    dateCol: {
      width: DATE_COL_W,
      alignItems: "center",
      paddingTop: 2,
      flexShrink: 0,
    },
    dateNum: {
      fontFamily: fonts.serifBold,
      fontWeight: "700",
      ...textScale.dayNum,
      color: colors.textBright,
    },
    dateSub: {
      fontFamily: fonts.mono,
      fontSize: 10,
      fontWeight: "700",
      letterSpacing: 0.8,
      color: colors.textTertiary,
      lineHeight: 15,
      textTransform: "uppercase" as const,
    },

    // Vertical rule
    dateRule: {
      width: 1,
      alignSelf: "stretch",
      backgroundColor: colors.border,
      marginHorizontal: spacingScale.md,
      marginTop: 4,
    },

    // Entries column
    entriesCol: {
      flex: 1,
      gap: spacingScale.sm,
    },

    // Entry card
    card: {
      backgroundColor: colors.surface,
      borderRadius: radiusScale.lg,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacingScale.md2,
      paddingVertical: spacingScale.md,
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacingScale.sm,
    },
    cardPressed: { opacity: 0.65 },
    cardBody: { flex: 1 },
    cardTitle: {
      ...textScale.feedTitle,
      fontFamily: fonts.serifMedium,
      color: colors.textPrimary,
      fontWeight: "500",
      marginBottom: 3,
    },
    cardStars: { ...textScale.xs, color: colors.star, marginTop: 2 },

    // Separator between days
    daySeparator: {
      height: 1,
      backgroundColor: colors.borderFaint,
      marginHorizontal: spacingScale.base,
    },

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
      marginBottom: spacingScale.sm,
    },
    emptyHint: { ...textScale.md, color: colors.textTertiary, textAlign: "center" },
  });
}

type Styles = ReturnType<typeof createStyles>;

// ── components ────────────────────────────────────────────────────────────────

function FilterPill({
  label,
  active,
  onPress,
  styles,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  styles: Styles;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.pill, active && styles.pillActive]}
    >
      <Text style={[styles.pillText, active && styles.pillTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

function EntryCard({ entry, styles, colors }: { entry: CultureEntry; styles: Styles; colors: ThemeColors }) {
  const router = useRouter();
  const v = view(entry);

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={() => router.push(`/entry/${entry.id}`)}
    >
      <KindIcon
        kind={entry.kind}
        subkind={cultureSubkind(entry)}
        size={18}
        color={colors.textSecondary}
        accessibilityLabel=""
      />
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {cultureTitle(entry)}
        </Text>
        {v.rating !== undefined && (
          <StarRating rating={v.rating} color={colors.star} size={11} />
        )}
      </View>
    </Pressable>
  );
}

function DayGroupRow({ group, styles, colors }: { group: DayGroup; styles: Styles; colors: ThemeColors }) {
  const { num, day, month, year } = parseDay(group.iso);

  return (
    <View style={styles.dayGroup}>
      {/* Left: date column */}
      <View style={styles.dateCol}>
        <Text style={styles.dateNum}>{num}</Text>
        <Text style={styles.dateSub}>{day}</Text>
        <Text style={styles.dateSub}>{month}</Text>
        <Text style={styles.dateSub}>{year}</Text>
      </View>

      {/* Centre: vertical rule */}
      <View style={styles.dateRule} />

      {/* Right: entry cards */}
      <View style={styles.entriesCol}>
        {group.items.map((entry) => (
          <EntryCard key={entry.id} entry={entry} styles={styles} colors={colors} />
        ))}
      </View>
    </View>
  );
}

// ── screen ───────────────────────────────────────────────────────────────────

export default function CultureScreen() {
  const journal = useJournal();
  const [filter, setFilter] = useState<Filter>("all");
  const { colors, fonts } = useTheme();
  const styles = useMemo(() => createStyles(colors, fonts), [colors, fonts]);

  const groups = useMemo<DayGroup[]>(() => {
    const all: CultureEntry[] = [
      ...journal.films,
      ...journal.episodes,
      ...journal.books,
      ...journal.events.filter((e) => (e as JEvent).category === "concert"),
    ].filter(isCulture);

    const filtered =
      filter === "all"
        ? all
        : filter === "concert"
        ? all.filter((e) => e.kind === "event")
        : all.filter((e) => e.kind === filter);

    const sorted = filtered.sort((a, b) => b.start.localeCompare(a.start));

    const byDay = new Map<string, CultureEntry[]>();
    for (const e of sorted) {
      const day = e.start.slice(0, 10);
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day)!.push(e);
    }
    return [...byDay.entries()].map(([iso, items]) => ({ iso, items }));
  }, [journal, filter]);

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
            active={filter === f.id}
            onPress={() => setFilter(f.id)}
            styles={styles}
          />
        ))}
      </ScrollView>

      {!groups.length ? (
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
          data={groups}
          keyExtractor={(g) => g.iso}
          renderItem={({ item }) => <DayGroupRow group={item} styles={styles} colors={colors} />}
          ItemSeparatorComponent={() => <View style={styles.daySeparator} />}
          contentContainerStyle={styles.listContent}
        />
      )}
    </View>
  );
}
