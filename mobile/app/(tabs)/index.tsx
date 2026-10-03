/**
 * Chronicle tab — chronological feed of all entry kinds.
 *
 * Layout: one DayGroup per calendar day, newest first.
 * Each DayGroup renders the date column, a vertical spine rule, optional
 * trip label, entry rows (hairline-separated, not cards), and a reflection
 * prompt at the bottom — matching the web Chronicle feed (src/routes/index.tsx).
 *
 * Search, kind/category filters, and the People filter are WP1.10.
 */
import { useMemo } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useJournal, allEntries } from "@chronicle/journal/db";
import { type Entry, type Note } from "@chronicle/journal/types";
import { useTheme, type ThemeColors, type ThemeFonts, text as textScale, spacing as spacingScale } from "../../src/components/ThemeProvider";
import { KindIcon } from "../../src/components/KindIcon";
import { DayGroup, type DayGroupData } from "../../src/components/DayGroup";

// ── styles ────────────────────────────────────────────────────────────────────

function createStyles(colors: ThemeColors, fonts: ThemeFonts) {
  return StyleSheet.create({
    list:    { flex: 1, backgroundColor: colors.bg },
    content: { paddingBottom: spacingScale["3xl"] },

    // Hairline separator between day groups
    daySeparator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.borderFaint,
      marginHorizontal: spacingScale.base,
    },

    // Empty state
    empty: {
      flex: 1,
      backgroundColor: colors.bg,
      alignItems: "center",
      justifyContent: "center",
      padding: spacingScale["2xl"],
    },
    emptyTitle: {
      ...textScale.xl,
      fontFamily: fonts.serifSemiBold,
      fontWeight: "600",
      color: colors.textPrimary,
      marginTop: spacingScale.base,
      marginBottom: spacingScale.sm,
    },
    emptyHint:  { ...textScale.md, color: colors.textTertiary, textAlign: "center" },
  });
}

// ── screen ───────────────────────────────────────────────────────────────────

export default function ChronicleScreen() {
  const journal = useJournal();
  const router = useRouter();
  const { colors, fonts } = useTheme();
  const styles = useMemo(() => createStyles(colors, fonts), [colors, fonts]);

  // Build day groups mirroring web logic (src/routes/index.tsx):
  //   - Group entries by calendar day (newest first)
  //   - Attach the trip whose date range contains each day (not just tripId match)
  //   - Attach the day-level reflection note if one exists
  const groups = useMemo<DayGroupData[]>(() => {
    const entries = allEntries(journal).sort((a, b) =>
      (a.overrides?.start ?? a.start).localeCompare(b.overrides?.start ?? b.start)
    );

    // Build day → entries map
    const byDay = new Map<string, Entry[]>();
    for (const e of entries) {
      const d = (e.overrides?.start ?? e.start).slice(0, 10);
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d)!.push(e);
    }

    // Build day → note map
    const noteByDay = new Map<string, Note>();
    for (const n of journal.notes) {
      if (n.date && !n.tripId) noteByDay.set(n.date, n);
    }

    // Resolve trip for each day by date range (mirrors web `tripOf`)
    const tripOf = (d: string) =>
      journal.trips.find((t) => d >= t.start && d <= t.end);

    return [...byDay.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))  // newest day first
      .map(([iso, items]) => ({
        iso,
        items,
        tripTitle: tripOf(iso)?.title,
        note: noteByDay.get(iso),
      }));
  }, [journal]);

  if (!groups.length) {
    return (
      <View style={styles.empty}>
        <KindIcon kind="book" size={48} color={colors.textTertiary} accessibilityLabel="" />
        <Text style={styles.emptyTitle}>Your journal is empty</Text>
        <Text style={styles.emptyHint}>
          Tap the import icon above to add your first entries.
        </Text>
      </View>
    );
  }

  return (
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
          // onReflectionPress wired up in WP1.10
        />
      )}
      ItemSeparatorComponent={() => <View style={styles.daySeparator} />}
      contentContainerStyle={styles.content}
      // removeClippedSubviews helps with large feeds
      removeClippedSubviews
    />
  );
}
