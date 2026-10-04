/**
 * Edit trip screen — pre-populate from an existing trip and save changes.
 * Reuses the same form layout as new.tsx.
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
import { useDialog, Dialog } from "../../../src/components/Dialog";
import { DateField } from "../../../src/components/DateField";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useJournal, putMany } from "@chronicle/journal/db";
import { type Purpose } from "@chronicle/journal/types";
import { useTheme } from "../../../src/components/ThemeProvider";
import { KindIcon } from "../../../src/components/KindIcon";

// ── helpers ───────────────────────────────────────────────────────────────────

const PURPOSES: { id: Purpose; label: string; kind: string }[] = [
  { id: "leisure", label: "Leisure",  kind: "leisure" },
  { id: "work",    label: "Work",     kind: "work" },
  { id: "family",  label: "Family",   kind: "family" },
  { id: "other",   label: "Other",    kind: "location" },
];

/** Basic YYYY-MM-DD validation */
function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
}

// ── screen ────────────────────────────────────────────────────────────────────

export default function EditTripScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router  = useRouter();
  const journal = useJournal();
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

    purposeRow: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
    purposeChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm2,
      paddingHorizontal: spacing.md2,
      paddingVertical: spacing.sm,
      borderRadius: radius.pill,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    purposeChipActive: { backgroundColor: colors.surfaceAccent, borderColor: colors.accent },
    purposeIconWrap: { marginTop: 1 },
    purposeLabel: { ...text.smMd, color: colors.textSecondary, fontWeight: "600" },
    purposeLabelActive: { color: colors.accentSubtle },

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

    notFound: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
    notFoundText: { ...text.lg, color: colors.textTertiary },
  }), [colors, fonts]);

  const trip = useMemo(
    () => journal.trips.find((t) => t.id === id),
    [journal, id]
  );

  const [title, setTitle]     = useState(trip?.title     ?? "");
  const [start, setStart]     = useState(trip?.start     ?? "");
  const [end, setEnd]         = useState(trip?.end       ?? "");
  const [purpose, setPurpose] = useState<Purpose | undefined>(trip?.purpose);
  const [notes, setNotes]     = useState(trip?.notes     ?? "");
  const [saving, setSaving]   = useState(false);
  const dialog = useDialog();

  if (!trip) {
    return (
      <View style={styles.notFound}>
        <Stack.Screen options={{ title: "Edit Trip", ...common.header }} />
        <Text style={styles.notFoundText}>Trip not found</Text>
      </View>
    );
  }

  const canSave = title.trim().length > 0 && isValidDate(start) && isValidDate(end) && start <= end;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const updated = {
        ...trip,
        title: title.trim(),
        start,
        end,
        notes: notes.trim(),
        purpose: purpose ?? undefined,
      };
      // Remove purpose key entirely if unset (keeps data model clean)
      if (!updated.purpose) delete updated.purpose;
      await putMany("trips", [updated]);
      router.back();
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
          title: "Edit Trip",
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

      {/* Purpose */}
      <Text style={styles.label}>Purpose</Text>
      <View style={styles.purposeRow}>
        {PURPOSES.map((p) => (
          <Pressable
            key={p.id}
            style={[styles.purposeChip, purpose === p.id && styles.purposeChipActive]}
            onPress={() => setPurpose(purpose === p.id ? undefined : p.id)}
          >
            <View style={styles.purposeIconWrap}>
              <KindIcon
                kind={p.kind}
                size={14}
                color={purpose === p.id ? colors.accentSubtle : colors.textSecondary}
                accessibilityLabel=""
              />
            </View>
            <Text style={[styles.purposeLabel, purpose === p.id && styles.purposeLabelActive]}>
              {p.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Notes */}
      <Text style={styles.label}>Notes <Text style={styles.optional}>(optional)</Text></Text>
      <TextInput
        style={[styles.input, styles.inputMultiline]}
        value={notes}
        onChangeText={setNotes}
        placeholder="Any notes about this trip…"
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
        <Text style={styles.saveButtonText}>{saving ? "Saving…" : "Save changes"}</Text>
      </Pressable>
    </ScrollView>
    <Dialog {...dialog.props} onDismiss={dialog.dismiss} />
    </>
  );
}
