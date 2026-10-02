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
import { colors, text, spacing, radius } from "../../src/theme";

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
  rowTitle: { ...text.base, color: colors.textPrimary, fontWeight: "500", marginBottom: 3 },
  rowSub: { ...text.sm, color: colors.textTertiary },
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
