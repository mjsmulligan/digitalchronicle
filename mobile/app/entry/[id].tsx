/**
 * Entry detail screen — view-only for all entry kinds.
 * Reached by tapping any row in the Chronicle feed.
 */
import { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useJournal, allEntries } from "@chronicle/journal/db";
import { view, CATEGORY_LABEL, type Entry, type Leg, type Stay, type JEvent, type Film, type Episode, type Book } from "@chronicle/journal/types";

// ── helpers ───────────────────────────────────────────────────────────────────

function fmt(date: string): string {
  // YYYY-MM-DD or YYYY-MM-DDTHH:mm → readable
  const d = date.slice(0, 10);
  const t = date.length > 10 ? date.slice(11, 16) : null;
  const [y, m, day] = d.split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const label = `${parseInt(day)} ${months[parseInt(m) - 1]} ${y}`;
  return t ? `${label} ${t}` : label;
}

function stars(rating: number): string {
  const filled = Math.round(rating / 2);
  return "★".repeat(filled) + "☆".repeat(5 - filled);
}

function sourceLabel(source?: string): string {
  const map: Record<string, string> = {
    letterboxd: "Letterboxd",
    netflix: "Netflix",
    goodreads: "Goodreads",
    viaduct: "Viaduct",
    "setlist.fm": "Setlist.fm",
    manual: "Manual",
  };
  return source ? (map[source] ?? source) : "Unknown";
}

function modeLabel(mode: Leg["mode"]): string {
  return mode === "air" ? "✈️ Flight" : mode === "rail" ? "🚂 Train" : "🚗 Drive";
}

// ── field components ──────────────────────────────────────────────────────────

