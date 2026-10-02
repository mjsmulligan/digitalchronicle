/**
 * People tab — all people in the journal, sorted by name.
 * Shows the journal owner (isSelf) first with a crown badge.
 */
import { useMemo } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useJournal, allEntries } from "@chronicle/journal/db";
import type { Person } from "@chronicle/journal/types";

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
  list: { flex: 1, backgroundColor: "#0f172a" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#1e293b",
    gap: 12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#334155",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarSelf: { backgroundColor: "#312e81" },
  avatarText: { color: "#e2e8f0", fontSize: 14, fontWeight: "700" },
  rowBody: { flex: 1 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { color: "#f1f5f9", fontSize: 15, fontWeight: "500" },
  selfBadge: {
    color: "#a5b4fc",
    fontSize: 10,
    fontWeight: "700",
    backgroundColor: "#1e1b4b",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: "hidden",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  aliases: { color: "#64748b", fontSize: 12, marginTop: 2 },
  rowPressed: { backgroundColor: "#1a2535" },
  count: { color: "#64748b", fontSize: 12 },
  chevron: { color: "#334155", fontSize: 20, lineHeight: 44 },
  empty: {
    flex: 1,
    backgroundColor: "#0f172a",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyTitle: { color: "#f1f5f9", fontSize: 18, fontWeight: "600", marginBottom: 8 },
  emptyHint: { color: "#64748b", fontSize: 14, textAlign: "center", lineHeight: 20 },
});
