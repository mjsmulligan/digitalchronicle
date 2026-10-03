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
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useJournal, allEntries } from "@chronicle/journal/db";
import { type Entry, type Note, type JEvent, type Person, entryTitle } from "@chronicle/journal/types";
import { useTheme, type ThemeColors, type ThemeFonts, text as textScale, spacing as spacingScale, radius as radiusScale } from "../../src/components/ThemeProvider";
import { KindIcon } from "../../src/components/KindIcon";
import { DayGroup, type DayGroupData } from "../../src/components/DayGroup";

// ── filter types & helpers ────────────────────────────────────────────────────

type F = "all" | "travel" | "concert" | "social" | "milestone" | "memory" | "notes";

const FILTERS: { id: F; label: string }[] = [
  { id: "all",       label: "Everything" },
  { id: "travel",    label: "Travel" },
  { id: "concert",   label: "Concerts" },
  { id: "social",    label: "Gatherings & celebrations" },
  { id: "milestone", label: "Milestones" },
  { id: "memory",    label: "Memories" },
  { id: "notes",     label: "Reflections" },
];

/** Mirror of web `matches()` in src/routes/index.tsx */
function matchesFilter(e: Entry, f: F): boolean {
  if (f === "all") return true;
  if (f === "travel") return e.kind === "leg" || e.kind === "stay";
  if (f === "notes") return false; // notes filter: entries are excluded, notes-only days shown
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
      ...textScale.xl,
      fontFamily: fonts.serifSemiBold,
      fontWeight: "600",
      color: colors.textPrimary,
      marginTop: spacingScale.base,
      marginBottom: spacingScale.sm,
    },
    emptyHint: { ...textScale.md, color: colors.textTertiary, textAlign: "center" },
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

  // ── day groups with filter/search/person applied ───────────────────────────
  //
  // Mirrors the web logic in src/routes/index.tsx exactly:
  //   Pass 1 — collect filtered entries into a day map
  //   Pass 2 — decide which days get their notes attached
  //     • filter==="all": all note days (after search + person guard)
  //     • filter==="notes": all note days (ignores entries; people filter suppresses)
  //     • other filters: only days that already have matched entries
  const groups = useMemo<DayGroupData[]>(() => {
    const qLower = q.trim().toLowerCase();

    // Build day → note map (day-level notes only, not trip notes)
    const noteByDay = new Map<string, Note>();
    for (const n of journal.notes) {
      if (n.date && !n.tripId) noteByDay.set(n.date, n);
    }

    // Resolve trip for each day by date range (mirrors web `tripOf`)
    const tripOf = (d: string) =>
      journal.trips.find((t) => d >= t.start && d <= t.end);

    // ── Pass 1: build day → matched-entries map ──────────────────────────
    const entryMap = new Map<string, Entry[]>();

    if (filter !== "notes") {
      const entries = allEntries(journal);
      for (const e of entries) {
        if (!matchesFilter(e, filter)) continue;
        if (selectedPerson && !entryHasPerson(e, selectedPerson)) continue;
        if (qLower && !entryTitle(e).toLowerCase().includes(qLower)) continue;
        const d = (e.overrides?.start ?? e.start).slice(0, 10);
        if (!entryMap.has(d)) entryMap.set(d, []);
        entryMap.get(d)!.push(e);
      }
    }

    // ── Pass 2: decide which note days to include ────────────────────────
    const daySet = new Set(entryMap.keys());

    if (filter === "all" || filter === "notes") {
      // Include all note days (after search/person guard)
      for (const [date, note] of noteByDay) {
        if (selectedPerson) continue; // notes have no participants
        if (qLower && !note.text.toLowerCase().includes(qLower)) {
          // q doesn't match note text — include day only if it already has entries
          if (!daySet.has(date)) continue;
        }
        daySet.add(date);
      }
    }
    // For other kind filters: note days are only included for days that already
    // have matched entries (daySet already contains those from Pass 1).

    // ── Build result groups ──────────────────────────────────────────────
    return [...daySet]
      .sort((a, b) => b.localeCompare(a))  // newest day first
      .map((iso) => ({
        iso,
        items: entryMap.get(iso) ?? [],
        tripTitle: tripOf(iso)?.title,
        note: noteByDay.get(iso),
      }));
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

  const hasAnyData = allEntries(journal).length > 0 || journal.notes.length > 0;

  if (!hasAnyData) {
    return (
      <View style={styles.empty}>
        <KindIcon kind="book" size={48} color={colors.textTertiary} accessibilityLabel="" />
        <Text style={styles.emptyTitle}>Your journal is empty</Text>
        <Text style={styles.emptyHint}>
          Tap the import icon above to add your first entries.
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.list}
      data={groups}
      keyExtractor={(g) => g.iso}
      renderItem={({ item: group }) => (
        <DayGroup
          group={group}
          colors={colors}
          fonts={fonts}
          onEntryPress={(entry) => router.push(`/entry/${entry.id}`)}
        />
      )}
      ListHeaderComponent={listHeader}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.emptyHint}>No entries match your search.</Text>
        </View>
      }
      ItemSeparatorComponent={() => <View style={styles.daySeparator} />}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      removeClippedSubviews
    />
  );
}
