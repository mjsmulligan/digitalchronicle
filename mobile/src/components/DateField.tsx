/**
 * DateField — a themed date input that uses the native date picker.
 *
 * Props:
 *   label    — field label shown above the pressable
 *   value    — YYYY-MM-DD string (the stored format)
 *   onChange — called with a new YYYY-MM-DD string when the user picks a date
 *
 * Platform behaviour:
 *   iOS     — tapping the field opens a bottom-sheet modal with a spinner
 *             picker and Done / Cancel buttons.
 *   Android — tapping the field opens the native date picker dialog directly.
 *
 * Requires: @react-native-community/datetimepicker
 * Install:  npx expo install @react-native-community/datetimepicker
 */
import React, { useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { useTheme } from "./ThemeProvider";

// ── helpers ───────────────────────────────────────────────────────────────────

const MONTHS_FULL = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

/** YYYY-MM-DD → "4 January 2026" */
function formatDisplay(iso: string): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso + "T12:00:00");
  return `${d.getDate()} ${MONTHS_FULL[d.getMonth()]} ${d.getFullYear()}`;
}

/** Date → YYYY-MM-DD */
function toISO(d: Date): string {
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

// ── component ─────────────────────────────────────────────────────────────────

interface DateFieldProps {
  label: string;
  value: string;          // YYYY-MM-DD
  onChange: (iso: string) => void;
  minimumDate?: Date;
  maximumDate?: Date;
}

export function DateField({ label, value, onChange, minimumDate, maximumDate }: DateFieldProps) {
  const { colors, fonts, text, spacing, radius } = useTheme();
  const [showPicker, setShowPicker] = useState(false);
  // iOS: hold a draft date while the modal is open so we only commit on "Done"
  const [draft, setDraft] = useState<Date | null>(null);

  const currentDate = value && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(value + "T12:00:00")
    : new Date();

  const handlePress = () => {
    if (Platform.OS === "ios") {
      setDraft(currentDate);
    }
    setShowPicker(true);
  };

  const handleChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === "android") {
      setShowPicker(false);
      if (event.type === "set" && selected) {
        onChange(toISO(selected));
      }
      return;
    }
    // iOS — update draft without committing
    if (selected) setDraft(selected);
  };

  const handleDone = () => {
    if (draft) onChange(toISO(draft));
    setShowPicker(false);
    setDraft(null);
  };

  const handleCancel = () => {
    setShowPicker(false);
    setDraft(null);
  };

  const styles = StyleSheet.create({
    label: {
      ...text.label,
      color: colors.textSecondary,
      marginBottom: 6,
      marginTop: spacing.base,
    },
    field: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.md2,
      paddingVertical: spacing.md,
      justifyContent: "center",
    },
    fieldText: {
      ...text.lg,
      color: colors.textPrimary,
      fontFamily: fonts.sans,
    },
    // iOS modal
    modalOverlay: {
      flex: 1,
      justifyContent: "flex-end",
      backgroundColor: "rgba(0,0,0,0.35)",
    },
    modalSheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: radius["2xl"],
      borderTopRightRadius: radius["2xl"],
      paddingBottom: spacing["3xl"],
    },
    modalToolbar: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    modalBtn: {
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
    },
    modalBtnCancel: { ...text.md, color: colors.textSecondary },
    modalBtnDone:   { ...text.md, color: colors.accentSoft, fontWeight: "700" },
    modalTitle:     { ...text.smMd, color: colors.textPrimary, fontWeight: "600" },
  });

  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        style={({ pressed }) => [styles.field, { opacity: pressed ? 0.7 : 1 }]}
        onPress={handlePress}
        accessibilityLabel={`${label}: ${formatDisplay(value)}`}
        accessibilityRole="button"
      >
        <Text style={styles.fieldText}>{formatDisplay(value)}</Text>
      </Pressable>

      {/* Android: native dialog */}
      {Platform.OS === "android" && showPicker && (
        <DateTimePicker
          value={currentDate}
          mode="date"
          display="default"
          onChange={(event: DateTimePickerEvent, selected?: Date) => {
            setShowPicker(false);
            if (event.type === "set" && selected) onChange(toISO(selected));
          }}
          minimumDate={minimumDate}
          maximumDate={maximumDate}
        />
      )}

      {/* iOS: bottom-sheet modal with spinner and Done/Cancel */}
      {Platform.OS === "ios" && (
        <Modal
          visible={showPicker}
          transparent
          animationType="slide"
          onRequestClose={handleCancel}
        >
          <Pressable style={styles.modalOverlay} onPress={handleCancel}>
            <Pressable style={styles.modalSheet} onPress={() => {}}>
              <View style={styles.modalToolbar}>
                <Pressable style={styles.modalBtn} onPress={handleCancel}>
                  <Text style={styles.modalBtnCancel}>Cancel</Text>
                </Pressable>
                <Text style={styles.modalTitle}>{label}</Text>
                <Pressable style={styles.modalBtn} onPress={handleDone}>
                  <Text style={styles.modalBtnDone}>Done</Text>
                </Pressable>
              </View>
              <DateTimePicker
                value={draft ?? currentDate}
                mode="date"
                display="spinner"
                onChange={handleChange}
                minimumDate={minimumDate}
                maximumDate={maximumDate}
                style={{ backgroundColor: colors.surface }}
                textColor={colors.textPrimary}
              />
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </View>
  );
}
