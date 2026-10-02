/**
 * Person detail screen — profile + all entries they participated in.
 */
import { useMemo } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useJournal, allEntries } from "@chronicle/journal/db";
import { entryTitle, view, type Entry, type Person } from "@chronicle/journal/types";

// ── helpers ───────────────────────────────────────────────────────────────────

function entryEmoji(e: Entry): string {
  if (e.kind === "leg") return e.mode === "air" ? "✈️" : e.mode === "rail" ? "🚂" : "🚗";
  if (e.kind === "stay") return "🏨";
  if (e.kind === "film") return "🎬";
  if (e.kind === "episode") return "📺";
  if (e.kind === "book") return "📖";
  const cat = (e as Extract<Entry, { kind: "event" }>).category;
  return cat === "concert" ? "🎵" : cat === "celebration" ? "🎉" : cat === "milestone" ? "🏆" : "📍";
}

// ── components ────────────────────────────────────────────────────────────────

function EntryItem({ entry }: { entry: Entry }) {
  const v = view(entry);
  const router = useRouter();
  return (
    <Pressable
      style={({ pressed }) => [styles.entryRow, pressed && styles.entryRowPressed]}
      onPress={() => router.push(`/entry/${entry.id}`)}
    >
      <Text style={styles.entryEmoji}>{entryEmoji(entry)}</Text>
      <View style={styles.entryBody}>
        <Text style={styles.entryTitle} numberOfLines={1}>{entryTitle(v)}</Text>
        <Text style={styles.entryDate}>{entry.start.slice(0, 10)}</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

// ── screen ────────────────────────────────────────────────────────────────────

export default function PersonDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const journal = useJournal();

  const person = useMemo<Person | undefined>(
    () => journal.people.find((p) => p.id === id),
    [journal, id]
  );

  const entries = useMemo<Entry[]>(() => {
    if (!person) return [];
    return allEntries(journal)
      .filter((e) => e.participants?.includes(person.id))
      .sort((a, b) => b.start.localeCompare(a.start));
  }, [journal, person]);

  if (!person) {
    return (
      <View style={styles.notFound}>
        <Stack.Screen options={{ title: "Person" }} />
        <Text style={styles.notFoundText}>Person not found</Text>
      </View>
    );
  }

  const initials = person.name
    .split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.content}
      data={entries}
      keyExtractor={(e) => e.id}
      renderItem={({ item }) => <EntryItem entry={item} />}
      ListHeaderComponent={
        <>
          <Stack.Screen
            options={{
              title: "",
              headerStyle: { backgroundColor: "#1e293b" },
              headerTintColor: "#f8fafc",
              headerShadowVisible: false,
            }}
          />
          {/* Profile card */}
          <View style={styles.profileCard}>
            <View style={[styles.avatar, person.isSelf && styles.avatarSelf]}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
            <View style={styles.profileBody}>
              <View style={styles.nameRow}>
                <Text style={styles.name}>{person.name}</Text>
                {person.isSelf && <Text style={styles.selfBadge}>you</Text>}
              </View>
              {person.aliases?.length ? (
                <Text style={styles.aliases}>{person.aliases.join(", ")}</Text>
              ) : null}
              {person.notes ? (
                <Text style={styles.notes}>{person.notes}</Text>
              ) : null}
            </View>
          </View>

          {entries.length > 0 && (
            <Text style={styles.sectionLabel}>
              {entries.length} shared {entries.length === 1 ? "entry" : "entries"}
            </Text>
          )}
        </>
      }
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No shared entries yet.</Text>
        </View>
      }
    />
  );
}

// ── styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: "#0f172a" },
  content: { padding: 16, paddingBottom: 48 },

  profileCard: {
    backgroundColor: "#1e293b",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#334155",
    padding: 20,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 16,
    marginBottom: 20,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#334155",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarSelf: { backgroundColor: "#312e81" },
  avatarText: { color: "#e2e8f0", fontSize: 18, fontWeight: "700" },
  profileBody: { flex: 1 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  name: { color: "#f1f5f9", fontSize: 20, fontWeight: "700" },
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
  aliases: { color: "#64748b", fontSize: 13, marginBottom: 4 },
  notes: { color: "#94a3b8", fontSize: 14, lineHeight: 20, marginTop: 4 },

  sectionLabel: {
    color: "#64748b",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 8,
  },

  entryRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1e293b",
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    gap: 12,
    borderWidth: 1,
    borderColor: "#334155",
  },
  entryRowPressed: { opacity: 0.7 },
  entryEmoji: { fontSize: 18 },
  entryBody: { flex: 1 },
  entryTitle: { color: "#f1f5f9", fontSize: 14, fontWeight: "500", marginBottom: 2 },
  entryDate: { color: "#64748b", fontSize: 12 },
  chevron: { color: "#334155", fontSize: 20 },

  empty: { paddingTop: 24, alignItems: "center" },
  emptyText: { color: "#475569", fontSize: 14 },

  notFound: { flex: 1, backgroundColor: "#0f172a", alignItems: "center", justifyContent: "center" },
  notFoundText: { color: "#64748b", fontSize: 16 },
});
