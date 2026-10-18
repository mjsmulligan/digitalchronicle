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
import { useCallback, useMemo, useRef, useState } from "react";
import { FlatList, LayoutChangeEvent, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useJournal, allEntries, hideMany, markReviewed, storeFor } from "@chronicle/journal/db";
import { type Entry, type JEvent, type Leg, type Person, entryTitle } from "@chronicle/journal/types";
import { useDialog, Dialog } from "../../src/components/Dialog";
import { useTheme, type ThemeColors, type ThemeFonts, text as textScale, spacing as spacingScale, radius as radiusScale } from "../../src/components/ThemeProvider";
import { KindIcon } from "../../src/components/KindIcon";
import { DayGroup, type DayGroupData } from "../../src/components/DayGroup";
import { MonthHeader, type IconCount } from "../../src/components/MonthHeader";

// ── filter types & helpers ────────────────────────────────────────────────────

type F = "all" | "travel" | "film" | "episode" | "book" | "concert" | "social" | "milestone" | "memory";

const FILTERS: { id: F; label: string }[] = [
  { id: "all",       label: "Everything" },
  { id: "travel",    label: "Travel" },
  { id: "film",      label: "Films" },
  { id: "episode",   label: "TV" },
  { id: "book",      label: "Books" },
  { id: "concert",   label: "Concerts" },
  { id: "social",    label: "Gatherings" },
  { id: "milestone", label: "Milestones" },
  { id: "memory",    label: "Memories" },
];

/** Icon to show for each kind filter button. `null` = render "All" as text. */
const FILTER_ICONS: Record<F, { kind: string; subkind?: string } | null> = {
  all:       null,
  travel:    { kind: "leg",     subkind: "air" },
  film:      { kind: "film" },
  episode:   { kind: "episode" },
  book:      { kind: "book" },
  concert:   { kind: "event",   subkind: "concert" },
  social:    { kind: "event",   subkind: "gathering" },
  milestone: { kind: "event",   subkind: "milestone" },
  memory:    { kind: "event",   subkind: "memory" },
};

/** Short label shown in the active-filter pill. */
const FILTER_SHORT: Record<F, string> = {
  all:       "Everything",
  travel:    "Travel",
  film:      "Films",
  episode:   "TV",
  book:      "Books",
  concert:   "Concerts",
  social:    "Gatherings",
  milestone: "Milestones",
  memory:    "Memories",
};

