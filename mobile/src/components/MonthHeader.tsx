/**
 * MonthHeader — a full-width section divider shown in the Chronicle feed
 * whenever the month changes.
 *
 * Layout:
 *   OCTOBER · 2026         [✈ 3]  [🎬 8]  [📺 22]  [🎵 1]
 *
 * Left: month + year in mono uppercase.
 * Right: a scrollable row of KindIcon + count bubbles summarising what
 *        happened during the month (computed by the parent and passed in).
 *
 * Accepts `colors` and `fonts` as props so it is safe inside a FlatList
 * renderItem without calling useTheme() per item.
 */
import React, { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import {
  type ThemeColors,
  type ThemeFonts,
  text as textScale,
  spacing as spacingScale,
} from "./ThemeProvider";
import { KindIcon } from "./KindIcon";

// ── types (re-exported for use in index.tsx) ──────────────────────────────────

export interface IconCount {
  /** Entry kind, e.g. "leg", "film", "event". */
  kind: string;
  /** Subkind, e.g. "air", "concert". Undefined for kinds without subkinds. */
  subkind?: string;
  /** Total entries of this kind in the month (after any active filters). */
  count: number;
}

// ── styles ────────────────────────────────────────────────────────────────────

function createStyles(colors: ThemeColors, fonts: ThemeFonts) {
  return StyleSheet.create({
    // Full-width surface strip — visually separates months
    container: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: spacingScale.base,
      paddingVertical: spacingScale.sm2,
      backgroundColor: colors.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderFaint,
      gap: spacingScale.md,
    },

    // "OCTOBER · 2026"
    monthLabel: {
      ...textScale.xs,
      fontFamily: fonts.mono,
      fontWeight: "700",
      letterSpacing: 1,
      textTransform: "uppercase" as const,
      color: colors.textSecondary,
      flexShrink: 0,
    },

    // Scrollable icon strip
    iconScroll: {
      flex: 1,
    },
    iconScrollContent: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacingScale.md,
      justifyContent: "flex-end",
    },

    // One icon + count pair
    iconItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: 3,
    },
    countText: {
      fontSize: 10,
      fontFamily: fonts.mono,
      color: colors.textTertiary,
      lineHeight: 14,
    },
  });
}

// ── component ─────────────────────────────────────────────────────────────────

export interface MonthHeaderProps {
  /** Full label string, e.g. "OCTOBER · 2026". */
  label: string;
  /** Pre-computed icon+count pairs for this month, sorted by count desc. */
  iconCounts: IconCount[];
  colors: ThemeColors;
  fonts: ThemeFonts;
}

export function MonthHeader({ label, iconCounts, colors, fonts }: MonthHeaderProps) {
  const styles = useMemo(() => createStyles(colors, fonts), [colors, fonts]);

  return (
    <View style={styles.container}>
      <Text style={styles.monthLabel}>{label}</Text>

      {iconCounts.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.iconScroll}
          contentContainerStyle={styles.iconScrollContent}
        >
          {iconCounts.map((ic) => (
            <View key={`${ic.kind}-${ic.subkind ?? ""}`} style={styles.iconItem}>
              <KindIcon
                kind={ic.kind}
                subkind={ic.subkind}
                size={13}
                color={colors.textTertiary}
                accessibilityLabel=""
              />
              <Text style={styles.countText}>{ic.count}</Text>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
