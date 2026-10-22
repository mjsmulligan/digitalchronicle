/**
 * Entry detail screen — view-only for all entry kinds.
 * Reached by tapping any row in the Chronicle feed.
 *
 * WP-E1/E2 — Edit button in header routes to entry/edit/[id].tsx
 * WP-E3    — Merge action shows same-day entries; merges two into one.
 */
import { useEffect, useMemo, useState } from "react";
import { FlatList, Image, ImageBackground, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { PosterCard } from "../../src/components/PosterCard";
import { eventToArtworkKey, bookToArtworkKey } from "@chronicle/journal/artwork";
import { resolveArtwork, resolveBookCoverForEntry, resolveArtistImage } from "@chronicle/journal/artworkEnrichment";
import { getArtworkProvider } from "@chronicle/journal/artworkProvider";
import { getBookCoverProvider } from "@chronicle/journal/bookCoverProvider";
import { LinearGradient } from "expo-linear-gradient";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useJournal, allEntries, putMany, removeMany, hideMany, saveUserEdit, storeFor, markReviewed } from "@chronicle/journal/db";
import { ParticipantPicker } from "../../src/components/ParticipantPicker";
import { TripPicker } from "../../src/components/TripPicker";
import { view, CATEGORY_LABEL, entryTitle, codeToCity, type Entry, type Leg, type Stay, type JEvent, type Film, type Episode, type Book, type PlaceEvent, type PlaceEntry, type Tier } from "@chronicle/journal/types";
import { mergeEntries } from "@chronicle/journal/merge";
import { isLocked } from "@chronicle/journal/evaluation";
import { useTheme } from "../../src/components/ThemeProvider";
import { KindIcon, StarRating } from "../../src/components/KindIcon";
import { SourceMark } from "../../src/components/SourceMark";
import { useDialog, Dialog } from "../../src/components/Dialog";
import { Ionicons } from "@expo/vector-icons";

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Convert a 6-char hex colour to rgba with the given alpha.
 * Used to build multi-step gradient overlays without expo-linear-gradient.
 */
function hexAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
}

/** True for entry kinds that get the hero image treatment. */
function isMediaEntry(entry: Entry): boolean {
  if (entry.kind === "film" || entry.kind === "episode" || entry.kind === "book") return true;
  if (entry.kind === "event") return (entry as JEvent).category === "concert";
  return false;
}

/**
 * Resolves the hero image URI for media entries (film, TV, book, concert).
 * Accepts undefined so it can be called unconditionally before entry loads.
 * Returns null while loading, when entry is undefined, or when no artwork found.
 */
function useHeroUri(entry: Entry | undefined): string | null {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    if (!entry || !isMediaEntry(entry)) { setUri(null); return; }
    let cancelled = false;
    (async () => {
      try {
        let resolved: string | null = null;
        if (entry.kind === "film" || entry.kind === "episode") {
          const key = eventToArtworkKey(entry);
          if (key) {
            const match = await resolveArtwork(key);
            const provider = getArtworkProvider();
            if (match?.poster_path && provider) resolved = provider.imageUrl(match.poster_path);
          }
        } else if (entry.kind === "book") {
          const match = await resolveBookCoverForEntry(entry as Book);
          const provider = getBookCoverProvider();
          if (match?.poster_path && provider) resolved = provider.imageUrl(match.poster_path);
        } else if (entry.kind === "event" && (entry as JEvent).category === "concert") {
          const match = await resolveArtistImage((entry as JEvent).artist ?? "");
          if (match?.poster_path) resolved = match.poster_path.replace(/ /g, "%20");
        }
        if (!cancelled) setUri(resolved);
      } catch { /* leave as null */ }
    })();
    return () => { cancelled = true; };
  }, [entry?.id]);
  return uri;
}


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
  title: StyleProp<TextStyle>;
  subtitleRow: StyleProp<ViewStyle>;
  subtitle: StyleProp<TextStyle>;
  ratingRow: StyleProp<ViewStyle>;
  ratingNum: StyleProp<TextStyle>;
  divider: StyleProp<ViewStyle>;
  field: StyleProp<ViewStyle>;
  fieldLabel: StyleProp<TextStyle>;
  fieldValue: StyleProp<TextStyle>;
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

