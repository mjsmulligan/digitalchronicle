/**
 * Import people screen — pick a .vcf or contacts CSV, review parsed contacts,
 * then commit selected ones to the people store.
 *
 * Uses parseContacts() from contacts.ts (shared with web). No staging batch
 * system — people are committed directly to the people store.
 */
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
  ScrollView,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { Ionicons } from "@expo/vector-icons";
import { useJournal, putMany } from "@chronicle/journal/db";
import { parseContacts, type ContactDraft } from "@chronicle/journal/contacts";
import { uid } from "@chronicle/journal/types";
import type { Person } from "@chronicle/journal/types";
import { colors, text, spacing, radius } from "../src/theme";

// ── types ──────────────────────────────────────────────────────────────────────

type ContactStatus = "new" | "duplicate";

interface ReviewContact {
  draft: ContactDraft;
  sourceRow: number;
  status: ContactStatus;
  /** ID of the existing person if duplicate */
  matchId?: string;
  selected: boolean;
}

type Phase = "idle" | "parsing" | "review" | "committing";

// ── helpers ───────────────────────────────────────────────────────────────────

function normName(s: string): string {
  return s.trim().toLowerCase();
}

function buildReviewContacts(
  contacts: { draft: ContactDraft; sourceRow: number }[],
  existing: Person[],
): ReviewContact[] {
  const byName = new Map(existing.map((p) => [normName(p.name), p]));
  const seenInBatch = new Set<string>();

  return contacts.map(({ draft, sourceRow }) => {
    const key = normName(draft.name);
    const match = byName.get(key);
    const isDupe = seenInBatch.has(key) || !!match;
    seenInBatch.add(key);
    return {
      draft,
      sourceRow,
      status: isDupe ? "duplicate" : "new",
      matchId: match?.id,
      selected: !isDupe,
    };
  });
}

// ── sub-components ────────────────────────────────────────────────────────────

function ContactRow({
  contact,
  onToggle,
}: {
  contact: ReviewContact;
  onToggle: (selected: boolean) => void;
}) {
  const isNew = contact.status === "new";
  return (
    <View style={[styles.contactRow, !isNew && styles.contactRowDim]}>
      <Switch
        value={contact.selected}
        onValueChange={onToggle}
        disabled={!isNew}
        trackColor={{ true: "#6366f1", false: "#334155" }}
        thumbColor={contact.selected ? "#e0e7ff" : "#94a3b8"}
        style={styles.contactSwitch}
      />
      <View style={styles.contactBody}>
        <Text style={styles.contactName}>{contact.draft.name}</Text>
        {contact.draft.aliases?.length ? (
          <Text style={styles.contactAliases} numberOfLines={1}>
            {contact.draft.aliases.join(", ")}
          </Text>
        ) : null}
      </View>
      <Text style={[styles.contactStatus, isNew ? styles.statusNew : styles.statusDupe]}>
        {isNew ? "new" : "exists"}
      </Text>
    </View>
  );
}

// ── screen ────────────────────────────────────────────────────────────────────

