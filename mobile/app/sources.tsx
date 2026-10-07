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
import { stageFile, saveBatch, commitBatch } from "@chronicle/journal/staging";
import {
  entryTitle,
  view,
  uid,
  type StagingBatch,
  type StagedRecord,
  type StageStatus,
} from "@chronicle/journal/types";
import type { Person } from "@chronicle/journal/types";
import { readDeviceContacts } from "../src/lib/deviceContacts";
import { parseContacts, type ContactDraft } from "@chronicle/journal/contacts";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme, spacing, radius } from "../src/components/ThemeProvider";
import { KindIcon } from "../src/components/KindIcon";
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
import type { CountryGroup, RegionGroup, PlaceGroup } from "../src/lib/exif/useStagingHub";

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

// ─── Batch review helpers (same as old import.tsx) ────────────────────────────

const STATUS_COLOR: Record<StageStatus, string> = {
  new: "#22c55e",
  supersedes: "#3b82f6",
  duplicate: "#475569",
  superseded: "#475569",
  "batch-duplicate": "#ef4444",
};

const STATUS_LABEL: Record<StageStatus, string> = {
  new: "new",
  supersedes: "replaces",
  duplicate: "duplicate",
  superseded: "lower tier",
  "batch-duplicate": "dupe in file",
};

function entrySubkind(e: StagedRecord["entry"]): string | undefined {
  if (e.kind === "leg") return e.mode;
  if (e.kind === "event")
    return (e as Extract<typeof e, { kind: "event" }>).category;
  return undefined;
}

function isSelectable(status: StageStatus): boolean {
  return status === "new" || status === "supersedes";
}

const INITIAL_VISIBLE = 100;

// ─── RecordRow ────────────────────────────────────────────────────────────────

function RecordRow({
  record,
  onToggle,
  colors,
  fonts,
}: {
  record: StagedRecord;
  onToggle: (selected: boolean) => void;
  colors: any;
  fonts: any;
}) {
  const v = view(record.entry);
  const selectable = isSelectable(record.status);
  return (
    <View
      style={[
        rr.row,
        { borderBottomColor: colors.border },
        !selectable && rr.dim,
      ]}
    >
      <Switch
        value={record.selected}
        onValueChange={onToggle}
        disabled={!selectable}
        trackColor={{ true: colors.accent, false: colors.border }}
        thumbColor={record.selected ? colors.accentSubtle : colors.textMuted}
        style={rr.sw}
      />
      <View style={rr.iconWrap}>
        <KindIcon
          kind={record.entry.kind}
          subkind={entrySubkind(record.entry)}
          size={16}
          color={colors.textSecondary}
          accessibilityLabel=""
        />
      </View>
      <View style={rr.body}>
        <Text style={[rr.title, { color: colors.textPrimary, fontFamily: fonts.sans }]} numberOfLines={1}>
          {entryTitle(v)}
        </Text>
        <View style={rr.meta}>
          <Text style={[rr.status, { color: STATUS_COLOR[record.status] }]}>
            {STATUS_LABEL[record.status]}
          </Text>
          {record.warnings.length > 0 && (
            <Text style={[rr.warning, { color: colors.star }]} numberOfLines={1}>
              {"⚠"} {record.warnings[0]}
            </Text>
          )}
        </View>
      </View>
    </View>
  );
}

const rr = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  dim: { opacity: 0.45 },
  sw: { transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] },
  iconWrap: { width: 22, alignItems: "center" },
  body: { flex: 1 },
  title: { fontSize: 14, fontWeight: "500", marginBottom: 2 },
  meta: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  status: { fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  warning: { fontSize: 11, flex: 1 },
});

// ─── BatchReview ──────────────────────────────────────────────────────────────

