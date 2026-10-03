/**
 * SourceMark — a 20×20 rounded-square brand chip for a known source or operator.
 *
 * Two visual variants, driven by `SourceMarkDef.type`:
 *   "path"  — SVG glyph in the brand hue on a 15 % tinted background.
 *             Used for Netflix, Letterboxd, Goodreads, Viaduct.
 *   "text"  — Short operator label (IATA code / initials) in the brand fg colour
 *             on a solid brand background. Used for airlines and train operators.
 *
 * Returns null for unrecognised sources so callers can fall back to KindIcon.
 */
import React from "react";
import { Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { sourceMark } from "@chronicle/journal/connectors/icons";

export interface SourceMarkProps {
  source: string;
  /** Overall container size in dp. Defaults to 20. */
  size?: number;
  accessibilityLabel?: string;
}

export function SourceMark({ source, size = 20, accessibilityLabel }: SourceMarkProps) {
  const mark = sourceMark(source);
  if (!mark) return null;

  const borderRadius = Math.round(size * 0.25);

  if (mark.type === "path") {
    // SVG glyph chip — same design as before
    const iconSize = Math.round(size * 0.7);
    const bgColor = `${mark.color}26`; // 15 % opacity

    return (
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={accessibilityLabel ?? source}
        style={{
          width: size,
          height: size,
          borderRadius,
          backgroundColor: bgColor,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill={mark.color}>
          <Path d={mark.d} />
        </Svg>
      </View>
    );
  }

  // TextMark — solid-colour chip with operator label
  const labelLen = mark.label.length;
  const fontSize = labelLen <= 2
    ? Math.round(size * 0.38)
    : Math.round(size * 0.28);

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel ?? mark.label}
      style={{
        width: size,
        height: size,
        borderRadius,
        backgroundColor: mark.bg,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text
        style={{
          color: mark.fg,
          fontSize,
          fontWeight: "700",
          letterSpacing: -0.2,
          lineHeight: fontSize * 1.1,
          includeFontPadding: false,
        }}
        numberOfLines={1}
      >
        {mark.label}
      </Text>
    </View>
  );
}
