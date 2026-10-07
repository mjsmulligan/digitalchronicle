/**
 * ParticipantPicker — bottom-sheet modal for selecting who was present at an entry.
 *
 * Features:
 *   - Lists all Person records with toggle selection
 *   - Search/filter by name or alias
 *   - Inline "New person…" creation (writes to the "people" store directly)
 *   - Confirm returns the final ID array to the caller
 *
 * Usage:
 *   <ParticipantPicker
 *     visible={pickerVisible}
 *     selected={participants}
 *     people={journal.people}
 *     onConfirm={(ids) => { setParticipants(ids); setPickerVisible(false); }}
 *     onDismiss={() => setPickerVisible(false)}
 *   />
 */
import { useState, useMemo } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { putMany } from "@chronicle/journal/db";
import { uid, type Person } from "@chronicle/journal/types";
import {
  useTheme,
  type ThemeColors,
  type ThemeFonts,
  text as textScale,
  spacing as spacingScale,
  radius as radiusScale,
} from "./ThemeProvider";

// ── styles factory ─────────────────────────────────────────────────────────────

function createStyles(colors: ThemeColors, fonts: ThemeFonts) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.55)",
      justifyContent: "flex-end",
    },
    kav: { justifyContent: "flex-end" },
    sheet: {
      backgroundColor: colors.bg,
      borderTopLeftRadius: radiusScale["2xl"],
      borderTopRightRadius: radiusScale["2xl"],
      paddingBottom: spacingScale["3xl"],
      maxHeight: "75%",
    },
    handle: {
      width: 36,
      height: 4,
      backgroundColor: colors.border,
      borderRadius: 2,
      alignSelf: "center",
      marginTop: spacingScale.md,
      marginBottom: spacingScale.md,
    },
    title: {
      ...textScale.lg,
      fontFamily: fonts.serifBold,
      fontWeight: "700",
      color: colors.textPrimary,
      paddingHorizontal: spacingScale.lg,
      marginBottom: spacingScale.sm,
    },

    // Search bar
    searchWrap: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacingScale.sm,
      marginHorizontal: spacingScale.base,
      marginBottom: spacingScale.sm,
      paddingHorizontal: spacingScale.md2,
      paddingVertical: spacingScale.sm,
      backgroundColor: colors.surface,
      borderRadius: radiusScale.lg,
      borderWidth: 1,
      borderColor: colors.border,
    },
    searchInput: {
      flex: 1,
      ...textScale.base,
      color: colors.textPrimary,
      padding: 0,
    },

    list: { flexGrow: 0 },

    // Person row
    row: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: spacingScale.base,
      paddingVertical: spacingScale.md,
      gap: spacingScale.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderFaint,
    },
    rowPressed: { backgroundColor: colors.surfacePressed },
    avatar: {
      width: 36,
      height: 36,
      borderRadius: radiusScale.full,
      backgroundColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarSelf: { backgroundColor: colors.surfaceAccent },
    avatarText: {
      color: colors.textDim,
      fontSize: 13,
      fontWeight: "700",
    },
    name: {
      ...textScale.base,
      color: colors.textPrimary,
      flex: 1,
    },
    selfBadge: {
      color: colors.accentBadge,
      fontSize: 10,
      fontWeight: "700",
      backgroundColor: colors.surfaceAccentDeep,
      paddingHorizontal: spacingScale.sm2,
      paddingVertical: 2,
      borderRadius: radiusScale.sm,
      overflow: "hidden" as const,
      textTransform: "uppercase" as const,
      letterSpacing: 0.5,
    },

    // New person row
    newPersonRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: spacingScale.base,
      paddingVertical: spacingScale.sm,
      gap: spacingScale.md,
    },
    newNameInput: {
      flex: 1,
      ...textScale.base,
      color: colors.textPrimary,
      backgroundColor: colors.surface,
      borderRadius: radiusScale.lg,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacingScale.md2,
      paddingVertical: spacingScale.sm,
    },
    addBtn: {
      paddingHorizontal: spacingScale.md2,
      paddingVertical: spacingScale.sm,
      borderRadius: radiusScale.pill,
      backgroundColor: colors.accentBold,
    },
    addBtnText: {
      ...textScale.smMd,
      fontWeight: "700",
      color: colors.white,
    },

    // Confirm button
    confirmBtn: {
      marginHorizontal: spacingScale.base,
      marginTop: spacingScale.base,
      paddingVertical: spacingScale.md,
      borderRadius: radiusScale.pill,
      backgroundColor: colors.accentBold,
      alignItems: "center",
    },
    confirmText: {
      ...textScale.base,
      fontWeight: "700",
      color: colors.white,
    },
  });
}

// ── component ──────────────────────────────────────────────────────────────────

interface Props {
  visible: boolean;
  /** Current participant IDs */
  selected: string[];
  people: Person[];
  onConfirm: (ids: string[]) => void;
  onDismiss: () => void;
}

