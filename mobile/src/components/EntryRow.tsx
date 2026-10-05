/**
 * EntryRow — a single entry row for any list (Chronicle, Trips, Culture, People).
 *
 * Design (spec 7.1):
 *   [source mark / kind icon] · Serif title · sans subtitle · MONO LABEL
 *   Stars (rust) appear under the title when the entry is rated.
 *
 * No card border — rows are separated by hairlines managed by the parent
 * (DayGroup, or a FlatList ItemSeparatorComponent).
 *
 * Accepts `colors` and `fonts` as props so it can be used inside FlatList
 * renderItem without calling useTheme() on every row.
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  entryTitle,
  view,
  CATEGORY_LABEL,
  type Entry,
  type Leg,
  type Film,
  type Book,
  type PlaceEntry,
} from "@chronicle/journal/types";
import { type ThemeColors, type ThemeFonts, text as textScale, spacing as spacingScale } from "./ThemeProvider";
import { KindIcon, StarRating } from "./KindIcon";
import { SourceMark } from "./SourceMark";
import { sourceMark, operatorMarkId } from "@chronicle/journal/connectors/icons";

// ── helpers ──────────────────────────────────────────────────────────────────

/** Maps an entry to a short mono label shown at the row's trailing edge. */
export function entryLabel(e: Entry): string {
  const v = view(e);
  if (v.kind === "leg") {
    return (v as Leg).mode === "air" ? "Flight"
      : (v as Leg).mode === "rail" ? "Train"
      : "Road";
  }
  if (v.kind === "stay")    return "Stay";
  if (v.kind === "place")   return "Place";
  if (v.kind === "place-entry") return "Place";
  if (v.kind === "film")    return (v as Film).rewatch ? "Rewatch" : "Film";
  if (v.kind === "episode") return "Episode";
  if (v.kind === "book")    return (v as Book).series ? "Series" : "Book";
  return CATEGORY_LABEL[(v as Extract<Entry, { kind: "event" }>).category ?? "activity"];
}

/** One-line subtitle derived from structured entry fields, mirroring the web EntryCard meta. */
export function entryMeta(e: Entry): string {
  const v = view(e);
  if (v.kind === "leg") {
    const leg = v as Leg;
    return [leg.flightNumber ?? leg.trainNumber, leg.operator, leg.aircraft, leg.seat && `seat ${leg.seat}`]
      .filter(Boolean).join(" · ");
  }
  if (v.kind === "stay") {
    const s = v as Extract<Entry, { kind: "stay" }>;
    return [s.city, s.end && `until ${s.end.slice(0, 10)}`].filter(Boolean).join(" · ");
  }
  if (v.kind === "place") {
    const p = v as Extract<Entry, { kind: "place" }>;
    return [p.region, p.start && p.end && p.start !== p.end ? `${p.start.slice(0, 10)} – ${p.end.slice(0, 10)}` : p.start?.slice(0, 10)]
      .filter(Boolean).join(" · ");
  }
  if (v.kind === "place-entry") {
    const pe = v as PlaceEntry;
    return [pe.localDay, `${pe.photoCount} photo${pe.photoCount === 1 ? "" : "s"}`]
      .filter(Boolean).join(" · ");
  }
  if (v.kind === "film") {
    const f = v as Extract<Entry, { kind: "film" }>;
    return [f.director, f.year && String(f.year)].filter(Boolean).join(" · ");
  }
  if (v.kind === "episode") {
    const ep = v as Extract<Entry, { kind: "episode" }>;
    return [ep.season, ep.episodeNumber && `Ep ${ep.episodeNumber}`].filter(Boolean).join(" · ");
  }
  if (v.kind === "book") {
    const b = v as Extract<Entry, { kind: "book" }>;
    return [b.series && `${b.series}${b.seriesNumber ? ` #${b.seriesNumber}` : ""}`, b.year && String(b.year)]
      .filter(Boolean).join(" · ");
  }
  // event
  const ev = v as Extract<Entry, { kind: "event" }>;
  return [ev.venue, ev.city].filter(Boolean).join(" · ");
}

/** Subkind string for KindIcon (leg mode or event category). */
function resolveSubkind(e: Entry): string | undefined {
  if (e.kind === "leg") return (e as Leg).mode;
  if (e.kind === "event") return (e as Extract<Entry, { kind: "event" }>).category;
  return undefined;
}

// ── styles ────────────────────────────────────────────────────────────────────

function createStyles(colors: ThemeColors, fonts: ThemeFonts) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "flex-start",
      paddingVertical: spacingScale.md,
      gap: spacingScale.sm,
    },
    rowPressed: { opacity: 0.55 },
    markWrap: {
      width: 20,
      height: 20,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 2,          // align with text cap height
      flexShrink: 0,
    },
    body: { flex: 1, minWidth: 0 },
    title: {
      ...textScale.feedTitle,
      fontFamily: fonts.serifMedium,
      color: colors.textPrimary,
      fontWeight: "500",
    },
    subtitle: {
      ...textScale.sm,
      fontFamily: fonts.sans,
      color: colors.textTertiary,
      marginTop: 2,
    },
    label: {
      fontSize: 10,
      fontFamily: fonts.mono,
      fontWeight: "700",
      letterSpacing: 0.8,
      textTransform: "uppercase" as const,
      color: colors.textTertiary,
      marginTop: 3,           // align with first line of title
      flexShrink: 0,
      alignSelf: "flex-start",
    },
  });
}

// ── component ─────────────────────────────────────────────────────────────────

export interface EntryRowProps {
  entry: Entry;
  colors: ThemeColors;
  fonts: ThemeFonts;
  onPress: () => void;
  onLongPress?: () => void;
}

/**
 * Renders a single entry as a hairline-separated row (no border, no card).
 * Use inside a DayGroup or any list that provides its own separators.
 */
export function EntryRow({ entry, colors, fonts, onPress, onLongPress }: EntryRowProps) {
  const v = view(entry);
  const styles = createStyles(colors, fonts);
  const title = entryTitle(v);
  const subtitle = entryMeta(v);
  const label = entryLabel(v);
  const subkind = resolveSubkind(entry);
  // For legs, prefer an operator-specific mark (e.g. "DB", "FS") over the
  // connector source mark (e.g. "viaduct"). Fall back to KindIcon if neither.
  const markId =
    entry.kind === "leg"
      ? (operatorMarkId((entry as Leg).operator) ?? entry.source)
      : entry.source;
  const hasBrandMark = !!sourceMark(markId);

  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      {/* Leading: brand mark, or KindIcon fallback */}
      <View style={styles.markWrap}>
        {hasBrandMark ? (
          <SourceMark source={markId} size={20} accessibilityLabel="" />
        ) : (
          <KindIcon
            kind={entry.kind}
            subkind={subkind}
            size={18}
            color={colors.textTertiary}
            accessibilityLabel=""
          />
        )}
      </View>

      {/* Body: title + optional subtitle + optional stars */}
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={2}>{title}</Text>
        {subtitle.length > 0 && (
          <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>
        )}
        {v.rating !== undefined && (
          <StarRating rating={v.rating} color={colors.star} size={11} />
        )}
      </View>

      {/* Trailing: mono kind label */}
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}
