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

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
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
  if (scope.kind === "all")        return "All time";
  if (scope.kind === "date-range") return `${scope.start} – ${scope.end}`;
  return `${scope.albumIds.length} album${scope.albumIds.length !== 1 ? "s" : ""}`;
}

const SCOPES: { label: string; value: ScanScope }[] = [
  {
    label: "Last year",
    value: {
      kind: "date-range",
      start: new Date(Date.now() - 365 * 86400_000).toISOString().slice(0, 10),
      end:   new Date().toISOString().slice(0, 10),
    },
  },
  { label: "All time", value: { kind: "all" } },
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

  // Animated progress bar — indeterminate while scanning, reaches 1.0 on done
  const progressAnim = useRef(new Animated.Value(0)).current;
  const loopRef = useRef<Animated.CompositeAnimation | null>(null);
  useEffect(() => {
    if (isActive) {
      // Gentle pulsing advance: cycles between 15% and 70%
      loopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(progressAnim, { toValue: 0.7, duration: 1400, useNativeDriver: false }),
          Animated.timing(progressAnim, { toValue: 0.15, duration: 1000, useNativeDriver: false }),
        ]),
      );
      loopRef.current.start();
    } else {
      loopRef.current?.stop();
      Animated.timing(progressAnim, {
        toValue: scan.phase === "done" ? 1 : 0,
        duration: scan.phase === "done" ? 300 : 200,
        useNativeDriver: false,
      }).start();
    }
  }, [isActive, scan.phase]);

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
      {/* Header row — icon · title/status · action button (inline, matches other source cards) */}
      <View style={s.header}>
        <View style={s.iconWrap}>
          <Ionicons name="images-outline" size={20} color={colors.accent} />
        </View>
        <View style={s.headerText}>
          <Text style={s.title}>Photo library</Text>
          <Text style={[s.status, { color: statusColor }]}>{statusLine}</Text>
        </View>

        {/* Primary action — inline right, same position as Sync / Connect / Choose file */}
        {isActive ? (
          <Pressable style={[s.actionBtn, s.cancelBtn]} onPress={cancelScan}>
            <Text style={[s.actionBtnText, { color: colors.textSecondary }]}>Cancel</Text>
          </Pressable>
        ) : (
          <Pressable style={[s.actionBtn, s.scanBtn]} onPress={handleScan}>
            <Text style={s.actionBtnText}>
              {scan.phase === "done" || lastScannedAt ? "Re-scan" : "Scan now"}
            </Text>
          </Pressable>
        )}
      </View>

      {/* Progress bar — shown while active or just finished */}
      {(isActive || scan.phase === "done") && (
        <View style={s.progressCard}>
          {isActive && (
            <View style={s.progressTop}>
              <ActivityIndicator size="small" color={colors.accent} />
              <Text style={s.progressText} numberOfLines={1}>
                {scan.phase === "scanning"
                  ? `${scan.scanned} photo${scan.scanned !== 1 ? "s" : ""} found${scan.pending > 0 ? ` · ${scan.pending} pending` : ""}`
                  : scan.phase === "geocoding"
                  ? scan.pending > 0
                    ? `${scan.pending} location lookup${scan.pending !== 1 ? "s" : ""} remaining`
                    : "Finishing location lookups…"
                  : scan.phase === "building"
                  ? "Building place entries…"
                  : "Saving…"}
              </Text>
            </View>
          )}
          <View style={s.progressTrack}>
            <Animated.View
              style={[
                s.progressFill,
                {
                  width: progressAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: ["0%", "100%"],
                  }),
                },
              ]}
            />
          </View>
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

      {/* Review link — shown when there are pending suggestions */}
      {pendingCount > 0 && onReviewSuggestions && (
        <Pressable style={s.reviewRow} onPress={onReviewSuggestions}>
          <Text style={[s.reviewText, { color: colors.accent }]}>
            Review {pendingCount} suggestion{pendingCount !== 1 ? "s" : ""}
          </Text>
          <Ionicons name="chevron-forward" size={14} color={colors.accent} />
        </Pressable>
      )}

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
      alignItems: "center",
      marginBottom: spacing.sm,
    },
    iconWrap: {
      width: 36,
      height: 36,
      borderRadius: radius.lg,
      // surfaceAccent is a light warm cream — gives readable contrast with accentBold icon
      backgroundColor: colors.surfaceAccent,
      alignItems: "center",
      justifyContent: "center",
      marginRight: spacing.md,
      flexShrink: 0,
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
    // Inline action button — same size/style as Sync / Connect / Choose file
    actionBtn: {
      paddingVertical: spacing.xs + 1,
      paddingHorizontal: spacing.md,
      borderRadius: radius.md,
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
      marginLeft: spacing.sm,
    },
    scanBtn: {
      backgroundColor: colors.accentBold,
    },
    cancelBtn: {
      backgroundColor: "transparent",
      borderWidth: 1,
      borderColor: colors.border,
    },
    actionBtnText: {
      fontSize: 13,
      color: colors.white,
      fontFamily: fonts.sansMedium ?? fonts.sans,
      fontWeight: "600",
    },
    progressCard: {
      gap: spacing.xs,
      marginBottom: spacing.sm,
    },
    progressTop: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    progressText: {
      fontSize: 12,
      color: colors.textMuted,
      flex: 1,
    },
    progressTrack: {
      height: 3,
      backgroundColor: colors.borderFaint,
      borderRadius: 2,
      overflow: "hidden",
    },
    progressFill: {
      height: "100%",
      backgroundColor: colors.accent,
      borderRadius: 2,
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
    reviewRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingVertical: spacing.xs,
      marginTop: spacing.xs,
    },
    reviewText: {
      fontSize: 13,
      fontWeight: "600",
    },
    privacyNote: {
      fontSize: 11,
      color: colors.textMuted,
      lineHeight: 16,
      marginTop: spacing.md,
    },
  });
}
