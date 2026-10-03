/**
 * Trip detail screen — trip header + entries grouped by day in the
 * two-column journal layout. Suggestions (unlinked entries in the date range)
 * appear below with per-card and bulk "+ Add" actions.
 */
import { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useDialog, Dialog } from "../../src/components/Dialog";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useJournal, allEntries, putMany, storeFor } from "@chronicle/journal/db";
import { entryTitle, view, type Entry, type Trip } from "@chronicle/journal/types";
import { colors, fonts, text, spacing, radius, common } from "../../src/theme";

// ── helpers ───────────────────────────────────────────────────────────────────

const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun",
                      "Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTHS_FULL  = ["January","February","March","April","May","June",
                      "July","August","September","October","November","December"];
const DAYS_SHORT   = ["SUN","MON","TUE","WED","THU","FRI","SAT"];

function parseDay(iso: string) {
  const d = new Date(iso + "T12:00:00");
  return {
    num:   d.getDate().toString(),
    day:   DAYS_SHORT[d.getDay()],
    month: MONTHS_SHORT[d.getMonth()].toUpperCase(),
    year:  d.getFullYear().toString(),
  };
}

function fmt(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  return `${d.getDate()} ${MONTHS_FULL[d.getMonth()]} ${d.getFullYear()}`;
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

function groupByDay(entries: Entry[]): DayGroup[] {
  const map = new Map<string, Entry[]>();
  for (const e of entries) {
    const day = e.start.slice(0, 10);
    if (!map.has(day)) map.set(day, []);
    map.get(day)!.push(e);
  }
  return [...map.entries()].map(([iso, items]) => ({ iso, items }));
}

const PURPOSE_ICON: Record<string, string> = {
  leisure: "🌴", work: "💼", family: "👨‍👩‍👧", other: "📌",
};

// ── data ──────────────────────────────────────────────────────────────────────

interface DayGroup {
  iso: string;
  items: Entry[];
}

// ── components ────────────────────────────────────────────────────────────────

/** A single entry card inside a day group — taps to entry detail */
function EntryCard({ entry }: { entry: Entry }) {
  const router = useRouter();
  const v = view(entry);
  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={() => router.push(`/entry/${entry.id}`)}
    >
      <Text style={styles.cardIcon}>{entryEmoji(entry)}</Text>
      <Text style={styles.cardTitle} numberOfLines={2}>{entryTitle(v)}</Text>
      <Text style={styles.cardChevron}>›</Text>
    </Pressable>
  );
}

