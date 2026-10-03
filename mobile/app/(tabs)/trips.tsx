/**
 * Trips tab — all trips, sorted newest-first, in the two-column journal layout.
 *
 * The date column shows the trip's start date (big serif number) so the tab
 * reads chronologically like the Chronicle and Culture tabs.
 */
import { useMemo } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useJournal, allEntries } from "@chronicle/journal/db";
import type { Trip } from "@chronicle/journal/types";
import { useTheme, type ThemeColors, type ThemeFonts, text as textScale, spacing as spacingScale, radius as radiusScale } from "../../src/components/ThemeProvider";
import { KindIcon } from "../../src/components/KindIcon";

// ── helpers ──────────────────────────────────────────────────────────────────

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

function fmtEnd(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

function nights(trip: Trip): number {
  return Math.max(
    0,
    Math.round((+new Date(trip.end) - +new Date(trip.start)) / 86_400_000)
  );
}

/** Maps trip purpose to the KindIcon kind string. */
const PURPOSE_KIND: Record<string, string> = {
  leisure: "leisure",
  work:    "work",
  family:  "family",
};

// ── styles factory ────────────────────────────────────────────────────────────

const DATE_COL_W = 52;

function createStyles(colors: ThemeColors, fonts: ThemeFonts) {
  return StyleSheet.create({
    list: { flex: 1, backgroundColor: colors.bg },
    listContent: { paddingBottom: spacingScale["3xl"] },

    // Two-column row
    row: {
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

    // Card column
    cardCol: { flex: 1 },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radiusScale.lg,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacingScale.md2,
      paddingVertical: spacingScale.md,
    },
    cardPressed: { opacity: 0.65 },

    cardTop: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: spacingScale.sm,
      marginBottom: spacingScale.sm,
    },
    tripTitle: {
      flex: 1,
      fontFamily: fonts.serifBold,
      fontWeight: "700",
      ...textScale.feedTitle,
      color: colors.textPrimary,
    },


    cardMeta: { flexDirection: "row", gap: spacingScale.sm2, flexWrap: "wrap" },
    metaText: { ...textScale.sm, color: colors.textSecondary },
    metaDot: { ...textScale.sm, color: colors.textMuted },

    separator: {
      height: 1,
      backgroundColor: colors.borderFaint,
      marginHorizontal: spacingScale.base,
    },

    empty: {
      flex: 1,
      backgroundColor: colors.bg,
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

interface TripItem {
  trip: Trip;
  entryCount: number;
}

function TripRow({ item, styles, colors }: { item: TripItem; styles: Styles; colors: ThemeColors }) {
  const { trip, entryCount } = item;
  const { num, day, month, year } = parseDay(trip.start);
  const n = nights(trip);
  const router = useRouter();

  return (
    <View style={styles.row}>
      {/* Left: start date */}
      <View style={styles.dateCol}>
        <Text style={styles.dateNum}>{num}</Text>
        <Text style={styles.dateSub}>{day}</Text>
        <Text style={styles.dateSub}>{month}</Text>
        <Text style={styles.dateSub}>{year}</Text>
      </View>

      {/* Centre: vertical rule */}
      <View style={styles.dateRule} />

      {/* Right: trip card */}
      <View style={styles.cardCol}>
        <Pressable
          style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
          onPress={() => router.push(`/trip/${trip.id}`)}
        >
          <View style={styles.cardTop}>
            <Text style={styles.tripTitle} numberOfLines={2}>
              {trip.title}
            </Text>
            {trip.purpose && (
              <KindIcon
                kind={PURPOSE_KIND[trip.purpose] ?? "location"}
                size={18}
                color={colors.textSecondary}
                accessibilityLabel=""
              />
            )}
          </View>
          <View style={styles.cardMeta}>
            <Text style={styles.metaText}>{"→"} {fmtEnd(trip.end)}</Text>
            <Text style={styles.metaDot}>{"·"}</Text>
            <Text style={styles.metaText}>
              {n} {n === 1 ? "night" : "nights"}
            </Text>
            <Text style={styles.metaDot}>{"·"}</Text>
            <Text style={styles.metaText}>
              {entryCount} {entryCount === 1 ? "entry" : "entries"}
            </Text>
          </View>
        </Pressable>
      </View>
    </View>
  );
}

// ── screen ───────────────────────────────────────────────────────────────────

export default function TripsScreen() {
  const journal = useJournal();
  const { colors, fonts } = useTheme();
  const styles = useMemo(() => createStyles(colors, fonts), [colors, fonts]);

  const trips = useMemo<TripItem[]>(() => {
    const entries = allEntries(journal);
    const countById = new Map<string, number>();
    for (const e of entries) {
      if (e.tripId) countById.set(e.tripId, (countById.get(e.tripId) ?? 0) + 1);
    }
    return [...journal.trips]
      .sort((a, b) => b.start.localeCompare(a.start))
      .map((t) => ({ trip: t, entryCount: countById.get(t.id) ?? 0 }));
  }, [journal]);

  if (!trips.length) {
    return (
      <View style={styles.empty}>
        <KindIcon kind="leg" subkind="air" size={48} color={colors.textTertiary} accessibilityLabel="" />
        <Text style={styles.emptyTitle}>No trips yet</Text>
        <Text style={styles.emptyHint}>
          Import a Viaduct or iCalendar file to populate your trips.
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.list}
      data={trips}
      keyExtractor={({ trip }) => trip.id}
      renderItem={({ item }) => <TripRow item={item} styles={styles} colors={colors} />}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      contentContainerStyle={styles.listContent}
    />
  );
}
