/**
 * Trip detail screen — trip header + entries grouped by day in the
 * two-column journal layout. Suggestions (unlinked entries in the date range)
 * appear below with per-card and bulk "+ Add" actions.
 */
import React, { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useDialog, Dialog } from "../../src/components/Dialog";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useJournal, allEntries, putMany, storeFor } from "@chronicle/journal/db";
import { entryTitle, view, type Entry, type Trip } from "@chronicle/journal/types";
import { useTheme, type ThemeColors, type ThemeFonts, text as textScale, spacing as spacingScale, radius as radiusScale } from "../../src/components/ThemeProvider";
import { KindIcon } from "../../src/components/KindIcon";
import { EntryRow } from "../../src/components/EntryRow";

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

function entrySubkind(e: Entry): string | undefined {
  if (e.kind === "leg") return e.mode;
  if (e.kind === "event") return (e as Extract<Entry, { kind: "event" }>).category;
  return undefined;
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

const PURPOSE_KIND: Record<string, string> = {
  leisure: "leisure", work: "work", family: "family",
};

// ── data ──────────────────────────────────────────────────────────────────────

interface DayGroup {
  iso: string;
  items: Entry[];
}

// ── styles factory ────────────────────────────────────────────────────────────

const DATE_COL_W = 52;

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
    tripMeta: { flexDirection: "row", gap: spacingScale.sm2 },
    tripMetaText: { ...textScale.smMd, color: colors.textSecondary },
    tripMetaDot:  { ...textScale.smMd, color: colors.textMuted },
    tripNotes: { ...textScale.md, color: colors.textSecondary, marginTop: 10 },

    // Two-column day group
    dayGroup: {
      flexDirection: "row",
      paddingHorizontal: spacingScale.base,
      paddingTop: spacingScale.xl,
      paddingBottom: spacingScale.sm,
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
      ...textScale.dayNum,
      color: colors.textBright,
    },
    dateNumDim: { color: colors.textTertiary },
    dateSub: {
      fontFamily: fonts.mono,
      fontSize: 10,
      fontWeight: "700",
      letterSpacing: 0.8,
      color: colors.textTertiary,
      lineHeight: 15,
      textTransform: "uppercase" as const,
    },

    // Vertical rule
    dateRule: {
      width: 1,
      alignSelf: "stretch",
      backgroundColor: colors.border,
      marginHorizontal: spacingScale.md,
      marginTop: 4,
    },

    // Entries column (linked) — no gap; EntryRow provides its own paddingVertical
    cardsCol: { flex: 1 },

    // Hairline separator between EntryRow items
    rowSeparator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
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
function EntryDayGroup({ group, styles, colors, fonts, router }: { group: DayGroup; styles: Styles; colors: ThemeColors; fonts: ThemeFonts; router: ReturnType<typeof useRouter> }) {
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
        {group.items.map((e, idx) => (
          <React.Fragment key={e.id}>
            {idx > 0 && <View style={styles.rowSeparator} />}
            <EntryRow
              entry={e}
              colors={colors}
              fonts={fonts}
              onPress={() => router.push(`/entry/${e.id}`)}
            />
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
}: {
  group: DayGroup;
  addingId: string | null;
  onAdd: (entry: Entry) => void;
  styles: Styles;
  colors: ThemeColors;
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
          return <EntryDayGroup group={item.group} styles={styles} colors={colors} fonts={fonts} router={router} />;
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
