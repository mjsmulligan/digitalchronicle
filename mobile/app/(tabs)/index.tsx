/**
 * Chronicle tab — chronological feed of all entry kinds.
 *
 * Layout: one DayGroup per calendar day, newest first.
 * Each DayGroup renders the date column, a vertical spine rule, optional
 * trip label, entry rows (hairline-separated, not cards), and a reflection
 * prompt at the bottom — matching the web Chronicle feed (src/routes/index.tsx).
 *
 * WP1.10: search field, kind/category filter chips, People filter, and
 * wired-up reflection editing (handled inline inside DayGroup).
 */
import { useMemo, useState } from "react";
import { FlatList, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useJournal, allEntries } from "@chronicle/journal/db";
import { type Entry, type JEvent, type Leg, type Person, entryTitle } from "@chronicle/journal/types";
import { useTheme, type ThemeColors, type ThemeFonts, text as textScale, spacing as spacingScale, radius as radiusScale } from "../../src/components/ThemeProvider";
import { KindIcon } from "../../src/components/KindIcon";
import { DayGroup, type DayGroupData } from "../../src/components/DayGroup";
import { MonthHeader, type IconCount } from "../../src/components/MonthHeader";

// ── filter types & helpers ────────────────────────────────────────────────────

type F = "all" | "travel" | "concert" | "social" | "milestone" | "memory";

const FILTERS: { id: F; label: string }[] = [
  { id: "all",       label: "Everything" },
  { id: "travel",    label: "Travel" },
  { id: "concert",   label: "Concerts" },
  { id: "social",    label: "Gatherings & celebrations" },
  { id: "milestone", label: "Milestones" },
  { id: "memory",    label: "Memories" },
];

/** Mirror of web `matches()` in src/routes/index.tsx */
function matchesFilter(e: Entry, f: F): boolean {
  if (f === "all") return true;
  if (f === "travel") return e.kind === "leg" || e.kind === "stay";
  if (e.kind !== "event") return false;
  const ev = e as JEvent;
  if (f === "social")    return ev.category === "gathering" || ev.category === "celebration";
  if (f === "memory")    return ev.category === "memory"    || ev.category === "activity";
  return ev.category === f; // "concert" | "milestone"
}

/** Mirror of web `entryHasPerson()` */
function entryHasPerson(e: Entry, person: Person): boolean {
  if (person.isSelf) return !e.participants || e.participants.includes(person.id);
  return e.participants?.includes(person.id) ?? false;
}

// ── feed item types ───────────────────────────────────────────────────────────

/**
 * Items in the flat FlatList data array.
 * Month headers are injected whenever the month changes (newest-first order).
 */
type FeedItem =
  | { type: "day";   key: string; group: DayGroupData }
  | { type: "month"; key: string; label: string; iconCounts: IconCount[] };

/**
 * Aggregate a set of entries into per-kind icon counts for the month header
 * summary. Entries are bucketed by (kind, subkind); legs split by mode;
 * events split by category. Sorted by count descending, capped at 7.
 */
function buildIconCounts(entries: Entry[]): IconCount[] {
  const buckets = new Map<string, IconCount>();

  const inc = (key: string, kind: string, subkind?: string) => {
    if (!buckets.has(key)) buckets.set(key, { kind, subkind, count: 0 });
    buckets.get(key)!.count++;
  };

  for (const e of entries) {
    switch (e.kind) {
      case "leg":
        inc(`leg-${(e as Leg).mode ?? "road"}`, "leg", (e as Leg).mode ?? "road");
        break;
      case "stay":
        inc("stay", "stay");
        break;
      case "film":
        inc("film", "film");
        break;
      case "episode":
        inc("episode", "episode");
        break;
      case "book":
        inc("book", "book");
        break;
      case "event": {
        const cat = (e as JEvent).category ?? "activity";
        inc(`event-${cat}`, "event", cat);
        break;
      }
      // place / place-entry: background data, not shown in summary
      default:
        break;
    }
  }

  return [...buckets.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 7);
}

// ── styles ────────────────────────────────────────────────────────────────────

