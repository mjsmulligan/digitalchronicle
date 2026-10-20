/**
 * Goodreads: connect and manage sheet body
 * (docs/specs/sources-page.md, sections 6.1 and 6.2).
 */
import React from "react";
import { TextInput, View } from "react-native";
import { useTheme, spacing, radius } from "../ThemeProvider";
import type { SourceView } from "../../lib/sourceRegistry";
import { ManageLayout, Note, PrimaryButton, TextButton, ValueRow } from "./sheetParts";

export interface GoodreadsSheetProps {
  /** Saved username, or null when not connected. */
  userId: string | null;
  /** True while entering or changing the username. */
  editing: boolean;
  input: string;
  onInput: (v: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: () => void;
  view: SourceView;
  onCheckNow: () => void;
  autoCheck: boolean;
  onAutoCheck: (v: boolean) => void;
  lastCheckDetail: string;
  onDisconnect: () => void;
}

export function GoodreadsSheet(p: GoodreadsSheetProps) {
  const { colors } = useTheme();

  if (p.userId === null || p.editing) {
    return (
      <View>
        <Note>
          Enter your Goodreads username or profile address. Your profile must be public.
          The username is sent to Goodreads to read your read shelf, and nothing else leaves this phone.
        </Note>
        <TextInput
          value={p.input}
          onChangeText={p.onInput}
          placeholder="your-username"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Goodreads username"
          style={{
            minHeight: 48,
            marginVertical: spacing.md,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: radius.lg,
            paddingHorizontal: spacing.md,
            color: colors.textPrimary,
            backgroundColor: colors.surfaceMuted,
            fontSize: 15,
          }}
        />
        <PrimaryButton label="Save and sync" onPress={p.onSave} disabled={p.input.trim().length === 0} />
        {p.userId !== null ? <TextButton label="Cancel" onPress={p.onCancelEdit} align="center" /> : null}
      </View>
    );
  }

  return (
    <ManageLayout
      view={p.view}
      onCheckNow={p.onCheckNow}
      autoCheck={p.autoCheck}
      onAutoCheck={p.onAutoCheck}
      lastCheckDetail={p.lastCheckDetail}
      onDisconnect={p.onDisconnect}
      disconnectNote="Books already imported stay in your journal."
    >
      <ValueRow label="Username" value={p.userId} actionLabel="Change" onAction={p.onStartEdit} />
    </ManageLayout>
  );
}
