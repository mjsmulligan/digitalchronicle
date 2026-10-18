/**
 * DayGroup — one calendar day in the journal feed.
 *
 * Design (spec 7.1):
 *
 *   +--------+--+---------------------------------------------+
 *   |   20   |  |  ✦ DÜSSELDORF · SEPT 2026   (trip label)  |
 *   |  SUN   |  |  [mark] Köln → DUB                 FLIGHT  |
 *   |  SEPT  |  |         FR4500                             |
 *   |  2026  |  |  ────────────────────────────────────────  |
 *   |        |  |  [mark] Oppenheimer (2023)           FILM  |
 *   |        |  |  ────────────────────────────────────────  |
 *   |        |  |  + reflection for this day                 |
 *   +--------+--+---------------------------------------------+
 *
 * - 52dp date column: serif day number + mono weekday/month/year caps.
 * - Hairline vertical rule separates date column from entry column.
 * - Optional trip label (mono, accentSoft) above the rows.
 * - EntryRow items separated by hairlines (spec: rows, not cards).
 * - 2+ episodes from the same series on a day are collapsed into an
 *   EpisodeGroupRow (expandable) to reduce clutter.
 *
 * Accepts `colors` and `fonts` as props so it is safe inside FlatList
 * renderItem without calling useTheme() per row.
 */
import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { type Entry, type Episode, type Note } from "@chronicle/journal/types";
import { type ThemeColors, type ThemeFonts, text as textScale, spacing as spacingScale } from "./ThemeProvider";
import { EntryRow } from "./EntryRow";
import { EpisodeGroupRow } from "./EpisodeGroupRow";
import { DateColumn } from "./DateColumn";

// ── episode grouping ──────────────────────────────────────────────────────────

/**
 * A row item in the rendered entry list.
 * Regular entries render as EntryRow; episode groups (2+ episodes from the
 * same series on the same day) render as a collapsible EpisodeGroupRow.
 */
type RowItem =
  | { type: "entry"; entry: Entry; key: string }
  | { type: "episode-group"; showTitle: string; episodes: Episode[]; key: string };

/**
 * Transform a flat entry array into renderable row items, collapsing episode
 * runs of 2+ from the same series into a single EpisodeGroupRow.
 * Order within the list is preserved (the group appears at the position of the
 * first episode from that series).
 */
function buildRowItems(items: Entry[]): RowItem[] {
  // Collect all episodes per series key (seriesId preferred, showTitle fallback)
  const episodeMap = new Map<string, Episode[]>();
  for (const entry of items) {
    if (entry.kind === "episode") {
      const ep = entry as Episode;
      const key = ep.seriesId ?? ep.showTitle;
      if (!episodeMap.has(key)) episodeMap.set(key, []);
      episodeMap.get(key)!.push(ep);
    }
  }

  // Walk the original order, emitting groups once and skipping their members
  const emittedGroups = new Set<string>();
  const result: RowItem[] = [];

  for (const entry of items) {
    if (entry.kind === "episode") {
      const ep = entry as Episode;
      const groupKey = ep.seriesId ?? ep.showTitle;
      const group = episodeMap.get(groupKey)!;

      if (group.length >= 2) {
        // Only emit the group once (at the position of the first episode)
        if (!emittedGroups.has(groupKey)) {
          emittedGroups.add(groupKey);
          result.push({
            type: "episode-group",
            showTitle: ep.showTitle,
            episodes: group,
            key: `epgroup-${groupKey}`,
          });
        }
      } else {
        // Single episode — render as a normal row
        result.push({ type: "entry", entry, key: entry.id });
      }
    } else {
      result.push({ type: "entry", entry, key: entry.id });
    }
  }

  return result;
}

// ── styles ────────────────────────────────────────────────────────────────────

function createStyles(colors: ThemeColors, fonts: ThemeFonts) {
  return StyleSheet.create({
    // Outer row: date column + rule + entries column
    outer: {
      flexDirection: "row",
      paddingHorizontal: spacingScale.base,
      paddingTop: spacingScale.xl,
      paddingBottom: spacingScale.md,
    },

    // Entries column
    entriesCol: { flex: 1 },

    // Optional trip label above entries
    tripLabel: {
      ...textScale.xs,
      fontFamily: fonts.mono,
      fontWeight: "700",
      letterSpacing: 0.8,
      textTransform: "uppercase" as const,
      color: colors.accentSoft,
      marginBottom: spacingScale.sm,
    },

    // Hairline between rows
    separator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
    },

    // Legacy day-level note display (read-only; no new composition)
    reflectText: {
      ...textScale.base,
      fontFamily: fonts.serifMedium,
      color: colors.textPrimary,
      fontStyle: "italic",
      paddingTop: spacingScale.md,
      paddingBottom: spacingScale.sm,
      borderLeftWidth: 2,
      borderLeftColor: colors.accentSoft,
      paddingLeft: spacingScale.md,
    },
  });
}

// ── component ─────────────────────────────────────────────────────────────────

export interface DayGroupData {
  iso: string;
  /** Trip whose date range contains this day (resolved by the parent). */
  tripTitle?: string;
  items: Entry[];
  /** Day-level reflection note, if one exists for this date. */
  note?: Note;
}

export interface DayGroupProps {
  group: DayGroupData;
  colors: ThemeColors;
  fonts: ThemeFonts;
  onEntryPress: (entry: Entry) => void;
  /** Called when the user long-presses an entry row (used for quick Keep/Hide). */
  onEntryLongPress?: (entry: Entry) => void;
  /**
   * Whether to show any legacy day-level note text (read-only).
   * Default `true` — Chronicle shows it. Culture, Trips, People pass `false`.
   */
  showReflection?: boolean;
}

/**
 * Renders one day in the journal feed.
 * Designed to be the renderItem of a FlatList where each item is one day.
 */
export function DayGroup({ group, colors, fonts, onEntryPress, onEntryLongPress, showReflection = true }: DayGroupProps) {
  const styles = useMemo(() => createStyles(colors, fonts), [colors, fonts]);
  const rowItems = useMemo(() => buildRowItems(group.items), [group.items]);

  return (
    <View style={styles.outer}>
      {/* Date column + rule */}
      <DateColumn iso={group.iso} colors={colors} fonts={fonts} align="flex-end" />

      {/* Entries column */}
      <View style={styles.entriesCol}>
        {/* Optional trip label */}
        {group.tripTitle ? (
          <Text style={styles.tripLabel}>{"✦ "}{group.tripTitle}</Text>
        ) : null}

        {/* Entry rows — episodes from the same series are collapsed into a group */}
        {rowItems.map((item, idx) => (
          <React.Fragment key={item.key}>
            {idx > 0 && <View style={styles.separator} />}
            {item.type === "entry" ? (
              <EntryRow
                entry={item.entry}
                colors={colors}
                fonts={fonts}
                onPress={() => onEntryPress(item.entry)}
                onLongPress={onEntryLongPress ? () => onEntryLongPress(item.entry) : undefined}
              />
            ) : (
              <EpisodeGroupRow
                showTitle={item.showTitle}
                episodes={item.episodes}
                colors={colors}
                fonts={fonts}
                onEntryPress={onEntryPress}
              />
            )}
          </React.Fragment>
        ))}

        {/* Legacy day-level note — read-only display only (no new composition).
            Reflections now belong to entries, not calendar days. */}
        {showReflection && group.note && (
          <Text style={styles.reflectText}>{group.note.text}</Text>
        )}
      </View>
    </View>
  );
}
