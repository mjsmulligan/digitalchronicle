/**
 * People tab — all people in the journal, sorted by name.
 * Shows the journal owner (isSelf) first with a crown badge.
 */
import { useMemo } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Link, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useJournal, allEntries } from "@chronicle/journal/db";
import type { Person } from "@chronicle/journal/types";
import { useTheme, type ThemeColors, type ThemeFonts, text as textScale, spacing as spacingScale, radius as radiusScale } from "../../src/components/ThemeProvider";

// ── helpers ──────────────────────────────────────────────────────────────────

function entryCountFor(personId: string, entries: ReturnType<typeof allEntries>): number {
  return entries.filter((e) => e.participants?.includes(personId)).length;
}

// ── styles factory ────────────────────────────────────────────────────────────

function createStyles(colors: ThemeColors, fonts: ThemeFonts) {
  return StyleSheet.create({
    listAction: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "flex-end",
      paddingHorizontal: spacingScale.base,
      minHeight: 48,
    },
    listActionText: {
      fontSize: 14,
      fontFamily: fonts.sans,
      color: colors.accentSoft,
      fontWeight: "500",
    },
    list: { flex: 1, backgroundColor: colors.bg },
    row: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: spacingScale.base,
      paddingVertical: spacingScale.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderFaint,
      gap: spacingScale.md,
    },
    avatar: {
      width: 40,
      height: 40,
      borderRadius: radiusScale.full,
      backgroundColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarSelf: { backgroundColor: colors.surfaceAccent },
    avatarText: { color: colors.textDim, fontSize: 14, fontWeight: "700" },
    rowBody: { flex: 1 },
    nameRow: { flexDirection: "row", alignItems: "center", gap: spacingScale.sm },
    name: { ...textScale.base, color: colors.textPrimary, fontWeight: "500" },
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
    aliases: { ...textScale.sm, color: colors.textTertiary, marginTop: 2 },
    rowPressed: { backgroundColor: colors.surfacePressed },
    count: { ...textScale.sm, color: colors.textTertiary },
    chevron: { fontSize: 20, lineHeight: 44, color: colors.border },
    empty: {
      flex: 1,
      backgroundColor: colors.bg,
      alignItems: "center",
      justifyContent: "center",
      padding: spacingScale["2xl"],
    },
    emptyIcon: { fontSize: 48, marginBottom: spacingScale.base },
    emptyTitle: { fontSize: 18, fontWeight: "600", color: colors.textPrimary, marginBottom: spacingScale.sm },
    emptyHint: { ...textScale.md, color: colors.textTertiary, textAlign: "center" },
    ctaBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacingScale.sm2,
      marginTop: spacingScale.xl,
      paddingHorizontal: spacingScale.lg,
      paddingVertical: spacingScale.md,
      borderRadius: radiusScale.pill,
      backgroundColor: colors.accentBold,
    },
    ctaBtnText: { color: colors.white, fontSize: 15, fontWeight: "700" },
  });
}

type Styles = ReturnType<typeof createStyles>;

// ── components ────────────────────────────────────────────────────────────────

function PersonRow({
  person,
  entryCount,
  styles,
}: {
  person: Person;
  entryCount: number;
  styles: Styles;
}) {
  const initials = person.name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const router = useRouter();

  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={() => router.push(`/person/${person.id}`)}
    >
      <View style={[styles.avatar, person.isSelf && styles.avatarSelf]}>
        <Text style={styles.avatarText}>{initials}</Text>
      </View>
      <View style={styles.rowBody}>
        <View style={styles.nameRow}>
          <Text style={styles.name}>{person.name}</Text>
          {person.isSelf && <Text style={styles.selfBadge}>you</Text>}
        </View>
        {person.aliases?.length ? (
          <Text style={styles.aliases} numberOfLines={1}>
            {person.aliases.join(", ")}
          </Text>
        ) : null}
      </View>
      {entryCount > 0 && (
        <Text style={styles.count}>
          {entryCount} {entryCount === 1 ? "entry" : "entries"}
        </Text>
      )}
      <Text style={styles.chevron}>{"›"}</Text>
    </Pressable>
  );
}

// ── screen ───────────────────────────────────────────────────────────────────

export default function PeopleScreen() {
  const journal = useJournal();
  const { colors, fonts } = useTheme();
  const styles = useMemo(() => createStyles(colors, fonts), [colors, fonts]);

  const sorted = useMemo(() => {
    const entries = allEntries(journal);
    return [...journal.people]
      .sort((a, b) => {
        if (a.isSelf && !b.isSelf) return -1;
        if (!a.isSelf && b.isSelf) return 1;
        return a.name.localeCompare(b.name);
      })
      .map((p) => ({ person: p, entryCount: entryCountFor(p.id, entries) }));
  }, [journal]);

  if (!sorted.length) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyIcon}>👤</Text>
        <Text style={styles.emptyTitle}>No people yet</Text>
        <Text style={styles.emptyHint}>
          Add people from your phone contacts or a .vcf / contacts CSV file.
        </Text>
        <Link href="/sources" asChild>
          <Pressable style={styles.ctaBtn}>
            <Ionicons name="add" size={18} color="white" />
            <Text style={styles.ctaBtnText}>Import contacts</Text>
          </Pressable>
        </Link>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.list}
      data={sorted}
      keyExtractor={({ person }) => person.id}
      renderItem={({ item: { person, entryCount } }) => (
        <PersonRow person={person} entryCount={entryCount} styles={styles} />
      )}
      ListHeaderComponent={
        <Link href="/sources" asChild>
          <Pressable style={styles.listAction}>
            <Text style={styles.listActionText}>Import contacts</Text>
          </Pressable>
        </Link>
      }
    />
  );
}
