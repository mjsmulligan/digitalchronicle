/**
 * Staging Hub — Places
 *
 * Mirrors the file-import BatchReview pattern:
 *   - Single list (no Suggestions / Ignored tabs)
 *   - All pending places shown with Switches (start ON = pre-accepted)
 *   - "Select all" / "Deselect all" quick links
 *   - Prominent "Accept X places to journal" commit button
 *   - On commit: ON → accepted, OFF → dismissed
 *
 * Hierarchy: country (chevron + switch) → region (chevron + switch) → place (switch)
 */

import React, { useCallback, useMemo, useState } from "react";
import {
  FlatList,
  Pressable,
  SectionList,
  StyleSheet,
  Switch,
  Text,
  View,
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

// ─── Selection helpers ────────────────────────────────────────────────────────

function regionPlaceIds(rg: RegionGroup): string[] {
  return rg.places.filter((pg) => pg.pending.length > 0).map((pg) => pg.place.id);
}

function countryPlaceIds(cg: CountryGroup): string[] {
  return cg.regions.flatMap(regionPlaceIds);
}

// ─── Place row ────────────────────────────────────────────────────────────────

function PlaceRow({
  pg,
  isOn,
  onToggle,
  onPress,
  colors,
  fonts,
  s,
}: {
  pg: PlaceGroup;
  isOn: boolean;
  onToggle: (id: string, next: boolean) => void;
  onPress: () => void;
  colors: any;
  fonts: any;
  s: any;
}) {
  if (pg.pending.length === 0) return null;

  const days = pg.pending.map((e) => e.localDay).sort();
  const dateLabel =
    days.length === 1
      ? fmtDay(days[0])
      : `${fmtDay(days[0])} – ${fmtDay(days[days.length - 1])}`;

  return (
    <View style={s.placeRow}>
      <Pressable
        style={({ pressed }) => [s.placeInfoPress, pressed && s.pressed]}
        onPress={onPress}
      >
        <Text style={s.placeName}>{pg.place.locality}</Text>
        <Text style={s.placeMeta}>
          {pluralDays(pg.pending.length)} · {dateLabel}
        </Text>
        {pg.pending.length > 1 && (
          <Text style={[s.detailHint, { color: colors.accent }]}>Tap for per-day review</Text>
        )}
      </Pressable>
      <Switch
        value={isOn}
        onValueChange={(next) => onToggle(pg.place.id, next)}
        trackColor={{ true: colors.accent, false: colors.border }}
        thumbColor={isOn ? colors.surface : colors.textMuted}
        style={s.rowSwitch}
      />
    </View>
  );
}

// ─── Region block ─────────────────────────────────────────────────────────────

function RegionBlock({
  rg,
  deselected,
  onTogglePlace,
  onToggleRegion,
  onPlacePress,
  colors,
  fonts,
  s,
}: {
  rg: RegionGroup;
  deselected: Set<string>;
  onTogglePlace: (id: string, next: boolean) => void;
  onToggleRegion: (ids: string[], next: boolean) => void;
  onPlacePress: (placeId: string) => void;
  colors: any;
  fonts: any;
  s: any;
}) {
  const [expanded, setExpanded] = useState(true);

  if (rg.pendingCount === 0) return null;

  const ids = regionPlaceIds(rg);
  // Region switch: ON if any place in region is selected
  const regionOn = ids.some((id) => !deselected.has(id));

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
        {/* Stop propagation so Switch doesn't toggle expand/collapse */}
        <Pressable onPress={(e) => e.stopPropagation()}>
          <Switch
            value={regionOn}
            onValueChange={(next) => onToggleRegion(ids, next)}
            trackColor={{ true: colors.accent, false: colors.border }}
            thumbColor={regionOn ? colors.surface : colors.textMuted}
            style={s.rowSwitch}
          />
        </Pressable>
      </Pressable>

      {/* Place rows */}
      {expanded &&
        rg.places.map((pg) => (
          <PlaceRow
            key={pg.place.id}
            pg={pg}
            isOn={!deselected.has(pg.place.id)}
            onToggle={onTogglePlace}
            onPress={() => onPlacePress(pg.place.id)}
            colors={colors}
            fonts={fonts}
            s={s}
          />
        ))}
    </View>
  );
}

