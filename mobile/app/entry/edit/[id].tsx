/**
 * Edit entry screen.
 *
 * WP-E1  — field editing for legs (and other kinds).
 *           Same-kind edits write to `overrides` and promote entry to tier 1.
 * WP-E2  — kind selector at the top; cross-kind change creates a new entry
 *           with shared Base fields and deletes the original.
 */
import { useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useJournal, allEntries, putMany, removeMany, hideMany, storeFor } from "@chronicle/journal/db";
import {
  uid,
  view,
  CATEGORY_LABEL,
  type Entry,
  type Leg,
  type Stay,
  type JEvent,
  type Film,
  type Episode,
  type Book,
  type Mode,
  type EventCategory,
  type Tier,
  type AnyOverrides,
} from "@chronicle/journal/types";
import { useTheme } from "../../../src/components/ThemeProvider";
import { KindIcon } from "../../../src/components/KindIcon";
import { DateField } from "../../../src/components/DateField";
import { useDialog, Dialog } from "../../../src/components/Dialog";

// ── helpers ───────────────────────────────────────────────────────────────────

type EditableKind = "leg" | "stay" | "event" | "film" | "episode" | "book";

const KIND_LABEL: Record<EditableKind, string> = {
  leg: "Journey",
  stay: "Stay",
  event: "Event",
  film: "Film",
  episode: "Episode",
  book: "Book",
};

const MODE_LABEL: Record<Mode, string> = {
  air: "Flight",
  rail: "Train",
  road: "Drive",
};

const MODES: Mode[] = ["air", "rail", "road"];
const CATEGORIES: EventCategory[] = [
  "concert", "gathering", "celebration", "milestone", "memory", "activity",
];
const EDITABLE_KINDS: EditableKind[] = ["leg", "stay", "event", "film", "episode", "book"];

function isEditableKind(k: string): k is EditableKind {
  return EDITABLE_KINDS.includes(k as EditableKind);
}

/** Extract YYYY-MM-DD from an ISO datetime or date-only string */
function dateOnly(s: string): string {
  return s.slice(0, 10);
}

/** Extract HH:mm from an ISO datetime string, or "" if date-only */
function timeOnly(s: string): string {
  return s.length > 10 ? s.slice(11, 16) : "";
}

/** Combine date + time into stored format */
function combineDateTime(date: string, time: string): string {
  const t = time.trim();
  if (!t || !/^\d{2}:\d{2}$/.test(t)) return date;
  return `${date}T${t}`;
}

// ── per-kind form sections ────────────────────────────────────────────────────

