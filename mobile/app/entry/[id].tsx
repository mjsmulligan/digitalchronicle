/**
 * Entry detail screen — view-only for all entry kinds.
 * Reached by tapping any row in the Chronicle feed.
 */
import { useMemo, useState } from "react";
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useJournal, allEntries } from "@chronicle/journal/db";
import { view, CATEGORY_LABEL, type Entry, type Leg, type Stay, type JEvent, type Film, type Episode, type Book, type PlaceEvent, type PlaceEntry } from "@chronicle/journal/types";
import { useTheme } from "../../src/components/ThemeProvider";
import { KindIcon, StarRating } from "../../src/components/KindIcon";
import { SourceMark } from "../../src/components/SourceMark";

// ── helpers ───────────────────────────────────────────────────────────────────

function fmt(date: string): string {
  const d = date.slice(0, 10);
  const t = date.length > 10 ? date.slice(11, 16) : null;
  const [y, m, day] = d.split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const label = `${parseInt(day)} ${months[parseInt(m) - 1]} ${y}`;
  return t ? `${label} ${t}` : label;
}

function modeLabel(mode: Leg["mode"]): string {
  return mode === "air" ? "Flight" : mode === "rail" ? "Train" : "Drive";
}

function sourceLabel(source?: string): string {
  const map: Record<string, string> = {
    letterboxd:       "Letterboxd",
    netflix:          "Netflix",
    goodreads:        "Goodreads",
    viaduct:          "Viaduct",
    "setlist.fm":     "Setlist.fm",
    "photo-library":  "Photo library",
    manual:           "Manual",
  };
  return source ? (map[source] ?? source) : "Unknown";
}

// ── shared prop types ─────────────────────────────────────────────────────────

type DetailStyles = {
  title: object;
  subtitleRow: object;
  subtitle: object;
  ratingRow: object;
  ratingNum: object;
  divider: object;
  field: object;
  fieldLabel: object;
  fieldValue: object;
};

type IconColors = { secondary: string; star: string };

// ── field components ──────────────────────────────────────────────────────────

function Field({ label, value, styles }: { label: string; value?: string | null; styles: DetailStyles }) {
  if (!value) return null;
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </View>
  );
}

function Divider({ styles }: { styles: Pick<DetailStyles, "divider"> }) {
  return <View style={styles.divider} />;
}

// ── per-kind detail blocks ────────────────────────────────────────────────────

