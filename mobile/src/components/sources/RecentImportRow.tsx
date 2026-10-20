/**
 * RecentImportRow: one run in "Recent imports"
 * (docs/specs/sources-page.md, section 4.3).
 *
 * Actions (Keep all, Import again, Undo import) sit behind a "..." button so
 * the list stays quiet. Undone runs keep their UNDONE label and show no menu.
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme, spacing } from "../ThemeProvider";
import { SourceGlyph } from "./SourceGlyph";
import { tileForRunSource } from "../../lib/sourceRegistry";
import type { ImportRun } from "@chronicle/journal/types";

function runGlyph(source: string): string {
  if (source === "photo-library") return "images-outline";
  if (source === "icalendar") return "calendar-outline";
  if (source === "goodreads") return "book-outline";
  return "document-outline";
}

export function runSummary(run: ImportRun): string {
  const counts = [
    run.added > 0 ? `${run.added} new` : "",
    run.updated > 0 ? `${run.updated} updated` : "",
  ].filter(Boolean).join(", ");
  const skippedTotal = run.skipped.duplicate + run.skipped.inFile;
  const skipped = skippedTotal > 0 ? `${skippedTotal} already in your journal` : "";
  return [counts, skipped].filter(Boolean).join(" · ");
}

export interface RecentImportRowProps {
  run: ImportRun;
  onMenu: () => void;
}

export function RecentImportRow({ run, onMenu }: RecentImportRowProps) {
  const { colors, fonts } = useTheme();
  const tile = tileForRunSource(run.source);
  const undone = run.status === "undone";
  const name = run.trigger === "startup" ? "Automatic" : run.filename;
  const date = new Date(run.startedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const summary = runSummary(run);

  return (
    <View style={[s.row, undone && { opacity: 0.55 }]}>
      <SourceGlyph
        markId={tile?.markId ?? (run.source === "goodreads" ? "goodreads" : undefined)}
        glyph={tile?.glyph ?? runGlyph(run.source)}
        size={36} />
      <View style={s.info}>
        <Text
          numberOfLines={1}
          style={[s.name, { color: colors.textPrimary, fontFamily: fonts.serifMedium }]}
        >
          {name}
        </Text>
        <Text numberOfLines={2} style={[s.sub, { color: colors.textMuted }]}>
          {date}{summary ? ` · ${summary}` : ""}
        </Text>
      </View>
      {undone ? (
        <Text style={[s.undone, { color: colors.textMuted, fontFamily: fonts.mono }]}>UNDONE</Text>
      ) : (
        <Pressable
          onPress={onMenu}
          accessibilityRole="button"
          accessibilityLabel={`Actions for ${name}, ${date}`}
          style={s.menuBtn}
          hitSlop={4}
        >
          <Ionicons name="ellipsis-horizontal" size={20} color={colors.textSecondary} />
        </Pressable>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  row: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.base,
    paddingRight: spacing.xs,
  },
  info: { flex: 1, gap: 1 },
  name: { fontSize: 15 },
  sub: { fontSize: 12, lineHeight: 16 },
  undone: { fontSize: 11, paddingRight: spacing.md },
  menuBtn: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
});
