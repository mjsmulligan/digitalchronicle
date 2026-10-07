/**
 * ContactsReviewPanel — review contacts before adding them to the journal.
 *
 * Owns the ReviewContact type and buildReviewContacts helper so sources.tsx
 * can import them rather than defining them inline.
 *
 * Uses ReviewPanel for outer chrome (header, bulk actions, commit button
 * above the list). Item rows follow the trailing-switch convention used
 * by BatchReview and PlaceStagingCard.
 */
import React from "react";
import { StyleSheet, Switch, Text, View } from "react-native";
import { type ThemeColors, type ThemeFonts, spacing } from "./ThemeProvider";
import { ReviewPanel } from "./ReviewPanel";
import type { ContactDraft } from "@chronicle/journal/contacts";
import type { Person } from "@chronicle/journal/types";

// ── Types & helpers ───────────────────────────────────────────────────────────

export type ContactStatus = "new" | "duplicate";

export interface ReviewContact {
  draft: ContactDraft;
  sourceRow: number;
  status: ContactStatus;
  matchId?: string;
  selected: boolean;
}

function normContactName(s: string): string {
  return s.trim().toLowerCase();
}

export function buildReviewContacts(
  contacts: { draft: ContactDraft; sourceRow: number }[],
  existing: Person[],
): ReviewContact[] {
  const byName = new Map(existing.map((p) => [normContactName(p.name), p]));
  const seenInBatch = new Set<string>();
  return contacts.map(({ draft, sourceRow }) => {
    const key = normContactName(draft.name);
    const match = byName.get(key);
    const isDupe = seenInBatch.has(key) || !!match;
    seenInBatch.add(key);
    return { draft, sourceRow, status: isDupe ? "duplicate" : "new", matchId: match?.id, selected: !isDupe };
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

export interface ContactsReviewPanelProps {
  contacts: ReviewContact[];
  parseErrors: string[];
  /** Number of existing people whose photo will be silently updated on commit. */
  photoUpdateCount?: number;
  onToggle: (idx: number, selected: boolean) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onCommit: () => void;
  onDiscard: () => void;
  colors: ThemeColors;
  fonts: ThemeFonts;
}

export function ContactsReviewPanel({
  contacts,
  parseErrors,
  photoUpdateCount = 0,
  onToggle,
  onSelectAll,
  onDeselectAll,
  onCommit,
  onDiscard,
  colors,
  fonts,
}: ContactsReviewPanelProps) {
  const newCount = contacts.filter((c) => c.status === "new").length;
  const selectedCount = contacts.filter((c) => c.selected).length;

  const commitParts: string[] = [];
  if (selectedCount > 0) commitParts.push(`Add ${selectedCount}`);
  if (photoUpdateCount > 0) commitParts.push(`update ${photoUpdateCount} photo${photoUpdateCount === 1 ? "" : "s"}`);
  const commitLabel = commitParts.length ? commitParts.join(", ") : "Nothing to add";

  return (
    <ReviewPanel
      title="Contacts"
      meta={`${contacts.length} contacts · ${newCount} new · ${selectedCount} selected`}
      onDiscard={onDiscard}
      discardIcon="close"
      errors={parseErrors}
      bulkActions={[
        { label: `Select new (${newCount})`, onPress: onSelectAll },
        { label: "Deselect all", onPress: onDeselectAll },
      ]}
      commitLabel={commitLabel}
      onCommit={onCommit}
      commitDisabled={selectedCount === 0 && photoUpdateCount === 0}
      colors={colors}
      fonts={fonts}
    >
      {contacts.map((contact, idx) => {
        const isNew = contact.status === "new";
        return (
          <View
            key={idx}
            style={[cr.row, { borderBottomColor: colors.border }, !isNew && cr.dim]}
          >
            <View style={cr.body}>
              <Text style={[cr.name, { color: colors.textPrimary, fontFamily: fonts.sans }]}>
                {contact.draft.name}
              </Text>
              {contact.draft.aliases?.length ? (
                <Text style={[cr.alias, { color: colors.textTertiary }]} numberOfLines={1}>
                  {contact.draft.aliases.join(", ")}
                </Text>
              ) : null}
            </View>
            <Text style={[cr.badge, { color: isNew ? colors.success : colors.textMuted }]}>
              {isNew ? "new" : "exists"}
            </Text>
            <Switch
              value={contact.selected}
              onValueChange={(v) => onToggle(idx, v)}
              disabled={!isNew}
              trackColor={{ true: colors.accent, false: colors.border }}
              thumbColor={contact.selected ? colors.accentSoft : colors.textMuted}
              style={cr.sw}
            />
          </View>
        );
      })}
    </ReviewPanel>
  );
}

const cr = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  dim: { opacity: 0.45 },
  body: { flex: 1 },
  name: { fontSize: 14, fontWeight: "500" },
  alias: { fontSize: 12, marginTop: 2 },
  badge: { fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  sw: { transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] },
});
