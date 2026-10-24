/**
 * Book builder (docs/specs/book-export.md, WP6): choose what goes in the book,
 * review and exclude entries, see a page estimate, export PDF and/or Markdown.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Sharing from "expo-sharing";
import { useJournal } from "@chronicle/journal/db";
import {
  bookFileBase,
  buildBookModel,
  buildReviewList,
  defaultDefinition,
  estimatePages,
  journalYears,
  validateDefinition,
  type BookDefinition,
  type SavedBook,
} from "@chronicle/journal/book";
import type { FeedKind } from "@chronicle/journal/feedFilter";
import { useTheme } from "../src/components/ThemeProvider";
import { writeBookPdf } from "../src/lib/bookPdf";
import { writeMarkdownZip } from "../src/lib/bookMarkdownZip";
import { SQLiteBookStore } from "../src/lib/storage/SQLiteBookStore";

const KINDS: { id: FeedKind; label: string }[] = [
  { id: "all", label: "Everything" },
  { id: "travel", label: "Travel" },
  { id: "film", label: "Films" },
  { id: "episode", label: "TV" },
  { id: "book", label: "Books" },
  { id: "concert", label: "Concerts" },
  { id: "social", label: "Social" },
  { id: "milestone", label: "Milestones" },
  { id: "memory", label: "Memories" },
];

type ExportKind = "pdf" | "markdown";
interface Exported {
  kind: ExportKind;
  uri: string;
  label: string;
}

const today = () => new Date().toISOString().slice(0, 10);
const newId = () => `book_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        {
          borderColor: on ? colors.accent : colors.border,
          backgroundColor: on ? colors.surfaceAccent : colors.surface,
        },
      ]}
    >
      <Text style={{ color: on ? colors.accentBold : colors.textSecondary, fontSize: 13 }}>
        {label}
      </Text>
    </Pressable>
  );
}

export default function BookBuilderScreen() {
  const { colors } = useTheme();
  const journal = useJournal();
  const { id: idParam } = useLocalSearchParams<{ id?: string }>();

  const idRef = useRef<string>(idParam ?? newId());
  const createdAt = useRef<string>(new Date().toISOString());
  const lastExportedAt = useRef<string | undefined>(undefined);
  const [def, setDef] = useState<BookDefinition>(() => defaultDefinition(journal, today()));
  const [loaded, setLoaded] = useState(!idParam);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exported, setExported] = useState<Exported[]>([]);

  useEffect(() => {
    if (!idParam) return;
    (async () => {
      const saved = await (await SQLiteBookStore.get()).get(idParam);
      if (saved) {
        setDef(saved.definition);
        createdAt.current = saved.createdAt;
        lastExportedAt.current = saved.lastExportedAt;
      }
      setLoaded(true);
    })().catch(() => setLoaded(true));
  }, [idParam]);

  const set = <K extends keyof BookDefinition>(k: K, v: BookDefinition[K]) => {
    setExported([]);
    setDef((d) => ({ ...d, [k]: v }));
  };
  const setText = (k: "subtitle" | "dedication", v: string) => set(k, v === "" ? undefined : v);

  const problems = useMemo(() => validateDefinition(def), [def]);
  const years = useMemo(() => journalYears(journal), [journal]);
  const people = useMemo(() => journal.people.filter((p) => !p.isSelf), [journal.people]);

  const summary = useMemo(() => {
    if (problems.length) return null;
    const model = buildBookModel(journal, def, { generatedOn: today() });
    return {
      entries: model.stats.entryCount,
      excluded: model.stats.excludedCount,
      chapters: model.chapters.length,
      pages: estimatePages(model, def.pageSize ?? "A4"),
    };
  }, [journal, def, problems]);
  const review = useMemo(
    () => (problems.length ? [] : buildReviewList(journal, def)),
    [journal, def, problems],
  );

  const toggleExcluded = (entryId: string) => {
    const cur = new Set(def.excludedEntryIds ?? []);
    if (cur.has(entryId)) cur.delete(entryId);
    else cur.add(entryId);
    set("excludedEntryIds", cur.size ? [...cur] : undefined);
  };
  const toggleChapter = (chapterId: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(chapterId)) n.delete(chapterId);
      else n.add(chapterId);
      return n;
    });

  const save = async (patch?: { exportedAt: string }) => {
    if (patch) lastExportedAt.current = patch.exportedAt;
    const book: SavedBook = {
      id: idRef.current,
      definition: def,
      createdAt: createdAt.current,
      updatedAt: new Date().toISOString(),
      ...(lastExportedAt.current ? { lastExportedAt: lastExportedAt.current } : {}),
    };
    await (await SQLiteBookStore.get()).put(book);
  };

  const run = async (kinds: ExportKind[]) => {
    setError(null);
    setExported([]);
    try {
      setBusy("Saving");
      await save();
      setBusy("Collecting entries");
      const model = buildBookModel(journal, def, { generatedOn: today() });
      const base = `${bookFileBase(def)}-${idRef.current.slice(-4)}`;
      const out: Exported[] = [];
      if (kinds.includes("pdf")) {
        setBusy("Making the PDF (this can take a minute)");
        const r = await writeBookPdf(model, {
          pageSize: def.pageSize ?? "A4",
          fileName: `${base}.pdf`,
        });
        out.push({
          kind: "pdf",
          uri: r.uri,
          label: `PDF, ${r.numberOfPages} pages, ${(r.sizeBytes / 1e6).toFixed(1)} MB`,
        });
      }
      if (kinds.includes("markdown")) {
        setBusy("Making the Markdown package");
        const r = await writeMarkdownZip(model, async () => null, `${base}-markdown.zip`);
        out.push({
          kind: "markdown",
          uri: r.uri,
          label: `Markdown zip, ${(r.sizeBytes / 1e6).toFixed(2)} MB`,
        });
      }
      await save({ exportedAt: new Date().toISOString() });
      setExported(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setBusy(null);
    }
  };

  const share = async (x: Exported) => {
    try {
      if (!(await Sharing.isAvailableAsync())) {
        setError("Sharing is not available on this device.");
        return;
      }
      await Sharing.shareAsync(x.uri, {
        mimeType: x.kind === "pdf" ? "application/pdf" : "application/zip",
        dialogTitle: def.title,
        UTI: x.kind === "pdf" ? "com.adobe.pdf" : "public.zip-archive",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open the share sheet.");
    }
  };

  const label = (t: string) => (
    <Text style={[styles.label, { color: colors.textSecondary }]}>{t}</Text>
  );
  const input = (value: string, onChange: (v: string) => void, extra: object = {}) => (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholderTextColor={colors.textTertiary}
      style={[
        styles.input,
        { color: colors.textPrimary, borderColor: colors.border, backgroundColor: colors.surface },
      ]}
      {...extra}
    />
  );

  if (!loaded) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  const canExport = !busy && problems.length === 0 && (summary?.entries ?? 0) > 0;

  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={styles.body}
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: "Book" }} />

      {label("Title")}
      {input(def.title, (v) => set("title", v), { placeholder: "My 2026" })}
      {label("Subtitle (optional)")}
      {input(def.subtitle ?? "", (v) => setText("subtitle", v))}
      {label("Dedication (optional)")}
      {input(def.dedication ?? "", (v) => setText("dedication", v), { multiline: true })}

      {label("From and to (YYYY-MM-DD)")}
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          {input(def.start, (v) => set("start", v), {
            autoCapitalize: "none",
            autoCorrect: false,
            keyboardType: "numbers-and-punctuation",
          })}
        </View>
        <View style={{ flex: 1 }}>
          {input(def.end, (v) => set("end", v), {
            autoCapitalize: "none",
            autoCorrect: false,
            keyboardType: "numbers-and-punctuation",
          })}
        </View>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
      >
        {years.map((y) => (
          <Chip
            key={y}
            label={y}
            on={def.start === `${y}-01-01` && def.end === `${y}-12-31`}
            onPress={() => setDef((d) => ({ ...d, start: `${y}-01-01`, end: `${y}-12-31` }))}
          />
        ))}
        {years.length > 1 && (
          <Chip
            label="Whole journal"
            on={def.start === `${years[0]}-01-01` && def.end === `${years[years.length - 1]}-12-31`}
            onPress={() =>
              setDef((d) => ({
                ...d,
                start: `${years[0]}-01-01`,
                end: `${years[years.length - 1]}-12-31`,
              }))
            }
          />
        )}
      </ScrollView>

      {label("Include")}
      <View style={styles.wrap}>
        {KINDS.map((k) => (
          <Chip
            key={k.id}
            label={k.label}
            on={(def.filter ?? "all") === k.id}
            onPress={() => set("filter", k.id === "all" ? undefined : k.id)}
          />
        ))}
      </View>
      {people.length > 0 && (
        <>
          {label("With")}
          <View style={styles.wrap}>
            <Chip label="Anyone" on={!def.personId} onPress={() => set("personId", undefined)} />
            {people.map((p) => (
              <Chip
                key={p.id}
                label={p.name}
                on={def.personId === p.id}
                onPress={() => set("personId", p.id)}
              />
            ))}
          </View>
        </>
      )}

      {label("Chapters")}
      <View style={styles.row}>
        <Chip
          label="By year"
          on={def.chapterMode === "year"}
          onPress={() => set("chapterMode", "year")}
        />
        <Chip
          label="By trip"
          on={def.chapterMode === "trip"}
          onPress={() => set("chapterMode", "trip")}
        />
      </View>
      {label("Page size")}
      <View style={styles.row}>
        <Chip
          label="A4"
          on={(def.pageSize ?? "A4") === "A4"}
          onPress={() => set("pageSize", "A4")}
        />
        <Chip label="A5" on={def.pageSize === "A5"} onPress={() => set("pageSize", "A5")} />
      </View>

      {problems.map((p) => (
        <Text key={p} style={{ color: colors.error, marginTop: 10 }}>
          {p}
        </Text>
      ))}

      {summary && (
        <View
          style={[styles.summary, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Text style={{ color: colors.textPrimary, fontWeight: "600" }}>
            {summary.entries} {summary.entries === 1 ? "entry" : "entries"} in {summary.chapters}{" "}
            {summary.chapters === 1 ? "chapter" : "chapters"}
            {summary.entries > 0 ? `, about ${summary.pages} pages` : ""}
          </Text>
          {summary.excluded > 0 && (
            <Text style={{ color: colors.textSecondary, marginTop: 2 }}>
              {summary.excluded} left out by you
            </Text>
          )}
          {summary.entries === 0 && (
            <Text style={{ color: colors.textSecondary, marginTop: 2 }}>
              Nothing matches these choices yet.
            </Text>
          )}
        </View>
      )}

      {review.length > 0 && (
        <>
          {label("Review: untick anything to leave out")}
          {review.map((c) => {
            const open = expanded.has(c.id);
            const left = c.entries.filter((e) => !e.excluded).length;
            return (
              <View key={c.id} style={[styles.chapter, { borderColor: colors.border }]}>
                <Pressable onPress={() => toggleChapter(c.id)} style={styles.chapterHead}>
                  <Ionicons
                    name={open ? "chevron-down" : "chevron-forward"}
                    size={16}
                    color={colors.textMuted}
                  />
                  <Text
                    style={{ flex: 1, color: colors.textPrimary, fontWeight: "600", marginLeft: 6 }}
                    numberOfLines={1}
                  >
                    {c.title}
                  </Text>
                  <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                    {left === c.entries.length
                      ? c.entries.length
                      : `${left} of ${c.entries.length}`}
                  </Text>
                </Pressable>
                {open &&
                  c.entries.map((e) => (
                    <Pressable
                      key={e.id}
                      onPress={() => toggleExcluded(e.id)}
                      style={styles.entryRow}
                    >
                      <Ionicons
                        name={e.excluded ? "square-outline" : "checkbox"}
                        size={20}
                        color={e.excluded ? colors.textMuted : colors.accent}
                      />
                      <Text
                        style={{ color: colors.textMuted, fontSize: 12, marginLeft: 8, width: 78 }}
                      >
                        {e.day}
                      </Text>
                      <Text
                        style={{
                          flex: 1,
                          color: e.excluded ? colors.textMuted : colors.textPrimary,
                          textDecorationLine: e.excluded ? "line-through" : "none",
                        }}
                        numberOfLines={1}
                      >
                        {e.label}
                      </Text>
                    </Pressable>
                  ))}
              </View>
            );
          })}
        </>
      )}

      <View style={{ marginTop: 20, gap: 10 }}>
        <Pressable
          disabled={!canExport}
          onPress={() => run(["pdf", "markdown"])}
          style={[styles.primary, { backgroundColor: colors.accent, opacity: canExport ? 1 : 0.4 }]}
        >
          <Text style={{ color: colors.bg, fontWeight: "600" }}>Export PDF and Markdown</Text>
        </Pressable>
        <View style={styles.row}>
          <Pressable
            disabled={!canExport}
            onPress={() => run(["pdf"])}
            style={[styles.secondary, { borderColor: colors.border, opacity: canExport ? 1 : 0.4 }]}
          >
            <Text style={{ color: colors.textPrimary }}>PDF only</Text>
          </Pressable>
          <Pressable
            disabled={!canExport}
            onPress={() => run(["markdown"])}
            style={[styles.secondary, { borderColor: colors.border, opacity: canExport ? 1 : 0.4 }]}
          >
            <Text style={{ color: colors.textPrimary }}>Markdown only</Text>
          </Pressable>
        </View>
        <Pressable
          disabled={!!busy || problems.length > 0}
          onPress={async () => {
            await save();
            setError(null);
          }}
          style={{ alignItems: "center", padding: 8, opacity: busy || problems.length ? 0.4 : 1 }}
        >
          <Text style={{ color: colors.textSecondary }}>Save without exporting</Text>
        </Pressable>
      </View>

      {busy && (
        <View style={[styles.row, { marginTop: 14, alignItems: "center" }]}>
          <ActivityIndicator />
          <Text style={{ color: colors.textSecondary }}>{busy}. Keep the app open.</Text>
        </View>
      )}
      {error && <Text style={{ color: colors.error, marginTop: 14 }}>{error}</Text>}
      {exported.length > 0 && (
        <View style={{ marginTop: 14, gap: 8 }}>
          <Text style={{ color: colors.textPrimary, fontWeight: "600" }}>Ready</Text>
          {exported.map((x) => (
            <Pressable
              key={x.uri}
              onPress={() => share(x)}
              style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <Ionicons name="share-outline" size={18} color={colors.accent} />
              <Text style={{ flex: 1, color: colors.textPrimary, marginLeft: 10 }}>{x.label}</Text>
              <Text style={{ color: colors.accent }}>Share or save</Text>
            </Pressable>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, paddingBottom: 64 },
  label: { fontSize: 13, marginTop: 16, marginBottom: 6 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 15,
  },
  row: { flexDirection: "row", gap: 8 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chips: { gap: 8, paddingTop: 8 },
  chip: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  summary: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, padding: 12, marginTop: 16 },
  chapter: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    marginBottom: 8,
    overflow: "hidden",
  },
  chapterHead: { flexDirection: "row", alignItems: "center", padding: 12 },
  entryRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  primary: { alignItems: "center", paddingVertical: 13, borderRadius: 10 },
  secondary: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
