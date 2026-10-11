/**
 * Trip detail screen — trip header + entries grouped by day in the
 * two-column journal layout. Suggestions (unlinked entries in the date range)
 * appear below with per-card and bulk "+ Add" actions.
 */
import React, { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useDialog, Dialog } from "../../src/components/Dialog";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useJournal, allEntries, putMany, removeMany, storeFor } from "@chronicle/journal/db";
import { entryTitle, view, type Entry, type Trip, type Leg } from "@chronicle/journal/types";
import { useTheme, type ThemeColors, type ThemeFonts, text as textScale, spacing as spacingScale, radius as radiusScale } from "../../src/components/ThemeProvider";
import { KindIcon, StarRating } from "../../src/components/KindIcon";
import { EntryRow } from "../../src/components/EntryRow";
import { Ionicons } from "@expo/vector-icons";
import { DateColumn } from "../../src/components/DateColumn";
import { compareEntriesChronological } from "../../src/lib/dateHelpers";

// ── helpers ───────────────────────────────────────────────────────────────────

const MONTHS_FULL = ["January","February","March","April","May","June",
                     "July","August","September","October","November","December"];

function fmt(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  return `${d.getDate()} ${MONTHS_FULL[d.getMonth()]} ${d.getFullYear()}`;
}

function nights(trip: Trip): number {
  return Math.max(0, Math.round((+new Date(trip.end) - +new Date(trip.start)) / 86_400_000));
}

function entrySubkind(e: Entry): string | undefined {
  if (e.kind === "leg") return e.mode;
  if (e.kind === "event") return (e as Extract<Entry, { kind: "event" }>).category;
  return undefined;
}

function groupByDay(entries: Entry[]): TripDayGroup[] {
  const map = new Map<string, Entry[]>();
  for (const e of entries) {
    const day = e.start.slice(0, 10);
    if (!map.has(day)) map.set(day, []);
    map.get(day)!.push(e);
  }
  return [...map.entries()].map(([iso, items]) => ({ iso, items }));
}

const PURPOSE_KIND: Record<string, string> = {
  leisure: "leisure", work: "work", family: "family",
};

// ── data ──────────────────────────────────────────────────────────────────────

interface TripDayGroup {
  iso: string;
  items: Entry[];
}

// ── styles factory ────────────────────────────────────────────────────────────

