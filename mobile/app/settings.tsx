/**
 * Settings screen — developer/utility options.
 * Reachable via the gear icon in the Chronicle header.
 */
import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { clearAll, useJournal } from "@chronicle/journal/db";
import { colors, text, spacing, radius } from "../src/theme";

export default function SettingsScreen() {
  const journal = useJournal();
  const [clearing, setClearing] = useState(false);

  const entryCount =
    journal.legs.length +
    journal.stays.length +
    journal.events.length +
    journal.films.length +
    journal.episodes.length +
    journal.books.length;

  const handleReset = () => {
    Alert.alert(
      "Reset database",
      `This will permanently delete all ${entryCount.toLocaleString()} entries and ${journal.staging.length} pending import${journal.staging.length === 1 ? "" : "s"}. This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset",
          style: "destructive",
          onPress: async () => {
            setClearing(true);
            try {
              await clearAll();
            } finally {
              setClearing(false);
            }
          },
        },
      ]
    );
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Stack.Screen
        options={{
          title: "Settings",
          headerStyle: { backgroundColor: "#1e293b" },
          headerTintColor: "#f8fafc",
          headerShadowVisible: false,
        }}
      />

      <Text style={styles.sectionTitle}>Database</Text>

      <View style={styles.card}>
        <View style={styles.statRow}>
          <Text style={styles.statLabel}>Journal entries</Text>
          <Text style={styles.statValue}>{entryCount.toLocaleString()}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.statRow}>
          <Text style={styles.statLabel}>Pending imports</Text>
          <Text style={styles.statValue}>{journal.staging.length}</Text>
        </View>
      </View>

      <Pressable
        style={[styles.resetBtn, clearing && styles.resetBtnDisabled]}
        onPress={handleReset}
        disabled={clearing}
      >
        <Ionicons name="trash-outline" size={18} color={colors.error} />
        <Text style={styles.resetBtnText}>
          {clearing ? "Clearing…" : "Reset database"}
        </Text>
      </Pressable>

      <Text style={styles.resetHint}>
        Wipes all entries and staged imports from local storage. Useful for testing a fresh import.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing["2xl"] },

  sectionTitle: { ...text.label, color: colors.textTertiary, marginBottom: 10 },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.lg,
    overflow: "hidden",
  },
  statRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.base,
    paddingVertical: 13,
  },
  statLabel: { ...text.base, color: colors.textDim },
  statValue: { ...text.base, color: colors.textPrimary, fontWeight: "600" },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },

  resetBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.deleteBg,
    paddingVertical: 14,
    marginBottom: 10,
  },
  resetBtnDisabled: { opacity: 0.5 },
  resetBtnText: { ...text.base, color: colors.error, fontWeight: "600" },

  resetHint: {
    ...text.sm,
    color: colors.textMuted,
    textAlign: "center",
  },
});
