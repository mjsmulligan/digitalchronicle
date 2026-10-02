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
  container: { flex: 1, backgroundColor: "#0f172a" },
  pills: { flexGrow: 0, borderBottomWidth: 1, borderBottomColor: "#1e293b" },
  pillsContent: { padding: 12, gap: 8, flexDirection: "row" },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: "#1e293b",
    borderWidth: 1,
    borderColor: "#334155",
  },
  pillActive: { backgroundColor: "#312e81", borderColor: "#6366f1" },
  pillText: { color: "#94a3b8", fontSize: 13, fontWeight: "600" },
  pillTextActive: { color: "#e0e7ff" },
  listContent: { paddingVertical: 8 },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#1e293b",
    gap: 12,
  },
  rowPressed: { backgroundColor: "#1a2535" },
  rowEmoji: { fontSize: 20, lineHeight: 26 },
  rowBody: { flex: 1 },
  rowTitle: { color: "#f1f5f9", fontSize: 15, fontWeight: "500", marginBottom: 4 },
  rowMeta: { flexDirection: "row", gap: 8, alignItems: "center" },
  rowDate: { color: "#64748b", fontSize: 12 },
  rowStars: { color: "#f59e0b", fontSize: 12 },
  rowChevron: { color: "#334155", fontSize: 20, lineHeight: 26 },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyTitle: { color: "#f1f5f9", fontSize: 18, fontWeight: "600", marginBottom: 8 },
  emptyHint: { color: "#64748b", fontSize: 14, textAlign: "center", lineHeight: 20 },
});
