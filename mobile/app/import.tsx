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
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
  ScrollView,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { Ionicons } from "@expo/vector-icons";
import { useJournal, removeMany } from "@chronicle/journal/db";
import { stageFile, saveBatch, commitBatch } from "@chronicle/journal/staging";
import { entryTitle, view, type StagingBatch, type StagedRecord, type StageStatus } from "@chronicle/journal/types";

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

function entryEmoji(e: StagedRecord["entry"]): string {
  if (e.kind === "leg") return e.mode === "air" ? "✈️" : e.mode === "rail" ? "🚂" : "🚗";
  if (e.kind === "stay") return "🏨";
  if (e.kind === "film") return "🎬";
  if (e.kind === "episode") return "📺";
  if (e.kind === "book") return "📖";
  const cat = (e as Extract<typeof e, { kind: "event" }>).category;
  return cat === "concert" ? "🎵" : cat === "celebration" ? "🎉" : "📍";
}

function isSelectable(status: StageStatus): boolean {
  return status === "new" || status === "supersedes";
}

// ── sub-components ────────────────────────────────────────────────────────────

function RecordRow({
  record,
  onToggle,
}: {
  record: StagedRecord;
  onToggle: (selected: boolean) => void;
}) {
  const v = view(record.entry);
  const selectable = isSelectable(record.status);
  return (
    <View style={[styles.recordRow, !selectable && styles.recordRowDim]}>
      <Switch
        value={record.selected}
        onValueChange={onToggle}
        disabled={!selectable}
        trackColor={{ true: "#6366f1", false: "#334155" }}
        thumbColor={record.selected ? "#e0e7ff" : "#94a3b8"}
        style={styles.recordSwitch}
      />
      <Text style={styles.recordEmoji}>{entryEmoji(record.entry)}</Text>
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
              ⚠ {record.warnings[0]}
            </Text>
          )}
        </View>
      </View>
    </View>
  );
}

function BatchReview({
  batch,
  onCommit,
  onDiscard,
}: {
  batch: StagingBatch;
  onCommit: (count: number) => void;
  onDiscard: () => void;
}) {
  const [b, setB] = useState(batch);
  const [committing, setCommitting] = useState(false);

  const selected = b.records.filter((r) => r.selected).length;
  const importable = b.records.filter((r) => isSelectable(r.status)).length;

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
    setCommitting(true);
    try {
      const result = await commitBatch(b);
      onCommit(result.count);
    } catch (err) {
      Alert.alert("Commit failed", String(err));
      setCommitting(false);
    }
  };

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
          <Ionicons name="trash-outline" size={18} color="#ef4444" />
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

      {/* Quick actions */}
      <View style={styles.quickActions}>
        <Pressable onPress={selectImportable}>
          <Text style={styles.quickActionText}>Select importable ({importable})</Text>
        </Pressable>
        <Pressable onPress={deselectAll}>
          <Text style={styles.quickActionText}>Deselect all</Text>
        </Pressable>
      </View>

      {/* Record list */}
      <FlatList
        data={b.records}
        keyExtractor={(r) => r.entry.id}
        renderItem={({ item, index }) => (
          <RecordRow
            record={item}
            onToggle={(v) => toggleRecord(index, v)}
          />
        )}
        style={styles.recordList}
        scrollEnabled={false}
      />

      {/* Commit button */}
      <View style={styles.commitBar}>
        <Pressable
          style={[styles.commitBtn, (!selected || committing) && styles.commitBtnDisabled]}
          disabled={!selected || committing}
          onPress={handleCommit}
        >
          {committing ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.commitBtnText}>
              Commit {selected} {selected === 1 ? "entry" : "entries"} to journal
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

// ── screen ───────────────────────────────────────────────────────────────────

