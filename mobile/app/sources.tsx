/**
 * Sources — unified hub for all ways data enters Chronicle.
 *
 * Sections:
 *   "On device"       — Photo library (scan), Device calendar
 *   "Online"          — Goodreads read-shelf sync
 *   "File import"     — CSV / ICS / VCF file picker
 *
 * Design principles:
 *   - All source cards share the same chrome (icon + title + status + action button)
 *   - Progress is shown as a slim animated bar, matching the commit progress card
 *   - Imports complete immediately; a summary dialog replaces the old batch review
 *   - A single "Sources" icon in the tab header replaces the old Import icon
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Animated,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, useRouter, useLocalSearchParams } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { Ionicons } from "@expo/vector-icons";
import { useJournal, putMany, allEntries, markRunReviewed, undoRun } from "@chronicle/journal/db";
import { importFile, type ImportResult } from "@chronicle/journal/import";
import {
  uid,
} from "@chronicle/journal/types";
import type { Person, ImportRun } from "@chronicle/journal/types";
import { readDeviceContacts } from "../src/lib/deviceContacts";
import { parseContacts, type ContactDraft } from "@chronicle/journal/contacts";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme, spacing, radius, type ThemeColors, type ThemeFonts } from "../src/components/ThemeProvider";
import { PlaceStagingCard } from "../src/components/PlaceStagingCard";
import { ContactsReviewPanel, type ReviewContact, buildReviewContacts } from "../src/components/ContactsReviewPanel";
import { useDialog, Dialog } from "../src/components/Dialog";
import { PhotoSourceEntry } from "../src/components/PhotoSourceEntry";
import { readDeviceCalendar } from "../src/lib/deviceCalendar";
import {
  fetchGoodreadsShelfCsv,
  parseGoodreadsUserId,
} from "@chronicle/journal/connectors/goodreads/rss";
import {
  getGoodreadsUserId,
  setGoodreadsUserId,
} from "../src/lib/goodreadsPrefs";
import { useStagingHub } from "../src/lib/exif/useStagingHub";
import {
  getSourceState,
  setSourceAutoCheck,
  runSourceNow,
  setDefaultStorage,
} from "../src/lib/connectedSources";
import { makeSyncPrefsStorage } from "../src/lib/syncPrefsStorage";

// ─── Types ────────────────────────────────────────────────────────────────────

type ActiveSource = "calendar" | "goodreads" | "file" | "contacts" | null;

type ContactsPhase = "idle" | "parsing" | "review" | "committing";

// ─── Source card chrome ───────────────────────────────────────────────────────
//
// Consistent wrapper for calendar, goodreads, file cards. Matches the visual
// style of PhotoSourceEntry from PhotoSourceEntry.tsx.

function SourceCard({
  icon,
  title,
  statusText,
  statusColor,
  active,
  progressPct,
  action,
  children,
  colors,
  fonts,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  title: string;
  statusText: string;
  statusColor?: string;
  active: boolean;
  progressPct: number; // 0–1, only shown when active
  action: React.ReactNode;
  children?: React.ReactNode;
  colors: ThemeColors;
  fonts: ThemeFonts;
}) {
  const progressAnim = useRef(new Animated.Value(0)).current;
  const loopRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (active) {
      loopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(progressAnim, { toValue: 0.7, duration: 1400, useNativeDriver: false }),
          Animated.timing(progressAnim, { toValue: 0.15, duration: 1000, useNativeDriver: false }),
        ]),
      );
      loopRef.current.start();
    } else {
      loopRef.current?.stop();
      Animated.timing(progressAnim, {
        toValue: progressPct,
        duration: 300,
        useNativeDriver: false,
      }).start();
    }
  }, [active]);

  return (
    <View
      style={[
        sc.card,
        { backgroundColor: colors.surface, borderColor: colors.borderFaint },
      ]}
    >
      <View style={sc.header}>
        <View style={[sc.iconWrap, { backgroundColor: colors.surfaceAccent }]}>
          <Ionicons name={icon} size={20} color={colors.accent} />
        </View>
        <View style={sc.info}>
          <Text style={[sc.title, { color: colors.textPrimary, fontFamily: fonts.serifSemiBold }]}>
            {title}
          </Text>
          <Text style={[sc.status, { color: statusColor ?? colors.textMuted }]}>
            {statusText}
          </Text>
        </View>
        {action}
      </View>

      {active && (
        <View style={sc.progressCard}>
          <View style={[sc.progressTrack, { backgroundColor: colors.borderFaint }]}>
            <Animated.View
              style={[
                sc.progressFill,
                {
                  backgroundColor: colors.accent,
                  width: progressAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: ["0%", "100%"],
                  }),
                },
              ]}
            />
          </View>
        </View>
      )}

      {children}
    </View>
  );
}

const sc = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: spacing.lg,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.md,
  },
  info: { flex: 1 },
  title: { fontSize: 15, marginBottom: 2 },
  status: { fontSize: 12, lineHeight: 17 },
  progressCard: { marginTop: spacing.sm },
  progressTrack: {
    height: 3,
    borderRadius: 2,
    overflow: "hidden",
  },
  progressFill: { height: "100%", borderRadius: 2 },
});

// ─── Section label ────────────────────────────────────────────────────────────

function SectionLabel({ label, colors }: { label: string; colors: ThemeColors }) {
  return (
    <Text
      style={{
        fontSize: 11,
        color: colors.textMuted,
        textTransform: "uppercase",
        letterSpacing: 0.5,
        paddingHorizontal: spacing.lg,
        marginTop: spacing.xl,
        marginBottom: spacing.sm,
      }}
    >
      {label}
    </Text>
  );
}

// ─── Action button (used inside source cards) ─────────────────────────────────

function SrcButton({
  label,
  onPress,
  disabled,
  colors,
  fonts,
  variant = "primary",
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  colors: ThemeColors;
  fonts: ThemeFonts;
  variant?: "primary" | "ghost";
}) {
  return (
    <Pressable
      style={[
        sb.btn,
        variant === "primary"
          ? { backgroundColor: colors.accentBold }
          : { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.border },
        disabled && { opacity: 0.45 },
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text
        style={[
          sb.label,
          { fontFamily: fonts.sansMedium ?? fonts.sans },
          variant === "ghost" ? { color: colors.textSecondary } : { color: colors.white },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const sb = StyleSheet.create({
  btn: {
    paddingVertical: spacing.xs + 1,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  label: { fontSize: 13, fontWeight: "600" },
});

// ─── Calendar source card ─────────────────────────────────────────────────────

type CalScope = "last-year" | "all-time";

const CAL_SCOPE_DAYS: Record<CalScope, number> = {
  "last-year": 365,
  "all-time":  36500,
};

const CAL_SCOPE_LABELS: Record<CalScope, string> = {
  "last-year": "Last year",
  "all-time":  "All time",
};

function CalendarSourceCard({
  active,
  disabled,
  onSync,
  autoCheck,
  onAutoCheckChange,
  lastCheckedAt,
  lastError,
  colors,
  fonts,
}: {
  active: boolean;
  disabled: boolean;
  onSync: (pastDays: number) => void;
  autoCheck: boolean;
  onAutoCheckChange: (v: boolean) => void;
  lastCheckedAt: string | null;
  lastError: string | null;
  colors: ThemeColors;
  fonts: ThemeFonts;
}) {
  const [scope, setScope] = useState<CalScope>("last-year");
  const [pickerOpen, setPickerOpen] = useState(false);

  const statusText = active
    ? "Syncing…"
    : lastCheckedAt
    ? `Last checked ${new Date(lastCheckedAt).toLocaleDateString("en-US", { day: "numeric", month: "short" })}`
    : "Imports one-off events from your calendar";

  return (
    <SourceCard
      icon="calendar-outline"
      title="Device calendar"
      statusText={statusText}
      active={active}
      progressPct={0}
      colors={colors}
      fonts={fonts}
      action={
        active ? (
          <ActivityIndicator size="small" color={colors.accent} />
        ) : (
          <SrcButton
            label="Check now"
            onPress={() => onSync(CAL_SCOPE_DAYS[scope])}
            disabled={disabled}
            colors={colors}
            fonts={fonts}
          />
        )
      }
    >
      {/* Scope row */}
      <Pressable
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.xs,
          paddingVertical: spacing.xs,
          marginTop: spacing.sm,
        }}
        onPress={() => setPickerOpen((v) => !v)}
      >
        <Ionicons name="options-outline" size={14} color={colors.textMuted} />
        <Text style={{ fontSize: 12, color: colors.textMuted, flex: 1 }}>
          {CAL_SCOPE_LABELS[scope]}
        </Text>
        <Ionicons
          name={pickerOpen ? "chevron-up" : "chevron-down"}
          size={13}
          color={colors.textMuted}
        />
      </Pressable>

      {/* Scope picker */}
      {pickerOpen && (
        <View
          style={{
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: colors.borderFaint,
            marginBottom: spacing.sm,
            paddingTop: spacing.sm,
            gap: spacing.xs,
          }}
        >
          {(["last-year", "all-time"] as CalScope[]).map((s) => (
            <Pressable
              key={s}
              style={[
                { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.md },
                scope === s && { backgroundColor: colors.accentSubtle },
              ]}
              onPress={() => { setScope(s); setPickerOpen(false); }}
            >
              <Text
                style={[
                  { fontSize: 13, color: colors.textSecondary },
                  scope === s && { color: colors.accent },
                ]}
              >
                {CAL_SCOPE_LABELS[s]}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {/* Auto-check switch */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          marginTop: spacing.sm,
          paddingTop: spacing.sm,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.borderFaint,
        }}
      >
        <Text style={{ fontSize: 12, color: colors.textMuted, flex: 1 }}>
          Check automatically on startup
        </Text>
        <Switch
          value={autoCheck}
          onValueChange={onAutoCheckChange}
          trackColor={{ false: colors.border, true: colors.accent }}
          thumbColor={colors.surface}
        />
      </View>

      {/* Last error */}
      {lastError != null && (
        <Text
          style={{ fontSize: 11, color: colors.error, marginTop: spacing.xs }}
          numberOfLines={2}
        >
          {lastError}
        </Text>
      )}
    </SourceCard>
  );
}

// ─── Contacts source card ─────────────────────────────────────────────────────

function ContactsSourceCard({
  peopleCount,
  phase,
  disabled,
  onImportFromDevice,
  onPickFile,
  colors,
  fonts,
}: {
  peopleCount: number;
  phase: ContactsPhase;
  disabled: boolean;
  onImportFromDevice: () => void;
  onPickFile: () => void;
  colors: ThemeColors;
  fonts: ThemeFonts;
}) {
  const parsing = phase === "parsing" || phase === "committing";
  return (
    <SourceCard
      icon="people-outline"
      title="Phone contacts"
      statusText={
        parsing
          ? phase === "parsing" ? "Reading contacts…" : "Saving…"
          : peopleCount > 0
          ? `${peopleCount} ${peopleCount === 1 ? "person" : "people"} added`
          : "Add people from your address book to tag them in entries"
      }
      active={parsing}
      progressPct={0}
      colors={colors}
      fonts={fonts}
      action={
        parsing ? (
          <ActivityIndicator size="small" color={colors.accent} />
        ) : (
          <View style={{ flexDirection: "row", gap: 8 }}>
            <SrcButton
              label="From device"
              onPress={onImportFromDevice}
              disabled={disabled}
              colors={colors}
              fonts={fonts}
            />
            <SrcButton
              label="File"
              onPress={onPickFile}
              disabled={disabled}
              colors={colors}
              fonts={fonts}
              variant="ghost"
            />
          </View>
        )
      }
    />
  );
}

// ─── Goodreads source card ────────────────────────────────────────────────────

function GoodreadsSourceCard({
  active,
  disabled,
  grId,
  grEditing,
  grInput,
  onGrInputChange,
  onSync,
  onStartEdit,
  onCancelEdit,
  onSaveId,
  onForget,
  autoCheck,
  onAutoCheckChange,
  lastCheckedAt,
  lastError,
  colors,
  fonts,
}: {
  active: boolean;
  disabled: boolean;
  grId: string | null;
  grEditing: boolean;
  grInput: string;
  onGrInputChange: (v: string) => void;
  onSync: () => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveId: () => void;
  onForget: () => void;
  autoCheck: boolean;
  onAutoCheckChange: (v: boolean) => void;
  lastCheckedAt: string | null;
  lastError: string | null;
  colors: ThemeColors;
  fonts: ThemeFonts;
}) {
  const statusText = active
    ? "Syncing…"
    : grId
    ? lastCheckedAt
      ? `Connected · last checked ${new Date(lastCheckedAt).toLocaleDateString("en-US", { day: "numeric", month: "short" })}`
      : `Connected — ${grId}`
    : "Sync your read-shelf via public RSS";

  return (
    <SourceCard
      icon="book-outline"
      title="Goodreads"
      statusText={statusText}
      active={active}
      progressPct={0}
      colors={colors}
      fonts={fonts}
      action={
        active ? (
          <ActivityIndicator size="small" color={colors.accent} />
        ) : grId && !grEditing ? (
          <SrcButton
            label="Check now"
            onPress={onSync}
            disabled={disabled}
            colors={colors}
            fonts={fonts}
          />
        ) : !grEditing ? (
          <SrcButton
            label="Connect"
            onPress={onStartEdit}
            disabled={disabled}
            colors={colors}
            fonts={fonts}
          />
        ) : null
      }
    >
      {/* ID entry / management */}
      {grId && !grEditing && (
        <View
          style={{
            flexDirection: "row",
            gap: spacing.md,
            marginTop: spacing.sm,
          }}
        >
          <Pressable onPress={onStartEdit}>
            <Text style={{ fontSize: 12, color: colors.accent }}>Change ID</Text>
          </Pressable>
          <Pressable onPress={onForget}>
            <Text style={{ fontSize: 12, color: colors.error }}>Disconnect</Text>
          </Pressable>
        </View>
      )}

      {/* Auto-check switch (only when connected) */}
      {grId && !grEditing && (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            marginTop: spacing.sm,
            paddingTop: spacing.sm,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: colors.borderFaint,
          }}
        >
          <Text style={{ fontSize: 12, color: colors.textMuted, flex: 1 }}>
            Check automatically on startup
          </Text>
          <Switch
            value={autoCheck}
            onValueChange={onAutoCheckChange}
            trackColor={{ false: colors.border, true: colors.accent }}
            thumbColor={colors.surface}
          />
        </View>
      )}

      {/* Last error */}
      {grId && !grEditing && lastError != null && (
        <Text
          style={{ fontSize: 11, color: colors.error, marginTop: spacing.xs }}
          numberOfLines={2}
        >
          {lastError}
        </Text>
      )}

      {grEditing && (
        <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
          <Text style={{ fontSize: 12, color: colors.textMuted, lineHeight: 18 }}>
            Enter your Goodreads username. Your profile must be public.
          </Text>
          <TextInput
            value={grInput}
            onChangeText={onGrInputChange}
            placeholder="your-username"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            style={{
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: radius.md,
              padding: spacing.md,
              color: colors.textPrimary,
              backgroundColor: colors.surfaceMuted,
              fontSize: 13,
            }}
          />
          <View style={{ flexDirection: "row", gap: spacing.md, justifyContent: "flex-end" }}>
            <Pressable onPress={onCancelEdit}>
              <Text style={{ fontSize: 13, color: colors.textMuted }}>Cancel</Text>
            </Pressable>
            <Pressable onPress={onSaveId}>
              <Text style={{ fontSize: 13, color: colors.accent, fontWeight: "600" }}>
                Save & sync
              </Text>
            </Pressable>
          </View>
        </View>
      )}
    </SourceCard>
  );
}

