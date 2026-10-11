/**
 * DateColumn — the 52dp left column used in every two-column list row.
 *
 * Renders the day number (large serif), weekday, month and year (small mono
 * caps) plus the hairline vertical rule that separates the date from the
 * right-hand content column.
 *
 * Used by: DayGroup (Chronicle), TripRow (Trips tab),
 *          EntryDayGroup and SuggestionDayGroup (Trip detail).
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { type ThemeColors, type ThemeFonts, text as textScale, spacing as spacingScale } from "./ThemeProvider";
import { parseDay } from "../lib/dateHelpers";

export const DATE_COL_W = 52;

interface DateColumnProps {
  iso: string;
  colors: ThemeColors;
  fonts: ThemeFonts;
  /** Alignment of text within the date column. Chronicle uses "flex-end" (right-aligned);
   *  Trips and Trip detail use "center". Defaults to "flex-end". */
  align?: "center" | "flex-end";
  /** Dim the date number (used for suggested/unlinked entries). */
  dim?: boolean;
}

export function DateColumn({ iso, colors, fonts, align = "flex-end", dim = false }: DateColumnProps) {
  const { num, day, month, year } = parseDay(iso);
  const styles = createStyles(colors, fonts, align);

  return (
    <>
      <View style={styles.dateCol}>
        <Text style={[styles.dateNum, dim && styles.dateNumDim]}>{num}</Text>
        <Text style={styles.dateSub}>{day}</Text>
        <Text style={styles.dateSub}>{month}</Text>
        <Text style={styles.dateSub}>{year}</Text>
      </View>
      <View style={styles.rule} />
    </>
  );
}

function createStyles(colors: ThemeColors, fonts: ThemeFonts, align: "center" | "flex-end") {
  return StyleSheet.create({
    dateCol: {
      width: DATE_COL_W,
      alignItems: align,
      paddingTop: 2,
      flexShrink: 0,
    },
    dateNum: {
      fontFamily: fonts.serifBold,
      fontWeight: "700",
      ...textScale.dayNum,
      color: colors.textBright,
    },
    dateNumDim: {
      color: colors.textMuted,
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
    rule: {
      width: StyleSheet.hairlineWidth,
      alignSelf: "stretch",
      backgroundColor: colors.border,
      marginHorizontal: spacingScale.md,
      marginTop: 4,
    },
  });
}
