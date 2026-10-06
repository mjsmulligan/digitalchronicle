/**
 * Hidden Entries screen — shows every soft-deleted entry and lets the user
 * restore individual entries back into the journal.
 *
 * Entry point: Settings → "Hidden Entries"
 */
import { useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useJournal, allHiddenEntries, unhideMany, storeFor } from "@chronicle/journal/db";
import { entryTitle, view, CATEGORY_LABEL, type Entry } from "@chronicle/journal/types";
import { useTheme, type ThemeColors, type ThemeFonts, text as textScale, spacing as spacingScale, radius as radiusScale } from "../src/components/ThemeProvider";
import { useDialog, Dialog } from "../src/components/Dialog";
import { KindIcon } from "../src/components/KindIcon";

// ── Two-column layout constants (mirrors Chronicle feed) ─────────────────────
const DATE_COL_W = 52;

function parseDay(iso: string) {
  const d = new Date(iso.slice(0, 10) + "T12:00:00");
  return {
    num:   d.getDate().toString(),
    day:   d.toLocaleDateString("en", { weekday: "short" }).toUpperCase(),
    month: d.toLocaleDateString("en", { month: "short" }).toUpperCase(),
    year:  d.getFullYear().toString(),
  };
}

// ── Styles ────────────────────────────────────────────────────────────────────

function createStyles(colors: ThemeColors, fonts: ThemeFonts) {
  return StyleSheet.create({
    list:    { flex: 1, backgroundColor: colors.bg },
    content: { paddingBottom: spacingScale["3xl"] },

    emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 80, paddingHorizontal: 32 },
    emptyTitle: { fontFamily: fonts.serifSemiBold, fontSize: 18, color: colors.textPrimary, textAlign: "center", marginBottom: 10 },
    emptyBody:  { fontFamily: fonts.serifRegular, fontSize: 14, color: colors.textTertiary, textAlign: "center", lineHeight: 20 },

    // Day group row
    dayRow: {
      flexDirection: "row",
      paddingHorizontal: spacingScale.base,
      paddingTop: spacingScale.md,
      paddingBottom: 2,
    },

    // Date column
    dateCol: {
      width: DATE_COL_W,
      alignItems: "flex-end",
      paddingRight: spacingScale.sm,
      paddingTop: 2,
    },
    dateNum:   { fontFamily: fonts.serifBold, fontSize: 28, lineHeight: 32, color: colors.textPrimary },
    dateSub:   { fontFamily: fonts.serifRegular, fontSize: 10, letterSpacing: 0.5, color: colors.textTertiary, textAlign: "right" },

    // Spine rule
    dateRule: {
      width: 1,
      backgroundColor: colors.border,
      marginHorizontal: 0,
    },

    // Cards column
    cardsCol: { flex: 1, paddingLeft: spacingScale.sm },

    // Entry row
    entryRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 10,
    },
    entryRowSep: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.borderFaint,
      marginLeft: spacingScale.sm,
    },
    iconWrap: { marginRight: 10, width: 24, alignItems: "center" },
    entryInfo: { flex: 1 },
    entryTitle: { fontFamily: fonts.serifSemiBold, fontSize: 15, color: colors.textPrimary },
    entryMeta:  { fontFamily: fonts.serifRegular, fontSize: 12, color: colors.textTertiary, marginTop: 1 },

    // Restore button
    restoreBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: radiusScale.md,
      borderWidth: 1,
      borderColor: colors.accent,
    },
    restoreBtnLabel: { fontFamily: fonts.serifSemiBold, fontSize: 12, color: colors.accent },

    daySeparator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.borderFaint, marginHorizontal: spacingScale.base },
  });
}

// ── Sub-components ────────────────────────────────────────────────────────────

function entrySubtitle(e: Entry): string {
  const v = view(e);
  if (v.kind === "leg")     return `${(v as any).fromName ?? (v as any).from} → ${(v as any).toName ?? (v as any).to}`;
  if (v.kind === "stay")    return (v as any).city ?? "";
  if (v.kind === "event")   return CATEGORY_LABEL[(v as any).category as keyof typeof CATEGORY_LABEL] ?? "";
  if (v.kind === "film")    return (v as any).year ? `${(v as any).year}` : "";
  if (v.kind === "episode") return `S${String((v as any).season ?? "").padStart(2, "0")} · ${(v as any).showTitle ?? ""}`;
  if (v.kind === "book")    return (v as any).author ?? "";
  return "";
}

type DayGroup = { day: string; entries: Entry[] };

