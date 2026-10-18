/**
 * Places screen (WP12c)
 *
 * Shows all place entries that need review (unreviewed !== undefined && !hidden),
 * grouped by country -> region -> place. Actions are immediate: no staging, no
 * commit step.
 *
 * Hierarchy controls:
 *   - Country header: "Keep all" / "Hide all" for all entries in that country
 *   - Region sub-header: "Keep all" / "Hide all" for that region
 *   - Place row: tap to open the detail screen; badge shows N to review
 *
 * emptyBin, resetDecisions, and the commit bar are retired (WP12c).
 */

import React, { useCallback, useMemo, useState } from "react";
import {
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme, spacing, radius } from "../../src/components/ThemeProvider";
import { useStagingHub } from "../../src/lib/exif/useStagingHub";
import type { PlaceGroup, RegionGroup, CountryGroup } from "../../src/lib/exif/useStagingHub";

// ─── Inline action button pair ────────────────────────────────────────────────

function ActionButtons({
  onKeep,
  onHide,
  colors,
  fonts,
}: {
  onKeep: () => void;
  onHide: () => void;
  colors: any;
  fonts: any;
}) {
  return (
    <View style={{ flexDirection: "row", gap: 6 }}>
      <Pressable
        style={({ pressed }) => [
          btnBase,
          { backgroundColor: colors.surfaceAccent, opacity: pressed ? 0.7 : 1 },
        ]}
        onPress={onKeep}
        hitSlop={6}
      >
        <Text style={[btnText, { color: colors.accent, fontFamily: fonts.sansMedium ?? fonts.sans }]}>
          Keep
        </Text>
      </Pressable>
      <Pressable
        style={({ pressed }) => [
          btnBase,
          { backgroundColor: colors.surfaceMuted, opacity: pressed ? 0.7 : 1 },
        ]}
        onPress={onHide}
        hitSlop={6}
      >
        <Text style={[btnText, { color: colors.textMuted, fontFamily: fonts.sansMedium ?? fonts.sans }]}>
          Hide
        </Text>
      </Pressable>
    </View>
  );
}

const btnBase: object = {
  paddingHorizontal: 10,
  paddingVertical: 5,
  borderRadius: 6,
};
const btnText: object = {
  fontSize: 12,
  fontWeight: "600",
};

// ─── Place row ────────────────────────────────────────────────────────────────

function PlaceRow({
  pg,
  onPress,
  onKeep,
  onHide,
  colors,
  fonts,
  s,
}: {
  pg: PlaceGroup;
  onPress: () => void;
  onKeep: () => void;
  onHide: () => void;
  colors: any;
  fonts: any;
  s: any;
}) {
  if (pg.unreviewedCount === 0) return null;

  return (
    <Pressable
      style={({ pressed }) => [s.placeRow, pressed && s.pressed]}
      onPress={onPress}
    >
      <View style={s.placeInfo}>
        <Text style={s.placeName}>{pg.place.locality}</Text>
        <Text style={s.placeMeta}>
          {pg.unreviewedCount} to review
        </Text>
      </View>
      <View style={s.placeRight}>
        <ActionButtons onKeep={onKeep} onHide={onHide} colors={colors} fonts={fonts} />
        <Ionicons
          name="chevron-forward"
          size={13}
          color={colors.textMuted}
          style={{ marginLeft: 4 }}
        />
      </View>
    </Pressable>
  );
}

// ─── Region block ─────────────────────────────────────────────────────────────

