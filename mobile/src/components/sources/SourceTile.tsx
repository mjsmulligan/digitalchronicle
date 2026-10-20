/**
 * SourceTile: one thumb-size tile in the "Add a source" grid
 * (docs/specs/sources-page.md, section 4.2).
 *
 * Connect tiles show their state with a corner badge and caption. File tiles
 * carry no state: tapping one is always "pick a file now".
 */
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme, spacing, radius } from "../ThemeProvider";
import { SourceGlyph } from "./SourceGlyph";
import type { TileDef, SourceViewState } from "../../lib/sourceRegistry";

export interface SourceTileProps {
  tile: TileDef;
  /** Connect tiles only: undefined when the source is not connected. */
  connectedState?: SourceViewState;
  /** A file import started from this tile is running. */
  busy?: boolean;
  disabled?: boolean;
  width: number;
  onPress: () => void;
  /** Receives the tile's host view so a sheet can return screen reader focus to it. */
  openerRef?: (ref: View | null) => void;
}

function captionFor(tile: TileDef, state?: SourceViewState): string {
  if (tile.kind === "file") return tile.caption;
  if (state === undefined) return tile.caption;
  if (state === "attention") return "Needs attention";
  if (state === "paused") return "Paused";
  return "Connected";
}

function a11yLabel(tile: TileDef, state?: SourceViewState): string {
  if (tile.kind === "file") {
    return tile.connector
      ? `${tile.label}, import a file, double tap to choose a file`
      : "Any file, double tap to choose a file";
  }
  if (state === undefined) return `${tile.label}, not connected, double tap to connect`;
  if (state === "attention") return `${tile.label}, needs attention, double tap to manage`;
  return `${tile.label}, connected, double tap to manage`;
}

export function SourceTile({
  tile, connectedState, busy, disabled, width, onPress, openerRef,
}: SourceTileProps) {
  const { colors, fonts } = useTheme();
  const isAny = tile.kind === "file" && tile.connector === undefined;
  const attention = connectedState === "attention";
  const connected = tile.kind === "connect" && connectedState !== undefined;

  return (
    <Pressable
      ref={openerRef}
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel(tile, connectedState)}
      accessibilityState={{ disabled: !!disabled, busy: !!busy }}
      style={({ pressed }) => [
        s.tile,
        {
          width,
          backgroundColor: pressed ? colors.surfacePressed : colors.surface,
          borderColor: attention ? colors.error : colors.borderFaint,
          borderStyle: isAny ? "dashed" : "solid",
          opacity: disabled && !busy ? 0.5 : 1,
        },
      ]}
    >
      {connected && (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[
            s.badge,
            { backgroundColor: attention ? colors.error : colors.accentBold },
          ]}
        >
          {attention ? (
            <Text style={[s.bang, { color: colors.white }]}>!</Text>
          ) : (
            <Ionicons name="checkmark" size={12} color={colors.white} />
          )}
        </View>
      )}

      {busy ? (
        <View style={s.busy}><ActivityIndicator color={colors.accent} /></View>
      ) : (
        <SourceGlyph markId={tile.markId} glyph={tile.glyph} size={44} />
      )}

      <Text
        numberOfLines={2}
        style={[s.name, { color: colors.textPrimary, fontFamily: fonts.sansMedium ?? fonts.sans }]}
      >
        {tile.label}
      </Text>
      <Text
        numberOfLines={2}
        style={[s.caption, { color: attention ? colors.error : colors.textMuted }]}
      >
        {busy ? "Importing" : captionFor(tile, connectedState)}
      </Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  tile: {
    minHeight: 112,
    borderRadius: radius["2xl"],
    borderWidth: 1,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
  },
  busy: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  name: { fontSize: 14, fontWeight: "600", textAlign: "center" },
  caption: { fontSize: 12, textAlign: "center" },
  badge: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  bang: { fontSize: 13, fontWeight: "700", lineHeight: 16 },
});
