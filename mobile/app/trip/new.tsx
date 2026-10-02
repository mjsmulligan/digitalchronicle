/**
 * New trip screen — create a trip with title, dates, purpose, and optional notes.
 */
import { useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { putMany } from "@chronicle/journal/db";
import { uid, type Purpose } from "@chronicle/journal/types";

// ── helpers ───────────────────────────────────────────────────────────────────

const PURPOSES: { id: Purpose; label: string; emoji: string }[] = [
  { id: "leisure", label: "Leisure",  emoji: "🌴" },
  { id: "work",    label: "Work",     emoji: "💼" },
  { id: "family",  label: "Family",   emoji: "👨‍👩‍👧" },
  { id: "other",   label: "Other",    emoji: "📌" },
];

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

  const [title, setTitle]     = useState("");
  const [start, setStart]     = useState(today());
  const [end, setEnd]         = useState(today());
  const [purpose, setPurpose] = useState<Purpose | undefined>(undefined);
  const [notes, setNotes]     = useState("");
  const [saving, setSaving]   = useState(false);

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
        notes: notes.trim(),
        cover: "",
        createdAt: new Date().toISOString(),
        ...(purpose ? { purpose } : {}),
      };
      await putMany("trips", [trip]);
      router.replace(`/trip/${trip.id}`);
    } catch (err) {
      Alert.alert("Failed to save", String(err));
      setSaving(false);
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen
        options={{
          title: "New Trip",
          headerStyle: { backgroundColor: "#1e293b" },
          headerTintColor: "#f8fafc",
          headerShadowVisible: false,
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
      <View style={styles.dateRow}>
        <View style={styles.dateField}>
          <Text style={styles.label}>Start</Text>
          <TextInput
            style={styles.input}
            value={start}
            onChangeText={setStart}
            placeholder="YYYY-MM-DD"
            placeholderTextColor="#475569"
            keyboardType="numbers-and-punctuation"
          />
        </View>
        <View style={styles.dateField}>
          <Text style={styles.label}>End</Text>
          <TextInput
            style={styles.input}
            value={end}
            onChangeText={setEnd}
            placeholder="YYYY-MM-DD"
            placeholderTextColor="#475569"
            keyboardType="numbers-and-punctuation"
          />
        </View>
      </View>
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
            <Text style={styles.purposeEmoji}>{p.emoji}</Text>
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
        <Text style={styles.saveButtonText}>{saving ? "Saving…" : "Create trip"}</Text>
      </Pressable>
    </ScrollView>
  );
}

// ── styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a" },
  content: { padding: 20, paddingBottom: 48, gap: 6 },

  label: { color: "#94a3b8", fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6, marginTop: 16 },
  optional: { color: "#475569", fontWeight: "400", textTransform: "none", letterSpacing: 0 },

  input: {
    backgroundColor: "#1e293b",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#334155",
    color: "#f1f5f9",
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  inputMultiline: { minHeight: 100, paddingTop: 12 },

  dateRow: { flexDirection: "row", gap: 12 },
  dateField: { flex: 1 },
  validationError: { color: "#ef4444", fontSize: 12, marginTop: 4 },

  purposeRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  purposeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "#1e293b",
    borderWidth: 1,
    borderColor: "#334155",
  },
  purposeChipActive: { backgroundColor: "#312e81", borderColor: "#6366f1" },
  purposeEmoji: { fontSize: 14 },
  purposeLabel: { color: "#94a3b8", fontSize: 13, fontWeight: "600" },
  purposeLabelActive: { color: "#e0e7ff" },

  saveBtn: { color: "#818cf8", fontSize: 16, fontWeight: "600" },
  saveBtnDisabled: { opacity: 0.4 },

  saveButton: {
    backgroundColor: "#4f46e5",
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 24,
  },
  saveButtonDisabled: { opacity: 0.4 },
  saveButtonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
