/**
 * Shared building blocks for the connect and manage sheets
 * (docs/specs/sources-page.md, section 6). Every control is at least 48dp tall.
 */
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme, spacing, radius } from "../ThemeProvider";
import type { SourceView } from "../../lib/sourceRegistry";

// ─── Text ─────────────────────────────────────────────────────────────────────

export function Note({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return <Text style={[p.note, { color: colors.textMuted }]}>{children}</Text>;
}

export function FieldLabel({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return <Text style={[p.fieldLabel, { color: colors.textMuted }]}>{children}</Text>;
}

// ─── Buttons ──────────────────────────────────────────────────────────────────

export function PrimaryButton({
  label, onPress, disabled, busy,
}: { label: string; onPress: () => void; disabled?: boolean; busy?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, busy: !!busy }}
      style={({ pressed }) => [
        p.primary,
        { backgroundColor: colors.accentBold, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={colors.white} />
      ) : (
        <Text style={[p.primaryText, { color: colors.white }]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function TextButton({
  label, onPress, destructive, disabled, align = "flex-start",
}: {
  label: string;
  onPress: () => void;
  destructive?: boolean;
  disabled?: boolean;
  align?: "flex-start" | "center" | "flex-end";
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [p.textBtn, { alignSelf: align, opacity: disabled ? 0.45 : pressed ? 0.6 : 1 }]}
    >
      <Text style={[p.textBtnText, { color: destructive ? colors.error : colors.accent }]}>{label}</Text>
    </Pressable>
  );
}

// ─── Rows ─────────────────────────────────────────────────────────────────────

export function SwitchRow({
  label, value, onChange, disabled,
}: { label: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={[p.rowBase, { borderTopColor: colors.borderFaint, borderTopWidth: StyleSheet.hairlineWidth }]}>
      <Text style={[p.rowLabel, { color: colors.textPrimary }]}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        accessibilityLabel={label}
        trackColor={{ false: colors.border, true: colors.accent }}
        thumbColor={colors.surface}
      />
    </View>
  );
}

/** A row that shows a value and one action on the right (for example scope and Change). */
export function ValueRow({
  label, value, actionLabel, onAction, disabled,
}: { label: string; value: string; actionLabel?: string; onAction?: () => void; disabled?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={[p.rowBase, { borderTopColor: colors.borderFaint, borderTopWidth: StyleSheet.hairlineWidth }]}>
      <View style={{ flex: 1 }}>
        <Text style={[p.fieldLabel, { color: colors.textMuted, marginBottom: 0 }]}>{label}</Text>
        <Text style={[p.rowLabel, { color: colors.textPrimary }]} numberOfLines={2}>{value}</Text>
      </View>
      {actionLabel && onAction ? <TextButton label={actionLabel} onPress={onAction} disabled={disabled} /> : null}
    </View>
  );
}

export function NavRow({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        p.rowBase,
        { borderTopColor: colors.borderFaint, borderTopWidth: StyleSheet.hairlineWidth, opacity: pressed ? 0.6 : 1 },
      ]}
    >
      <Text style={[p.rowLabel, { color: colors.accent, flex: 1 }]}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color={colors.accent} />
    </Pressable>
  );
}

export function RadioRow({
  label, selected, onPress, disabled,
}: { label: string; selected: boolean; onPress: () => void; disabled?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled: !!disabled }}
      accessibilityLabel={label}
      style={({ pressed }) => [p.rowBase, { opacity: pressed ? 0.6 : 1 }]}
    >
      <Ionicons
        name={selected ? "radio-button-on" : "radio-button-off"}
        size={22}
        color={selected ? colors.accent : colors.textMuted}
      />
      <Text style={[p.rowLabel, { color: colors.textPrimary, flex: 1 }]}>{label}</Text>
    </Pressable>
  );
}

export function CheckRow({
  label, color, checked, onPress,
}: { label: string; color?: string; checked: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      style={({ pressed }) => [p.rowBase, { opacity: pressed ? 0.6 : 1 }]}
    >
      {color ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} /> : null}
      <Text style={[p.rowLabel, { color: colors.textPrimary, flex: 1 }]} numberOfLines={2}>{label}</Text>
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 5,
          borderWidth: 1.5,
          borderColor: checked ? colors.accent : colors.border,
          backgroundColor: checked ? colors.accent : "transparent",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {checked ? <Ionicons name="checkmark" size={15} color={colors.white} /> : null}
      </View>
    </Pressable>
  );
}