function LegForm({
  initial,
  styles,
  colors,
  fonts,
  spacing,
  radius,
  onChange,
}: {
  initial: Leg;
  styles: any;
  colors: any;
  fonts: any;
  spacing: any;
  radius: any;
  onChange: (fields: Partial<Leg>) => void;
}) {
  const v = view(initial);
  const [mode, setMode] = useState<Mode>(v.mode);
  const [from, setFrom] = useState(v.from ?? "");
  const [fromName, setFromName] = useState(v.fromName ?? "");
  const [to, setTo] = useState(v.to ?? "");
  const [toName, setToName] = useState(v.toName ?? "");
  const [flightNumber, setFlightNumber] = useState(v.flightNumber ?? "");
  const [trainNumber, setTrainNumber] = useState(v.trainNumber ?? "");
  const [aircraft, setAircraft] = useState(v.aircraft ?? "");
  const [operator, setOperator] = useState(v.operator ?? "");
  const [seat, setSeat] = useState(v.seat ?? "");
  const [startDate, setStartDate] = useState(dateOnly(v.start));
  const [startTime, setStartTime] = useState(timeOnly(v.start));

  function emit(patch: {
    mode?: Mode; from?: string; fromName?: string; to?: string; toName?: string;
    flightNumber?: string; trainNumber?: string; aircraft?: string;
    operator?: string; seat?: string; startDate?: string; startTime?: string;
  }) {
    const m = patch.mode ?? mode;
    const sd = patch.startDate ?? startDate;
    const st = patch.startTime ?? startTime;
    onChange({
      mode: m,
      from: patch.from ?? from,
      fromName: patch.fromName !== undefined ? patch.fromName : fromName,
      to: patch.to ?? to,
      toName: patch.toName !== undefined ? patch.toName : toName,
      flightNumber: m === "air" ? (patch.flightNumber ?? flightNumber) || undefined : undefined,
      trainNumber:  m === "rail" ? (patch.trainNumber ?? trainNumber) || undefined : undefined,
      aircraft:     m === "air" ? (patch.aircraft ?? aircraft) || undefined : undefined,
      operator:     m === "air" ? (patch.operator ?? operator) || undefined : undefined,
      seat:         (patch.seat ?? seat) || undefined,
      start: combineDateTime(sd, st),
    });
  }

  return (
    <>
      {/* Mode */}
      <Text style={styles.label}>Mode</Text>
      <View style={styles.chipRow}>
        {MODES.map((m) => (
          <Pressable
            key={m}
            style={[styles.chip, mode === m && styles.chipActive]}
            onPress={() => { setMode(m); emit({ mode: m }); }}
          >
            <KindIcon kind="leg" subkind={m} size={13} color={mode === m ? colors.accentSubtle : colors.textSecondary} accessibilityLabel="" />
            <Text style={[styles.chipLabel, mode === m && styles.chipLabelActive]}>{MODE_LABEL[m]}</Text>
          </Pressable>
        ))}
      </View>

      {/* Route */}
      <Text style={styles.label}>From</Text>
      <View style={styles.row2}>
        <TextInput
          style={[styles.input, styles.inputSmall]}
          value={from}
          onChangeText={(v) => { setFrom(v); emit({ from: v }); }}
          placeholder="Code"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="characters"
          maxLength={5}
        />
        <TextInput
          style={[styles.input, styles.inputFlex]}
          value={fromName}
          onChangeText={(v) => { setFromName(v); emit({ fromName: v }); }}
          placeholder="Name (optional)"
          placeholderTextColor={colors.textMuted}
        />
      </View>

      <Text style={styles.label}>To</Text>
      <View style={styles.row2}>
        <TextInput
          style={[styles.input, styles.inputSmall]}
          value={to}
          onChangeText={(v) => { setTo(v); emit({ to: v }); }}
          placeholder="Code"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="characters"
          maxLength={5}
        />
        <TextInput
          style={[styles.input, styles.inputFlex]}
          value={toName}
          onChangeText={(v) => { setToName(v); emit({ toName: v }); }}
          placeholder="Name (optional)"
          placeholderTextColor={colors.textMuted}
        />
      </View>

      {/* Flight/Train number */}
      {mode === "air" && (
        <>
          <Text style={styles.label}>Flight number</Text>
          <TextInput
            style={styles.input}
            value={flightNumber}
            onChangeText={(v) => { setFlightNumber(v); emit({ flightNumber: v }); }}
            placeholder="e.g. EI 232"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="characters"
          />
          <Text style={styles.label}>Aircraft <Text style={styles.optional}>(optional)</Text></Text>
          <TextInput
            style={styles.input}
            value={aircraft}
            onChangeText={(v) => { setAircraft(v); emit({ aircraft: v }); }}
            placeholder="e.g. A320"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="characters"
          />
          <Text style={styles.label}>Operator <Text style={styles.optional}>(optional)</Text></Text>
          <TextInput
            style={styles.input}
            value={operator}
            onChangeText={(v) => { setOperator(v); emit({ operator: v }); }}
            placeholder="e.g. Aer Lingus"
            placeholderTextColor={colors.textMuted}
          />
        </>
      )}
      {mode === "rail" && (
        <>
          <Text style={styles.label}>Train number <Text style={styles.optional}>(optional)</Text></Text>
          <TextInput
            style={styles.input}
            value={trainNumber}
            onChangeText={(v) => { setTrainNumber(v); emit({ trainNumber: v }); }}
            placeholder="e.g. IC 521"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="characters"
          />
        </>
      )}

      <Text style={styles.label}>Seat <Text style={styles.optional}>(optional)</Text></Text>
      <TextInput
        style={styles.input}
        value={seat}
        onChangeText={(v) => { setSeat(v); emit({ seat: v }); }}
        placeholder="e.g. 12A"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="characters"
      />

      {/* Departure date/time */}
      <DateField label="Departure date" value={startDate} onChange={(d) => { setStartDate(d); emit({ startDate: d }); }} />
      <Text style={styles.label}>Departure time <Text style={styles.optional}>(optional)</Text></Text>
      <TextInput
        style={styles.input}
        value={startTime}
        onChangeText={(v) => { setStartTime(v); emit({ startTime: v }); }}
        placeholder="HH:MM"
        placeholderTextColor={colors.textMuted}
        keyboardType="numbers-and-punctuation"
        maxLength={5}
      />
    </>
  );
}

