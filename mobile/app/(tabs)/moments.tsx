/**
 * Moments tab — gatherings, celebrations, milestones, memories, activities.
 * Excludes concerts (those live in Culture).
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
import { CATEGORY_LABEL, view, type JEvent, type EventCategory } from "@chronicle/journal/types";

// ── helpers ──────────────────────────────────────────────────────────────────

type MomentFilter = "all" | EventCategory;

const MOMENT_CATEGORIES: EventCategory[] = [
  "gathering",
  "celebration",
  "milestone",
  "memory",
  "activity",
];

const CATEGORY_EMOJI: Record<EventCategory, string> = {
  concert: "🎵",
  gathering: "👥",
  celebration: "🎉",
  milestone: "🏆",
  memory: "💭",
  activity: "🏃",
};

const FILTERS: { id: MomentFilter; label: string }[] = [
  { id: "all", label: "All" },
  ...MOMENT_CATEGORIES.map((c) => ({ id: c, label: CATEGORY_LABEL[c] })),
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

function MomentRow({ event }: { event: JEvent }) {
  const v = view(event) as JEvent;
  const router = useRouter();
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={() => router.push(`/entry/${event.id}`)}
    >
      <Text style={styles.rowEmoji}>{CATEGORY_EMOJI[v.category]}</Text>
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {v.artist}
        </Text>
        <Text style={styles.rowSub} numberOfLines={1}>
          {[v.venue, v.city].filter(Boolean).join(", ")} · {v.start.slice(0, 10)}
        </Text>
      </View>
      <Text style={styles.rowChevron}>›</Text>
    </Pressable>
  );
}

// ── screen ───────────────────────────────────────────────────────────────────

export default function MomentsScreen() {
  const journal = useJournal();
  const [filter, setFilter] = useState<MomentFilter>("all");

  const moments = useMemo(() => {
    return journal.events
      .filter((e): e is JEvent => e.category !== "concert")
      .filter((e) => filter === "all" || e.category === filter)
      .sort((a, b) => b.start.localeCompare(a.start));
  }, [journal, filter]);

  return (
    <View style={styles.container}>
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

      {!moments.length ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>💭</Text>
          <Text style={styles.emptyTitle}>No moments yet</Text>
          <Text style={styles.emptyHint}>
            Add events manually or import an iCalendar file.
          </Text>
        </View>
      ) : (
        <FlatList
          data={moments}
          keyExtractor={(e) => e.id}
          renderItem={({ item }) => <MomentRow event={item} />}
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
  rowTitle: { color: "#f1f5f9", fontSize: 15, fontWeight: "500", marginBottom: 3 },
  rowSub: { color: "#64748b", fontSize: 12 },
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
