/**
 * Trip detail screen — trip header + all linked entries in date order.
 * Suggestions section shows unassigned entries that fall within the trip's date range.
 */
import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useJournal, allEntries, putMany, storeFor } from "@chronicle/journal/db";
import { entryTitle, view, type Entry, type Trip } from "@chronicle/journal/types";

// ── helpers ───────────────────────────────────────────────────────────────────

function fmt(date: string): string {
  const [y, m, d] = date.slice(0, 10).split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${parseInt(d)} ${months[parseInt(m) - 1]} ${y}`;
}

function nights(trip: Trip): number {
  return Math.max(0, Math.round((+new Date(trip.end) - +new Date(trip.start)) / 86_400_000));
}

function entryEmoji(e: Entry): string {
  if (e.kind === "leg") return e.mode === "air" ? "✈️" : e.mode === "rail" ? "🚂" : "🚗";
  if (e.kind === "stay") return "🏨";
  if (e.kind === "film") return "🎬";
  if (e.kind === "episode") return "📺";
  if (e.kind === "book") return "📖";
  const cat = (e as Extract<Entry, { kind: "event" }>).category;
  return cat === "concert" ? "🎵" : cat === "celebration" ? "🎉" : cat === "milestone" ? "🏆" : "📍";
}

const PURPOSE_ICON: Record<string, string> = {
  leisure: "🌴", work: "💼", family: "👨‍👩‍👧", other: "📌",
};

// ── components ────────────────────────────────────────────────────────────────

function EntryItem({ entry, onPress }: { entry: Entry; onPress: () => void }) {
  const v = view(entry);
  return (
    <Pressable
      style={({ pressed }) => [styles.entryRow, pressed && styles.entryRowPressed]}
      onPress={onPress}
    >
      <Text style={styles.entryEmoji}>{entryEmoji(entry)}</Text>
      <View style={styles.entryBody}>
        <Text style={styles.entryTitle} numberOfLines={1}>{entryTitle(v)}</Text>
        <Text style={styles.entryDate}>{entry.start.slice(0, 10)}</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

function SuggestionItem({
  entry,
  onAdd,
  adding,
}: {
  entry: Entry;
  onAdd: () => void;
  adding: boolean;
}) {
  const v = view(entry);
  return (
    <View style={styles.suggestionRow}>
      <Text style={styles.entryEmoji}>{entryEmoji(entry)}</Text>
      <View style={styles.entryBody}>
        <Text style={styles.entryTitle} numberOfLines={1}>{entryTitle(v)}</Text>
        <Text style={styles.entryDate}>{entry.start.slice(0, 10)}</Text>
      </View>
      <Pressable
        style={[styles.addBtn, adding && styles.addBtnDisabled]}
        onPress={onAdd}
        disabled={adding}
      >
        {adding
          ? <ActivityIndicator size="small" color="#6366f1" />
          : <Text style={styles.addBtnText}>+ Add</Text>
        }
      </Pressable>
    </View>
  );
}

// ── screen ────────────────────────────────────────────────────────────────────

export default function TripDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const journal = useJournal();
  const router = useRouter();

  const [addingAll, setAddingAll] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);

  const trip = useMemo<Trip | undefined>(
    () => journal.trips.find((t) => t.id === id),
    [journal, id]
  );

  const entries = useMemo<Entry[]>(() => {
    if (!trip) return [];
    return allEntries(journal)
      .filter((e) => e.tripId === trip.id)
      .sort((a, b) => a.start.localeCompare(b.start));
  }, [journal, trip]);

  // Unassigned entries whose start date falls within the trip's date window
  const suggestions = useMemo<Entry[]>(() => {
    if (!trip) return [];
    return allEntries(journal)
      .filter((e) => !e.tripId && e.start.slice(0, 10) >= trip.start && e.start.slice(0, 10) <= trip.end)
      .sort((a, b) => a.start.localeCompare(b.start));
  }, [journal, trip]);

  if (!trip) {
    return (
      <View style={styles.notFound}>
        <Stack.Screen options={{ title: "Trip" }} />
        <Text style={styles.notFoundText}>Trip not found</Text>
      </View>
    );
  }

  const n = nights(trip);

  const addEntry = async (entry: Entry) => {
    setAddingId(entry.id);
    try {
      await putMany(storeFor(entry), [{ ...entry, tripId: trip.id }]);
    } catch (err) {
      Alert.alert("Failed to add entry", String(err));
    } finally {
      setAddingId(null);
    }
  };

  const addAll = async () => {
    if (!suggestions.length) return;
    setAddingAll(true);
    try {
      for (const e of suggestions) {
        await putMany(storeFor(e), [{ ...e, tripId: trip.id }]);
      }
    } catch (err) {
      Alert.alert("Failed to add entries", String(err));
    } finally {
      setAddingAll(false);
    }
  };

  // Combined list: linked entries + divider + suggestions
  type ListItem =
    | { kind: "entry"; entry: Entry }
    | { kind: "divider" }
    | { kind: "suggestion"; entry: Entry };

  const listData: ListItem[] = [
    ...entries.map((e) => ({ kind: "entry" as const, entry: e })),
    ...(suggestions.length > 0 ? [{ kind: "divider" as const }] : []),
    ...suggestions.map((e) => ({ kind: "suggestion" as const, entry: e })),
  ];

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.content}
      data={listData}
      keyExtractor={(item, i) =>
        item.kind === "divider" ? "divider" : item.entry.id
      }
      renderItem={({ item }) => {
        if (item.kind === "entry") {
          return <EntryItem entry={item.entry} onPress={() => router.push(`/entry/${item.entry.id}`)} />;
        }
        if (item.kind === "divider") {
          return (
            <View style={styles.suggestionsHeader}>
              <Text style={styles.sectionLabel}>
                Suggested ({suggestions.length})
              </Text>
              <Pressable
                style={[styles.addAllBtn, addingAll && styles.addAllBtnDisabled]}
                onPress={addAll}
                disabled={addingAll}
              >
                {addingAll
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={styles.addAllText}>Add all</Text>
                }
              </Pressable>
            </View>
          );
        }
        return (
          <SuggestionItem
            entry={item.entry}
            onAdd={() => addEntry(item.entry)}
            adding={addingId === item.entry.id}
          />
        );
      }}
      ListHeaderComponent={
        <>
          <Stack.Screen
            options={{
              title: "",
              headerStyle: { backgroundColor: "#1e293b" },
              headerTintColor: "#f8fafc",
              headerShadowVisible: false,
            }}
          />
          {/* Trip header card */}
          <View style={styles.headerCard}>
            <View style={styles.headerTop}>
              <Text style={styles.dateRange}>{fmt(trip.start)} → {fmt(trip.end)}</Text>
              {trip.purpose && (
                <Text style={styles.purposeIcon}>{PURPOSE_ICON[trip.purpose] ?? "📌"}</Text>
              )}
            </View>
            <Text style={styles.tripTitle}>{trip.title}</Text>
            <View style={styles.tripMeta}>
              <Text style={styles.tripMetaText}>{n} {n === 1 ? "night" : "nights"}</Text>
              <Text style={styles.tripMetaDot}>·</Text>
              <Text style={styles.tripMetaText}>{entries.length} {entries.length === 1 ? "entry" : "entries"}</Text>
            </View>
            {trip.notes ? <Text style={styles.tripNotes}>{trip.notes}</Text> : null}
          </View>

          {entries.length > 0 && (
            <Text style={styles.sectionLabel}>Entries</Text>
          )}
        </>
      }
      ListEmptyComponent={
        suggestions.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No entries linked or suggested for this trip.</Text>
          </View>
        ) : null
      }
    />
  );
}

// ── styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: "#0f172a" },
  content: { padding: 16, paddingBottom: 48 },

  headerCard: {
    backgroundColor: "#1e293b",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#334155",
    padding: 20,
    marginBottom: 20,
  },
  headerTop: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  dateRange: { color: "#64748b", fontSize: 12, fontFamily: "monospace" },
  purposeIcon: { fontSize: 18 },
  tripTitle: { color: "#f1f5f9", fontSize: 22, fontWeight: "700", marginBottom: 8 },
  tripMeta: { flexDirection: "row", gap: 6, marginBottom: 4 },
  tripMetaText: { color: "#94a3b8", fontSize: 13 },
  tripMetaDot: { color: "#475569", fontSize: 13 },
  tripNotes: { color: "#94a3b8", fontSize: 14, marginTop: 10, lineHeight: 20 },

  sectionLabel: {
    color: "#64748b",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 8,
  },

  suggestionsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
    marginBottom: 8,
  },
  addAllBtn: {
    backgroundColor: "#4f46e5",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
    minWidth: 72,
    alignItems: "center",
  },
  addAllBtnDisabled: { opacity: 0.5 },
  addAllText: { color: "#fff", fontSize: 12, fontWeight: "700" },

  entryRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1e293b",
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    gap: 12,
    borderWidth: 1,
    borderColor: "#334155",
  },
  entryRowPressed: { opacity: 0.7 },

  suggestionRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1e293b",
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    gap: 12,
    borderWidth: 1,
    borderColor: "#1e3a5f",  // slightly blue tint to distinguish from linked
  },

  entryEmoji: { fontSize: 18 },
  entryBody: { flex: 1 },
  entryTitle: { color: "#f1f5f9", fontSize: 14, fontWeight: "500", marginBottom: 2 },
  entryDate: { color: "#64748b", fontSize: 12 },
  chevron: { color: "#334155", fontSize: 20 },

  addBtn: {
    borderWidth: 1,
    borderColor: "#6366f1",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    minWidth: 64,
    alignItems: "center",
  },
  addBtnDisabled: { opacity: 0.5 },
  addBtnText: { color: "#818cf8", fontSize: 12, fontWeight: "700" },

  empty: { paddingTop: 24, alignItems: "center" },
  emptyText: { color: "#475569", fontSize: 14 },

  notFound: { flex: 1, backgroundColor: "#0f172a", alignItems: "center", justifyContent: "center" },
  notFoundText: { color: "#64748b", fontSize: 16 },
});
