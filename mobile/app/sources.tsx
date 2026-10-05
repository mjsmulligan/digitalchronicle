/**
 * WP15 — Sources page.
 *
 * Lists all connected data sources with their status and controls. Currently
 * contains only the photo library source. Other sources (connectors) will be
 * added here when the Sources page rework lands (see spec §5 note).
 *
 * Reachable via the Chronicle tab header (sources icon).
 */

import React, { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { PhotoSourceEntry } from "../src/components/PhotoSourceEntry";
import { useTheme, spacing } from "../src/components/ThemeProvider";

export default function SourcesScreen() {
  const router  = useRouter();
  const { colors, fonts } = useTheme();
  const s = useMemo(() => styles(colors, fonts), [colors, fonts]);

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: "Sources",
          headerStyle:  { backgroundColor: colors.surface },
          headerTitleStyle: { fontFamily: fonts.serifSemiBold, color: colors.textBright },
          headerTintColor: colors.accent,
        }}
      />

      <ScrollView style={s.scroll} contentContainerStyle={s.content}>
        <Text style={s.sectionLabel}>On-device</Text>

        <PhotoSourceEntry
          onReviewSuggestions={() => router.push("/staging/places" as any)}
        />

        {/* Future connectors go here */}
      </ScrollView>
    </>
  );
}

function styles(colors: any, fonts: any) {
  return StyleSheet.create({
    scroll: { flex: 1, backgroundColor: colors.bg },
    content: { paddingTop: spacing.lg, paddingBottom: spacing["3xl"] },
    sectionLabel: {
      fontSize: 11,
      color: colors.textMuted,
      textTransform: "uppercase",
      letterSpacing: 0.5,
      paddingHorizontal: spacing.lg,
      marginBottom: spacing.sm,
    },
  });
}
