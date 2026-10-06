import { view, type Entry, type StoreName, type Leg, type Stay, type JEvent, type Film, type Episode, type Book, type PlaceEvent, type PlaceEntry } from "./types";

export type EntryCategory = "movement" | "presence" | "attendance" | "consumption";

export interface KindDef {
  /** The JournalData store key that holds this kind */
  store: StoreName;
  /** Behavioural category — used to group kinds in the UI */
  category: EntryCategory;
  /** Human-readable title for an entry of this kind */
  title: (e: Entry) => string;
  /** Short place label for the staging and merge UI */
  placeLabel: (e: Entry) => string;
  /** Whether this entry kind carries a geocodable place (used to decide whether to load stations) */
  hasPlace: (e: Entry) => boolean;
  /** Source-agnostic dedupe key builder. Returns the key string. */
  buildKey: (e: Entry) => string;
  /** Field names the user can correct via overrides (excluding Base fields managed by the system) */
  editableFields: string[];
}

const normalise = (s: string) => s.toLowerCase().replace(/\s+/g, "-");

export const KIND_REGISTRY: Record<Entry["kind"], KindDef> = {
  leg: {
    store: "legs",
    category: "movement",
    title: (e) => {
      const v = view(e as Leg);
      return `${v.from} → ${v.to}`;
    },
    placeLabel: (e) => {
      const v = view(e as Leg);
      return v.toName ?? v.to;
    },
    hasPlace: (e) => {
      const l = e as Leg;
      const ov = l.overrides as Record<string, unknown> | undefined;
      return !!(l.from || l.to || ov?.from || ov?.to);
    },
    buildKey: (e) => {
      const l = e as Leg;
      return `leg|${l.start.slice(0, 10)}|${l.from.toUpperCase()}|${l.to.toUpperCase()}`;
    },
    editableFields: ["start", "end", "from", "to", "fromName", "toName", "mode", "flightNumber", "trainNumber", "operator", "seat"],
  },

  stay: {
    store: "stays",
    category: "presence",
    title: (e) => {
      const v = view(e as Stay);
      return v.place;
    },
    placeLabel: (e) => {
      const v = view(e as Stay);
      return v.city ?? v.place;
    },
    hasPlace: (e) => {
      const s = e as Stay;
      const ov = s.overrides as Record<string, unknown> | undefined;
      return !!(s.place || ov?.place || s.city || ov?.city);
    },
    buildKey: (e) => {
      const s = e as Stay;
      return `stay|${s.start.slice(0, 10)}|${s.place.toLowerCase()}`;
    },
    editableFields: ["start", "end", "place", "city", "notes"],
  },

  place: {
    store: "placeEvents",
    category: "presence",
    title: (e) => {
      const v = view(e as PlaceEvent);
      return v.country ? `${v.locality}, ${v.country}` : v.locality;
    },
    placeLabel: (e) => {
      const v = view(e as PlaceEvent);
      return v.locality;
    },
    hasPlace: (_e) => true,
    buildKey: (e) => {
      const p = e as PlaceEvent;
      return `place|${p.localityKey}|${p.start.slice(0, 10)}`;
    },
    editableFields: [],
  },

  "place-entry": {
    store: "placeEntries",
    category: "presence",
    title: (e) => {
      const v = view(e as PlaceEntry);
      const slug = v.localityKey.slice(v.localityKey.indexOf(":") + 1);
      return slug
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
    },
    placeLabel: (e) => {
      const v = view(e as PlaceEntry);
      return v.localDay;
    },
    hasPlace: (_e) => false,
    buildKey: (e) => {
      const p = e as PlaceEntry;
      return `place-entry|${p.localityKey}|${p.localDay}`;
    },
    editableFields: [],
  },

  event: {
    store: "events",
    category: "attendance",
    title: (e) => {
      const v = view(e as JEvent);
      return v.category === "concert" && v.venue ? `${v.artist} @ ${v.venue}` : v.artist;
    },
    placeLabel: (e) => {
      const v = view(e as JEvent);
      return v.city || v.venue;
    },
    hasPlace: (e) => {
      const j = e as JEvent;
      const ov = j.overrides as Record<string, unknown> | undefined;
      return !!(j.city || ov?.city);
    },
    buildKey: (e) => {
      const j = e as JEvent;
      return `event|${j.start.slice(0, 10)}|${normalise(j.artist)}`;
    },
    editableFields: ["start", "end", "artist", "venue", "city", "country", "category", "tour"],
  },

  film: {
    store: "films",
    category: "consumption",
    title: (e) => {
      const v = view(e as Film);
      return v.year ? `${v.title} (${v.year})` : v.title;
    },
    placeLabel: (e) => {
      const v = view(e as Film);
      return v.title;
    },
    hasPlace: (_e) => false,
    buildKey: (e) => {
      const f = e as Film;
      return `film|${normalise(f.title)}|${f.year ?? ""}|${f.start.slice(0, 10)}`;
    },
    editableFields: ["start", "title", "year", "director"],
  },

  episode: {
    store: "episodes",
    category: "consumption",
    title: (e) => {
      const v = view(e as Episode);
      return v.episodeTitle ? `${v.showTitle}: ${v.episodeTitle}` : v.showTitle;
    },
    placeLabel: (e) => {
      const v = view(e as Episode);
      return v.showTitle;
    },
    hasPlace: (_e) => false,
    buildKey: (e) => {
      const ep = e as Episode;
      return `episode|${normalise(ep.showTitle)}|${normalise(ep.season ?? "")}|${normalise(ep.episodeTitle ?? "")}|${ep.start.slice(0, 10)}`;
    },
    editableFields: ["start", "showTitle", "season", "episodeTitle", "episodeNumber"],
  },

  book: {
    store: "books",
    category: "consumption",
    title: (e) => {
      const v = view(e as Book);
      return v.author ? `${v.title} — ${v.author}` : v.title;
    },
    placeLabel: (e) => {
      const v = view(e as Book);
      return v.title;
    },
    hasPlace: (_e) => false,
    buildKey: (e) => {
      const b = e as Book;
      return `book|${normalise(b.title)}|${normalise(b.author)}|${b.start.slice(0, 10)}`;
    },
    editableFields: ["start", "title", "author", "year", "dateStarted"],
  },
};
