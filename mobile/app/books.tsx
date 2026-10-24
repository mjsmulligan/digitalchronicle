/**
 * Saved books (docs/specs/book-export.md, WP6). Reached from the feed header.
 */
import { useCallback, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import type { SavedBook } from "@chronicle/journal/book";
import { useTheme } from "../src/components/ThemeProvider";
import { SQLiteBookStore } from "../src/lib/storage/SQLiteBookStore";

export default function BooksScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const [books, setBooks] = useState<SavedBook[] | null>(null);

  const load = useCallback(async () => {
    try {
      setBooks(await (await SQLiteBookStore.get()).list());
    } catch {
      setBooks([]);
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const confirmDelete = (b: SavedBook) =>
    Alert.alert(
      "Delete book?",
      `"${b.definition.title}" will be removed. Your journal entries are not affected.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            await (await SQLiteBookStore.get()).remove(b.id);
            await load();
          },
        },
      ],
    );

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.body}>
      <Stack.Screen options={{ title: "Books" }} />
      <Text style={{ color: colors.textSecondary, marginBottom: 14 }}>
        Turn your journal into a PDF or an editable Markdown book. A saved book can be exported
        again later, after new entries arrive.
      </Text>

      <Pressable
        onPress={() => router.push("/book-builder" as any)}
        style={[styles.primary, { backgroundColor: colors.accent }]}
      >
        <Ionicons name="add" size={18} color={colors.bg} />
        <Text style={{ color: colors.bg, fontWeight: "600" }}>New book</Text>
      </Pressable>

      {books?.map((b) => (
        <Pressable
          key={b.id}
          onPress={() => router.push({ pathname: "/book-builder", params: { id: b.id } } as any)}
          style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.textPrimary, fontSize: 16, fontWeight: "600" }}>
              {b.definition.title}
            </Text>
            <Text style={{ color: colors.textSecondary, fontSize: 13, marginTop: 2 }}>
              {b.definition.start} to {b.definition.end} ·{" "}
              {b.definition.chapterMode === "year" ? "by year" : "by trip"} ·{" "}
              {b.definition.pageSize ?? "A4"}
            </Text>
            <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>
              {b.lastExportedAt
                ? `Last exported ${b.lastExportedAt.slice(0, 10)}`
                : "Not exported yet"}
            </Text>
          </View>
          <Pressable onPress={() => confirmDelete(b)} hitSlop={10} accessibilityLabel="Delete book">
            <Ionicons name="trash-outline" size={18} color={colors.textMuted} />
          </Pressable>
        </Pressable>
      ))}
      {books && books.length === 0 && (
        <Text style={{ color: colors.textMuted, marginTop: 16 }}>No saved books yet.</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, paddingBottom: 48 },
  primary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
    marginBottom: 16,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 10,
  },
});
