/**
 * Phone contacts card. Contacts create People, not entries, so this is not a
 * connected source (docs/specs/sources-page.md 4.5).
 * Moved out of mobile/app/sources.tsx, no behaviour change.
 */
import React from "react";
import { ActivityIndicator, View } from "react-native";
import { spacing, radius, type ThemeColors, type ThemeFonts } from "../ThemeProvider";
import { SourceCard, SrcButton } from "./SourceCard";

export type ContactsPhase = "idle" | "parsing" | "review" | "committing";

export function ContactsSourceCard({
  peopleCount,
  phase,
  disabled,
  onImportFromDevice,
  onPickFile,
  colors,
  fonts,
}: {
  peopleCount: number;
  phase: ContactsPhase;
  disabled: boolean;
  onImportFromDevice: () => void;
  onPickFile: () => void;
  colors: ThemeColors;
  fonts: ThemeFonts;
}) {
  const parsing = phase === "parsing" || phase === "committing";
  return (
    <SourceCard
      icon="people-outline"
      title="Phone contacts"
      statusText={
        parsing
          ? phase === "parsing" ? "Reading contacts…" : "Saving…"
          : peopleCount > 0
          ? `${peopleCount} ${peopleCount === 1 ? "person" : "people"} added`
          : "Add people from your address book to tag them in entries"
      }
      active={parsing}
      progressPct={0}
      colors={colors}
      fonts={fonts}
      action={
        parsing ? (
          <ActivityIndicator size="small" color={colors.accent} />
        ) : (
          <View style={{ flexDirection: "row", gap: 8 }}>
            <SrcButton
              label="From device"
              onPress={onImportFromDevice}
              disabled={disabled}
              colors={colors}
              fonts={fonts}
            />
            <SrcButton
              label="File"
              onPress={onPickFile}
              disabled={disabled}
              colors={colors}
              fonts={fonts}
              variant="ghost"
            />
          </View>
        )
      }
    />
  );
}
