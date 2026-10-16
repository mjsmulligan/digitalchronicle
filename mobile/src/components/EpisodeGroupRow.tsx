/**
 * EpisodeGroupRow — collapsed/expandable group of episodes from the same series.
 *
 * Shown in the Chronicle feed when a day contains 2+ episodes from the same
 * series. Displays the series name with an episode count and a chevron; tapping
 * expands to show individual episode rows (indented under the header).
 *
 * Single-episode days continue to render as a plain EntryRow (handled by DayGroup).
 */
import React, { useState, useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { type Episode, type Entry } from "@chronicle/journal/types";
import {
  type ThemeColors,
  type ThemeFonts,
  text as textScale,
  spacing as spacingScale,
} from "./ThemeProvider";
import { KindIcon } from "./KindIcon";
import { EntryRow } from "./EntryRow";

// ── styles ────────────────────────────────────────────────────────────────────

function createStyles(colors: ThemeColors, fonts: ThemeFonts) {
  return StyleSheet.create({
    // Group header row (the collapsed/toggle row)
    header: {
      flexDirection: "row",
      alignItems: "flex-start",
      paddingVertical: spacingScale.md,
      gap: spacingScale.sm,
    },
    headerPressed: { opacity: 0.55 },

    iconWrap: {
      width: 20,
      height: 20,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 2,
      flexShrink: 0,
    },

    body: { flex: 1, minWidth: 0 },

    title: {
      ...textScale.feedTitle,
      fontFamily: fonts.serifMedium,
      color: colors.textPrimary,
      fontWeight: "500",
    },

    subtitle: {
      ...textScale.sm,
      fontFamily: fonts.sans,
      color: colors.textTertiary,
      marginTop: 2,
    },

    // "TV" label + chevron share the trailing slot
    trailing: {
      flexDirection: "column",
      alignItems: "flex-end",
      gap: 4,
      flexShrink: 0,
      marginTop: 3,
    },

    label: {
      fontSize: 10,
      fontFamily: fonts.mono,
      fontWeight: "700",
      letterSpacing: 0.8,
      textTransform: "uppercase" as const,
      color: colors.textTertiary,
    },

    // Expanded episode list — indented to align body text with the header body
    episodeList: {
      // icon width (20) + gap (spacingScale.sm) = left indent of header body
      paddingLeft: 20 + spacingScale.sm,
      // left accent line to visually group the episodes under their series
      borderLeftWidth: 1,
      borderLeftColor: colors.borderFaint,
      marginLeft: 10, // center the border roughly under the icon
    },

    separator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
    },
  });
}

// ── helpers ───────────────────────────────────────────────────────────────────

/** Build a readable subtitle for the group header: season info + episode count. */
function groupSubtitle(episodes: Episode[]): string {
  const seasons = [...new Set(episodes.map((e) => e.season).filter(Boolean))];
  const seasonStr =
    seasons.length === 1
      ? (seasons[0] as string)
      : seasons.length > 1
      ? `${seasons[0]} – ${seasons[seasons.length - 1]}`
      : null;
  const count = episodes.length;
  const countStr = `${count} episode${count === 1 ? "" : "s"}`;
  return [seasonStr, countStr].filter(Boolean).join(" · ");
}

// ── component ─────────────────────────────────────────────────────────────────

export interface EpisodeGroupRowProps {
  episodes: Episode[];
  showTitle: string;
  colors: ThemeColors;
  fonts: ThemeFonts;
  onEntryPress: (entry: Entry) => void;
}

export function EpisodeGroupRow({
  episodes,
  showTitle,
  colors,
  fonts,
  onEntryPress,
}: EpisodeGroupRowProps) {
  const [expanded, setExpanded] = useState(false);
  const styles = useMemo(() => createStyles(colors, fonts), [colors, fonts]);
  const subtitle = useMemo(() => groupSubtitle(episodes), [episodes]);

  return (
    <View>
      {/* ── Group header — tap to toggle ─────────────────────────────────── */}
      <Pressable
        style={({ pressed }) => [styles.header, pressed && styles.headerPressed]}
        onPress={() => setExpanded((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={`${showTitle}, ${episodes.length} episodes, ${expanded ? "collapse" : "expand"}`}
      >
        {/* Leading icon */}
        <View style={styles.iconWrap}>
          <KindIcon
            kind="episode"
            size={18}
            color={colors.textTertiary}
            accessibilityLabel=""
          />
        </View>

        {/* Series title + season/count */}
        <View style={styles.body}>
          <Text style={styles.title} numberOfLines={2}>
            {showTitle}
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>

        {/* Trailing: "TV" label + chevron */}
        <View style={styles.trailing}>
          <Text style={styles.label}>TV</Text>
          <Ionicons
            name={expanded ? "chevron-up" : "chevron-down"}
            size={13}
            color={colors.textTertiary}
          />
        </View>
      </Pressable>

      {/* ── Expanded episode list ────────────────────────────────────────── */}
      {expanded && (
        <View style={styles.episodeList}>
          {episodes.map((ep, idx) => (
            <React.Fragment key={ep.id}>
              {idx > 0 && <View style={styles.separator} />}
              <EntryRow
                entry={ep as Entry}
                colors={colors}
                fonts={fonts}
                onPress={() => onEntryPress(ep as Entry)}
              />
            </React.Fragment>
          ))}
        </View>
      )}
    </View>
  );
}
