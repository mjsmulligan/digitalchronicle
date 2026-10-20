/**
 * Sources: the hub for every way data enters Chronicle.
 *
 * Layout (docs/specs/sources-page.md, section 4):
 *   Connected        status rows for sources that are set up and check themselves
 *   Add a source     a grid of tiles: Connect tiles (photos, calendar, Goodreads)
 *                    and File tiles (Netflix, Letterboxd, Viaduct, Setlist.fm, any file)
 *   Recent imports   the latest runs, with Keep all, Import again and Undo import
 *   People           phone contacts (creates People, not entries)
 *
 * Connect tiles and rows open a Sheet: the one-time connect steps for a source
 * that is not connected, or the manage controls for one that is
 * (docs/specs/sources-page.md, section 6).
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Stack, useRouter, useLocalSearchParams } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { Ionicons } from "@expo/vector-icons";
import { useJournal, putMany, allEntries, markRunReviewed, undoRun } from "@chronicle/journal/db";
import { importFile, type ImportResult } from "@chronicle/journal/import";
import { uid } from "@chronicle/journal/types";
import type { Person, ImportRun } from "@chronicle/journal/types";
import { readDeviceContacts } from "../src/lib/deviceContacts";
import { parseContacts } from "@chronicle/journal/contacts";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme, spacing, radius } from "../src/components/ThemeProvider";
import { ContactsReviewPanel, type ReviewContact, buildReviewContacts } from "../src/components/ContactsReviewPanel";
import { useDialog, Dialog } from "../src/components/Dialog";
import { SectionLabel } from "../src/components/sources/SourceCard";
import { CalendarSheet, CAL_SCOPE_DAYS, type CalendarListItem, type CalConnecting, type CalScope } from "../src/components/sources/CalendarSheet";
import { ContactsSourceCard, type ContactsPhase } from "../src/components/sources/ContactsSourceCard";
import { GoodreadsSheet } from "../src/components/sources/GoodreadsSheet";
import { PhotosSheet, photoScopeOptions, isScanActive } from "../src/components/sources/PhotosSheet";
import { Sheet } from "../src/components/sources/Sheet";
import { SourceTile } from "../src/components/sources/SourceTile";
import { ConnectedRow } from "../src/components/sources/ConnectedRow";
import { RecentImportRow, runSummary } from "../src/components/sources/RecentImportRow";
import { readDeviceCalendar } from "../src/lib/deviceCalendar";
import * as Calendar from "expo-calendar/legacy";
import { getCalendarPrefs, setCalendarPrefs } from "../src/lib/calendarPrefs";
import {
  fetchGoodreadsShelfCsv,
  parseGoodreadsUserId,
} from "@chronicle/journal/connectors/goodreads/rss";
import {
  getGoodreadsUserId,
  setGoodreadsUserId,
} from "../src/lib/goodreadsPrefs";
import { getScanMarker, clearScanMarker } from "../src/lib/exif/scanPrefs";
import { useExifScan } from "../src/lib/exif/useExifScan";
import type { ScanScope } from "../../src/lib/journal/sources/exif/types";
import {
  getSourceState,
  setSourceAutoCheck,
  runSourceNow,
  markSourceChecked,
  setDefaultStorage,
} from "../src/lib/connectedSources";
import { makeSyncPrefsStorage } from "../src/lib/syncPrefsStorage";
import {
  SOURCE_TILES,
  deriveSourceView,
  fmtRelative,
  tileForConnectedSource,
  tileForRunSource,
  type ConnectedSourceId,
  type FileTileDef,
  type SourceView,
} from "../src/lib/sourceRegistry";

// ─── Types ────────────────────────────────────────────────────────────────────

type ActiveSource = "calendar" | "goodreads" | "file" | "contacts" | null;

/** Connect sheets, keyed by the sync runner source id. */
type SheetId = ConnectedSourceId;

const TILE_GAP = 12;
const RECENT_LIMIT = 5;

interface StoredState {
  connected: boolean;
  autoCheck: boolean;
  lastCheckedAt: string | null;
  lastError: string | null;
}
const NOT_CONNECTED: StoredState = { connected: false, autoCheck: true, lastCheckedAt: null, lastError: null };

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({ title, right }: { title: string; right?: string }) {
  const { colors, fonts } = useTheme();
  return (
    <View style={sh.row}>
      <Text accessibilityRole="header" style={[sh.title, { color: colors.textBright, fontFamily: fonts.serifSemiBold }]}>
        {title}
      </Text>
      {right ? <Text style={[sh.right, { color: colors.textMuted }]}>{right}</Text> : null}
    </View>
  );
}

const sh = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  title: { fontSize: 18 },
  right: { fontSize: 13 },
});

// ─── Menu row (actions sheet) ─────────────────────────────────────────────────

