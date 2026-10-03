/**
 * Entry detail screen — view-only for all entry kinds.
 * Reached by tapping any row in the Chronicle feed.
 */
import { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useJournal, allEntries } from "@chronicle/journal/db";
import { view, CATEGORY_LABEL, type Entry, type Leg, type Stay, type JEvent, type Film, type Episode, type Book } from "@chronicle/journal/types";
import { useTheme } from "../../src/components/ThemeProvider";

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

function Field({ label, value, styles }: { label: string; value?: string | null; styles: { field: object; fieldLabel: object; fieldValue: object } }) {
  if (!value) return null;
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </View>
  );
}

function Divider({ styles }: { styles: { divider: object } }) {
  return <View style={styles.divider} />;
}

// ── per-kind detail blocks ────────────────────────────────────────────────────

type DetailStyles = {
  title: object; subtitle: object; rating: object; divider: object;
  field: object; fieldLabel: object; fieldValue: object;
};

function LegDetail({ e, styles }: { e: Leg; styles: DetailStyles }) {
  const v = view(e);
  if (v.kind !== "leg") return null;
  return (
    <>
      <Text style={styles.title}>{v.fromName ?? v.from} {"→"} {v.toName ?? v.to}</Text>
      <Text style={styles.subtitle}>{modeLabel(v.mode)}</Text>
      <Divider styles={styles} />
      <Field label="Date" value={fmt(v.start)} styles={styles} />
      {v.end && <Field label="Arrival" value={fmt(v.end)} styles={styles} />}
      <Field label="From" value={v.fromName ? `${v.fromName} (${v.from})` : v.from} styles={styles} />
      <Field label="To" value={v.toName ? `${v.toName} (${v.to})` : v.to} styles={styles} />
      <Field label="Flight" value={v.flightNumber} styles={styles} />
      <Field label="Aircraft" value={v.aircraft} styles={styles} />
      <Field label="Operator" value={v.operator} styles={styles} />
      <Field label="Train" value={v.trainNumber} styles={styles} />
      <Field label="Seat" value={v.seat} styles={styles} />
    </>
  );
}

function StayDetail({ e, styles }: { e: Stay; styles: DetailStyles }) {
  const v = view(e);
  if (v.kind !== "stay") return null;
  return (
    <>
      <Text style={styles.title}>{v.place}</Text>
      <Text style={styles.subtitle}>🏨 Stay{v.city ? ` · ${v.city}` : ""}</Text>
      <Divider styles={styles} />
      <Field label="Check-in" value={fmt(v.start)} styles={styles} />
      {v.end && <Field label="Check-out" value={fmt(v.end)} styles={styles} />}
      <Field label="City" value={v.city} styles={styles} />
      <Field label="Notes" value={(e as Stay).notes} styles={styles} />
    </>
  );
}

function FilmDetail({ e, styles }: { e: Film; styles: DetailStyles }) {
  const v = view(e);
  if (v.kind !== "film") return null;
  return (
    <>
      <Text style={styles.title}>{v.title}{v.year ? ` (${v.year})` : ""}</Text>
      <Text style={styles.subtitle}>🎬 Film</Text>
      {v.rating !== undefined && (
        <Text style={styles.rating}>{stars(v.rating)} {(v.rating / 2).toFixed(1)}</Text>
      )}
      <Divider styles={styles} />
      <Field label="Watched" value={fmt(v.start)} styles={styles} />
      <Field label="Director" value={v.director} styles={styles} />
      {e.rewatch && <Field label="Rewatch" value="Yes" styles={styles} />}
    </>
  );
}

function EpisodeDetail({ e, styles }: { e: Episode; styles: DetailStyles }) {
  const v = view(e);
  if (v.kind !== "episode") return null;
  return (
    <>
      <Text style={styles.title}>{v.episodeTitle ?? v.showTitle}</Text>
      <Text style={styles.subtitle}>📺 {v.showTitle}{v.season ? ` · ${v.season}` : ""}</Text>
      {v.rating !== undefined && (
        <Text style={styles.rating}>{stars(v.rating)} {(v.rating / 2).toFixed(1)}</Text>
      )}
      <Divider styles={styles} />
      <Field label="Watched" value={fmt(v.start)} styles={styles} />
      <Field label="Show" value={v.showTitle} styles={styles} />
      <Field label="Season" value={v.season} styles={styles} />
      {e.episodeNumber != null && (
        <Field label="Episode" value={String(e.episodeNumber)} styles={styles} />
      )}
    </>
  );
}

