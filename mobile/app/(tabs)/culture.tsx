/**
 * Culture tab — films, TV episodes, books, and concerts grouped by day.
 * Filter pills at the top narrow by kind.
 *
 * Uses the shared DayGroup + EntryRow components for a consistent look with
 * the Chronicle feed (hairline rows, source marks, mono kind labels, stars).
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
import { type Entry, type Film, type Episode, type Book, type JEvent } from "@chronicle/journal/types";
import { useTheme, type ThemeColors, type ThemeFonts, text as textScale, spacing as spacingScale, radius as radiusScale } from "../../src/components/ThemeProvider";
import { KindIcon } from "../../src/components/KindIcon";
import { DayGroup, type DayGroupData } from "../../src/components/DayGroup";

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

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all",     label: "All" },
  { id: "film",    label: "Films" },
  { id: "episode", label: "TV" },
  { id: "book",    label: "Books" },
  { id: "concert", label: "Concerts" },
];

// ── styles factory ────────────────────────────────────────────────────────────

function createStyles(colors: ThemeColors, fonts: ThemeFonts) {
  return StyleSheet.create({
    container:    { flex: 1, backgroundColor: colors.bg },
    list:         { flex: 1 },
    listContent:  { paddingBottom: spacingScale["3xl"] },

    // Hairline separator between day groups
    daySeparator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.borderFaint,
      marginHorizontal: spacingScale.base,
    },

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
    },
    pillActive: { backgroundColor: colors.surfaceAccent, borderColor: colors.accent },
    pillText:       { ...textScale.smMd, color: colors.textSecondary, fontWeight: "600" },
    pillTextActive: { color: colors.accentSubtle },

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

// ── screen ───────────────────────────────────────────────────────────────────

export default function CultureScreen() {
  const journal = useJournal();
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const { colors, fonts } = useTheme();
  const styles = useMemo(() => createStyles(colors, fonts), [colors, fonts]);

  const groups = useMemo<DayGroupData[]>(() => {
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

    const byDay = new Map<string, Entry[]>();
    for (const e of sorted) {
      const d = e.start.slice(0, 10);
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d)!.push(e);
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
          renderItem={({ item: group }) => (
            <DayGroup
              group={group}
              colors={colors}
              fonts={fonts}
              onEntryPress={(entry) => router.push(`/entry/${entry.id}`)}
              showReflection={false}
            />
          )}
          ItemSeparatorComponent={() => <View style={styles.daySeparator} />}
          contentContainerStyle={styles.listContent}
          removeClippedSubviews
        />
      )}
    </View>
  );
}
