/**
 * Import screen — pick a file, parse it through the shared connector pipeline,
 * review staged records, then commit selected entries to the SQLite journal.
 *
 * Two entry paths:
 *   A) User taps the upload icon in the Chronicle header → document picker
 *   B) App opens via a share intent / ACTION_VIEW → URI arrives as ?uri= param
 *      (requires development build; Expo Go only supports path A)
 *
 * The shared stageFile() / commitBatch() functions from src/lib/journal/staging.ts
 * are used unchanged — they already handle connector auto-detection, dedup,
 * tier precedence, and geo station loading.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
  ScrollView,
} from "react-native";
import { useDialog, Dialog } from "../src/components/Dialog";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { Ionicons } from "@expo/vector-icons";
import { useJournal, removeMany, type CommitProgress } from "@chronicle/journal/db";
import { stageFile, saveBatch, commitBatch } from "@chronicle/journal/staging";
import { entryTitle, view, type StagingBatch, type StagedRecord, type StageStatus } from "@chronicle/journal/types";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme, type ThemeColors, type ThemeFonts, text as textScale, spacing as spacingScale, radius as radiusScale } from "../src/components/ThemeProvider";
import { KindIcon } from "../src/components/KindIcon";
import { Linking, TextInput } from "react-native";
import { readDeviceCalendar } from "../src/lib/deviceCalendar";
import { fetchGoodreadsShelfCsv, parseGoodreadsUserId } from "@chronicle/journal/connectors/goodreads/rss";
import { getGoodreadsUserId, setGoodreadsUserId } from "../src/lib/goodreadsPrefs";

// ── helpers ──────────────────────────────────────────────────────────────────

type Phase = "idle" | "parsing" | "review";

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
  if (e.kind === "event") return (e as Extract<typeof e, { kind: "event" }>).category;
  return undefined;
}

function isSelectable(status: StageStatus): boolean {
  return status === "new" || status === "supersedes";
}

// ── styles factory ────────────────────────────────────────────────────────────

function createStyles(colors: ThemeColors, fonts: ThemeFonts) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    content: { flexGrow: 1, padding: spacingScale.base, paddingBottom: spacingScale["2xl"] },

    // Modal chrome
    dragHandle: {
      width: 36,
      height: 4,
      backgroundColor: colors.border,
      borderRadius: 2,
      alignSelf: "center",
      marginBottom: spacingScale.lg,
    },
    modalHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: spacingScale.xl,
    },
    modalTitle: {
      fontSize: 22,
      fontFamily: fonts.serifSemiBold,
      fontWeight: "600",
      color: colors.textBright,
    },
    closeBtn: {
      width: 32,
      height: 32,
      backgroundColor: colors.surface,
      borderRadius: radiusScale.full,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: colors.border,
    },

    pickBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
      backgroundColor: colors.surface,
      borderRadius: radiusScale.xl,
      borderWidth: 1,
      borderColor: colors.accent,
      borderStyle: "dashed",
      paddingVertical: 20,
      marginBottom: spacingScale.sm,
    },
    pickBtnDisabled: { opacity: 0.5 },
    pickBtnText: { ...textScale.lg, color: colors.accentSoft, fontWeight: "600" },
    hint: { ...textScale.sm, color: colors.textMuted, textAlign: "center", marginBottom: spacingScale.xl },

    parsing: { flexDirection: "row", alignItems: "center", gap: spacingScale.md, padding: spacingScale.base },
    parsingText: { ...textScale.md, color: colors.textSecondary },

    errorBox: {
      backgroundColor: colors.errorBg,
      borderRadius: radiusScale.md,
      padding: spacingScale.md,
      marginBottom: spacingScale.base,
    },
    errorBoxText: { ...textScale.smMd, color: colors.errorLight },

    empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: spacingScale["2xl"], gap: spacingScale.md },
    emptyTitle: {
      fontSize: 20,
      fontFamily: fonts.serifSemiBold,
      fontWeight: "600",
      color: colors.textPrimary,
      marginBottom: spacingScale.sm2,
    },
    emptyHint: { ...textScale.smMd, color: colors.textTertiary, textAlign: "center" },

    // Batch review
    batchContainer: {
      backgroundColor: colors.surface,
      borderRadius: radiusScale.xl,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: spacingScale.lg,
      overflow: "hidden",
    },
    batchHeader: {
      flexDirection: "row",
      alignItems: "center",
      padding: spacingScale.md2,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      gap: spacingScale.md,
    },
    batchHeaderText: { flex: 1 },
    batchFilename: { ...textScale.base, color: colors.textPrimary, fontWeight: "600", marginBottom: 2 },
    batchMeta: { ...textScale.sm, color: colors.textTertiary },
    discardBtn: { padding: 4 },

    errorsBox: {
      backgroundColor: colors.errorBg,
      padding: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    errorText: { ...textScale.sm, color: colors.errorLight, marginBottom: 2 },

    quickActions: {
      flexDirection: "row",
      gap: spacingScale.base,
      padding: 10,
      paddingHorizontal: spacingScale.md2,
      borderBottomWidth: 1,
      borderBottomColor: colors.borderFaint,
    },
    quickActionText: { ...textScale.sm, color: colors.accent, fontWeight: "600" },

    recordList: {},
    loadMoreBtn: {
      padding: spacingScale.md2,
      alignItems: "center",
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    loadMoreText: { ...textScale.smMd, color: colors.accent, fontWeight: "600" },
    recordRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: spacingScale.md2,
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      gap: 10,
    },
    recordRowDim: { opacity: 0.45 },
    recordSwitch: { transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] },
    recordIconWrap: { width: 22, alignItems: "center" },
    recordBody: { flex: 1 },
    recordTitle: { ...textScale.md, color: colors.textPrimary, fontWeight: "500", marginBottom: 2 },
    recordMeta: { flexDirection: "row", gap: spacingScale.sm, flexWrap: "wrap" },
    recordStatus: { fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
    recordWarning: { fontSize: 11, color: colors.star, flex: 1 },

    commitBar: { padding: spacingScale.md2, paddingTop: spacingScale.md },
    commitBtn: {
      backgroundColor: colors.accentBold,
      borderRadius: radiusScale.lg,
      paddingVertical: 14,
      alignItems: "center",
    },
    commitBtnDisabled: { opacity: 0.4 },
    commitBtnText: { ...textScale.base, color: colors.white, fontWeight: "700" },

    commitProgressCard: {
      backgroundColor: colors.surface,
      borderRadius: radiusScale.xl,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacingScale.md2,
      marginBottom: spacingScale.lg,
      gap: 10,
    },
    commitProgressTop: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacingScale.md,
    },
    commitProgressText: { flex: 1 },
    commitProgressCount: { ...textScale.sm, color: colors.textTertiary, marginTop: 2 },
    progressTrack: {
      height: 4,
      backgroundColor: colors.border,
      borderRadius: 2,
      overflow: "hidden",
    },
    progressFill: {
      height: "100%",
      backgroundColor: colors.accent,
      borderRadius: 2,
    },
  });
}

type Styles = ReturnType<typeof createStyles>;

// ── sub-components ────────────────────────────────────────────────────────────

function RecordRow({
  record,
  onToggle,
  styles,
  colors,
}: {
  record: StagedRecord;
  onToggle: (selected: boolean) => void;
  styles: Styles;
  colors: ThemeColors;
}) {
  const v = view(record.entry);
  const selectable = isSelectable(record.status);
  return (
    <View style={[styles.recordRow, !selectable && styles.recordRowDim]}>
      <Switch
        value={record.selected}
        onValueChange={onToggle}
        disabled={!selectable}
        trackColor={{ true: colors.accent, false: colors.border }}
        thumbColor={record.selected ? colors.accentSubtle : colors.textMuted}
        style={styles.recordSwitch}
      />
      <View style={styles.recordIconWrap}>
        <KindIcon
          kind={record.entry.kind}
          subkind={entrySubkind(record.entry)}
          size={16}
          color={colors.textSecondary}
          accessibilityLabel=""
        />
      </View>
      <View style={styles.recordBody}>
        <Text style={styles.recordTitle} numberOfLines={1}>
          {entryTitle(v)}
        </Text>
        <View style={styles.recordMeta}>
          <Text style={[styles.recordStatus, { color: STATUS_COLOR[record.status] }]}>
            {STATUS_LABEL[record.status]}
          </Text>
          {record.warnings.length > 0 && (
            <Text style={styles.recordWarning} numberOfLines={1}>
              {"⚠"} {record.warnings[0]}
            </Text>
          )}
        </View>
      </View>
    </View>
  );
}

// How many rows to render initially; user can expand to see all.
const INITIAL_VISIBLE = 100;

function BatchReview({
  batch,
  commitProgress,
  onCommit,
  onDiscard,
  onError,
  styles,
  colors,
}: {
  batch: StagingBatch;
  commitProgress: CommitProgress | null;
  onCommit: (count: number) => void;
  onDiscard: () => void;
  onError: (title: string, message: string) => void;
  styles: Styles;
  colors: ThemeColors;
}) {
  const [b, setB] = useState(batch);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);

  const committing = commitProgress?.batchId === batch.id;
  const progressPct = committing && commitProgress!.total > 0
    ? commitProgress!.done / commitProgress!.total
    : 0;

  const selected = b.records.filter((r) => r.selected).length;
  const importable = b.records.filter((r) => isSelectable(r.status)).length;
  const visibleRecords = b.records.slice(0, visibleCount);
  const hiddenCount = b.records.length - visibleCount;

  const update = useCallback(
    (next: StagingBatch) => {
      setB(next);
      void saveBatch(next);
    },
    []
  );

  const toggleRecord = (idx: number, selected: boolean) => {
    const records = b.records.map((r, i) => (i === idx ? { ...r, selected } : r));
    update({ ...b, records });
  };

  const selectImportable = () =>
    update({
      ...b,
      records: b.records.map((r) => ({
        ...r,
        selected: isSelectable(r.status),
      })),
    });

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

  // While committing, collapse the full card to a slim progress indicator
  if (committing) {
    return (
      <View style={styles.commitProgressCard}>
        <View style={styles.commitProgressTop}>
          <ActivityIndicator size="small" color={colors.accent} />
          <View style={styles.commitProgressText}>
            <Text style={styles.batchFilename} numberOfLines={1}>{b.filename}</Text>
            <Text style={styles.commitProgressCount}>
              Saving {commitProgress!.done} of {commitProgress!.total} entries…
            </Text>
          </View>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.round(progressPct * 100)}%` }]} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.batchContainer}>
      {/* Header */}
      <View style={styles.batchHeader}>
        <View style={styles.batchHeaderText}>
          <Text style={styles.batchFilename} numberOfLines={1}>
            {b.filename}
          </Text>
          <Text style={styles.batchMeta}>
            {b.records.length} parsed · {b.errors.length} errors · {selected} selected
          </Text>
        </View>
        <Pressable onPress={onDiscard} style={styles.discardBtn}>
          <Ionicons name="trash-outline" size={18} color={colors.error} />
        </Pressable>
      </View>

      {/* Errors */}
      {b.errors.length > 0 && (
        <View style={styles.errorsBox}>
          {b.errors.slice(0, 3).map((e, i) => (
            <Text key={i} style={styles.errorText} numberOfLines={2}>
              {e}
            </Text>
          ))}
          {b.errors.length > 3 && (
            <Text style={styles.errorText}>…and {b.errors.length - 3} more</Text>
          )}
        </View>
      )}

      {/* Quick actions + commit — pinned above the record list so the
          primary action is always reachable without scrolling */}
      <View style={styles.quickActions}>
        <Pressable onPress={selectImportable}>
          <Text style={styles.quickActionText}>Select importable ({importable})</Text>
        </Pressable>
        <Pressable onPress={deselectAll}>
          <Text style={styles.quickActionText}>Deselect all</Text>
        </Pressable>
      </View>

      <View style={styles.commitBar}>
        <Pressable
          style={[styles.commitBtn, !selected && styles.commitBtnDisabled]}
          disabled={!selected}
          onPress={handleCommit}
        >
          <Text style={styles.commitBtnText}>
            Commit {selected} {selected === 1 ? "entry" : "entries"} to journal
          </Text>
        </Pressable>
      </View>

      {/* Record list — capped at INITIAL_VISIBLE to avoid rendering thousands
          of rows at once (FlatList can't virtualise when scrollEnabled=false). */}
      <FlatList
        data={visibleRecords}
        keyExtractor={(r) => r.entry.id}
        renderItem={({ item, index }) => (
          <RecordRow
            record={item}
            onToggle={(v) => toggleRecord(index, v)}
            styles={styles}
            colors={colors}
          />
        )}
        style={styles.recordList}
        scrollEnabled={false}
        ListFooterComponent={
          hiddenCount > 0 ? (
            <Pressable
              style={styles.loadMoreBtn}
              onPress={() => setVisibleCount((n) => n + INITIAL_VISIBLE)}
            >
              <Text style={styles.loadMoreText}>
                Show next {Math.min(INITIAL_VISIBLE, hiddenCount)} of {hiddenCount} remaining
              </Text>
            </Pressable>
          ) : null
        }
      />
    </View>
  );
}