export default function ImportScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ uri?: string }>();
  const journal = useJournal();

  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
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
    try {
      // fetch() handles file:// and content:// URIs in React Native,
      // including Expo Go's sandboxed DocumentPicker paths.
      const response = await fetch(uri);
      if (!response.ok) throw new Error(`Could not read file (HTTP ${response.status})`);
      const text = await response.text();
      const batch = await stageFile(filename, text);
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
    Alert.alert(
      "Import complete",
      `${count} ${count === 1 ? "entry" : "entries"} added to your journal.`,
      [{ text: "OK", onPress: () => router.back() }]
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
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Stack.Screen
        options={{
          title: "Import",
          headerStyle: { backgroundColor: "#1e293b" },
          headerTintColor: "#f8fafc",
          headerShadowVisible: false,
        }}
      />

      {/* Pick file button */}
      <Pressable
        style={[styles.pickBtn, phase === "parsing" && styles.pickBtnDisabled]}
        onPress={pickFile}
        disabled={phase === "parsing"}
      >
        <Ionicons name="cloud-upload-outline" size={22} color="#818cf8" />
        <Text style={styles.pickBtnText}>Choose a file to import</Text>
      </Pressable>

      <Text style={styles.hint}>
        Supports .csv (Letterboxd, Netflix, Goodreads, Viaduct, Setlist.fm), .ics
        (iCalendar), and .vcf (contacts)
      </Text>

      {/* Parsing indicator */}
      {phase === "parsing" && (
        <View style={styles.parsing}>
          <ActivityIndicator color="#6366f1" />
          <Text style={styles.parsingText}>Parsing file…</Text>
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
          onCommit={handleCommit}
          onDiscard={() => handleDiscard(batch.id)}
        />
      ))}

      {/* Empty pending state */}
      {phase === "idle" && !pendingBatches.length && !error && (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>📂</Text>
          <Text style={styles.emptyTitle}>No pending imports</Text>
          <Text style={styles.emptyHint}>
            Pick a file above, or share one directly to Chronicle from your file
            manager (requires a development build).
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

// ── styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a" },
  content: { padding: 16, paddingBottom: 40 },

  pickBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "#1e293b",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#6366f1",
    borderStyle: "dashed",
    paddingVertical: 20,
    marginBottom: 8,
  },
  pickBtnDisabled: { opacity: 0.5 },
  pickBtnText: { color: "#818cf8", fontSize: 16, fontWeight: "600" },
  hint: { color: "#475569", fontSize: 12, textAlign: "center", marginBottom: 24, lineHeight: 18 },

  parsing: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16 },
  parsingText: { color: "#94a3b8", fontSize: 14 },

  errorBox: {
    backgroundColor: "#450a0a",
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  errorBoxText: { color: "#fca5a5", fontSize: 13 },

  empty: { alignItems: "center", paddingTop: 40 },
  emptyIcon: { fontSize: 40, marginBottom: 12 },
  emptyTitle: { color: "#f1f5f9", fontSize: 17, fontWeight: "600", marginBottom: 6 },
  emptyHint: { color: "#64748b", fontSize: 13, textAlign: "center", lineHeight: 19 },

  // Batch review
  batchContainer: {
    backgroundColor: "#1e293b",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#334155",
    marginBottom: 20,
    overflow: "hidden",
  },
  batchHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#334155",
    gap: 12,
  },
  batchHeaderText: { flex: 1 },
  batchFilename: { color: "#f1f5f9", fontSize: 15, fontWeight: "600", marginBottom: 2 },
  batchMeta: { color: "#64748b", fontSize: 12 },
  discardBtn: { padding: 4 },

  errorsBox: {
    backgroundColor: "#450a0a",
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#334155",
  },
  errorText: { color: "#fca5a5", fontSize: 12, marginBottom: 2 },

  quickActions: {
    flexDirection: "row",
    gap: 16,
    padding: 10,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#1e293b",
  },
  quickActionText: { color: "#6366f1", fontSize: 12, fontWeight: "600" },

  recordList: {},
  recordRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#334155",
    gap: 10,
  },
  recordRowDim: { opacity: 0.45 },
  recordSwitch: { transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] },
  recordEmoji: { fontSize: 16, width: 22, textAlign: "center" },
  recordBody: { flex: 1 },
  recordTitle: { color: "#f1f5f9", fontSize: 14, fontWeight: "500", marginBottom: 2 },
  recordMeta: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  recordStatus: { fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  recordWarning: { color: "#f59e0b", fontSize: 11, flex: 1 },

  commitBar: { padding: 14, paddingTop: 12 },
  commitBtn: {
    backgroundColor: "#4f46e5",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  commitBtnDisabled: { opacity: 0.4 },
  commitBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
});
