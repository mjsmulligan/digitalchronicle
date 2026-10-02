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
import { Stack, SplashScreen, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as Linking from "expo-linking";
import { SQLiteAdapter } from "../src/lib/storage/SQLiteAdapter";
import { setAdapter, initJournal, useJournal } from "@chronicle/journal/db";
import { colors } from "../src/theme";

SplashScreen.preventAutoHideAsync();

const FILE_EXTENSIONS = [".csv", ".ics", ".vcf", ".json"];

function looksLikeImportUri(url: string): boolean {
  const lower = url.toLowerCase();
  return FILE_EXTENSIONS.some((ext) => lower.includes(ext));
}

export default function RootLayout() {
  const journal = useJournal();
  const router = useRouter();
  const booted = useRef(false);

  // Boot: open SQLite → inject adapter → load all stores
  useEffect(() => {
    (async () => {
      try {
        const adapter = await SQLiteAdapter.open();
        setAdapter(adapter);
        await initJournal();
        booted.current = true;

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

  // Hide splash once journal data is loaded
  useEffect(() => {
    if (journal.ready) SplashScreen.hideAsync();
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

  if (!journal.ready) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.accent} />
        <StatusBar style="light" />
      </View>
    );
  }

  return (
    <>
      <Stack screenOptions={{ headerShown: false }} />
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
