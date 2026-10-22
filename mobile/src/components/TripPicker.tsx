/**
 * TripPicker — bottom-sheet modal for assigning an entry to a trip.
 *
 * Shows all trips sorted newest-first. A "No trip" row at the top
 * allows unlinking. The currently linked trip is highlighted with a
 * checkmark. Single-selection; confirm saves on dismiss.
 *
 * Usage:
 *   <TripPicker
 *     visible={pickerVisible}
 *     selectedId={entry.tripId}
 *     trips={journal.trips}
 *     onConfirm={(id) => { ... }}
 *     onDismiss={() => setPickerVisible(false)}
 *   />
 */
import { useMemo, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Trip } from "@chronicle/journal/types";
import {
  useTheme,
  type ThemeColors,
  type ThemeFonts,
  text as textScale,
  spacing as spacingScale,
  radius as radiusScale,
} from "./ThemeProvider";

// ── helpers ────────────────────────────────────────────────────────────────────

const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun",
                      "Jul","Aug","Sep","Oct","Nov","Dec"];

function fmtShort(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

// ── styles factory ─────────────────────────────────────────────────────────────

function createStyles(colors: ThemeColors, fonts: ThemeFonts) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.55)",
      justifyContent: "flex-end",
    },
    sheet: {
      backgroundColor: colors.bg,
      borderTopLeftRadius: radiusScale["2xl"],
      borderTopRightRadius: radiusScale["2xl"],
      paddingBottom: spacingScale["3xl"],
      maxHeight: "75%",
    },
    handle: {
      width: 36,
      height: 4,
      backgroundColor: colors.border,
      borderRadius: 2,
      alignSelf: "center",
      marginTop: spacingScale.md,
      marginBottom: spacingScale.md,
    },
    title: {
      ...textScale.lg,
      fontFamily: fonts.serifBold,
      fontWeight: "700",
      color: colors.textPrimary,
      paddingHorizontal: spacingScale.lg,
      marginBottom: spacingScale.sm,
    },

    list: { flexGrow: 0 },

    row: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: spacingScale.base,
      paddingVertical: spacingScale.md,
      gap: spacingScale.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderFaint,
    },
    rowPressed: { backgroundColor: colors.surfacePressed },
    rowSelected: { backgroundColor: colors.surfaceAccent },

    iconWrap: {
      width: 36,
      height: 36,
      borderRadius: radiusScale.full,
      backgroundColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    iconWrapSelected: { backgroundColor: colors.surfaceAccentDeep },

    rowText: { flex: 1 },
    rowTitle: {
      ...textScale.base,
      color: colors.textPrimary,
    },
    rowTitleSelected: { color: colors.accentSoft, fontWeight: "600" },
    rowMeta: {
      ...textScale.sm,
      color: colors.textTertiary,
      fontFamily: fonts.mono,
      marginTop: 1,
    },

    noTripLabel: {
      ...textScale.base,
      color: colors.textMuted,
      flex: 1,
    },
    noTripLabelSelected: { color: colors.accentSoft, fontWeight: "600" },

    confirmBtn: {
      marginHorizontal: spacingScale.base,
      marginTop: spacingScale.base,
      paddingVertical: spacingScale.md,
      borderRadius: radiusScale.pill,
      backgroundColor: colors.accentBold,
      alignItems: "center",
    },
    confirmText: {
      ...textScale.base,
      fontWeight: "700",
      color: colors.white,
    },
  });
}

// ── component ──────────────────────────────────────────────────────────────────

interface Props {
  visible: boolean;
  /** Currently linked trip ID, or undefined if none */
  selectedId: string | undefined;
  trips: Trip[];
  onConfirm: (id: string | undefined) => void;
  onDismiss: () => void;
  /** Sheet title — defaults to "Add to trip" */
  title?: string;
  /** Hide the "No trip" row — useful when the picker is used for merge, not assignment */
  hideNoTrip?: boolean;
}

export function TripPicker({ visible, selectedId, trips, onConfirm, onDismiss, title = "Add to trip", hideNoTrip = false }: Props) {
  const { colors, fonts } = useTheme();
  const styles = useMemo(() => createStyles(colors, fonts), [colors, fonts]);

  const [localId, setLocalId] = useState<string | undefined>(selectedId);

  // Sync local state when the picker opens
  const handleShow = () => setLocalId(selectedId);

  const sorted = useMemo(
    () => [...trips].sort((a, b) => b.start.localeCompare(a.start)),
    [trips],
  );

  const confirmLabel = localId
    ? (trips.find((t) => t.id === localId)?.title ?? "Selected") + " · Done"
    : "No trip · Done";

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onShow={handleShow}
      onRequestClose={onDismiss}
    >
      <Pressable style={styles.overlay} onPress={onDismiss}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />
          <Text style={styles.title}>{title}</Text>

          <FlatList
            data={sorted}
            keyExtractor={(t) => t.id}
            style={styles.list}
            ListHeaderComponent={hideNoTrip ? null :
              /* "No trip" row */
              <Pressable
                style={({ pressed }) => [
                  styles.row,
                  pressed && styles.rowPressed,
                  !localId && styles.rowSelected,
                ]}
                onPress={() => setLocalId(undefined)}
              >
                <View style={[styles.iconWrap, !localId && styles.iconWrapSelected]}>
                  <Ionicons
                    name="remove-circle-outline"
                    size={18}
                    color={!localId ? colors.accentSoft : colors.textMuted}
                  />
                </View>
                <Text style={[styles.noTripLabel, !localId && styles.noTripLabelSelected]}>
                  No trip
                </Text>
                {!localId && (
                  <Ionicons name="checkmark" size={20} color={colors.accentSoft} />
                )}
              </Pressable>
            }
            renderItem={({ item: trip }) => {
              const isSelected = localId === trip.id;
              return (
                <Pressable
                  style={({ pressed }) => [
                    styles.row,
                    pressed && styles.rowPressed,
                    isSelected && styles.rowSelected,
                  ]}
                  onPress={() => setLocalId(trip.id)}
                >
                  <View style={[styles.iconWrap, isSelected && styles.iconWrapSelected]}>
                    <Ionicons
                      name="location-outline"
                      size={18}
                      color={isSelected ? colors.accentSoft : colors.textSecondary}
                    />
                  </View>
                  <View style={styles.rowText}>
                    <Text
                      style={[styles.rowTitle, isSelected && styles.rowTitleSelected]}
                      numberOfLines={1}
                    >
                      {trip.title}
                    </Text>
                    <Text style={styles.rowMeta}>
                      {fmtShort(trip.start)} → {fmtShort(trip.end)}
                    </Text>
                  </View>
                  {isSelected && (
                    <Ionicons name="checkmark" size={20} color={colors.accentSoft} />
                  )}
                </Pressable>
              );
            }}
          />

          <Pressable style={styles.confirmBtn} onPress={() => onConfirm(localId)}>
            <Text style={styles.confirmText}>{confirmLabel}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
