/**
 * Place detail screen (WP12c)
 *
 * Shows all unreviewed PlaceEntries for one Place. Actions are immediate:
 * tapping "Keep" or "Hide" on any entry commits right away. No staging, no
 * commit step.
 *
 * Layout:
 *   - Header: place subtitle, "X to review" count, "Keep all" / "Hide all" bulk
 *     buttons for the place, aliases if any.
 *   - Unusual days first, then a collapsible "N routine days" group.
 *   - Each entry row: date + photo count, "Keep" / "Hide" inline buttons,
 *     tap-to-expand horizontal photo strip.
 *   - Merge button in the navigation header (unchanged from WP14).
 */

import React, { useState, useMemo } from "react";
import {
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
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
// Each row has immediate Keep / Hide buttons. Tap the row body to expand or
// collapse the horizontal photo strip.

function EntryRow({
  entry,
  unusual,
  expanded,
  onExpandToggle,
  onKeep,
  onHide,
}: {
  entry: PlaceEntry;
  unusual: boolean;
  expanded: boolean;
  onExpandToggle: () => void;
  onKeep: () => void;
  onHide: () => void;
}) {
  const { colors, fonts } = useTheme();
  const s = useMemo(() => rowStyles(colors, fonts), [colors, fonts]);

  const photos = entry.photoEvidence.filter((r) => r.uri && !r.missing);

  return (
    <View style={[s.row, unusual && s.rowUnusual]}>
      {/* Main row */}
      <View style={s.mainRow}>
        <Pressable style={s.body} onPress={onExpandToggle}>
          <View style={s.titleRow}>
            <Text style={s.dateText}>{fmtDay(entry.localDay)}</Text>
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

        {/* Immediate Keep / Hide buttons */}
        <View style={s.buttons}>
          <Pressable
            style={({ pressed }) => [s.btnKeep, { opacity: pressed ? 0.7 : 1 }]}
            onPress={onKeep}
            hitSlop={6}
          >
            <Text style={[s.btnKeepText, { fontFamily: fonts.sansMedium ?? fonts.sans }]}>Keep</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [s.btnHide, { opacity: pressed ? 0.7 : 1 }]}
            onPress={onHide}
            hitSlop={6}
          >
            <Text style={[s.btnHideText, { fontFamily: fonts.sansMedium ?? fonts.sans }]}>Hide</Text>
          </Pressable>
        </View>
      </View>

      {/* Photo strip */}
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
      gap: spacing.sm,
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
    metaRow: {
      flexDirection: "row",
      alignItems: "center",
    },
    metaText: {
      fontSize: 12,
      color: colors.textMuted,
    },
    buttons: {
      flexDirection: "row",
      gap: 6,
    },
    btnKeep: {
      backgroundColor: colors.surfaceAccent,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 6,
    },
    btnKeepText: {
      fontSize: 12,
      color: colors.accent,
      fontWeight: "600",
    },
    btnHide: {
      backgroundColor: colors.surfaceMuted,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 6,
    },
    btnHideText: {
      fontSize: 12,
      color: colors.textMuted,
      fontWeight: "600",
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
            placeholder="Search places..."
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
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const place = hub.places.find((p) => p.id === id);
  const placeGroup = hub.placeGroupsById.get(id);

  if (!place || !placeGroup) {
    return (
      <View style={s.empty}>
        <Stack.Screen options={{ headerShown: true, headerTitle: "Place" }} />
        <Text style={s.emptyText}>Place not found</Text>
      </View>
    );
  }

  const { unusual, routine, unreviewed } = placeGroup;

  const toggleExpand = (entryId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  };

  const handleKeepAll = () => hub.keepPlace(id);
  const handleHideAll = () => {
    dialog.confirm(
      "Hide all entries",
      `Hide all entries for ${place.locality}? They will no longer appear in your journal.`,
      "Hide all",
      () => hub.hidePlace(id),
    );
  };

  // Merge candidates: all other places
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
                {unreviewed.length} to review
                {place.aliasKeys && place.aliasKeys.length > 0
                  ? ` · also: ${place.aliasKeys.join(", ")}`
                  : ""}
              </Text>

              {/* Bulk actions */}
              {unreviewed.length > 0 && (
                <View style={s.bulkRow}>
                  <Pressable
                    style={({ pressed }) => [s.bulkBtn, s.bulkKeep, { opacity: pressed ? 0.7 : 1 }]}
                    onPress={handleKeepAll}
                  >
                    <Text style={[s.bulkBtnText, { color: colors.accent, fontFamily: fonts.sansMedium ?? fonts.sans }]}>
                      Keep all
                    </Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [s.bulkBtn, s.bulkHide, { opacity: pressed ? 0.7 : 1 }]}
                    onPress={handleHideAll}
                  >
                    <Text style={[s.bulkBtnText, { color: colors.textMuted, fontFamily: fonts.sansMedium ?? fonts.sans }]}>
                      Hide all
                    </Text>
                  </Pressable>
                </View>
              )}
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
              expanded={expandedIds.has(entry.id)}
              onExpandToggle={() => toggleExpand(entry.id)}
              onKeep={() => hub.keepEntry(entry)}
              onHide={() => hub.hideEntry(entry)}
            />
          );
        }}
        ListEmptyComponent={
          unreviewed.length === 0 ? (
            <View style={s.empty}>
              <Text style={s.emptyText}>All caught up for {place.locality}</Text>
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
    bulkRow: {
      flexDirection: "row",
      gap: spacing.sm,
    },
    bulkBtn: {
      flex: 1,
      paddingVertical: spacing.sm,
      alignItems: "center",
      borderRadius: radius.md,
    },
    bulkKeep: {
      backgroundColor: colors.surfaceAccent,
    },
    bulkHide: {
      backgroundColor: colors.surfaceMuted,
    },
    bulkBtnText: {
      fontSize: 13,
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
