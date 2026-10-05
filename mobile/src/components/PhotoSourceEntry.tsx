/**
 * WP15 — Photo library source entry.
 *
 * A self-contained card that shows the photo library scan source status and
 * lets the user start/cancel a scan and change the scope.
 *
 * Designed to live on the Sources page. It can move to any screen without
 * changes to the underlying scan logic (useExifScan, buildStagingPlan, etc.).
 *
 * Props:
 *   onReviewSuggestions — called when the user taps the pending count badge;
 *                         the host screen navigates to the Staging Hub.
 *
 * Internals:
 *   - Reads pending count from useJournal (no prop drilling needed).
 *   - Reads/writes the scan marker via scanPrefs (lastScannedAt, scope).
 *   - Runs the scan via useExifScan.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useJournal } from "@chronicle/journal/db";
import { useTheme, spacing, radius } from "./ThemeProvider";
import { useExifScan } from "../lib/exif/useExifScan";
import { getScanMarker, setScanMarker } from "../lib/exif/scanPrefs";
import type { ScanScope } from "../../../src/lib/journal/sources/exif/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtRelative(iso: string): string {
  const now  = Date.now();
  const then = new Date(iso).getTime();
  const secs = Math.round((now - then) / 1000);
  if (secs < 60)   return "just now";
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  const days = Math.round(secs / 86400);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

function scopeLabel(scope: ScanScope): string {
  if (scope.kind === "all")        return "All photos";
  if (scope.kind === "date-range") return `${scope.start} – ${scope.end}`;
  return `${scope.albumIds.length} album${scope.albumIds.length !== 1 ? "s" : ""}`;
}

const SCOPES: { label: string; value: ScanScope }[] = [
  { label: "All photos",    value: { kind: "all" } },
  // date-range and albums would be added by the user in a real UI;
  // for now we expose only "all" and a recent-30-days option.
  {
    label: "Last 30 days",
    value: {
      kind: "date-range",
      start: new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10),
      end:   new Date().toISOString().slice(0, 10),
    },
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

interface PhotoSourceEntryProps {
  /** Navigate to the staging hub to review pending suggestions. */
  onReviewSuggestions?: () => void;
}

