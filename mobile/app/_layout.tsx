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
import { View, ActivityIndicator } from "react-native";
import { Stack, SplashScreen, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as Linking from "expo-linking";
import { useFonts } from "expo-font";
import {
  Fraunces_400Regular,
  Fraunces_500Medium,
  Fraunces_600SemiBold,
} from "@expo-google-fonts/fraunces";
import {
  IBMPlexSans_400Regular,
  IBMPlexSans_500Medium,
} from "@expo-google-fonts/ibm-plex-sans";
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
} from "@expo-google-fonts/jetbrains-mono";
import {
  Lora_400Regular,
  Lora_500Medium,
  Lora_600SemiBold,
  Lora_700Bold,
} from "@expo-google-fonts/lora";
import { SQLiteAdapter } from "../src/lib/storage/SQLiteAdapter";
import { setAdapter, initJournal, useJournal } from "@chronicle/journal/db";
import { ThemeProvider, useTheme } from "../src/components/ThemeProvider";

SplashScreen.preventAutoHideAsync();

const JOURNAL_EXTENSIONS = [".csv", ".ics", ".json"];
const CONTACTS_EXTENSIONS = [".vcf", ".vcard"];

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
  return isFileUri && [...JOURNAL_EXTENSIONS, ...CONTACTS_EXTENSIONS].some((ext) => lower.includes(ext));
}

/** VCF / vCard files belong on the People import screen, not Sources. */
function looksLikeContactsUri(url: string): boolean {
  const lower = url.toLowerCase();
  return CONTACTS_EXTENSIONS.some((ext) => lower.includes(ext));
}

// Modal-only screens that should never be the initial route on app boot.
// If expo-router restores navigation state with one of these as the active
// screen (a dev-only artefact), we redirect home instead.
const MODAL_SCREENS = new Set(["import", "settings"]);

/**
 * Inner layout — runs inside ThemeProvider so it can call useTheme().
 * Contains all boot logic and renders the Stack navigator.
 */
function RootLayoutInner() {
  const { colors, mode } = useTheme();

  const [fontsLoaded, fontError] = useFonts({
    // Paper serif (Fraunces)
    Fraunces_400Regular,
    Fraunces_500Medium,
    Fraunces_600SemiBold,
    // Paper sans (IBM Plex Sans)
    IBMPlexSans_400Regular,
    IBMPlexSans_500Medium,
    // Paper mono (JetBrains Mono)
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
    // Leather serif (Lora)
    Lora_400Regular,
    Lora_500Medium,
    Lora_600SemiBold,
    Lora_700Bold,
  });

  const journal = useJournal();
  const router = useRouter();
  const segments = useSegments();
  const booted = useRef(false);

  // Boot: open SQLite then inject adapter then load all stores.
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
          const dest = looksLikeContactsUri(initial) ? "/sources" : "/import";
          router.push(`${dest}?uri=${encodeURIComponent(initial)}`);
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
  // ready -- deliberately excludes segments from the dep array so it
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
        const dest = looksLikeContactsUri(url) ? "/sources" : "/import";
        router.push(`${dest}?uri=${encodeURIComponent(url)}`);
      }
    });
    return () => sub.remove();
  }, []);

  if (!journal.ready || (!fontsLoaded && !fontError)) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.bg,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ActivityIndicator size="large" color={colors.accent} />
        <StatusBar style={mode === "dark" ? "light" : "dark"} />
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

/**
 * Root layout — wraps everything in ThemeProvider so every descendant
 * can call useTheme(). Boot logic lives in RootLayoutInner.
 */
export default function RootLayout() {
  return (
    <ThemeProvider>
      <RootLayoutInner />
    </ThemeProvider>
  );
}
