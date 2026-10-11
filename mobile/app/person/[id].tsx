/**
 * Person detail screen — profile card + all shared entries grouped by day
 * in the two-column journal layout.
 */
import { useMemo, useState } from "react";
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useJournal, allEntries, removeMany, putMany, storeFor } from "@chronicle/journal/db";
import { type Entry, type Person } from "@chronicle/journal/types";
import { Ionicons } from "@expo/vector-icons";
import { useTheme, type ThemeColors, type ThemeFonts, text as textScale, spacing as spacingScale, radius as radiusScale } from "../../src/components/ThemeProvider";
import { DayGroup, type DayGroupData } from "../../src/components/DayGroup";
import { PersonAvatar } from "../../src/components/PersonAvatar";
import { entrySortKey } from "../../src/lib/dateHelpers";

// ── styles factory ────────────────────────────────────────────────────────────

function createStyles(colors: ThemeColors, fonts: ThemeFonts) {
  return StyleSheet.create({
    list: { flex: 1, backgroundColor: colors.bg },
    content: { paddingBottom: spacingScale["3xl"] },

    // Profile card
    profileCard: {
      backgroundColor: colors.surface,
      borderRadius: radiusScale["2xl"],
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacingScale.lg,
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacingScale.base,
      margin: spacingScale.base,
      marginBottom: spacingScale.sm,
    },
    avatar: {
      width: 56,
      height: 56,
      borderRadius: radiusScale.full,
      backgroundColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarSelf: { backgroundColor: colors.surfaceAccent },
    avatarText: { color: colors.textDim, fontSize: 18, fontWeight: "700" },
    profileBody: { flex: 1 },
    nameRow: { flexDirection: "row", alignItems: "center", gap: spacingScale.sm, marginBottom: 4 },
    name: {
      fontSize: 20,
      fontFamily: fonts.serifBold,
      fontWeight: "700",
      color: colors.textPrimary,
    },
    selfBadge: {
      color: colors.accentBadge,
      fontSize: 10,
      fontWeight: "700",
      backgroundColor: colors.surfaceAccentDeep,
      paddingHorizontal: spacingScale.sm2,
      paddingVertical: 2,
      borderRadius: radiusScale.sm,
      overflow: "hidden",
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    aliases: { ...textScale.smMd, color: colors.textTertiary, marginBottom: 4 },
    notes: { ...textScale.md, color: colors.textSecondary, marginTop: 4 },

    sectionLabel: {
      ...textScale.label,
      fontFamily: fonts.mono,
      color: colors.textTertiary,
      paddingHorizontal: spacingScale.base,
      paddingTop: spacingScale.md,
      marginBottom: 0,
    },

    daySeparator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.borderFaint,
      marginHorizontal: spacingScale.base,
    },

    empty: { paddingTop: spacingScale.xl, paddingHorizontal: spacingScale.base, alignItems: "center" },
    emptyText: { ...textScale.md, color: colors.textMuted },

    notFound: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
    notFoundText: { ...textScale.lg, color: colors.textTertiary },
  });
}

// ── screen ────────────────────────────────────────────────────────────────────

export default function PersonDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const journal = useJournal();
  const router = useRouter();
  const { colors, fonts, common } = useTheme();
  const styles = useMemo(() => createStyles(colors, fonts), [colors, fonts]);

  const person = useMemo<Person | undefined>(
    () => journal.people.find((p) => p.id === id),
    [journal, id]
  );

  const groups = useMemo<DayGroupData[]>(() => {
    if (!person) return [];
    const matched = allEntries(journal)
      .filter((e) => e.participants?.includes(person.id))
      .sort((a, b) => entrySortKey(b).localeCompare(entrySortKey(a)));
    const map = new Map<string, Entry[]>();
    for (const e of matched) {
      const day = e.start.slice(0, 10);
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push(e);
    }
    return [...map.entries()].map(([iso, items]) => ({ iso, items }));
  }, [journal, person]);

  if (!person) {
    return (
      <View style={styles.notFound}>
        <Stack.Screen options={{ title: "Person", ...common.header }} />
        <Text style={styles.notFoundText}>Person not found</Text>
      </View>
    );
  }

  const totalEntries = groups.reduce((n, g) => n + g.items.length, 0);

  const handleDelete = () => {
    Alert.alert(
      `Remove ${person.name}?`,
      "This removes them from your people list and from all entries. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            // Scrub this person's ID from every entry that references them
            const affected = allEntries(journal).filter(
              (e) => e.participants?.includes(person.id),
            );
            if (affected.length > 0) {
              await Promise.all(
                affected.map((e) => {
                  const remaining = e.participants!.filter((pid) => pid !== person.id);
                  const updated = {
                    ...e,
                    participants: remaining.length > 0 ? remaining : undefined,
                  };
                  return putMany(storeFor(e), [updated]);
                }),
              );
            }
            await removeMany("people", [person.id]);
            router.back();
          },
        },
      ],
    );
  };

  return (
    <FlatList
      style={styles.list}
      data={groups}
      keyExtractor={(g) => g.iso}
      renderItem={({ item: group }) => (
          <DayGroup
            group={group}
            colors={colors}
            fonts={fonts}
            onEntryPress={(entry) => router.push(`/entry/${entry.id}`)}
            showReflection={false}
          />
        )}
      ItemSeparatorComponent={() => <View style={styles.daySeparator} />}
      ListHeaderComponent={
        <>
          <Stack.Screen
            options={{
              title: "",
              ...common.header,
              headerRight: () => (
                <Pressable onPress={handleDelete} hitSlop={12}>
                  <Ionicons name="trash-outline" size={20} color={colors.textMuted} />
                </Pressable>
              ),
            }}
          />

          {/* Profile card */}
          <View style={styles.profileCard}>
            <PersonAvatar person={person} size={56} colors={colors} fonts={fonts} />
            <View style={styles.profileBody}>
              <View style={styles.nameRow}>
                <Text style={styles.name}>{person.name}</Text>
                {person.isSelf && <Text style={styles.selfBadge}>you</Text>}
              </View>
              {person.aliases?.length ? (
                <Text style={styles.aliases}>{person.aliases.join(", ")}</Text>
              ) : null}
              {person.notes ? (
                <Text style={styles.notes}>{person.notes}</Text>
              ) : null}
            </View>
          </View>

          {totalEntries > 0 && (
            <Text style={styles.sectionLabel}>
              {totalEntries} shared {totalEntries === 1 ? "entry" : "entries"}
            </Text>
          )}
        </>
      }
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No shared entries yet.</Text>
        </View>
      }
      contentContainerStyle={styles.content}
    />
  );
}
