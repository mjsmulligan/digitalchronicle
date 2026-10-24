/**
 * Settings screen — developer/utility options.
 * Reachable via the gear icon in the Chronicle header.
 */
import { useMemo, useState, useEffect } from "react";
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { useDialog, Dialog } from "../src/components/Dialog";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Stack } from "expo-router";
import { clearAll, allEntries, allHiddenEntries, markAllReviewed, useJournal } from "@chronicle/journal/db";
import { useTheme, THEMES } from "../src/components/ThemeProvider";
import { useHomePrefs } from "../src/lib/useHomePrefs";
import { getPosterFetchEnabled, setPosterFetchEnabled, getBookCoverFetchEnabled, setBookCoverFetchEnabled } from "../src/lib/posterPrefs";
import { getMasterAutoCheck, setMasterAutoCheck, resetSourceProgress } from "../src/lib/connectedSources";
import { setFetchPostersEnabled, setFetchBookCoversEnabled } from "@chronicle/journal/artworkEnrichment";
import { artworkStorage } from "@chronicle/journal/artwork";

export default function SettingsScreen() {
  const journal = useJournal();
  const router = useRouter();
  const [clearing, setClearing] = useState(false);
  const [clearingArtwork, setClearingArtwork] = useState(false);
  const [exporting, setExporting] = useState(false);
  const dialog = useDialog();
  const { colors, fonts, text, spacing, radius, themeId, setThemeId } = useTheme();
  const { prefs: homePrefs, updatePrefs: updateHomePrefs } = useHomePrefs();
  // Local draft state for the About you fields — committed on blur
  const [draftName, setDraftName] = useState<string | null>(null);
  const [draftAirports, setDraftAirports] = useState<string | null>(null);

  // Posters toggle — loaded from persistent prefs
  const [fetchPosters, setFetchPostersState] = useState(true);
  // Book covers toggle — loaded from persistent prefs
  const [fetchBookCovers, setFetchBookCoversState] = useState(true);
  // Connected sources master auto-check switch
  const [autoCheckEnabled, setAutoCheckEnabled] = useState(true);
  useEffect(() => {
    getPosterFetchEnabled().then(setFetchPostersState);
    getBookCoverFetchEnabled().then(setFetchBookCoversState);
    getMasterAutoCheck().then(setAutoCheckEnabled).catch(() => {});
  }, []);

  const handleFetchPostersToggle = async (value: boolean) => {
    setFetchPostersState(value);
    setFetchPostersEnabled(value);      // update in-memory toggle immediately
    await setPosterFetchEnabled(value); // persist for next launch
  };

  const handleFetchBookCoversToggle = async (value: boolean) => {
    setFetchBookCoversState(value);
    setFetchBookCoversEnabled(value);
    await setBookCoverFetchEnabled(value);
  };

  const handleAutoCheckToggle = async (value: boolean) => {
    setAutoCheckEnabled(value);
    await setMasterAutoCheck(value);
  };

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    content: { padding: spacing.base, paddingBottom: spacing["2xl"] },

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

    // ── About you section ─────────────────────────────────────────────
    inputRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: spacing.base,
      paddingVertical: 10,
    },
    inputLabel: { ...text.sm, color: colors.textSecondary, width: 96 },
    input: {
      flex: 1,
      ...text.base,
      color: colors.textPrimary,
      paddingVertical: 4,
    },
    inputHint: {
      ...text.xs,
      color: colors.textMuted,
      paddingHorizontal: spacing.base,
      paddingBottom: spacing.sm,
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

  // Static swatch data — row1 and row2 render as a 2×2 grid
  const THEME_ROWS = [
    [
      { id: "paper",   label: "Paper",   bg: THEMES["paper"]!.colors.bg,   inkColor: THEMES["paper"]!.colors.textPrimary,   accent: THEMES["paper"]!.colors.accent },
      { id: "ink",     label: "Ink",     bg: THEMES["ink"]!.colors.bg,     inkColor: THEMES["ink"]!.colors.textPrimary,     accent: THEMES["ink"]!.colors.accent },
    ],
    [
      { id: "leather", label: "Leather", bg: THEMES["leather"]!.colors.bg, inkColor: THEMES["leather"]!.colors.textPrimary, accent: THEMES["leather"]!.colors.accent },
      { id: "system",  label: "System",  bg: null,                          inkColor: null,                                  accent: null },
    ],
  ] as const;

  const entryCount =
    journal.legs.length +
    journal.stays.length +
    journal.events.length +
    journal.films.length +
    journal.episodes.length +
    journal.books.length;

  const hiddenCount = allHiddenEntries(journal).length;
  const unreviewedCount = allEntries(journal).filter((e) => e.unreviewed !== undefined).length;

  const handleMarkAllRead = () => {
    const n = unreviewedCount;
    dialog.confirm(
      "Mark all as read",
      `Mark ${n.toLocaleString()} ${n === 1 ? "entry" : "entries"} as read?`,
      "Mark all as read",
      async () => { await markAllReviewed(); }
    );
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const json = JSON.stringify(journal, null, 2);
      await Share.share({ message: json, title: "Chronicle export" });
    } catch (e) {
      console.warn("Export failed", e);
    } finally {
      setExporting(false);
    }
  };

  const handleClearArtworkCache = async () => {
    setClearingArtwork(true);
    try {
      await artworkStorage().clearAll();
    } catch (e) {
      console.warn("Failed to clear artwork cache", e);
    } finally {
      setClearingArtwork(false);
    }
  };

  const handleReset = () => {
    dialog.confirm(
      "Reset database",
      `This will permanently delete all ${entryCount.toLocaleString()} entries. This cannot be undone.`,
      "Reset",
      async () => {
        setClearing(true);
        try {
          await clearAll();
          // Connected sources track their progress outside the database, so tell them
          // the journal is empty and their next check should re-read everything.
          try {
            await resetSourceProgress();
          } catch (e) {
            console.warn("Failed to reset source progress", e);
          }
        } finally {
          setClearing(false);
        }
      }
    );
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: "Settings",
          headerStyle: { backgroundColor: colors.surface },
          headerTitleStyle: {
            fontFamily: fonts.serifSemiBold,
            color: colors.textBright,
          },
          headerTintColor: colors.accent,
        }}
      />
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
    >

      {/* ── About you ──────────────────────────────────────────────────── */}
      <Text style={styles.sectionTitle}>About you</Text>
      <View style={[styles.card, { marginBottom: spacing.sm }]}>
        <View style={styles.inputRow}>
          <Text style={styles.inputLabel}>Your name</Text>
          <TextInput
            style={styles.input}
            value={draftName ?? homePrefs.displayName}
            onChangeText={setDraftName}
            onBlur={() => {
              const val = (draftName ?? homePrefs.displayName).trim();
              updateHomePrefs({ displayName: val });
              setDraftName(null);
            }}
            placeholder="e.g. Mike"
            placeholderTextColor={colors.textMuted}
            returnKeyType="done"
          />
        </View>
        <View style={styles.divider} />
        <View style={styles.inputRow}>
          <Text style={styles.inputLabel}>Home airport</Text>
          <TextInput
            style={[styles.input, { textTransform: "uppercase" }]}
            value={draftAirports ?? homePrefs.homeAirports.join(", ")}
            onChangeText={setDraftAirports}
            onBlur={() => {
              const raw = draftAirports ?? homePrefs.homeAirports.join(", ");
              const codes = raw
                .split(/[,\s]+/)
                .map((s) => s.trim().toUpperCase())
                .filter(Boolean);
              updateHomePrefs({ homeAirports: codes });
              setDraftAirports(null);
            }}
            placeholder="e.g. DUB"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="characters"
            returnKeyType="done"
          />
        </View>
      </View>
      <Text style={[styles.inputHint, { marginBottom: spacing.lg }]}>
        Used to suggest trips from your unlinked flights and trains. Enter multiple codes separated by commas.
      </Text>

      {/* ── Appearance ─────────────────────────────────────────────────── */}
      <Text style={styles.sectionTitle}>Appearance</Text>
      <View style={{ gap: spacing.sm, marginBottom: spacing.lg }}>
        {THEME_ROWS.map((row, ri) => (
          <View key={ri} style={styles.themeRow}>
            {row.map((opt) => {
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
                      // Split swatch: Paper (light) left, Ink (dark) right
                      <>
                        <View style={[styles.swatchBgLeft,  { backgroundColor: THEMES["paper"]!.colors.bg }]} />
                        <View style={[styles.swatchBgRight, { backgroundColor: THEMES["ink"]!.colors.bg }]} />
                        <View style={[styles.swatchDiagonal, { position: "absolute", inset: 0 }]}>
                          <View style={styles.swatchDots}>
                            <View style={[styles.swatchDot, { backgroundColor: THEMES["paper"]!.colors.accent }]} />
                            <View style={[styles.swatchDot, { backgroundColor: THEMES["ink"]!.colors.accent }]} />
                          </View>
                        </View>
                      </>
                    ) : (
                      <View style={[styles.swatchBg, { backgroundColor: opt.bg! }]}>
                        <View style={styles.swatchDots}>
                          <View style={[styles.swatchDot, { backgroundColor: opt.inkColor! }]} />
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
        ))}
      </View>

      {/* ── Photo library ───────────────────────────────────────────────── */}
      {/* Moved to Sources page (WP15). Settings keeps only a navigation link. */}
      <Text style={styles.sectionTitle}>Sources</Text>

      {/* Connected sources master switch + new entries count + bulk mark-read */}
      <View style={[styles.card, { marginBottom: spacing.sm }]}>
        <View style={styles.statRow}>
          <Text style={styles.statLabel}>Check on startup</Text>
          <Switch
            value={autoCheckEnabled}
            onValueChange={handleAutoCheckToggle}
            trackColor={{ false: colors.border, true: colors.accent }}
            thumbColor={colors.surface}
          />
        </View>
        <View style={styles.divider} />
        <View style={styles.statRow}>
          <Text style={styles.statLabel}>New entries</Text>
          <Text style={[styles.statValue, { color: unreviewedCount > 0 ? colors.accent : colors.textMuted }]}>
            {unreviewedCount.toLocaleString()}
          </Text>
        </View>
        <View style={styles.divider} />
        <Pressable
          style={[styles.statRow, unreviewedCount === 0 && { opacity: 0.4 }]}
          onPress={handleMarkAllRead}
          disabled={unreviewedCount === 0}
        >
          <Text style={[styles.statLabel, { color: unreviewedCount > 0 ? colors.accent : colors.textMuted }]}>
            Mark all as read
          </Text>
        </Pressable>
      </View>

      <Pressable
        style={[styles.card, { flexDirection: "row", alignItems: "center", marginBottom: spacing.xl }]}
        onPress={() => router.push("/sources" as any)}
      >
        <Ionicons name="images-outline" size={18} color={colors.accent} style={{ marginRight: spacing.md }} />
        <Text style={{ ...styles.resetHint, color: colors.textSecondary, flex: 1, marginBottom: 0 }}>
          Photo library · manage scan and review suggestions
        </Text>
        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
      </Pressable>

      {/* ── Posters & covers ────────────────────────────────────────────── */}
      <Text style={styles.sectionTitle}>Posters &amp; covers</Text>

      <View style={styles.card}>
        <View style={styles.statRow}>
          <Text style={styles.statLabel}>Fetch posters</Text>
          <Switch
            value={fetchPosters}
            onValueChange={handleFetchPostersToggle}
            trackColor={{ false: colors.border, true: colors.accent }}
            thumbColor={colors.surface}
          />
        </View>
        <View style={styles.divider} />
        <View style={styles.statRow}>
          <Text style={styles.statLabel}>Fetch book covers</Text>
          <Switch
            value={fetchBookCovers}
            onValueChange={handleFetchBookCoversToggle}
            trackColor={{ false: colors.border, true: colors.accent }}
            thumbColor={colors.surface}
          />
        </View>
      </View>
      <Text style={[styles.inputHint, { marginBottom: spacing.sm }]}>
        When on, film/show titles are sent to TMDB for posters; book titles and authors are sent to Open Library for covers. No personal data is included.
      </Text>

      {/* Attribution */}
      <Text style={[styles.inputHint, { marginBottom: spacing.xl, color: colors.textMuted }]}>
        This product uses the TMDB API but is not endorsed or certified by TMDB.{"\n"}Book cover images from Open Library (openlibrary.org).
      </Text>

      {/* ── Database ────────────────────────────────────────────────────── */}
      <Text style={styles.sectionTitle}>Database</Text>

      <View style={styles.card}>
        <View style={styles.statRow}>
          <Text style={styles.statLabel}>Journal entries</Text>
          <Text style={styles.statValue}>{entryCount.toLocaleString()}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.statRow}>
          <Text style={styles.statLabel}>Hidden entries</Text>
          <Text style={styles.statValue}>{hiddenCount.toLocaleString()}</Text>
        </View>
      </View>

      <Pressable
        style={[styles.card, { flexDirection: "row", alignItems: "center", marginBottom: spacing.xl }]}
        onPress={() => router.push("/hidden-entries" as any)}
      >
        <Ionicons name="eye-off-outline" size={18} color={colors.accent} style={{ marginRight: spacing.md }} />
        <Text style={{ ...styles.resetHint, color: colors.textSecondary, flex: 1, marginBottom: 0, textAlign: "left" }}>
          Hidden Entries · view and restore hidden entries
        </Text>
        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
      </Pressable>

      <Pressable
        style={[styles.card, { flexDirection: "row", alignItems: "center", marginBottom: spacing.xl }]}
        onPress={() => router.push("/book-spike" as any)}
      >
        <Ionicons name="book-outline" size={18} color={colors.accent} style={{ marginRight: spacing.md }} />
        <Text style={{ ...styles.resetHint, color: colors.textSecondary, flex: 1, marginBottom: 0, textAlign: "left" }}>
          Book export spike · test PDF generation on this device
        </Text>
        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
      </Pressable>

      <Pressable
        style={[styles.resetBtn, exporting && styles.resetBtnDisabled, { borderColor: colors.border, marginBottom: spacing.sm }]}
        onPress={handleExport}
        disabled={exporting}
      >
        <Ionicons name="share-outline" size={18} color={colors.textPrimary} />
        <Text style={[styles.resetBtnText, { color: colors.textPrimary }]}>
          {exporting ? "Exporting…" : "Export JSON"}
        </Text>
      </Pressable>

      <Pressable
        style={[styles.resetBtn, clearingArtwork && styles.resetBtnDisabled, { borderColor: colors.border, marginBottom: spacing.sm }]}
        onPress={handleClearArtworkCache}
        disabled={clearingArtwork}
      >
        <Ionicons name="image-outline" size={18} color={colors.textPrimary} />
        <Text style={[styles.resetBtnText, { color: colors.textPrimary }]}>
          {clearingArtwork ? "Clearing…" : "Clear artwork cache"}
        </Text>
      </Pressable>
      <Text style={[styles.resetHint, { marginBottom: spacing.md }]}>
        Clears cached posters, book covers, and artist images. They will be re-fetched next time entries are viewed.
      </Text>

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
