/**
 * Calendar: connect and manage sheet body
 * (docs/specs/sources-page.md, sections 6.1 and 6.2).
 *
 * While `connecting` is not "idle" the calendar checklist is shown, whether
 * this is a first connect, Reconnect, or Edit calendars.
 */
import React from "react";
import { ActivityIndicator, View } from "react-native";
import { useTheme, spacing } from "../ThemeProvider";
import type { SourceView } from "../../lib/sourceRegistry";
import {
  CheckRow, FieldLabel, ManageLayout, Note, PrimaryButton, RadioRow, TextButton, ValueRow,
} from "./sheetParts";

export type CalendarListItem = {
  id: string;
  title: string;
  color: string;
  defaultExcluded: boolean;
};

export type CalConnecting = "idle" | "loading" | "picking";
export type CalScope = "last-year" | "all-time";

export const CAL_SCOPE_DAYS: Record<CalScope, number> = { "last-year": 365, "all-time": 36500 };
export const CAL_SCOPE_LABELS: Record<CalScope, string> = { "last-year": "Last year", "all-time": "All time" };

export interface CalendarSheetProps {
  connected: boolean;
  connecting: CalConnecting;
  calendarList: CalendarListItem[];
  selectedIds: Set<string>;
  onToggleCalendar: (id: string) => void;
  /** Starts the permission step, then shows the checklist. */
  onStartConnect: () => void;
  onConnectDone: () => void;
  onConnectCancel: () => void;
  /** Number of calendars currently chosen (for the manage row). */
  chosenCount: number;
  scope: CalScope;
  onScopeChange: (s: CalScope) => void;
  view: SourceView;
  onCheckNow: () => void;
  autoCheck: boolean;
  onAutoCheck: (v: boolean) => void;
  lastCheckDetail: string;
  onDisconnect: () => void;
}

export function CalendarSheet(p: CalendarSheetProps) {
  const { colors } = useTheme();

  if (p.connecting === "loading") {
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.lg }}>
        <ActivityIndicator color={colors.accent} />
        <Note>Checking calendar access</Note>
      </View>
    );
  }

  if (p.connecting === "picking") {
    return (
      <View>
        <Note>Choose which calendars to import. Recurring events are always left out.</Note>
        <View style={{ marginVertical: spacing.sm }}>
          {p.calendarList.map((cal) => (
            <CheckRow
              key={cal.id}
              label={cal.title}
              color={cal.color || colors.accent}
              checked={p.selectedIds.has(cal.id)}
              onPress={() => p.onToggleCalendar(cal.id)}
            />
          ))}
        </View>
        <PrimaryButton
          label={p.connected ? "Save calendars" : "Connect"}
          onPress={p.onConnectDone}
          disabled={p.selectedIds.size === 0}
        />
        <TextButton label="Cancel" onPress={p.onConnectCancel} align="center" />
      </View>
    );
  }

  if (!p.connected) {
    return (
      <View>
        <Note>
          Chronicle reads events that have ended from the calendars you choose, and adds them to your journal.
          It runs on this phone and nothing leaves it.
        </Note>
        <View style={{ marginTop: spacing.md }}>
          <PrimaryButton label="Choose calendars" onPress={p.onStartConnect} />
        </View>
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
      disconnectNote="Events already imported stay in your journal."
    >
      <ValueRow
        label="Calendars"
        value={`${p.chosenCount} chosen`}
        actionLabel="Edit calendars"
        onAction={p.onStartConnect}
      />
      <View style={{ paddingVertical: spacing.sm }}>
        <FieldLabel>Range for Check now</FieldLabel>
        {(["last-year", "all-time"] as CalScope[]).map((s) => (
          <RadioRow key={s} label={CAL_SCOPE_LABELS[s]} selected={p.scope === s} onPress={() => p.onScopeChange(s)} />
        ))}
      </View>
    </ManageLayout>
  );
}
