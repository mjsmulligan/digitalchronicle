/**
 * Person detail screen — profile card + all shared entries grouped by day
 * in the two-column journal layout.
 */
import { useMemo } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useJournal, allEntries } from "@chronicle/journal/db";
import { entryTitle, view, type Entry, type Person } from "@chronicle/journal/types";
import { useTheme, type ThemeColors, type ThemeFonts, text as textScale, spacing as spacingScale, radius as radiusScale } from "../../src/components/ThemeProvider";

// ── helpers ───────────────────────────────────────────────────────────────────

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

function entryEmoji(e: Entry): string {
  if (e.kind === "leg") return e.mode === "air" ? "✈️" : e.mode === "rail" ? "🚆" : "🚗";
  if (e.kind === "stay") return "🏨";
  if (e.kind === "film") return "🎬";
  if (e.kind === "episode") return "📺";
  if (e.kind === "book") return "📖";
  const cat = (e as Extract<Entry, { kind: "event" }>).category;
  return cat === "concert" ? "🎵" : cat === "celebration" ? "🎉" : cat === "milestone" ? "🏆" : "📍";
}

// ── data ──────────────────────────────────────────────────────────────────────

interface DayGroup {
  iso: string;
  items: Entry[];
}

function groupByDay(entries: Entry[]): DayGroup[] {
  const map = new Map<string, Entry[]>();
  for (const e of entries) {
    const day = e.start.slice(0, 10);
    if (!map.has(day)) map.set(day, []);
    map.get(day)!.push(e);
  }
  return [...map.entries()].map(([iso, items]) => ({ iso, items }));
}

// ── styles factory ────────────────────────────────────────────────────────────

const DATE_COL_W = 52;

