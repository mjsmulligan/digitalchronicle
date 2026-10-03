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
import { colors, fonts, text, spacing, radius } from "../../src/theme";

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

function cultureEmoji(e: CultureEntry): string {
  if (e.kind === "film") return "🎬";
  if (e.kind === "episode") return "📺";
  if (e.kind === "book") return "📖";
  return "🎵";
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

// ── components ────────────────────────────────────────────────────────────────

function FilterPill({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
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

function EntryCard({ entry }: { entry: CultureEntry }) {
  const router = useRouter();
  const v = view(entry);
  const stars =
    v.rating !== undefined ? "★".repeat(Math.round(v.rating / 2)) : undefined;

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={() => router.push(`/entry/${entry.id}`)}
    >
      <Text style={styles.cardIcon}>{cultureEmoji(entry)}</Text>
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {cultureTitle(entry)}
        </Text>
        {stars && <Text style={styles.cardStars}>{stars}</Text>}
      </View>
    </Pressable>
  );
}

function DayGroupRow({ group }: { group: DayGroup }) {
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
          <EntryCard key={entry.id} entry={entry} />
        ))}
      </View>
    </View>
  );
}

// ── screen ───────────────────────────────────────────────────────────────────

export default function CultureScreen() {
  const journal = useJournal();
  const [filter, setFilter] = useState<Filter>("all");

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
          />
        ))}
      </ScrollView>

      {!groups.length ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>🎬</Text>
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
          renderItem={({ item }) => <DayGroupRow group={item} />}
          ItemSeparatorComponent={() => <View style={styles.daySeparator} />}
          contentContainerStyle={styles.listContent}
        />
      )}
    </View>
  );
}

// ── styles ────────────────────────────────────────────────────────────────────

const DATE_COL_W = 52;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  list: { flex: 1 },
  listContent: { paddingBottom: spacing["3xl"] },

  // Filter pills
  pills: { flexGrow: 0, borderBottomWidth: 1, borderBottomColor: colors.borderFaint },
  pillsContent: { padding: spacing.md, gap: spacing.sm, flexDirection: "row" },
  pill: {
    paddingHorizontal: spacing.md2,
    paddingVertical: spacing.sm2,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pillActive: { backgroundColor: colors.surfaceAccent, borderColor: colors.accent },
  pillText: { ...text.smMd, color: colors.textSecondary, fontWeight: "600" },
  pillTextActive: { color: colors.accentSubtle },

  // Day group row
  dayGroup: {
    flexDirection: "row",
    paddingHorizontal: spacing.base,
    paddingTop: spacing.xl,
    paddingBottom: spacing.sm,
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

  // Vertical rule
  dateRule: {
    width: 1,
    alignSelf: "stretch",
    backgroundColor: colors.border,
    marginHorizontal: spacing.md,
    marginTop: 4,
  },

  // Entries column
  entriesCol: {
    flex: 1,
    gap: spacing.sm,
  },

  // Entry card
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md2,
    paddingVertical: spacing.md,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  cardPressed: { opacity: 0.65 },
  cardIcon: { fontSize: 18, lineHeight: 24, marginTop: 1 },
  cardBody: { flex: 1 },
  cardTitle: {
    ...text.base,
    color: colors.textPrimary,
    fontWeight: "500",
    marginBottom: 3,
  },
  cardStars: { ...text.xs, color: colors.star, marginTop: 2 },

  // Separator between days
  daySeparator: {
    height: 1,
    backgroundColor: colors.borderFaint,
    marginHorizontal: spacing.base,
  },

  // Empty state
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing["2xl"],
  },
  emptyIcon: { fontSize: 48, marginBottom: spacing.base },
  emptyTitle: {
    fontSize: 18,
    fontFamily: fonts.serifSemiBold,
    fontWeight: "600",
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  emptyHint: { ...text.md, color: colors.textTertiary, textAlign: "center" },
});
