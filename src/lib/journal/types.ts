import { timezoneFor } from "./geo";
import { localToUTC } from "./tz";

export type Source = "manual" | "viaduct" | "setlistfm" | "generic";
/** 1 = user manual (sovereign), 2 = primary transit/attendance records, 3 = secondary order/calendar records */
export type Tier = 1 | 2 | 3;
export type Mode = "air" | "rail" | "road";

/** How sure we are this fact is right, independent of Tier (which is precedence, not quality). */
export type Confidence = "confirmed" | "inferred" | "approximate";
export type Purpose = "work" | "family" | "leisure" | "other";

interface Base {
  id: string;
  source: Source;
  tier: Tier;
  /** Local wall-clock time at the start place, "YYYY-MM-DDTHH:mm" (or date only) */
  start: string;
  /** Local wall-clock time at the end place */
  end?: string;
  /** IANA zone for `start`, e.g. "Europe/Dublin". Undefined if the place couldn't be resolved. */
  startTz?: string;
  /** IANA zone for `end` */
  endTz?: string;
  /** `start` converted to UTC (ISO 8601). Undefined whenever startTz is unknown or start has no time. */
  startUTC?: string;
  /** `end` converted to UTC (ISO 8601) */
  endUTC?: string;
  tripId?: string;
  dedupeKey: string;
  journal?: string;
  /** Tier 1 manual overrides layered on top of source data */
  overrides?: Record<string, string>;
  createdAt: string;
  /** How sure we are this fact (not just this record) is right. Not the same as Tier. */
  confidence: Confidence;
  purpose?: Purpose;
  /** Person ids or free-text names of who was there */
  companions?: string[];
  /** Parsed source record, including nested JSON fields, retained for later reprocessing. */
  raw?: Record<string, unknown>;
  /** Where this fact came from: filename and row/index within it. */
  sourceRef?: string;
}

export interface Leg extends Base {
  kind: "leg";
  mode: Mode;
  from: string;
  to: string;
  fromName?: string;
  toName?: string;
  flightNumber?: string;
  aircraft?: string;
  operator?: string;
  trainNumber?: string;
  seat?: string;
}

export interface Stay extends Base {
  kind: "stay";
  place: string;
  city?: string;
  notes?: string;
}

export type EventCategory = "concert" | "gathering" | "celebration" | "milestone" | "memory" | "activity";
export const CATEGORY_LABEL: Record<EventCategory, string> = {
  concert: "Concert", gathering: "Gathering", celebration: "Celebration",
  milestone: "Milestone", memory: "Memory", activity: "Activity",
};

export interface JEvent extends Base {
  kind: "event";
  category: EventCategory;
  /** Headline: artist for concerts, title for other moments */
  artist: string;
  people?: string[];
  venue: string;
  city: string;
  country?: string;
  tour?: string;
  setlist?: string[];
}

export type Entry = Leg | Stay | JEvent;

export interface Note {
  id: string;
  /** YYYY-MM-DD day note, or attached to a trip */
  date?: string;
  tripId?: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}

export interface Trip {
  id: string;
  title: string;
  start: string;
  end: string;
  destinations: string[];
  notes: string;
  cover: string;
  createdAt: string;
  purpose?: Purpose;
}

export type StageStatus = "new" | "duplicate" | "supersedes" | "superseded" | "batch-duplicate";

export interface StagedRecord {
  entry: Entry;
  warnings: string[];
  status: StageStatus;
  matchId?: string;
  selected: boolean;
}

export interface Cluster {
  id: string;
  title: string;
  recordIds: string[];
  accepted: boolean;
}

export interface StagingBatch {
  id: string;
  source: Source;
  filename: string;
  createdAt: string;
  records: StagedRecord[];
  errors: string[];
  clusters: Cluster[];
  gapDays: number;
}

export interface JournalData {
  trips: Trip[];
  legs: Leg[];
  stays: Stay[];
  events: JEvent[];
  notes: Note[];
  staging: StagingBatch[];
}

export const STORES = ["trips", "legs", "stays", "events", "notes", "staging"] as const;
export type StoreName = (typeof STORES)[number];

export const SOURCE_LABEL: Record<Source, string> = {
  manual: "Manual",
  viaduct: "Viaduct",
  setlistfm: "setlist.fm",
  generic: "Generic",
};

export function view<T extends Entry>(e: T): T {
  if (!e.overrides) return e;
  const v = { ...e, ...e.overrides } as T;
  const keys = e.overrides;
  if (v.kind === "leg") {
    if ("start" in keys || "from" in keys) {
      v.startTz = timezoneFor(v.from);
      v.startUTC = localToUTC(v.start, v.startTz);
    }
    if ("end" in keys || "to" in keys) {
      v.endTz = timezoneFor(v.to);
      v.endUTC = v.end ? localToUTC(v.end, v.endTz) : undefined;
    }
  } else if ("city" in keys || "start" in keys || "end" in keys) {
    const tz = timezoneFor(v.city ?? "");
    v.startTz = tz;
    v.startUTC = localToUTC(v.start, tz);
    v.endTz = v.end ? tz : undefined;
    v.endUTC = v.end ? localToUTC(v.end, tz) : undefined;
  }
  return v;
}

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function day(s: string) {
  return s.slice(0, 10);
}

export function entryTitle(e: Entry): string {
  const v = view(e);
  if (v.kind === "leg") return `${v.from} → ${v.to}`;
  if (v.kind === "stay") return v.place;
  return v.category === "concert" && v.venue ? `${v.artist} @ ${v.venue}` : v.artist;
}