/** Mirror of web `matches()` in src/routes/index.tsx */
function matchesFilter(e: Entry, f: F): boolean {
  if (f === "all")     return true;
  if (f === "travel")  return e.kind === "leg" || e.kind === "stay";
  if (f === "film")    return e.kind === "film";
  if (f === "episode") return e.kind === "episode";
  if (f === "book")    return e.kind === "book";
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
    // Outer container — wraps the optional filter pill + the list
    screenContainer: { flex: 1, backgroundColor: colors.bg },
    list:    { flex: 1, backgroundColor: colors.bg },
    content: { paddingBottom: spacingScale["3xl"] },

    // Hairline separator between day groups
    daySeparator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.borderFaint,
      marginHorizontal: spacingScale.base,
    },

    // ── Active-filter pill (fixed, only shown when something is filtered) ──

    filterPill: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.surfaceAccentDeep,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      paddingHorizontal: spacingScale.base,
      paddingVertical: spacingScale.sm2,
      gap: spacingScale.sm,
    },
    filterPillText: {
      flex: 1,
      ...textScale.sm,
      fontFamily: fonts.mono,
      color: colors.accentSoft,
    },

    // ── Search panel (pull-to-reveal list header) ──────────────────────────

    searchPanel: {
      backgroundColor: colors.bg,
      paddingTop: spacingScale.xl,
      paddingHorizontal: spacingScale.base,
      paddingBottom: spacingScale.base,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },

    // Underline-only search field — no box, just a ruled line like a notebook
    searchFieldWrap: {
      flexDirection: "row",
      alignItems: "center",
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      paddingBottom: spacingScale.sm,
      marginBottom: spacingScale.base,
      gap: spacingScale.sm,
    },
    searchInput: {
      flex: 1,
      fontFamily: fonts.serifMedium,
      ...textScale.lg,
      color: colors.textPrimary,
      padding: 0,
    },

    // Kind filter — row of icon buttons, no chip borders
    kindRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacingScale.lg,
    },
    kindAllText: {
      ...textScale.xs,
      fontFamily: fonts.mono,
      fontWeight: "700",
      letterSpacing: 0.8,
      textTransform: "uppercase" as const,
    },
    kindBtn: {
      paddingVertical: spacingScale.sm2,
    },
    // Person toggle pushed to the right end of the kind row
    kindBtnPerson: {
      marginLeft: "auto",
    },

    // People filter — minimal name tags below the kind row
    peopleRow: {
      flexGrow: 0,
      marginTop: spacingScale.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.borderFaint,
    },
    personChip: {
      paddingHorizontal: spacingScale.md,
      paddingVertical: spacingScale.xs,
      borderRadius: radiusScale.pill,
      borderWidth: 1,
      borderColor: colors.borderFaint,
    },
    personChipActive: {
      borderColor: colors.accentSoft,
      backgroundColor: colors.surfaceAccentDeep,
    },
    personChipText: {
      ...textScale.xs,
      fontFamily: fonts.mono,
      color: colors.textSecondary,
    },
    personChipTextActive: { color: colors.accentSoft },

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
  const dialog = useDialog();

  // ── long-press: Keep / Hide quick actions for unreviewed entries ──────────
  const handleEntryLongPress = useCallback((entry: Entry) => {
    if (!entry.unreviewed) return;
    dialog.show({
      title: entryTitle(entry),
      message: entry.unreviewed === "new"
        ? "Mark as reviewed, or hide this entry."
        : "This entry was updated by a later import. Mark as reviewed, or hide it.",
      actions: [
        {
          label: "Keep",
          style: "default" as const,
          onPress: () => void markReviewed(storeFor(entry), [entry.id]).catch(() => {}),
        },
        {
          label: "Hide",
          style: "destructive" as const,
          onPress: () => void hideMany(storeFor(entry), [entry.id]).catch(() => {}),
        },
      ],
      lockBackdrop: false,
    });
  }, [dialog]);

  // ── filter / search state ──────────────────────────────────────────────────
  const [filter, setFilter]     = useState<F>("all");
  const [q, setQ]               = useState("");
  const [personId, setPersonId] = useState<string | null>(null);
  // People row is hidden until the person icon is tapped (or a person is active)
  const [showPeopleRow, setShowPeopleRow] = useState(false);

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
        // Title-case month name: "October · 2026"
        const monthName = new Date(Number(yearStr), Number(monthStr) - 1, 1)
          .toLocaleString("en-US", { month: "long" });
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

  // ── pull-to-reveal refs ────────────────────────────────────────────────────

  const listRef = useRef<FlatList>(null);
  const headerHeightRef = useRef(0);
  const initialScrolled = useRef(false);

  /**
   * Fires once when the search panel is laid out.
   * Scrolls it off-screen so the journal opens clean.
   */
  const onHeaderLayout = useCallback((e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    headerHeightRef.current = h;
    if (!initialScrolled.current && h > 0) {
      initialScrolled.current = true;
      // RAF ensures the FlatList has committed its layout before we scroll
      requestAnimationFrame(() => {
        listRef.current?.scrollToOffset({ offset: h, animated: false });
      });
    }
  }, []);

  /** Animate back to the top to reveal the search panel. */
  const revealSearch = useCallback(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, []);

  /** Clear all active filters and search query. */
  const clearFilter = useCallback(() => {
    setFilter("all");
    setPersonId(null);
    setQ("");
    setShowPeopleRow(false);
  }, []);

  // ── active-filter pill ─────────────────────────────────────────────────────

  const pillLabel = useMemo(() => {
    if (q.trim()) return `"${q.trim().slice(0, 28)}"`;
    if (filter !== "all") return FILTER_SHORT[filter];
    if (selectedPerson) return selectedPerson.name;
    return "";
  }, [q, filter, selectedPerson]);

  const isFiltered = pillLabel.length > 0;

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

  // ── search panel (pull-to-reveal list header) ──────────────────────────────
  //
  // Lives at scroll position 0. The journal always opens scrolled past it.
  // The user pulls down to the top to reveal it; the active-filter pill is
  // the persistent breadcrumb that shows something is active and taps to
  // scroll back up.

  const searchPanel = (
    <View style={styles.searchPanel} onLayout={onHeaderLayout}>

      {/* Underline-only search field — a single ruled line, not a box */}
      <View style={styles.searchFieldWrap}>
        <TextInput
          style={styles.searchInput}
          value={q}
          onChangeText={setQ}
          placeholder="Search your journal…"
          placeholderTextColor={colors.textTertiary}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
        />
        {q.length > 0 && (
          <Pressable onPress={() => setQ("")} hitSlop={8}>
            <Ionicons name="close" size={16} color={colors.textTertiary} />
          </Pressable>
        )}
      </View>

      {/* Kind filter — icon buttons + person toggle at the end */}
      <View style={styles.kindRow}>
        {FILTERS.map((f) => {
          const ic = FILTER_ICONS[f.id];
          const active = filter === f.id;
          return (
            <Pressable
              key={f.id}
              style={styles.kindBtn}
              onPress={() => setFilter(f.id)}
              accessibilityLabel={f.label}
            >
              {ic === null ? (
                <Text style={[styles.kindAllText, { color: active ? colors.accentSoft : colors.textMuted }]}>
                  All
                </Text>
              ) : (
                <KindIcon
                  kind={ic.kind}
                  subkind={ic.subkind}
                  size={18}
                  color={active ? colors.accentSoft : colors.textMuted}
                  accessibilityLabel=""
                />
              )}
            </Pressable>
          );
        })}

        {/* Person toggle — only shown when journal has people */}
        {journal.people.length > 0 && (
          <Pressable
            style={[styles.kindBtn, styles.kindBtnPerson]}
            onPress={() => setShowPeopleRow((v) => !v)}
            accessibilityLabel="Filter by person"
          >
            <Ionicons
              name={personId !== null ? "people" : "people-outline"}
              size={18}
              color={(showPeopleRow || personId !== null) ? colors.accentSoft : colors.textMuted}
            />
          </Pressable>
        )}
      </View>

      {/* People row — revealed by tapping the person icon, or when a person filter is active */}
      {journal.people.length > 0 && (showPeopleRow || personId !== null) && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.peopleRow}
          contentContainerStyle={{ paddingTop: spacingScale.sm, gap: spacingScale.sm, flexDirection: "row" }}
        >
          <Pressable
            onPress={() => setPersonId(null)}
            style={[styles.personChip, personId === null && styles.personChipActive]}
          >
            <Text style={[styles.personChipText, personId === null && styles.personChipTextActive]}>
              Everyone
            </Text>
          </Pressable>
          {journal.people.map((p) => (
            <Pressable
              key={p.id}
              onPress={() => setPersonId(p.id)}
              style={[styles.personChip, personId === p.id && styles.personChipActive]}
            >
              <Text style={[styles.personChipText, personId === p.id && styles.personChipTextActive]}>
                {p.name}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );

  return (
    <>
    <View style={styles.screenContainer}>
      {/* Active-filter pill — fixed between nav bar and list.
          Only visible when a filter or search is on; tapping scrolls to reveal
          the search panel, the × clears everything. */}
      {isFiltered && (
        <Pressable style={styles.filterPill} onPress={revealSearch}>
          <Ionicons name="funnel-outline" size={12} color={colors.accentSoft} />
          <Text style={styles.filterPillText} numberOfLines={1}>{pillLabel}</Text>
          <Pressable onPress={clearFilter} hitSlop={8}>
            <Ionicons name="close" size={14} color={colors.accentSoft} />
          </Pressable>
        </Pressable>
      )}

      <FlatList
        ref={listRef}
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
              onEntryLongPress={handleEntryLongPress}
            />
          );
        }}
        ListHeaderComponent={searchPanel}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyHint}>No entries match your search.</Text>
          </View>
        }
        // Only draw hairlines between consecutive day rows —
        // month headers have their own top/bottom borders.
        ItemSeparatorComponent={({ leadingItem }) =>
          leadingItem.type === "day" ? <View style={styles.daySeparator} /> : null
        }
        contentContainerStyle={[styles.content, !hasFilteredData && { flex: 1 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        removeClippedSubviews
      />
    </View>
    <Dialog {...dialog.props} onDismiss={dialog.dismiss} />
    </>
  );
}
