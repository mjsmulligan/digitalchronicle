/**
 * MonthHeader — a journal chapter-page divider shown in the Chronicle feed
 * whenever the month changes.
 *
 * Design intent: feels like turning to a new section in a Moleskine —
 * a deliberate pen-mark (2px accentSoft top rule), warm surfaceAccentDeep
 * background, and the month name in the app's large serif. The icon tally
 * below reads as a soft marginal note rather than a data dashboard.
 *
 *   ══════════════════════════════════════════  ← 2px accentSoft rule
 *
 *   October · 2026                              ← serifSemiBold, 22px
 *   ✈ 3 · 🎬 8 · 📺 22 · 🎵 1                ← icon tally, textTertiary
 *
 *   ──────────────────────────────────────────  ← hairline borderFaint
 *
 * Accepts `colors` and `fonts` as props so it is safe inside a FlatList
 * renderItem without calling useTheme() per item.
 */
import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
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
    // Chapter-page section block
    container: {
      backgroundColor: colors.surfaceAccentDeep,
      // 2px top rule — deliberate, like a pen line marking the new section
      borderTopWidth: 2,
      borderTopColor: colors.accentSoft,
      // Faint hairline closes the block at the bottom
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderFaint,
      paddingHorizontal: spacingScale.base,
      paddingTop: spacingScale.xl,     // generous breathing room above
      paddingBottom: spacingScale.base, // slightly tighter below — visually anchors text
    },

    // "October · 2026" — large serif heading
    monthLabel: {
      fontFamily: fonts.serifSemiBold,
      ...textScale["3xl"],             // 22px / 30 line-height
      color: colors.textPrimary,
      marginBottom: spacingScale.sm,
    },

    // Icon tally row — wraps gracefully on busy months
    tallyRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: spacingScale.sm,
      marginBottom: spacingScale.sm,
    },

    // Separator between tally groups
    tallySep: {
      ...textScale.xs,
      color: colors.textMuted,
      lineHeight: 16,
    },

    // One icon + count pair
    tallyItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: 3,
    },
    tallyCount: {
      fontSize: 11,
      fontFamily: fonts.mono,
      color: colors.textTertiary,
      lineHeight: 16,
    },
  });
}

// ── component ─────────────────────────────────────────────────────────────────

export interface MonthHeaderProps {
  /** Label string, e.g. "October · 2026" (title-case month, already formatted). */
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
      {/* Section heading */}
      <Text style={styles.monthLabel}>{label}</Text>

      {/* Icon tally — only rendered when there are counted entries */}
      {iconCounts.length > 0 && (
        <View style={styles.tallyRow}>
          {iconCounts.map((ic, i) => (
            <React.Fragment key={`${ic.kind}-${ic.subkind ?? ""}`}>
              {i > 0 && <Text style={styles.tallySep}>·</Text>}
              <View style={styles.tallyItem}>
                <KindIcon
                  kind={ic.kind}
                  subkind={ic.subkind}
                  size={12}
                  color={colors.textTertiary}
                  accessibilityLabel=""
                />
                <Text style={styles.tallyCount}>{ic.count}</Text>
              </View>
            </React.Fragment>
          ))}
        </View>
      )}
    </View>
  );
}
