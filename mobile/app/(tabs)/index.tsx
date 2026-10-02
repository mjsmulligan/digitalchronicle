/**
 * Chronicle tab — chronological feed of all entry kinds.
 * Mirrors the web / route: all entries sorted newest-first, grouped by day.
 */
import { useMemo } from "react";
import {
  FlatList,
  SectionList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useJournal, allEntries } from "@chronicle/journal/db";
import { entryTitle, view, type Entry } from "@chronicle/journal/types";

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
  return (
    <View style={styles.row}>
      <Text style={styles.rowEmoji}>{kindLabel(entry)}</Text>
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {entryTitle(v)}
        </Text>
        {v.rating !== undefined && (
          <Text style={styles.rowMeta}>{"★".repeat(Math.round(v.rating / 2))}</Text>
        )}
      </View>
    </View>
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
          Import a CSV or ICS file on the web to start your Chronicle.
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
  list: { flex: 1, backgroundColor: "#0f172a" },
  sectionHeader: {
    backgroundColor: "#0f172a",
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 4,
  },
  sectionTitle: {
    color: "#64748b",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#1e293b",
    gap: 12,
  },
  rowEmoji: { fontSize: 18, lineHeight: 24 },
  rowBody: { flex: 1 },
  rowTitle: { color: "#f1f5f9", fontSize: 15, fontWeight: "500" },
  rowMeta: { color: "#f59e0b", fontSize: 12, marginTop: 2 },
  empty: {
    flex: 1,
    backgroundColor: "#0f172a",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyTitle: { color: "#f1f5f9", fontSize: 18, fontWeight: "600", marginBottom: 8 },
  emptyHint: { color: "#64748b", fontSize: 14, textAlign: "center", lineHeight: 20 },
});
