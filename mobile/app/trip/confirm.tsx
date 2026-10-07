/**
 * Trip suggestion confirm screen.
 *
 * Shows all unlinked entries in the suggested date range grouped by day,
 * each with a Switch so the user can include or exclude individual items
 * before committing. On confirm:
 *   1. Creates the Trip record.
 *   2. Writes tripId onto every selected entry.
 *   3. Navigates to the trip detail screen.
 */
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useDialog, Dialog } from "../../src/components/Dialog";
import { useJournal, allEntries, putMany, storeFor } from "@chronicle/journal/db";
import {
  uid,
  view,
  entryTitle,
  type Entry,
  type Leg,
} from "@chronicle/journal/types";
import {
  useTheme,
  type ThemeColors,
  type ThemeFonts,
  text as textScale,
  spacing as spacingScale,
  radius as radiusScale,
} from "../../src/components/ThemeProvider";
import { KindIcon } from "../../src/components/KindIcon";
import { DateColumn } from "../../src/components/DateColumn";
import { entryMeta, entryLabel } from "../../src/components/EntryRow";
import { compareEntriesChronological } from "../../src/lib/dateHelpers";

// ── helpers ───────────────────────────────────────────────────────────────────

const MONTHS_FULL = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

function fmt(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  return `${d.getDate()} ${MONTHS_FULL[d.getMonth()]} ${d.getFullYear()}`;
}

function resolveSubkind(e: Entry): string | undefined {
  if (e.kind === "leg") return (e as Leg).mode;
  if (e.kind === "event") return (e as Extract<Entry, { kind: "event" }>).category;
  return undefined;
}

interface DayGroup {
  iso: string;
  entries: Entry[];
}

function groupByDay(entries: Entry[]): DayGroup[] {
  const map = new Map<string, Entry[]>();
  for (const e of entries) {
    const day = e.start.slice(0, 10);
    if (!map.has(day)) map.set(day, []);
    map.get(day)!.push(e);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([iso, entries]) => ({ iso, entries }));
}

// ── styles ────────────────────────────────────────────────────────────────────

function createStyles(colors: ThemeColors, fonts: ThemeFonts) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    content:   { paddingBottom: spacingScale["3xl"] },

    // Summary card
    summaryCard: {
      backgroundColor: colors.surface,
      borderRadius: radiusScale["2xl"],
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacingScale.lg,
      margin: spacingScale.base,
    },
    dateRange: {
      ...textScale.sm,
      color: colors.textTertiary,
      fontFamily: fonts.mono,
      marginBottom: 4,
    },
    tripTitle: {
      fontSize: 22,
      fontFamily: fonts.serifBold,
      fontWeight: "700",
      color: colors.textPrimary,
    },

    // Select-all bar
    selectBar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacingScale.base,
      paddingVertical: spacingScale.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    selectBarText: { ...textScale.sm, color: colors.textTertiary },
    selectAllBtn: { padding: 4 },
    selectAllText: { ...textScale.sm, color: colors.accentSoft, fontWeight: "600" },

    // Day group
    dayGroup: {
      flexDirection: "row",
      paddingHorizontal: spacingScale.base,
      paddingTop: spacingScale.xl,
      paddingBottom: spacingScale.sm,
    },
    entriesCol: { flex: 1 },

    // Entry row with switch
    entryRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: spacingScale.sm2,
      gap: spacingScale.sm,
    },
    entryBody: { flex: 1, minWidth: 0 },
    entryTitle: {
      ...textScale.feedTitle,
      fontFamily: fonts.serifMedium,
      fontWeight: "500",
      color: colors.textPrimary,
    },
    entryMeta: {
      ...textScale.sm,
      color: colors.textTertiary,
      marginTop: 2,
    },
    entryLabel: {
      fontSize: 10,
      fontFamily: fonts.mono,
      fontWeight: "700",
      letterSpacing: 0.8,
      textTransform: "uppercase" as const,
      color: colors.textTertiary,
    },
    entryDimmed: { opacity: 0.4 },

    separator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
    },

    empty: {
      padding: spacingScale["2xl"],
      alignItems: "center",
    },
    emptyText: { ...textScale.md, color: colors.textMuted, textAlign: "center" },

    // Footer actions
    footer: {
      padding: spacingScale.base,
      paddingBottom: spacingScale["2xl"],
      gap: spacingScale.sm,
    },
    createBtn: {
      backgroundColor: colors.accentBold,
      borderRadius: radiusScale.xl,
      paddingVertical: 15,
      alignItems: "center",
    },
    createBtnDisabled: { opacity: 0.5 },
    createBtnText: { color: colors.white, fontSize: 16, fontWeight: "700" },
    cancelBtn: {
      borderRadius: radiusScale.xl,
      paddingVertical: 12,
      alignItems: "center",
    },
    cancelBtnText: { ...textScale.base, color: colors.textMuted },
  });
}

// ── screen ────────────────────────────────────────────────────────────────────