// ─── Commit bar ───────────────────────────────────────────────────────────────

function CommitBar({
  selectedCount,
  totalCount,
  onCommit,
  onSelectAll,
  onDeselectAll,
  colors,
  fonts,
  s,
}: {
  selectedCount: number;
  totalCount: number;
  onCommit: () => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  colors: any;
  fonts: any;
  s: any;
}) {
  return (
    <View style={[s.commitCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {/* Quick links */}
      <View style={s.quickLinks}>
        <Pressable onPress={onSelectAll}>
          <Text style={[s.quickLink, { color: colors.accent }]}>
            Select all ({totalCount})
          </Text>
        </Pressable>
        <Pressable onPress={onDeselectAll}>
          <Text style={[s.quickLink, { color: colors.accent }]}>Deselect all</Text>
        </Pressable>
      </View>
      {/* Commit button */}
      <Pressable
        style={[s.commitBtn, { backgroundColor: colors.accentBold }, !selectedCount && s.commitBtnDisabled]}
        disabled={!selectedCount}
        onPress={onCommit}
      >
        <Text style={[s.commitBtnText, { fontFamily: fonts.sansMedium ?? fonts.sans }]}>
          Accept {selectedCount} {selectedCount === 1 ? "place" : "places"} to journal
        </Text>
      </Pressable>
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
  const [expandedCountries, setExpandedCountries] = useState<Set<string>>(new Set());

  // All pending place IDs across the hierarchy
  const allPendingIds = useMemo(
    () => new Set(hub.hierarchy.flatMap(countryPlaceIds)),
    [hub.hierarchy],
  );

  // deselected: place IDs explicitly turned OFF by the user
  // (new places from re-scan auto-start ON since they're not in this set)
  const [deselected, setDeselected] = useState<Set<string>>(new Set());

  // Count of pending places currently switched ON
  const selectedCount = useMemo(
    () => [...allPendingIds].filter((id) => !deselected.has(id)).length,
    [allPendingIds, deselected],
  );

  // ── Toggle helpers ────────────────────────────────────────────────────────

  const togglePlace = useCallback((id: string, next: boolean) => {
    setDeselected((prev) => {
      const s = new Set(prev);
      if (next) s.delete(id);
      else s.add(id);
      return s;
    });
  }, []);

  const toggleGroup = useCallback((ids: string[], next: boolean) => {
    setDeselected((prev) => {
      const s = new Set(prev);
      for (const id of ids) {
        if (next) s.delete(id);
        else s.add(id);
      }
      return s;
    });
  }, []);

  const toggleCountryExpand = useCallback((country: string) => {
    setExpandedCountries((prev) => {
      const s = new Set(prev);
      if (s.has(country)) s.delete(country);
      else s.add(country);
      return s;
    });
  }, []);

  const selectAll = useCallback(() => setDeselected(new Set()), []);
  const deselectAll = useCallback(
    () => setDeselected(new Set(allPendingIds)),
    [allPendingIds],
  );

  // ── Commit ────────────────────────────────────────────────────────────────

  const handleCommit = useCallback(async () => {
    const toAccept = [...allPendingIds].filter((id) => !deselected.has(id));
    const toIgnore = [...allPendingIds].filter((id) => deselected.has(id));
    await Promise.all([
      ...toAccept.map((id) => hub.acceptPlace(id)),
      ...toIgnore.map((id) => hub.dismissPlace(id)),
    ]);
    setDeselected(new Set());
  }, [allPendingIds, deselected, hub]);

  // ── Section data ──────────────────────────────────────────────────────────

  const sections = useMemo(
    () =>
      hub.hierarchy
        .filter((cg) => cg.pendingCount > 0)
        .map((cg) => ({
          country: cg.country,
          pendingCount: cg.pendingCount,
          ids: countryPlaceIds(cg),
          data: cg.regions.filter((rg) => rg.pendingCount > 0),
        })),
    [hub.hierarchy],
  );

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: "Staging Hub",
          headerStyle: { backgroundColor: colors.surface },
          headerTitleStyle: { fontFamily: fonts.serifSemiBold, color: colors.textBright },
          headerTintColor: colors.accent,
        }}
      />

      {allPendingIds.size === 0 ? (
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
          keyExtractor={(rg) => `${rg.country ?? "?"}:${rg.region}`}
          ListHeaderComponent={
            <CommitBar
              selectedCount={selectedCount}
              totalCount={allPendingIds.size}
              onCommit={handleCommit}
              onSelectAll={selectAll}
              onDeselectAll={deselectAll}
              colors={colors}
              fonts={fonts}
              s={s}
            />
          }
          renderSectionHeader={({ section }) => {
            const expanded = !expandedCountries.has(section.country);
            const countryOn = section.ids.some((id) => !deselected.has(id));
            return (
              <Pressable
                style={s.countryHeader}
                onPress={() => toggleCountryExpand(section.country)}
              >
                <View style={s.countryLeft}>
                  <Ionicons
                    name={expanded ? "chevron-down" : "chevron-forward"}
                    size={14}
                    color={colors.textMuted}
                    style={{ marginRight: 6 }}
                  />
                  <Text style={s.countryName}>{section.country}</Text>
                  <Text style={s.countryCount}>{section.pendingCount} pending</Text>
                </View>
                <Pressable onPress={(e) => e.stopPropagation()}>
                  <Switch
                    value={countryOn}
                    onValueChange={(next) => toggleGroup(section.ids, next)}
                    trackColor={{ true: colors.accent, false: colors.border }}
                    thumbColor={countryOn ? colors.surface : colors.textMuted}
                    style={s.rowSwitch}
                  />
                </Pressable>
              </Pressable>
            );
          }}
          renderItem={({ item: rg, section }) => {
            const expanded = !expandedCountries.has(section.country);
            if (!expanded) return null;
            return (
              <RegionBlock
                key={rg.region}
                rg={rg}
                deselected={deselected}
                onTogglePlace={togglePlace}
                onToggleRegion={toggleGroup}
                onPlacePress={(id) => router.push(`/staging/place/${id}` as any)}
                colors={colors}
                fonts={fonts}
                s={s}
              />
            );
          }}
        />
      )}

      <Dialog {...dialog.props} onDismiss={dialog.dismiss} />
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function styles(
  colors: ReturnType<typeof useTheme>["colors"],
  fonts: ReturnType<typeof useTheme>["fonts"],
) {
  return StyleSheet.create({
    // Commit bar
    commitCard: {
      margin: spacing.lg,
      borderRadius: radius.xl,
      borderWidth: 1,
      padding: spacing.md,
    },
    quickLinks: {
      flexDirection: "row",
      gap: spacing.base,
      marginBottom: spacing.sm,
    },
    quickLink: {
      fontSize: 12,
      fontWeight: "600",
    },
    commitBtn: {
      borderRadius: radius.lg,
      paddingVertical: 13,
      alignItems: "center",
    },
    commitBtnDisabled: { opacity: 0.4 },
    commitBtnText: {
      fontSize: 14,
      color: "#fff",
      fontWeight: "700",
    },

    // Country header
    countryHeader: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: spacing.lg,
      paddingRight: spacing.md,
      paddingTop: spacing.lg,
      paddingBottom: spacing.sm,
    },
    countryLeft: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
    },
    countryName: {
      fontFamily: fonts.serifSemiBold,
      fontSize: 16,
      color: colors.textBright,
      marginRight: spacing.sm,
    },
    countryCount: {
      fontSize: 12,
      color: colors.textMuted,
    },

    // Region block
    regionBlock: {
      marginBottom: spacing.xs,
    },
    regionHeader: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: spacing.lg,
      paddingRight: spacing.md,
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
      color: colors.accent,
      backgroundColor: colors.surfaceAccent,
      borderRadius: 8,
      paddingHorizontal: 6,
      paddingVertical: 2,
      fontFamily: fonts.sansMedium ?? fonts.sans,
    },

    // Place row
    placeRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingLeft: spacing.lg + 20, // indent under region
      paddingRight: spacing.md,
      paddingVertical: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderFaint,
      backgroundColor: colors.bg,
    },
    placeInfoPress: {
      flex: 1,
      paddingRight: spacing.sm,
    },
    pressed: { opacity: 0.7 },
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
    detailHint: {
      fontSize: 11,
      marginTop: 2,
    },
    rowSwitch: {
      transform: [{ scaleX: 0.85 }, { scaleY: 0.85 }],
    },

    // Empty state
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
  });
}
