/**
 * WP14 — Staging Hub: Locality detail.
 *
 * Shows all pending PlaceEntries for one Place, ordered by significance hints:
 *   - Unusual days (high photo count relative to the place's norm) shown first.
 *   - Routine days collapsed below in a "Show N routine days" group.
 *   - Single-photo days are never routine.
 *
 * Per-day actions: Accept / Dismiss individual entries.
 * Header actions: Accept all / Dismiss all.
 *
 * Merge action: lets the user type a search to find a second Place and merge
 * it into this one (absorbing its key as an alias).
 */

import React, { useState, useMemo } from "react";
import {
  FlatList,
  Pressable,
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

// ─── Entry card ───────────────────────────────────────────────────────────────

function EntryCard({
  entry,
  unusual,
  onAccept,
  onDismiss,
}: {
  entry: PlaceEntry;
  unusual: boolean;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const { colors, fonts } = useTheme();
  const s = useMemo(() => cardStyles(colors, fonts), [colors, fonts]);

  return (
    <View style={[s.card, unusual && s.cardUnusual]}>
      <View style={s.dateBlock}>
        <Text style={s.dateText}>{fmtDay(entry.localDay)}</Text>
        {unusual && (
          <View style={s.unusualBadge}>
            <Text style={s.unusualBadgeText}>Unusual</Text>
          </View>
        )}
      </View>

      <View style={s.metaRow}>
        <Ionicons name="images-outline" size={13} color={colors.textMuted} style={{ marginRight: 4 }} />
        <Text style={s.metaText}>
          {entry.photoCount} photo{entry.photoCount !== 1 ? "s" : ""}
          {entry.singlePhoto ? " · Airport / transit?" : ""}
        </Text>
      </View>

      <View style={s.actions}>
        <Pressable
          style={({ pressed }) => [s.btn, s.acceptBtn, pressed && s.pressed]}
          onPress={onAccept}
        >
          <Ionicons name="checkmark" size={16} color={colors.white} />
          <Text style={s.btnText}>Accept</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [s.btn, s.dismissBtn, pressed && s.pressed]}
          onPress={onDismiss}
        >
          <Ionicons name="close" size={16} color={colors.textSecondary} />
          <Text style={[s.btnText, { color: colors.textSecondary }]}>Dismiss</Text>
        </Pressable>
      </View>
    </View>
  );
}

function cardStyles(colors: any, fonts: any) {
  return StyleSheet.create({
    card: {
      marginHorizontal: spacing.lg,
      marginBottom: spacing.sm,
      padding: spacing.md,
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.borderFaint,
    },
    cardUnusual: {
      borderColor: colors.accent,
      borderLeftWidth: 3,
    },
    dateBlock: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: spacing.xs,
    },
    dateText: {
      fontSize: 14,
      fontFamily: fonts.serifSemiBold,
      color: colors.textPrimary,
    },
    unusualBadge: {
      backgroundColor: colors.accentSubtle,
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
      marginBottom: spacing.md,
    },
    metaText: {
      fontSize: 12,
      color: colors.textMuted,
    },
    actions: {
      flexDirection: "row",
      gap: spacing.sm,
    },
    btn: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: spacing.sm,
      borderRadius: radius.md,
      gap: 4,
    },
    acceptBtn: { backgroundColor: colors.accentBold },
    dismissBtn: {
      backgroundColor: "transparent",
      borderWidth: 1,
      borderColor: colors.border,
    },
    btnText: { fontSize: 13, color: colors.white },
    pressed: { opacity: 0.7 },
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
  const displayedRoutine = showRoutine ? routine : [];

  // Merge candidates: all OTHER places
  const mergeCandidates = hub.places
    .filter((p) => p.id !== id)
    .map((p) => ({ id: p.id, locality: p.locality, localityKey: p.localityKey }));

  const handleAcceptEntry = (entry: PlaceEntry) => hub.acceptSingleEntry(entry);
  const handleDismissEntry = (entry: PlaceEntry) => hub.dismissSingleEntry(entry);

  const handleAcceptAll = () => {
    dialog.confirm(
      `Accept all of ${place.locality}`,
      `Accept all ${placeGroup.pending.length} pending days?`,
      "Accept all",
      () => hub.acceptPlace(id),
    );
  };

  const handleDismissAll = () => {
    dialog.confirm(
      `Dismiss all of ${place.locality}`,
      `Send all ${placeGroup.pending.length} pending days to the bin?`,
      "Dismiss all",
      () => hub.dismissPlace(id),
    );
  };

  const headerSubtitle = [place.region, place.country].filter(Boolean).join(", ");

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
                {placeGroup.pending.length} pending · {placeGroup.accepted.length} accepted
              </Text>
              {place.aliasKeys && place.aliasKeys.length > 0 && (
                <Text style={s.aliasLine}>
                  Also known as: {place.aliasKeys.join(", ")}
                </Text>
              )}
              {/* Batch actions */}
              <View style={s.batchRow}>
                <Pressable style={[s.batchBtn, s.acceptBatch]} onPress={handleAcceptAll}>
                  <Text style={s.batchBtnText}>Accept all</Text>
                </Pressable>
                <Pressable style={[s.batchBtn, s.dismissBatch]} onPress={handleDismissAll}>
                  <Text style={[s.batchBtnText, { color: colors.textSecondary }]}>Dismiss all</Text>
                </Pressable>
              </View>
            </View>

            {/* Unusual section label */}
            {unusual.length > 0 && (
              <Text style={s.sectionLabel}>Unusual days</Text>
            )}
          </View>
        }
        data={[
          ...unusual.map((e) => ({ entry: e, type: "unusual" as const })),
          // Routine toggle row
          ...(routine.length > 0
            ? [{ entry: null as null, type: "routine-toggle" as const }]
            : []),
          // Routine entries when expanded
          ...(showRoutine
            ? routine.map((e) => ({ entry: e, type: "routine" as const }))
            : []),
        ]}
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
          return (
            <EntryCard
              entry={item.entry!}
              unusual={item.type === "unusual"}
              onAccept={() => handleAcceptEntry(item.entry!)}
              onDismiss={() => handleDismissEntry(item.entry!)}
            />
          );
        }}
        ListEmptyComponent={
          placeGroup.pending.length === 0 ? (
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
    batchRow: {
      flexDirection: "row",
      gap: spacing.sm,
    },
    batchBtn: {
      flex: 1,
      paddingVertical: spacing.sm,
      borderRadius: radius.md,
      alignItems: "center",
    },
    acceptBatch: { backgroundColor: colors.accentBold },
    dismissBatch: {
      backgroundColor: "transparent",
      borderWidth: 1,
      borderColor: colors.border,
    },
    batchBtnText: {
      fontSize: 13,
      color: colors.white,
      fontFamily: fonts.sansMedium ?? fonts.sans,
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