function createStyles(colors: ThemeColors, fonts: ThemeFonts) {
  return StyleSheet.create({
    list:    { flex: 1, backgroundColor: colors.bg },
    content: { paddingBottom: spacingScale["3xl"] },

    // Hairline separator between day groups
    daySeparator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.borderFaint,
      marginHorizontal: spacingScale.base,
    },

    // ── List header: search + filter chips + people chips ──────────────────

    header: {
      paddingTop: spacingScale.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderFaint,
    },

    // Search field
    searchRow: {
      flexDirection: "row",
      alignItems: "center",
      marginHorizontal: spacingScale.base,
      marginBottom: spacingScale.sm,
      backgroundColor: colors.surface,
      borderRadius: radiusScale.lg,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacingScale.md,
      paddingVertical: spacingScale.sm2,
      gap: spacingScale.sm,
    },
    searchInput: {
      flex: 1,
      ...textScale.base,
      fontFamily: fonts.sans,
      color: colors.textPrimary,
      padding: 0,
    },
    searchPlaceholder: { color: colors.textTertiary },

    // Filter chip rows
    chipsRow: {
      flexGrow: 0,
    },
    chipsContent: {
      paddingHorizontal: spacingScale.base,
      paddingVertical: spacingScale.sm,
      gap: spacingScale.sm,
      flexDirection: "row",
    },
    chip: {
      paddingHorizontal: spacingScale.md2,
      paddingVertical: spacingScale.sm2,
      borderRadius: radiusScale.pill,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    chipActive:    { backgroundColor: colors.surfaceAccent, borderColor: colors.accent },
    chipText:      { ...textScale.smMd, fontFamily: fonts.sans, fontWeight: "600", color: colors.textSecondary },
    chipTextActive: { color: colors.accentSubtle },

    // People chips have a slightly different treatment (smaller)
    peopleChipsRow: {
      flexGrow: 0,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.borderFaint,
    },

    // ── Empty state ────────────────────────────────────────────────────────

    empty: {
      flex: 1,
      backgroundColor: colors.bg,
      alignItems: "center",
      justifyContent: "center",
      padding: spacingScale["2xl"],
    },
    emptyTitle: {
      fontSize: textScale.xl.fontSize,
      // Omit lineHeight on Android — Lora SemiBold clips wrapped lines when
      // lineHeight is constrained; letting Android use the font's natural
      // metrics avoids this.
      lineHeight: Platform.OS === "android" ? undefined : textScale.xl.lineHeight,
      fontFamily: fonts.serifSemiBold,
      fontWeight: "600",
      color: colors.textPrimary,
      textAlign: "center",
      marginTop: spacingScale.base,
      marginBottom: spacingScale.sm,
    },
    emptyHint: {
      ...textScale.md,
      color: colors.textTertiary,
      textAlign: "center",
    },
    emptyHintRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      flexWrap: "wrap",
      gap: 4,
      paddingHorizontal: spacingScale.lg,
    },
    emptyExplainer: {
      ...textScale.md,
      fontFamily: fonts.sans,
      color: colors.textSecondary,
      textAlign: "center",
      lineHeight: 22,
      marginTop: spacingScale.xl,
      paddingHorizontal: spacingScale.md,
    },
  });
}

// ── screen ───────────────────────────────────────────────────────────────────