export default function ImportPeopleScreen() {
  const router = useRouter();
  const journal = useJournal();

  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [contacts, setContacts] = useState<ReviewContact[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);

  const newCount = contacts.filter((c) => c.status === "new").length;
  const selectedCount = contacts.filter((c) => c.selected).length;

  const pickFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["text/vcard", "text/x-vcard", "text/csv", "*/*"],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets[0]) return;
      const { uri, name } = result.assets[0];

      setPhase("parsing");
      setError(null);
      await new Promise<void>((resolve) => setTimeout(resolve, 50));

      const response = await fetch(uri);
      if (!response.ok) throw new Error(`Could not read file (HTTP ${response.status})`);
      const text = await response.text();

      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const result2 = parseContacts(name ?? "contacts", text);

      if (!result2.contacts.length && result2.errors.length) {
        throw new Error(result2.errors[0]);
      }

      const reviewed = buildReviewContacts(result2.contacts, journal.people);
      setContacts(reviewed);
      setParseErrors(result2.errors);
      setPhase("review");
    } catch (err) {
      setError(String(err));
      setPhase("idle");
    }
  };

  const toggleContact = (idx: number, selected: boolean) => {
    setContacts((prev) => prev.map((c, i) => (i === idx ? { ...c, selected } : c)));
  };

  const selectAll = () =>
    setContacts((prev) => prev.map((c) => ({ ...c, selected: c.status === "new" })));

  const deselectAll = () =>
    setContacts((prev) => prev.map((c) => ({ ...c, selected: false })));

  const handleCommit = async () => {
    const toAdd = contacts.filter((c) => c.selected);
    if (!toAdd.length) return;

    setPhase("committing");
    try {
      const now = new Date().toISOString();
      const people: Person[] = toAdd.map(({ draft }) => ({
        id: uid(),
        name: draft.name,
        ...(draft.aliases?.length ? { aliases: draft.aliases } : {}),
        createdAt: now,
      }));
      await putMany("people", people);
      Alert.alert(
        "Import complete",
        `${people.length} ${people.length === 1 ? "person" : "people"} added.`,
        [{ text: "OK", onPress: () => router.back() }]
      );
    } catch (err) {
      Alert.alert("Commit failed", String(err));
      setPhase("review");
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Stack.Screen
        options={{
          title: "Import People",
          headerStyle: { backgroundColor: "#1e293b" },
          headerTintColor: "#f8fafc",
          headerShadowVisible: false,
        }}
      />

      {/* File picker */}
      <Pressable
        style={[styles.pickBtn, phase === "parsing" && styles.pickBtnDisabled]}
        onPress={pickFile}
        disabled={phase === "parsing"}
      >
        <Ionicons name="person-add-outline" size={22} color="#818cf8" />
        <Text style={styles.pickBtnText}>Choose a contacts file</Text>
      </Pressable>
      <Text style={styles.hint}>Supports .vcf (vCard) and .csv (Google Contacts export)</Text>

      {/* Parsing */}
      {phase === "parsing" && (
        <View style={styles.parsing}>
          <ActivityIndicator color="#6366f1" />
          <Text style={styles.parsingText}>Parsing contacts…</Text>
        </View>
      )}

      {/* Error */}
      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorBoxText}>{error}</Text>
        </View>
      )}

      {/* Review */}
      {(phase === "review" || phase === "committing") && contacts.length > 0 && (
        <View style={styles.reviewCard}>
          {/* Summary */}
          <View style={styles.reviewHeader}>
            <Text style={styles.reviewTitle}>
              {contacts.length} contacts · {newCount} new · {selectedCount} selected
            </Text>
          </View>

          {/* Parse errors */}
          {parseErrors.length > 0 && (
            <View style={styles.errorsBox}>
              {parseErrors.slice(0, 3).map((e, i) => (
                <Text key={i} style={styles.errorText} numberOfLines={2}>{e}</Text>
              ))}
              {parseErrors.length > 3 && (
                <Text style={styles.errorText}>…and {parseErrors.length - 3} more</Text>
              )}
            </View>
          )}

          {/* Quick actions */}
          <View style={styles.quickActions}>
            <Pressable onPress={selectAll}>
              <Text style={styles.quickActionText}>Select new ({newCount})</Text>
            </Pressable>
            <Pressable onPress={deselectAll}>
              <Text style={styles.quickActionText}>Deselect all</Text>
            </Pressable>
          </View>

          {/* Contact list */}
          <FlatList
            data={contacts}
            keyExtractor={(_, i) => String(i)}
            renderItem={({ item, index }) => (
              <ContactRow
                contact={item}
                onToggle={(v) => toggleContact(index, v)}
              />
            )}
            scrollEnabled={false}
          />

          {/* Commit */}
          <View style={styles.commitBar}>
            {phase === "committing" ? (
              <View style={styles.committing}>
                <ActivityIndicator size="small" color="#6366f1" />
                <Text style={styles.committingText}>Saving…</Text>
              </View>
            ) : (
              <Pressable
                style={[styles.commitBtn, !selectedCount && styles.commitBtnDisabled]}
                disabled={!selectedCount}
                onPress={handleCommit}
              >
                <Text style={styles.commitBtnText}>
                  Add {selectedCount} {selectedCount === 1 ? "person" : "people"}
                </Text>
              </Pressable>
            )}
          </View>
        </View>
      )}
    </ScrollView>
  );
}

// ── styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.base, paddingBottom: spacing["2xl"] },

  pickBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.accent,
    borderStyle: "dashed",
    paddingVertical: 20,
    marginBottom: spacing.sm,
  },
  pickBtnDisabled: { opacity: 0.5 },
  pickBtnText: { ...text.lg, color: colors.accentSoft, fontWeight: "600" },
  hint: { ...text.sm, color: colors.textMuted, textAlign: "center", marginBottom: spacing.xl },

  parsing: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.base },
  parsingText: { ...text.md, color: colors.textSecondary },

  errorBox: { backgroundColor: colors.errorBg, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.base },
  errorBoxText: { ...text.smMd, color: colors.errorLight },

  reviewCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  reviewHeader: {
    padding: spacing.md2,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  reviewTitle: { ...text.smMd, color: colors.textSecondary },

  errorsBox: { backgroundColor: colors.errorBg, padding: 10 },
  errorText: { ...text.sm, color: colors.errorLight, marginBottom: 2 },

  quickActions: {
    flexDirection: "row",
    gap: spacing.base,
    padding: 10,
    paddingHorizontal: spacing.md2,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  quickActionText: { ...text.sm, color: colors.accent, fontWeight: "600" },

  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md2,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: 10,
  },
  contactRowDim: { opacity: 0.45 },
  contactSwitch: { transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] },
  contactBody: { flex: 1 },
  contactName: { ...text.md, color: colors.textPrimary, fontWeight: "500" },
  contactAliases: { ...text.sm, color: colors.textTertiary, marginTop: 2 },
  contactStatus: { fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  statusNew: { color: colors.success },
  statusDupe: { color: colors.textMuted },

  commitBar: { padding: spacing.md2 },
  commitBtn: {
    backgroundColor: colors.accentBold,
    borderRadius: radius.lg,
    paddingVertical: 14,
    alignItems: "center",
  },
  commitBtnDisabled: { opacity: 0.4 },
  commitBtnText: { ...text.base, color: colors.white, fontWeight: "700" },
  committing: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 14 },
  committingText: { ...text.md, color: colors.textSecondary },
});