function LegDetail({ e, styles, iconColors }: { e: Leg; styles: DetailStyles; iconColors: IconColors }) {
  const v = view(e);
  if (v.kind !== "leg") return null;
  // "Dublin (DUB)" when the city name differs from the code; bare code/name when it doesn't.
  const locLabel = (code: string, name?: string) => {
    const city = name ?? codeToCity(code);
    return city !== code ? `${city} (${code})` : city;
  };
  return (
    <>
      <Text style={styles.title}>{v.fromName ?? codeToCity(v.from)} {"→"} {v.toName ?? codeToCity(v.to)}</Text>
      <View style={styles.subtitleRow}>
        <KindIcon kind="leg" subkind={v.mode} size={15} color={iconColors.secondary} />
        <Text style={styles.subtitle}>{modeLabel(v.mode)}</Text>
      </View>
      <Divider styles={styles} />
      <Field label="Date" value={fmt(v.start)} styles={styles} />
      {v.end && <Field label="Arrival" value={fmt(v.end)} styles={styles} />}
      <Field label="From" value={locLabel(v.from, v.fromName)} styles={styles} />
      <Field label="To"   value={locLabel(v.to,   v.toName)}   styles={styles} />
      <Field label="Flight" value={v.flightNumber} styles={styles} />
      <Field label="Aircraft" value={v.aircraft} styles={styles} />
      <Field label="Operator" value={v.operator} styles={styles} />
      <Field label="Train" value={v.trainNumber} styles={styles} />
      <Field label="Seat" value={v.seat} styles={styles} />
    </>
  );
}

function StayDetail({ e, styles, iconColors }: { e: Stay; styles: DetailStyles; iconColors: IconColors }) {
  const v = view(e);
  if (v.kind !== "stay") return null;
  return (
    <>
      <Text style={styles.title}>{v.place}</Text>
      <View style={styles.subtitleRow}>
        <KindIcon kind="stay" size={15} color={iconColors.secondary} />
        <Text style={styles.subtitle}>Stay{v.city ? ` · ${v.city}` : ""}</Text>
      </View>
      <Divider styles={styles} />
      <Field label="Check-in" value={fmt(v.start)} styles={styles} />
      {v.end && <Field label="Check-out" value={fmt(v.end)} styles={styles} />}
      <Field label="City" value={v.city} styles={styles} />
      <Field label="Notes" value={e.reflection} styles={styles} />
    </>
  );
}

function FilmDetail({ e, styles, iconColors, showPoster = true }: { e: Film; styles: DetailStyles; iconColors: IconColors; showPoster?: boolean }) {
  const v = view(e);
  if (v.kind !== "film") return null;
  const artworkKey = eventToArtworkKey(e);
  return (
    <>
      <Text style={styles.title}>{v.title}{v.year ? ` (${v.year})` : ""}</Text>
      <View style={styles.subtitleRow}>
        <KindIcon kind="film" size={15} color={iconColors.secondary} />
        <Text style={styles.subtitle}>Film</Text>
      </View>
      {v.rating !== undefined && (
        <View style={styles.ratingRow}>
          <StarRating rating={v.rating} color={iconColors.star} size={14} />
          <Text style={styles.ratingNum}>{(v.rating / 2).toFixed(1)}</Text>
        </View>
      )}
      {showPoster && artworkKey && <PosterCard artworkKey={artworkKey} title={v.title} />}
      <Divider styles={styles} />
      <Field label="Watched" value={fmt(v.start)} styles={styles} />
      <Field label="Director" value={v.director} styles={styles} />
      {e.rewatch && <Field label="Rewatch" value="Yes" styles={styles} />}
    </>
  );
}

