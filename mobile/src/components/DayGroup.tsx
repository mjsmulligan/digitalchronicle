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
 * - "+ reflection for this day" prompt at the bottom; shows serif italic
 *   text when a reflection already exists. Tapping enters inline edit mode.
 *
 * Accepts `colors` and `fonts` as props so it is safe inside FlatList
 * renderItem without calling useTheme() per row.
 */
import React, { useState } from "react";
import { StyleSheet, Text, TextInput, View, Pressable } from "react-native";
import { type Entry, type Note, uid } from "@chronicle/journal/types";
import { putMany } from "@chronicle/journal/db";
import { type ThemeColors, type ThemeFonts, text as textScale, spacing as spacingScale } from "./ThemeProvider";
import { EntryRow } from "./EntryRow";

// ── helpers ───────────────────────────────────────────────────────────────────

const MONTHS_SHORT = ["JAN","FEB","MAR","APR","MAY","JUN",
                      "JUL","AUG","SEP","OCT","NOV","DEC"];
const DAYS_SHORT   = ["SUN","MON","TUE","WED","THU","FRI","SAT"];

function parseDay(iso: string) {
  // Noon to avoid DST edge-cases shifting the date
  const d = new Date(iso + "T12:00:00");
  return {
    num:   d.getDate().toString(),
    day:   DAYS_SHORT[d.getDay()],
    month: MONTHS_SHORT[d.getMonth()],
    year:  d.getFullYear().toString(),
  };
}

// ── styles ────────────────────────────────────────────────────────────────────

const DATE_COL_W = 52;

function createStyles(colors: ThemeColors, fonts: ThemeFonts) {
  return StyleSheet.create({
    // Outer row: date column + rule + entries column
    outer: {
      flexDirection: "row",
      paddingHorizontal: spacingScale.base,
      paddingTop: spacingScale.xl,
      paddingBottom: spacingScale.md,
    },

    // Date column
    dateCol: {
      width: DATE_COL_W,
      alignItems: "flex-end",
      paddingTop: 2,
      flexShrink: 0,
    },
    dateNum: {
      fontFamily: fonts.serifBold,
      fontWeight: "700",
      ...textScale.dayNum,
      color: colors.textBright,
    },
    dateSub: {
      fontFamily: fonts.mono,
      fontSize: 10,
      fontWeight: "700",
      letterSpacing: 0.8,
      color: colors.textTertiary,
      lineHeight: 15,
      textTransform: "uppercase" as const,
    },

    // Vertical rule between date and entries
    rule: {
      width: StyleSheet.hairlineWidth,
      alignSelf: "stretch",
      backgroundColor: colors.border,
      marginHorizontal: spacingScale.md,
      marginTop: 4,
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

    // Reflection line
    reflectPrompt: {
      ...textScale.sm,
      fontFamily: fonts.sans,
      color: colors.textTertiary,
      paddingVertical: spacingScale.md,
    },
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

    // Inline reflection editor
    reflectInput: {
      ...textScale.base,
      fontFamily: fonts.serifMedium,
      fontStyle: "italic",
      color: colors.textPrimary,
      borderLeftWidth: 2,
      borderLeftColor: colors.accent,
      paddingLeft: spacingScale.md,
      paddingTop: spacingScale.md,
      paddingBottom: spacingScale.sm,
      minHeight: 60,
      textAlignVertical: "top" as const,
    },
    reflectActions: {
      flexDirection: "row" as const,
      gap: spacingScale.sm,
      paddingBottom: spacingScale.sm,
    },
    reflectSave: {
      paddingHorizontal: spacingScale.md,
      paddingVertical: spacingScale.sm2,
      backgroundColor: colors.accent,
      borderRadius: 6,
    },
    reflectSaveText: {
      ...textScale.sm,
      fontFamily: fonts.sansMedium ?? fonts.sans,
      fontWeight: "600",
      color: colors.accentBadge,
    },
    reflectCancel: {
      paddingHorizontal: spacingScale.md,
      paddingVertical: spacingScale.sm2,
    },
    reflectCancelText: {
      ...textScale.sm,
      fontFamily: fonts.sans,
      color: colors.textTertiary,
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
  /** Called when the user taps the reflection prompt. Wired up in WP1.10. */
  onReflectionPress?: (iso: string) => void;
  /**
   * Whether to show the reflection note / "+ reflection for this day" prompt.
   * Default `true` — Chronicle shows it. Culture, Trips, People pass `false`.
   */
  showReflection?: boolean;
}

/**
 * Renders one day in the journal feed.
 * Designed to be the renderItem of a FlatList where each item is one day.
 */
export function DayGroup({ group, colors, fonts, onEntryPress, onReflectionPress, showReflection = true }: DayGroupProps) {
  const { num, day, month, year } = parseDay(group.iso);
  const styles = createStyles(colors, fonts);

  // ── inline reflection editor state ────────────────────────────────────────
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  function startEditing() {
    setDraft(group.note?.text ?? "");
    setEditing(true);
    onReflectionPress?.(group.iso);
  }

  async function saveReflection() {
    const trimmed = draft.trim();
    if (!trimmed) {
      setEditing(false);
      return;
    }
    const t = new Date().toISOString();
    await putMany("notes", [{
      id: group.note?.id ?? uid(),
      date: group.iso,
      text: trimmed,
      createdAt: group.note?.createdAt ?? t,
      updatedAt: t,
    }]);
    setEditing(false);
  }

  function cancelEditing() {
    setEditing(false);
    setDraft("");
  }

  return (
    <View style={styles.outer}>
      {/* Date column */}
      <View style={styles.dateCol}>
        <Text style={styles.dateNum}>{num}</Text>
        <Text style={styles.dateSub}>{day}</Text>
        <Text style={styles.dateSub}>{month}</Text>
        <Text style={styles.dateSub}>{year}</Text>
      </View>

      {/* Vertical spine rule */}
      <View style={styles.rule} />

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

        {/* Reflection: inline editor, existing note, or "+ reflection" prompt.
            Culture / Trips / People pass showReflection=false to hide entirely. */}
        {showReflection && (
          editing ? (
            <>
              <TextInput
                multiline
                autoFocus
                value={draft}
                onChangeText={setDraft}
                style={styles.reflectInput}
                placeholder="How was the day?"
                placeholderTextColor={colors.textTertiary}
              />
              <View style={styles.reflectActions}>
                <Pressable onPress={saveReflection} style={styles.reflectSave}>
                  <Text style={styles.reflectSaveText}>Save</Text>
                </Pressable>
                <Pressable onPress={cancelEditing} style={styles.reflectCancel}>
                  <Text style={styles.reflectCancelText}>Cancel</Text>
                </Pressable>
              </View>
            </>
          ) : group.note ? (
            <Pressable onPress={startEditing}>
              <Text style={styles.reflectText}>{group.note.text}</Text>
            </Pressable>
          ) : (
            <Pressable onPress={startEditing}>
              <Text style={styles.reflectPrompt}>+ reflection for this day</Text>
            </Pressable>
          )
        )}
      </View>
    </View>
  );
}