export default function ChronicleScreen() {
  const journal = useJournal();
  const router = useRouter();
  const { colors, fonts } = useTheme();
  const styles = useMemo(() => createStyles(colors, fonts), [colors, fonts]);

  // ── filter / search state ──────────────────────────────────────────────────
  const [filter, setFilter]   = useState<F>("all");
  const [q, setQ]             = useState("");
  const [personId, setPersonId] = useState<string | null>(null);

  const selectedPerson = useMemo(
    () => (personId ? journal.people.find((p) => p.id === personId) ?? null : null),
    [journal.people, personId]
  );

  // ── feed items: day groups interleaved with month headers ────────────────────
  //
  // Pass 1 — filter entries into a day map (mirrors web src/routes/index.tsx).
  // Pass 2 — walk days newest-first; inject a MonthHeader item whenever the
  //           month changes, carrying a per-month icon count summary.
  const feedItems = useMemo<FeedItem[]>(() => {
    const qLower = q.trim().toLowerCase();

    // Resolve trip for each day by date range (mirrors web `tripOf`)
    const tripOf = (d: string) =>
      journal.trips.find((t) => d >= t.start && d <= t.end);

    // Build day → matched-entries map
    const entryMap = new Map<string, Entry[]>();
    const entries = allEntries(journal);
    for (const e of entries) {
      if (!matchesFilter(e, filter)) continue;
      if (selectedPerson && !entryHasPerson(e, selectedPerson)) continue;
      if (qLower && !entryTitle(e).toLowerCase().includes(qLower)) continue;
      const d = (e.overrides?.start ?? e.start).slice(0, 10);
      if (!entryMap.has(d)) entryMap.set(d, []);
      entryMap.get(d)!.push(e);
    }

    // Aggregate per-month entries for the icon summary
    const monthMap = new Map<string, Entry[]>();
    for (const [iso, dayEntries] of entryMap) {
      const monthKey = iso.slice(0, 7); // "YYYY-MM"
      if (!monthMap.has(monthKey)) monthMap.set(monthKey, []);
      monthMap.get(monthKey)!.push(...dayEntries);
    }

    // Walk days newest-first, injecting a month header on each month change
    const sortedDays = [...entryMap.keys()].sort((a, b) => b.localeCompare(a));
    const items: FeedItem[] = [];
    let currentMonth = "";

    for (const iso of sortedDays) {
      const monthKey = iso.slice(0, 7);

      if (monthKey !== currentMonth) {
        currentMonth = monthKey;
        const [yearStr, monthStr] = monthKey.split("-");
        // Build a locale-independent label: "OCTOBER · 2026"
        const monthName = new Date(Number(yearStr), Number(monthStr) - 1, 1)
          .toLocaleString("en-US", { month: "long" })
          .toUpperCase();
        items.push({
          type: "month",
          key: `month-${monthKey}`,
          label: `${monthName} · ${yearStr}`,
          iconCounts: buildIconCounts(monthMap.get(monthKey) ?? []),
        });
      }

      items.push({
        type: "day",
        key: iso,
        group: {
          iso,
          items: entryMap.get(iso)!,
          tripTitle: tripOf(iso)?.title,
        },
      });
    }

    return items;
  }, [journal, filter, q, selectedPerson]);

  // ── header component (search + chips) ─────────────────────────────────────

  const listHeader = useMemo(() => (
    <View style={styles.header}>
      {/* Search field */}
      <View style={styles.searchRow}>
        <KindIcon kind="book" size={16} color={colors.textTertiary} accessibilityLabel="" />
        <TextInput
          style={styles.searchInput}
          value={q}
          onChangeText={setQ}
          placeholder="Search journal…"
          placeholderTextColor={colors.textTertiary}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
      </View>

      {/* Kind / category filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipsRow}
        contentContainerStyle={styles.chipsContent}
      >
        {FILTERS.map((f) => (
          <Pressable
            key={f.id}
            onPress={() => setFilter(f.id)}
            style={[styles.chip, filter === f.id && styles.chipActive]}
          >
            <Text style={[styles.chipText, filter === f.id && styles.chipTextActive]}>
              {f.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* People filter (only when journal has people) */}
      {journal.people.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.peopleChipsRow}
          contentContainerStyle={styles.chipsContent}
        >
          <Pressable
            onPress={() => setPersonId(null)}
            style={[styles.chip, personId === null && styles.chipActive]}
          >
            <Text style={[styles.chipText, personId === null && styles.chipTextActive]}>
              Everyone
            </Text>
          </Pressable>
          {journal.people.map((p) => (
            <Pressable
              key={p.id}
              onPress={() => setPersonId(p.id)}
              style={[styles.chip, personId === p.id && styles.chipActive]}
            >
              <Text style={[styles.chipText, personId === p.id && styles.chipTextActive]}>
                {p.name}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [colors, fonts, filter, q, personId, journal.people, styles]);

  // ── render ─────────────────────────────────────────────────────────────────

  const hasAnyData = allEntries(journal).length > 0;
  const hasFilteredData = feedItems.some((i) => i.type === "day");

  if (!hasAnyData) {
    return (
      <View style={styles.empty}>
        <KindIcon kind="book" size={48} color={colors.textTertiary} accessibilityLabel="" />
        <Text style={styles.emptyTitle}>Your chronicle is empty</Text>
        <View style={styles.emptyHintRow}>
          <Text style={styles.emptyHint}>Tap</Text>
          <Ionicons name="layers-outline" size={16} color={colors.textTertiary} />
          <Text style={styles.emptyHint}>above to add your first entries.</Text>
        </View>
        <Text style={styles.emptyExplainer}>
          Chronicle is a passive journal. Rather than writing entries yourself, Chronicle builds your journal by importing data already on your phone — calendar events, photos, and more. You can also import CSV files from services like Goodreads or Netflix.
        </Text>
        <Text style={[styles.emptyExplainer, { marginTop: spacingScale.md, color: colors.textTertiary }]}>
          Data imported into Chronicle never leaves your phone. Your journal is stored only on this device.
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.list}
      data={feedItems}
      keyExtractor={(item) => item.key}
      renderItem={({ item }) => {
        if (item.type === "month") {
          return (
            <MonthHeader
              label={item.label}
              iconCounts={item.iconCounts}
              colors={colors}
              fonts={fonts}
            />
          );
        }
        return (
          <DayGroup
            group={item.group}
            colors={colors}
            fonts={fonts}
            onEntryPress={(entry) => router.push(`/entry/${entry.id}`)}
          />
        );
      }}
      ListHeaderComponent={listHeader}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.emptyHint}>No entries match your search.</Text>
        </View>
      }
      // Only draw hairline separators between consecutive day rows —
      // month headers have their own top/bottom borders.
      ItemSeparatorComponent={({ leadingItem }) =>
        leadingItem.type === "day" ? <View style={styles.daySeparator} /> : null
      }
      contentContainerStyle={[styles.content, !hasFilteredData && { flex: 1 }]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      removeClippedSubviews
    />
  );
}
