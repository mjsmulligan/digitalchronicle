/**
 * Goodreads source card (username entry, check now, auto-check).
 * Moved out of mobile/app/sources.tsx, no behaviour change.
 */
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { spacing, radius, type ThemeColors, type ThemeFonts } from "../ThemeProvider";
import { SourceCard, SrcButton } from "./SourceCard";

export function GoodreadsSourceCard({
  active,
  disabled,
  grId,
  grEditing,
  grInput,
  onGrInputChange,
  onSync,
  onStartEdit,
  onCancelEdit,
  onSaveId,
  onForget,
  autoCheck,
  onAutoCheckChange,
  lastCheckedAt,
  lastError,
  colors,
  fonts,
}: {
  active: boolean;
  disabled: boolean;
  grId: string | null;
  grEditing: boolean;
  grInput: string;
  onGrInputChange: (v: string) => void;
  onSync: () => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveId: () => void;
  onForget: () => void;
  autoCheck: boolean;
  onAutoCheckChange: (v: boolean) => void;
  lastCheckedAt: string | null;
  lastError: string | null;
  colors: ThemeColors;
  fonts: ThemeFonts;
}) {
  const statusText = active
    ? "Syncing…"
    : grId
    ? lastCheckedAt
      ? `Connected · last checked ${new Date(lastCheckedAt).toLocaleDateString("en-US", { day: "numeric", month: "short" })}`
      : `Connected - ${grId}`
    : "Sync your read-shelf via public RSS";

  return (
    <SourceCard
      icon="book-outline"
      title="Goodreads"
      statusText={statusText}
      active={active}
      progressPct={0}
      colors={colors}
      fonts={fonts}
      action={
        active ? (
          <ActivityIndicator size="small" color={colors.accent} />
        ) : grId && !grEditing ? (
          <SrcButton
            label="Check now"
            onPress={onSync}
            disabled={disabled}
            colors={colors}
            fonts={fonts}
          />
        ) : !grEditing ? (
          <SrcButton
            label="Connect"
            onPress={onStartEdit}
            disabled={disabled}
            colors={colors}
            fonts={fonts}
          />
        ) : null
      }
    >
      {/* ID entry / management */}
      {grId && !grEditing && (
        <View
          style={{
            flexDirection: "row",
            gap: spacing.md,
            marginTop: spacing.sm,
          }}
        >
          <Pressable onPress={onStartEdit}>
            <Text style={{ fontSize: 12, color: colors.accent }}>Change ID</Text>
          </Pressable>
          <Pressable onPress={onForget}>
            <Text style={{ fontSize: 12, color: colors.error }}>Disconnect</Text>
          </Pressable>
        </View>
      )}

      {/* Auto-check switch (only when connected) */}
      {grId && !grEditing && (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            marginTop: spacing.sm,
            paddingTop: spacing.sm,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: colors.borderFaint,
          }}
        >
          <Text style={{ fontSize: 12, color: colors.textMuted, flex: 1 }}>
            Check automatically on startup
          </Text>
          <Switch
            value={autoCheck}
            onValueChange={onAutoCheckChange}
            trackColor={{ false: colors.border, true: colors.accent }}
            thumbColor={colors.surface}
          />
        </View>
      )}

      {/* Last error */}
      {grId && !grEditing && lastError != null && (
        <Text
          style={{ fontSize: 11, color: colors.error, marginTop: spacing.xs }}
          numberOfLines={2}
        >
          {lastError}
        </Text>
      )}

      {grEditing && (
        <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
          <Text style={{ fontSize: 12, color: colors.textMuted, lineHeight: 18 }}>
            Enter your Goodreads username. Your profile must be public.
          </Text>
          <TextInput
            value={grInput}
            onChangeText={onGrInputChange}
            placeholder="your-username"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            style={{
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: radius.md,
              padding: spacing.md,
              color: colors.textPrimary,
              backgroundColor: colors.surfaceMuted,
              fontSize: 13,
            }}
          />
          <View style={{ flexDirection: "row", gap: spacing.md, justifyContent: "flex-end" }}>
            <Pressable onPress={onCancelEdit}>
              <Text style={{ fontSize: 13, color: colors.textMuted }}>Cancel</Text>
            </Pressable>
            <Pressable onPress={onSaveId}>
              <Text style={{ fontSize: 13, color: colors.accent, fontWeight: "600" }}>
                Save & sync
              </Text>
            </Pressable>
          </View>
        </View>
      )}
    </SourceCard>
  );
}