// ─── Status block (top of every manage sheet) ─────────────────────────────────

const STATE_LABEL = {
  active: "Active",
  checking: "Checking",
  attention: "Needs attention",
  paused: "Paused",
} as const;

export function StatusBlock({ view }: { view: SourceView }) {
  const { colors } = useTheme();
  const attention = view.state === "attention";
  const color = attention ? colors.error : view.state === "active" ? colors.success : colors.textMuted;
  return (
    <View style={{ marginBottom: spacing.md, gap: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        {view.state === "checking" ? (
          <ActivityIndicator size="small" color={colors.accent} />
        ) : (
          <Ionicons
            name={attention ? "warning-outline" : view.state === "paused" ? "pause-circle-outline" : "ellipse"}
            size={attention || view.state === "paused" ? 15 : 8}
            color={color}
          />
        )}
        <Text style={{ fontSize: 13, fontWeight: "600", color }}>{STATE_LABEL[view.state]}</Text>
      </View>
      <Text style={{ fontSize: 14, lineHeight: 20, color: colors.textSecondary }}>{view.statusLine}</Text>
    </View>
  );
}

// ─── Manage layout: shared controls around the source specific rows ──────────

export interface ManageLayoutProps {
  view: SourceView;
  checkLabel?: string;
  onCheckNow: () => void;
  checkDisabled?: boolean;
  autoCheck: boolean;
  onAutoCheck: (v: boolean) => void;
  /** Full text of the last check: time and the untruncated error when present. */
  lastCheckDetail: string;
  disconnectNote: string;
  onDisconnect: () => void;
  children?: React.ReactNode;
}

export function ManageLayout({
  view, checkLabel = "Check now", onCheckNow, checkDisabled, autoCheck, onAutoCheck,
  lastCheckDetail, disconnectNote, onDisconnect, children,
}: ManageLayoutProps) {
  const { colors } = useTheme();
  return (
    <View>
      <StatusBlock view={view} />
      <PrimaryButton label={checkLabel} onPress={onCheckNow} disabled={checkDisabled} busy={view.state === "checking"} />
      <View style={{ marginTop: spacing.sm }}>
        <SwitchRow label="Check automatically on launch" value={autoCheck} onChange={onAutoCheck} />
        {children}
        <View style={[p.rowBase, { borderTopColor: colors.borderFaint, borderTopWidth: StyleSheet.hairlineWidth, alignItems: "flex-start" }]}>
          <View style={{ flex: 1 }}>
            <Text style={[p.fieldLabel, { color: colors.textMuted, marginBottom: 2 }]}>Last check</Text>
            <Text selectable style={{ fontSize: 14, lineHeight: 20, color: colors.textSecondary }}>{lastCheckDetail}</Text>
          </View>
        </View>
      </View>
      <View style={{ marginTop: spacing.sm }}>
        <TextButton label="Disconnect" destructive onPress={onDisconnect} />
        <Note>{disconnectNote}</Note>
      </View>
    </View>
  );
}

const p = StyleSheet.create({
  note: { fontSize: 13, lineHeight: 18 },
  fieldLabel: { fontSize: 12, marginBottom: spacing.xs },
  primary: {
    minHeight: 48,
    borderRadius: radius.xl,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  primaryText: { fontSize: 15, fontWeight: "600" },
  textBtn: { minHeight: 48, justifyContent: "center", paddingHorizontal: spacing.xs },
  textBtnText: { fontSize: 15, fontWeight: "600" },
  rowBase: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowLabel: { fontSize: 15 },
});
