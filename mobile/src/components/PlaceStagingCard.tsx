/**
 * PlaceStagingCard — review pending photo-library place suggestions.
 *
 * Shows a collapsible country → region → place hierarchy with a Switch per
 * place. The user selects which suggestions to accept, then commits them.
 * While committing, the card collapses to a slim animated progress bar
 * (same pattern as BatchReview).
 */
import React, { useMemo, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { type ThemeColors, type ThemeFonts, spacing } from "./ThemeProvider";
import { useStagingHub, type CountryGroup, type RegionGroup } from "../lib/exif/useStagingHub";
import { ReviewPanel } from "./ReviewPanel";

// ── helpers ───────────────────────────────────────────────────────────────────

const PSC_MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function pscFmtDay(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  return `${d.getDate()} ${PSC_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function pscPluralDays(n: number): string {
  return n === 1 ? "1 day" : `${n} days`;
}

function pscRegionIds(rg: RegionGroup): string[] {
  return rg.places.filter((pg) => pg.pending.length > 0).map((pg) => pg.place.id);
}

function pscCountryIds(cg: CountryGroup): string[] {
  return cg.regions.flatMap(pscRegionIds);
}

// ── component ─────────────────────────────────────────────────────────────────

export interface PlaceStagingCardProps {
  hub: ReturnType<typeof useStagingHub>;
  router: ReturnType<typeof useRouter>;
  onConfirm: (title: string, msg: string, cta: string, fn: () => void) => void;
  colors: ThemeColors;
  fonts: ThemeFonts;
}

export function PlaceStagingCard({
  hub,
  router,
  onConfirm,
  colors,
  fonts,
}: PlaceStagingCardProps) {
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
    setDeselected((prev) => {
      const s = new Set(prev);
      next ? s.delete(id) : s.add(id);
      return s;
    });

  const toggleGroup = (ids: string[], next: boolean) =>
    setDeselected((prev) => {
      const s = new Set(prev);
      ids.forEach((id) => (next ? s.delete(id) : s.add(id)));
      return s;
    });

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

  return (
    <ReviewPanel
      title="Photo library suggestions"
      meta={`${allPendingIds.size} pending · ${selectedCount} selected`}
      onDiscard={handleDiscardAll}
      bulkActions={[
        { label: `Select all (${allPendingIds.size})`, onPress: () => setDeselected(new Set()) },
        { label: "Deselect all", onPress: () => setDeselected(new Set(allPendingIds)) },
      ]}
      commitLabel={`Accept ${selectedCount} ${selectedCount === 1 ? "place" : "places"} to journal`}
      onCommit={handleCommit}
      commitDisabled={!selectedCount}
      committing={!!commitProg}
      commitDone={commitProg?.done}
      commitTotal={commitProg?.total}
      colors={colors}
      fonts={fonts}
    >
      {/* Hierarchy */}
      {hub.hierarchy
        .filter((cg) => cg.pendingCount > 0)
        .map((cg) => {
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
                <Text
                  style={[
                    pscS.countryName,
                    { color: colors.textBright, fontFamily: fonts.serifSemiBold },
                  ]}
                >
                  {cg.country}
                </Text>
                <Text style={[pscS.badge, { color: colors.textMuted }]}>
                  {cg.pendingCount}
                </Text>
                <Pressable
                  onPress={(e) => e.stopPropagation()}
                  style={{ marginLeft: "auto" }}
                >
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
                cg.regions
                  .filter((rg) => rg.pendingCount > 0)
                  .map((rg) => {
                    const rIds = pscRegionIds(rg);
                    const regionOn = rIds.some((id) => !deselected.has(id));
                    const rKey = `${cg.country}:${rg.region}`;
                    const rExpanded = !collapsedRegions.has(rKey);
                    return (
                      <View key={rg.region}>
                        {/* Region row */}
                        <Pressable
                          style={[
                            pscS.regionRow,
                            {
                              backgroundColor: colors.surfaceMuted,
                              borderTopColor: colors.borderFaint,
                            },
                          ]}
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
                          <Text
                            style={[
                              pscS.regionName,
                              {
                                color: colors.textSecondary,
                                fontFamily: fonts.sansMedium ?? fonts.sans,
                              },
                            ]}
                          >
                            {rg.region}
                          </Text>
                          <View
                            style={[
                              pscS.regionCountBadge,
                              { backgroundColor: colors.surfaceAccent },
                            ]}
                          >
                            <Text
                              style={[pscS.regionCountText, { color: colors.accent }]}
                            >
                              {rg.pendingCount}
                            </Text>
                          </View>
                          <Pressable
                            onPress={(e) => e.stopPropagation()}
                            style={{ marginLeft: "auto" }}
                          >
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
                          rg.places
                            .filter((pg) => pg.pending.length > 0)
                            .map((pg) => {
                              const isOn = !deselected.has(pg.place.id);
                              const days = pg.pending.map((e) => e.localDay).sort();
                              const dateLabel =
                                days.length === 1
                                  ? pscFmtDay(days[0])
                                  : `${pscFmtDay(days[0])} – ${pscFmtDay(days[days.length - 1])}`;
                              return (
                                <View
                                  key={pg.place.id}
                                  style={[
                                    pscS.placeRow,
                                    { borderTopColor: colors.borderFaint },
                                  ]}
                                >
                                  <Pressable
                                    style={{ flex: 1, paddingRight: spacing.sm }}
                                    onPress={() =>
                                      pg.pending.length > 1 &&
                                      router.push(
                                        `/staging/place/${pg.place.id}` as any,
                                      )
                                    }
                                  >
                                    <Text
                                      style={[
                                        pscS.placeName,
                                        {
                                          color: colors.textPrimary,
                                          fontFamily: fonts.serifSemiBold,
                                        },
                                      ]}
                                    >
                                      {pg.place.locality}
                                    </Text>
                                    <Text
                                      style={[
                                        pscS.placeMeta,
                                        { color: colors.textMuted },
                                      ]}
                                    >
                                      {pscPluralDays(pg.pending.length)} · {dateLabel}
                                    </Text>
                                    {pg.pending.length > 1 && (
                                      <Text
                                        style={{
                                          fontSize: 11,
                                          color: colors.accent,
                                          marginTop: 1,
                                        }}
                                      >
                                        Tap for per-day review
                                      </Text>
                                    )}
                                  </Pressable>
                                  <Switch
                                    value={isOn}
                                    onValueChange={(next) =>
                                      togglePlace(pg.place.id, next)
                                    }
                                    trackColor={{
                                      true: colors.accent,
                                      false: colors.border,
                                    }}
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
    </ReviewPanel>
  );
}

// ── styles ────────────────────────────────────────────────────────────────────

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
