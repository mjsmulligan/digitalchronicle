/**
 * WP14 — Staging Hub: Locality detail.
 *
 * Shows all pending PlaceEntries for one Place, ordered by significance hints:
 *   - Unusual days (high photo count relative to the place's norm) shown first.
 *   - Routine days collapsed below in a "Show N routine days" group.
 *   - Single-photo days are never routine.
 *
 * Each row has a Switch (deferred — no immediate commit) and tapping expands
 * a horizontal photo strip from the entry's photoEvidence refs.
 *
 * Header: "Select all · Deselect all" quick links + "Accept X days" commit btn.
 */

import React, { useState, useMemo } from "react";
import {
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  Modal,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme, spacing, radius } from "../../../src/components/ThemeProvider";
import { useDialog, Dialog } from "../../../src/components/Dialog";
import { useStagingHub } from "../../../src/lib/exif/useStagingHub";
import type { PlaceEntry } from "@chronicle/journal/types";

// ─── Date helpers ─────────────────────────────────────────────────────────────

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const WEEKDAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

function fmtDay(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

// ─── Entry row ────────────────────────────────────────────────────────────────
//
// Controlled row — parent owns selected state (deselected set pattern so new
// entries start ON without needing a useEffect). Tap anywhere on the row body
// to expand/collapse a horizontal photo strip.

function EntryRow({
  entry,
  unusual,
  selected,
  onToggle,
  expanded,
  onExpandToggle,
}: {
  entry: PlaceEntry;
  unusual: boolean;
  selected: boolean;
  onToggle: (next: boolean) => void;
  expanded: boolean;
  onExpandToggle: () => void;
}) {
  const { colors, fonts } = useTheme();
  const s = useMemo(() => rowStyles(colors, fonts), [colors, fonts]);

  const photos = entry.photoEvidence.filter((r) => r.uri && !r.missing);

  return (
    <View style={[s.row, unusual && s.rowUnusual]}>
      {/* Main row: tap body to expand photo strip, Switch on the right */}
      <View style={s.mainRow}>
        <Pressable style={s.body} onPress={onExpandToggle}>
          <View style={s.titleRow}>
            <Text style={s.dateText}>{fmtDay(entry.localDay)}</Text>
            {unusual && (
              <View style={s.unusualBadge}>
                <Text style={s.unusualBadgeText}>Unusual</Text>
              </View>
            )}
          </View>
          <View style={s.metaRow}>
            <Ionicons name="images-outline" size={12} color={colors.textMuted} style={{ marginRight: 3 }} />
            <Text style={s.metaText}>
              {entry.photoCount} photo{entry.photoCount !== 1 ? "s" : ""}
              {entry.singlePhoto ? " · Transit?" : ""}
            </Text>
            {photos.length > 0 && (
              <Ionicons
                name={expanded ? "chevron-up" : "chevron-down"}
                size={11}
                color={colors.textMuted}
                style={{ marginLeft: 4 }}
              />
            )}
          </View>
        </Pressable>

        {/* Prevent Switch tap from toggling the expand */}
        <Pressable onPress={(e) => e.stopPropagation()}>
          <Switch
            value={selected}
            onValueChange={onToggle}
            trackColor={{ true: colors.accent, false: colors.border }}
            thumbColor={selected ? colors.surface : colors.textMuted}
            style={{ transform: [{ scaleX: 0.85 }, { scaleY: 0.85 }] }}
          />
        </Pressable>
      </View>

      {/* Photo strip — shown when expanded and we have URIs */}
      {expanded && photos.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={s.stripScroll}
          contentContainerStyle={s.stripContent}
        >
          {photos.map((ref, i) => (
            <Image
              key={ref.mediaId ?? i}
              source={{ uri: ref.uri }}
              style={s.thumb}
              resizeMode="cover"
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function rowStyles(colors: any, fonts: any) {
  return StyleSheet.create({
    row: {
      marginHorizontal: spacing.lg,
      marginBottom: spacing.xs,
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.borderFaint,
      overflow: "hidden",
    },
    rowUnusual: {
      borderColor: colors.accent,
      borderLeftWidth: 3,
    },
    mainRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      gap: spacing.md,
    },
    body: { flex: 1 },
    titleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginBottom: 2,
    },
    dateText: {
      fontSize: 14,
      fontFamily: fonts.serifSemiBold,
      color: colors.textPrimary,
    },
    unusualBadge: {
      // surfaceAccent = warm cream — passes contrast AA with accent text
      backgroundColor: colors.surfaceAccent,
      borderRadius: 8,
      paddingHorizontal: 6,
      paddingVertical: 2,
    },
    unusualBadgeText: {
      fontSize: 11,
      color: colors.accent,
    },
    metaRow: {
      flexDirection: "row",
      alignItems: "center",
    },
    metaText: {
      fontSize: 12,
      color: colors.textMuted,
    },
    stripScroll: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.borderFaint,
    },
    stripContent: {
      padding: spacing.sm,
      gap: spacing.xs,
    },
    thumb: {
      width: 64,
      height: 64,
      borderRadius: radius.sm,
      backgroundColor: colors.borderFaint,
    },
  });
}

// ─── Merge modal ──────────────────────────────────────────────────────────────

function MergeModal({
  visible,
  onClose,
  survivorName,
  places,
  onMerge,
}: {
  visible: boolean;
  onClose: () => void;
  survivorName: string;
  places: { id: string; locality: string; localityKey: string }[];
  onMerge: (absorbedId: string) => void;
}) {
  const { colors, fonts } = useTheme();
  const [query, setQuery] = useState("");

  const filtered = places.filter((p) =>
    p.locality.toLowerCase().includes(query.toLowerCase()) ||
    p.localityKey.includes(query.toLowerCase()),
  );

  const s = useMemo(() => mergeStyles(colors, fonts), [colors, fonts]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.sheet} onPress={() => {}}>
          <Text style={s.title}>Merge into {survivorName}</Text>
          <Text style={s.subtitle}>
            Choose the place to absorb. Its key becomes an alias so future scans
            in either spelling map here.
          </Text>
          <TextInput
            style={s.input}
            placeholder="Search places…"
            placeholderTextColor={colors.textMuted}
            value={query}
            onChangeText={setQuery}
            autoFocus
          />
          <FlatList
            data={filtered}
            keyExtractor={(p) => p.id}
            style={{ maxHeight: 300 }}
            renderItem={({ item: p }) => (
              <Pressable
                style={({ pressed }) => [s.placeRow, pressed && { opacity: 0.7 }]}
                onPress={() => { onMerge(p.id); onClose(); }}
              >
                <Text style={s.placeName}>{p.locality}</Text>
                <Text style={s.placeKey}>{p.localityKey}</Text>
              </Pressable>
            )}
            ListEmptyComponent={<Text style={s.emptyText}>No matching places</Text>}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function mergeStyles(colors: any, fonts: any) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.5)",
      justifyContent: "flex-end",
    },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: radius["2xl"],
      borderTopRightRadius: radius["2xl"],
      padding: spacing.xl,
      paddingBottom: spacing["3xl"],
    },
    title: {
      fontFamily: fonts.serifSemiBold,
      fontSize: 17,
      color: colors.textBright,
      marginBottom: spacing.xs,
    },
    subtitle: {
      fontSize: 13,
      color: colors.textMuted,
      lineHeight: 19,
      marginBottom: spacing.md,
    },
    input: {
      backgroundColor: colors.surfaceMuted,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      fontSize: 14,
      color: colors.textPrimary,
      marginBottom: spacing.sm,
    },
    placeRow: {
      paddingVertical: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderFaint,
    },
    placeName: {
      fontSize: 15,
      fontFamily: fonts.serifSemiBold,
      color: colors.textPrimary,
    },
    placeKey: {
      fontSize: 11,
      color: colors.textMuted,
      marginTop: 2,
    },
    emptyText: {
      padding: spacing.md,
      color: colors.textMuted,
      textAlign: "center",
    },
  });
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function PlaceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors, fonts } = useTheme();
  const s = useMemo(() => screenStyles(colors, fonts), [colors, fonts]);
  const dialog = useDialog();
  const hub = useStagingHub();

  const [showRoutine, setShowRoutine] = useState(false);
  const [showMerge, setShowMerge] = useState(false);

  // Deferred selection: starts empty = all ON. Add id to deselect.
  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  // Expanded rows for photo strips
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const place = hub.places.find((p) => p.id === id);

  const placeGroup = useMemo(() => {
    return hub.hierarchy
      .flatMap((cg) => cg.regions)
      .flatMap((rg) => rg.places)
      .find((pg) => pg.place.id === id);
  }, [hub.hierarchy, id]);

  if (!place || !placeGroup) {
    return (
      <View style={s.empty}>
        <Stack.Screen options={{ headerShown: true, headerTitle: "Place" }} />
        <Text style={s.emptyText}>Place not found</Text>
      </View>
    );
  }

  const { unusual, routine } = placeGroup;
  const pending = placeGroup.pending;

  const allPendingIds = useMemo(
    () => new Set(pending.map((e) => e.id)),
    [pending],
  );

  const selectedCount = pending.filter((e) => !deselected.has(e.id)).length;

  const toggleEntry = (entryId: string, next: boolean) => {
    setDeselected((prev) => {
      const s = new Set(prev);
      if (next) s.delete(entryId);
      else      s.add(entryId);
      return s;
    });
  };

  const toggleExpand = (entryId: string) => {
    setExpandedIds((prev) => {
      const s = new Set(prev);
      if (s.has(entryId)) s.delete(entryId);
      else                 s.add(entryId);
      return s;
    });
  };

  const handleSelectAll   = () => setDeselected(new Set());
  const handleDeselectAll = () => setDeselected(new Set(allPendingIds));

  const handleCommit = () => {
    const toAccept  = pending.filter((e) => !deselected.has(e.id));
    const toDismiss = pending.filter((e) =>  deselected.has(e.id));
    // Single putMany for all decisions — avoids concurrent DB writes
    hub.batchCommitEntries(toAccept, toDismiss).then(() => router.back());
  };

  // Merge candidates: all OTHER places
  const mergeCandidates = hub.places
    .filter((p) => p.id !== id)
    .map((p) => ({ id: p.id, locality: p.locality, localityKey: p.localityKey }));

  const headerSubtitle = [place.region, place.country].filter(Boolean).join(", ");

  const listData = [
    ...unusual.map((e) => ({ entry: e, type: "unusual" as const })),
    ...(routine.length > 0
      ? [{ entry: null as null, type: "routine-toggle" as const }]
      : []),
    ...(showRoutine
      ? routine.map((e) => ({ entry: e, type: "routine" as const }))
      : []),
  ];

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: place.locality,
          headerStyle: { backgroundColor: colors.surface },
          headerTitleStyle: { fontFamily: fonts.serifSemiBold, color: colors.textBright },
          headerTintColor: colors.accent,
          headerRight: () => (
            <Pressable onPress={() => setShowMerge(true)} style={{ marginRight: spacing.sm }}>
              <Ionicons name="git-merge-outline" size={22} color={colors.accent} />
            </Pressable>
          ),
        }}
      />

      <FlatList
        style={{ flex: 1, backgroundColor: colors.bg }}
        contentContainerStyle={{ paddingTop: spacing.md, paddingBottom: spacing["3xl"] }}
        ListHeaderComponent={
          <View>
            {/* Place header */}
            <View style={s.header}>
              <Text style={s.subtitle}>{headerSubtitle}</Text>
              <Text style={s.metaLine}>
                {pending.length} pending · {placeGroup.accepted.length} accepted
              </Text>
              {place.aliasKeys && place.aliasKeys.length > 0 && (
                <Text style={s.aliasLine}>
                  Also known as: {place.aliasKeys.join(", ")}
                </Text>
              )}

              {/* Quick links — Select all · Deselect all */}
              <View style={s.quickRow}>
                <Pressable onPress={handleSelectAll}>
                  <Text style={s.quickLink}>Select all</Text>
                </Pressable>
                <Text style={s.quickSep}>·</Text>
                <Pressable onPress={handleDeselectAll}>
                  <Text style={s.quickLink}>Deselect all</Text>
                </Pressable>
              </View>

              {/* Commit button */}
              <Pressable
                style={[s.commitBtn, selectedCount === 0 && s.commitBtnDisabled]}
                onPress={selectedCount > 0 ? handleCommit : undefined}
              >
                <Text style={s.commitBtnText}>
                  Accept {selectedCount} day{selectedCount !== 1 ? "s" : ""} to journal
                </Text>
              </Pressable>
            </View>

            {/* Unusual section label */}
            {unusual.length > 0 && (
              <Text style={s.sectionLabel}>Unusual days</Text>
            )}
          </View>
        }
        data={listData}
        keyExtractor={(item) =>
          item.type === "routine-toggle" ? "routine-toggle" : item.entry!.id
        }
        renderItem={({ item }) => {
          if (item.type === "routine-toggle") {
            return (
              <Pressable
                style={s.routineToggle}
                onPress={() => setShowRoutine((v) => !v)}
              >
                <Ionicons
                  name={showRoutine ? "chevron-up" : "chevron-down"}
                  size={14}
                  color={colors.textMuted}
                />
                <Text style={s.routineToggleText}>
                  {showRoutine
                    ? `Hide ${routine.length} routine day${routine.length !== 1 ? "s" : ""}`
                    : `Show ${routine.length} routine day${routine.length !== 1 ? "s" : ""}`}
                </Text>
              </Pressable>
            );
          }
          const entry = item.entry!;
          return (
            <EntryRow
              entry={entry}
              unusual={item.type === "unusual"}
              selected={!deselected.has(entry.id)}
              onToggle={(next) => toggleEntry(entry.id, next)}
              expanded={expandedIds.has(entry.id)}
              onExpandToggle={() => toggleExpand(entry.id)}
            />
          );
        }}
        ListEmptyComponent={
          pending.length === 0 ? (
            <View style={s.empty}>
              <Text style={s.emptyText}>No pending days for {place.locality}</Text>
            </View>
          ) : null
        }
      />

      <MergeModal
        visible={showMerge}
        onClose={() => setShowMerge(false)}
        survivorName={place.locality}
        places={mergeCandidates}
        onMerge={(absorbedId) => {
          dialog.confirm(
            "Merge places",
            `Absorb the other place into ${place.locality}? Its key becomes an alias.`,
            "Merge",
            () => hub.mergePlaces(id, absorbedId),
          );
        }}
      />

      <Dialog {...dialog.props} onDismiss={dialog.dismiss} />
    </>
  );
}