export function PhotoSourceEntry({ onReviewSuggestions }: PhotoSourceEntryProps) {
  const { colors, fonts } = useTheme();
  const s = useMemo(() => styles(colors, fonts), [colors, fonts]);

  const journal     = useJournal();
  const { state: scan, start: startScan, cancel: cancelScan, reset: resetScan } = useExifScan();

  const [lastScannedAt, setLastScannedAt] = useState<string | null>(null);
  const [scope, setScope] = useState<ScanScope>({ kind: "all" });
  const [scopePickerOpen, setScopePickerOpen] = useState(false);

  // Load persisted scan marker on mount
  useEffect(() => {
    getScanMarker().then((m) => {
      if (m) {
        setLastScannedAt(m.lastScannedAt);
        setScope(m.scope);
      }
    });
  }, []);

  // Persist marker after each successful scan
  useEffect(() => {
    if (scan.phase === "done") {
      setScanMarker(scope).then(() => {
        setLastScannedAt(new Date().toISOString());
      });
    }
  }, [scan.phase, scope]);

  const pendingCount = useMemo(
    () => (journal.placeEntries ?? []).filter((e) => e.status === "pending").length,
    [journal.placeEntries],
  );

  const isActive =
    scan.phase === "requesting-permissions" ||
    scan.phase === "scanning"    ||
    scan.phase === "geocoding"   ||
    scan.phase === "building"    ||
    scan.phase === "committing";

  const handleScan = useCallback(() => {
    resetScan();
    startScan(scope);
  }, [resetScan, startScan, scope]);

  // ── Status line ─────────────────────────────────────────────────────────────
  const statusLine = useMemo(() => {
    switch (scan.phase) {
      case "idle":
        return lastScannedAt
          ? `Last scanned ${fmtRelative(lastScannedAt)}`
          : "Never scanned";
      case "requesting-permissions":
        return "Requesting permissions…";
      case "scanning":
        return `Scanning — ${scan.scanned} photos found`;
      case "geocoding":
        return `Looking up locations — ${scan.scanned} photos`;
      case "building":
        return "Building place entries…";
      case "committing":
        return "Saving…";
      case "done":
        return [
          scan.created > 0 ? `${scan.created} new suggestion${scan.created !== 1 ? "s" : ""}` : null,
          scan.extended > 0 ? `${scan.extended} updated` : null,
          scan.created === 0 && scan.extended === 0 ? "Nothing new" : null,
        ].filter(Boolean).join(" · ");
      case "error":
        return `Error: ${scan.error}`;
      case "cancelled":
        return "Scan cancelled";
      case "permission-denied":
        return "Photo library access denied — check Settings → Privacy → Photos";
      default:
        return "";
    }
  }, [scan, lastScannedAt]);

  const statusColor =
    scan.phase === "error" || scan.phase === "permission-denied"
      ? colors.error
      : scan.phase === "done"
      ? colors.success
      : colors.textMuted;

  return (
    <View style={s.card}>
      {/* Header row */}
      <View style={s.header}>
        <View style={s.iconWrap}>
          <Ionicons name="images-outline" size={20} color={colors.accent} />
        </View>
        <View style={s.headerText}>
          <Text style={s.title}>Photo library</Text>
          <Text style={[s.status, { color: statusColor }]}>{statusLine}</Text>
        </View>

        {/* Pending badge */}
        {pendingCount > 0 && (
          <Pressable
            style={s.pendingBadge}
            onPress={onReviewSuggestions}
            accessibilityLabel={`${pendingCount} pending suggestions — tap to review`}
          >
            <Text style={s.pendingBadgeText}>{pendingCount}</Text>
          </Pressable>
        )}
      </View>

      {/* Progress bar (while active) */}
      {isActive && (
        <View style={s.progressRow}>
          <ActivityIndicator size="small" color={colors.accent} style={{ marginRight: spacing.sm }} />
          {scan.phase === "scanning" && (
            <Text style={s.progressText}>
              {scan.scanned} photo{scan.scanned !== 1 ? "s" : ""}
              {scan.pending > 0 ? ` · ${scan.pending} pending lookups` : ""}
            </Text>
          )}
          {scan.phase === "geocoding" && (
            <Text style={s.progressText}>
              {scan.pending > 0 ? `${scan.pending} location lookup${scan.pending !== 1 ? "s" : ""} remaining` : "Finishing location lookups…"}
            </Text>
          )}
        </View>
      )}

      {/* Scope row */}
      <Pressable style={s.scopeRow} onPress={() => setScopePickerOpen((v) => !v)}>
        <Ionicons name="options-outline" size={14} color={colors.textMuted} />
        <Text style={s.scopeLabel}>{scopeLabel(scope)}</Text>
        <Ionicons
          name={scopePickerOpen ? "chevron-up" : "chevron-down"}
          size={13}
          color={colors.textMuted}
        />
      </Pressable>

      {/* Scope picker */}
      {scopePickerOpen && (
        <View style={s.scopePicker}>
          {SCOPES.map((opt, i) => (
            <Pressable
              key={i}
              style={[
                s.scopeOption,
                scope.kind === opt.value.kind && s.scopeOptionActive,
              ]}
              onPress={() => {
                setScope(opt.value);
                setScopePickerOpen(false);
              }}
            >
              <Text
                style={[
                  s.scopeOptionText,
                  scope.kind === opt.value.kind && s.scopeOptionTextActive,
                ]}
              >
                {opt.label}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {/* Action buttons */}
      <View style={s.actions}>
        {isActive ? (
          <Pressable style={[s.btn, s.cancelBtn]} onPress={cancelScan}>
            <Ionicons name="stop-circle-outline" size={16} color={colors.textSecondary} />
            <Text style={[s.btnText, { color: colors.textSecondary }]}>Cancel</Text>
          </Pressable>
        ) : (
          <Pressable style={[s.btn, s.scanBtn]} onPress={handleScan}>
            <Ionicons name="refresh-outline" size={16} color={colors.white} />
            <Text style={s.btnText}>
              {scan.phase === "done" || lastScannedAt ? "Re-scan" : "Scan now"}
            </Text>
          </Pressable>
        )}

        {pendingCount > 0 && onReviewSuggestions && (
          <Pressable style={[s.btn, s.reviewBtn]} onPress={onReviewSuggestions}>
            <Text style={[s.btnText, { color: colors.accent }]}>
              Review {pendingCount} suggestion{pendingCount !== 1 ? "s" : ""}
            </Text>
            <Ionicons name="chevron-forward" size={14} color={colors.accent} />
          </Pressable>
        )}
      </View>

      {/* Privacy note */}
      <Text style={s.privacyNote}>
        Runs on-device. Only coarsened coordinates are sent for location lookups — no photos leave your phone.
      </Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function styles(colors: any, fonts: any) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: colors.borderFaint,
      padding: spacing.lg,
      marginHorizontal: spacing.lg,
      marginBottom: spacing.md,
    },
    header: {
      flexDirection: "row",
      alignItems: "flex-start",
      marginBottom: spacing.sm,
    },
    iconWrap: {
      width: 36,
      height: 36,
      borderRadius: radius.lg,
      backgroundColor: colors.accentSubtle,
      alignItems: "center",
      justifyContent: "center",
      marginRight: spacing.md,
    },
    headerText: { flex: 1 },
    title: {
      fontSize: 15,
      fontFamily: fonts.serifSemiBold,
      color: colors.textPrimary,
      marginBottom: 2,
    },
    status: {
      fontSize: 12,
      lineHeight: 17,
    },
    pendingBadge: {
      backgroundColor: colors.accentBold,
      borderRadius: 12,
      minWidth: 24,
      height: 24,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 6,
    },
    pendingBadgeText: {
      fontSize: 12,
      color: colors.white,
      fontFamily: fonts.sansMedium ?? fonts.sans,
    },
    progressRow: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: spacing.sm,
      paddingTop: spacing.xs,
    },
    progressText: {
      fontSize: 12,
      color: colors.textMuted,
      flex: 1,
    },
    scopeRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      paddingVertical: spacing.xs,
      marginBottom: spacing.xs,
    },
    scopeLabel: {
      fontSize: 12,
      color: colors.textMuted,
      flex: 1,
    },
    scopePicker: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.borderFaint,
      marginBottom: spacing.sm,
      paddingTop: spacing.sm,
      gap: spacing.xs,
    },
    scopeOption: {
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: radius.md,
    },
    scopeOptionActive: {
      backgroundColor: colors.accentSubtle,
    },
    scopeOptionText: {
      fontSize: 13,
      color: colors.textSecondary,
    },
    scopeOptionTextActive: {
      color: colors.accent,
    },
    actions: {
      flexDirection: "row",
      gap: spacing.sm,
      marginTop: spacing.sm,
    },
    btn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 4,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: radius.md,
    },
    scanBtn: {
      backgroundColor: colors.accentBold,
    },
    cancelBtn: {
      backgroundColor: "transparent",
      borderWidth: 1,
      borderColor: colors.border,
    },
    reviewBtn: {
      flex: 1,
      backgroundColor: "transparent",
      borderWidth: 1,
      borderColor: colors.accent,
    },
    btnText: {
      fontSize: 13,
      color: colors.white,
      fontFamily: fonts.sansMedium ?? fonts.sans,
    },
    privacyNote: {
      fontSize: 11,
      color: colors.textMuted,
      lineHeight: 16,
      marginTop: spacing.md,
    },
  });
}