function BatchReview({
  batch,
  commitProgress,
  onCommit,
  onDiscard,
  onError,
  colors,
  fonts,
}: {
  batch: StagingBatch;
  commitProgress: CommitProgress | null;
  onCommit: (count: number) => void;
  onDiscard: () => void;
  onError: (title: string, message: string) => void;
  colors: any;
  fonts: any;
}) {
  const [b, setB] = useState(batch);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);

  const committing = commitProgress?.batchId === batch.id;
  const progressPct =
    committing && commitProgress!.total > 0
      ? commitProgress!.done / commitProgress!.total
      : 0;

  const selected = b.records.filter((r) => r.selected).length;
  const importable = b.records.filter((r) => isSelectable(r.status)).length;
  const visibleRecords = b.records.slice(0, visibleCount);
  const hiddenCount = b.records.length - visibleCount;

  const update = useCallback((next: StagingBatch) => {
    setB(next);
    void saveBatch(next);
  }, []);

  const toggleRecord = (idx: number, sel: boolean) => {
    update({ ...b, records: b.records.map((r, i) => (i === idx ? { ...r, selected: sel } : r)) });
  };

  const selectImportable = () =>
    update({ ...b, records: b.records.map((r) => ({ ...r, selected: isSelectable(r.status) })) });

  const deselectAll = () =>
    update({ ...b, records: b.records.map((r) => ({ ...r, selected: false })) });

  const handleCommit = async () => {
    try {
      const result = await commitBatch(b);
      onCommit(result.count);
    } catch (err) {
      onError("Commit failed", String(err));
    }
  };

  // Committing → slim progress card
  if (committing) {
    return (
      <View style={[br.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={br.commitTop}>
          <ActivityIndicator size="small" color={colors.accent} />
          <View style={{ flex: 1 }}>
            <Text style={[br.filename, { color: colors.textPrimary, fontFamily: fonts.sans }]} numberOfLines={1}>
              {b.filename}
            </Text>
            <Text style={[br.commitCount, { color: colors.textTertiary }]}>
              Saving {commitProgress!.done} of {commitProgress!.total} entries…
            </Text>
          </View>
        </View>
        <View style={[br.track, { backgroundColor: colors.border }]}>
          <View style={[br.fill, { width: `${Math.round(progressPct * 100)}%`, backgroundColor: colors.accent }]} />
        </View>
      </View>
    );
  }

  return (
    <View style={[br.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {/* Header */}
      <View style={[br.header, { borderBottomColor: colors.border }]}>
        <View style={{ flex: 1 }}>
          <Text style={[br.filename, { color: colors.textPrimary, fontFamily: fonts.sans }]} numberOfLines={1}>
            {b.filename}
          </Text>
          <Text style={[br.meta, { color: colors.textTertiary }]}>
            {b.records.length} parsed · {b.errors.length} errors · {selected} selected
          </Text>
        </View>
        <Pressable onPress={onDiscard} style={{ padding: 4 }}>
          <Ionicons name="trash-outline" size={18} color={colors.error} />
        </Pressable>
      </View>

      {/* Parse errors */}
      {b.errors.length > 0 && (
        <View style={[br.errBox, { backgroundColor: colors.errorBg, borderBottomColor: colors.border }]}>
          {b.errors.slice(0, 3).map((e, i) => (
            <Text key={i} style={[br.errText, { color: colors.errorLight }]} numberOfLines={2}>
              {e}
            </Text>
          ))}
          {b.errors.length > 3 && (
            <Text style={[br.errText, { color: colors.errorLight }]}>
              …and {b.errors.length - 3} more
            </Text>
          )}
        </View>
      )}

      {/* Quick actions */}
      <View style={[br.quick, { borderBottomColor: colors.borderFaint }]}>
        <Pressable onPress={selectImportable}>
          <Text style={[br.quickText, { color: colors.accent }]}>
            Select importable ({importable})
          </Text>
        </Pressable>
        <Pressable onPress={deselectAll}>
          <Text style={[br.quickText, { color: colors.accent }]}>Deselect all</Text>
        </Pressable>
      </View>

      {/* Commit bar */}
      <View style={br.commitBar}>
        <Pressable
          style={[br.commitBtn, { backgroundColor: colors.accentBold }, !selected && { opacity: 0.4 }]}
          disabled={!selected}
          onPress={handleCommit}
        >
          <Text style={[br.commitBtnText, { fontFamily: fonts.sans }]}>
            Commit {selected} {selected === 1 ? "entry" : "entries"} to journal
          </Text>
        </Pressable>
      </View>

      {/* Record list */}
      <FlatList
        data={visibleRecords}
        keyExtractor={(r) => r.entry.id}
        renderItem={({ item, index }) => (
          <RecordRow
            record={item}
            onToggle={(v) => toggleRecord(index, v)}
            colors={colors}
            fonts={fonts}
          />
        )}
        scrollEnabled={false}
        ListFooterComponent={
          hiddenCount > 0 ? (
            <Pressable
              style={[br.loadMore, { borderTopColor: colors.border }]}
              onPress={() => setVisibleCount((n) => n + INITIAL_VISIBLE)}
            >
              <Text style={[br.loadMoreText, { color: colors.accent }]}>
                Show next {Math.min(INITIAL_VISIBLE, hiddenCount)} of {hiddenCount} remaining
              </Text>
            </Pressable>
          ) : null
        }
      />
    </View>
  );
}

const br = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    borderWidth: 1,
    marginBottom: spacing.lg,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    borderBottomWidth: 1,
    gap: spacing.md,
  },
  filename: { fontSize: 14, fontWeight: "600", marginBottom: 2 },
  meta: { fontSize: 12 },
  errBox: {
    padding: 10,
    borderBottomWidth: 1,
  },
  errText: { fontSize: 11, marginBottom: 2 },
  quick: {
    flexDirection: "row",
    gap: spacing.base,
    padding: 10,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
  },
  quickText: { fontSize: 12, fontWeight: "600" },
  commitBar: { padding: spacing.md },
  commitBtn: {
    borderRadius: radius.lg,
    paddingVertical: 13,
    alignItems: "center",
  },
  commitBtnText: { fontSize: 14, color: "#fff", fontWeight: "700" },
  loadMore: {
    padding: spacing.md,
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  loadMoreText: { fontSize: 13, fontWeight: "600" },
  commitTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    paddingBottom: spacing.sm,
  },
  commitCount: { fontSize: 12, marginTop: 2 },
  track: {
    height: 4,
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    borderRadius: 2,
    overflow: "hidden",
  },
  fill: { height: "100%", borderRadius: 2 },
});

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
  colors: any;
  fonts: any;
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

