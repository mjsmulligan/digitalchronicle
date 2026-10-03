/**
 * Settings screen — developer/utility options.
 * Reachable via the gear icon in the Chronicle header.
 */
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useDialog, Dialog } from "../src/components/Dialog";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { clearAll, useJournal } from "@chronicle/journal/db";
import { useTheme, THEMES } from "../src/components/ThemeProvider";

export default function SettingsScreen() {
  const journal = useJournal();
  const router = useRouter();
  const { top } = useSafeAreaInsets();
  const [clearing, setClearing] = useState(false);
  const dialog = useDialog();
  const { colors, fonts, text, spacing, radius, themeId, setThemeId } = useTheme();

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    content: { padding: spacing.base, paddingBottom: spacing["2xl"] },

    dragHandle: {
      width: 36,
      height: 4,
      backgroundColor: colors.border,
      borderRadius: 2,
      alignSelf: "center",
      marginBottom: spacing.lg,
    },
    modalHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: spacing.xl,
    },
    modalTitle: {
      fontSize: 22,
      fontFamily: fonts.serifSemiBold,
      fontWeight: "600",
      color: colors.textBright,
    },
    closeBtn: {
      width: 32,
      height: 32,
      backgroundColor: colors.surface,
      borderRadius: 9999,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: colors.border,
    },

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

    // ── Appearance section ────────────────────────────────────────────
    themeRow: {
      flexDirection: "row",
      gap: spacing.sm,
      marginBottom: spacing.lg,
    },
    themeOption: {
      flex: 1,
      alignItems: "center",
      gap: spacing.sm,
    },
    themeOptionInner: {
      width: "100%",
      aspectRatio: 0.85,
      borderRadius: radius.lg,
      borderWidth: 1.5,
      borderColor: colors.border,
      overflow: "hidden",
      justifyContent: "flex-end",
    },
    themeOptionActive: {
      borderColor: colors.accent,
      borderWidth: 2,
    },
    themeLabel: {
      ...text.xs,
      color: colors.textSecondary,
      textAlign: "center",
    },
    themeLabelActive: {
      color: colors.accent,
      fontWeight: "600",
    },
    swatchBg: {
      flex: 1,
      padding: 8,
      justifyContent: "flex-end",
    },
    swatchBgLeft: {
      position: "absolute",
      top: 0, left: 0, bottom: 0,
      width: "50%",
    },
    swatchBgRight: {
      position: "absolute",
      top: 0, right: 0, bottom: 0,
      width: "50%",
    },
    swatchDiagonal: {
      flex: 1,
      padding: 8,
      justifyContent: "flex-end",
    },
    swatchSample: {
      fontSize: 14,
      fontWeight: "700",
      lineHeight: 18,
    },
    swatchDots: {
      flexDirection: "row",
      gap: 4,
      marginBottom: 6,
    },
    swatchDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    checkDot: {
      width: 18,
      height: 18,
      borderRadius: 9,
      backgroundColor: colors.accent,
      alignItems: "center",
      justifyContent: "center",
      position: "absolute",
      top: 6,
      right: 6,
    },
  }), [colors, fonts]);

  // Static swatch data — these are the literal token values from ThemeProvider
  const THEME_OPTS = [
    {
      id:     "paper",
      label:  "Paper",
      bg:     THEMES["paper"]!.colors.bg,
      ink:    THEMES["paper"]!.colors.textPrimary,
      accent: THEMES["paper"]!.colors.accent,
    },
    {
      id:     "leather",
      label:  "Leather",
      bg:     THEMES["leather"]!.colors.bg,
      ink:    THEMES["leather"]!.colors.textPrimary,
      accent: THEMES["leather"]!.colors.accent,
    },
    {
      id:     "system",
      label:  "System",
      bg:     null,
      ink:    null,
      accent: null,
    },
  ] as const;

  const entryCount =
    journal.legs.length +
    journal.stays.length +
    journal.events.length +
    journal.films.length +
    journal.episodes.length +
    journal.books.length;

  const handleReset = () => {
    dialog.confirm(
      "Reset database",
      `This will permanently delete all ${entryCount.toLocaleString()} entries and ${journal.staging.length} pending import${journal.staging.length === 1 ? "" : "s"}. This cannot be undone.`,
      "Reset",
      async () => {
        setClearing(true);
        try {
          await clearAll();
        } finally {
          setClearing(false);
        }
      }
    );
  };

  return (
    <>
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: top + spacing.md }]}
    >
      <View style={styles.dragHandle} />
      <View style={styles.modalHeader}>
        <Text style={styles.modalTitle}>Settings</Text>
        <Pressable
          onPress={() => router.canDismiss() ? router.dismiss() : router.replace("/(tabs)")}
          hitSlop={8}
          style={styles.closeBtn}
        >
          <Ionicons name="close" size={18} color={colors.textSecondary} />
        </Pressable>
      </View>

      {/* ── Appearance ─────────────────────────────────────────────────── */}
      <Text style={styles.sectionTitle}>Appearance</Text>
      <View style={styles.themeRow}>
        {THEME_OPTS.map((opt) => {
          const active = themeId === opt.id;
          return (
            <Pressable
              key={opt.id}
              style={styles.themeOption}
              onPress={() => setThemeId(opt.id)}
              hitSlop={4}
            >
              <View style={[styles.themeOptionInner, active && styles.themeOptionActive]}>
                {opt.id === "system" ? (
                  // Split swatch: Paper bg left, Leather bg right
                  <>
                    <View style={[styles.swatchBgLeft,  { backgroundColor: THEMES["paper"]!.colors.bg }]} />
                    <View style={[styles.swatchBgRight, { backgroundColor: THEMES["leather"]!.colors.bg }]} />
                    <View style={[styles.swatchDiagonal, { position: "absolute", inset: 0 }]}>
                      <View style={styles.swatchDots}>
                        <View style={[styles.swatchDot, { backgroundColor: THEMES["paper"]!.colors.accent }]} />
                        <View style={[styles.swatchDot, { backgroundColor: THEMES["leather"]!.colors.accent }]} />
                      </View>
                    </View>
                  </>
                ) : (
                  <View style={[styles.swatchBg, { backgroundColor: opt.bg! }]}>
                    <View style={styles.swatchDots}>
                      <View style={[styles.swatchDot, { backgroundColor: opt.ink! }]} />
                      <View style={[styles.swatchDot, { backgroundColor: opt.accent! }]} />
                    </View>
                  </View>
                )}
                {active && (
                  <View style={styles.checkDot}>
                    <Ionicons name="checkmark" size={11} color={colors.white} />
                  </View>
                )}
              </View>
              <Text style={[styles.themeLabel, active && styles.themeLabelActive]}>
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* ── Database ────────────────────────────────────────────────────── */}
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
    <Dialog {...dialog.props} onDismiss={dialog.dismiss} />
    </>
  );
}