/** A suggestion card — shows "+ Add" button instead of chevron */
function SuggestionCard({
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
    <View style={[styles.card, styles.cardSuggestion]}>
      <Text style={styles.cardIcon}>{entryEmoji(entry)}</Text>
      <Text style={styles.cardTitle} numberOfLines={2}>{entryTitle(v)}</Text>
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

/** Two-column date row for linked entries */
function EntryDayGroup({ group }: { group: DayGroup }) {
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
        {group.items.map((e) => <EntryCard key={e.id} entry={e} />)}
      </View>
    </View>
  );
}

/** Two-column date row for suggested (unlinked) entries */
function SuggestionDayGroup({
  group,
  addingId,
  onAdd,
}: {
  group: DayGroup;
  addingId: string | null;
  onAdd: (entry: Entry) => void;
}) {
  const { num, day, month, year } = parseDay(group.iso);
  return (
    <View style={styles.dayGroup}>
      <View style={styles.dateCol}>
        <Text style={[styles.dateNum, styles.dateNumDim]}>{num}</Text>
        <Text style={styles.dateSub}>{day}</Text>
        <Text style={styles.dateSub}>{month}</Text>
        <Text style={styles.dateSub}>{year}</Text>
      </View>
      <View style={styles.dateRule} />
      <View style={styles.cardsCol}>
        {group.items.map((e) => (
          <SuggestionCard
            key={e.id}
            entry={e}
            onAdd={() => onAdd(e)}
            adding={addingId === e.id}
          />
        ))}
      </View>
    </View>
  );
}

// ── screen ────────────────────────────────────────────────────────────────────

export default function TripDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const journal = useJournal();
  const router  = useRouter();

  const [addingAll, setAddingAll] = useState(false);
  const [addingId,  setAddingId]  = useState<string | null>(null);
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

  const suggestions = useMemo<Entry[]>(() => {
    if (!trip) return [];
    return allEntries(journal)
      .filter((e) => !e.tripId
        && e.start.slice(0, 10) >= trip.start
        && e.start.slice(0, 10) <= trip.end)
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

  // Build flat list: grouped entry days + optional suggestions section
  const entryGroups  = groupByDay(entries);
  const suggestGroups = groupByDay(suggestions);

  type ListItem =
    | { kind: "entryDay";      group: DayGroup }
    | { kind: "suggestHeader" }
    | { kind: "suggestDay";    group: DayGroup };

  const listData: ListItem[] = [
    ...entryGroups.map((g) => ({ kind: "entryDay" as const, group: g })),
    ...(suggestGroups.length > 0 ? [{ kind: "suggestHeader" as const }] : []),
    ...suggestGroups.map((g) => ({ kind: "suggestDay" as const, group: g })),
  ];

  return (
    <>
    <FlatList
      style={styles.list}
      data={listData}
      keyExtractor={(item) =>
        item.kind === "suggestHeader" ? "__header__"
          : item.kind === "entryDay"   ? `e:${item.group.iso}`
          : `s:${item.group.iso}`
      }
      renderItem={({ item }) => {
        if (item.kind === "entryDay") {
          return <EntryDayGroup group={item.group} />;
        }
        if (item.kind === "suggestHeader") {
          return (
            <View style={styles.suggestHeader}>
              <Text style={styles.suggestLabel}>
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
          <SuggestionDayGroup
            group={item.group}
            addingId={addingId}
            onAdd={addEntry}
          />
        );
      }}
      ItemSeparatorComponent={({ leadingItem }) => {
        // Don't draw a separator before / after the suggest header itself
        if (!leadingItem || leadingItem.kind === "suggestHeader") return null;
        return <View style={styles.daySeparator} />;
      }}
      ListHeaderComponent={
        <>
          <Stack.Screen options={{ title: "", ...common.header }} />
          {/* Trip summary card */}
          <View style={styles.headerCard}>
            <View style={styles.headerTop}>
              <Text style={styles.tripDateRange}>
                {fmt(trip.start)} → {fmt(trip.end)}
              </Text>
              {trip.purpose && (
                <Text style={styles.purposeIcon}>
                  {PURPOSE_ICON[trip.purpose] ?? "📌"}
                </Text>
              )}
            </View>
            <Text style={styles.tripTitle}>{trip.title}</Text>
            <View style={styles.tripMeta}>
              <Text style={styles.tripMetaText}>
                {n} {n === 1 ? "night" : "nights"}
              </Text>
              <Text style={styles.tripMetaDot}>·</Text>
              <Text style={styles.tripMetaText}>
                {entries.length} {entries.length === 1 ? "entry" : "entries"}
              </Text>
            </View>
            {trip.notes
              ? <Text style={styles.tripNotes}>{trip.notes}</Text>
              : null}
          </View>
        </>
      }
      ListEmptyComponent={
        suggestions.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              No entries linked or suggested for this trip.
            </Text>
          </View>
        ) : null
      }
      contentContainerStyle={styles.content}
    />
    <Dialog {...dialog.props} onDismiss={dialog.dismiss} />
    </>
  );
}

// ── styles ────────────────────────────────────────────────────────────────────

const DATE_COL_W = 52;

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: colors.bg },
  content: { paddingBottom: spacing["3xl"] },

  // Trip header card
  headerCard: {
    backgroundColor: colors.surface,
    borderRadius: radius["2xl"],
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    margin: spacing.base,
    marginBottom: 0,
  },
  headerTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 },
  tripDateRange: { ...text.sm, color: colors.textTertiary, fontFamily: "monospace", flex: 1 },
  purposeIcon: { fontSize: 18, marginLeft: spacing.sm },
  tripTitle: {
    fontSize: 22,
    fontFamily: fonts.serifBold,
    fontWeight: "700",
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  tripMeta: { flexDirection: "row", gap: spacing.sm2 },
  tripMetaText: { ...text.smMd, color: colors.textSecondary },
  tripMetaDot:  { ...text.smMd, color: colors.textMuted },
  tripNotes: { ...text.md, color: colors.textSecondary, marginTop: 10 },

  // Two-column day group
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
  dateNumDim: { color: colors.textTertiary },
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

  // Cards column
  cardsCol: { flex: 1, gap: spacing.sm },

  // Entry card (linked)
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md2,
    paddingVertical: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  cardPressed: { opacity: 0.65 },
  // Suggestion card — slightly dimmer border to visually separate the two sections
  cardSuggestion: { borderColor: colors.borderFaint },

  cardIcon:    { fontSize: 18 },
  cardTitle:   { flex: 1, ...text.base, color: colors.textPrimary, fontWeight: "500" },
  cardChevron: { fontSize: 20, color: colors.border },

  addBtn: {
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm2,
    minWidth: 60,
    alignItems: "center",
  },
  addBtnDisabled: { opacity: 0.5 },
  addBtnText: { color: colors.accentSoft, fontSize: 12, fontWeight: "700" },

  // Separator between day groups
  daySeparator: {
    height: 1,
    backgroundColor: colors.borderFaint,
    marginHorizontal: spacing.base,
  },

  // Suggestions section header
  suggestHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.base,
    paddingTop: spacing["2xl"],
    paddingBottom: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: spacing.lg,
  },
  suggestLabel: { ...text.label, color: colors.textTertiary },
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

  empty: { paddingTop: spacing.xl, paddingHorizontal: spacing.base, alignItems: "center" },
  emptyText: { ...text.md, color: colors.textMuted, textAlign: "center" },

  notFound: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  notFoundText: { ...text.lg, color: colors.textTertiary },
});