function MenuRow({ label, icon, onPress, destructive }: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  onPress: () => void;
  destructive?: boolean;
}) {
  const { colors } = useTheme();
  const color = destructive ? colors.error : colors.textPrimary;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        minHeight: 52,
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.md,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Ionicons name={icon} size={20} color={color} />
      <Text style={{ fontSize: 16, color }}>{label}</Text>
    </Pressable>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function SourcesScreen() {
  const router = useRouter();
  const { uri: incomingUri } = useLocalSearchParams<{ uri?: string }>();
  const { top } = useSafeAreaInsets();
  const { colors, fonts } = useTheme();
  const { width, fontScale } = useWindowDimensions();
  const journal = useJournal();
  const dialog = useDialog();

  const [activeSource, setActiveSource] = useState<ActiveSource>(null);
  /** The File tile whose import is running (spinner on that tile). */
  const [fileTileId, setFileTileId] = useState<string | null>(null);

  // Sheets: a connect sheet for one source, and the actions menu for one run.
  const [sheet, setSheet] = useState<SheetId | null>(null);
  const [menuRun, setMenuRun] = useState<ImportRun | null>(null);
  const [showAllRuns, setShowAllRuns] = useState(false);
  const returnFocusRef = useRef<View | null>(null);
  const openers = useRef<Record<string, View | null>>({});
  const setOpener = (key: string) => (r: View | null) => { openers.current[key] = r; };

  // Contacts state
  const [contactsPhase, setContactsPhase] = useState<ContactsPhase>("idle");
  const [contactsReview, setContactsReview] = useState<ReviewContact[]>([]);
  const [contactsParseErrors, setContactsParseErrors] = useState<string[]>([]);
  const [contactsError, setContactsError] = useState<string | null>(null);

  // If sources was restored as the navigation root (Expo Go dev reload),
  // redirect to the tab root so the back button is available.
  useEffect(() => {
    if (!router.canGoBack()) {
      router.replace("/(tabs)");
    }
  }, []);

  // Goodreads state
  const [grId, setGrId] = useState<string | null>(null);
  const [grInput, setGrInput] = useState("");
  const [grEditing, setGrEditing] = useState(false);

  const anyActive = activeSource !== null;

  // ── Connected-source state ──────────────────────────────────────────────────

  // One storage instance for this screen session
  const syncStorage = useMemo(() => makeSyncPrefsStorage(), []);

  const [calAutoCheck, setCalAutoCheckState] = useState(true);
  const [calLastChecked, setCalLastChecked] = useState<string | null>(null);
  const [calLastError, setCalLastError] = useState<string | null>(null);
  // Calendar connect state
  const [calConnected, setCalConnected] = useState(false);
  const [calConnecting, setCalConnecting] = useState<CalConnecting>("idle");
  const [calendarList, setCalendarList] = useState<CalendarListItem[]>([]);
  const [calSelectedIds, setCalSelectedIds] = useState<Set<string>>(new Set());

  const [grAutoCheck, setGrAutoCheckState] = useState(true);
  const [grLastChecked, setGrLastChecked] = useState<string | null>(null);
  const [grLastError, setGrLastError] = useState<string | null>(null);

  const [photoState, setPhotoState] = useState<StoredState>(NOT_CONNECTED);
  const [photoScope, setPhotoScope] = useState<ScanScope>(() => photoScopeOptions()[0].value);
  const [photoScannedAt, setPhotoScannedAt] = useState<string | null>(null);
  const [calScope, setCalScope] = useState<CalScope>("last-year");
  const [calChosenCount, setCalChosenCount] = useState(0);
  // The scan hook lives here so a scan keeps going, and its row keeps showing
  // "Checking", when the sheet is closed.
  const exif = useExifScan();
  /** Sources being retried from an attention row. */
  const [retrying, setRetrying] = useState<Set<string>>(new Set());

  /** Reads every connected source's prefs. Called on mount and after anything that can change them. */
  const reload = useCallback(async () => {
    // Ensure default storage is set (may already be set by _layout boot hook)
    setDefaultStorage(syncStorage);
    const [cal, gr, photo, id, calPrefs, marker] = await Promise.all([
      getSourceState("icalendar", syncStorage),
      getSourceState("goodreads", syncStorage),
      getSourceState("photo-library", syncStorage),
      getGoodreadsUserId(),
      getCalendarPrefs(),
      getScanMarker(),
    ]);
    setCalAutoCheckState(cal.autoCheck);
    setCalLastChecked(cal.lastCheckedAt);
    setCalLastError(cal.lastError);
    setGrAutoCheckState(gr.autoCheck);
    setGrLastChecked(gr.lastCheckedAt);
    setGrLastError(gr.lastError);
    setGrId(id);
    setCalConnected(calPrefs.connected);
    setCalChosenCount(calPrefs.calendarIds.length);
    // A scan counts as a check, so the later of the scan and the last startup check is shown.
    const scanned = marker?.lastScannedAt ?? null;
    setPhotoScannedAt(scanned);
    if (marker && marker.scope.kind !== "since") setPhotoScope(marker.scope);
    const checked = [photo.lastCheckedAt, scanned].filter(Boolean).sort().pop() ?? null;
    setPhotoState({
      connected: marker !== null,
      autoCheck: photo.autoCheck,
      lastCheckedAt: checked,
      lastError: photo.lastError,
    });
  }, [syncStorage]);

  useEffect(() => { void reload(); }, [reload]);

  // ── Derived rows ────────────────────────────────────────────────────────────

  const itemCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of allEntries(journal)) counts[e.source] = (counts[e.source] ?? 0) + 1;
    return counts;
  }, [journal]);

  const connectedRows = useMemo(() => {
    const now = new Date();
    const stored: Record<ConnectedSourceId, StoredState> = {
      "photo-library": photoState,
      icalendar: {
        connected: calConnected, autoCheck: calAutoCheck,
        lastCheckedAt: calLastChecked, lastError: calLastError,
      },
      goodreads: {
        connected: grId !== null, autoCheck: grAutoCheck,
        lastCheckedAt: grLastChecked, lastError: grLastError,
      },
    };
    const busy = (id: ConnectedSourceId) =>
      retrying.has(id) ||
      (id === "photo-library" && isScanActive(exif.state.phase)) ||
      (id === "icalendar" && (activeSource === "calendar" || calConnecting === "loading")) ||
      (id === "goodreads" && activeSource === "goodreads");
    const rows: { id: ConnectedSourceId; view: SourceView }[] = [];
    for (const tile of SOURCE_TILES) {
      if (tile.kind !== "connect") continue;
      const st = stored[tile.connectedSourceId];
      if (!st.connected) continue;
      rows.push({
        id: tile.connectedSourceId,
        view: deriveSourceView({
          autoCheck: st.autoCheck,
          lastCheckedAt: st.lastCheckedAt,
          lastError: st.lastError,
          active: busy(tile.connectedSourceId),
          now,
          itemCount: itemCounts[tile.connectedSourceId],
        }),
      });
    }
    // Attention first, then the registry order (which is by name within a kind).
    return rows
      .map((r, i) => ({ r, i }))
      .sort((a, b) => Number(b.r.view.state === "attention") - Number(a.r.view.state === "attention") || a.i - b.i)
      .map(({ r }) => r);
  }, [photoState, calConnected, calAutoCheck, calLastChecked, calLastError,
      grId, grAutoCheck, grLastChecked, grLastError, retrying, activeSource,
      calConnecting, itemCounts, exif.state.phase]);

  const stateById = useMemo(() => {
    const m = new Map<ConnectedSourceId, SourceView["state"]>();
    for (const r of connectedRows) m.set(r.id, r.view.state);
    return m;
  }, [connectedRows]);

  // ── Sheets ──────────────────────────────────────────────────────────────────

  const openSheet = useCallback((id: SheetId, openerKey: string) => {
    returnFocusRef.current = openers.current[openerKey] ?? null;
    setSheet(id);
  }, []);

  const closeSheet = useCallback(() => {
    setSheet(null);
    void reload();
  }, [reload]);

  const retrySource = useCallback(async (id: ConnectedSourceId) => {
    setRetrying((prev) => new Set(prev).add(id));
    try {
      await runSourceNow(id, syncStorage);
    } catch {
      // runSourceNow stored the error; the row shows it
    } finally {
      setRetrying((prev) => { const next = new Set(prev); next.delete(id); return next; });
      void reload();
    }
  }, [syncStorage, reload]);

  // ── Recent imports ──────────────────────────────────────────────────────────

  // Map from runId -> count of entries still unreviewed (live, from journal state)
  const unreviewedByRun = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of allEntries(journal)) {
      if (e.importId && e.unreviewed !== undefined) {
        map.set(e.importId, (map.get(e.importId) ?? 0) + 1);
      }
    }
    return map;
  }, [journal]);

  // Newest-first
  const recentRuns = useMemo(
    () => [...journal.importRuns]
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    [journal.importRuns]
  );

  const handleKeepRun = useCallback((runId: string) => {
    void markRunReviewed(runId).catch(() => {});
  }, []);

  const handleUndoRun = useCallback((run: ImportRun) => {
    const n = unreviewedByRun.get(run.id) ?? 0;
    const m = run.replaced.length;
    const parts: string[] = [];
    if (n > 0) parts.push(`Hide ${n} ${n === 1 ? "entry" : "entries"} you have not reviewed`);
    if (m > 0) parts.push(`restore ${m} that ${m === 1 ? "was" : "were"} replaced`);
    const body = parts.length > 0
      ? `${parts.join(" and ")}? Hidden entries can be restored in Settings.`
      : "Nothing left to hide or restore for this import.";
    dialog.confirm(
      "Undo import",
      body,
      "Undo import",
      async () => { await undoRun(run.id); }
    );
  }, [unreviewedByRun, dialog]);

  const handleCalAutoCheckChange = useCallback(async (v: boolean) => {
    setCalAutoCheckState(v);
    await setSourceAutoCheck("icalendar", v, syncStorage);
  }, [syncStorage]);

  const handleGrAutoCheckChange = useCallback(async (v: boolean) => {
    setGrAutoCheckState(v);
    await setSourceAutoCheck("goodreads", v, syncStorage);
  }, [syncStorage]);

  // Returns true if a calendar should be excluded by default (system/automated)
  const isDefaultExcluded = (cal: Calendar.Calendar): boolean => {
    const typeStr = (cal.type as string | undefined)?.toLowerCase() ?? "";
    const srcType = (cal.source?.type as string | undefined)?.toLowerCase() ?? "";
    if (typeStr === "birthday" || srcType === "birthdays") return true;
    if (/birthday|holiday|siri/i.test(cal.title)) return true;
    return false;
  };

  const handleCalStartConnect = useCallback(async () => {
    setCalConnecting("loading");
    try {
      if (!(await Calendar.isAvailableAsync())) {
        dialog.alert("Not available", "This device does not expose a calendar.");
        setCalConnecting("idle");
        return;
      }
      const perm = await Calendar.requestCalendarPermissionsAsync();
      if (perm.status !== "granted") {
        if (!perm.canAskAgain) {
          dialog.alert(
            "Calendar access needed",
            "Enable calendar access for Chronicle in Settings, then try again.",
            () => void Linking.openSettings(),
          );
        } else {
          dialog.alert("Calendar access needed", "Chronicle needs permission to read your calendar.");
        }
        setCalConnecting("idle");
        return;
      }
      const cals = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
      const list: CalendarListItem[] = cals.map((c) => ({
        id: c.id,
        title: c.title,
        color: c.color ?? colors.accent,
        defaultExcluded: isDefaultExcluded(c),
      }));
      // Editing an existing connection starts from the saved choice; a new one from the defaults.
      const saved = await getCalendarPrefs();
      const savedIds = new Set(saved.calendarIds.filter((id) => list.some((c) => c.id === id)));
      const preSelected = saved.connected && savedIds.size > 0
        ? savedIds
        : new Set(list.filter((c) => !c.defaultExcluded).map((c) => c.id));
      setCalendarList(list);
      setCalSelectedIds(preSelected);
      setCalConnecting("picking");
    } catch (err) {
      dialog.alert("Connect failed", String(err));
      setCalConnecting("idle");
    }
  }, [colors.accent, dialog]);

  const handleToggleCalendar = useCallback((id: string) => {
    setCalSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleCalConnectDone = async () => {
    const ids = [...calSelectedIds];
    if (!ids.length) return;
    const firstConnect = !calConnected;
    await setCalendarPrefs({ connected: true, calendarIds: ids });
    setCalConnected(true);
    setCalChosenCount(ids.length);
    setCalConnecting("idle");
    if (firstConnect) {
      // The first check runs once the sheet has closed, and shows the normal summary.
      closeSheet();
      setTimeout(() => void importFromCalendar(CAL_SCOPE_DAYS["last-year"]), 280);
    }
  };

  const handleCalConnectCancel = useCallback(() => {
    setCalendarList([]);
    setCalSelectedIds(new Set());
    setCalConnecting("idle");
  }, []);

  const handleCalDisconnect = useCallback(async () => {
    await setCalendarPrefs({ connected: false, calendarIds: [] });
    setCalConnected(false);
    setCalConnecting("idle");
  }, []);

  // ── Import summary ──────────────────────────────────────────────────────────

  function buildSummaryMessage(result: ImportResult): string {
    const { added, updated, skipped, errors } = result;
    const countParts: string[] = [];
    if (added > 0) countParts.push(`${added} new`);
    if (updated > 0) countParts.push(`${updated} updated`);
    const line1 = countParts.length > 0 ? countParts.join(", ") + "." : "";

    const skipParts: string[] = [];
    const alreadyIn = skipped.duplicate + skipped.inFile;
    if (alreadyIn > 0) skipParts.push(`${alreadyIn} already in your journal`);
    if (skipped.removed === 1) skipParts.push("1 you hid earlier was skipped");
    else if (skipped.removed > 1) skipParts.push(`${skipped.removed} you hid earlier were skipped`);
    const line2 = skipParts.length > 0 ? skipParts.join(", ") + "." : "";

    const line3 = errors.length > 0
      ? `${errors.length} ${errors.length === 1 ? "row" : "rows"} could not be read.`
      : "";

    return [line1, line2, line3].filter(Boolean).join(" ");
  }

  const showImportSummary = (result: ImportResult) => {
    const { added, updated } = result;
    if (added === 0 && updated === 0) {
      dialog.alert("Nothing new", "Everything in this file is already in your journal.");
      return;
    }
    const message = buildSummaryMessage(result);
    dialog.show({
      title: "Import complete",
      message,
      actions: [
        {
          label: "Review new",
          style: "default" as const,
          onPress: () => router.navigate("/(tabs)"),
        },
        { label: "Done", style: "cancel" as const },
      ],
    });
  };

  // ── Source actions ──────────────────────────────────────────────────────────

  const processUri = async (uri: string, filename: string, tile?: FileTileDef) => {
    setActiveSource("file");
    setFileTileId(tile?.id ?? null);
    await new Promise<void>((r) => setTimeout(r, 50));
    try {
      const response = await fetch(uri);
      if (!response.ok) throw new Error(`Could not read file (HTTP ${response.status})`);
      const text = await response.text();
      await new Promise<void>((r) => setTimeout(r, 0));
      const result = await importFile(filename, text, tile?.connector ? { forced: tile.connector } : undefined);
      // A forced connector that read nothing and reported errors means the wrong kind of file.
      const skippedTotal = result.skipped.duplicate + result.skipped.inFile + result.skipped.removed;
      if (tile?.connector && result.added === 0 && result.updated === 0 && skippedTotal === 0 && result.errors.length > 0) {
        dialog.alert(`Not a ${tile.label} file`, tile.wrongFileMessage);
      } else {
        showImportSummary(result);
      }
    } catch (err) {
      dialog.alert("Import failed", String(err));
    } finally {
      setActiveSource(null);
      setFileTileId(null);
    }
  };

  /** Opens the picker. With a tile, the connector is forced; without, the file is detected. */
  const pickFile = async (tile?: FileTileDef) => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["text/csv", "text/calendar", "text/x-vcard", "application/json", "application/octet-stream", "*/*"],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets[0]) return;
      const { uri, name } = result.assets[0];
      await processUri(uri, name ?? "imported-file", tile);
    } catch (err) {
      dialog.alert("Import failed", String(err));
    }
  };

  const importContactsFromDevice = async () => {
    setActiveSource("contacts");
    setContactsPhase("parsing");
    setContactsError(null);
    try {
      const res = await readDeviceContacts();
      if (res.status === "unavailable") {
        dialog.alert("Not available", "Phone contacts can't be read on this device. Use a contacts file instead.");
        setContactsPhase("idle");
        setActiveSource(null);
        return;
      }
      if (res.status === "denied") {
        dialog.alert(
          "Contacts access needed",
          res.canAskAgain
            ? "Chronicle needs permission to read your contacts. Nothing leaves your phone."
            : "Contacts access is turned off. Enable it for Chronicle in your phone's Settings, then try again.",
          res.canAskAgain ? undefined : () => { Linking.openSettings(); },
        );
        setContactsPhase("idle");
        setActiveSource(null);
        return;
      }
      if (!res.contacts.length) {
        dialog.alert("No contacts found", "Your phone's address book has no named contacts.");
        setContactsPhase("idle");
        setActiveSource(null);
        return;
      }
      setContactsReview(buildReviewContacts(res.contacts, journal.people));
      setContactsParseErrors([]);
      setContactsPhase("review");
    } catch (err) {
      setContactsError(String(err));
      setContactsPhase("idle");
      setActiveSource(null);
    }
  };

  const importContactsFromFile = async (uri: string, filename: string) => {
    setActiveSource("contacts");
    setContactsPhase("parsing");
    setContactsError(null);
    await new Promise<void>((r) => setTimeout(r, 50));
    try {
      const response = await fetch(uri);
      if (!response.ok) throw new Error(`Could not read file (HTTP ${response.status})`);
      const text = await response.text();
      await new Promise<void>((r) => setTimeout(r, 0));
      const result = parseContacts(filename, text);
      if (!result.contacts.length && result.errors.length) throw new Error(result.errors[0]);
      setContactsReview(buildReviewContacts(result.contacts, journal.people));
      setContactsParseErrors(result.errors);
      setContactsPhase("review");
    } catch (err) {
      setContactsError(String(err));
      setContactsPhase("idle");
      setActiveSource(null);
    }
  };

  const pickContactsFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["text/vcard", "text/x-vcard", "text/csv", "*/*"],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets[0]) return;
      const { uri, name } = result.assets[0];
      await importContactsFromFile(uri, name ?? "contacts");
    } catch (err) {
      setContactsError(String(err));
    }
  };

  const commitContacts = async () => {
    const toAdd = contactsReview.filter((c) => c.selected);

    // For duplicate contacts that came from the device and carry a photo,
    // patch the existing Person record if it doesn't have a photo yet.
    const photoUpdates: Person[] = contactsReview
      .filter((c) => c.status === "duplicate" && c.matchId && c.draft.photo)
      .flatMap((c) => {
        const existing = journal.people.find((p) => p.id === c.matchId);
        if (!existing || existing.photo) return [];
        return [{ ...existing, photo: c.draft.photo! }];
      });

    if (!toAdd.length && !photoUpdates.length) return;
    setContactsPhase("committing");
    try {
      const now = new Date().toISOString();
      const newPeople: Person[] = toAdd.map(({ draft }) => ({
        id: uid(),
        name: draft.name,
        ...(draft.aliases?.length ? { aliases: draft.aliases } : {}),
        ...(draft.photo ? { photo: draft.photo } : {}),
        createdAt: now,
      }));

      await putMany("people", [...newPeople, ...photoUpdates]);
      setContactsReview([]);
      setContactsPhase("idle");
      setActiveSource(null);

      const parts: string[] = [];
      if (newPeople.length) parts.push(`${newPeople.length} ${newPeople.length === 1 ? "person" : "people"} added`);
      if (photoUpdates.length) parts.push(`${photoUpdates.length} photo${photoUpdates.length === 1 ? "" : "s"} updated`);
      dialog.alert("Import complete", parts.join(", ") + ".");
    } catch (err) {
      dialog.alert("Commit failed", String(err));
      setContactsPhase("review");
    }
  };

  const toggleContactSelected = (idx: number, selected: boolean) => {
    setContactsReview((prev) => prev.map((c, i) => (i === idx ? { ...c, selected } : c)));
  };

  const discardContactsReview = () => {
    setContactsReview([]);
    setContactsPhase("idle");
    setActiveSource(null);
  };

  useEffect(() => {
    if (!incomingUri) return;
    const filename = incomingUri.split("/").pop() ?? "shared-file";
    const lower = filename.toLowerCase();
    if (lower.endsWith(".vcf") || lower.endsWith(".vcard")) {
      void importContactsFromFile(incomingUri, filename);
    } else {
      void processUri(incomingUri, filename);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingUri]);

  const importFromCalendar = async (pastDays: number) => {
    setActiveSource("calendar");
    await new Promise<void>((r) => setTimeout(r, 50));
    try {
      const res = await readDeviceCalendar(pastDays, 0);
      if (res.status === "unavailable") {
        dialog.alert("Calendar unavailable", "This device doesn't expose a calendar.");
        return;
      }
      if (res.status === "denied") {
        if (!res.canAskAgain) {
          dialog.confirm(
            "Calendar access needed",
            "Allow calendar access in Settings. Nothing leaves your phone.",
            "Open Settings",
            () => void Linking.openSettings(),
          );
        } else {
          dialog.alert("Calendar access needed", "Chronicle needs permission to read your calendar.");
        }
        return;
      }
      if (!res.count) {
        await markSourceChecked("icalendar", syncStorage);
        dialog.alert("No events found", "No one-off events found in that time range.");
        return;
      }
      const result = await importFile("device-calendar.ics", res.ics, { forced: "icalendar" });
      await markSourceChecked("icalendar", syncStorage);
      showImportSummary(result);
    } catch (err) {
      dialog.alert("Import failed", String(err));
    } finally {
      setActiveSource(null);
      void reload();
    }
  };

  const syncGoodreads = async (userId: string) => {
    setActiveSource("goodreads");
    await new Promise<void>((r) => setTimeout(r, 50));
    try {
      const { csv, count } = await fetchGoodreadsShelfCsv(userId);
      if (!count) {
        await markSourceChecked("goodreads", syncStorage);
        dialog.alert("No books found", "Your Goodreads \"read\" shelf is empty or private.");
        return;
      }
      const result = await importFile(`goodreads-${userId}.csv`, csv, { forced: "goodreads" });
      await markSourceChecked("goodreads", syncStorage);
      showImportSummary(result);
    } catch (err) {
      dialog.alert("Import failed", String(err));
    } finally {
      setActiveSource(null);
      void reload();
    }
  };

  const onGoodreadsSync = () => {
    if (grId && !grEditing) syncGoodreads(grId);
    else setGrEditing(true);
  };

  const saveGoodreadsId = async () => {
    const id = parseGoodreadsUserId(grInput);
    if (!id) {
      dialog.alert("Couldn't read that", "Enter your Goodreads username (e.g. your-username or a profile URL).");
      return;
    }
    await setGoodreadsUserId(id);
    setGrId(id);
    setGrEditing(false);
    setGrInput("");
    void syncGoodreads(id);
  };

  const forgetGoodreads = async () => {
    await setGoodreadsUserId(null);
    setGrId(null);
    setGrEditing(false);
  };

  // Reconnect from an attention row: open the card and start the source's connect step.
  const reconnect = (id: ConnectedSourceId) => {
    openSheet(id, `row:${id}`);
    if (id === "icalendar") void handleCalStartConnect();
    if (id === "goodreads") { setGrInput(grId ?? ""); setGrEditing(true); }
    if (id === "photo-library") {
      // Asks for photo access again, then reads only photos added since the last scan.
      exif.reset();
      void exif.start({ kind: "since", timestamp: photoScannedAt ?? new Date(0).toISOString() });
    }
  };

  // ── Sheet helpers ───────────────────────────────────────────────────────────

  /** Closes the sheet, then runs `fn` once it has gone, so dialogs never open over it. */
  const runFromSheet = (fn: () => void) => {
    closeSheet();
    setTimeout(fn, 280);
  };

  const confirmDisconnect = (label: string, fn: () => void | Promise<void>) => {
    runFromSheet(() =>
      dialog.confirm(
        `Disconnect ${label}`,
        "Chronicle stops checking this source. Entries already imported stay in your journal.",
        "Disconnect",
        fn,
      ),
    );
  };

  /** The view for the open sheet's source (never missing: the sheet only opens for a known source). */
  const sheetView = (id: ConnectedSourceId): SourceView =>
    connectedRows.find((r) => r.id === id)?.view
    ?? { state: "active", statusLine: "Not connected", needsReconnect: false };

  const lastCheckDetail = (checkedAt: string | null, error: string | null): string => {
    const when = checkedAt ? fmtRelative(checkedAt) : "Never checked";
    return error ? `${when}\n${error.replace(/^(\w*Error):\s*/, "")}` : when;
  };

  // A finished scan counts as a successful check, so the row clears an old error.
  useEffect(() => {
    if (exif.state.phase !== "done") return;
    void markSourceChecked("photo-library", syncStorage).then(reload);
  }, [exif.state.phase, syncStorage, reload]);

  // ── Layout ──────────────────────────────────────────────────────────────────

  const contentWidth = width - spacing.lg * 2;
  const columns = width >= 600 ? 4 : fontScale >= 1.3 && width < 420 ? 2 : 3;
  const tileWidth = Math.floor((contentWidth - TILE_GAP * (columns - 1)) / columns);

  const sheetTile = sheet ? tileForConnectedSource(sheet) : undefined;
  const visibleRuns = showAllRuns ? recentRuns : recentRuns.slice(0, RECENT_LIMIT);

  /** Actions menu for one run. Runs after the sheet has closed so dialogs do not stack on it. */
  const afterMenu = (fn: () => void) => {
    setMenuRun(null);
    setTimeout(fn, 280);
  };
  const menuTile = menuRun && menuRun.trigger === "manual" ? tileForRunSource(menuRun.source) : undefined;
  const menuUnreviewed = menuRun ? (unreviewedByRun.get(menuRun.id) ?? 0) : 0;

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: "Sources",
          headerStyle: { backgroundColor: colors.surface },
          headerTitleStyle: {
            fontFamily: fonts.serifSemiBold,
            color: colors.textBright,
          },
          headerTintColor: colors.accent,
        }}
      />

      <ScrollView
        style={{ flex: 1, backgroundColor: colors.bg }}
        contentContainerStyle={{ paddingTop: spacing.md, paddingBottom: spacing["3xl"] }}
      >
        {/* ── Connected ──────────────────────────────────────────────────── */}
        {connectedRows.length > 0 ? (
          <>
            <SectionHeader
              title="Connected"
              right={`${connectedRows.length} ${connectedRows.length === 1 ? "source" : "sources"}`}
            />
            <View
              style={{
                marginHorizontal: spacing.lg,
                backgroundColor: colors.surface,
                borderColor: colors.borderFaint,
                borderWidth: 1,
                borderRadius: radius["2xl"],
                overflow: "hidden",
              }}
            >
              {connectedRows.map(({ id, view }, i) => {
                const tile = tileForConnectedSource(id);
                if (!tile) return null;
                return (
                  <View key={id}>
                    {i > 0 && <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.borderFaint }} />}
                    <ConnectedRow
                      tile={tile}
                      view={view}
                      openerRef={setOpener(`row:${id}`)}
                      onOpen={() => openSheet(id, `row:${id}`)}
                      onReconnect={() => reconnect(id)}
                      onRetry={() => void retrySource(id)}
                    />
                  </View>
                );
              })}
            </View>
          </>
        ) : (
          <Text style={{ fontSize: 14, lineHeight: 20, color: colors.textMuted, paddingHorizontal: spacing.lg, marginTop: spacing.sm }}>
            Nothing connected yet. Connect a source and it will check itself on every launch.
          </Text>
        )}

        {/* ── Add a source ───────────────────────────────────────────────── */}
        <SectionHeader title="Add a source" />
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: TILE_GAP, paddingHorizontal: spacing.lg }}>
          {SOURCE_TILES.map((tile) => (
            <SourceTile
              key={tile.id}
              tile={tile}
              width={tileWidth}
              openerRef={setOpener(`tile:${tile.id}`)}
              connectedState={tile.kind === "connect" ? stateById.get(tile.connectedSourceId) : undefined}
              busy={tile.kind === "file" && fileTileId === tile.id}
              disabled={anyActive && !(tile.kind === "file" && fileTileId === tile.id)}
              onPress={() => {
                if (tile.kind === "connect") openSheet(tile.connectedSourceId, `tile:${tile.id}`);
                else void pickFile(tile.connector ? tile : undefined);
              }}
            />
          ))}
        </View>
        <Text style={{ fontSize: 13, lineHeight: 18, color: colors.textMuted, paddingHorizontal: spacing.lg, marginTop: spacing.md }}>
          A tick means set up once and checked automatically. The other tiles ask for a file each time.
        </Text>

        {/* ── Recent imports ──────────────────────────────────────────────── */}
        {recentRuns.length > 0 && (
          <>
            <SectionHeader title="Recent imports" />
            <View
              style={{
                marginHorizontal: spacing.lg,
                backgroundColor: colors.surface,
                borderColor: colors.borderFaint,
                borderWidth: 1,
                borderRadius: radius["2xl"],
                overflow: "hidden",
              }}
            >
              {visibleRuns.map((run, i) => (
                <View key={run.id}>
                  {i > 0 && <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.borderFaint }} />}
                  <RecentImportRow run={run} onMenu={() => setMenuRun(run)} />
                </View>
              ))}
            </View>
            {recentRuns.length > RECENT_LIMIT && (
              <Pressable
                onPress={() => setShowAllRuns((v) => !v)}
                accessibilityRole="button"
                style={{ minHeight: 48, justifyContent: "center", paddingHorizontal: spacing.lg }}
              >
                <Text style={{ fontSize: 14, color: colors.accent, fontWeight: "600" }}>
                  {showAllRuns ? "Show fewer" : `Show all ${recentRuns.length}`}
                </Text>
              </Pressable>
            )}
          </>
        )}

        {/* ── People ──────────────────────────────────────────────────────── */}
        <SectionLabel label="People" colors={colors} />

        <ContactsSourceCard
          peopleCount={journal.people.length}
          phase={contactsPhase}
          disabled={anyActive && activeSource !== "contacts"}
          onImportFromDevice={importContactsFromDevice}
          onPickFile={pickContactsFile}
          colors={colors}
          fonts={fonts}
        />

        {/* Contacts review */}
        {contactsPhase === "review" && contactsReview.length > 0 && (
          <ContactsReviewPanel
            contacts={contactsReview}
            parseErrors={contactsParseErrors}
            photoUpdateCount={
              contactsReview.filter(
                (c) => c.status === "duplicate" && c.matchId && c.draft.photo &&
                  !journal.people.find((p) => p.id === c.matchId)?.photo,
              ).length
            }
            onToggle={toggleContactSelected}
            onSelectAll={() => setContactsReview((prev) => prev.map((c) => ({ ...c, selected: c.status === "new" })))}
            onDeselectAll={() => setContactsReview((prev) => prev.map((c) => ({ ...c, selected: false })))}
            onCommit={commitContacts}
            onDiscard={discardContactsReview}
            colors={colors}
            fonts={fonts}
          />
        )}
        {contactsError && contactsPhase === "idle" && (
          <View style={{ backgroundColor: colors.errorBg, borderRadius: radius.md, padding: spacing.md, marginHorizontal: spacing.lg, marginBottom: spacing.md }}>
            <Text style={{ color: colors.errorLight, fontSize: 13 }}>{contactsError}</Text>
          </View>
        )}
      </ScrollView>

      {/* Connect (not connected) or manage (connected) for one source. */}
      <Sheet
        visible={sheet !== null}
        title={sheetTile?.label ?? ""}
        onClose={closeSheet}
        returnFocusRef={returnFocusRef}
      >
        {sheet === "photo-library" && (
          <PhotosSheet
            connected={photoState.connected}
            view={sheetView("photo-library")}
            scan={exif.state}
            scope={photoScope}
            onScopeChange={setPhotoScope}
            onScan={() => { exif.reset(); void exif.start(photoScope); }}
            onCancelScan={exif.cancel}
            onCheckNow={() => void retrySource("photo-library")}
            autoCheck={photoState.autoCheck}
            onAutoCheck={(v) => { setPhotoState((st) => ({ ...st, autoCheck: v })); void setSourceAutoCheck("photo-library", v, syncStorage); }}
            lastCheckDetail={lastCheckDetail(photoState.lastCheckedAt, photoState.lastError)}
            onManagePlaces={() => { closeSheet(); router.push("/staging/places" as never); }}
            onDisconnect={() => confirmDisconnect("Photos", async () => { await clearScanMarker(); exif.reset(); await reload(); })}
          />
        )}
        {sheet === "icalendar" && (
          <CalendarSheet
            connected={calConnected}
            connecting={calConnecting}
            calendarList={calendarList}
            selectedIds={calSelectedIds}
            onToggleCalendar={handleToggleCalendar}
            onStartConnect={handleCalStartConnect}
            onConnectDone={handleCalConnectDone}
            onConnectCancel={handleCalConnectCancel}
            chosenCount={calChosenCount}
            scope={calScope}
            onScopeChange={setCalScope}
            view={sheetView("icalendar")}
            onCheckNow={() => runFromSheet(() => void importFromCalendar(CAL_SCOPE_DAYS[calScope]))}
            autoCheck={calAutoCheck}
            onAutoCheck={handleCalAutoCheckChange}
            lastCheckDetail={lastCheckDetail(calLastChecked, calLastError)}
            onDisconnect={() => confirmDisconnect("Google Calendar", async () => { await handleCalDisconnect(); await reload(); })}
          />
        )}
        {sheet === "goodreads" && (
          <GoodreadsSheet
            userId={grId}
            editing={grEditing}
            input={grInput}
            onInput={setGrInput}
            onStartEdit={() => { setGrInput(grId ?? ""); setGrEditing(true); }}
            onCancelEdit={() => setGrEditing(false)}
            onSave={() => { closeSheet(); setTimeout(() => void saveGoodreadsId(), 280); }}
            view={sheetView("goodreads")}
            onCheckNow={() => runFromSheet(() => { if (grId) void syncGoodreads(grId); })}
            autoCheck={grAutoCheck}
            onAutoCheck={handleGrAutoCheckChange}
            lastCheckDetail={lastCheckDetail(grLastChecked, grLastError)}
            onDisconnect={() => confirmDisconnect("Goodreads", async () => { await forgetGoodreads(); await reload(); })}
          />
        )}
      </Sheet>

      {/* Actions for one recent import. */}
      <Sheet
        visible={menuRun !== null}
        title={menuRun ? (menuRun.trigger === "startup" ? "Automatic import" : menuRun.filename) : ""}
        onClose={() => setMenuRun(null)}
      >
        {menuRun && (
          <View>
            <Text style={{ fontSize: 13, color: colors.textMuted, marginBottom: spacing.sm }}>
              {runSummary(menuRun) || "No changes"}
            </Text>
            {menuUnreviewed > 0 && (
              <MenuRow label={`Keep all ${menuUnreviewed}`} icon="checkmark-done-outline"
                onPress={() => afterMenu(() => handleKeepRun(menuRun.id))} />
            )}
            {menuTile && (
              <MenuRow label="Import again" icon="refresh-outline"
                onPress={() => afterMenu(() => void pickFile(menuTile.connector ? menuTile : undefined))} />
            )}
            <MenuRow label="Undo import" icon="arrow-undo-outline" destructive
              onPress={() => afterMenu(() => handleUndoRun(menuRun))} />
          </View>
        )}
      </Sheet>

      <Dialog {...dialog.props} onDismiss={dialog.dismiss} />
    </>
  );
}