export default function TripConfirmScreen() {
  const { title, start, end } =
    useLocalSearchParams<{ title: string; start: string; end: string }>();
  const journal = useJournal();
  const router  = useRouter();
  const { colors, fonts, common } = useTheme();
  const styles = useMemo(() => createStyles(colors, fonts), [colors, fonts]);
  const [saving, setSaving] = useState(false);
  const dialog = useDialog();

  // All unlinked entries in the suggested date range, sorted chronologically
  const inRange = useMemo<Entry[]>(() => {
    if (!start || !end) return [];
    return allEntries(journal)
      .filter((e) => {
        if (e.tripId) return false;
        const d = e.start.slice(0, 10);
        return d >= start && d <= end;
      })
      .sort(compareEntriesChronological);
  }, [journal, start, end]);

  // Selection state — all entries selected by default
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(inRange.map((e) => e.id))
  );

  const allSelected  = selected.size === inRange.length;
  const noneSelected = selected.size === 0;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(inRange.map((e) => e.id)));
  }

  const dayGroups = useMemo(() => groupByDay(inRange), [inRange]);
  const selectedCount = selected.size;

  const handleCreate = async () => {
    if (!title || !start || !end) return;
    setSaving(true);
    try {
      const trip = {
        id: uid(),
        title: title.trim(),
        start,
        end,
        cover: "",
        createdAt: new Date().toISOString(),
      };
      await putMany("trips", [trip]);

      const toLink = inRange.filter((e) => selected.has(e.id));
      if (toLink.length > 0) {
        const byStore = new Map<string, Entry[]>();
        for (const e of toLink) {
          const s = storeFor(e);
          if (!byStore.has(s)) byStore.set(s, []);
          byStore.get(s)!.push(e);
        }
        for (const [store, items] of byStore) {
          await putMany(
            store as Parameters<typeof putMany>[0],
            items.map((e) => ({ ...e, tripId: trip.id }))
          );
        }
      }

      router.replace(`/trip/${trip.id}`);
    } catch (err) {
      dialog.alert("Failed to create trip", String(err));
      setSaving(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: "Confirm trip", ...common.header }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>

        {/* Summary */}
        <View style={styles.summaryCard}>
          <Text style={styles.dateRange}>
            {fmt(start)} {"→"} {fmt(end)}
          </Text>
          <Text style={styles.tripTitle}>{title}</Text>
        </View>

        {/* Select-all bar */}
        {inRange.length > 0 && (
          <View style={styles.selectBar}>
            <Text style={styles.selectBarText}>
              {selectedCount} of {inRange.length} entries selected
            </Text>
            <Pressable style={styles.selectAllBtn} onPress={toggleAll} hitSlop={8}>
              <Text style={styles.selectAllText}>
                {allSelected ? "Deselect all" : "Select all"}
              </Text>
            </Pressable>
          </View>
        )}

        {/* Entries grouped by day */}
        {inRange.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              No unlinked entries found in this date range.
            </Text>
          </View>
        ) : (
          dayGroups.map((group) => (
            <View key={group.iso} style={styles.dayGroup}>
              <DateColumn iso={group.iso} colors={colors} fonts={fonts} align="center" />
              <View style={styles.entriesCol}>
                {group.entries.map((e, idx) => {
                  const v       = view(e);
                  const isOn    = selected.has(e.id);
                  const subkind = resolveSubkind(e);
                  return (
                    <React.Fragment key={e.id}>
                      {idx > 0 && <View style={styles.separator} />}
                      <View style={[styles.entryRow, !isOn && styles.entryDimmed]}>
                        <KindIcon
                          kind={e.kind}
                          subkind={subkind}
                          size={18}
                          color={colors.textSecondary}
                          accessibilityLabel=""
                        />
                        <View style={styles.entryBody}>
                          <Text style={styles.entryTitle} numberOfLines={2}>
                            {entryTitle(v)}
                          </Text>
                          {entryMeta(e).length > 0 && (
                            <Text style={styles.entryMeta} numberOfLines={1}>
                              {entryMeta(e)}
                            </Text>
                          )}
                        </View>
                        <Text style={styles.entryLabel}>{entryLabel(e)}</Text>
                        <Switch
                          value={isOn}
                          onValueChange={() => toggle(e.id)}
                          trackColor={{ true: colors.accent, false: colors.border }}
                          thumbColor={isOn ? colors.accentSubtle : colors.textMuted}
                        />
                      </View>
                    </React.Fragment>
                  );
                })}
              </View>
            </View>
          ))
        )}

        {/* Actions */}
        <View style={styles.footer}>
          <Pressable
            style={[
              styles.createBtn,
              (saving || noneSelected) && styles.createBtnDisabled,
            ]}
            onPress={handleCreate}
            disabled={saving || noneSelected}
          >
            {saving ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.createBtnText}>
                {selectedCount > 0
                  ? `Create trip & link ${selectedCount} ${selectedCount === 1 ? "entry" : "entries"}`
                  : "Create trip"}
              </Text>
            )}
          </Pressable>
          <Pressable style={styles.cancelBtn} onPress={() => router.back()}>
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </Pressable>
        </View>

      </ScrollView>
      <Dialog {...dialog.props} onDismiss={dialog.dismiss} />
    </>
  );
}