function EpisodeDetail({ e, styles, iconColors, showPoster = true }: { e: Episode; styles: DetailStyles; iconColors: IconColors; showPoster?: boolean }) {
  const v = view(e);
  if (v.kind !== "episode") return null;
  const artworkKey = eventToArtworkKey(e);
  return (
    <>
      <Text style={styles.title}>{v.episodeTitle ?? v.showTitle}</Text>
      <View style={styles.subtitleRow}>
        <KindIcon kind="episode" size={15} color={iconColors.secondary} />
        <Text style={styles.subtitle}>{v.showTitle}{v.season ? ` · ${v.season}` : ""}</Text>
      </View>
      {v.rating !== undefined && (
        <View style={styles.ratingRow}>
          <StarRating rating={v.rating} color={iconColors.star} size={14} />
          <Text style={styles.ratingNum}>{(v.rating / 2).toFixed(1)}</Text>
        </View>
      )}
      {showPoster && artworkKey && <PosterCard artworkKey={artworkKey} title={v.showTitle} />}
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

function BookDetail({ e, styles, iconColors, showPoster = true }: { e: Book; styles: DetailStyles; iconColors: IconColors; showPoster?: boolean }) {
  const v = view(e);
  if (v.kind !== "book") return null;
  const artworkKey = bookToArtworkKey(e);
  return (
    <>
      <Text style={styles.title}>{v.title}</Text>
      <View style={styles.subtitleRow}>
        <KindIcon kind="book" size={15} color={iconColors.secondary} />
        <Text style={styles.subtitle}>{v.author}</Text>
      </View>
      {v.rating !== undefined && (
        <View style={styles.ratingRow}>
          <StarRating rating={v.rating} color={iconColors.star} size={14} />
          <Text style={styles.ratingNum}>{(v.rating / 2).toFixed(1)}</Text>
        </View>
      )}
      {showPoster && artworkKey && <PosterCard artworkKey={artworkKey} title={v.title} bookEntry={e} />}
      <Divider styles={styles} />
      <Field label="Date read" value={fmt(v.start)} styles={styles} />
      {e.dateStarted && <Field label="Started" value={fmt(e.dateStarted)} styles={styles} />}
      <Field label="Author" value={v.author} styles={styles} />
      {v.year != null && <Field label="Published" value={String(v.year)} styles={styles} />}
      <Field label="Series" value={e.series ? (e.seriesNumber != null ? `${e.series} #${e.seriesNumber}` : e.series) : undefined} styles={styles} />
    </>
  );
}

function PlaceDetail({ e, styles, iconColors }: { e: PlaceEvent; styles: DetailStyles; iconColors: IconColors }) {
  const v = view(e);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  if (v.kind !== "place") return null;
  const evidence = v.photoEvidence?.filter((r) => !r.missing && r.uri) ?? [];
  return (
    <>
      <Text style={styles.title}>{v.locality}{v.country ? `, ${v.country}` : ""}</Text>
      <View style={styles.subtitleRow}>
        <KindIcon kind="place" size={15} color={iconColors.secondary} />
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
  e, place, styles, iconColors,
}: {
  e: PlaceEntry;
  place?: { locality: string; region?: string; country?: string };
  styles: DetailStyles;
  iconColors: IconColors;
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
        <KindIcon kind="place" size={15} color={iconColors.secondary} />
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

function EventDetail({ e, styles, iconColors, showPoster = true }: { e: JEvent; styles: DetailStyles; iconColors: IconColors; showPoster?: boolean }) {
  const v = view(e);
  if (v.kind !== "event") return null;
  const isConcert = v.category === "concert";
  return (
    <>
      <Text style={styles.title}>{v.artist}</Text>
      <View style={styles.subtitleRow}>
        <KindIcon kind="event" subkind={v.category} size={15} color={iconColors.secondary} />
        <Text style={styles.subtitle}>{CATEGORY_LABEL[v.category]}</Text>
      </View>
      {/* Artist photo for concerts — resolves from TheAudioDB / Deezer */}
      {showPoster && isConcert && v.artist && (
        <PosterCard artworkKey="" title={v.artist} artistName={v.artist} />
      )}
      <Divider styles={styles} />
      <Field label="Date" value={fmt(v.start)} styles={styles} />
      <Field label="Venue" value={v.venue} styles={styles} />
      <Field label="City" value={v.city} styles={styles} />
      <Field label="Country" value={e.country} styles={styles} />
      {isConcert && <Field label="Tour" value={e.tour} styles={styles} />}
    </>
  );
}

// ── editable kinds ────────────────────────────────────────────────────────────

const EDITABLE_KINDS = new Set(["leg", "stay", "event", "film", "episode", "book"]);

// ── screen ────────────────────────────────────────────────────────────────────

export default function EntryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const journal = useJournal();
  const { colors, fonts, text, spacing, radius, common } = useTheme();
  const dialog = useDialog();
  const [mergeVisible, setMergeVisible] = useState(false);
  const [mergeSaving, setMergeSaving] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [tripPickerVisible, setTripPickerVisible] = useState(false);
  const { width: screenW, height: screenH } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  // Resolve entry early so heroIsPortrait can be computed before useState
  const entry = useMemo<Entry | undefined>(
    () => allEntries(journal).find((e) => e.id === id),
    [journal, id]
  );

  /**
   * Concert artist images (Deezer/TADB) are square (1:1).
   * TMDB film/TV/book posters are portrait (2:3).
   * We size the hero to match the natural aspect ratio so resizeMode="cover"
   * requires zero cropping.
   */
  const heroIsPortrait =
    entry?.kind === "film" || entry?.kind === "episode" || entry?.kind === "book";

  // Actual image ratio (w/h). Starts at the expected default; updated once the
  // image loads so the container exactly matches reality → resizeMode cover = no crop.
  const [heroImgRatio, setHeroImgRatio] = useState<number>(
    heroIsPortrait ? 2 / 3 : 1
  );

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

    // header actions
    headerActions: { flexDirection: "row" as const, alignItems: "center" as const, gap: 2, marginRight: 4 },
    headerBtn:     { padding: 8 },

    // review bar
    reviewBar: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      backgroundColor: colors.accentSubtle,
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: colors.accentSoft,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      gap: spacing.sm,
    },
    reviewBarLabel: { ...text.sm, color: colors.accent, flex: 1 },
    reviewBarBtn: {
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.accentBold,
    },
    reviewBarBtnDestructive: { backgroundColor: "transparent" as const, borderWidth: 1, borderColor: colors.border },
    reviewBarBtnText: { ...text.sm, fontWeight: "600" as const, color: colors.white },
    reviewBarBtnTextDestructive: { color: colors.textSecondary },

    // hero layout
    heroOuter:     { flex: 1, backgroundColor: colors.bg },
    heroImageWrap: { position: "absolute" as const, top: 0, left: 0, right: 0 },
    heroImage:     { width: "100%", height: "100%" },
    heroGradLayer: { position: "absolute" as const, left: 0, right: 0 },
    heroScroll:    { flex: 1 },

    // merge modal
    modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" as const },
    modalSheet: {
      backgroundColor: colors.bg,
      borderTopLeftRadius: radius["2xl"],
      borderTopRightRadius: radius["2xl"],
      paddingTop: spacing.md,
      paddingBottom: spacing["3xl"],
      maxHeight: "70%",
    },
    modalHandle: {
      width: 36, height: 4,
      backgroundColor: colors.border,
      borderRadius: 2,
      alignSelf: "center" as const,
      marginBottom: spacing.md,
    },
    modalTitle: { ...text.lg, color: colors.textPrimary, fontWeight: "600" as const, paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
    modalSubtitle: { ...text.sm, color: colors.textTertiary, paddingHorizontal: spacing.lg, marginBottom: spacing.base },
    mergeRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.lg,
      gap: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    mergeRowText: { ...text.base, color: colors.textPrimary, flex: 1 },
    mergeRowSub:  { ...text.sm, color: colors.textTertiary },
    mergeEmpty: { ...text.base, color: colors.textTertiary, textAlign: "center" as const, padding: spacing.xl },
  }), [colors, fonts]);

  const iconColors = useMemo<IconColors>(
    () => ({ secondary: colors.textSecondary, star: colors.star }),
    [colors],
  );

  const heroUri = useHeroUri(entry);
  const showHero = entry ? isMediaEntry(entry) : false;

  // Reset the measured ratio whenever the URI changes (new entry or re-navigation)
  useEffect(() => {
    setHeroImgRatio(heroIsPortrait ? 2 / 3 : 1);
  }, [heroUri, heroIsPortrait]);

  // For place-entry kind, look up the Place container for canonical name/region/country
  const placeContainer = useMemo(() => {
    if (!entry || entry.kind !== "place-entry") return undefined;
    return (journal.localityPlaces ?? []).find((p) => p.id === (entry as PlaceEntry).placeId);
  }, [entry, journal.localityPlaces]);

  // Import run for the review bar (shows source and import date)
  const importRun = useMemo(() => {
    if (!entry?.importId) return undefined;
    return (journal.importRuns ?? []).find((r) => r.id === entry.importId);
  }, [entry?.importId, journal.importRuns]);

  // Same-day entries for the merge picker (WP-E3)
  const sameDayEntries = useMemo<Entry[]>(() => {
    if (!entry) return [];
    const day = entry.start.slice(0, 10);
    return allEntries(journal).filter(
      (e) => e.id !== entry.id && e.start.slice(0, 10) === day,
    );
  }, [entry, journal]);

  const handleMerge = async (other: Entry) => {
    if (!entry || mergeSaving) return;
    // Confirm: keep `entry` (this), delete `other`
    dialog.confirm(
      "Merge entries",
      `Keep "${entryTitle(entry)}" and discard "${entryTitle(other)}"?\n\nTrip link, participants, overrides and reflections from the discarded entry will be preserved.`,
      "Merge",
      async () => {
        setMergeSaving(true);
        setMergeVisible(false);
        try {
          const merged = mergeEntries(entry, other);
          const updated = {
            ...merged,
            tier: 1 as Tier,
            source: "manual" as const,
          };
          await saveUserEdit(updated as Entry);
          await hideMany(storeFor(other), [other.id]);
        } catch (err) {
          dialog.alert("Merge failed", String(err));
        } finally {
          setMergeSaving(false);
        }
      },
    );
  };

  const handleHide = () => {
    if (!entry) return;
    dialog.confirm(
      "Hide entry",
      `"${entryTitle(entry)}" will be hidden from your journal. You can restore it from Settings > Hidden Entries.`,
      "Hide",
      async () => {
        try {
          await hideMany(storeFor(entry), [entry.id]);
          router.back();
        } catch (err) {
          dialog.alert("Could not hide entry", String(err));
        }
      },
    );
  };

  const handleKeep = async () => {
    if (!entry) return;
    try {
      await markReviewed(storeFor(entry), [entry.id]);
    } catch (err) {
      dialog.alert("Could not mark as reviewed", String(err));
    }
  };

  const handleParticipantsConfirm = async (ids: string[]) => {
    if (!entry) return;
    try {
      const updated = {
        ...entry,
        participants: ids.length > 0 ? ids : undefined,
      };
      await saveUserEdit(updated as Entry);
    } catch (err) {
      dialog.alert("Could not save", String(err));
    }
    setPickerVisible(false);
  };

  if (!entry) {
    return (
      <View style={styles.notFound}>
        <Stack.Screen options={{ title: "Entry" }} />
        <Text style={styles.notFoundText}>Entry not found</Text>
      </View>
    );
  }

  const participantNames = (entry.participants ?? [])
    .map((pid) => journal.people.find((p) => p.id === pid)?.name ?? pid)
    .join(", ");

  const linkedTrip = journal.trips.find((t) => t.id === entry.tripId);

  const handleTripConfirm = async (id: string | undefined) => {
    try {
      await saveUserEdit({ ...entry, tripId: id });
    } catch (err) {
      dialog.alert("Could not save", String(err));
    }
    setTripPickerVisible(false);
  };

  const reflection = entry.reflection ?? (entry as any).journal;
  const reflectionLocked = isLocked(entry, "reflection");
  const ratingLocked = isLocked(entry, "rating");

  const isEditable = EDITABLE_KINDS.has(entry.kind);

  // ── shared header options ──────────────────────────────────────────────────
  const headerRight = () => (
    <View style={styles.headerActions}>
      {sameDayEntries.length > 0 && (
        <Pressable style={styles.headerBtn} onPress={() => setMergeVisible(true)}>
          <Ionicons name="git-merge-outline" size={22} color={showHero && heroUri ? "#fff" : colors.textTertiary} />
        </Pressable>
      )}
      {isEditable && (
        <Pressable
          style={styles.headerBtn}
          onPress={() => router.push({ pathname: "/entry/edit/[id]", params: { id: entry.id } })}
        >
          <Ionicons name="create-outline" size={22} color={showHero && heroUri ? "#fff" : colors.accentSoft} />
        </Pressable>
      )}
      <Pressable style={styles.headerBtn} onPress={handleHide}>
        <Ionicons name="trash-outline" size={22} color={showHero && heroUri ? "#fff" : colors.textTertiary} />
      </Pressable>
    </View>
  );

  // ── shared content (cards) ────────────────────────────────────────────────
  const contentCards = (
    <>
      {/* Review bar — shown when the entry is flagged as new or updated */}
      {entry.unreviewed && (
        <View style={styles.reviewBar}>
          <View style={{ flex: 1 }}>
            <Text style={styles.reviewBarLabel}>
              {entry.unreviewed === "new" ? "New" : "Updated"} from {sourceLabel(entry.source)}
              {importRun ? `, ${fmt(importRun.startedAt)}` : ""}
            </Text>
          </View>
          <Pressable
            style={styles.reviewBarBtn}
            onPress={handleKeep}
            accessibilityLabel="Mark as reviewed"
          >
            <Text style={styles.reviewBarBtnText}>Keep</Text>
          </Pressable>
          <Pressable
            style={[styles.reviewBarBtn, styles.reviewBarBtnDestructive]}
            onPress={handleHide}
            accessibilityLabel="Hide entry"
          >
            <Text style={[styles.reviewBarBtnText, styles.reviewBarBtnTextDestructive]}>Hide</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.card}>
        {entry.kind === "leg"         && <LegDetail         e={entry as Leg}        styles={styles} iconColors={iconColors} />}
        {entry.kind === "stay"        && <StayDetail        e={entry as Stay}       styles={styles} iconColors={iconColors} />}
        {entry.kind === "place"       && <PlaceDetail       e={entry as PlaceEvent} styles={styles} iconColors={iconColors} />}
        {entry.kind === "place-entry" && <PlaceEntryDetail  e={entry as PlaceEntry} place={placeContainer} styles={styles} iconColors={iconColors} />}
        {entry.kind === "film"        && <FilmDetail        e={entry as Film}       styles={styles} iconColors={iconColors} showPoster={!heroUri} />}
        {entry.kind === "episode"     && <EpisodeDetail     e={entry as Episode}    styles={styles} iconColors={iconColors} showPoster={!heroUri} />}
        {entry.kind === "book"        && <BookDetail        e={entry as Book}       styles={styles} iconColors={iconColors} showPoster={!heroUri} />}
        {entry.kind === "event"       && <EventDetail       e={entry as JEvent}     styles={styles} iconColors={iconColors} showPoster={!heroUri} />}
      </View>

      {/* Reflection */}
      {reflection && (
        <View style={styles.reflectionCard}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={styles.reflectionLabel}>Reflection</Text>
            {reflectionLocked && (
              <Text style={{ ...styles.reflectionLabel, color: colors.accentSoft }}>
                · {sourceLabel(entry.source)}
              </Text>
            )}
          </View>
          <Text style={styles.reflectionText}>{reflection}</Text>
        </View>
      )}

      {/* People — always visible; tap to edit */}
      <Pressable
        style={({ pressed }) => [styles.metaCard, pressed && { opacity: 0.7 }]}
        onPress={() => setPickerVisible(true)}
      >
        <View style={styles.sourceFieldRow}>
          <Text style={styles.fieldLabel}>With</Text>
          <View style={[styles.sourceValue, { gap: 4 }]}>
            <Text style={[styles.fieldValue, !participantNames && { color: colors.textMuted }]} numberOfLines={1}>
              {participantNames || "Add people…"}
            </Text>
            <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
          </View>
        </View>
      </Pressable>

      {/* Trip — always visible; tap to assign/change/unlink */}
      <Pressable
        style={({ pressed }) => [styles.metaCard, pressed && { opacity: 0.7 }]}
        onPress={() => setTripPickerVisible(true)}
      >
        <View style={styles.sourceFieldRow}>
          <Text style={styles.fieldLabel}>Trip</Text>
          <View style={[styles.sourceValue, { gap: 4 }]}>
            <Text style={[styles.fieldValue, !linkedTrip && { color: colors.textMuted }]} numberOfLines={1}>
              {linkedTrip?.title ?? "Add to trip…"}
            </Text>
            <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
          </View>
        </View>
      </Pressable>

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
        {entry.additionalSources?.map((s, i) => (
          <View key={i}>
            <View style={styles.sourceFieldRow}>
              <Text style={styles.fieldLabel} />
              <View style={styles.sourceValue}>
                <SourceMark source={s.source} size={18} />
                <Text style={styles.fieldValue} numberOfLines={1}>{sourceLabel(s.source)}</Text>
              </View>
            </View>
            {s.sourceRef && <Field label="Ref" value={s.sourceRef} styles={styles} />}
          </View>
        ))}
      </View>
    </>
  );

  return (
    <>
    {showHero && heroUri ? (
      /* ── Hero layout (film / TV / book / concert) ─────────────────────────
         headerShown: false → ScrollView content starts at y=0 (no offset).
         Custom back+actions overlay positioned with safe-area top inset.
         Portrait (film/TV/book): height = screenW × 1.5  (2:3 TMDB poster)
         Square   (concert):      height = screenW         (1:1 artist photo) */
      <View style={styles.heroOuter}>
        <Stack.Screen options={{ headerShown: false }} />
        {/* Custom header: white icons floating over the hero image */}
        <View style={{
          position: "absolute" as const,
          top: insets.top,
          left: 0, right: 0,
          zIndex: 20,
          flexDirection: "row" as const,
          alignItems: "center" as const,
          paddingHorizontal: 4,
        }}>
          <Pressable style={styles.headerBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </Pressable>
          <View style={{ flex: 1 }} />
          {headerRight()}
        </View>
        <ScrollView
          style={styles.heroScroll}
          contentContainerStyle={{ paddingBottom: spacing["3xl"] }}
        >
          <ImageBackground
            source={{ uri: heroUri }}
            style={{
              width: screenW,
              height: Math.round(screenW / heroImgRatio),
            }}
            resizeMode="cover"
            onLoad={(e: any) => {
              const { width, height } = e.nativeEvent.source;
              if (width && height) setHeroImgRatio(width / height);
            }}
          >
            {/* Top scrim — keeps back/action icons readable */}
            <LinearGradient
              colors={[hexAlpha(colors.bg, 0.55), hexAlpha(colors.bg, 0.30), "transparent"]}
              style={{ position: "absolute", top: 0, left: 0, right: 0, height: 120 }}
            />
            {/* Bottom fade — image dissolves into card background */}
            <LinearGradient
              colors={["transparent", hexAlpha(colors.bg, 0.6), colors.bg]}
              locations={[0, 0.6, 1]}
              style={{
                position: "absolute",
                bottom: 0, left: 0, right: 0,
                height: Math.round(
                  Math.round(screenW / heroImgRatio) * (heroIsPortrait ? 0.40 : 0.55)
                ),
              }}
            />
          </ImageBackground>
          {/* Cards overlap the image bottom by 48dp */}
          <View style={{ marginTop: -48, padding: spacing.base, gap: spacing.md }}>
            {contentCards}
          </View>
        </ScrollView>
      </View>
    ) : (
      /* ── Standard layout ── */
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Stack.Screen
          options={{
            title: "",
            ...common.header,
            headerRight,
          }}
        />
        {contentCards}
      </ScrollView>
    )}

    {/* ── Merge modal (WP-E3) ── */}
    <Modal
      visible={mergeVisible}
      transparent
      animationType="slide"
      onRequestClose={() => setMergeVisible(false)}
    >
      <Pressable style={styles.modalOverlay} onPress={() => setMergeVisible(false)}>
        <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>Merge with…</Text>
          <Text style={styles.modalSubtitle}>
            Pick another entry from the same day. This entry will be kept; the selected one will be removed.
          </Text>
          {sameDayEntries.length === 0 ? (
            <Text style={styles.mergeEmpty}>No other entries on this day.</Text>
          ) : (
            <FlatList
              data={sameDayEntries}
              keyExtractor={(e) => e.id}
              renderItem={({ item }) => (
                <Pressable style={styles.mergeRow} onPress={() => handleMerge(item)}>
                  <KindIcon kind={item.kind} size={18} color={colors.textSecondary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.mergeRowText} numberOfLines={1}>{entryTitle(item)}</Text>
                    <Text style={styles.mergeRowSub}>{item.source}</Text>
                  </View>
                </Pressable>
              )}
            />
          )}
        </Pressable>
      </Pressable>
    </Modal>

    <ParticipantPicker
      visible={pickerVisible}
      selected={entry.participants ?? []}
      people={journal.people}
      onConfirm={handleParticipantsConfirm}
      onDismiss={() => setPickerVisible(false)}
    />
    <TripPicker
      visible={tripPickerVisible}
      selectedId={entry.tripId}
      trips={journal.trips}
      onConfirm={handleTripConfirm}
      onDismiss={() => setTripPickerVisible(false)}
    />
    <Dialog {...dialog.props} onDismiss={dialog.dismiss} />
    </>
  );
}