function SectionLabel({ label, colors }: { label: string; colors: any }) {
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
  colors: any;
  fonts: any;
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
          variant === "ghost" ? { color: colors.textSecondary } : { color: "#fff" },
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
  colors: any;
  fonts: any;
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
  colors: any;
  fonts: any;
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
  colors: any;
  fonts: any;
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
  colors: any;
  fonts: any;
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
  colors: any;
  fonts: any;
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

// ─── Place staging card ───────────────────────────────────────────────────────
// Mirrors BatchReview: same card chrome, header, quick links, commit button,
// then a collapsible country → region → place hierarchy with Switches.

const PSC_MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function pscFmtDay(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  return `${d.getDate()} ${PSC_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
function pscPluralDays(n: number) { return n === 1 ? "1 day" : `${n} days`; }

function pscRegionIds(rg: RegionGroup): string[] {
  return rg.places.filter((pg) => pg.pending.length > 0).map((pg) => pg.place.id);
}
function pscCountryIds(cg: CountryGroup): string[] {
  return cg.regions.flatMap(pscRegionIds);
}

function PlaceStagingCard({
  hub,
  router,
  onConfirm,
  colors,
  fonts,
}: {
  hub: ReturnType<typeof useStagingHub>;
  router: ReturnType<typeof useRouter>;
  onConfirm: (title: string, msg: string, cta: string, fn: () => void) => void;
  colors: any;
  fonts: any;
}) {
  const allPendingIds = useMemo(
    () => new Set(hub.hierarchy.flatMap(pscCountryIds)),
    [hub.hierarchy],
  );

  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  const [collapsedCountries, setCollapsedCountries] = useState<Set<string>>(new Set());
  const [collapsedRegions, setCollapsedRegions] = useState<Set<string>>(new Set());
  // Progress state — while non-null the card shows a slim progress bar instead
  // of the interactive content (same pattern as BatchReview for CSV imports).
  const [commitProg, setCommitProg] = useState<{ done: number; total: number } | null>(null);

  const selectedCount = useMemo(
    () => [...allPendingIds].filter((id) => !deselected.has(id)).length,
    [allPendingIds, deselected],
  );

  const togglePlace = (id: string, next: boolean) =>
    setDeselected((prev) => { const s = new Set(prev); next ? s.delete(id) : s.add(id); return s; });

  const toggleGroup = (ids: string[], next: boolean) =>
    setDeselected((prev) => { const s = new Set(prev); ids.forEach((id) => next ? s.delete(id) : s.add(id)); return s; });

  const handleCommit = async () => {
    const toAccept = [...allPendingIds].filter((id) => !deselected.has(id));
    const toIgnore = [...allPendingIds].filter((id) => deselected.has(id));
    const all = [...toAccept, ...toIgnore];
    if (!all.length) return;
    setCommitProg({ done: 0, total: all.length });
    let done = 0;
    for (const id of toAccept) {
      await hub.acceptPlace(id);
      setCommitProg({ done: ++done, total: all.length });
    }
    for (const id of toIgnore) {
      await hub.dismissPlace(id);
      setCommitProg({ done: ++done, total: all.length });
    }
    setCommitProg(null);
    setDeselected(new Set());
  };

  const handleDiscardAll = () =>
    onConfirm(
      "Ignore all suggestions",
      "All pending place suggestions will be ignored. They can be re-offered by re-scanning.",
      "Ignore all",
      async () => {
        const ids = [...allPendingIds];
        setCommitProg({ done: 0, total: ids.length });
        let done = 0;
        for (const id of ids) {
          await hub.dismissPlace(id);
          setCommitProg({ done: ++done, total: ids.length });
        }
        setCommitProg(null);
      },
    );

  // ── Progress state — replaces card content while committing ─────────────────
  if (commitProg) {
    const pct = commitProg.total > 0 ? commitProg.done / commitProg.total : 0;
    return (
      <View style={[br.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={br.commitTop}>
          <ActivityIndicator size="small" color={colors.accent} />
          <View style={{ flex: 1 }}>
            <Text style={[br.filename, { color: colors.textPrimary, fontFamily: fonts.sans }]}>
              Photo library suggestions
            </Text>
            <Text style={[br.commitCount, { color: colors.textTertiary }]}>
              Saving {commitProg.done} of {commitProg.total} {commitProg.total === 1 ? "place" : "places"}…
            </Text>
          </View>
        </View>
        <View style={[br.track, { backgroundColor: colors.border }]}>
          <View style={[br.fill, { width: `${Math.round(pct * 100)}%`, backgroundColor: colors.accent }]} />
        </View>
      </View>
    );
  }

  return (
    <View style={[br.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {/* Header — matches BatchReview */}
      <View style={[br.header, { borderBottomColor: colors.border }]}>
        <View style={{ flex: 1 }}>
          <Text style={[br.filename, { color: colors.textPrimary, fontFamily: fonts.sans }]}>
            Photo library suggestions
          </Text>
          <Text style={[br.meta, { color: colors.textTertiary }]}>
            {allPendingIds.size} pending · {selectedCount} selected
          </Text>
        </View>
        <Pressable onPress={handleDiscardAll} style={{ padding: 4 }}>
          <Ionicons name="trash-outline" size={18} color={colors.error} />
        </Pressable>
      </View>

      {/* Quick actions — matches BatchReview */}
      <View style={[br.quick, { borderBottomColor: colors.borderFaint }]}>
        <Pressable onPress={() => setDeselected(new Set())}>
          <Text style={[br.quickText, { color: colors.accent }]}>
            Select all ({allPendingIds.size})
          </Text>
        </Pressable>
        <Pressable onPress={() => setDeselected(new Set(allPendingIds))}>
          <Text style={[br.quickText, { color: colors.accent }]}>Deselect all</Text>
        </Pressable>
      </View>

      {/* Commit bar */}
      <View style={br.commitBar}>
        <Pressable
          style={[br.commitBtn, { backgroundColor: colors.accentBold }, !selectedCount && { opacity: 0.4 }]}
          disabled={!selectedCount}
          onPress={handleCommit}
        >
          <Text style={[br.commitBtnText, { fontFamily: fonts.sans }]}>
            Accept {selectedCount} {selectedCount === 1 ? "place" : "places"} to journal
          </Text>
        </Pressable>
      </View>

      {/* Hierarchy */}
      {hub.hierarchy.filter((cg) => cg.pendingCount > 0).map((cg) => {
        const cIds = pscCountryIds(cg);
        const countryOn = cIds.some((id) => !deselected.has(id));
        const cExpanded = !collapsedCountries.has(cg.country);
        return (
          <View key={cg.country}>
            {/* Country row */}
            <Pressable
              style={[pscS.countryRow, { borderTopColor: colors.borderFaint }]}
              onPress={() =>
                setCollapsedCountries((prev) => {
                  const s = new Set(prev);
                  s.has(cg.country) ? s.delete(cg.country) : s.add(cg.country);
                  return s;
                })
              }
            >
              <Ionicons
                name={cExpanded ? "chevron-down" : "chevron-forward"}
                size={13}
                color={colors.textMuted}
                style={{ marginRight: 5 }}
              />
              <Text style={[pscS.countryName, { color: colors.textBright, fontFamily: fonts.serifSemiBold }]}>
                {cg.country}
              </Text>
              <Text style={[pscS.badge, { color: colors.textMuted }]}>{cg.pendingCount}</Text>
              <Pressable onPress={(e) => e.stopPropagation()} style={{ marginLeft: "auto" }}>
                <Switch
                  value={countryOn}
                  onValueChange={(next) => toggleGroup(cIds, next)}
                  trackColor={{ true: colors.accent, false: colors.border }}
                  thumbColor={countryOn ? colors.surface : colors.textMuted}
                  style={pscS.sw}
                />
              </Pressable>
            </Pressable>

            {cExpanded &&
              cg.regions.filter((rg) => rg.pendingCount > 0).map((rg) => {
                const rIds = pscRegionIds(rg);
                const regionOn = rIds.some((id) => !deselected.has(id));
                const rKey = `${cg.country}:${rg.region}`;
                const rExpanded = !collapsedRegions.has(rKey);
                return (
                  <View key={rg.region}>
                    {/* Region row */}
                    <Pressable
                      style={[pscS.regionRow, { backgroundColor: colors.surfaceMuted, borderTopColor: colors.borderFaint }]}
                      onPress={() =>
                        setCollapsedRegions((prev) => {
                          const s = new Set(prev);
                          s.has(rKey) ? s.delete(rKey) : s.add(rKey);
                          return s;
                        })
                      }
                    >
                      <Ionicons
                        name={rExpanded ? "chevron-down" : "chevron-forward"}
                        size={12}
                        color={colors.textMuted}
                        style={{ marginRight: 5 }}
                      />
                      <Text style={[pscS.regionName, { color: colors.textSecondary, fontFamily: fonts.sansMedium ?? fonts.sans }]}>
                        {rg.region}
                      </Text>
                      <View style={[pscS.regionCountBadge, { backgroundColor: colors.surfaceAccent }]}>
                        <Text style={[pscS.regionCountText, { color: colors.accent }]}>
                          {rg.pendingCount}
                        </Text>
                      </View>
                      <Pressable onPress={(e) => e.stopPropagation()} style={{ marginLeft: "auto" }}>
                        <Switch
                          value={regionOn}
                          onValueChange={(next) => toggleGroup(rIds, next)}
                          trackColor={{ true: colors.accent, false: colors.border }}
                          thumbColor={regionOn ? colors.surface : colors.textMuted}
                          style={pscS.sw}
                        />
                      </Pressable>
                    </Pressable>

                    {rExpanded &&
                      rg.places.filter((pg) => pg.pending.length > 0).map((pg) => {
                        const isOn = !deselected.has(pg.place.id);
                        const days = pg.pending.map((e) => e.localDay).sort();
                        const dateLabel =
                          days.length === 1
                            ? pscFmtDay(days[0])
                            : `${pscFmtDay(days[0])} – ${pscFmtDay(days[days.length - 1])}`;
                        return (
                          <View
                            key={pg.place.id}
                            style={[pscS.placeRow, { borderTopColor: colors.borderFaint }]}
                          >
                            <Pressable
                              style={{ flex: 1, paddingRight: spacing.sm }}
                              onPress={() =>
                                pg.pending.length > 1 &&
                                router.push(`/staging/place/${pg.place.id}` as any)
                              }
                            >
                              <Text style={[pscS.placeName, { color: colors.textPrimary, fontFamily: fonts.serifSemiBold }]}>
                                {pg.place.locality}
                              </Text>
                              <Text style={[pscS.placeMeta, { color: colors.textMuted }]}>
                                {pscPluralDays(pg.pending.length)} · {dateLabel}
                              </Text>
                              {pg.pending.length > 1 && (
                                <Text style={{ fontSize: 11, color: colors.accent, marginTop: 1 }}>
                                  Tap for per-day review
                                </Text>
                              )}
                            </Pressable>
                            <Switch
                              value={isOn}
                              onValueChange={(next) => togglePlace(pg.place.id, next)}
                              trackColor={{ true: colors.accent, false: colors.border }}
                              thumbColor={isOn ? colors.surface : colors.textMuted}
                              style={pscS.sw}
                            />
                          </View>
                        );
                      })}
                  </View>
                );
              })}
          </View>
        );
      })}
    </View>
  );
}

const pscS = StyleSheet.create({
  countryRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  countryName: { fontSize: 14, fontWeight: "600", marginRight: 6 },
  badge: { fontSize: 12 },
  regionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  regionName: { fontSize: 13, marginRight: 6 },
  regionCountBadge: { borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1 },
  regionCountText: { fontSize: 11, fontWeight: "700" },
  placeRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 28,
    paddingRight: 10,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  placeName: { fontSize: 14, fontWeight: "500", marginBottom: 2 },
  placeMeta: { fontSize: 12 },
  sw: { transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] },
});

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
