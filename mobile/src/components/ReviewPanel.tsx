/**
 * ReviewPanel — shared outer chrome for all pending-review cards.
 *
 * Owns: card wrapper, header (title + meta + discard), optional error
 * band, bulk-action row, commit button (above the item list), and the
 * collapsing progress state shown while a commit is in flight.
 *
 * Callers supply the item list as children.
 */
import React from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { type ThemeColors, type ThemeFonts } from "./ThemeProvider";
import { br } from "./reviewCard.styles";

export interface BulkAction {
  label: string;
  onPress: () => void;
}

export interface ReviewPanelProps {
  /** Primary label — filename for batch imports, descriptive label otherwise. */
  title: string;
  /** Counts / sub-label shown beneath the title. */
  meta: string;
  onDiscard: () => void;
  /** Defaults to "trash-outline". Use "close" for non-destructive dismissals. */
  discardIcon?: "trash-outline" | "close";
  /** Parse or validation errors shown in a red band below the header. */
  errors?: string[];
  /** Bulk-selection links shown above the commit button. */
  bulkActions: BulkAction[];
  commitLabel: string;
  onCommit: () => void;
  commitDisabled: boolean;
  /** When true the card collapses to a slim animated progress bar. */
  committing?: boolean;
  commitDone?: number;
  commitTotal?: number;
  colors: ThemeColors;
  fonts: ThemeFonts;
  children: React.ReactNode;
}

export function ReviewPanel({
  title,
  meta,
  onDiscard,
  discardIcon = "trash-outline",
  errors,
  bulkActions,
  commitLabel,
  onCommit,
  commitDisabled,
  committing,
  commitDone = 0,
  commitTotal = 0,
  colors,
  fonts,
  children,
}: ReviewPanelProps) {
  // ── Committing → collapses to slim progress card ──────────────────────────────
  if (committing) {
    const pct = commitTotal > 0 ? commitDone / commitTotal : 0;
    return (
      <View style={[br.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={br.commitTop}>
          <ActivityIndicator size="small" color={colors.accent} />
          <View style={{ flex: 1 }}>
            <Text
              style={[br.filename, { color: colors.textPrimary, fontFamily: fonts.sans }]}
              numberOfLines={1}
            >
              {title}
            </Text>
            <Text style={[br.commitCount, { color: colors.textTertiary }]}>
              Saving {commitDone} of {commitTotal}…
            </Text>
          </View>
        </View>
        <View style={[br.track, { backgroundColor: colors.border }]}>
          <View
            style={[br.fill, { width: `${Math.round(pct * 100)}%`, backgroundColor: colors.accent }]}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={[br.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {/* Header */}
      <View style={[br.header, { borderBottomColor: colors.border }]}>
        <View style={{ flex: 1 }}>
          <Text
            style={[br.filename, { color: colors.textPrimary, fontFamily: fonts.sans }]}
            numberOfLines={1}
          >
            {title}
          </Text>
          <Text style={[br.meta, { color: colors.textTertiary }]}>{meta}</Text>
        </View>
        <Pressable onPress={onDiscard} style={{ padding: 4 }}>
          <Ionicons
            name={discardIcon}
            size={discardIcon === "close" ? 16 : 18}
            color={discardIcon === "close" ? colors.textMuted : colors.error}
          />
        </Pressable>
      </View>

      {/* Errors */}
      {errors && errors.length > 0 && (
        <View style={[br.errBox, { backgroundColor: colors.errorBg, borderBottomColor: colors.border }]}>
          {errors.slice(0, 3).map((e, i) => (
            <Text key={i} style={[br.errText, { color: colors.errorLight }]} numberOfLines={2}>
              {e}
            </Text>
          ))}
          {errors.length > 3 && (
            <Text style={[br.errText, { color: colors.errorLight }]}>
              …and {errors.length - 3} more
            </Text>
          )}
        </View>
      )}

      {/* Bulk actions */}
      <View style={[br.quick, { borderBottomColor: colors.borderFaint }]}>
        {bulkActions.map((a) => (
          <Pressable key={a.label} onPress={a.onPress}>
            <Text style={[br.quickText, { color: colors.accent }]}>{a.label}</Text>
          </Pressable>
        ))}
      </View>

      {/* Commit button — always above the item list */}
      <View style={br.commitBar}>
        <Pressable
          style={[
            br.commitBtn,
            { backgroundColor: colors.accentBold },
            commitDisabled && { opacity: 0.4 },
          ]}
          disabled={commitDisabled}
          onPress={onCommit}
        >
          <Text style={[br.commitBtnText, { fontFamily: fonts.sans, color: colors.white }]}>
            {commitLabel}
          </Text>
        </Pressable>
      </View>

      {/* Item list */}
      {children}
    </View>
  );
}
