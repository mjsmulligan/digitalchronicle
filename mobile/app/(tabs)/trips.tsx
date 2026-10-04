/**
 * Trips tab — all trips, sorted newest-first, in the two-column journal layout.
 *
 * The date column shows the trip's start date (big serif number) so the tab
 * reads chronologically like the Chronicle and Culture tabs.
 */
import { useMemo } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Link, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
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
    listAction: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "flex-end",
      paddingHorizontal: spacingScale.base,
      minHeight: 48,
    },
    listActionText: {
      fontSize: 14,
      fontFamily: fonts.sans,
      color: colors.accentSoft,
      fontWeight: "500",
    },

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

    // Per-type entry breakdown (WP-T6)
    statRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacingScale.md2,
      marginTop: spacingScale.sm,
    },
    statItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: 3,
    },
    statNum: {
      fontFamily: fonts.mono,
      fontSize: 11,
      fontWeight: "700",
      color: colors.textSecondary,
    },

    // Suggested count badge (WP-T7)
    suggestedBadge: {
      ...textScale.sm,
      color: colors.accentSoft,
      fontWeight: "600",
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
    newTripBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacingScale.sm2,
      marginTop: spacingScale.xl,
      paddingHorizontal: spacingScale.lg,
      paddingVertical: spacingScale.md,
      borderRadius: radiusScale.pill,
      backgroundColor: colors.accentBold,
    },
    newTripBtnText: { color: colors.white, fontSize: 15, fontWeight: "700" },
  });
}

type Styles = ReturnType<typeof createStyles>;

// ── components ────────────────────────────────────────────────────────────────

interface TripItem {
  trip: Trip;
  entryCount: number;
  flights: number;
  trains: number;
  stays: number;
  events: number;
  suggested: number;
}

function TripRow({ item, styles, colors }: { item: TripItem; styles: Styles; colors: ThemeColors }) {
  const { trip, entryCount, flights, trains, stays, events, suggested } = item;
  const { num, day, month, year } = parseDay(trip.start);
  const n = nights(trip);
  const router = useRouter();

  // Build stat items — only non-zero
  const stats: { kind: string; subkind?: string; count: number }[] = [];
  if (flights > 0) stats.push({ kind: "leg", subkind: "air",  count: flights });
  if (trains  > 0) stats.push({ kind: "leg", subkind: "rail", count: trains  });
  if (stays   > 0) stats.push({ kind: "stay",                 count: stays   });
  if (events  > 0) stats.push({ kind: "event",                count: events  });

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
            {suggested > 0 && (
              <>
                <Text style={styles.metaDot}>{"·"}</Text>
                <Text style={styles.suggestedBadge}>
                  {suggested} suggested
                </Text>
              </>
            )}
          </View>

          {/* Per-type breakdown — only shown when there are categorisable entries */}
          {stats.length > 0 && (
            <View style={styles.statRow}>
              {stats.map((s) => (
                <View key={`${s.kind}-${s.subkind ?? ""}`} style={styles.statItem}>
                  <KindIcon
                    kind={s.kind}
                    subkind={s.subkind}
                    size={13}
                    color={colors.textSecondary}
                    accessibilityLabel=""
                  />
                  <Text style={styles.statNum}>{s.count}</Text>
                </View>
              ))}
            </View>
          )}
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

    // Per-trip linked entry stats
    const statMap = new Map<string, { count: number; flights: number; trains: number; stays: number; events: number }>();
    for (const e of entries) {
      if (!e.tripId) continue;
      if (!statMap.has(e.tripId)) statMap.set(e.tripId, { count: 0, flights: 0, trains: 0, stays: 0, events: 0 });
      const s = statMap.get(e.tripId)!;
      s.count++;
      if (e.kind === "leg" && (e as any).mode === "air")  s.flights++;
      else if (e.kind === "leg" && (e as any).mode === "rail") s.trains++;
      else if (e.kind === "stay")  s.stays++;
      else if (e.kind === "event") s.events++;
    }

    return [...journal.trips]
      .sort((a, b) => b.start.localeCompare(a.start))
      .map((t) => {
        const s = statMap.get(t.id);
        const suggested = entries.filter(
          (e) => !e.tripId && e.start.slice(0, 10) >= t.start && e.start.slice(0, 10) <= t.end
        ).length;
        return {
          trip: t,
          entryCount: s?.count ?? 0,
          flights:    s?.flights ?? 0,
          trains:     s?.trains  ?? 0,
          stays:      s?.stays   ?? 0,
          events:     s?.events  ?? 0,
          suggested,
        };
      });
  }, [journal]);

  const router = useRouter();

  if (!trips.length) {
    return (
      <View style={styles.empty}>
        <KindIcon kind="leg" subkind="air" size={48} color={colors.textTertiary} accessibilityLabel="" />
        <Text style={styles.emptyTitle}>No trips yet</Text>
        <Text style={styles.emptyHint}>
          Import a Viaduct or iCalendar file to populate your trips.
        </Text>
        <Pressable style={styles.newTripBtn} onPress={() => router.push("/trip/new")}>
          <Ionicons name="add" size={18} color="white" />
          <Text style={styles.newTripBtnText}>New trip</Text>
        </Pressable>
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
      ListHeaderComponent={
        <Link href="/trip/new" asChild>
          <Pressable style={styles.listAction}>
            <Text style={styles.listActionText}>New trip</Text>
          </Pressable>
        </Link>
      }
    />
  );
}