// ─── File import source card ──────────────────────────────────────────────────

function FileSourceCard({
  active,
  disabled,
  onPickFile,
  colors,
  fonts,
}: {
  active: boolean;
  disabled: boolean;
  onPickFile: () => void;
  colors: ThemeColors;
  fonts: ThemeFonts;
}) {
  return (
    <SourceCard
      icon="document-outline"
      title="File import"
      statusText={
        active
          ? "Parsing…"
          : "CSV · ICS · VCF — Letterboxd, Setlist.fm, iCalendar, contacts…"
      }
      active={active}
      progressPct={0}
      colors={colors}
      fonts={fonts}
      action={
        active ? (
          <ActivityIndicator size="small" color={colors.accent} />
        ) : (
          <SrcButton
            label="Choose file"
            onPress={onPickFile}
            disabled={disabled}
            colors={colors}
            fonts={fonts}
          />
        )
      }
    />
  );
}



// ─── Recent import card ───────────────────────────────────────────────────────

function runSourceIcon(source: string): React.ComponentProps<typeof Ionicons>["name"] {
  if (source === "photo-library") return "images-outline";
  if (source === "icalendar")     return "calendar-outline";
  if (source === "goodreads")     return "book-outline";
  return "document-outline";
}

function RecentImportCard({
  run,
  unreviewedCount,
  onKeep,
  onUndo,
  colors,
  fonts,
}: {
  run: ImportRun;
  unreviewedCount: number;
  onKeep: () => void;
  onUndo: () => void;
  colors: ThemeColors;
  fonts: ThemeFonts;
}) {
  const displayName = run.trigger === "startup" ? "automatic" : run.filename;
  const date = new Date(run.startedAt).toLocaleDateString("en-US", { day: "numeric", month: "short" });
  const summary = [
    run.added   > 0 ? `${run.added} new`     : "",
    run.updated > 0 ? `${run.updated} updated` : "",
  ].filter(Boolean).join(", ");
  const undone = run.status === "undone";

  return (
    <View
      style={[
        sc.card,
        { backgroundColor: colors.surface, borderColor: colors.borderFaint },
        undone && { opacity: 0.5 },
      ]}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
        <View style={[sc.iconWrap, { backgroundColor: colors.surfaceAccent }]}>
          <Ionicons name={runSourceIcon(run.source)} size={16} color={colors.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text
            style={{ fontSize: 13, color: colors.textPrimary, fontFamily: fonts.serifMedium }}
            numberOfLines={1}
          >
            {displayName}
          </Text>
          <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 1 }}>
            {summary}{summary ? " · " : ""}{date}
          </Text>
        </View>
        {undone && (
          <Text style={{ fontSize: 11, color: colors.textMuted, fontFamily: fonts.mono }}>
            UNDONE
          </Text>
        )}
      </View>

      {!undone && (
        <View
          style={{
            flexDirection: "row",
            gap: spacing.sm,
            marginTop: spacing.sm,
            justifyContent: "flex-end",
          }}
        >
          <SrcButton
            label="Keep all"
            onPress={onKeep}
            disabled={unreviewedCount === 0}
            colors={colors}
            fonts={fonts}
            variant="ghost"
          />
          <SrcButton
            label="Undo import"
            onPress={onUndo}
            colors={colors}
            fonts={fonts}
            variant="ghost"
          />
        </View>
      )}
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function SourcesScreen() {
  const router = useRouter();
  const { uri: incomingUri } = useLocalSearchParams<{ uri?: string }>();
  const { top } = useSafeAreaInsets();
  const { colors, fonts } = useTheme();
  const journal = useJournal();
  const hub = useStagingHub();
  const dialog = useDialog();

  const [activeSource, setActiveSource] = useState<ActiveSource>(null);

  // Contacts state
  const [contactsPhase, setContactsPhase] = useState<ContactsPhase>("idle");
  const [contactsReview, setContactsReview] = useState<ReviewContact[]>([]);
  const [contactsParseErrors, setContactsParseErrors] = useState<string[]>([]);
  const [contactsError, setContactsError] = useState<string | null>(null);

  // If sources was restored as the navigation root (Expo Go dev reload),
  // redirect to the tab root so the back button is available.
  useEffect(() => {
    if (!router.canGoBack()) {
      router.replace("/(tabs)");
    }
  }, []);

  // Goodreads state
  const [grId, setGrId] = useState<string | null>(null);
  const [grInput, setGrInput] = useState("");
  const [grEditing, setGrEditing] = useState(false);
  useEffect(() => {
    void getGoodreadsUserId().then(setGrId);
    // Ensure default storage is set (may already be set by _layout boot hook)
    setDefaultStorage(syncStorage);
    void getSourceState("icalendar", syncStorage).then((s) => {
      setCalAutoCheckState(s.autoCheck);
      setCalLastChecked(s.lastCheckedAt);
      setCalLastError(s.lastError);
    });
    void getSourceState("goodreads", syncStorage).then((s) => {
      setGrAutoCheckState(s.autoCheck);
      setGrLastChecked(s.lastCheckedAt);
      setGrLastError(s.lastError);
    });
  }, []);

  const anyActive = activeSource !== null;

  // ── Connected-source auto-check state ──────────────────────────────────────

  // One storage instance for this screen session
  const syncStorage = useMemo(() => makeSyncPrefsStorage(), []);

  const [calAutoCheck, setCalAutoCheckState] = useState(true);
  const [calLastChecked, setCalLastChecked] = useState<string | null>(null);
  const [calLastError, setCalLastError] = useState<string | null>(null);

  const [grAutoCheck, setGrAutoCheckState] = useState(true);
  const [grLastChecked, setGrLastChecked] = useState<string | null>(null);
  const [grLastError, setGrLastError] = useState<string | null>(null);

  // ── Recent imports ──────────────────────────────────────────────────────────

  // Map from runId -> count of entries still unreviewed (live, from journal state)
  const unreviewedByRun = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of allEntries(journal)) {
      if (e.importId && e.unreviewed !== undefined) {
        map.set(e.importId, (map.get(e.importId) ?? 0) + 1);
      }
    }
    return map;
  }, [journal]);

  // Newest-first; only runs that actually added or updated something
  const recentRuns = useMemo(
    () => [...journal.importRuns]
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    [journal.importRuns]
  );

  const handleKeepRun = useCallback((runId: string) => {
    void markRunReviewed(runId).catch(() => {});
  }, []);

  const handleUndoRun = useCallback((run: ImportRun) => {
    const n = unreviewedByRun.get(run.id) ?? 0;
    const m = run.replaced.length;
    const parts: string[] = [];
    if (n > 0) parts.push(`Hide ${n} ${n === 1 ? "entry" : "entries"} you have not reviewed`);
    if (m > 0) parts.push(`restore ${m} that ${m === 1 ? "was" : "were"} replaced`);
    const body = parts.length > 0
      ? `${parts.join(" and ")}? Hidden entries can be restored in Settings.`
      : "Nothing left to hide or restore for this import.";
    dialog.confirm(
      "Undo import",
      body,
      "Undo import",
      async () => { await undoRun(run.id); }
    );
  }, [unreviewedByRun, dialog]);

  const handleCalAutoCheckChange = useCallback(async (v: boolean) => {
    setCalAutoCheckState(v);
    await setSourceAutoCheck("icalendar", v, syncStorage);
  }, [syncStorage]);

  const handleGrAutoCheckChange = useCallback(async (v: boolean) => {
    setGrAutoCheckState(v);
    await setSourceAutoCheck("goodreads", v, syncStorage);
  }, [syncStorage]);

  // ── Import summary ──────────────────────────────────────────────────────────

  function buildSummaryMessage(result: ImportResult): string {
    const { added, updated, skipped, errors } = result;
    const countParts: string[] = [];
    if (added > 0) countParts.push(`${added} new`);
    if (updated > 0) countParts.push(`${updated} updated`);
    const line1 = countParts.length > 0 ? countParts.join(", ") + "." : "";

    const skipParts: string[] = [];
    const alreadyIn = skipped.duplicate + skipped.inFile;
    if (alreadyIn > 0) skipParts.push(`${alreadyIn} already in your journal`);
    if (skipped.removed === 1) skipParts.push("1 you hid earlier was skipped");
    else if (skipped.removed > 1) skipParts.push(`${skipped.removed} you hid earlier were skipped`);
    const line2 = skipParts.length > 0 ? skipParts.join(", ") + "." : "";

    const line3 = errors.length > 0
      ? `${errors.length} ${errors.length === 1 ? "row" : "rows"} could not be read.`
      : "";

    return [line1, line2, line3].filter(Boolean).join(" ");
  }

  const showImportSummary = (result: ImportResult) => {
    const { added, updated } = result;
    if (added === 0 && updated === 0) {
      dialog.alert("Nothing new", "Everything in this file is already in your journal.");
      return;
    }
    const message = buildSummaryMessage(result);
    dialog.show({
      title: "Import complete",
      message,
      actions: [
        {
          label: "Review new",
          style: "default" as const,
          onPress: () => router.navigate("/(tabs)"),
        },
        { label: "Done", style: "cancel" as const },
      ],
    });
  };

  // ── Source actions ──────────────────────────────────────────────────────────

  const processUri = async (uri: string, filename: string) => {
    setActiveSource("file");
    await new Promise<void>((r) => setTimeout(r, 50));
    try {
      const response = await fetch(uri);
      if (!response.ok) throw new Error(`Could not read file (HTTP ${response.status})`);
      const text = await response.text();
      await new Promise<void>((r) => setTimeout(r, 0));
      const result = await importFile(filename, text);
      showImportSummary(result);
    } catch (err) {
      dialog.alert("Import failed", String(err));
    } finally {
      setActiveSource(null);
    }
  };

  const pickFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["text/csv", "text/calendar", "text/x-vcard", "application/json", "application/octet-stream", "*/*"],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets[0]) return;
      const { uri, name } = result.assets[0];
      await processUri(uri, name ?? "imported-file");
    } catch (err) {
      dialog.alert("Import failed", String(err));
    }
  };

  const importContactsFromDevice = async () => {
    setActiveSource("contacts");
    setContactsPhase("parsing");
    setContactsError(null);
    try {
      const res = await readDeviceContacts();
      if (res.status === "unavailable") {
        dialog.alert("Not available", "Phone contacts can't be read on this device. Use a contacts file instead.");
        setContactsPhase("idle");
        setActiveSource(null);
        return;
      }
      if (res.status === "denied") {
        dialog.alert(
          "Contacts access needed",
          res.canAskAgain
            ? "Chronicle needs permission to read your contacts. Nothing leaves your phone."
            : "Contacts access is turned off. Enable it for Chronicle in your phone's Settings, then try again.",
          res.canAskAgain ? undefined : () => { Linking.openSettings(); },
        );
        setContactsPhase("idle");
        setActiveSource(null);
        return;
      }
      if (!res.contacts.length) {
        dialog.alert("No contacts found", "Your phone's address book has no named contacts.");
        setContactsPhase("idle");
        setActiveSource(null);
        return;
      }
      setContactsReview(buildReviewContacts(res.contacts, journal.people));
      setContactsParseErrors([]);
      setContactsPhase("review");
    } catch (err) {
      setContactsError(String(err));
      setContactsPhase("idle");
      setActiveSource(null);
    }
  };

  const importContactsFromFile = async (uri: string, filename: string) => {
    setActiveSource("contacts");
    setContactsPhase("parsing");
    setContactsError(null);
    await new Promise<void>((r) => setTimeout(r, 50));
    try {
      const response = await fetch(uri);
      if (!response.ok) throw new Error(`Could not read file (HTTP ${response.status})`);
      const text = await response.text();
      await new Promise<void>((r) => setTimeout(r, 0));
      const result = parseContacts(filename, text);
      if (!result.contacts.length && result.errors.length) throw new Error(result.errors[0]);
      setContactsReview(buildReviewContacts(result.contacts, journal.people));
      setContactsParseErrors(result.errors);
      setContactsPhase("review");
    } catch (err) {
      setContactsError(String(err));
      setContactsPhase("idle");
      setActiveSource(null);
    }
  };

  const pickContactsFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["text/vcard", "text/x-vcard", "text/csv", "*/*"],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets[0]) return;
      const { uri, name } = result.assets[0];
      await importContactsFromFile(uri, name ?? "contacts");
    } catch (err) {
      setContactsError(String(err));
    }
  };

  const commitContacts = async () => {
    const toAdd = contactsReview.filter((c) => c.selected);

    // For duplicate contacts that came from the device and carry a photo,
    // patch the existing Person record if it doesn't have a photo yet.
    const photoUpdates: Person[] = contactsReview
      .filter((c) => c.status === "duplicate" && c.matchId && c.draft.photo)
      .flatMap((c) => {
        const existing = journal.people.find((p) => p.id === c.matchId);
        if (!existing || existing.photo) return [];
        return [{ ...existing, photo: c.draft.photo! }];
      });

    if (!toAdd.length && !photoUpdates.length) return;
    setContactsPhase("committing");
    try {
      const now = new Date().toISOString();
      const newPeople: Person[] = toAdd.map(({ draft }) => ({
        id: uid(),
        name: draft.name,
        ...(draft.aliases?.length ? { aliases: draft.aliases } : {}),
        ...(draft.photo ? { photo: draft.photo } : {}),
        createdAt: now,
      }));

      await putMany("people", [...newPeople, ...photoUpdates]);
      setContactsReview([]);
      setContactsPhase("idle");
      setActiveSource(null);

      const parts: string[] = [];
      if (newPeople.length) parts.push(`${newPeople.length} ${newPeople.length === 1 ? "person" : "people"} added`);
      if (photoUpdates.length) parts.push(`${photoUpdates.length} photo${photoUpdates.length === 1 ? "" : "s"} updated`);
      dialog.alert("Import complete", parts.join(", ") + ".");
    } catch (err) {
      dialog.alert("Commit failed", String(err));
      setContactsPhase("review");
    }
  };

  const toggleContactSelected = (idx: number, selected: boolean) => {
    setContactsReview((prev) => prev.map((c, i) => (i === idx ? { ...c, selected } : c)));
  };

  const discardContactsReview = () => {
    setContactsReview([]);
    setContactsPhase("idle");
    setActiveSource(null);
  };

  useEffect(() => {
    if (!incomingUri) return;
    const filename = incomingUri.split("/").pop() ?? "shared-file";
    const lower = filename.toLowerCase();
    if (lower.endsWith(".vcf") || lower.endsWith(".vcard")) {
      void importContactsFromFile(incomingUri, filename);
    } else {
      void processUri(incomingUri, filename);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingUri]);

  const importFromCalendar = async (pastDays: number) => {
    setActiveSource("calendar");
    await new Promise<void>((r) => setTimeout(r, 50));
    try {
      const res = await readDeviceCalendar(pastDays, 0);
      if (res.status === "unavailable") {
        dialog.alert("Calendar unavailable", "This device doesn't expose a calendar.");
        return;
      }
      if (res.status === "denied") {
        if (!res.canAskAgain) {
          dialog.confirm(
            "Calendar access needed",
            "Allow calendar access in Settings. Nothing leaves your phone.",
            "Open Settings",
            () => void Linking.openSettings(),
          );
        } else {
          dialog.alert("Calendar access needed", "Chronicle needs permission to read your calendar.");
        }
        return;
      }
      if (!res.count) {
        dialog.alert("No events found", "No one-off events found in that time range.");
        return;
      }
      const result = await importFile("device-calendar.ics", res.ics, { forced: "icalendar" });
      showImportSummary(result);
    } catch (err) {
      dialog.alert("Import failed", String(err));
    } finally {
      setActiveSource(null);
    }
  };

  const syncGoodreads = async (userId: string) => {
    setActiveSource("goodreads");
    await new Promise<void>((r) => setTimeout(r, 50));
    try {
      const { csv, count } = await fetchGoodreadsShelfCsv(userId);
      if (!count) {
        dialog.alert("No books found", "Your Goodreads \"read\" shelf is empty or private.");
        return;
      }
      const result = await importFile(`goodreads-${userId}.csv`, csv, { forced: "goodreads" });
      showImportSummary(result);
    } catch (err) {
      dialog.alert("Import failed", String(err));
    } finally {
      setActiveSource(null);
    }
  };

  const onGoodreadsSync = () => {
    if (grId && !grEditing) syncGoodreads(grId);
    else setGrEditing(true);
  };

  const saveGoodreadsId = async () => {
    const id = parseGoodreadsUserId(grInput);
    if (!id) {
      dialog.alert("Couldn't read that", "Enter your Goodreads username (e.g. your-username or a profile URL).");
      return;
    }
    await setGoodreadsUserId(id);
    setGrId(id);
    setGrEditing(false);
    setGrInput("");
    void syncGoodreads(id);
  };

  const forgetGoodreads = async () => {
    await setGoodreadsUserId(null);
    setGrId(null);
    setGrEditing(false);
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: "Sources",
          headerStyle: { backgroundColor: colors.surface },
          headerTitleStyle: {
            fontFamily: fonts.serifSemiBold,
            color: colors.textBright,
          },
          headerTintColor: colors.accent,
        }}
      />

      <ScrollView
        style={{ flex: 1, backgroundColor: colors.bg }}
        contentContainerStyle={{ paddingTop: spacing.md, paddingBottom: spacing["3xl"] }}
      >
        {/* ── On device ───────────────────────────────────────────────────── */}
        <SectionLabel label="On device" colors={colors} />

        <PhotoSourceEntry />

        {/* Place suggestions — shown until WP12c replaces this with the Places screen */}
        {hub.hierarchy.some((cg) => cg.pendingCount > 0) && (
          <View style={{ paddingHorizontal: spacing.lg, marginBottom: spacing.sm }}>
            <PlaceStagingCard
              hub={hub}
              router={router}
              onConfirm={(title, msg, cta, fn) =>
                dialog.confirm(title, msg, cta, fn)
              }
              colors={colors}
              fonts={fonts}
            />
          </View>
        )}

        <CalendarSourceCard
          active={activeSource === "calendar"}
          disabled={anyActive}
          onSync={importFromCalendar}
          autoCheck={calAutoCheck}
          onAutoCheckChange={handleCalAutoCheckChange}
          lastCheckedAt={calLastChecked}
          lastError={calLastError}
          colors={colors}
          fonts={fonts}
        />

        <ContactsSourceCard
          peopleCount={journal.people.length}
          phase={contactsPhase}
          disabled={anyActive && activeSource !== "contacts"}
          onImportFromDevice={importContactsFromDevice}
          onPickFile={pickContactsFile}
          colors={colors}
          fonts={fonts}
        />

        {/* Contacts review */}
        {contactsPhase === "review" && contactsReview.length > 0 && (
          <ContactsReviewPanel
            contacts={contactsReview}
            parseErrors={contactsParseErrors}
            photoUpdateCount={
              contactsReview.filter(
                (c) => c.status === "duplicate" && c.matchId && c.draft.photo &&
                  !journal.people.find((p) => p.id === c.matchId)?.photo,
              ).length
            }
            onToggle={toggleContactSelected}
            onSelectAll={() => setContactsReview((prev) => prev.map((c) => ({ ...c, selected: c.status === "new" })))}
            onDeselectAll={() => setContactsReview((prev) => prev.map((c) => ({ ...c, selected: false })))}
            onCommit={commitContacts}
            onDiscard={discardContactsReview}
            colors={colors}
            fonts={fonts}
          />
        )}
        {contactsError && contactsPhase === "idle" && (
          <View style={{ backgroundColor: colors.errorBg, borderRadius: radius.md, padding: spacing.md, marginHorizontal: spacing.lg, marginBottom: spacing.md }}>
            <Text style={{ color: colors.errorLight, fontSize: 13 }}>{contactsError}</Text>
          </View>
        )}

        {/* ── Online ──────────────────────────────────────────────────────── */}
        <SectionLabel label="Online" colors={colors} />

        <GoodreadsSourceCard
          active={activeSource === "goodreads"}
          disabled={anyActive && activeSource !== "goodreads"}
          grId={grId}
          grEditing={grEditing}
          grInput={grInput}
          onGrInputChange={setGrInput}
          onSync={onGoodreadsSync}
          onStartEdit={() => setGrEditing(true)}
          onCancelEdit={() => setGrEditing(false)}
          onSaveId={saveGoodreadsId}
          onForget={forgetGoodreads}
          autoCheck={grAutoCheck}
          onAutoCheckChange={handleGrAutoCheckChange}
          lastCheckedAt={grLastChecked}
          lastError={grLastError}
          colors={colors}
          fonts={fonts}
        />

        {/* ── File import ──────────────────────────────────────────────────── */}
        <SectionLabel label="File import" colors={colors} />

        <FileSourceCard
          active={activeSource === "file"}
          disabled={anyActive && activeSource !== "file"}
          onPickFile={pickFile}
          colors={colors}
          fonts={fonts}
        />

        {/* ── Recent imports ───────────────────────────────────────────── */}
        {recentRuns.length > 0 && (
          <>
            <SectionLabel label="Recent imports" colors={colors} />
            {recentRuns.map((run) => (
              <RecentImportCard
                key={run.id}
                run={run}
                unreviewedCount={unreviewedByRun.get(run.id) ?? 0}
                onKeep={() => handleKeepRun(run.id)}
                onUndo={() => handleUndoRun(run)}
                colors={colors}
                fonts={fonts}
              />
            ))}
          </>
        )}

      </ScrollView>

      <Dialog {...dialog.props} onDismiss={dialog.dismiss} />
    </>
  );
}
