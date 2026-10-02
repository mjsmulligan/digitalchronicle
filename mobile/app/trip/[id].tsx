/**
 * Trip detail screen — trip header + all linked entries in date order.
 * Suggestions section shows unassigned entries that fall within the trip's date range.
 */
import { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useDialog, Dialog } from "../../src/components/Dialog";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useJournal, allEntries, putMany, storeFor } from "@chronicle/journal/db";
import { entryTitle, view, type Entry, type Trip } from "@chronicle/journal/types";
import { colors, fonts, text, spacing, radius, common } from "../../src/theme";

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
  if (e.kind === "leg") return e.mode === "air" ? "✈️" : e.mode === "rail" ? "🚆" : "🚗";
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
          ? <ActivityIndicator size="small" color={colors.accent} />
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
  const dialog = useDialog();

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
      dialog.alert("Failed to add entry", String(err));
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
      dialog.alert("Failed to add entries", String(err));
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
    <>
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
                  ? <ActivityIndicator size="small" color={colors.white} />
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
          <Stack.Screen options={{ title: "", ...common.header }} />
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
    <Dialog {...dialog.props} onDismiss={dialog.dismiss} />
    </>
  );
}

// ── styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.base, paddingBottom: spacing["3xl"] },

  headerCard: {
    backgroundColor: colors.surface,
    borderRadius: radius["2xl"],
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  headerTop: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  dateRange: { ...text.sm, color: colors.textTertiary, fontFamily: "monospace" },
  purposeIcon: { fontSize: 18 },
  tripTitle: { fontSize: 22, fontFamily: fonts.serifBold, fontWeight: "700", color: colors.textPrimary, marginBottom: spacing.sm },
  tripMeta: { flexDirection: "row", gap: spacing.sm2, marginBottom: 4 },
  tripMetaText: { ...text.smMd, color: colors.textSecondary },
  tripMetaDot: { ...text.smMd, color: colors.textMuted },
  tripNotes: { ...text.md, color: colors.textSecondary, marginTop: 10 },

  sectionLabel: { ...text.label, color: colors.textTertiary, marginBottom: spacing.sm },

  suggestionsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  addAllBtn: {
    backgroundColor: colors.accentBold,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md2,
    paddingVertical: spacing.sm2,
    minWidth: 72,
    alignItems: "center",
  },
  addAllBtnDisabled: { opacity: 0.5 },
  addAllText: { color: colors.white, fontSize: 12, fontWeight: "700" },

  entryRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md2,
    marginBottom: spacing.sm,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  entryRowPressed: { opacity: 0.7 },

  suggestionRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md2,
    marginBottom: spacing.sm,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },

  entryEmoji: { fontSize: 18 },
  entryBody: { flex: 1 },
  entryTitle: { ...text.md, color: colors.textPrimary, fontWeight: "500", marginBottom: 2 },
  entryDate: { ...text.sm, color: colors.textTertiary },
  chevron: { fontSize: 20, color: colors.border },

  addBtn: {
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm2,
    minWidth: 64,
    alignItems: "center",
  },
  addBtnDisabled: { opacity: 0.5 },
  addBtnText: { color: colors.accentSoft, fontSize: 12, fontWeight: "700" },

  empty: { paddingTop: spacing.xl, alignItems: "center" },
  emptyText: { ...text.md, color: colors.textMuted },

  notFound: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  notFoundText: { ...text.lg, color: colors.textTertiary },
});
