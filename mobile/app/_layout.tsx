/**
 * Root layout — Chronicle mobile boot sequence + share-intent handler.
 *
 * Boot order (must stay sequential):
 *   1. SQLiteAdapter.open()  — open chronicle.db, ensure all tables exist
 *   2. setAdapter(adapter)   — swap out the default IDBAdapter in db.ts
 *   3. initJournal()         — load all stores into React state
 *   4. SplashScreen.hide()   — reveal the app
 *
 * Share intent handling (requires development build — not available in Expo Go):
 *   On Android, ACTION_VIEW with a content:// or file:// URI arrives via
 *   expo-linking as the initial URL or as a subsequent 'url' event.
 *   We capture it and navigate to /import?uri=<encoded> so the import
 *   screen can read the file with expo-file-system and stage it.
 */
import { useEffect, useRef } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { Stack, SplashScreen, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as Linking from "expo-linking";
import { useFonts } from "expo-font";
import {
  Lora_400Regular,
  Lora_500Medium,
  Lora_600SemiBold,
  Lora_700Bold,
} from "@expo-google-fonts/lora";
import { SQLiteAdapter } from "../src/lib/storage/SQLiteAdapter";
import { setAdapter, initJournal, useJournal } from "@chronicle/journal/db";
import { colors } from "../src/theme";

SplashScreen.preventAutoHideAsync();

const FILE_EXTENSIONS = [".csv", ".ics", ".vcf", ".json"];

/**
 * Returns true only for real OS-level share-intent URIs.
 * Android share intents always arrive as file:// or content:// URIs.
 * This deliberately excludes exp:// and http:// so that expo-router's
 * own restored navigation URLs (which may contain a file extension in
 * the path or query string) don't trigger a spurious /import push on
 * every app reload.
 */
function looksLikeImportUri(url: string): boolean {
  const lower = url.toLowerCase();
  const isFileUri = lower.startsWith("file://") || lower.startsWith("content://");
  return isFileUri && FILE_EXTENSIONS.some((ext) => lower.includes(ext));
}

// Modal-only screens that should never be the initial route on app boot.
// If expo-router restores navigation state with one of these as the active
// screen (a dev-only artefact), we redirect home instead.
const MODAL_SCREENS = new Set(["import", "import-people", "settings"]);

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Lora_400Regular,
    Lora_500Medium,
    Lora_600SemiBold,
    Lora_700Bold,
  });

  const journal = useJournal();
  const router = useRouter();
  const segments = useSegments();
  const booted = useRef(false);

  // Boot: open SQLite → inject adapter → load all stores.
  // Claim booted.current BEFORE any async work so that hot-reload re-mounts
  // (which re-run effects) don't open a second conflicting SQLite connection.
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    (async () => {
      try {
        const adapter = await SQLiteAdapter.open();
        setAdapter(adapter);
        await initJournal();

        // Handle initial URL (app opened via share intent before JS was running)
        const initial = await Linking.getInitialURL();
        if (initial && looksLikeImportUri(initial)) {
          router.push(`/import?uri=${encodeURIComponent(initial)}`);
        }
      } catch (err) {
        console.error("[Chronicle] Boot failed:", err);
        SplashScreen.hideAsync();
      }
    })();
  }, []);

  // Hide splash once journal data is loaded AND fonts are ready (or failed)
  useEffect(() => {
    if (journal.ready && (fontsLoaded || fontError)) SplashScreen.hideAsync();
  }, [journal.ready, fontsLoaded, fontError]);

  // Guard: if expo-router restores a stale navigation state that lands
  // directly on a modal screen (common during hot-reload in development),
  // redirect to the tabs root. Runs ONCE when the journal first becomes
  // ready — deliberately excludes segments from the dep array so it
  // doesn't re-fire on every navigation the user makes afterward.
  useEffect(() => {
    if (!journal.ready) return;
    const root = segments[0] as string | undefined;
    if (root && MODAL_SCREENS.has(root)) {
      router.replace("/(tabs)");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journal.ready]);

  // Listen for share intents while app is already running
  useEffect(() => {
    const sub = Linking.addEventListener("url", ({ url }) => {
      if (url && looksLikeImportUri(url)) {
        router.push(`/import?uri=${encodeURIComponent(url)}`);
      }
    });
    return () => sub.remove();
  }, []);

  if (!journal.ready || (!fontsLoaded && !fontError)) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.accent} />
        <StatusBar style="light" />
      </View>
    );
  }

  return (
    <>
      <Stack screenOptions={{ headerShown: false }}>
        {/* Import screens slide up as modal sheets */}
        <Stack.Screen
          name="import"
          options={{
            presentation: "modal",
            contentStyle: { backgroundColor: colors.bg },
          }}
        />
        <Stack.Screen
          name="import-people"
          options={{
            presentation: "modal",
            contentStyle: { backgroundColor: colors.bg },
          }}
        />
        <Stack.Screen
          name="settings"
          options={{
            presentation: "modal",
            contentStyle: { backgroundColor: colors.bg },
          }}
        />
      </Stack>
      <StatusBar style="light" />
    </>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
});
