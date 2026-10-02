/**
 * Chronicle tab — chronological feed of all entry kinds.
 * Mirrors the web / route: all entries sorted newest-first, grouped by day.
 */
import { useMemo } from "react";
import {
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useJournal, allEntries } from "@chronicle/journal/db";
import { entryTitle, view, type Entry } from "@chronicle/journal/types";
import { colors, text, spacing } from "../../src/theme";

// ── helpers ──────────────────────────────────────────────────────────────────

function kindLabel(e: Entry): string {
  if (e.kind === "leg") return e.mode === "air" ? "✈️" : e.mode === "rail" ? "🚂" : "🚗";
  if (e.kind === "stay") return "🏨";
  if (e.kind === "film") return "🎬";
  if (e.kind === "episode") return "📺";
  if (e.kind === "book") return "📖";
  const cat = (e as Extract<Entry, { kind: "event" }>).category;
  if (cat === "concert") return "🎵";
  if (cat === "celebration") return "🎉";
  if (cat === "milestone") return "🏆";
  return "📍";
}

interface DaySection {
  title: string;
  data: Entry[];
}

// ── components ────────────────────────────────────────────────────────────────

function EntryRow({ entry }: { entry: Entry }) {
  const v = view(entry);
  const router = useRouter();
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={() => router.push(`/entry/${entry.id}`)}
    >
      <Text style={styles.rowEmoji}>{kindLabel(entry)}</Text>
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {entryTitle(v)}
        </Text>
        {v.rating !== undefined && (
          <Text style={styles.rowMeta}>{"★".repeat(Math.round(v.rating / 2))}</Text>
        )}
      </View>
      <Text style={styles.rowChevron}>›</Text>
    </Pressable>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );
}

// ── screen ───────────────────────────────────────────────────────────────────

export default function ChronicleScreen() {
  const journal = useJournal();

  const sections = useMemo<DaySection[]>(() => {
    const entries = allEntries(journal).sort((a, b) =>
      b.start.localeCompare(a.start)
    );
    const byDay = new Map<string, Entry[]>();
    for (const e of entries) {
      const day = e.start.slice(0, 10);
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day)!.push(e);
    }
    return [...byDay.entries()].map(([day, data]) => ({ title: day, data }));
  }, [journal]);

  if (!sections.length) {
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
    <SectionList
      style={styles.list}
      sections={sections}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <EntryRow entry={item} />}
      renderSectionHeader={({ section }) => (
        <SectionHeader title={section.title} />
      )}
      stickySectionHeadersEnabled
    />
  );
}

// ── styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: colors.bg },
  sectionHeader: {
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.base,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
  },
  sectionTitle: { ...text.label, color: colors.textTertiary },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: spacing.base,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderFaint,
    gap: spacing.md,
  },
  rowPressed: { backgroundColor: colors.surface },
  rowEmoji: { fontSize: 18, lineHeight: 24 },
  rowBody: { flex: 1 },
  rowTitle: { ...text.base, color: colors.textPrimary, fontWeight: "500" },
  rowMeta: { ...text.sm, color: colors.star, marginTop: 2 },
  rowChevron: { fontSize: 20, lineHeight: 24, color: colors.border },
  empty: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing["2xl"],
  },
  emptyIcon: { fontSize: 48, marginBottom: spacing.base },
  emptyTitle: { fontSize: 18, fontWeight: "600", color: colors.textPrimary, marginBottom: spacing.sm },
  emptyHint: { ...text.md, color: colors.textTertiary, textAlign: "center" },
});
