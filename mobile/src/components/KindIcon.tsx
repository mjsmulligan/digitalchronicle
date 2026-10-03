/**
 * KindIcon — a single line icon for an entry kind (or trip purpose),
 * rendered via Ionicons (already in @expo/vector-icons).
 *
 * StarRating — a row of up to 5 star icons, also exported from here.
 */
import React from "react";
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

function resolveIcon(kind: string, subkind?: string): { name: IoniconName; label: string } {
  switch (kind) {
    case "leg":
      if (subkind === "air")  return { name: "airplane",       label: "Flight" };
      if (subkind === "rail") return { name: "train",           label: "Train" };
      return                         { name: "car",             label: "Drive" };
    case "stay":    return { name: "bed",            label: "Stay" };
    case "film":    return { name: "film",           label: "Film" };
    case "episode": return { name: "tv-outline",      label: "Episode" };
    case "book":    return { name: "book",           label: "Book" };
    case "event":
      if (subkind === "concert")     return { name: "musical-notes", label: "Concert" };
      if (subkind === "celebration") return { name: "gift",          label: "Celebration" };
      if (subkind === "milestone")   return { name: "trophy",        label: "Milestone" };
      return                                { name: "location",      label: "Event" };
    // Trip purpose
    case "leisure": return { name: "sunny",     label: "Leisure" };
    case "work":    return { name: "briefcase", label: "Work trip" };
    case "family":  return { name: "people",    label: "Family trip" };
    default:        return { name: "location",  label: kind };
  }
}

export interface KindIconProps {
  kind: string;
  /**
   * For "leg": "air" | "rail" | "car".
   * For "event": "concert" | "celebration" | "milestone" | "other".
   * For trip purpose: pass the purpose string as `kind` instead.
   */
  subkind?: string;
  size?: number;
  color: string;
  accessibilityLabel?: string;
}

/**
 * Renders an Ionicons glyph for the given entry kind and optional subkind.
 * Includes an accessibilityLabel for TalkBack/VoiceOver.
 */
export function KindIcon({ kind, subkind, size = 18, color, accessibilityLabel }: KindIconProps) {
  const { name, label } = resolveIcon(kind, subkind);
  return (
    <Ionicons
      name={name}
      size={size}
      color={color}
      accessibilityLabel={accessibilityLabel ?? label}
    />
  );
}

// ─── StarRating ───────────────────────────────────────────────────────────────

export interface StarRatingProps {
  /** Raw 0–10 rating value (as stored in the data model). Displayed as 0–5 stars. */
  rating: number;
  color: string;
  size?: number;
}

/**
 * Renders up to 5 filled/outline star icons.
 * aria-hidden so screen readers read the surrounding context instead.
 */
export function StarRating({ rating, color, size = 13 }: StarRatingProps) {
  const filled = Math.round(rating / 2);
  return (
    <View
      style={{ flexDirection: "row", gap: 1 }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {Array.from({ length: 5 }, (_, i) => (
        <Ionicons
          key={i}
          name={i < filled ? "star" : "star-outline"}
          size={size}
          color={color}
        />
      ))}
    </View>
  );
}