function StayForm({
  initial,
  styles,
  colors,
  onChange,
}: {
  initial: Stay;
  styles: any;
  colors: any;
  onChange: (fields: Partial<Stay>) => void;
}) {
  const v = view(initial);
  const [place, setPlace] = useState(v.place ?? "");
  const [city, setCity] = useState(v.city ?? "");
  const [startDate, setStartDate] = useState(dateOnly(v.start));
  const [endDate, setEndDate] = useState(v.end ? dateOnly(v.end) : "");

  function emit(patch: { place?: string; city?: string; startDate?: string; endDate?: string }) {
    onChange({
      place: patch.place ?? place,
      city: (patch.city ?? city) || undefined,
      start: patch.startDate ?? startDate,
      end: (patch.endDate ?? endDate) || undefined,
    });
  }

  return (
    <>
      <Text style={styles.label}>Property name</Text>
      <TextInput
        style={styles.input}
        value={place}
        onChangeText={(v) => { setPlace(v); emit({ place: v }); }}
        placeholder="e.g. The Shelbourne"
        placeholderTextColor={colors.textMuted}
      />
      <Text style={styles.label}>City <Text style={styles.optional}>(optional)</Text></Text>
      <TextInput
        style={styles.input}
        value={city}
        onChangeText={(v) => { setCity(v); emit({ city: v }); }}
        placeholder="e.g. Dublin"
        placeholderTextColor={colors.textMuted}
      />
      <DateField label="Check-in" value={startDate} onChange={(d) => { setStartDate(d); emit({ startDate: d }); }} />
      <DateField
        label="Check-out"
        value={endDate}
        onChange={(d) => { setEndDate(d); emit({ endDate: d }); }}
        minimumDate={startDate ? new Date(startDate + "T12:00:00") : undefined}
      />
    </>
  );
}

