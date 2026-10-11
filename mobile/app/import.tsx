/**
 * Import — URI handler for share intents / ACTION_VIEW deep links.
 *
 * When the app is opened via a share intent (?uri= param), this screen
 * processes the file and saves the resulting batch to the journal store,
 * then navigates to /sources where the batch appears in "Pending review".
 *
 * Direct navigation (no ?uri=) redirects straight to /sources.
 *
 * The full source-management UI (file picker, calendar, Goodreads, batch
 * review) lives in /sources.
 */
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useTheme } from "../src/components/ThemeProvider";
import { stageFile } from "@chronicle/journal/staging";

export default function ImportRedirect() {
  const { uri } = useLocalSearchParams<{ uri?: string }>();
  const router = useRouter();
  const { colors, fonts } = useTheme();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uri) {
      // Direct navigation — just go to sources
      router.replace("/sources" as any);
      return;
    }

    // Process the shared file, save batch to journal store, then navigate
    void (async () => {
      try {
        const filename = uri.split("/").pop() ?? "shared-file";
        const response = await fetch(uri);
        if (!response.ok) throw new Error(`Could not read file (HTTP ${response.status})`);
        const text = await response.text();
        await stageFile(filename, text);
        router.replace("/sources" as any);
      } catch (err) {
        setError(String(err));
      }
    })();
  }, [uri]);

  if (error) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ headerTitle: "Import" }} />
        <Text style={{ color: colors.error, fontFamily: fonts.sans, textAlign: "center", padding: 24 }}>
          {error}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.center}>
      <Stack.Screen options={{ headerTitle: "Import" }} />
      <ActivityIndicator color={colors.accent} />
      <Text style={{ color: colors.textMuted, fontFamily: fonts.sans, marginTop: 12, fontSize: 14 }}>
        {uri ? "Processing file…" : "Redirecting…"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
