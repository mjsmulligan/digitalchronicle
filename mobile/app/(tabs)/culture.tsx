/**
 * Culture tab — films, TV episodes, books, and concerts sorted newest-first.
 * Filter pills mirror the web culture view.
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
import { colors, text, spacing, radius } from "../../src/theme";

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

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "film", label: "Films" },
  { id: "episode", label: "TV" },
  { id: "book", label: "Books" },
  { id: "concert", label: "Concerts" },
];

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

function CultureRow({ entry }: { entry: CultureEntry }) {
  const v = view(entry);
  const router = useRouter();
  const stars =
    v.rating !== undefined
      ? "★".repeat(Math.round(v.rating / 2)) +
        "☆".repeat(5 - Math.round(v.rating / 2))
      : null;
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={() => router.push(`/entry/${entry.id}`)}
    >
      <Text style={styles.rowEmoji}>{cultureEmoji(entry)}</Text>
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={2}>
          {cultureTitle(entry)}
        </Text>
        <View style={styles.rowMeta}>
          <Text style={styles.rowDate}>{v.start.slice(0, 10)}</Text>
          {stars && <Text style={styles.rowStars}>{stars}</Text>}
        </View>
      </View>
      <Text style={styles.rowChevron}>›</Text>
    </Pressable>
  );
}

// ── screen ───────────────────────────────────────────────────────────────────

export default function CultureScreen() {
  const journal = useJournal();
  const [filter, setFilter] = useState<Filter>("all");

  const entries = useMemo<CultureEntry[]>(() => {
    const all = [
      ...journal.films,
      ...journal.episodes,
      ...journal.books,
      ...journal.events.filter(
        (e) => (e as JEvent).category === "concert"
      ),
    ].filter(isCulture);

    const filtered =
      filter === "all"
        ? all
        : filter === "concert"
        ? all.filter((e) => e.kind === "event")
        : all.filter((e) => e.kind === filter);

    return filtered.sort((a, b) => b.start.localeCompare(a.start));
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

      {/* Results */}
      {!entries.length ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>🎬</Text>
          <Text style={styles.emptyTitle}>Nothing here yet</Text>
          <Text style={styles.emptyHint}>
            Import Letterboxd, Netflix, or Goodreads data to populate Culture.
          </Text>
        </View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(e) => e.id}
          renderItem={({ item }) => <CultureRow entry={item} />}
          contentContainerStyle={styles.listContent}
        />
      )}
    </View>
  );
}

// ── styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
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
  listContent: { paddingVertical: spacing.sm },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderFaint,
    gap: spacing.md,
  },
  rowPressed: { backgroundColor: colors.surfacePressed },
  rowEmoji: { fontSize: 20, lineHeight: 26 },
  rowBody: { flex: 1 },
  rowTitle: { ...text.base, color: colors.textPrimary, fontWeight: "500", marginBottom: 4 },
  rowMeta: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  rowDate: { ...text.sm, color: colors.textTertiary },
  rowStars: { ...text.sm, color: colors.star },
  rowChevron: { fontSize: 20, lineHeight: 26, color: colors.border },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing["2xl"],
  },
  emptyIcon: { fontSize: 48, marginBottom: spacing.base },
  emptyTitle: { fontSize: 18, fontWeight: "600", color: colors.textPrimary, marginBottom: spacing.sm },
  emptyHint: { ...text.md, color: colors.textTertiary, textAlign: "center" },
});
