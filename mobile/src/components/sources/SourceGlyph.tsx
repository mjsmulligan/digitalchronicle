/**
 * SourceGlyph: the circular icon for a source. Uses the brand mark when one
 * exists for `markId`, otherwise an Ionicons glyph in the theme accent.
 */
import React from "react";
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { sourceMark } from "@chronicle/journal/connectors/icons";
import { SourceMark } from "../SourceMark";
import { useTheme } from "../ThemeProvider";

export function SourceGlyph({
  markId,
  glyph,
  size = 40,
}: {
  markId?: string;
  glyph: string;
  /** Diameter of the circle in dp. */
  size?: number;
}) {
  const { colors } = useTheme();
  const hasMark = markId !== undefined && sourceMark(markId) !== undefined;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.surfaceAccent,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {hasMark ? (
        <SourceMark source={markId!} size={Math.round(size * 0.6)} />
      ) : (
        <Ionicons
          name={glyph as React.ComponentProps<typeof Ionicons>["name"]}
          size={Math.round(size * 0.5)}
          color={colors.accent}
        />
      )}
    </View>
  );
}
