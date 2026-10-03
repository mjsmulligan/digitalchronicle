/**
 * SourceMark — a 20×20 rounded-square brand chip for a known source
 * (Netflix, Letterboxd, Goodreads), using the shared SVG path data from
 * src/lib/journal/connectors/icons.ts. Returns null for unknown sources.
 *
 * Design mirrors web SourceIcon.tsx:
 *   container: 20×20, borderRadius 5, background = brand colour at 15 % opacity
 *   glyph: ~14×14 SVG, filled with the brand colour
 *
 * Colour note: SOURCE_COLORS are already muted for the Leather / dark palette.
 * On Paper (light) they read correctly too — verified against spec 4.6.
 */
import React from "react";
import { View } from "react-native";
import Svg, { Path } from "react-native-svg";
import {
  sourceIconPath,
  sourceColor,
} from "@chronicle/journal/connectors/icons";

export interface SourceMarkProps {
  source: string;
  /** Overall container size in dp. Defaults to 20. */
  size?: number;
  accessibilityLabel?: string;
}

/**
 * Renders a brand mark for a recognised source; returns null otherwise so
 * callers can fall back to a KindIcon chip.
 */
export function SourceMark({ source, size = 20, accessibilityLabel }: SourceMarkProps) {
  const d = sourceIconPath(source);
  const color = sourceColor(source);
  if (!d || !color) return null;

  // Icon occupies ~70 % of the container to match the web `h-3.5 w-3.5` on `h-[18px]`.
  const iconSize = Math.round(size * 0.7);

  // Append "26" (hex for ~15 % opacity) to the 6-digit brand hex.
  const bgColor = `${color}26`;

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel ?? source}
      style={{
        width: size,
        height: size,
        borderRadius: 5,
        backgroundColor: bgColor,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill={color}>
        <Path d={d} />
      </Svg>
    </View>
  );
}