export function ParticipantPicker({
  visible,
  selected,
  people,
  onConfirm,
  onDismiss,
}: Props) {
  const { colors, fonts } = useTheme();
  const styles = useMemo(() => createStyles(colors, fonts), [colors, fonts]);

  const [localSelected, setLocalSelected] = useState<string[]>(selected);
  const [search, setSearch] = useState("");
  const [addingNew, setAddingNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return people;
    return people.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.aliases?.some((a) => a.toLowerCase().includes(q)),
    );
  }, [people, search]);

  const toggle = (id: string) => {
    setLocalSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const handleAddNew = async () => {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const newPerson: Person = {
        id: uid(),
        name,
        createdAt: new Date().toISOString(),
      };
      await putMany("people", [newPerson]);
      setLocalSelected((prev) => [...prev, newPerson.id]);
    } finally {
      setNewName("");
      setAddingNew(false);
      setCreating(false);
    }
  };

  const handleShow = () => {
    setLocalSelected(selected);
    setSearch("");
    setAddingNew(false);
    setNewName("");
  };

  const confirmLabel =
    localSelected.length === 0
      ? "No one · Done"
      : `${localSelected.length} ${localSelected.length === 1 ? "person" : "people"} · Done`;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onShow={handleShow}
      onRequestClose={onDismiss}
    >
      <Pressable style={styles.overlay} onPress={onDismiss}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.kav}
        >
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.handle} />
            <Text style={styles.title}>With…</Text>

            {/* Search bar */}
            <View style={styles.searchWrap}>
              <Ionicons name="search" size={15} color={colors.textMuted} />
              <TextInput
                style={styles.searchInput}
                value={search}
                onChangeText={setSearch}
                placeholder="Search people"
                placeholderTextColor={colors.textMuted}
                autoCorrect={false}
                returnKeyType="search"
              />
              {search.length > 0 && (
                <Pressable onPress={() => setSearch("")} hitSlop={8}>
                  <Ionicons name="close-circle" size={15} color={colors.textMuted} />
                </Pressable>
              )}
            </View>

            {/* People list */}
            <FlatList
              data={filtered}
              keyExtractor={(p) => p.id}
              style={styles.list}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item: p }) => {
                const isSelected = localSelected.includes(p.id);
                const initials = p.name
                  .split(" ")
                  .map((w) => w[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase();
                return (
                  <Pressable
                    style={({ pressed }) => [
                      styles.row,
                      pressed && styles.rowPressed,
                    ]}
                    onPress={() => toggle(p.id)}
                  >
                    <View style={[styles.avatar, p.isSelf && styles.avatarSelf]}>
                      <Text style={styles.avatarText}>{initials}</Text>
                    </View>
                    <Text style={styles.name} numberOfLines={1}>
                      {p.name}
                    </Text>
                    {p.isSelf && (
                      <Text style={styles.selfBadge}>you</Text>
                    )}
                    {isSelected && (
                      <Ionicons
                        name="checkmark"
                        size={20}
                        color={colors.accentSoft}
                      />
                    )}
                  </Pressable>
                );
              }}
              ListFooterComponent={
                addingNew ? (
                  // Inline new-person form
                  <View style={styles.newPersonRow}>
                    <View style={[styles.avatar, { backgroundColor: colors.borderFaint }]}>
                      <Ionicons
                        name="person-add-outline"
                        size={17}
                        color={colors.textMuted}
                      />
                    </View>
                    <TextInput
                      style={styles.newNameInput}
                      value={newName}
                      onChangeText={setNewName}
                      placeholder="Name"
                      placeholderTextColor={colors.textMuted}
                      autoFocus
                      returnKeyType="done"
                      onSubmitEditing={handleAddNew}
                    />
                    <Pressable
                      style={[styles.addBtn, (!newName.trim() || creating) && { opacity: 0.4 }]}
                      onPress={handleAddNew}
                      disabled={!newName.trim() || creating}
                    >
                      <Text style={styles.addBtnText}>
                        {creating ? "Adding…" : "Add"}
                      </Text>
                    </Pressable>
                  </View>
                ) : (
                  // "New person…" trigger row
                  <Pressable
                    style={({ pressed }) => [
                      styles.row,
                      pressed && styles.rowPressed,
                    ]}
                    onPress={() => {
                      setAddingNew(true);
                      setSearch("");
                    }}
                  >
                    <View style={[styles.avatar, { backgroundColor: colors.borderFaint }]}>
                      <Ionicons
                        name="person-add-outline"
                        size={17}
                        color={colors.accentSoft}
                      />
                    </View>
                    <Text style={[styles.name, { color: colors.accentSoft }]}>
                      New person…
                    </Text>
                  </Pressable>
                )
              }
            />

            {/* Confirm */}
            <Pressable
              style={styles.confirmBtn}
              onPress={() => onConfirm(localSelected)}
            >
              <Text style={styles.confirmText}>{confirmLabel}</Text>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}
