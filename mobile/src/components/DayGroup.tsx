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
 *
 * Accepts `colors` and `fonts` as props so it is safe inside FlatList
 * renderItem without calling useTheme() per row.
 */
import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { type Entry, type Note } from "@chronicle/journal/types";
import { type ThemeColors, type ThemeFonts, text as textScale, spacing as spacingScale } from "./ThemeProvider";
import { EntryRow } from "./EntryRow";
import { DateColumn } from "./DateColumn";

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
export function DayGroup({ group, colors, fonts, onEntryPress, showReflection = true }: DayGroupProps) {
  const styles = useMemo(() => createStyles(colors, fonts), [colors, fonts]);

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

        {/* Entry rows with hairline separators */}
        {group.items.map((entry, idx) => (
          <React.Fragment key={entry.id}>
            {idx > 0 && <View style={styles.separator} />}
            <EntryRow
              entry={entry}
              colors={colors}
              fonts={fonts}
              onPress={() => onEntryPress(entry)}
            />
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