// ─── Screen styles ────────────────────────────────────────────────────────────

function screenStyles(colors: any, fonts: any) {
  return StyleSheet.create({
    header: {
      padding: spacing.lg,
      paddingBottom: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: colors.borderFaint,
      marginBottom: spacing.md,
    },
    subtitle: {
      fontSize: 13,
      color: colors.textMuted,
      marginBottom: spacing.xs,
    },
    metaLine: {
      fontSize: 12,
      color: colors.textTertiary,
      marginBottom: spacing.md,
    },
    aliasLine: {
      fontSize: 11,
      color: colors.textMuted,
      marginBottom: spacing.sm,
      fontStyle: "italic",
    },
    // Quick links: "Select all · Deselect all"
    quickRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      marginBottom: spacing.sm,
    },
    quickLink: {
      fontSize: 13,
      color: colors.accent,
    },
    quickSep: {
      fontSize: 13,
      color: colors.textMuted,
    },
    // Single commit button
    commitBtn: {
      backgroundColor: colors.accentBold,
      borderRadius: radius.md,
      paddingVertical: spacing.sm + 2,
      alignItems: "center",
    },
    commitBtnDisabled: {
      opacity: 0.4,
    },
    commitBtnText: {
      fontSize: 14,
      color: colors.white,
      fontFamily: fonts.sansMedium ?? fonts.sans,
      fontWeight: "600",
    },
    sectionLabel: {
      fontSize: 11,
      color: colors.textMuted,
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.sm,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    routineToggle: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      gap: spacing.xs,
    },
    routineToggleText: {
      fontSize: 13,
      color: colors.textMuted,
    },
    empty: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: spacing["2xl"],
    },
    emptyText: {
      fontSize: 15,
      color: colors.textDim,
    },
  });
}