function BookDetail({ e, styles }: { e: Book; styles: DetailStyles }) {
  const v = view(e);
  if (v.kind !== "book") return null;
  return (
    <>
      <Text style={styles.title}>{v.title}</Text>
      <Text style={styles.subtitle}>📖 {v.author}</Text>
      {v.rating !== undefined && (
        <Text style={styles.rating}>{stars(v.rating)} {(v.rating / 2).toFixed(1)}</Text>
      )}
      <Divider styles={styles} />
      <Field label="Date read" value={fmt(v.start)} styles={styles} />
      {e.dateStarted && <Field label="Started" value={fmt(e.dateStarted)} styles={styles} />}
      <Field label="Author" value={v.author} styles={styles} />
      {v.year != null && <Field label="Published" value={String(v.year)} styles={styles} />}
      <Field label="Series" value={e.series ? (e.seriesNumber != null ? `${e.series} #${e.seriesNumber}` : e.series) : undefined} styles={styles} />
    </>
  );
}

function EventDetail({ e, styles }: { e: JEvent; styles: DetailStyles }) {
  const v = view(e);
  if (v.kind !== "event") return null;
  const emoji = v.category === "concert" ? "🎵" : v.category === "celebration" ? "🎉" : v.category === "milestone" ? "🏆" : "📍";
  return (
    <>
      <Text style={styles.title}>{v.artist}</Text>
      <Text style={styles.subtitle}>{emoji} {CATEGORY_LABEL[v.category]}</Text>
      <Divider styles={styles} />
      <Field label="Date" value={fmt(v.start)} styles={styles} />
      <Field label="Venue" value={v.venue} styles={styles} />
      <Field label="City" value={v.city} styles={styles} />
      <Field label="Country" value={e.country} styles={styles} />
      {v.category === "concert" && <Field label="Tour" value={e.tour} styles={styles} />}
    </>
  );
}

// ── screen ────────────────────────────────────────────────────────────────────

export default function EntryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const journal = useJournal();
  const { colors, fonts, text, spacing, radius, common } = useTheme();

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    content: { padding: spacing.base, paddingBottom: spacing["3xl"], gap: spacing.md },

    card: {
      backgroundColor: colors.surface,
      borderRadius: radius["2xl"],
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.lg,
      gap: 4,
    },
    title: { ...text.pageTitle, fontFamily: fonts.serifBold, fontWeight: "700", color: colors.textPrimary, marginBottom: 2 },
    subtitle: { ...text.md, color: colors.textSecondary, marginBottom: 4 },
    rating: { ...text.lg, color: colors.star, marginBottom: 4 },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: spacing.md },
    field: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingVertical: 5, gap: spacing.base },
    fieldLabel: { ...text.smMd, fontFamily: fonts.mono, color: colors.textTertiary, fontWeight: "600", minWidth: 80 },
    fieldValue: { ...text.md, color: colors.textDim, flex: 1, textAlign: "right" },

    reflectionCard: {
      backgroundColor: colors.surface,
      borderRadius: radius["2xl"],
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.lg,
      gap: spacing.sm,
    },
    reflectionLabel: { ...text.label, fontFamily: fonts.mono, color: colors.textTertiary },
    reflectionText: { ...text.base, fontFamily: fonts.serifRegular, color: colors.textDim },

    metaCard: {
      backgroundColor: colors.surface,
      borderRadius: radius["2xl"],
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
    },

    notFound: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
    notFoundText: { ...text.lg, color: colors.textTertiary },
  }), [colors, fonts]);

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
      <Stack.Screen options={{ title: "", ...common.header }} />

      <View style={styles.card}>
        {entry.kind === "leg"     && <LegDetail e={entry as Leg} styles={styles} />}
        {entry.kind === "stay"    && <StayDetail e={entry as Stay} styles={styles} />}
        {entry.kind === "film"    && <FilmDetail e={entry as Film} styles={styles} />}
        {entry.kind === "episode" && <EpisodeDetail e={entry as Episode} styles={styles} />}
        {entry.kind === "book"    && <BookDetail e={entry as Book} styles={styles} />}
        {entry.kind === "event"   && <EventDetail e={entry as JEvent} styles={styles} />}
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
          <Field label="With" value={participants} styles={styles} />
        </View>
      )}

      {/* Source */}
      <View style={styles.metaCard}>
        <Field label="Source" value={sourceLabel(entry.source)} styles={styles} />
        {entry.sourceRef && <Field label="Ref" value={entry.sourceRef} styles={styles} />}
      </View>
    </ScrollView>
  );
}