// ── screen ───────────────────────────────────────────────────────────────────

export default function ImportScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ uri?: string }>();
  const journal = useJournal();
  const { top } = useSafeAreaInsets();
  const { colors, fonts, spacing } = useTheme();
  const styles = useMemo(() => createStyles(colors, fonts), [colors, fonts]);

  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const dialog = useDialog();
  const [freshBatch, setFreshBatch] = useState<StagingBatch | null>(null);

  // Handle incoming URI from share intent / ACTION_VIEW
  useEffect(() => {
    if (params.uri) {
      void processUri(params.uri, params.uri.split("/").pop() ?? "shared-file");
    }
  }, [params.uri]);

  const processUri = async (uri: string, filename: string) => {
    setPhase("parsing");
    setError(null);
    // Yield to the JS event loop so the "parsing…" spinner renders before
    // the heavy stageFile work begins. Without this, React batches the state
    // update and the UI stays frozen on "idle" until everything finishes.
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    try {
      // fetch() handles file:// and content:// URIs in React Native,
      // including Expo Go's sandboxed DocumentPicker paths.
      const response = await fetch(uri);
      if (!response.ok) throw new Error(`Could not read file (HTTP ${response.status})`);
      const text = await response.text();
      // Yield again after the file read so the thread isn't starved before
      // the connector parse + dedup pass (can be several seconds for large files).
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const batch = await stageFile(filename, text);
      setFreshBatch(batch);
      setPhase("review");
    } catch (err) {
      setError(String(err));
      setPhase("idle");
    }
  };

  const importFromCalendar = async () => {
    setPhase("parsing");
    setError(null);
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    try {
      const res = await readDeviceCalendar();
      if (res.status === "unavailable") {
        setPhase("idle");
        dialog.alert("Calendar unavailable", "This device doesn't expose a calendar.");
        return;
      }
      if (res.status === "denied") {
        setPhase("idle");
        if (!res.canAskAgain) {
          dialog.confirm(
            "Calendar access needed",
            "Allow calendar access in Settings to import events. Nothing leaves your phone.",
            () => void Linking.openSettings(),
          );
        } else {
          dialog.alert("Calendar access needed", "Chronicle needs permission to read your calendar.");
        }
        return;
      }
      if (!res.count) {
        setPhase("idle");
        dialog.alert("No events found", "No one-off events in the past year or next 30 days.");
        return;
      }
      const batch = await stageFile("device-calendar.ics", res.ics, "icalendar");
      setFreshBatch(batch);
      setPhase("review");
    } catch (err) {
      setError(String(err));
      setPhase("idle");
    }
  };

  const pickFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          "text/csv",
          "text/calendar",
          "text/x-vcard",
          "application/json",
          "application/octet-stream",
          "*/*",
        ],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets[0]) return;
      const { uri, name } = result.assets[0];
      await processUri(uri, name ?? "imported-file");
    } catch (err) {
      setError(String(err));
    }
  };

  const handleCommit = (count: number) => {
    setFreshBatch(null);
    setPhase("idle");
    dialog.alert(
      "Import complete",
      `${count} ${count === 1 ? "entry" : "entries"} added to your journal.`,
      () => router.canDismiss() ? router.dismiss() : router.replace("/(tabs)")
    );
  };

  const handleDiscard = async (batchId: string) => {
    await removeMany("staging", [batchId]);
    if (freshBatch?.id === batchId) {
      setFreshBatch(null);
      setPhase("idle");
    }
  };

  // Combine pending batches from journal store with the freshly-parsed one.
  // The fresh one goes first; avoid showing it twice if it's already saved.
  const pendingBatches: StagingBatch[] = [
    ...(freshBatch ? [freshBatch] : []),
    ...journal.staging.filter((b) => b.id !== freshBatch?.id),
  ];

  return (
    <>
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: top + spacing.md }]}
    >
      {/* Modal chrome — drag handle + title */}
      <View style={styles.dragHandle} />
      <View style={styles.modalHeader}>
        <Text style={styles.modalTitle}>Import</Text>
        <Pressable
          onPress={() => router.canDismiss() ? router.dismiss() : router.replace("/(tabs)")}
          hitSlop={8}
          style={styles.closeBtn}
        >
          <Ionicons name="close" size={18} color={colors.textSecondary} />
        </Pressable>
      </View>

      {/* Device calendar */}
      <Pressable
        style={[styles.pickBtn, { marginBottom: spacing.sm }, phase === "parsing" && styles.pickBtnDisabled]}
        onPress={importFromCalendar}
        disabled={phase === "parsing"}
      >
        <Ionicons name="calendar-outline" size={22} color={colors.accentSoft} />
        <Text style={styles.pickBtnText}>Import from phone calendar</Text>
      </Pressable>

      {/* Pick file button */}
      <Pressable
        style={[styles.pickBtn, phase === "parsing" && styles.pickBtnDisabled]}
        onPress={pickFile}
        disabled={phase === "parsing"}
      >
        <Ionicons name="cloud-upload-outline" size={22} color={colors.accentSoft} />
        <Text style={styles.pickBtnText}>Choose a file to import</Text>
      </Pressable>

      <Text style={styles.hint}>
        Supports .csv (Letterboxd, Netflix, Goodreads, Viaduct, Setlist.fm), .ics
        (iCalendar), and .vcf (contacts)
      </Text>

      {/* Parsing indicator */}
      {phase === "parsing" && (
        <View style={styles.parsing}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.parsingText}>Parsing file… this may take a moment for large imports</Text>
        </View>
      )}

      {/* Error */}
      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorBoxText}>{error}</Text>
        </View>
      )}

      {/* Batch reviews */}
      {pendingBatches.map((batch) => (
        <BatchReview
          key={batch.id}
          batch={batch}
          commitProgress={journal.commitProgress}
          onCommit={handleCommit}
          onDiscard={() => handleDiscard(batch.id)}
          onError={dialog.alert}
          styles={styles}
          colors={colors}
        />
      ))}

      {/* Empty pending state */}
      {phase === "idle" && !pendingBatches.length && !error && (
        <View style={styles.empty}>
          <KindIcon kind="book" size={40} color={colors.textTertiary} accessibilityLabel="" />
          <Text style={styles.emptyTitle}>No pending imports</Text>
          <Text style={styles.emptyHint}>
            Pick a file above, or share one directly to Chronicle from your file
            manager (requires a development build).
          </Text>
        </View>
      )}
    </ScrollView>
    <Dialog {...dialog.props} onDismiss={dialog.dismiss} />
    </>
  );
}