function EventForm({
  initial,
  styles,
  colors,
  onChange,
}: {
  initial: JEvent;
  styles: any;
  colors: any;
  onChange: (fields: Partial<JEvent>) => void;
}) {
  const v = view(initial);
  const [category, setCategory] = useState<EventCategory>(v.category);
  const [artist, setArtist] = useState(v.artist ?? "");
  const [venue, setVenue] = useState(v.venue ?? "");
  const [city, setCity] = useState(v.city ?? "");
  const [country, setCountry] = useState(v.country ?? "");
  const [startDate, setStartDate] = useState(dateOnly(v.start));

  function emit(patch: {
    category?: EventCategory; artist?: string; venue?: string;
    city?: string; country?: string; startDate?: string;
  }) {
    onChange({
      category: patch.category ?? category,
      artist: patch.artist ?? artist,
      venue: patch.venue ?? venue,
      city: patch.city ?? city,
      country: (patch.country ?? country) || undefined,
      start: patch.startDate ?? startDate,
    });
  }

  return (
    <>
      <Text style={styles.label}>Category</Text>
      <View style={styles.chipRow}>
        {CATEGORIES.map((c) => (
          <Pressable
            key={c}
            style={[styles.chip, category === c && styles.chipActive]}
            onPress={() => { setCategory(c); emit({ category: c }); }}
          >
            <Text style={[styles.chipLabel, category === c && styles.chipLabelActive]}>
              {CATEGORY_LABEL[c]}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>{category === "concert" ? "Artist" : "Title"}</Text>
      <TextInput
        style={styles.input}
        value={artist}
        onChangeText={(v) => { setArtist(v); emit({ artist: v }); }}
        placeholder={category === "concert" ? "e.g. Fontaines D.C." : "e.g. New Year's Eve"}
        placeholderTextColor={colors.textMuted}
      />
      <Text style={styles.label}>Venue <Text style={styles.optional}>(optional)</Text></Text>
      <TextInput
        style={styles.input}
        value={venue}
        onChangeText={(v) => { setVenue(v); emit({ venue: v }); }}
        placeholder="e.g. 3Arena"
        placeholderTextColor={colors.textMuted}
      />
      <Text style={styles.label}>City</Text>
      <TextInput
        style={styles.input}
        value={city}
        onChangeText={(v) => { setCity(v); emit({ city: v }); }}
        placeholder="e.g. Dublin"
        placeholderTextColor={colors.textMuted}
      />
      <Text style={styles.label}>Country <Text style={styles.optional}>(optional)</Text></Text>
      <TextInput
        style={styles.input}
        value={country}
        onChangeText={(v) => { setCountry(v); emit({ country: v }); }}
        placeholder="e.g. Ireland"
        placeholderTextColor={colors.textMuted}
      />
      <DateField label="Date" value={startDate} onChange={(d) => { setStartDate(d); emit({ startDate: d }); }} />
    </>
  );
}

function FilmForm({
  initial,
  styles,
  colors,
  onChange,
}: {
  initial: Film;
  styles: any;
  colors: any;
  onChange: (fields: Partial<Film>) => void;
}) {
  const v = view(initial);
  const [title, setTitle] = useState(v.title ?? "");
  const [director, setDirector] = useState(v.director ?? "");
  const [year, setYear] = useState(v.year ? String(v.year) : "");
  const [startDate, setStartDate] = useState(dateOnly(v.start));

  function emit(patch: { title?: string; director?: string; year?: string; startDate?: string }) {
    const y = parseInt(patch.year ?? year, 10);
    onChange({
      title: patch.title ?? title,
      director: (patch.director ?? director) || undefined,
      year: isNaN(y) ? undefined : y,
      start: patch.startDate ?? startDate,
    });
  }

  return (
    <>
      <Text style={styles.label}>Title</Text>
      <TextInput
        style={styles.input}
        value={title}
        onChangeText={(v) => { setTitle(v); emit({ title: v }); }}
        placeholder="Film title"
        placeholderTextColor={colors.textMuted}
      />
      <Text style={styles.label}>Director <Text style={styles.optional}>(optional)</Text></Text>
      <TextInput
        style={styles.input}
        value={director}
        onChangeText={(v) => { setDirector(v); emit({ director: v }); }}
        placeholder="e.g. Paul Verhoeven"
        placeholderTextColor={colors.textMuted}
      />
      <Text style={styles.label}>Year <Text style={styles.optional}>(optional)</Text></Text>
      <TextInput
        style={styles.input}
        value={year}
        onChangeText={(v) => { setYear(v); emit({ year: v }); }}
        placeholder="e.g. 1997"
        placeholderTextColor={colors.textMuted}
        keyboardType="number-pad"
        maxLength={4}
      />
      <DateField label="Date watched" value={startDate} onChange={(d) => { setStartDate(d); emit({ startDate: d }); }} />
    </>
  );
}

function EpisodeForm({
  initial,
  styles,
  colors,
  onChange,
}: {
  initial: Episode;
  styles: any;
  colors: any;
  onChange: (fields: Partial<Episode>) => void;
}) {
  const v = view(initial);
  const [showTitle, setShowTitle] = useState(v.showTitle ?? "");
  const [episodeTitle, setEpisodeTitle] = useState(v.episodeTitle ?? "");
  const [season, setSeason] = useState(v.season ?? "");
  const [episodeNumber, setEpisodeNumber] = useState(v.episodeNumber != null ? String(v.episodeNumber) : "");
  const [startDate, setStartDate] = useState(dateOnly(v.start));

  function emit(patch: {
    showTitle?: string; episodeTitle?: string; season?: string;
    episodeNumber?: string; startDate?: string;
  }) {
    const ep = parseInt(patch.episodeNumber ?? episodeNumber, 10);
    onChange({
      showTitle: patch.showTitle ?? showTitle,
      episodeTitle: (patch.episodeTitle ?? episodeTitle) || undefined,
      season: (patch.season ?? season) || undefined,
      episodeNumber: isNaN(ep) ? undefined : ep,
      start: patch.startDate ?? startDate,
    });
  }

  return (
    <>
      <Text style={styles.label}>Show</Text>
      <TextInput
        style={styles.input}
        value={showTitle}
        onChangeText={(v) => { setShowTitle(v); emit({ showTitle: v }); }}
        placeholder="e.g. The Bear"
        placeholderTextColor={colors.textMuted}
      />
      <Text style={styles.label}>Episode title <Text style={styles.optional}>(optional)</Text></Text>
      <TextInput
        style={styles.input}
        value={episodeTitle}
        onChangeText={(v) => { setEpisodeTitle(v); emit({ episodeTitle: v }); }}
        placeholder="Episode title"
        placeholderTextColor={colors.textMuted}
      />
      <Text style={styles.label}>Season <Text style={styles.optional}>(optional)</Text></Text>
      <TextInput
        style={styles.input}
        value={season}
        onChangeText={(v) => { setSeason(v); emit({ season: v }); }}
        placeholder="e.g. Season 2"
        placeholderTextColor={colors.textMuted}
      />
      <Text style={styles.label}>Episode # <Text style={styles.optional}>(optional)</Text></Text>
      <TextInput
        style={styles.input}
        value={episodeNumber}
        onChangeText={(v) => { setEpisodeNumber(v); emit({ episodeNumber: v }); }}
        placeholder="e.g. 6"
        placeholderTextColor={colors.textMuted}
        keyboardType="number-pad"
        maxLength={3}
      />
      <DateField label="Date watched" value={startDate} onChange={(d) => { setStartDate(d); emit({ startDate: d }); }} />
    </>
  );
}

function BookForm({
  initial,
  styles,
  colors,
  onChange,
}: {
  initial: Book;
  styles: any;
  colors: any;
  onChange: (fields: Partial<Book>) => void;
}) {
  const v = view(initial);
  const [title, setTitle] = useState(v.title ?? "");
  const [author, setAuthor] = useState(v.author ?? "");
  const [year, setYear] = useState(v.year ? String(v.year) : "");
  const [startDate, setStartDate] = useState(dateOnly(v.start));

  function emit(patch: { title?: string; author?: string; year?: string; startDate?: string }) {
    const y = parseInt(patch.year ?? year, 10);
    onChange({
      title: patch.title ?? title,
      author: patch.author ?? author,
      year: isNaN(y) ? undefined : y,
      start: patch.startDate ?? startDate,
    });
  }

  return (
    <>
      <Text style={styles.label}>Title</Text>
      <TextInput
        style={styles.input}
        value={title}
        onChangeText={(v) => { setTitle(v); emit({ title: v }); }}
        placeholder="Book title"
        placeholderTextColor={colors.textMuted}
      />
      <Text style={styles.label}>Author</Text>
      <TextInput
        style={styles.input}
        value={author}
        onChangeText={(v) => { setAuthor(v); emit({ author: v }); }}
        placeholder="e.g. Colm Tóibín"
        placeholderTextColor={colors.textMuted}
      />
      <Text style={styles.label}>Year published <Text style={styles.optional}>(optional)</Text></Text>
      <TextInput
        style={styles.input}
        value={year}
        onChangeText={(v) => { setYear(v); emit({ year: v }); }}
        placeholder="e.g. 2004"
        placeholderTextColor={colors.textMuted}
        keyboardType="number-pad"
        maxLength={4}
      />
      <DateField label="Date read" value={startDate} onChange={(d) => { setStartDate(d); emit({ startDate: d }); }} />
    </>
  );
}

// ── screen ────────────────────────────────────────────────────────────────────

export default function EditEntryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const journal = useJournal();
  const { colors, fonts, text, spacing, radius, common } = useTheme();
  const dialog = useDialog();

  const entry = useMemo<Entry | undefined>(
    () => allEntries(journal).find((e) => e.id === id),
    [journal, id],
  );

  // Selected kind — starts from entry's own kind (if editable)
  const [selectedKind, setSelectedKind] = useState<EditableKind>(() => {
    if (entry && isEditableKind(entry.kind)) return entry.kind;
    return "leg";
  });

  // Accumulated field changes from the sub-form
  const [fieldPatch, setFieldPatch] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    content: { padding: spacing.lg, paddingBottom: spacing["3xl"], gap: 6 },

    sectionHeader: { ...text.label, color: colors.textSecondary, marginBottom: spacing.sm, marginTop: spacing.base },
    label: { ...text.label, color: colors.textSecondary, marginBottom: 6, marginTop: spacing.base },
    optional: { fontWeight: "400", textTransform: "none" as const, letterSpacing: 0, color: colors.textMuted },

    input: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      color: colors.textPrimary,
      ...text.lg,
      paddingHorizontal: spacing.md2,
      paddingVertical: spacing.md,
    },
    inputSmall: { width: 72 },
    inputFlex: { flex: 1 },

    row2: { flexDirection: "row" as const, gap: spacing.sm },

    chipRow: { flexDirection: "row" as const, gap: spacing.sm, flexWrap: "wrap" as const },
    chip: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: spacing.sm2,
      paddingHorizontal: spacing.md2,
      paddingVertical: spacing.sm,
      borderRadius: radius.pill,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    chipActive: { backgroundColor: colors.surfaceAccent, borderColor: colors.accent },
    chipLabel: { ...text.smMd, color: colors.textSecondary, fontWeight: "600" as const },
    chipLabelActive: { color: colors.accentSubtle },

    kindDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginTop: spacing.lg, marginBottom: spacing.sm },

    saveBtn: { ...text.lg, color: colors.accentSoft, fontWeight: "600" as const },
    saveBtnDisabled: { opacity: 0.4 },

    notFound: { flex: 1, backgroundColor: colors.bg, alignItems: "center" as const, justifyContent: "center" as const },
    notFoundText: { ...text.lg, color: colors.textTertiary },
  }), [colors, fonts, spacing, radius]);

  if (!entry) {
    return (
      <View style={styles.notFound}>
        <Stack.Screen options={{ title: "Edit", ...common.header }} />
        <Text style={styles.notFoundText}>Entry not found</Text>
      </View>
    );
  }

  if (!isEditableKind(entry.kind)) {
    return (
      <View style={styles.notFound}>
        <Stack.Screen options={{ title: "Edit", ...common.header }} />
        <Text style={styles.notFoundText}>This entry type cannot be edited</Text>
      </View>
    );
  }

  const kindChanged = selectedKind !== entry.kind;

  // canSave: require at minimum that fieldPatch has been touched (or kind changed)
  const canSave = kindChanged || Object.keys(fieldPatch).length > 0;

  const handleSave = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      if (!kindChanged) {
        // ── Same-kind edit: write to overrides ───────────────────────────────
        const newOverrides: AnyOverrides = { ...(entry.overrides ?? {}) };
        for (const [k, v] of Object.entries(fieldPatch)) {
          if (v !== undefined && v !== null) {
            (newOverrides as Record<string, unknown>)[k] = v;
          } else {
            // Explicitly clear a previously-overridden field
            delete (newOverrides as Record<string, unknown>)[k];
          }
        }
        const updated = {
          ...entry,
          tier: 1 as Tier,
          source: "manual",
          overrides: Object.keys(newOverrides).length ? newOverrides : undefined,
          // Also apply non-override fields that belong on the entry directly
          ...(fieldPatch.start !== undefined ? { start: String(fieldPatch.start) } : {}),
        };
        await putMany(storeFor(entry), [updated]);
      } else {
        // ── Cross-kind: create new entry, delete old ─────────────────────────
        const base = {
          id: uid(),
          source: "manual" as const,
          tier: 1 as Tier,
          start: (fieldPatch.start as string) ?? entry.start,
          tripId: entry.tripId,
          participants: entry.participants,
          dedupeKey: `${selectedKind}|manual|${uid()}`,
          createdAt: new Date().toISOString(),
          // Preserve authored data across kind change (DM6)
          ...(entry.rating    !== undefined ? { rating:     entry.rating    } : {}),
          ...(entry.reflection               ? { reflection: entry.reflection } : {}),
          ...(entry.review                   ? { review:     entry.review    } : {}),
          ...(entry.overrides                ? { overrides:  entry.overrides } : {}),
        };

        let newEntry: Entry | null = null;

        if (selectedKind === "leg") {
          newEntry = {
            ...base,
            kind: "leg",
            mode: (fieldPatch.mode as Mode) ?? "air",
            from: (fieldPatch.from as string) ?? "",
            to: (fieldPatch.to as string) ?? "",
            fromName: fieldPatch.fromName as string | undefined,
            toName: fieldPatch.toName as string | undefined,
            flightNumber: fieldPatch.flightNumber as string | undefined,
            trainNumber: fieldPatch.trainNumber as string | undefined,
            aircraft: fieldPatch.aircraft as string | undefined,
            operator: fieldPatch.operator as string | undefined,
            seat: fieldPatch.seat as string | undefined,
          } as Leg;
        } else if (selectedKind === "stay") {
          newEntry = {
            ...base,
            kind: "stay",
            place: (fieldPatch.place as string) ?? "",
            city: fieldPatch.city as string | undefined,
            end: fieldPatch.end as string | undefined,
          } as Stay;
        } else if (selectedKind === "event") {
          newEntry = {
            ...base,
            kind: "event",
            category: (fieldPatch.category as EventCategory) ?? "gathering",
            artist: (fieldPatch.artist as string) ?? "",
            venue: (fieldPatch.venue as string) ?? "",
            city: (fieldPatch.city as string) ?? "",
            country: fieldPatch.country as string | undefined,
          } as JEvent;
        } else if (selectedKind === "film") {
          newEntry = {
            ...base,
            kind: "film",
            title: (fieldPatch.title as string) ?? "",
            director: fieldPatch.director as string | undefined,
            year: fieldPatch.year as number | undefined,
          } as Film;
        } else if (selectedKind === "episode") {
          newEntry = {
            ...base,
            kind: "episode",
            showTitle: (fieldPatch.showTitle as string) ?? "",
            episodeTitle: fieldPatch.episodeTitle as string | undefined,
            season: fieldPatch.season as string | undefined,
            episodeNumber: fieldPatch.episodeNumber as number | undefined,
          } as Episode;
        } else if (selectedKind === "book") {
          newEntry = {
            ...base,
            kind: "book",
            title: (fieldPatch.title as string) ?? "",
            author: (fieldPatch.author as string) ?? "",
            year: fieldPatch.year as number | undefined,
          } as Book;
        }

        if (newEntry) {
          const targetStore = storeFor(newEntry);
          await putMany(targetStore, [newEntry]);
          await hideMany(storeFor(entry), [entry.id]);
          // Navigate to the new entry's detail
          router.replace({ pathname: "/entry/[id]", params: { id: newEntry.id } });
          return;
        }
      }

      router.back();
    } catch (err) {
      dialog.alert("Save failed", String(err));
      setSaving(false);
    }
  };

  // Build a default "empty" version of the selected kind's edit fields so
  // the sub-form is properly initialised when switching kinds.
  const syntheticEntry = useMemo(() => {
    if (selectedKind === entry.kind) return entry;
    const blankBase = {
      id: entry.id,
      source: "manual" as const,
      tier: 1 as Tier,
      start: entry.start,
      dedupeKey: entry.dedupeKey,
      createdAt: entry.createdAt,
    };
    // Construct a minimal valid entry of the new kind so form initialises cleanly
    if (selectedKind === "leg")     return { ...blankBase, kind: "leg", mode: "air", from: "", to: "" } as Leg;
    if (selectedKind === "stay")    return { ...blankBase, kind: "stay", place: "" } as Stay;
    if (selectedKind === "event")   return { ...blankBase, kind: "event", category: "gathering", artist: "", venue: "", city: "" } as JEvent;
    if (selectedKind === "film")    return { ...blankBase, kind: "film", title: "" } as Film;
    if (selectedKind === "episode") return { ...blankBase, kind: "episode", showTitle: "" } as Episode;
    if (selectedKind === "book")    return { ...blankBase, kind: "book", title: "", author: "" } as Book;
    return entry;
  }, [selectedKind, entry]);

  return (
    <>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Stack.Screen
          options={{
            title: "Edit",
            ...common.header,
            headerRight: () => (
              <Pressable
                onPress={handleSave}
                disabled={!canSave || saving}
                style={{ marginRight: 4, padding: 8 }}
              >
                <Text style={[styles.saveBtn, (!canSave || saving) && styles.saveBtnDisabled]}>
                  {saving ? "Saving…" : "Save"}
                </Text>
              </Pressable>
            ),
          }}
        />

        {/* ── Kind selector (WP-E2) ── */}
        <Text style={styles.sectionHeader}>Type</Text>
        <View style={styles.chipRow}>
          {EDITABLE_KINDS.map((k) => (
            <Pressable
              key={k}
              style={[styles.chip, selectedKind === k && styles.chipActive]}
              onPress={() => {
                setSelectedKind(k);
                setFieldPatch({});
              }}
            >
              <KindIcon kind={k} size={13} color={selectedKind === k ? colors.accentSubtle : colors.textSecondary} accessibilityLabel="" />
              <Text style={[styles.chipLabel, selectedKind === k && styles.chipLabelActive]}>
                {KIND_LABEL[k]}
              </Text>
            </Pressable>
          ))}
        </View>

        {kindChanged && (
          <Text style={{ ...text.sm, color: colors.textTertiary, marginTop: spacing.sm }}>
            Saving will replace this entry with a new {KIND_LABEL[selectedKind].toLowerCase()}.
          </Text>
        )}

        <View style={styles.kindDivider} />

        {/* ── Kind-specific form ── */}
        {selectedKind === "leg" && (
          <LegForm
            initial={syntheticEntry as Leg}
            styles={styles}
            colors={colors}
            fonts={fonts}
            spacing={spacing}
            radius={radius}
            onChange={setFieldPatch}
          />
        )}
        {selectedKind === "stay" && (
          <StayForm
            initial={syntheticEntry as Stay}
            styles={styles}
            colors={colors}
            onChange={setFieldPatch}
          />
        )}
        {selectedKind === "event" && (
          <EventForm
            initial={syntheticEntry as JEvent}
            styles={styles}
            colors={colors}
            onChange={setFieldPatch}
          />
        )}
        {selectedKind === "film" && (
          <FilmForm
            initial={syntheticEntry as Film}
            styles={styles}
            colors={colors}
            onChange={setFieldPatch}
          />
        )}
        {selectedKind === "episode" && (
          <EpisodeForm
            initial={syntheticEntry as Episode}
            styles={styles}
            colors={colors}
            onChange={setFieldPatch}
          />
        )}
        {selectedKind === "book" && (
          <BookForm
            initial={syntheticEntry as Book}
            styles={styles}
            colors={colors}
            onChange={setFieldPatch}
          />
        )}
      </ScrollView>
      <Dialog {...dialog.props} onDismiss={dialog.dismiss} />
    </>
  );
}
