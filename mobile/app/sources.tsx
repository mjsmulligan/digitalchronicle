/**
 * Sources — unified hub for all ways data enters Chronicle.
 *
 * Sections:
 *   "Pending review"  — appears when staged import batches are waiting
 *   "On device"       — Photo library (scan), Device calendar
 *   "Online"          — Goodreads read-shelf sync
 *   "File import"     — CSV / ICS / VCF file picker
 *
 * Design principles:
 *   - All source cards share the same chrome (icon + title + status + action button)
 *   - Progress is shown as a slim animated bar, matching the commit progress card
 *   - Batch review uses a Switch per record (same as the place-staging screens)
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
  FlatList,
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
import { useJournal, removeMany, putMany, type CommitProgress } from "@chronicle/journal/db";
import { stageFile } from "@chronicle/journal/staging";
import {
  uid,
  type StagingBatch,
} from "@chronicle/journal/types";
import type { Person } from "@chronicle/journal/types";
import { readDeviceContacts } from "../src/lib/deviceContacts";
import { parseContacts, type ContactDraft } from "@chronicle/journal/contacts";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme, spacing, radius, type ThemeColors, type ThemeFonts } from "../src/components/ThemeProvider";
import { KindIcon } from "../src/components/KindIcon";
import { BatchReview } from "../src/components/BatchReview";
import { PlaceStagingCard } from "../src/components/PlaceStagingCard";
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

// ─── Types ────────────────────────────────────────────────────────────────────

type ActiveSource = "calendar" | "goodreads" | "file" | "contacts" | null;

type ContactStatus = "new" | "duplicate";

interface ReviewContact {
  draft: ContactDraft;
  sourceRow: number;
  status: ContactStatus;
  matchId?: string;
  selected: boolean;
}

type ContactsPhase = "idle" | "parsing" | "review" | "committing";

// ─── Contact helpers ──────────────────────────────────────────────────────────

function normContactName(s: string): string {
  return s.trim().toLowerCase();
}

function buildReviewContacts(
  contacts: { draft: ContactDraft; sourceRow: number }[],
  existing: Person[],
): ReviewContact[] {
  const byName = new Map(existing.map((p) => [normContactName(p.name), p]));
  const seenInBatch = new Set<string>();
  return contacts.map(({ draft, sourceRow }) => {
    const key = normContactName(draft.name);
    const match = byName.get(key);
    const isDupe = seenInBatch.has(key) || !!match;
    seenInBatch.add(key);
    return { draft, sourceRow, status: isDupe ? "duplicate" : "new", matchId: match?.id, selected: !isDupe };
  });
}

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

function CalendarSourceCard({
  active,
  disabled,
  onSync,
  colors,
  fonts,
}: {
  active: boolean;
  disabled: boolean;
  onSync: () => void;
  colors: ThemeColors;
  fonts: ThemeFonts;
}) {
  return (
    <SourceCard
      icon="calendar-outline"
      title="Device calendar"
      statusText={
        active
          ? "Syncing…"
          : "Imports one-off events from the past year and next 30 days"
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
            label="Sync"
            onPress={onSync}
            disabled={disabled}
            colors={colors}
            fonts={fonts}
          />
        )
      }
    />
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

// ─── Contacts review panel ────────────────────────────────────────────────────

function ContactsReviewPanel({
  contacts,
  parseErrors,
  onToggle,
  onSelectAll,
  onDeselectAll,
  onCommit,
  onDiscard,
  colors,
  fonts,
}: {
  contacts: ReviewContact[];
  parseErrors: string[];
  onToggle: (idx: number, selected: boolean) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onCommit: () => void;
  onDiscard: () => void;
  colors: ThemeColors;
  fonts: ThemeFonts;
}) {
  const newCount = contacts.filter((c) => c.status === "new").length;
  const selectedCount = contacts.filter((c) => c.selected).length;

  return (
    <View style={{
      marginHorizontal: spacing.lg,
      marginBottom: spacing.md,
      backgroundColor: colors.surface,
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: "hidden",
    }}>
      {/* Header */}
      <View style={{ padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ fontSize: 13, color: colors.textSecondary, fontFamily: fonts.sans }}>
          {contacts.length} contacts · {newCount} new · {selectedCount} selected
        </Text>
        <Pressable onPress={onDiscard} hitSlop={8}>
          <Ionicons name="close" size={16} color={colors.textMuted} />
        </Pressable>
      </View>

      {/* Quick actions */}
      <View style={{ flexDirection: "row", gap: spacing.base, padding: spacing.sm, paddingHorizontal: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <Pressable onPress={onSelectAll}><Text style={{ fontSize: 12, color: colors.accent, fontWeight: "600" }}>Select new ({newCount})</Text></Pressable>
        <Pressable onPress={onDeselectAll}><Text style={{ fontSize: 12, color: colors.accent, fontWeight: "600" }}>Deselect all</Text></Pressable>
      </View>

      {/* Parse errors */}
      {parseErrors.length > 0 && (
        <View style={{ backgroundColor: colors.errorBg, padding: spacing.sm, paddingHorizontal: spacing.md }}>
          {parseErrors.slice(0, 3).map((e, i) => (
            <Text key={i} style={{ fontSize: 12, color: colors.errorLight, marginBottom: 2 }}>{e}</Text>
          ))}
          {parseErrors.length > 3 && <Text style={{ fontSize: 12, color: colors.errorLight }}>…and {parseErrors.length - 3} more</Text>}
        </View>
      )}

      {/* Contact list */}
      {contacts.map((contact, idx) => {
        const isNew = contact.status === "new";
        return (
          <View key={idx} style={{
            flexDirection: "row", alignItems: "center",
            paddingHorizontal: spacing.md, paddingVertical: 10,
            borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
            gap: 10, opacity: isNew ? 1 : 0.45,
          }}>
            <Switch
              value={contact.selected}
              onValueChange={(v) => onToggle(idx, v)}
              disabled={!isNew}
              trackColor={{ true: colors.accent, false: colors.border }}
              thumbColor={contact.selected ? colors.accentSoft : colors.textMuted}
              style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
            />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, color: colors.textPrimary, fontWeight: "500", fontFamily: fonts.sans }}>{contact.draft.name}</Text>
              {contact.draft.aliases?.length ? (
                <Text style={{ fontSize: 12, color: colors.textTertiary, marginTop: 2 }} numberOfLines={1}>{contact.draft.aliases.join(", ")}</Text>
              ) : null}
            </View>
            <Text style={{ fontSize: 11, fontWeight: "700", textTransform: "uppercase", color: isNew ? colors.success : colors.textMuted }}>
              {isNew ? "new" : "exists"}
            </Text>
          </View>
        );
      })}

      {/* Commit bar */}
      <View style={{ padding: spacing.md }}>
        <Pressable
          style={{
            backgroundColor: selectedCount > 0 ? colors.accentBold : colors.border,
            borderRadius: radius.lg, paddingVertical: 14, alignItems: "center",
            opacity: selectedCount > 0 ? 1 : 0.5,
          }}
          onPress={onCommit}
          disabled={selectedCount === 0}
        >
          <Text style={{ fontSize: 15, color: "#fff", fontWeight: "700", fontFamily: fonts.sansMedium ?? fonts.sans }}>
            Add {selectedCount} {selectedCount === 1 ? "person" : "people"}
          </Text>
        </Pressable>
      </View>
    </View>
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
  colors: ThemeColors;
  fonts: ThemeFonts;
}) {
  return (
    <SourceCard
      icon="book-outline"
      title="Goodreads"
      statusText={
        active
          ? "Syncing…"
          : grId
          ? `Connected — ID ${grId}`
          : "Sync your read-shelf via public RSS"
      }
      active={active}
      progressPct={0}
      colors={colors}
      fonts={fonts}
      action={
        active ? (
          <ActivityIndicator size="small" color={colors.accent} />
        ) : grId && !grEditing ? (
          <SrcButton
            label="Sync"
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
      {grEditing && (
        <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
          <Text style={{ fontSize: 12, color: colors.textMuted, lineHeight: 18 }}>
            Paste your Goodreads profile link. Your profile must be public.
          </Text>
          <TextInput
            value={grInput}
            onChangeText={onGrInputChange}
            placeholder="https://www.goodreads.com/user/show/12345678"
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
  const [parseError, setParseError] = useState<string | null>(null);
  const [freshBatch, setFreshBatch] = useState<StagingBatch | null>(null);

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
  }, []);

  // Combined pending batches: freshly parsed (first) + persisted
  const pendingBatches: StagingBatch[] = useMemo(
    () => [
      ...(freshBatch ? [freshBatch] : []),
      ...journal.staging.filter((b) => b.id !== freshBatch?.id),
    ],
    [freshBatch, journal.staging],
  );

  const anyActive = activeSource !== null;

  // ── Source actions ──────────────────────────────────────────────────────────

  const processUri = async (uri: string, filename: string) => {
    setActiveSource("file");
    setParseError(null);
    await new Promise<void>((r) => setTimeout(r, 50));
    try {
      const response = await fetch(uri);
      if (!response.ok) throw new Error(`Could not read file (HTTP ${response.status})`);
      const text = await response.text();
      await new Promise<void>((r) => setTimeout(r, 0));
      const batch = await stageFile(filename, text);
      setFreshBatch(batch);
    } catch (err) {
      setParseError(String(err));
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
      setParseError(String(err));
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
    if (!toAdd.length) return;
    setContactsPhase("committing");
    try {
      const now = new Date().toISOString();
      const people: Person[] = toAdd.map(({ draft }) => ({
        id: uid(),
        name: draft.name,
        ...(draft.aliases?.length ? { aliases: draft.aliases } : {}),
        createdAt: now,
      }));
      await putMany("people", people);
      setContactsReview([]);
      setContactsPhase("idle");
      setActiveSource(null);
      dialog.alert("Import complete", `${people.length} ${people.length === 1 ? "person" : "people"} added.`);
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

  const importFromCalendar = async () => {
    setActiveSource("calendar");
    setParseError(null);
    await new Promise<void>((r) => setTimeout(r, 50));
    try {
      const res = await readDeviceCalendar();
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
        dialog.alert("No events found", "No one-off events in the past year or next 30 days.");
        return;
      }
      const batch = await stageFile("device-calendar.ics", res.ics, "icalendar");
      setFreshBatch(batch);
    } catch (err) {
      setParseError(String(err));
    } finally {
      setActiveSource(null);
    }
  };

  const syncGoodreads = async (userId: string) => {
    setActiveSource("goodreads");
    setParseError(null);
    await new Promise<void>((r) => setTimeout(r, 50));
    try {
      const { csv, count } = await fetchGoodreadsShelfCsv(userId);
      if (!count) {
        dialog.alert("No books found", "Your Goodreads \"read\" shelf is empty or private.");
        return;
      }
      const batch = await stageFile(`goodreads-${userId}.csv`, csv, "goodreads");
      setFreshBatch(batch);
    } catch (err) {
      setParseError(String(err));
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
      dialog.alert("Couldn't read that", "Paste your Goodreads profile link or the number in it.");
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

  const handleCommit = (count: number) => {
    setFreshBatch(null);
    dialog.alert(
      "Import complete",
      `${count} ${count === 1 ? "entry" : "entries"} added to your journal.`,
    );
  };

  const handleDiscard = async (batchId: string) => {
    await removeMany("staging", [batchId]);
    if (freshBatch?.id === batchId) {
      setFreshBatch(null);
    }
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
        {/* ── Pending review ──────────────────────────────────────────────── */}
        {(pendingBatches.length > 0 || hub.hierarchy.some((cg) => cg.pendingCount > 0)) && (
          <>
            <SectionLabel label="Pending review" colors={colors} />
            <View style={{ paddingHorizontal: spacing.lg }}>
              {parseError && (
                <View
                  style={{
                    backgroundColor: colors.errorBg,
                    borderRadius: radius.md,
                    padding: spacing.md,
                    marginBottom: spacing.md,
                  }}
                >
                  <Text style={{ color: colors.errorLight, fontSize: 13 }}>{parseError}</Text>
                </View>
              )}
              {/* Place suggestions — inline card matching BatchReview */}
              {hub.hierarchy.some((cg) => cg.pendingCount > 0) && (
                <PlaceStagingCard
                  hub={hub}
                  router={router}
                  onConfirm={(title, msg, cta, fn) =>
                    dialog.confirm(title, msg, cta, fn)
                  }
                  colors={colors}
                  fonts={fonts}
                />
              )}
              {/* File import batches */}
              {pendingBatches.map((batch) => (
                <BatchReview
                  key={batch.id}
                  batch={batch}
                  commitProgress={journal.commitProgress}
                  onCommit={handleCommit}
                  onDiscard={() => handleDiscard(batch.id)}
                  onError={dialog.alert}
                  colors={colors}
                  fonts={fonts}
                />
              ))}
            </View>
          </>
        )}

        {/* ── On device ───────────────────────────────────────────────────── */}
        <SectionLabel label="On device" colors={colors} />

        {/* PhotoSourceEntry — review link removed: suggestions are inline above */}
        <PhotoSourceEntry />

        <CalendarSourceCard
          active={activeSource === "calendar"}
          disabled={anyActive}
          onSync={importFromCalendar}
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

        {/* Error shown when no pending batches (won't appear in pending section) */}
        {parseError && pendingBatches.length === 0 && (
          <View
            style={{
              marginHorizontal: spacing.lg,
              marginTop: spacing.sm,
              backgroundColor: colors.errorBg,
              borderRadius: radius.md,
              padding: spacing.md,
            }}
          >
            <Text style={{ color: colors.errorLight, fontSize: 13 }}>{parseError}</Text>
          </View>
        )}
      </ScrollView>

      <Dialog {...dialog.props} onDismiss={dialog.dismiss} />
    </>
  );
}
