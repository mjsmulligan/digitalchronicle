/**
 * Import — URI handler for share intents / ACTION_VIEW deep links.
 *
 * When the app is opened via a share intent (?uri= param), this screen
 * processes the file with importFile() and shows the result. The user
 * can then go to the feed to review new entries, or tap Done to dismiss.
 *
 * Direct navigation (no ?uri=) redirects straight to /sources.
 */
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useTheme, spacing, radius } from "../src/components/ThemeProvider";
import { importFile, type ImportResult } from "@chronicle/journal/import";

type Phase = "loading" | "done" | "error";

export default function ImportRedirect() {
  const { uri } = useLocalSearchParams<{ uri?: string }>();
  const router = useRouter();
  const { colors, fonts } = useTheme();

  const [phase, setPhase] = useState<Phase>("loading");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uri) {
      router.replace("/sources" as any);
      return;
    }

    void (async () => {
      try {
        const filename = uri.split("/").pop() ?? "shared-file";
        const response = await fetch(uri);
        if (!response.ok) throw new Error(`Could not read file (HTTP ${response.status})`);
        const text = await response.text();
        const res = await importFile(filename, text);
        setResult(res);
        setPhase("done");
      } catch (err) {
        setError(String(err));
        setPhase("error");
      }
    })();
  }, [uri]);

  const goToFeed = () => router.replace("/(tabs)" as any);

  if (phase === "loading") {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ headerTitle: "Import" }} />
        <ActivityIndicator color={colors.accent} />
        <Text style={{ color: colors.textMuted, fontFamily: fonts.sans, marginTop: 12, fontSize: 14 }}>
          Processing file…
        </Text>
      </View>
    );
  }

  if (phase === "error") {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ headerTitle: "Import" }} />
        <Text style={[styles.heading, { color: colors.textBright, fontFamily: fonts.serifSemiBold }]}>
          Import failed
        </Text>
        <Text style={{ color: colors.error, fontFamily: fonts.sans, textAlign: "center", padding: 24 }}>
          {error}
        </Text>
        <Pressable
          style={[styles.btn, { backgroundColor: colors.accentBold }]}
          onPress={goToFeed}
        >
          <Text style={{ color: colors.white, fontFamily: fonts.sansMedium ?? fonts.sans, fontSize: 14, fontWeight: "600" }}>
            Go to journal
          </Text>
        </Pressable>
      </View>
    );
  }

  // phase === "done"
  const r = result!;
  const hasNew = r.added > 0 || r.updated > 0;

  const summaryLines: string[] = [];
  const countParts: string[] = [];
  if (r.added > 0) countParts.push(`${r.added} new`);
  if (r.updated > 0) countParts.push(`${r.updated} updated`);
  if (countParts.length > 0) summaryLines.push(countParts.join(", ") + ".");

  const skipParts: string[] = [];
  const alreadyIn = r.skipped.duplicate + r.skipped.inFile;
  if (alreadyIn > 0) skipParts.push(`${alreadyIn} already in your journal`);
  if (r.skipped.removed === 1) skipParts.push("1 you hid earlier was skipped");
  else if (r.skipped.removed > 1) skipParts.push(`${r.skipped.removed} you hid earlier were skipped`);
  if (skipParts.length > 0) summaryLines.push(skipParts.join(", ") + ".");
  if (r.errors.length > 0) summaryLines.push(`${r.errors.length} ${r.errors.length === 1 ? "row" : "rows"} could not be read.`);

  return (
    <View style={[styles.center, { backgroundColor: colors.bg }]}>
      <Stack.Screen options={{ headerTitle: "Import" }} />

      <Text style={[styles.heading, { color: colors.textBright, fontFamily: fonts.serifSemiBold }]}>
        {hasNew ? "Import complete" : "Nothing new"}
      </Text>

      <Text style={[styles.body, { color: colors.textSecondary, fontFamily: fonts.sans }]}>
        {hasNew
          ? summaryLines.join(" ")
          : "Everything in this file is already in your journal."}
      </Text>

      <View style={styles.actions}>
        {hasNew && (
          <Pressable
            style={[styles.btn, { backgroundColor: colors.accentBold }]}
            onPress={goToFeed}
          >
            <Text style={{ color: colors.white, fontFamily: fonts.sansMedium ?? fonts.sans, fontSize: 14, fontWeight: "600" }}>
              Review new
            </Text>
          </Pressable>
        )}
        <Pressable
          style={[styles.btn, styles.btnGhost, { borderColor: colors.border }]}
          onPress={goToFeed}
        >
          <Text style={{ color: colors.textSecondary, fontFamily: fonts.sansMedium ?? fonts.sans, fontSize: 14 }}>
            Done
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing["2xl"] },
  heading: { fontSize: 22, marginBottom: spacing.md, textAlign: "center" },
  body: { fontSize: 15, lineHeight: 22, textAlign: "center", marginBottom: spacing["2xl"] },
  actions: { gap: spacing.sm, width: "100%" },
  btn: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.lg,
    alignItems: "center",
  },
  btnGhost: {
    backgroundColor: "transparent",
    borderWidth: 1,
  },
});
