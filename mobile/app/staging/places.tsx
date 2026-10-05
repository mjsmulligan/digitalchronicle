/**
 * WP14 — Staging Hub: Places.
 *
 * Entry point for reviewing photo-library place suggestions. Shows a
 * country → region → locality hierarchy with pending counts and batch
 * accept / dismiss actions. Navigates to the locality detail screen for
 * per-day review.
 *
 * Two tabs: Suggestions (pending entries) and Bin (dismissed entries).
 */

import React, { useState, useMemo } from "react";
import {
  FlatList,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  View,
  ActivityIndicator,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme, spacing, radius } from "../../src/components/ThemeProvider";
import { useDialog, Dialog } from "../../src/components/Dialog";
import { useStagingHub } from "../../src/lib/exif/useStagingHub";
import type { PlaceGroup, RegionGroup, CountryGroup } from "../../src/lib/exif/useStagingHub";

// ─── Date helpers ─────────────────────────────────────────────────────────────

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function fmtDay(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function pluralDays(n: number): string {
  return n === 1 ? "1 day" : `${n} days`;
}

// ─── Tab bar ──────────────────────────────────────────────────────────────────

type Tab = "suggestions" | "bin";

// ─── Suggestion section ───────────────────────────────────────────────────────

function PlaceRow({
  pg,
  onPress,
  onAcceptAll,
  onDismissAll,
}: {
  pg: PlaceGroup;
  onPress: () => void;
  onAcceptAll: () => void;
  onDismissAll: () => void;
}) {
  const { colors, fonts } = useTheme();
  const s = useMemo(() => styles(colors, fonts), [colors, fonts]);

  if (pg.pending.length === 0) return null;

  const days = pg.pending.map((e) => e.localDay).sort();
  const dateLabel =
    days.length === 1
      ? fmtDay(days[0])
      : `${fmtDay(days[0])} – ${fmtDay(days[days.length - 1])}`;

  return (
    <Pressable style={({ pressed }) => [s.placeRow, pressed && s.pressed]} onPress={onPress}>
      <View style={s.placeInfo}>
        <Text style={s.placeName}>{pg.place.locality}</Text>
        <Text style={s.placeMeta}>
          {pluralDays(pg.pending.length)} · {dateLabel}
        </Text>
      </View>
      <View style={s.placeActions}>
        <Pressable style={[s.actionBtn, s.acceptBtn]} onPress={onAcceptAll}>
          <Ionicons name="checkmark" size={16} color={colors.white} />
        </Pressable>
        <Pressable style={[s.actionBtn, s.dismissBtn]} onPress={onDismissAll}>
          <Ionicons name="close" size={16} color={colors.textSecondary} />
        </Pressable>
      </View>
    </Pressable>
  );
}

function RegionSection({
  rg,
  onPlacePress,
  onAcceptAll,
  onDismissAll,
  onAcceptRegion,
  onDismissRegion,
}: {
  rg: RegionGroup;
  onPlacePress: (placeId: string) => void;
  onAcceptAll: (placeId: string) => void;
  onDismissAll: (placeId: string) => void;
  onAcceptRegion: (region: string) => void;
  onDismissRegion: (region: string) => void;
}) {
  const { colors, fonts } = useTheme();
  const s = useMemo(() => styles(colors, fonts), [colors, fonts]);
  const [expanded, setExpanded] = useState(true);

  if (rg.pendingCount === 0) return null;

  return (
    <View style={s.regionBlock}>
      {/* Region header */}
      <Pressable style={s.regionHeader} onPress={() => setExpanded((v) => !v)}>
        <View style={s.regionLeft}>
          <Ionicons
            name={expanded ? "chevron-down" : "chevron-forward"}
            size={14}
            color={colors.textMuted}
            style={{ marginRight: 6 }}
          />
          <Text style={s.regionName}>{rg.region}</Text>
          <Text style={s.regionCount}>{rg.pendingCount}</Text>
        </View>
        <View style={s.regionBatch}>
          <Pressable style={[s.actionBtn, s.acceptBtn, s.smallBtn]} onPress={() => onAcceptRegion(rg.region)}>
            <Text style={s.smallBtnText}>Accept all</Text>
          </Pressable>
          <Pressable style={[s.actionBtn, s.dismissBtn, s.smallBtn]} onPress={() => onDismissRegion(rg.region)}>
            <Text style={[s.smallBtnText, { color: colors.textSecondary }]}>Dismiss all</Text>
          </Pressable>
        </View>
      </Pressable>

      {/* Place rows */}
      {expanded && rg.places.map((pg) => (
        <PlaceRow
          key={pg.place.id}
          pg={pg}
          onPress={() => onPlacePress(pg.place.id)}
          onAcceptAll={() => onAcceptAll(pg.place.id)}
          onDismissAll={() => onDismissAll(pg.place.id)}
        />
      ))}
    </View>
  );
}

// ─── Bin section ──────────────────────────────────────────────────────────────

function BinSection({
  hub,
  dialog,
}: {
  hub: ReturnType<typeof useStagingHub>;
  dialog: ReturnType<typeof useDialog>;
}) {
  const { colors, fonts } = useTheme();
  const s = useMemo(() => styles(colors, fonts), [colors, fonts]);

  const placeById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of hub.places) m.set(p.id, p.locality);
    return m;
  }, [hub.places]);

  if (hub.binEntries.length === 0) {
    return (
      <View style={s.empty}>
        <Text style={s.emptyText}>Bin is empty</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {/* Actions bar */}
      <View style={s.binActions}>
        <Pressable
          style={s.binActionBtn}
          onPress={() =>
            dialog.confirm(
              "Empty bin",
              "This creates markers so these photos are never re-offered. You can undo this with Reset decisions.",
              "Empty bin",
              () => hub.emptyBin(),
            )
          }
        >
          <Text style={s.binActionText}>Empty bin</Text>
        </Pressable>
        <Pressable
          style={s.binActionBtn}
          onPress={() =>
            dialog.confirm(
              "Reset decisions",
              "All dismissed entries return to pending and markers are deleted. Photos will be offered again on re-scan.",
              "Reset",
              () => hub.resetDecisions(),
            )
          }
        >
          <Text style={s.binActionText}>Reset decisions</Text>
        </Pressable>
      </View>

      <FlatList
        data={hub.binEntries}
        keyExtractor={(e) => e.id}
        renderItem={({ item: e }) => (
          <View style={s.binRow}>
            <View style={s.placeInfo}>
              <Text style={s.placeName}>
                {placeById.get(e.placeId) ?? e.localityKey}
              </Text>
              <Text style={s.placeMeta}>{fmtDay(e.localDay)} · {e.photoCount} photo{e.photoCount !== 1 ? "s" : ""}</Text>
            </View>
            <Pressable
              style={[s.actionBtn, s.restoreBtn]}
              onPress={() => hub.restoreSingleEntry(e)}
            >
              <Text style={s.restoreBtnText}>Restore</Text>
            </Pressable>
          </View>
        )}
        contentContainerStyle={{ paddingBottom: spacing["3xl"] }}
      />
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function StagingPlacesScreen() {
  const router = useRouter();
  const { colors, fonts } = useTheme();
  const s = useMemo(() => styles(colors, fonts), [colors, fonts]);
  const dialog = useDialog();
  const hub = useStagingHub();
  const [tab, setTab] = useState<Tab>("suggestions");

  function handleAcceptRegion(region: string) {
    dialog.confirm(
      `Accept all of ${region}`,
      `Accept all pending entries for every locality in ${region}?`,
      "Accept all",
      () => hub.acceptRegion(region),
    );
  }

  function handleDismissRegion(region: string) {
    dialog.confirm(
      `Dismiss all of ${region}`,
      `Dismiss all pending entries for every locality in ${region}? They will go to the bin.`,
      "Dismiss all",
      () => hub.dismissRegion(region),
    );
  }

  function handleAcceptPlace(placeId: string) {
    const place = hub.places.find((p) => p.id === placeId);
    dialog.confirm(
      `Accept all of ${place?.locality ?? "place"}`,
      "Accept all pending days for this place?",
      "Accept all",
      () => hub.acceptPlace(placeId),
    );
  }

  function handleDismissPlace(placeId: string) {
    const place = hub.places.find((p) => p.id === placeId);
    dialog.confirm(
      `Dismiss all of ${place?.locality ?? "place"}`,
      "Send all pending days to the bin?",
      "Dismiss all",
      () => hub.dismissPlace(placeId),
    );
  }

  // Flatten for SectionList: sections = countries, each item = RegionGroup
  const sections = hub.hierarchy
    .filter((cg) => cg.pendingCount > 0)
    .map((cg) => ({
      title: cg.country,
      pendingCount: cg.pendingCount,
      data: cg.regions.filter((rg) => rg.pendingCount > 0),
    }));

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: "Staging Hub",
          headerStyle:  { backgroundColor: colors.surface },
          headerTitleStyle: { fontFamily: fonts.serifSemiBold, color: colors.textBright },
          headerTintColor: colors.accent,
        }}
      />

      {/* Tab bar */}
      <View style={s.tabBar}>
        {(["suggestions", "bin"] as Tab[]).map((t) => (
          <Pressable key={t} style={[s.tab, tab === t && s.tabActive]} onPress={() => setTab(t)}>
            <Text style={[s.tabText, tab === t && s.tabTextActive]}>
              {t === "suggestions"
                ? `Suggestions${hub.totalPending > 0 ? ` (${hub.totalPending})` : ""}`
                : `Bin${hub.binEntries.length > 0 ? ` (${hub.binEntries.length})` : ""}`}
            </Text>
          </Pressable>
        ))}
      </View>

      {tab === "suggestions" ? (
        sections.length === 0 ? (
          <View style={s.empty}>
            <Text style={s.emptyText}>No pending suggestions</Text>
            <Text style={s.emptySubtext}>
              Run a photo scan to find places from your library.
            </Text>
          </View>
        ) : (
          <SectionList
            style={{ flex: 1, backgroundColor: colors.bg }}
            contentContainerStyle={{ paddingBottom: spacing["3xl"] }}
            sections={sections}
            keyExtractor={(rg) => `${rg.country}:${rg.region}`}
            renderSectionHeader={({ section }) => (
              <View style={s.countryHeader}>
                <Text style={s.countryName}>{section.title}</Text>
                <Text style={s.countryCount}>{section.pendingCount} pending</Text>
              </View>
            )}
            renderItem={({ item: rg }) => (
              <RegionSection
                key={rg.region}
                rg={rg}
                onPlacePress={(id) => router.push(`/staging/place/${id}` as any)}
                onAcceptAll={handleAcceptPlace}
                onDismissAll={handleDismissPlace}
                onAcceptRegion={handleAcceptRegion}
                onDismissRegion={handleDismissRegion}
              />
            )}
          />
        )
      ) : (
        <BinSection hub={hub} dialog={dialog} />
      )}

      <Dialog {...dialog.props} onDismiss={dialog.dismiss} />
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function styles(colors: ReturnType<typeof useTheme>["colors"], fonts: ReturnType<typeof useTheme>["fonts"]) {
  return StyleSheet.create({
    tabBar: {
      flexDirection: "row",
      backgroundColor: colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: colors.borderFaint,
    },
    tab: {
      flex: 1,
      paddingVertical: spacing.md,
      alignItems: "center",
    },
    tabActive: {
      borderBottomWidth: 2,
      borderBottomColor: colors.accent,
    },
    tabText: {
      fontSize: 14,
      color: colors.textMuted,
      fontFamily: fonts.sans,
    },
    tabTextActive: {
      color: colors.accent,
      fontFamily: fonts.sansMedium ?? fonts.sans,
    },

    countryHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.xl,
      paddingBottom: spacing.sm,
    },
    countryName: {
      fontFamily: fonts.serifSemiBold,
      fontSize: 16,
      color: colors.textBright,
    },
    countryCount: {
      fontSize: 12,
      color: colors.textMuted,
    },

    regionBlock: {
      marginBottom: spacing.sm,
    },
    regionHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      backgroundColor: colors.surfaceMuted,
    },
    regionLeft: {
      flexDirection: "row",
      alignItems: "center",
      flex: 1,
    },
    regionName: {
      fontSize: 13,
      fontFamily: fonts.sansMedium ?? fonts.sans,
      color: colors.textSecondary,
      marginRight: spacing.xs,
    },
    regionCount: {
      fontSize: 12,
      color: colors.textMuted,
      backgroundColor: colors.accentSubtle,
      borderRadius: 8,
      paddingHorizontal: 6,
      paddingVertical: 2,
    },
    regionBatch: {
      flexDirection: "row",
      gap: spacing.xs,
    },
    smallBtn: {
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      borderRadius: radius.md,
    },
    smallBtnText: {
      fontSize: 11,
      color: colors.white,
      fontFamily: fonts.sansMedium ?? fonts.sans,
    },

    placeRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderFaint,
      backgroundColor: colors.bg,
    },
    pressed: { opacity: 0.7 },
    placeInfo: { flex: 1 },
    placeName: {
      fontSize: 15,
      fontFamily: fonts.serifSemiBold,
      color: colors.textPrimary,
      marginBottom: 2,
    },
    placeMeta: {
      fontSize: 12,
      color: colors.textMuted,
    },
    placeActions: {
      flexDirection: "row",
      gap: spacing.xs,
    },
    actionBtn: {
      width: 34,
      height: 34,
      borderRadius: radius.lg,
      alignItems: "center",
      justifyContent: "center",
    },
    acceptBtn: { backgroundColor: colors.accentBold },
    dismissBtn: {
      backgroundColor: "transparent",
      borderWidth: 1,
      borderColor: colors.border,
    },

    empty: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: spacing["2xl"],
      backgroundColor: colors.bg,
    },
    emptyText: {
      fontSize: 16,
      fontFamily: fonts.serifSemiBold,
      color: colors.textDim,
      marginBottom: spacing.sm,
    },
    emptySubtext: {
      fontSize: 13,
      color: colors.textMuted,
      textAlign: "center",
      lineHeight: 20,
    },

    binActions: {
      flexDirection: "row",
      padding: spacing.md,
      gap: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.borderFaint,
      backgroundColor: colors.surface,
    },
    binActionBtn: {
      flex: 1,
      paddingVertical: spacing.sm,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceMuted,
      alignItems: "center",
    },
    binActionText: {
      fontSize: 13,
      color: colors.textSecondary,
      fontFamily: fonts.sansMedium ?? fonts.sans,
    },
    binRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderFaint,
    },
    restoreBtn: {
      backgroundColor: "transparent",
      borderWidth: 1,
      borderColor: colors.accent,
      width: "auto",
      paddingHorizontal: spacing.md,
    },
    restoreBtnText: {
      fontSize: 13,
      color: colors.accent,
    },
  });
}