function RegionBlock({
  rg,
  onPlacePress,
  onKeepPlace,
  onHidePlace,
  onKeepRegion,
  onHideRegion,
  colors,
  fonts,
  s,
}: {
  rg: RegionGroup;
  onPlacePress: (placeId: string) => void;
  onKeepPlace: (placeId: string) => void;
  onHidePlace: (placeId: string) => void;
  onKeepRegion: (regionName: string) => void;
  onHideRegion: (regionName: string) => void;
  colors: any;
  fonts: any;
  s: any;
}) {
  const [expanded, setExpanded] = useState(true);

  if (rg.unreviewedCount === 0) return null;

  return (
    <View style={s.regionBlock}>
      {/* Region header */}
      <Pressable style={s.regionHeader} onPress={() => setExpanded((v) => !v)}>
        <View style={s.regionLeft}>
          <Ionicons
            name={expanded ? "chevron-down" : "chevron-forward"}
            size={13}
            color={colors.textMuted}
            style={{ marginRight: 6 }}
          />
          <Text style={s.regionName}>{rg.region}</Text>
          <View style={[s.badge, { backgroundColor: colors.surfaceAccent }]}>
            <Text style={[s.badgeText, { color: colors.accent }]}>{rg.unreviewedCount}</Text>
          </View>
        </View>
        <Pressable
          onPress={(e) => {
            e.stopPropagation();
          }}
        >
          <ActionButtons
            onKeep={() => onKeepRegion(rg.region)}
            onHide={() => onHideRegion(rg.region)}
            colors={colors}
            fonts={fonts}
          />
        </Pressable>
      </Pressable>

      {/* Place rows */}
      {expanded &&
        rg.places.map((pg) => (
          <PlaceRow
            key={pg.place.id}
            pg={pg}
            onPress={() => onPlacePress(pg.place.id)}
            onKeep={() => onKeepPlace(pg.place.id)}
            onHide={() => onHidePlace(pg.place.id)}
            colors={colors}
            fonts={fonts}
            s={s}
          />
        ))}
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function StagingPlacesScreen() {
  const router = useRouter();
  const { colors, fonts } = useTheme();
  const s = useMemo(() => styles(colors, fonts), [colors, fonts]);
  const hub = useStagingHub();
  const [expandedCountries, setExpandedCountries] = useState<Set<string>>(new Set());

  const toggleCountryExpand = useCallback((country: string) => {
    setExpandedCountries((prev) => {
      const next = new Set(prev);
      if (next.has(country)) next.delete(country);
      else next.add(country);
      return next;
    });
  }, []);

  // SectionList sections: one section per country, items are regions
  const sections = useMemo(
    () =>
      hub.hierarchy
        .filter((cg) => cg.unreviewedCount > 0)
        .map((cg) => ({
          country: cg.country,
          unreviewedCount: cg.unreviewedCount,
          data: cg.regions.filter((rg) => rg.unreviewedCount > 0),
        })),
    [hub.hierarchy],
  );

  const isEmpty = hub.totalUnreviewed === 0;

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: "Places",
          headerStyle: { backgroundColor: colors.surface },
          headerTitleStyle: { fontFamily: fonts.serifSemiBold, color: colors.textBright },
          headerTintColor: colors.accent,
        }}
      />

      {isEmpty ? (
        <View style={s.empty}>
          <Text style={s.emptyText}>All caught up</Text>
          <Text style={s.emptySubtext}>
            No place suggestions to review. New ones appear here after a photo scan.
          </Text>
        </View>
      ) : (
        <SectionList
          style={{ flex: 1, backgroundColor: colors.bg }}
          contentContainerStyle={{ paddingBottom: spacing["3xl"] }}
          sections={sections}
          keyExtractor={(rg) => `${rg.country ?? "?"}:${rg.region}`}
          renderSectionHeader={({ section }) => {
            const expanded = !expandedCountries.has(section.country);
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
                  <Text style={s.countryCount}>
                    {section.unreviewedCount} to review
                  </Text>
                </View>
                <Pressable onPress={(e) => e.stopPropagation()}>
                  <ActionButtons
                    onKeep={() => hub.keepCountry(section.country)}
                    onHide={() => hub.hideCountry(section.country)}
                    colors={colors}
                    fonts={fonts}
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
                onPlacePress={(id) => router.push(`/staging/place/${id}` as any)}
                onKeepPlace={(id) => hub.keepPlace(id)}
                onHidePlace={(id) => hub.hidePlace(id)}
                onKeepRegion={(name) => hub.keepRegion(name)}
                onHideRegion={(name) => hub.hideRegion(name)}
                colors={colors}
                fonts={fonts}
                s={s}
              />
            );
          }}
        />
      )}
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function styles(
  colors: ReturnType<typeof useTheme>["colors"],
  fonts: ReturnType<typeof useTheme>["fonts"],
) {
  return StyleSheet.create({
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
    badge: {
      borderRadius: 8,
      paddingHorizontal: 6,
      paddingVertical: 2,
    },
    badgeText: {
      fontSize: 12,
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
    placeInfo: {
      flex: 1,
      paddingRight: spacing.sm,
    },
    placeRight: {
      flexDirection: "row",
      alignItems: "center",
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
