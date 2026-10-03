/**
 * People tab — all people in the journal, sorted by name.
 * Shows the journal owner (isSelf) first with a crown badge.
 */
import { useMemo } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useJournal, allEntries } from "@chronicle/journal/db";
import type { Person } from "@chronicle/journal/types";
import { colors, text, spacing, radius } from "../../src/theme";

// ── helpers ──────────────────────────────────────────────────────────────────

function entryCountFor(personId: string, entries: ReturnType<typeof allEntries>): number {
  return entries.filter((e) => e.participants?.includes(personId)).length;
}

// ── components ────────────────────────────────────────────────────────────────

function PersonRow({
  person,
  entryCount,
}: {
  person: Person;
  entryCount: number;
}) {
  const initials = person.name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const router = useRouter();

  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={() => router.push(`/person/${person.id}`)}
    >
      <View style={[styles.avatar, person.isSelf && styles.avatarSelf]}>
        <Text style={styles.avatarText}>{initials}</Text>
      </View>
      <View style={styles.rowBody}>
        <View style={styles.nameRow}>
          <Text style={styles.name}>{person.name}</Text>
          {person.isSelf && <Text style={styles.selfBadge}>you</Text>}
        </View>
        {person.aliases?.length ? (
          <Text style={styles.aliases} numberOfLines={1}>
            {person.aliases.join(", ")}
          </Text>
        ) : null}
      </View>
      {entryCount > 0 && (
        <Text style={styles.count}>
          {entryCount} {entryCount === 1 ? "entry" : "entries"}
        </Text>
      )}
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

// ── screen ───────────────────────────────────────────────────────────────────

export default function PeopleScreen() {
  const journal = useJournal();

  const sorted = useMemo(() => {
    const entries = allEntries(journal);
    return [...journal.people]
      .sort((a, b) => {
        if (a.isSelf && !b.isSelf) return -1;
        if (!a.isSelf && b.isSelf) return 1;
        return a.name.localeCompare(b.name);
      })
      .map((p) => ({ person: p, entryCount: entryCountFor(p.id, entries) }));
  }, [journal]);

  if (!sorted.length) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyIcon}>👤</Text>
        <Text style={styles.emptyTitle}>No people yet</Text>
        <Text style={styles.emptyHint}>
          Tap the import icon above to add people from a .vcf or contacts CSV file.
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.list}
      data={sorted}
      keyExtractor={({ person }) => person.id}
      renderItem={({ item: { person, entryCount } }) => (
        <PersonRow person={person} entryCount={entryCount} />
      )}
    />
  );
}

// ── styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: colors.bg },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderFaint,
    gap: spacing.md,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarSelf: { backgroundColor: colors.surfaceAccent },
  avatarText: { color: colors.textDim, fontSize: 14, fontWeight: "700" },
  rowBody: { flex: 1 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  name: { ...text.base, color: colors.textPrimary, fontWeight: "500" },
  selfBadge: {
    color: colors.accentBadge,
    fontSize: 10,
    fontWeight: "700",
    backgroundColor: colors.surfaceAccentDeep,
    paddingHorizontal: spacing.sm2,
    paddingVertical: 2,
    borderRadius: radius.sm,
    overflow: "hidden",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  aliases: { ...text.sm, color: colors.textTertiary, marginTop: 2 },
  rowPressed: { backgroundColor: colors.surfacePressed },
  count: { ...text.sm, color: colors.textTertiary },
  chevron: { fontSize: 20, lineHeight: 44, color: colors.border },
  empty: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing["2xl"],
  },
  emptyIcon: { fontSize: 48, marginBottom: spacing.base },
  emptyTitle: { fontSize: 18, fontWeight: "600", color: colors.textPrimary, marginBottom: spacing.sm },
  emptyHint: { ...text.md, color: colors.textTertiary, textAlign: "center" },
});