function Field({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

// ── per-kind detail blocks ────────────────────────────────────────────────────

function LegDetail({ e }: { e: Leg }) {
  const v = view(e);
  if (v.kind !== "leg") return null;
  return (
    <>
      <Text style={styles.title}>{v.fromName ?? v.from} → {v.toName ?? v.to}</Text>
      <Text style={styles.subtitle}>{modeLabel(v.mode)}</Text>
      <Divider />
      <Field label="Date" value={fmt(v.start)} />
      {v.end && <Field label="Arrival" value={fmt(v.end)} />}
      <Field label="From" value={v.fromName ? `${v.fromName} (${v.from})` : v.from} />
      <Field label="To" value={v.toName ? `${v.toName} (${v.to})` : v.to} />
      <Field label="Flight" value={v.flightNumber} />
      <Field label="Aircraft" value={v.aircraft} />
      <Field label="Operator" value={v.operator} />
      <Field label="Train" value={v.trainNumber} />
      <Field label="Seat" value={v.seat} />
    </>
  );
}

function StayDetail({ e }: { e: Stay }) {
  const v = view(e);
  if (v.kind !== "stay") return null;
  return (
    <>
      <Text style={styles.title}>{v.place}</Text>
      <Text style={styles.subtitle}>🏨 Stay{v.city ? ` · ${v.city}` : ""}</Text>
      <Divider />
      <Field label="Check-in" value={fmt(v.start)} />
      {v.end && <Field label="Check-out" value={fmt(v.end)} />}
      <Field label="City" value={v.city} />
      <Field label="Notes" value={(e as Stay).notes} />
    </>
  );
}

function FilmDetail({ e }: { e: Film }) {
  const v = view(e);
  if (v.kind !== "film") return null;
  return (
    <>
      <Text style={styles.title}>{v.title}{v.year ? ` (${v.year})` : ""}</Text>
      <Text style={styles.subtitle}>🎬 Film</Text>
      {v.rating !== undefined && (
        <Text style={styles.rating}>{stars(v.rating)} {(v.rating / 2).toFixed(1)}</Text>
      )}
      <Divider />
      <Field label="Watched" value={fmt(v.start)} />
      <Field label="Director" value={v.director} />
      {e.rewatch && <Field label="Rewatch" value="Yes" />}
    </>
  );
}

function EpisodeDetail({ e }: { e: Episode }) {
  const v = view(e);
  if (v.kind !== "episode") return null;
  return (
    <>
      <Text style={styles.title}>{v.episodeTitle ?? v.showTitle}</Text>
      <Text style={styles.subtitle}>📺 {v.showTitle}{v.season ? ` · ${v.season}` : ""}</Text>
      {v.rating !== undefined && (
        <Text style={styles.rating}>{stars(v.rating)} {(v.rating / 2).toFixed(1)}</Text>
      )}
      <Divider />
      <Field label="Watched" value={fmt(v.start)} />
      <Field label="Show" value={v.showTitle} />
      <Field label="Season" value={v.season} />
      {e.episodeNumber != null && (
        <Field label="Episode" value={String(e.episodeNumber)} />
      )}
    </>
  );
}

function BookDetail({ e }: { e: Book }) {
  const v = view(e);
  if (v.kind !== "book") return null;
  return (
    <>
      <Text style={styles.title}>{v.title}</Text>
      <Text style={styles.subtitle}>📖 {v.author}</Text>
      {v.rating !== undefined && (
        <Text style={styles.rating}>{stars(v.rating)} {(v.rating / 2).toFixed(1)}</Text>
      )}
      <Divider />
      <Field label="Date read" value={fmt(v.start)} />
      {e.dateStarted && <Field label="Started" value={fmt(e.dateStarted)} />}
      <Field label="Author" value={v.author} />
      {v.year != null && <Field label="Published" value={String(v.year)} />}
      <Field label="Series" value={e.series ? (e.seriesNumber != null ? `${e.series} #${e.seriesNumber}` : e.series) : undefined} />
    </>
  );
}

function EventDetail({ e }: { e: JEvent }) {
  const v = view(e);
  if (v.kind !== "event") return null;
  const emoji = v.category === "concert" ? "🎵" : v.category === "celebration" ? "🎉" : v.category === "milestone" ? "🏆" : "📍";
  return (
    <>
      <Text style={styles.title}>{v.artist}</Text>
      <Text style={styles.subtitle}>{emoji} {CATEGORY_LABEL[v.category]}</Text>
      <Divider />
      <Field label="Date" value={fmt(v.start)} />
      <Field label="Venue" value={v.venue} />
      <Field label="City" value={v.city} />
      <Field label="Country" value={e.country} />
      {v.category === "concert" && <Field label="Tour" value={e.tour} />}
    </>
  );
}

// ── screen ────────────────────────────────────────────────────────────────────

export default function EntryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const journal = useJournal();

  const entry = useMemo<Entry | undefined>(
    () => allEntries(journal).find((e) => e.id === id),
    [journal, id]
  );

  if (!entry) {
    return (
      <View style={styles.notFound}>
        <Stack.Screen options={{ title: "Entry" }} />
        <Text style={styles.notFoundText}>Entry not found</Text>
      </View>
    );
  }

  const participants = entry.participants
    ?.map((pid) => journal.people.find((p) => p.id === pid)?.name ?? pid)
    .join(", ");

  const reflection = entry.reflection ?? (entry as any).journal;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Stack.Screen
        options={{
          title: "",
          headerStyle: { backgroundColor: "#1e293b" },
          headerTintColor: "#f8fafc",
          headerShadowVisible: false,
        }}
      />

      <View style={styles.card}>
        {entry.kind === "leg"     && <LegDetail e={entry as Leg} />}
        {entry.kind === "stay"    && <StayDetail e={entry as Stay} />}
        {entry.kind === "film"    && <FilmDetail e={entry as Film} />}
        {entry.kind === "episode" && <EpisodeDetail e={entry as Episode} />}
        {entry.kind === "book"    && <BookDetail e={entry as Book} />}
        {entry.kind === "event"   && <EventDetail e={entry as JEvent} />}
      </View>

      {/* Reflection */}
      {reflection && (
        <View style={styles.reflectionCard}>
          <Text style={styles.reflectionLabel}>Reflection</Text>
          <Text style={styles.reflectionText}>{reflection}</Text>
        </View>
      )}

      {/* People */}
      {participants && (
        <View style={styles.metaCard}>
          <Field label="With" value={participants} />
        </View>
      )}

      {/* Source */}
      <View style={styles.metaCard}>
        <Field label="Source" value={sourceLabel(entry.source)} />
        {entry.sourceRef && <Field label="Ref" value={entry.sourceRef} />}
      </View>
    </ScrollView>
  );
}

// ── styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a" },
  content: { padding: 16, paddingBottom: 48, gap: 12 },

  card: {
    backgroundColor: "#1e293b",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#334155",
    padding: 20,
    gap: 4,
  },
  title: { color: "#f1f5f9", fontSize: 20, fontWeight: "700", marginBottom: 2 },
  subtitle: { color: "#94a3b8", fontSize: 14, marginBottom: 4 },
  rating: { color: "#f59e0b", fontSize: 16, marginBottom: 4 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: "#334155", marginVertical: 12 },
  field: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingVertical: 5, gap: 16 },
  fieldLabel: { color: "#64748b", fontSize: 13, fontWeight: "600", minWidth: 80 },
  fieldValue: { color: "#e2e8f0", fontSize: 14, flex: 1, textAlign: "right" },

  reflectionCard: {
    backgroundColor: "#1e293b",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#334155",
    padding: 20,
    gap: 8,
  },
  reflectionLabel: { color: "#64748b", fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8 },
  reflectionText: { color: "#e2e8f0", fontSize: 15, lineHeight: 22 },

  metaCard: {
    backgroundColor: "#1e293b",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#334155",
    paddingHorizontal: 20,
    paddingVertical: 8,
  },

  notFound: { flex: 1, backgroundColor: "#0f172a", alignItems: "center", justifyContent: "center" },
  notFoundText: { color: "#64748b", fontSize: 16 },
});