function createStyles(colors: ThemeColors, fonts: ThemeFonts) {
  return StyleSheet.create({
    list: { flex: 1, backgroundColor: colors.bg },
    content: { paddingBottom: spacingScale["3xl"] },

    // Profile card
    profileCard: {
      backgroundColor: colors.surface,
      borderRadius: radiusScale["2xl"],
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacingScale.lg,
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacingScale.base,
      margin: spacingScale.base,
      marginBottom: spacingScale.sm,
    },
    avatar: {
      width: 56,
      height: 56,
      borderRadius: radiusScale.full,
      backgroundColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarSelf: { backgroundColor: colors.surfaceAccent },
    avatarText: { color: colors.textDim, fontSize: 18, fontWeight: "700" },
    profileBody: { flex: 1 },
    nameRow: { flexDirection: "row", alignItems: "center", gap: spacingScale.sm, marginBottom: 4 },
    name: {
      fontSize: 20,
      fontFamily: fonts.serifBold,
      fontWeight: "700",
      color: colors.textPrimary,
    },
    selfBadge: {
      color: colors.accentBadge,
      fontSize: 10,
      fontWeight: "700",
      backgroundColor: colors.surfaceAccentDeep,
      paddingHorizontal: spacingScale.sm2,
      paddingVertical: 2,
      borderRadius: radiusScale.sm,
      overflow: "hidden",
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    aliases: { ...textScale.smMd, color: colors.textTertiary, marginBottom: 4 },
    notes: { ...textScale.md, color: colors.textSecondary, marginTop: 4 },

    sectionLabel: {
      ...textScale.label,
      fontFamily: fonts.mono,
      color: colors.textTertiary,
      paddingHorizontal: spacingScale.base,
      paddingTop: spacingScale.md,
      marginBottom: 0,
    },

    // Two-column layout
    dayGroup: {
      flexDirection: "row",
      paddingHorizontal: spacingScale.base,
      paddingTop: spacingScale.xl,
      paddingBottom: spacingScale.sm,
    },
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
    dateRule: {
      width: 1,
      alignSelf: "stretch",
      backgroundColor: colors.border,
      marginHorizontal: spacingScale.md,
      marginTop: 4,
    },
    cardsCol: { flex: 1, gap: spacingScale.sm },

    card: {
      backgroundColor: colors.surface,
      borderRadius: radiusScale.lg,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacingScale.md2,
      paddingVertical: spacingScale.md,
      flexDirection: "row",
      alignItems: "center",
      gap: spacingScale.sm,
    },
    cardPressed: { opacity: 0.65 },
    cardIcon:    { fontSize: 18 },
    cardTitle:   { flex: 1, ...textScale.feedTitle, fontFamily: fonts.serifMedium, color: colors.textPrimary, fontWeight: "500" },
    cardChevron: { fontSize: 20, color: colors.border },

    daySeparator: {
      height: 1,
      backgroundColor: colors.borderFaint,
      marginHorizontal: spacingScale.base,
    },

    empty: { paddingTop: spacingScale.xl, paddingHorizontal: spacingScale.base, alignItems: "center" },
    emptyText: { ...textScale.md, color: colors.textMuted },

    notFound: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
    notFoundText: { ...textScale.lg, color: colors.textTertiary },
  });
}

type Styles = ReturnType<typeof createStyles>;

// ── components ────────────────────────────────────────────────────────────────

function EntryCard({ entry, styles }: { entry: Entry; styles: Styles }) {
  const router = useRouter();
  const v = view(entry);
  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={() => router.push(`/entry/${entry.id}`)}
    >
      <Text style={styles.cardIcon}>{entryEmoji(entry)}</Text>
      <Text style={styles.cardTitle} numberOfLines={2}>{entryTitle(v)}</Text>
      <Text style={styles.cardChevron}>{"›"}</Text>
    </Pressable>
  );
}

function DayGroupRow({ group, styles }: { group: DayGroup; styles: Styles }) {
  const { num, day, month, year } = parseDay(group.iso);
  return (
    <View style={styles.dayGroup}>
      <View style={styles.dateCol}>
        <Text style={styles.dateNum}>{num}</Text>
        <Text style={styles.dateSub}>{day}</Text>
        <Text style={styles.dateSub}>{month}</Text>
        <Text style={styles.dateSub}>{year}</Text>
      </View>
      <View style={styles.dateRule} />
      <View style={styles.cardsCol}>
        {group.items.map((e) => <EntryCard key={e.id} entry={e} styles={styles} />)}
      </View>
    </View>
  );
}

// ── screen ────────────────────────────────────────────────────────────────────

export default function PersonDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const journal = useJournal();
  const { colors, fonts, common } = useTheme();
  const styles = useMemo(() => createStyles(colors, fonts), [colors, fonts]);

  const person = useMemo<Person | undefined>(
    () => journal.people.find((p) => p.id === id),
    [journal, id]
  );

  const groups = useMemo<DayGroup[]>(() => {
    if (!person) return [];
    const matched = allEntries(journal)
      .filter((e) => e.participants?.includes(person.id))
      .sort((a, b) => b.start.localeCompare(a.start));
    return groupByDay(matched);
  }, [journal, person]);

  if (!person) {
    return (
      <View style={styles.notFound}>
        <Stack.Screen options={{ title: "Person", ...common.header }} />
        <Text style={styles.notFoundText}>Person not found</Text>
      </View>
    );
  }

  const initials = person.name
    .split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  const totalEntries = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <FlatList
      style={styles.list}
      data={groups}
      keyExtractor={(g) => g.iso}
      renderItem={({ item }) => <DayGroupRow group={item} styles={styles} />}
      ItemSeparatorComponent={() => <View style={styles.daySeparator} />}
      ListHeaderComponent={
        <>
          <Stack.Screen options={{ title: "", ...common.header }} />

          {/* Profile card */}
          <View style={styles.profileCard}>
            <View style={[styles.avatar, person.isSelf && styles.avatarSelf]}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
            <View style={styles.profileBody}>
              <View style={styles.nameRow}>
                <Text style={styles.name}>{person.name}</Text>
                {person.isSelf && <Text style={styles.selfBadge}>you</Text>}
              </View>
              {person.aliases?.length ? (
                <Text style={styles.aliases}>{person.aliases.join(", ")}</Text>
              ) : null}
              {person.notes ? (
                <Text style={styles.notes}>{person.notes}</Text>
              ) : null}
            </View>
          </View>

          {totalEntries > 0 && (
            <Text style={styles.sectionLabel}>
              {totalEntries} shared {totalEntries === 1 ? "entry" : "entries"}
            </Text>
          )}
        </>
      }
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No shared entries yet.</Text>
        </View>
      }
      contentContainerStyle={styles.content}
    />
  );
}
