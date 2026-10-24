/**
 * WP0 spike screen for docs/specs/book-export.md.
 * Reachable from Settings. Builds a 100 page test book with real photos through
 * expo-print and reports timing, page count, page size and font embedding.
 * Throwaway: delete it with src/lib/bookSpike.ts once the WP0 decision is made.
 */
import { useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { Stack } from "expo-router";
import * as Sharing from "expo-sharing";
import { useTheme } from "../src/components/ThemeProvider";
import { DEFAULT_CONFIG, runSpike, type SpikeConfig, type SpikeResult } from "../src/lib/bookSpike";

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        { borderColor: on ? colors.accent : colors.border, backgroundColor: on ? colors.surfaceAccent : colors.surface },
      ]}
    >
      <Text style={{ color: on ? colors.accentBold : colors.textSecondary, fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

export default function BookSpikeScreen() {
  const { colors } = useTheme();
  const [config, setConfig] = useState<SpikeConfig>(DEFAULT_CONFIG);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SpikeResult | null>(null);
  const set = <K extends keyof SpikeConfig>(k: K, v: SpikeConfig[K]) => setConfig((c) => ({ ...c, [k]: v }));

  const run = async () => {
    setRunning(true);
    setResult(null);
    setResult(await runSpike(config));
    setRunning(false);
  };

  const json = result ? JSON.stringify(result, null, 2) : "";

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.body}>
      <Stack.Screen options={{ title: "Book spike (WP0)" }} />
      <Text style={[styles.h, { color: colors.textPrimary }]}>Test book via expo-print</Text>
      <Text style={{ color: colors.textSecondary, marginBottom: 12 }}>
        Uses your most recent library photos, resized for print, then prints about 100 pages to PDF. Keep the app in the
        foreground until it finishes. If the app closes or freezes, that is the result: note the settings you used.
      </Text>

      <Text style={[styles.label, { color: colors.textSecondary }]}>Page size</Text>
      <View style={styles.row}>
        <Chip label="A4" on={config.pageSize === "A4"} onPress={() => set("pageSize", "A4")} />
        <Chip label="A5" on={config.pageSize === "A5"} onPress={() => set("pageSize", "A5")} />
      </View>

      <Text style={[styles.label, { color: colors.textSecondary }]}>Entries (800 is about 100 pages on A4)</Text>
      <View style={styles.row}>
        {[400, 800, 1600].map((n) => (
          <Chip key={n} label={String(n)} on={config.entryCount === n} onPress={() => set("entryCount", n)} />
        ))}
      </View>

      <Text style={[styles.label, { color: colors.textSecondary }]}>Photos</Text>
      <View style={styles.row}>
        {[0, 30, 60].map((n) => (
          <Chip key={n} label={String(n)} on={config.photoCount === n} onPress={() => set("photoCount", n)} />
        ))}
      </View>

      <Text style={[styles.label, { color: colors.textSecondary }]}>Options</Text>
      <View style={styles.row}>
        <Chip label="Page numbers" on={config.pageNumbers} onPress={() => set("pageNumbers", !config.pageNumbers)} />
        <Chip
          label="Chapters on right page"
          on={config.chapterBreak === "right"}
          onPress={() => set("chapterBreak", config.chapterBreak === "right" ? "page" : "right")}
        />
        {Platform.OS === "ios" && (
          <Chip
            label="Native margins"
            on={config.marginMode === "native"}
            onPress={() => set("marginMode", config.marginMode === "native" ? "css" : "native")}
          />
        )}
      </View>

      <Pressable
        onPress={run}
        disabled={running}
        style={[styles.button, { backgroundColor: colors.accent, opacity: running ? 0.6 : 1 }]}
      >
        {running ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Run spike</Text>}
      </Pressable>

      {result && (
        <View style={{ marginTop: 16 }}>
          <Text style={[styles.h, { color: result.ok ? colors.textPrimary : "#B3261E" }]}>
            {result.ok ? "Finished" : "Failed"}
          </Text>
          {result.pdf && (
            <Text style={{ color: colors.textPrimary, marginBottom: 8 }}>
              {result.pdf.numberOfPages} pages, {result.pdf.sizeMB} MB, print took {(result.ms.print / 1000).toFixed(1)} s
            </Text>
          )}
          <Text selectable style={[styles.mono, { color: colors.textSecondary, borderColor: colors.border }]}>
            {json}
          </Text>
          <View style={styles.row}>
            {result.pdf && (
              <Pressable
                style={[styles.button, styles.small, { backgroundColor: colors.surfaceAccent }]}
                onPress={() => Sharing.shareAsync(result.pdf!.uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf" })}
              >
                <Text style={{ color: colors.accentBold }}>Open PDF</Text>
              </Pressable>
            )}
            <Pressable
              style={[styles.button, styles.small, { backgroundColor: colors.surfaceAccent }]}
              onPress={() => Share.share({ message: json })}
            >
              <Text style={{ color: colors.accentBold }}>Share result</Text>
            </Pressable>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, paddingBottom: 48 },
  h: { fontSize: 18, fontWeight: "600", marginBottom: 6 },
  label: { fontSize: 12, marginTop: 12, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  button: { marginTop: 20, borderRadius: 10, paddingVertical: 12, alignItems: "center", paddingHorizontal: 16 },
  small: { marginTop: 12 },
  buttonText: { color: "#fff", fontWeight: "600" },
  mono: { fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }), fontSize: 11, borderWidth: 1, borderRadius: 8, padding: 8 },
});
