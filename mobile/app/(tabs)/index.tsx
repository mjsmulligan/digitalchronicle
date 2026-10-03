/**
 * Chronicle tab — chronological feed of all entry kinds.
 *
 * Layout: journal two-column pattern
 *   +--------+--+----------------------------------+
 *   |  20    |  |  +------------------------------+ |
 *   |  SUN   |  |  | Entry title          FLIGHT  | |
 *   |  SEPT  |  |  +------------------------------+ |
 *   |  2026  |  |  +------------------------------+ |
 *   |        |  |  | Another entry          FILM  | |
 *   +--------+--+----------------------------------+
 *
 * The date column anchors each day like a page of a Moleskine.
 * The vertical rule between them is a quiet journal-spine metaphor.
 */
import { useMemo } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useJournal, allEntries } from "@chronicle/journal/db";
import { entryTitle, view, type Entry } from "@chronicle/journal/types";
import { useTheme, type ThemeColors, type ThemeFonts, text as textScale, spacing as spacingScale, radius as radiusScale } from "../../src/components/ThemeProvider";

// ── helpers ──────────────────────────────────────────────────────────────────

const MONTHS_SHORT = ["JAN","FEB","MAR","APR","MAY","JUN",
                      "JUL","AUG","SEP","OCT","NOV","DEC"];
const DAYS_SHORT   = ["SUN","MON","TUE","WED","THU","FRI","SAT"];

function parseDay(iso: string) {
  // Use noon to avoid DST edge-cases shifting the date
  const d = new Date(iso + "T12:00:00");
  return {
    num:   d.getDate().toString(),
    day:   DAYS_SHORT[d.getDay()],
    month: MONTHS_SHORT[d.getMonth()],
    year:  d.getFullYear().toString(),
  };
}

function kindIcon(e: Entry): string {
  if (e.kind === "leg") return e.mode === "air" ? "✈️" : e.mode === "rail" ? "🚆" : "🚗";
  if (e.kind === "stay")    return "🏨";
  if (e.kind === "film")    return "🎬";
  if (e.kind === "episode") return "📺";
  if (e.kind === "book")    return "📖";
  const cat = (e as Extract<Entry, { kind: "event" }>).category;
  return cat === "concert" ? "🎵" : cat === "celebration" ? "🎉" : cat === "milestone" ? "🏆" : "📍";
}

// ── data ─────────────────────────────────────────────────────────────────────

interface DayEntry {
  entry: Entry;
  tripTitle?: string;
}

interface DayGroup {
  iso: string;
  items: DayEntry[];
}

// ── styles factory ────────────────────────────────────────────────────────────

const DATE_COL_W = 52;

function createStyles(colors: ThemeColors, fonts: ThemeFonts) {
  return StyleSheet.create({
    list:    { flex: 1, backgroundColor: colors.bg },
    content: { paddingBottom: spacingScale["3xl"] },

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
      fontSize: 34,
      lineHeight: 38,
      color: colors.textBright,
    },
    dateSub: {
      fontSize: 10,
      fontWeight: "700",
      letterSpacing: 0.6,
      color: colors.textTertiary,
      lineHeight: 15,
    },

    // Vertical rule between date and entries
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
    cardIcon: { fontSize: 18, lineHeight: 24, marginTop: 1 },
    cardBody: { flex: 1 },
    cardTitle: {
      ...textScale.base,
      color: colors.textPrimary,
      fontWeight: "500",
      marginBottom: 3,
    },
    cardTrip: {
      ...textScale.xs,
      color: colors.accentSoft,
      fontWeight: "600",
      letterSpacing: 0.4,
      marginTop: 2,
    },
    cardRating: { ...textScale.xs, color: colors.star, marginTop: 3 },

    // Separator between days
    daySeparator: {
      height: 1,
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
    emptyIcon:  { fontSize: 48, marginBottom: spacingScale.base },
    emptyTitle: {
      fontSize: 20,
      fontFamily: fonts.serifSemiBold,
      fontWeight: "600",
      color: colors.textPrimary,
      marginBottom: spacingScale.sm,
    },
    emptyHint:  { ...textScale.md, color: colors.textTertiary, textAlign: "center" },
  });
}

type Styles = ReturnType<typeof createStyles>;

// ── components ────────────────────────────────────────────────────────────────

function EntryCard({ item, styles }: { item: DayEntry; styles: Styles }) {
  const router = useRouter();
  const { entry, tripTitle } = item;
  const v = view(entry);
  const icon = kindIcon(entry);

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={() => router.push(`/entry/${entry.id}`)}
    >
      <Text style={styles.cardIcon}>{icon}</Text>
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {entryTitle(v)}
        </Text>
        {tripTitle && (
          <Text style={styles.cardTrip} numberOfLines={1}>
            {"◆"} {tripTitle}
          </Text>
        )}
        {v.rating !== undefined && (
          <Text style={styles.cardRating}>
            {"★".repeat(Math.round(v.rating / 2))}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

function DayGroupRow({ group, styles }: { group: DayGroup; styles: Styles }) {
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
        {group.items.map((item) => (
          <EntryCard key={item.entry.id} item={item} styles={styles} />
        ))}
      </View>
    </View>
  );
}

// ── screen ───────────────────────────────────────────────────────────────────

export default function ChronicleScreen() {
  const journal = useJournal();
  const { colors, fonts } = useTheme();
  const styles = useMemo(() => createStyles(colors, fonts), [colors, fonts]);

  const groups = useMemo<DayGroup[]>(() => {
    const entries = allEntries(journal).sort((a, b) =>
      b.start.localeCompare(a.start)
    );
    const tripMap = new Map(journal.trips.map((t) => [t.id, t.title]));

    const byDay = new Map<string, DayEntry[]>();
    for (const e of entries) {
      const day = e.start.slice(0, 10);
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day)!.push({
        entry: e,
        tripTitle: e.tripId ? tripMap.get(e.tripId) : undefined,
      });
    }
    return [...byDay.entries()].map(([iso, items]) => ({ iso, items }));
  }, [journal]);

  if (!groups.length) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyIcon}>📖</Text>
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
      renderItem={({ item }) => <DayGroupRow group={item} styles={styles} />}
      ItemSeparatorComponent={() => <View style={styles.daySeparator} />}
      contentContainerStyle={styles.content}
    />
  );
}