function LegDetail({ e, styles, ic }: { e: Leg; styles: DetailStyles; ic: IconColors }) {
  const v = view(e);
  if (v.kind !== "leg") return null;
  return (
    <>
      <Text style={styles.title}>{v.fromName ?? v.from} {"→"} {v.toName ?? v.to}</Text>
      <View style={styles.subtitleRow}>
        <KindIcon kind="leg" subkind={v.mode} size={15} color={ic.secondary} />
        <Text style={styles.subtitle}>{modeLabel(v.mode)}</Text>
      </View>
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

function StayDetail({ e, styles, ic }: { e: Stay; styles: DetailStyles; ic: IconColors }) {
  const v = view(e);
  if (v.kind !== "stay") return null;
  return (
    <>
      <Text style={styles.title}>{v.place}</Text>
      <View style={styles.subtitleRow}>
        <KindIcon kind="stay" size={15} color={ic.secondary} />
        <Text style={styles.subtitle}>Stay{v.city ? ` · ${v.city}` : ""}</Text>
      </View>
      <Divider styles={styles} />
      <Field label="Check-in" value={fmt(v.start)} styles={styles} />
      {v.end && <Field label="Check-out" value={fmt(v.end)} styles={styles} />}
      <Field label="City" value={v.city} styles={styles} />
      <Field label="Notes" value={(e as Stay).notes} styles={styles} />
    </>
  );
}

function FilmDetail({ e, styles, ic }: { e: Film; styles: DetailStyles; ic: IconColors }) {
  const v = view(e);
  if (v.kind !== "film") return null;
  return (
    <>
      <Text style={styles.title}>{v.title}{v.year ? ` (${v.year})` : ""}</Text>
      <View style={styles.subtitleRow}>
        <KindIcon kind="film" size={15} color={ic.secondary} />
        <Text style={styles.subtitle}>Film</Text>
      </View>
      {v.rating !== undefined && (
        <View style={styles.ratingRow}>
          <StarRating rating={v.rating} color={ic.star} size={14} />
          <Text style={styles.ratingNum}>{(v.rating / 2).toFixed(1)}</Text>
        </View>
      )}
      <Divider styles={styles} />
      <Field label="Watched" value={fmt(v.start)} styles={styles} />
      <Field label="Director" value={v.director} styles={styles} />
      {e.rewatch && <Field label="Rewatch" value="Yes" styles={styles} />}
    </>
  );
}

function EpisodeDetail({ e, styles, ic }: { e: Episode; styles: DetailStyles; ic: IconColors }) {
  const v = view(e);
  if (v.kind !== "episode") return null;
  return (
    <>
      <Text style={styles.title}>{v.episodeTitle ?? v.showTitle}</Text>
      <View style={styles.subtitleRow}>
        <KindIcon kind="episode" size={15} color={ic.secondary} />
        <Text style={styles.subtitle}>{v.showTitle}{v.season ? ` · ${v.season}` : ""}</Text>
      </View>
      {v.rating !== undefined && (
        <View style={styles.ratingRow}>
          <StarRating rating={v.rating} color={ic.star} size={14} />
          <Text style={styles.ratingNum}>{(v.rating / 2).toFixed(1)}</Text>
        </View>
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

function BookDetail({ e, styles, ic }: { e: Book; styles: DetailStyles; ic: IconColors }) {
  const v = view(e);
  if (v.kind !== "book") return null;
  return (
    <>
      <Text style={styles.title}>{v.title}</Text>
      <View style={styles.subtitleRow}>
        <KindIcon kind="book" size={15} color={ic.secondary} />
        <Text style={styles.subtitle}>{v.author}</Text>
      </View>
      {v.rating !== undefined && (
        <View style={styles.ratingRow}>
          <StarRating rating={v.rating} color={ic.star} size={14} />
          <Text style={styles.ratingNum}>{(v.rating / 2).toFixed(1)}</Text>
        </View>
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

function PlaceDetail({ e, styles, ic }: { e: PlaceEvent; styles: DetailStyles; ic: IconColors }) {
  const v = view(e);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  if (v.kind !== "place") return null;
  const evidence = v.photoEvidence?.filter((r) => !r.missing && r.uri) ?? [];
  return (
    <>
      <Text style={styles.title}>{v.locality}{v.country ? `, ${v.country}` : ""}</Text>
      <View style={styles.subtitleRow}>
        <KindIcon kind="place" size={15} color={ic.secondary} />
        <Text style={styles.subtitle}>Place{v.region ? ` · ${v.region}` : ""}</Text>
      </View>
      <Divider styles={styles} />
      <Field label="From"    value={v.start?.slice(0, 10)}                          styles={styles} />
      <Field label="To"      value={v.end?.slice(0, 10)}                            styles={styles} />
      <Field label="Region"  value={v.region}                                        styles={styles} />
      <Field label="Country" value={v.country}                                       styles={styles} />
      <Field label="Photos"  value={v.photoCount ? String(v.photoCount) : undefined} styles={styles} />
      {evidence.length > 0 && (
        <>
          <Divider styles={styles} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -16 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 6 }}>
            {evidence.map((ref) => (
              <Pressable
                key={ref.mediaId}
                onPress={() => ref.uri && setPreviewUri(ref.uri)}
                style={{ borderRadius: 8, overflow: "hidden" }}
              >
                <Image source={{ uri: ref.uri }} style={{ width: 80, height: 80 }} resizeMode="cover" />
              </Pressable>
            ))}
          </ScrollView>
        </>
      )}
      <Modal visible={!!previewUri} transparent animationType="fade" onRequestClose={() => setPreviewUri(null)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.95)", justifyContent: "center" }} onPress={() => setPreviewUri(null)}>
          <Image source={{ uri: previewUri ?? "" }} style={{ width: "100%", height: "80%" }} resizeMode="contain" />
        </Pressable>
      </Modal>
    </>
  );
}

function PlaceEntryDetail({
  e, place, styles, ic,
}: {
  e: PlaceEntry;
  place?: { locality: string; region?: string; country?: string };
  styles: DetailStyles;
  ic: IconColors;
}) {
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const evidence = e.photoEvidence.filter((r) => !r.missing && r.uri);

  // Derive a readable name from localityKey as fallback ("gb:county-donegal" → "County Donegal")
  const fallbackName = e.localityKey
    .slice(e.localityKey.indexOf(":") + 1)
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  const locality = place?.locality ?? fallbackName;
  const country  = place?.country;
  const region   = place?.region;

  return (
    <>
      <Text style={styles.title}>{locality}{country ? `, ${country}` : ""}</Text>
      <View style={styles.subtitleRow}>
        <KindIcon kind="place" size={15} color={ic.secondary} />
        <Text style={styles.subtitle}>Place{region ? ` · ${region}` : ""}</Text>
      </View>
      <Divider styles={styles} />
      <Field label="Date"    value={e.localDay}                                   styles={styles} />
      <Field label="Region"  value={region}                                        styles={styles} />
      <Field label="Country" value={country}                                       styles={styles} />
      <Field label="Photos"  value={e.photoCount ? String(e.photoCount) : undefined} styles={styles} />
      {evidence.length > 0 && (
        <>
          <Divider styles={styles} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -16 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 6 }}>
            {evidence.map((ref) => (
              <Pressable
                key={ref.mediaId}
                onPress={() => ref.uri && setPreviewUri(ref.uri)}
                style={{ borderRadius: 8, overflow: "hidden" }}
              >
                <Image source={{ uri: ref.uri }} style={{ width: 80, height: 80 }} resizeMode="cover" />
              </Pressable>
            ))}
          </ScrollView>
        </>
      )}
      <Modal visible={!!previewUri} transparent animationType="fade" onRequestClose={() => setPreviewUri(null)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.95)", justifyContent: "center" }} onPress={() => setPreviewUri(null)}>
          <Image source={{ uri: previewUri ?? "" }} style={{ width: "100%", height: "80%" }} resizeMode="contain" />
        </Pressable>
      </Modal>
    </>
  );
}

function EventDetail({ e, styles, ic }: { e: JEvent; styles: DetailStyles; ic: IconColors }) {
  const v = view(e);
  if (v.kind !== "event") return null;
  return (
    <>
      <Text style={styles.title}>{v.artist}</Text>
      <View style={styles.subtitleRow}>
        <KindIcon kind="event" subkind={v.category} size={15} color={ic.secondary} />
        <Text style={styles.subtitle}>{CATEGORY_LABEL[v.category]}</Text>
      </View>
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
    title:       { ...text.pageTitle, fontFamily: fonts.serifBold, fontWeight: "700", color: colors.textPrimary, marginBottom: 2 },
    subtitleRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
    subtitle:    { ...text.md, color: colors.textSecondary },
    ratingRow:   { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
    ratingNum:   { ...text.sm, color: colors.star },
    divider:     { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: spacing.md },
    field:       { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingVertical: 5, gap: spacing.base },
    fieldLabel:  { ...text.smMd, fontFamily: fonts.mono, color: colors.textTertiary, fontWeight: "600", minWidth: 80 },
    fieldValue:  { ...text.md, color: colors.textDim, flex: 1, textAlign: "right" },

    reflectionCard: {
      backgroundColor: colors.surface,
      borderRadius: radius["2xl"],
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.lg,
      gap: spacing.sm,
    },
    reflectionLabel: { ...text.label, fontFamily: fonts.mono, color: colors.textTertiary },
    reflectionText:  { ...text.base, fontFamily: fonts.serifRegular, color: colors.textDim },

    metaCard: {
      backgroundColor: colors.surface,
      borderRadius: radius["2xl"],
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
    },
    sourceFieldRow: { flexDirection: "row", alignItems: "center", paddingVertical: 5, gap: spacing.base },
    sourceValue:    { flexDirection: "row", alignItems: "center", gap: 6, flex: 1, justifyContent: "flex-end" },

    notFound:     { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
    notFoundText: { ...text.lg, color: colors.textTertiary },
  }), [colors, fonts]);

  const ic = useMemo<IconColors>(
    () => ({ secondary: colors.textSecondary, star: colors.star }),
    [colors],
  );

  const entry = useMemo<Entry | undefined>(
    () => allEntries(journal).find((e) => e.id === id),
    [journal, id]
  );

  // For place-entry kind, look up the Place container for canonical name/region/country
  const placeContainer = useMemo(() => {
    if (!entry || entry.kind !== "place-entry") return undefined;
    return (journal.localityPlaces ?? []).find((p) => p.id === (entry as PlaceEntry).placeId);
  }, [entry, journal.localityPlaces]);

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
        {entry.kind === "leg"         && <LegDetail         e={entry as Leg}        styles={styles} ic={ic} />}
        {entry.kind === "stay"        && <StayDetail        e={entry as Stay}       styles={styles} ic={ic} />}
        {entry.kind === "place"       && <PlaceDetail       e={entry as PlaceEvent} styles={styles} ic={ic} />}
        {entry.kind === "place-entry" && <PlaceEntryDetail  e={entry as PlaceEntry} place={placeContainer} styles={styles} ic={ic} />}
        {entry.kind === "film"        && <FilmDetail        e={entry as Film}       styles={styles} ic={ic} />}
        {entry.kind === "episode"     && <EpisodeDetail     e={entry as Episode}    styles={styles} ic={ic} />}
        {entry.kind === "book"        && <BookDetail        e={entry as Book}       styles={styles} ic={ic} />}
        {entry.kind === "event"       && <EventDetail       e={entry as JEvent}     styles={styles} ic={ic} />}
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
        <View style={styles.sourceFieldRow}>
          <Text style={styles.fieldLabel}>Source</Text>
          <View style={styles.sourceValue}>
            <SourceMark source={entry.source ?? ""} size={18} />
            <Text style={styles.fieldValue} numberOfLines={1}>{sourceLabel(entry.source)}</Text>
          </View>
        </View>
        {entry.sourceRef && <Field label="Ref" value={entry.sourceRef} styles={styles} />}
      </View>
    </ScrollView>
  );
}
