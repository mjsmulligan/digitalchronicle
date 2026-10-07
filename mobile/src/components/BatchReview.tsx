/**
 * BatchReview — staged import card.
 *
 * Shows a list of parsed StagedRecords with a Switch per row. The user
 * selects which entries to keep, then commits them to the journal.
 * While committing, the card collapses to a slim animated progress bar.
 */
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { saveBatch, commitBatch } from "@chronicle/journal/staging";
import {
  entryTitle,
  view,
  type StagingBatch,
  type StagedRecord,
  type StageStatus,
} from "@chronicle/journal/types";
import type { CommitProgress } from "@chronicle/journal/db";
import { type ThemeColors, type ThemeFonts, spacing, radius } from "./ThemeProvider";
import { KindIcon } from "./KindIcon";
import { br } from "./reviewCard.styles";

// ── helpers ───────────────────────────────────────────────────────────────────

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

export function isSelectable(status: StageStatus): boolean {
  return status === "new" || status === "supersedes";
}

const INITIAL_VISIBLE = 100;

// ── RecordRow ─────────────────────────────────────────────────────────────────

function RecordRow({
  record,
  onToggle,
  colors,
  fonts,
}: {
  record: StagedRecord;
  onToggle: (selected: boolean) => void;
  colors: ThemeColors;
  fonts: ThemeFonts;
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
      <Switch
        value={record.selected}
        onValueChange={onToggle}
        disabled={!selectable}
        trackColor={{ true: colors.accent, false: colors.border }}
        thumbColor={record.selected ? colors.accentSubtle : colors.textMuted}
        style={rr.sw}
      />
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

// ── BatchReview ───────────────────────────────────────────────────────────────

export interface BatchReviewProps {
  batch: StagingBatch;
  commitProgress: CommitProgress | null;
  onCommit: (count: number) => void;
  onDiscard: () => void;
  onError: (title: string, message: string) => void;
  colors: ThemeColors;
  fonts: ThemeFonts;
}

export function BatchReview({
  batch,
  commitProgress,
  onCommit,
  onDiscard,
  onError,
  colors,
  fonts,
}: BatchReviewProps) {
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

  const toggleRecord = useCallback((idx: number, sel: boolean) => {
    update({ ...b, records: b.records.map((r, i) => (i === idx ? { ...r, selected: sel } : r)) });
  }, [b, update]);

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
          <Text style={[br.commitBtnText, { fontFamily: fonts.sans, color: colors.white }]}>
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
