/**
 * Photos: connect (first scan) and manage sheet body
 * (docs/specs/sources-page.md, sections 6.1 and 6.2).
 *
 * One component for both modes, because they share the scan progress and the
 * scope choice. The scan hook lives on the Sources screen so a scan keeps
 * running, and the row keeps showing "Checking", after the sheet is closed.
 */
import React from "react";
import { ActivityIndicator, Linking, View } from "react-native";
import { useTheme, spacing } from "../ThemeProvider";
import type { ScanScope } from "@chronicle/journal/sources/exif/types";
import type { ScanState } from "../../lib/exif/useExifScan";
import type { SourceView } from "../../lib/sourceRegistry";
import {
  FieldLabel, ManageLayout, NavRow, Note, PrimaryButton, RadioRow, TextButton, ValueRow,
} from "./sheetParts";

export interface PhotoScopeOption { label: string; value: ScanScope }

export function photoScopeOptions(): PhotoScopeOption[] {
  return [
    {
      label: "Last year",
      value: {
        kind: "date-range",
        start: new Date(Date.now() - 365 * 86400_000).toISOString().slice(0, 10),
        end: new Date().toISOString().slice(0, 10),
      },
    },
    { label: "All time", value: { kind: "all" } },
  ];
}

export function photoScopeLabel(scope: ScanScope): string {
  if (scope.kind === "all") return "All time";
  if (scope.kind === "date-range") return `${scope.start} to ${scope.end}`;
  if (scope.kind === "albums") return `${scope.albumIds.length} album${scope.albumIds.length !== 1 ? "s" : ""}`;
  return "Photos added since the last scan";
}

export function isScanActive(phase: ScanState["phase"]): boolean {
  return phase === "requesting-permissions" || phase === "scanning" || phase === "geocoding"
    || phase === "building" || phase === "committing";
}

/** One line describing a scan in progress or just finished. Empty when idle. */
export function scanText(s: ScanState): string {
  switch (s.phase) {
    case "requesting-permissions": return "Asking for photo access";
    case "scanning": return `${s.scanned} photo${s.scanned !== 1 ? "s" : ""} found`;
    case "geocoding":
      return s.pending > 0
        ? `${s.pending} location lookup${s.pending !== 1 ? "s" : ""} remaining`
        : "Finishing location lookups";
    case "building": return "Building place entries";
    case "committing": return "Saving";
    case "done": {
      const parts = [
        s.created > 0 ? `${s.created} new place entr${s.created !== 1 ? "ies" : "y"}` : null,
        s.extended > 0 ? `${s.extended} updated` : null,
      ].filter(Boolean);
      return parts.length ? parts.join(", ") : "Nothing new found";
    }
    case "cancelled": return "Scan cancelled";
    case "error": return `Scan failed: ${s.error ?? "unknown error"}`;
    case "permission-denied": return "Photo access is turned off. Allow it for Chronicle in your phone's settings.";
    default: return "";
  }
}

export interface PhotosSheetProps {
  connected: boolean;
  view: SourceView;
  scan: ScanState;
  scope: ScanScope;
  onScopeChange: (s: ScanScope) => void;
  /** Start a scan with the chosen scope (first scan when not connected, rescan when connected). */
  onScan: () => void;
  onCancelScan: () => void;
  /** Incremental check for new photos, with the row showing Checking. */
  onCheckNow: () => void;
  autoCheck: boolean;
  onAutoCheck: (v: boolean) => void;
  lastCheckDetail: string;
  onManagePlaces: () => void;
  onDisconnect: () => void;
}

export function PhotosSheet(p: PhotosSheetProps) {
  const { colors } = useTheme();
  const options = React.useMemo(photoScopeOptions, []);
  const active = isScanActive(p.scan.phase);
  const text = scanText(p.scan);
  const failed = p.scan.phase === "error" || p.scan.phase === "permission-denied";

  const progress = text ? (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginVertical: spacing.sm }}>
      {active ? <ActivityIndicator size="small" color={colors.accent} /> : null}
      <Note>{text}</Note>
    </View>
  ) : null;

  if (!p.connected) {
    return (
      <View>
        <Note>
          Chronicle reads the dates and places of the photos on this phone and adds one entry per place per day.
          It runs on this phone. Only coarse coordinates are sent for place name lookups, and no photos leave it.
        </Note>
        <View style={{ marginTop: spacing.md }}>
          <FieldLabel>Which photos?</FieldLabel>
          {options.map((o) => (
            <RadioRow
              key={o.label}
              label={o.label}
              selected={p.scope.kind === o.value.kind}
              disabled={active}
              onPress={() => p.onScopeChange(o.value)}
            />
          ))}
        </View>
        {progress}
        {p.scan.phase === "permission-denied" ? (
          <TextButton label="Open settings" onPress={() => void Linking.openSettings()} />
        ) : null}
        {active ? (
          <PrimaryButton label="Cancel scan" onPress={p.onCancelScan} />
        ) : (
          <PrimaryButton label={failed || p.scan.phase === "cancelled" ? "Try again" : "Scan photos"} onPress={p.onScan} />
        )}
        <Note>The first scan can take a while. After it, new photos are checked each time you open the app.</Note>
      </View>
    );
  }

  return (
    <ManageLayout
      view={p.view}
      checkLabel="Check now"
      onCheckNow={p.onCheckNow}
      checkDisabled={active}
      autoCheck={p.autoCheck}
      onAutoCheck={p.onAutoCheck}
      lastCheckDetail={p.lastCheckDetail}
      onDisconnect={p.onDisconnect}
      disconnectNote="Photo places already added stay in your journal."
    >
      <ValueRow label="Photos scanned" value={photoScopeLabel(p.scope)} />
      <NavRow label="Manage places" onPress={p.onManagePlaces} />
      <View style={{ paddingVertical: spacing.sm }}>
        <FieldLabel>Scan again</FieldLabel>
        {options.map((o) => (
          <RadioRow
            key={o.label}
            label={o.label}
            selected={p.scope.kind === o.value.kind}
            disabled={active}
            onPress={() => p.onScopeChange(o.value)}
          />
        ))}
        {progress}
        {active ? (
          <TextButton label="Cancel scan" onPress={p.onCancelScan} />
        ) : (
          <TextButton label="Scan again" onPress={p.onScan} />
        )}
      </View>
    </ManageLayout>
  );
}
