/**
 * ConnectedRow: one connected source in the "Connected" list
 * (docs/specs/sources-page.md, section 4.1).
 *
 * The row opens the manage sheet. An "attention" row adds one inline action:
 * Reconnect (permission or credential problem) or Retry (anything else).
 * State is always an icon plus a text label, never colour alone.
 */
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme, spacing, radius } from "../ThemeProvider";
import { SourceGlyph } from "./SourceGlyph";
import type { SourceView, TileDef } from "../../lib/sourceRegistry";

export interface ConnectedRowProps {
  tile: TileDef;
  view: SourceView;
  onOpen: () => void;
  onReconnect: () => void;
  onRetry: () => void;
  openerRef?: (ref: View | null) => void;
}

const STATE_LABEL = {
  active: "Active",
  checking: "Checking",
  attention: "Needs attention",
  paused: "Paused",
} as const;

export function ConnectedRow({ tile, view, onOpen, onReconnect, onRetry, openerRef }: ConnectedRowProps) {
  const { colors, fonts } = useTheme();
  const attention = view.state === "attention";
  const stateColor = attention ? colors.error : view.state === "active" ? colors.success : colors.textMuted;

  return (
    <View>
      <Pressable
        ref={openerRef}
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`${tile.label}, ${STATE_LABEL[view.state].toLowerCase()}, ${view.statusLine}, double tap to manage`}
        style={({ pressed }) => [
          s.row,
          { backgroundColor: pressed ? colors.surfacePressed : "transparent" },
        ]}
      >
        <SourceGlyph markId={tile.markId} glyph={tile.glyph} size={40} />
        <View style={s.info}>
          <Text
            numberOfLines={1}
            style={[s.name, { color: colors.textPrimary, fontFamily: fonts.serifSemiBold }]}
          >
            {tile.label}
          </Text>
          <Text numberOfLines={2} style={[s.status, { color: colors.textMuted }]}>
            {view.statusLine}
          </Text>
          <View style={s.stateRow}>
            {view.state === "checking" ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : (
              <Ionicons
                name={
                  attention ? "warning-outline"
                  : view.state === "paused" ? "pause-circle-outline"
                  : "ellipse"
                }
                size={attention || view.state === "paused" ? 14 : 8}
                color={stateColor}
              />
            )}
            <Text style={[s.stateText, { color: stateColor }]}>{STATE_LABEL[view.state]}</Text>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
      </Pressable>

      {attention && (
        <View style={[s.strip, { backgroundColor: colors.errorBg }]}>
          <Text style={[s.stripText, { color: colors.errorLight }]} numberOfLines={2}>
            {view.needsReconnect ? "Access needs to be restored" : "The last check did not finish"}
          </Text>
          <Pressable
            onPress={view.needsReconnect ? onReconnect : onRetry}
            accessibilityRole="button"
            accessibilityLabel={`${view.needsReconnect ? "Reconnect" : "Retry"} ${tile.label}`}
            style={({ pressed }) => [
              s.stripBtn,
              { backgroundColor: colors.error, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Text style={[s.stripBtnText, { color: colors.white }]}>
              {view.needsReconnect ? "Reconnect" : "Retry"}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  row: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingLeft: spacing.base,
    paddingRight: spacing.md,
  },
  info: { flex: 1, gap: 2 },
  name: { fontSize: 16 },
  status: { fontSize: 13, lineHeight: 17 },
  stateRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  stateText: { fontSize: 12, fontWeight: "600" },
  strip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radius.xl,
  },
  stripText: { flex: 1, fontSize: 13, lineHeight: 17 },
  stripBtn: {
    minHeight: 48,
    paddingHorizontal: spacing.base,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  stripBtnText: { fontSize: 14, fontWeight: "600" },
});
