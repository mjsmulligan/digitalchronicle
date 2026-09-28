export type Source = "manual" | "fr24" | "viaduct" | "setlistfm" | "generic";
/** 1 = user manual (sovereign), 2 = primary transit/attendance records, 3 = secondary order/calendar records */
export type Tier = 1 | 2 | 3;
export type Mode = "air" | "rail" | "road";

interface Base {
  id: string;
  source: Source;
  tier: Tier;
  /** Local wall-clock time, "YYYY-MM-DDTHH:mm" (or date only) */
  start: string;
  end?: string;
  tripId?: string;
  dedupeKey: string;
  journal?: string;
  /** Tier 1 manual overrides layered on top of source data */
  overrides?: Record<string, string>;
  createdAt: string;
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

export interface JEvent extends Base {
  kind: "event";
  artist: string;
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
  fr24: "Flightradar24",
  viaduct: "Viaduct",
  setlistfm: "setlist.fm",
  generic: "Generic",
};

export function view<T extends Entry>(e: T): T {
  return e.overrides ? ({ ...e, ...e.overrides } as T) : e;
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
  return `${v.artist} @ ${v.venue}`;
}
