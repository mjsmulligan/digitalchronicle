/**
 * Device calendar source card (connect flow, picker, manual range, auto-check).
 * Moved out of mobile/app/sources.tsx, no behaviour change.
 */
import React, { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { spacing, radius, type ThemeColors, type ThemeFonts } from "../ThemeProvider";
import { SourceCard, SrcButton } from "./SourceCard";

export type CalScope = "last-year" | "all-time";

const CAL_SCOPE_DAYS: Record<CalScope, number> = {
  "last-year": 365,
  "all-time":  36500,
};

const CAL_SCOPE_LABELS: Record<CalScope, string> = {
  "last-year": "Last year",
  "all-time":  "All time",
};

export type CalendarListItem = {
  id: string;
  title: string;
  color: string;
  defaultExcluded: boolean;
};

export type CalConnecting = "idle" | "loading" | "picking";

export function CalendarSourceCard({
  active,
  disabled,
  connected,
  connecting,
  calendarList,
  calSelectedIds,
  onSync,
  onStartConnect,
  onToggleCalendar,
  onConnectDone,
  onConnectCancel,
  onDisconnect,
  autoCheck,
  onAutoCheckChange,
  lastCheckedAt,
  lastError,
  colors,
  fonts,
}: {
  active: boolean;
  disabled: boolean;
  connected: boolean;
  connecting: CalConnecting;
  calendarList: CalendarListItem[];
  calSelectedIds: Set<string>;
  onSync: (pastDays: number) => void;
  onStartConnect: () => void;
  onToggleCalendar: (id: string) => void;
  onConnectDone: () => void;
  onConnectCancel: () => void;
  onDisconnect: () => void;
  autoCheck: boolean;
  onAutoCheckChange: (v: boolean) => void;
  lastCheckedAt: string | null;
  lastError: string | null;
  colors: ThemeColors;
  fonts: ThemeFonts;
}) {
  const [scope, setScope] = useState<CalScope>("last-year");
  const [scopePickerOpen, setScopePickerOpen] = useState(false);

  const statusText = active
    ? "Syncing…"
    : connected && lastCheckedAt
    ? `Connected - last checked ${new Date(lastCheckedAt).toLocaleDateString("en-US", { day: "numeric", month: "short" })}`
    : connected
    ? "Connected - not checked yet"
    : "Imports one-off events from your calendar";

  const action = active ? (
    <ActivityIndicator size="small" color={colors.accent} />
  ) : connecting === "loading" ? (
    <ActivityIndicator size="small" color={colors.accent} />
  ) : connected ? (
    <SrcButton
      label="Check now"
      onPress={() => onSync(CAL_SCOPE_DAYS[scope])}
      disabled={disabled}
      colors={colors}
      fonts={fonts}
    />
  ) : connecting === "picking" ? null : (
    <SrcButton
      label="Connect"
      onPress={onStartConnect}
      disabled={disabled}
      colors={colors}
      fonts={fonts}
    />
  );

  return (
    <SourceCard
      icon="calendar-outline"
      title="Device calendar"
      statusText={statusText}
      active={active}
      progressPct={0}
      colors={colors}
      fonts={fonts}
      action={action}
    >
      {/* Calendar picker (shown while connecting) */}
      {connecting === "picking" && (
        <View style={{ marginTop: spacing.md }}>
          <Text style={{ fontSize: 12, color: colors.textMuted, marginBottom: spacing.sm }}>
            Choose which calendars to import. Recurring events are always excluded.
          </Text>
          {calendarList.map((cal) => {
            const selected = calSelectedIds.has(cal.id);
            return (
              <Pressable
                key={cal.id}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  paddingVertical: spacing.sm,
                  gap: spacing.md,
                }}
                onPress={() => onToggleCalendar(cal.id)}
              >
                {/* Color dot */}
                <View
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    backgroundColor: cal.color || colors.accent,
                  }}
                />
                <Text style={{ flex: 1, fontSize: 13, color: colors.textPrimary }}>
                  {cal.title}
                </Text>
                {/* Checkbox */}
                <View
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 4,
                    borderWidth: 1.5,
                    borderColor: selected ? colors.accent : colors.border,
                    backgroundColor: selected ? colors.accent : "transparent",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {selected && (
                    <Ionicons name="checkmark" size={13} color={colors.white} />
                  )}
                </View>
              </Pressable>
            );
          })}
          <View style={{ flexDirection: "row", gap: spacing.md, justifyContent: "flex-end", marginTop: spacing.sm }}>
            <Pressable onPress={onConnectCancel}>
              <Text style={{ fontSize: 13, color: colors.textMuted }}>Cancel</Text>
            </Pressable>
            <Pressable onPress={onConnectDone} disabled={calSelectedIds.size === 0}>
              <Text
                style={{
                  fontSize: 13,
                  color: calSelectedIds.size > 0 ? colors.accent : colors.textMuted,
                  fontWeight: "600",
                }}
              >
                Done
              </Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* Connected management row */}
      {connected && connecting === "idle" && (
        <View style={{ flexDirection: "row", gap: spacing.md, marginTop: spacing.sm }}>
          <Pressable onPress={onDisconnect}>
            <Text style={{ fontSize: 12, color: colors.error }}>Disconnect</Text>
          </Pressable>
        </View>
      )}

      {/* Scope picker (for manual Check now, shown only when connected) */}
      {connected && connecting === "idle" && (
        <>
          <Pressable
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.xs,
              paddingVertical: spacing.xs,
              marginTop: spacing.sm,
            }}
            onPress={() => setScopePickerOpen((v) => !v)}
          >
            <Ionicons name="options-outline" size={14} color={colors.textMuted} />
            <Text style={{ fontSize: 12, color: colors.textMuted, flex: 1 }}>
              Manual range: {CAL_SCOPE_LABELS[scope]}
            </Text>
            <Ionicons
              name={scopePickerOpen ? "chevron-up" : "chevron-down"}
              size={13}
              color={colors.textMuted}
            />
          </Pressable>
          {scopePickerOpen && (
            <View
              style={{
                borderTopWidth: StyleSheet.hairlineWidth,
                borderTopColor: colors.borderFaint,
                marginBottom: spacing.sm,
                paddingTop: spacing.sm,
                gap: spacing.xs,
              }}
            >
              {(["last-year", "all-time"] as CalScope[]).map((s) => (
                <Pressable
                  key={s}
                  style={[
                    { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.md },
                    scope === s && { backgroundColor: colors.accentSubtle },
                  ]}
                  onPress={() => { setScope(s); setScopePickerOpen(false); }}
                >
                  <Text
                    style={[
                      { fontSize: 13, color: colors.textSecondary },
                      scope === s && { color: colors.accent },
                    ]}
                  >
                    {CAL_SCOPE_LABELS[s]}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
        </>
      )}

      {/* Auto-check switch (only when connected) */}
      {connected && connecting === "idle" && (
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
      {connected && lastError != null && (
        <Text
          style={{ fontSize: 11, color: colors.error, marginTop: spacing.xs }}
          numberOfLines={2}
        >
          {lastError}
        </Text>
      )}
    </SourceCard>
  );
}