function createStyles(colors: ThemeColors, fonts: ThemeFonts) {
  return StyleSheet.create({
    list: { flex: 1, backgroundColor: colors.bg },
    content: { paddingBottom: spacingScale["3xl"] },

    // Trip header card
    headerCard: {
      backgroundColor: colors.surface,
      borderRadius: radiusScale["2xl"],
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacingScale.lg,
      margin: spacingScale.base,
      marginBottom: 0,
    },
    headerTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 },
    tripDateRange: { ...textScale.sm, color: colors.textTertiary, fontFamily: fonts.mono, flex: 1 },
    purposeIconWrap: { marginLeft: spacingScale.sm },
    tripTitle: {
      fontSize: 22,
      fontFamily: fonts.serifBold,
      fontWeight: "700",
      color: colors.textPrimary,
      marginBottom: spacingScale.sm,
    },
    tripMeta: { flexDirection: "row", gap: spacingScale.sm2, flexWrap: "wrap" },
    tripMetaText: { ...textScale.smMd, color: colors.textSecondary },
    tripMetaDot:  { ...textScale.smMd, color: colors.textMuted },
    tripMetaSuggested: { ...textScale.smMd, color: colors.accentSoft, fontWeight: "600" },
    tripNotes: { ...textScale.md, color: colors.textSecondary, marginTop: 10 },

    // Per-type entry breakdown
    statRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacingScale.md2,
      marginTop: spacingScale.sm,
    },
    statItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: 3,
    },
    statNum: {
      fontFamily: fonts.mono,
      fontSize: 11,
      fontWeight: "700",
      color: colors.textSecondary,
    },

    // Two-column day group
    dayGroup: {
      flexDirection: "row",
      paddingHorizontal: spacingScale.base,
      paddingTop: spacingScale.xl,
      paddingBottom: spacingScale.sm,
    },

    // Entries column (linked) — no gap; EntryRow provides its own paddingVertical
    cardsCol: { flex: 1 },

    // Hairline separator between EntryRow items
    rowSeparator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
    },

    // Visible remove button on each linked entry row
    entryRowWrap: {
      flexDirection: "row",
      alignItems: "center",
    },
    removeBtn: {
      padding: 8,
      marginRight: -4,
    },

    // Suggestion card — kept as a bordered card to distinguish from linked entries
    card: {
      paddingHorizontal: spacingScale.md2,
      paddingVertical: spacingScale.md,
      flexDirection: "row",
      alignItems: "center",
      gap: spacingScale.sm,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radiusScale.lg,
      backgroundColor: colors.surface,
    },
    cardPressed: { opacity: 0.65 },
    cardSuggestion: { borderColor: colors.borderFaint },
    cardTitle: { flex: 1, ...textScale.feedTitle, fontFamily: fonts.serifMedium, color: colors.textPrimary, fontWeight: "500" },
    cardChevron: { fontSize: 20, color: colors.border },

    addBtn: {
      borderWidth: 1,
      borderColor: colors.accent,
      borderRadius: radiusScale.md,
      paddingHorizontal: spacingScale.md,
      paddingVertical: spacingScale.sm2,
      minWidth: 60,
      alignItems: "center",
    },
    addBtnDisabled: { opacity: 0.5 },
    addBtnText: { color: colors.accentSoft, fontSize: 12, fontWeight: "700" },

    // Separator between day groups
    daySeparator: {
      height: 1,
      backgroundColor: colors.borderFaint,
      marginHorizontal: spacingScale.base,
    },

    // Suggestions section header
    suggestHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacingScale.base,
      paddingTop: spacingScale["2xl"],
      paddingBottom: spacingScale.sm,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      marginTop: spacingScale.lg,
    },
    suggestLabel: { ...textScale.label, color: colors.textTertiary },
    addAllBtn: {
      backgroundColor: colors.accentBold,
      borderRadius: radiusScale.md,
      paddingHorizontal: spacingScale.md2,
      paddingVertical: spacingScale.sm2,
      minWidth: 72,
      alignItems: "center",
    },
    addAllBtnDisabled: { opacity: 0.5 },
    addAllText: { color: colors.white, fontSize: 12, fontWeight: "700" },

    empty: { paddingTop: spacingScale.xl, paddingHorizontal: spacingScale.base, alignItems: "center" },
    emptyText: { ...textScale.md, color: colors.textMuted, textAlign: "center" },

    notFound: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
    notFoundText: { ...textScale.lg, color: colors.textTertiary },
  });
}

type Styles = ReturnType<typeof createStyles>;

// ── components ────────────────────────────────────────────────────────────────


