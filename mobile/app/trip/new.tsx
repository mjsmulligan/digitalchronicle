/**
 * New trip screen — create a trip with title, dates, purpose, and optional notes.
 */
import { useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useDialog, Dialog } from "../../src/components/Dialog";
import { DateField } from "../../src/components/DateField";
import { Stack, useRouter } from "expo-router";
import { putMany } from "@chronicle/journal/db";
import { uid } from "@chronicle/journal/types";
import { useTheme } from "../../src/components/ThemeProvider";

/** Returns today as YYYY-MM-DD */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Basic YYYY-MM-DD validation */
function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
}

// ── screen ────────────────────────────────────────────────────────────────────

export default function NewTripScreen() {
  const router = useRouter();
  const { colors, fonts, text, spacing, radius, common } = useTheme();

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    content: { padding: spacing.lg, paddingBottom: spacing["3xl"], gap: 6 },

    label: { ...text.label, color: colors.textSecondary, marginBottom: 6, marginTop: spacing.base },
    optional: { fontWeight: "400", textTransform: "none", letterSpacing: 0, color: colors.textMuted },

    input: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      color: colors.textPrimary,
      ...text.lg,
      paddingHorizontal: spacing.md2,
      paddingVertical: spacing.md,
    },
    inputMultiline: { minHeight: 100, paddingTop: spacing.md },

    dateRow: { flexDirection: "row", gap: spacing.md },
    dateField: { flex: 1 },
    validationError: { ...text.sm, color: colors.error, marginTop: 4 },

    saveBtn: { ...text.lg, color: colors.accentSoft, fontWeight: "600" },
    saveBtnDisabled: { opacity: 0.4 },

    saveButton: {
      backgroundColor: colors.accentBold,
      borderRadius: radius.xl,
      paddingVertical: 15,
      alignItems: "center",
      marginTop: spacing.xl,
    },
    saveButtonDisabled: { opacity: 0.4 },
    saveButtonText: { color: colors.white, fontSize: 16, fontWeight: "700" },
  }), [colors, fonts]);

  const [title, setTitle]         = useState("");
  const [start, setStart]         = useState(today());
  const [end, setEnd]             = useState(today());
  const [reflection, setReflection] = useState("");
  const [rating, setRating]       = useState<number | undefined>(undefined);
  const [saving, setSaving]       = useState(false);
  const dialog = useDialog();

  const canSave = title.trim().length > 0 && isValidDate(start) && isValidDate(end) && start <= end;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const trip = {
        id: uid(),
        title: title.trim(),
        start,
        end,
        cover: "",
        createdAt: new Date().toISOString(),
        ...(reflection.trim() ? { reflection: reflection.trim() } : {}),
        ...(rating !== undefined ? { rating } : {}),
      };
      await putMany("trips", [trip]);
      router.replace(`/trip/${trip.id}`);
    } catch (err) {
      dialog.alert("Failed to save", String(err));
      setSaving(false);
    }
  };

  return (
    <>
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen
        options={{
          title: "New Trip",
          ...common.header,
          headerRight: () => (
            <Pressable
              onPress={handleSave}
              disabled={!canSave || saving}
              style={{ marginRight: 4, padding: 8 }}
            >
              <Text style={[styles.saveBtn, (!canSave || saving) && styles.saveBtnDisabled]}>
                {saving ? "Saving…" : "Save"}
              </Text>
            </Pressable>
          ),
        }}
      />

      {/* Title */}
      <Text style={styles.label}>Title</Text>
      <TextInput
        style={styles.input}
        value={title}
        onChangeText={setTitle}
        placeholder="e.g. Tokyo 2026"
        placeholderTextColor="#475569"
        autoFocus
        returnKeyType="next"
      />

      {/* Dates */}
      <DateField
        label="Start"
        value={start}
        onChange={setStart}
      />
      <DateField
        label="End"
        value={end}
        onChange={setEnd}
        minimumDate={isValidDate(start) ? new Date(start + "T12:00:00") : undefined}
      />
      {start > end && isValidDate(start) && isValidDate(end) && (
        <Text style={styles.validationError}>End date must be on or after start date</Text>
      )}

      {/* Rating */}
      <Text style={styles.label}>Rating <Text style={styles.optional}>(optional)</Text></Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        {[2, 4, 6, 8, 10].map((val) => (
          <Pressable
            key={val}
            onPress={() => setRating(rating === val ? undefined : val)}
            style={{
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: rating !== undefined && rating >= val ? colors.accent : colors.border,
              backgroundColor: rating !== undefined && rating >= val ? colors.surfaceAccent : colors.surface,
            }}
          >
            <Text style={{ fontFamily: fonts.mono, fontSize: 12, color: rating !== undefined && rating >= val ? colors.accentSubtle : colors.textTertiary }}>
              {"★".repeat(val / 2)}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Reflection */}
      <Text style={styles.label}>Reflection <Text style={styles.optional}>(optional)</Text></Text>
      <TextInput
        style={[styles.input, styles.inputMultiline]}
        value={reflection}
        onChangeText={setReflection}
        placeholder="Trip reflection…"
        placeholderTextColor="#475569"
        multiline
        numberOfLines={4}
        textAlignVertical="top"
      />

      {/* Save button (bottom) */}
      <Pressable
        style={[styles.saveButton, (!canSave || saving) && styles.saveButtonDisabled]}
        onPress={handleSave}
        disabled={!canSave || saving}
      >
        <Text style={styles.saveButtonText}>{saving ? "Saving…" : "Create trip"}</Text>
      </Pressable>
    </ScrollView>
    <Dialog {...dialog.props} onDismiss={dialog.dismiss} />
    </>
  );
}
