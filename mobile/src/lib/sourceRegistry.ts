/**
 * Sources page registry and state helper.
 *
 * Pure TypeScript (no native imports) so it can be tested in Node, like
 * connectedSources.ts. See docs/specs/sources-page.md, sections 5.2 and 5.3.
 *
 *   - SOURCE_TILES: the one place that says what appears in the "Add a source"
 *     grid. Adding a file connector means adding one entry here.
 *   - deriveSourceView: turns a connected source's raw state into the state,
 *     status line and reconnect flag shown by rows, tiles and sheets.
 *   - fmtRelative: the shared "2 hours ago" formatter.
 */

// ── Tile registry ─────────────────────────────────────────────────────────────

/** An Ionicons glyph name. Kept as a string so this module has no native imports. */
export type GlyphName = string;

/** Ids of the sources registered with the sync runner (connectedSources.ts). */
export type ConnectedSourceId = "photo-library" | "icalendar" | "goodreads";

interface TileBase {
  id: string;
  label: string;
  /** Key of SOURCE_MARKS (connectors/icons.ts). Absent: the tile uses `glyph`. */
  markId?: string;
  glyph: GlyphName;
}

export interface ConnectTileDef extends TileBase {
  kind: "connect";
  connectedSourceId: ConnectedSourceId;
  caption: string;
}

export interface FileTileDef extends TileBase {
  kind: "file";
  /** Connector id passed to importFile as `forced`. Absent for Any file: detection runs. */
  connector?: string;
  caption: string;
  /** Shown when the picked file does not parse as this source. */
  wrongFileMessage: string;
}

export type TileDef = ConnectTileDef | FileTileDef;

/**
 * Grid order: Connect tiles first, then File tiles by likely frequency, then
 * Any file as the catch-all. Frequency order is a constant, easy to change.
 */
export const SOURCE_TILES: readonly TileDef[] = [
  {
    id: "photos",
    kind: "connect",
    label: "Photos",
    glyph: "images-outline",
    connectedSourceId: "photo-library",
    caption: "Connect",
  },
  {
    id: "calendar",
    kind: "connect",
    label: "Calendar",
    glyph: "calendar-outline",
    connectedSourceId: "icalendar",
    caption: "Connect",
  },
  {
    id: "goodreads",
    kind: "connect",
    label: "Goodreads",
    markId: "goodreads",
    glyph: "book-outline",
    connectedSourceId: "goodreads",
    caption: "Connect",
  },
  {
    id: "netflix",
    kind: "file",
    label: "Netflix",
    markId: "netflix",
    glyph: "tv-outline",
    connector: "netflix",
    caption: "Import file",
    wrongFileMessage:
      "That file does not look like a Netflix export. Try Any file if you are not sure.",
  },
  {
    id: "letterboxd",
    kind: "file",
    label: "Letterboxd",
    markId: "letterboxd",
    glyph: "film-outline",
    connector: "letterboxd",
    caption: "Import file",
    wrongFileMessage:
      "That file does not look like a Letterboxd export. Try Any file if you are not sure.",
  },
  {
    id: "viaduct",
    kind: "file",
    label: "Viaduct",
    markId: "viaduct",
    glyph: "train-outline",
    connector: "viaduct",
    caption: "Import file",
    wrongFileMessage:
      "That file does not look like a Viaduct export. Try Any file if you are not sure.",
  },
  {
    id: "setlistfm",
    kind: "file",
    label: "Setlist.fm",
    glyph: "musical-notes-outline",
    connector: "setlistfm",
    caption: "Import file",
    wrongFileMessage:
      "That file does not look like a Setlist.fm export. Try Any file if you are not sure.",
  },
  {
    id: "any-file",
    kind: "file",
    label: "Any file",
    glyph: "document-outline",
    caption: "Choose any file",
    wrongFileMessage: "Chronicle could not read that file.",
  },
];

/** The tile for a connector id, or undefined. Used to map a run back to its tile. */
export function tileForConnector(connector: string): FileTileDef | undefined {
  return SOURCE_TILES.find(
    (t): t is FileTileDef => t.kind === "file" && t.connector === connector,
  );
}

/** The Connect tile for a sync-runner source id, or undefined. */
export function tileForConnectedSource(id: string): ConnectTileDef | undefined {
  return SOURCE_TILES.find(
    (t): t is ConnectTileDef => t.kind === "connect" && t.connectedSourceId === id,
  );
}

// ── Relative time ─────────────────────────────────────────────────────────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "just now", "5 minutes ago", "2 hours ago", "yesterday", "3 days ago", then a
 * short date ("12 Oct") from a week out. A future time reads as "just now".
 */
export function fmtRelative(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const secs = Math.round((now.getTime() - then.getTime()) / 1000);
  if (Number.isNaN(secs) || secs < 60) return "just now";
  if (secs < 3600) {
    const m = Math.round(secs / 60);
    return `${m} ${m === 1 ? "minute" : "minutes"} ago`;
  }
  if (secs < 86400) {
    const h = Math.round(secs / 3600);
    return `${h} ${h === 1 ? "hour" : "hours"} ago`;
  }
  const days = Math.round(secs / 86400);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return `${then.getDate()} ${MONTHS[then.getMonth()]}`;
}

// ── Source state ──────────────────────────────────────────────────────────────

export type SourceViewState = "active" | "checking" | "attention" | "paused";

export interface SourceView {
  state: SourceViewState;
  /** One line shown under the source name. */
  statusLine: string;
  /** Permission or credential problem (Reconnect), as opposed to a transient failure (Retry). */
  needsReconnect: boolean;
}

export interface SourceViewInput {
  autoCheck: boolean;
  lastCheckedAt: string | null;
  lastError: string | null;
  /** A check or scan is running now. */
  active: boolean;
  now: Date;
  /** Entries from this source, when cheaply known. Shown in the status line. */
  itemCount?: number;
}

/**
 * Error text that means the user has to grant or restore access, not retry.
 * Matches what the sources actually throw: "Permission needed" (calendar and
 * photos), and the Goodreads messages for a missing or private profile.
 */
const RECONNECT_PATTERN =
  /permission needed|profile not found|profile public|http (401|403|404)|access (has )?(expired|denied|revoked)/i;

/** "Error: Permission needed" (String(err)) becomes "Permission needed". */
function cleanError(raw: string): string {
  return raw.replace(/^(\w*Error):\s*/, "").trim();
}

export function deriveSourceView(input: SourceViewInput): SourceView {
  const { autoCheck, lastCheckedAt, lastError, active, now, itemCount } = input;

  if (active) {
    return { state: "checking", statusLine: "Checking now", needsReconnect: false };
  }

  if (lastError) {
    return {
      state: "attention",
      statusLine: cleanError(lastError),
      needsReconnect: RECONNECT_PATTERN.test(lastError),
    };
  }

  if (!autoCheck) {
    return { state: "paused", statusLine: "Automatic checks are off", needsReconnect: false };
  }

  const checked = lastCheckedAt ? `Checked ${fmtRelative(lastCheckedAt, now)}` : "Not checked yet";
  const items =
    itemCount !== undefined && itemCount > 0
      ? `, ${itemCount.toLocaleString("en-US")} ${itemCount === 1 ? "item" : "items"}`
      : "";
  return { state: "active", statusLine: checked + items, needsReconnect: false };
}