/** A suggestion card — shows "+ Add" button instead of chevron */
function SuggestionCard({
  entry,
  onAdd,
  adding,
  styles,
  colors,
}: {
  entry: Entry;
  onAdd: () => void;
  adding: boolean;
  styles: Styles;
  colors: ThemeColors;
}) {
  const v = view(entry);
  return (
    <View style={[styles.card, styles.cardSuggestion]}>
      <KindIcon kind={entry.kind} subkind={entrySubkind(entry)} size={18} color={colors.textSecondary} accessibilityLabel="" />
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

/** Two-column date row for linked entries — uses shared EntryRow */
function EntryDayGroup({ group, styles, colors, fonts, router, onRemove }: { group: TripDayGroup; styles: Styles; colors: ThemeColors; fonts: ThemeFonts; router: ReturnType<typeof useRouter>; onRemove?: (entry: Entry) => void }) {
  return (
    <View style={styles.dayGroup}>
      <DateColumn iso={group.iso} colors={colors} fonts={fonts} align="center" />
      <View style={styles.cardsCol}>
        {group.items.map((e, idx) => (
          <React.Fragment key={e.id}>
            {idx > 0 && <View style={styles.rowSeparator} />}
            <View style={styles.entryRowWrap}>
              <View style={{ flex: 1 }}>
                <EntryRow
                  entry={e}
                  colors={colors}
                  fonts={fonts}
                  onPress={() => router.push(`/entry/${e.id}`)}
                  onLongPress={onRemove ? () => onRemove(e) : undefined}
                />
              </View>
              {onRemove && (
                <Pressable
                  style={styles.removeBtn}
                  onPress={() => onRemove(e)}
                  accessibilityLabel="Remove from trip"
                  hitSlop={4}
                >
                  <Ionicons name="remove-circle-outline" size={20} color={colors.textMuted} />
                </Pressable>
              )}
            </View>
          </React.Fragment>
        ))}
      </View>
    </View>
  );
}

/** Two-column date row for suggested (unlinked) entries */
function SuggestionDayGroup({
  group,
  addingId,
  onAdd,
  styles,
  colors,
  fonts,
}: {
  group: TripDayGroup;
  addingId: string | null;
  onAdd: (entry: Entry) => void;
  styles: Styles;
  colors: ThemeColors;
  fonts: ThemeFonts;
}) {
  return (
    <View style={styles.dayGroup}>
      <DateColumn iso={group.iso} colors={colors} fonts={fonts} align="center" dim />
      <View style={styles.cardsCol}>
        {group.items.map((e) => (
          <SuggestionCard
            key={e.id}
            entry={e}
            onAdd={() => onAdd(e)}
            adding={addingId === e.id}
            styles={styles}
            colors={colors}
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
  const { colors, fonts, common } = useTheme();
  const styles = useMemo(() => createStyles(colors, fonts), [colors, fonts]);

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
      .sort(compareEntriesChronological);
  }, [journal, trip]);

  const suggestions = useMemo<Entry[]>(() => {
    if (!trip) return [];
    return allEntries(journal)
      .filter((e) => !e.tripId
        && e.start.slice(0, 10) >= trip.start
        && e.start.slice(0, 10) <= trip.end)
      .sort(compareEntriesChronological);
  }, [journal, trip]);

  // Build flat list: grouped entry days + optional suggestions section.
  // NOTE: must be declared BEFORE any early returns to satisfy Rules of Hooks.
  type ListItem =
    | { kind: "entryDay";      group: TripDayGroup }
    | { kind: "suggestHeader" }
    | { kind: "suggestDay";    group: TripDayGroup };

  const listData = useMemo<ListItem[]>(() => {
    const entryGroups   = groupByDay(entries);
    const suggestGroups = groupByDay(suggestions);
    return [
      ...entryGroups.map((g) => ({ kind: "entryDay" as const, group: g })),
      ...(suggestGroups.length > 0 ? [{ kind: "suggestHeader" as const }] : []),
      ...suggestGroups.map((g) => ({ kind: "suggestDay" as const, group: g })),
    ];
  }, [entries, suggestions]);

  if (!trip) {
    return (
      <View style={styles.notFound}>
        <Stack.Screen options={{ title: "Trip" }} />
        <Text style={styles.notFoundText}>Trip not found</Text>
      </View>
    );
  }

  const n = nights(trip);

  const handleRemove = (entry: Entry) => {
    dialog.confirm(
      "Remove from trip?",
      `"${entryTitle(view(entry))}" will stay in your journal but won't be linked to this trip.`,
      "Remove",
      async () => {
        try {
          await putMany(storeFor(entry), [{ ...entry, tripId: undefined }]);
        } catch (err) {
          dialog.alert("Failed to remove entry", String(err));
        }
      }
    );
  };

  const dissolveTrip = async () => {
    dialog.confirm(
      "Dissolve trip?",
      `"${trip.title}" will be removed. All linked entries stay in your journal.`,
      "Dissolve",
      async () => {
        try {
          // Unlink every entry that belongs to this trip
          const linked = allEntries(journal).filter((e) => e.tripId === trip.id);
          const byStore = new Map<string, Entry[]>();
          for (const e of linked) {
            const s = storeFor(e);
            if (!byStore.has(s)) byStore.set(s, []);
            byStore.get(s)!.push(e);
          }
          for (const [store, items] of byStore) {
            await putMany(store, items.map((e) => ({ ...e, tripId: undefined })));
          }
          await removeMany("trips", [trip.id]);
          router.replace("/(tabs)/trips");
        } catch (err) {
          dialog.alert("Failed to dissolve trip", String(err));
        }
      }
    );
  };

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
          return <EntryDayGroup group={item.group} styles={styles} colors={colors} fonts={fonts} router={router} onRemove={handleRemove} />;
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
            styles={styles}
            colors={colors}
            fonts={fonts}
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
          <Stack.Screen
            options={{
              title: "",
              ...common.header,
              headerRight: () => (
                <View style={{ flexDirection: "row", gap: 4, marginRight: 4 }}>
                  <Pressable
                    onPress={dissolveTrip}
                    style={{ padding: 8 }}
                    accessibilityLabel="Dissolve trip"
                  >
                    <Ionicons name="trash-outline" size={22} color={colors.textMuted} />
                  </Pressable>
                  <Pressable
                    onPress={() => router.push(`/trip/edit/${trip.id}`)}
                    style={{ padding: 8 }}
                    accessibilityLabel="Edit trip"
                  >
                    <Ionicons name="create-outline" size={22} color={colors.accentSoft} />
                  </Pressable>
                </View>
              ),
            }}
          />
          {/* Trip summary card */}
          {(() => {
            const headerStats: { kind: string; subkind?: string; count: number }[] = [
              { kind: "leg",   subkind: "air",  count: entries.filter((e) => e.kind === "leg"   && (e as Leg).mode === "air").length  },
              { kind: "leg",   subkind: "rail", count: entries.filter((e) => e.kind === "leg"   && (e as Leg).mode === "rail").length },
              { kind: "stay",                   count: entries.filter((e) => e.kind === "stay").length  },
              { kind: "event",                  count: entries.filter((e) => e.kind === "event").length },
            ].filter((s) => s.count > 0);
            return (
              <View style={styles.headerCard}>
                <View style={styles.headerTop}>
                  <Text style={styles.tripDateRange}>
                    {fmt(trip.start)} {"→"} {fmt(trip.end)}
                  </Text>
                  {trip.purpose && (
                    <View style={styles.purposeIconWrap}>
                      <KindIcon
                        kind={PURPOSE_KIND[trip.purpose] ?? "location"}
                        size={18}
                        color={colors.textSecondary}
                        accessibilityLabel=""
                      />
                    </View>
                  )}
                </View>
                <Text style={styles.tripTitle}>{trip.title}</Text>
                <View style={styles.tripMeta}>
                  <Text style={styles.tripMetaText}>
                    {n} {n === 1 ? "night" : "nights"}
                  </Text>
                  <Text style={styles.tripMetaDot}>{"·"}</Text>
                  <Text style={styles.tripMetaText}>
                    {entries.length} {entries.length === 1 ? "entry" : "entries"}
                  </Text>
                  {suggestions.length > 0 && (
                    <>
                      <Text style={styles.tripMetaDot}>{"·"}</Text>
                      <Text style={styles.tripMetaSuggested}>
                        {suggestions.length} suggested
                      </Text>
                    </>
                  )}
                </View>
                {headerStats.length > 0 && (
                  <View style={styles.statRow}>
                    {headerStats.map((s) => (
                      <View key={`${s.kind}-${s.subkind ?? ""}`} style={styles.statItem}>
                        <KindIcon
                          kind={s.kind}
                          subkind={s.subkind}
                          size={13}
                          color={colors.textSecondary}
                          accessibilityLabel=""
                        />
                        <Text style={styles.statNum}>{s.count}</Text>
                      </View>
                    ))}
                  </View>
                )}
                {trip.rating !== undefined && (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 }}>
                    <StarRating rating={trip.rating} color={colors.star} size={14} />
                  </View>
                )}
                {(trip.reflection ?? trip.notes)
                  ? <Text style={styles.tripNotes}>{trip.reflection ?? trip.notes}</Text>
                  : null}
              </View>
            );
          })()}
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