function groupByDay(entries: Entry[]): DayGroup[] {
  const map = new Map<string, Entry[]>();
  for (const e of [...entries].sort((a, b) => b.start.localeCompare(a.start))) {
    const key = e.start.slice(0, 10);
    (map.get(key) ?? map.set(key, []).get(key)!).push(e);
  }
  return Array.from(map.entries()).map(([day, es]) => ({ day, entries: es }));
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function HiddenEntriesScreen() {
  const journal   = useJournal();
  const { colors, fonts } = useTheme();
  const dialog    = useDialog();
  const [restoring, setRestoring] = useState<Set<string>>(new Set());

  const styles = useMemo(() => createStyles(colors, fonts), [colors, fonts]);

  const hidden = useMemo(() => allHiddenEntries(journal), [journal]);
  const groups = useMemo(() => groupByDay(hidden), [hidden]);

  const handleRestore = (entry: Entry) => {
    dialog.confirm(
      "Restore entry",
      `"${entryTitle(entry)}" will be returned to your journal.`,
      "Restore",
      async () => {
        setRestoring((prev) => new Set([...prev, entry.id]));
        try {
          await unhideMany(storeFor(entry), [entry.id]);
        } catch (err) {
          dialog.alert("Restore failed", String(err));
        } finally {
          setRestoring((prev) => { const next = new Set(prev); next.delete(entry.id); return next; });
        }
      },
    );
  };

  type ListItem = { type: "group"; group: DayGroup } | { type: "sep"; key: string };

  const flatItems = useMemo<ListItem[]>(() => {
    const items: ListItem[] = [];
    groups.forEach((g, i) => {
      items.push({ type: "group", group: g });
      if (i < groups.length - 1) items.push({ type: "sep", key: `sep-${g.day}` });
    });
    return items;
  }, [groups]);

  const renderItem = ({ item }: { item: ListItem }) => {
    if (item.type === "sep") return <View style={styles.daySeparator} />;

    const { group } = item;
    const { num, day, month, year } = parseDay(group.day);

    return (
      <View style={styles.dayRow}>
        {/* Date column */}
        <View style={styles.dateCol}>
          <Text style={styles.dateNum}>{num}</Text>
          <Text style={styles.dateSub}>{day}</Text>
          <Text style={styles.dateSub}>{month}</Text>
          <Text style={styles.dateSub}>{year}</Text>
        </View>

        {/* Spine */}
        <View style={styles.dateRule} />

        {/* Entries */}
        <View style={styles.cardsCol}>
          {group.entries.map((entry, idx) => (
            <View key={entry.id}>
              {idx > 0 && <View style={styles.entryRowSep} />}
              <View style={styles.entryRow}>
                <View style={styles.iconWrap}>
                  <KindIcon
                    kind={entry.kind}
                    subkind={entry.kind === "leg" ? (entry as any).mode : entry.kind === "event" ? (entry as any).category : undefined}
                    size={18}
                    color={colors.textTertiary}
                  />
                </View>
                <View style={styles.entryInfo}>
                  <Text style={styles.entryTitle} numberOfLines={1}>{entryTitle(entry)}</Text>
                  {entrySubtitle(entry) ? (
                    <Text style={styles.entryMeta} numberOfLines={1}>{entrySubtitle(entry)}</Text>
                  ) : null}
                </View>
                <Pressable
                  style={styles.restoreBtn}
                  onPress={() => handleRestore(entry)}
                  disabled={restoring.has(entry.id)}
                  hitSlop={8}
                >
                  <Ionicons name="arrow-undo-outline" size={13} color={colors.accent} />
                  <Text style={styles.restoreBtnLabel}>Restore</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      </View>
    );
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: "Hidden Entries",
          headerStyle: { backgroundColor: colors.surface },
          headerTitleStyle: { fontFamily: fonts.serifSemiBold, color: colors.textBright },
          headerTintColor: colors.accent,
        }}
      />
      {hidden.length === 0 ? (
        <View style={[styles.list, styles.emptyWrap]}>
          <Text style={styles.emptyTitle}>No hidden entries</Text>
          <Text style={styles.emptyBody}>
            Entries you hide will appear here. You can restore them at any time.
          </Text>
        </View>
      ) : (
        <FlatList
          style={styles.list}
          contentContainerStyle={styles.content}
          data={flatItems}
          keyExtractor={(item) => item.type === "group" ? item.group.day : item.key}
          renderItem={renderItem}
          ListHeaderComponent={
            <View style={{ paddingHorizontal: spacingScale.base, paddingTop: spacingScale.md, paddingBottom: spacingScale.sm }}>
              <Text style={{ fontFamily: fonts.serifRegular, fontSize: 13, color: colors.textTertiary }}>
                {hidden.length} hidden {hidden.length === 1 ? "entry" : "entries"} · tap Restore to return to your journal
              </Text>
            </View>
          }
        />
      )}
      <Dialog {...dialog.props} onDismiss={dialog.dismiss} />
    </>
  );
}
