/**
 * Trips tab — all trips, sorted newest-first.
 * Each card shows date range, title, purpose, and a leg/stay/event count.
 */
import { useMemo } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useJournal, allEntries } from "@chronicle/journal/db";
import type { Trip } from "@chronicle/journal/types";

// ── helpers ──────────────────────────────────────────────────────────────────

function nights(trip: Trip): number {
  return Math.max(
    0,
    Math.round((+new Date(trip.end) - +new Date(trip.start)) / 86_400_000)
  );
}

const PURPOSE_ICON: Record<string, string> = {
  leisure: "🌴",
  work: "💼",
  family: "👨‍👩‍👧",
  other: "📌",
};

// ── component ─────────────────────────────────────────────────────────────────

function TripCard({ trip, entryCount }: { trip: Trip; entryCount: number }) {
  const n = nights(trip);
  const router = useRouter();
  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={() => router.push(`/trip/${trip.id}`)}
    >
      <View style={styles.cardHeader}>
        <Text style={styles.dateRange}>
          {trip.start} → {trip.end}
        </Text>
        {trip.purpose && (
          <Text style={styles.purposeIcon}>
            {PURPOSE_ICON[trip.purpose] ?? "📌"}
          </Text>
        )}
      </View>
      <Text style={styles.tripTitle}>{trip.title}</Text>
      <View style={styles.meta}>
        <Text style={styles.metaText}>
          {n} {n === 1 ? "night" : "nights"}
        </Text>
        <Text style={styles.metaDot}>·</Text>
        <Text style={styles.metaText}>
          {entryCount} {entryCount === 1 ? "entry" : "entries"}
        </Text>
      </View>
    </Pressable>
  );
}

// ── screen ───────────────────────────────────────────────────────────────────

export default function TripsScreen() {
  const journal = useJournal();

  const trips = useMemo(() => {
    const entries = allEntries(journal);
    const countById = new Map<string, number>();
    for (const e of entries) {
      if (e.tripId) countById.set(e.tripId, (countById.get(e.tripId) ?? 0) + 1);
    }
    return [...journal.trips]
      .sort((a, b) => b.start.localeCompare(a.start))
      .map((t) => ({ trip: t, entryCount: countById.get(t.id) ?? 0 }));
  }, [journal]);

  if (!trips.length) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyIcon}>✈️</Text>
        <Text style={styles.emptyTitle}>No trips yet</Text>
        <Text style={styles.emptyHint}>
          Import a Viaduct or iCalendar file to populate your trips.
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.listContent}
      data={trips}
      keyExtractor={({ trip }) => trip.id}
      renderItem={({ item: { trip, entryCount } }) => (
        <TripCard trip={trip} entryCount={entryCount} />
      )}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
    />
  );
}

// ── styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: "#0f172a" },
  listContent: { padding: 16 },
  card: {
    backgroundColor: "#1e293b",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#334155",
  },
  cardPressed: { opacity: 0.7 },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  dateRange: { color: "#64748b", fontSize: 12, fontFamily: "monospace" },
  purposeIcon: { fontSize: 16 },
  tripTitle: { color: "#f1f5f9", fontSize: 20, fontWeight: "600", marginBottom: 8 },
  meta: { flexDirection: "row", gap: 6 },
  metaText: { color: "#94a3b8", fontSize: 13 },
  metaDot: { color: "#475569", fontSize: 13 },
  separator: { height: 12 },
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
