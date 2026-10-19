/**
 * Match names found in imported events to people in the journal.
 *
 * Two sources of names, deliberately treated differently:
 *   - Attendees (`companions`, taken from a calendar invite): matched on a person's
 *     full name or one of their aliases. A display name on an invite is a deliberate
 *     identity, so a nickname is a safe match.
 *   - Free text (title, notes): matched on a person's FULL name only, as a whole phrase.
 *     First names and nicknames are skipped here because "Mark", "Will" and "Rose" are
 *     also ordinary words and would tag the wrong people.
 *
 * A name shared by two people is never matched. Names with no match stay in `companions`.
 */
import type { Entry, Person } from "./types";

export interface PeopleIndex {
  selfId?: string;
  /** Normalised full name → people with that name. */
  byName: Map<string, Person[]>;
  /** Normalised alias → people with that alias. */
  byAlias: Map<string, Person[]>;
  /** Multi-word full names, for scanning free text. */
  phrases: { key: string; person: Person }[];
}

/** Lowercase, accent-free, punctuation-free, single-spaced. */
export function normName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export function buildPeopleIndex(people: Person[] | undefined): PeopleIndex {
  const index: PeopleIndex = { byName: new Map(), byAlias: new Map(), phrases: [] };
  for (const p of people ?? []) {
    if (p.isSelf) index.selfId = p.id;
    const full = normName(p.name);
    if (full) {
      push(index.byName, full, p);
      if (full.includes(" ")) index.phrases.push({ key: full, person: p });
    }
    for (const a of p.aliases ?? []) {
      const alias = normName(a);
      if (alias && alias !== full) push(index.byAlias, alias, p);
    }
  }
  return index;
}

/** The only person with this name or alias, or undefined when none or several. */
function uniquePerson(index: PeopleIndex, name: string): Person | undefined {
  const n = normName(name);
  if (!n) return undefined;
  const named = index.byName.get(n) ?? [];
  if (named.length === 1) return named[0];
  if (named.length > 1) return undefined;
  const aliased = index.byAlias.get(n) ?? [];
  return aliased.length === 1 ? aliased[0] : undefined;
}

/** Text fields worth scanning for names in an entry. */
function textFields(entry: Entry): string[] {
  const raw = (entry.raw ?? {}) as Record<string, unknown>;
  const e = entry as unknown as Record<string, unknown>;
  const fields = [raw.summary, raw.description, e.artist, e.place, e.title, entry.review];
  return fields.filter((f): f is string => typeof f === "string" && f.trim().length > 0);
}

export interface PeopleMatch {
  /** Person ids to set as participants, self first when a self person exists. Absent when no one else matched. */
  participants?: string[];
  /** Attendee names that matched nobody. These stay as free-text companions. */
  unmatched: string[];
  /** Number of attendee names consumed by a match (self included). */
  consumed: number;
  /** Number of other people matched (excludes self). */
  matched: number;
}

export function matchPeople(entry: Entry, index: PeopleIndex): PeopleMatch {
  const found = new Set<string>();
  const unmatched: string[] = [];
  let consumed = 0;

  // 1. Attendees: full name or alias.
  for (const name of entry.companions ?? []) {
    const person = uniquePerson(index, name);
    if (person) {
      found.add(person.id);
      consumed++;
    } else unmatched.push(name);
  }

  // 2. Free text: full names only, whole phrase.
  if (index.phrases.length) {
    const haystack = ` ${textFields(entry).map(normName).join(" | ")} `;
    const ambiguous = new Set(
      [...index.byName.entries()].filter(([, list]) => list.length > 1).map(([key]) => key),
    );
    for (const { key, person } of index.phrases) {
      if (ambiguous.has(key)) continue;
      if (haystack.includes(` ${key} `)) found.add(person.id);
    }
  }

  const others = [...found].filter((id) => id !== index.selfId);
  if (!others.length) return { unmatched, consumed, matched: 0 };
  // Setting participants replaces the implicit "just me", so self must be listed explicitly.
  const participants = [...(index.selfId ? [index.selfId] : []), ...others];
  return { participants, unmatched, consumed, matched: others.length };
}

/**
 * Apply a match to an entry about to be written. Entries that already carry
 * participants (the user's own choice) are returned untouched.
 */
export function withMatchedPeople(entry: Entry, index: PeopleIndex): Entry {
  if (entry.participants !== undefined) return entry;
  const m = matchPeople(entry, index);
  if (!m.participants && m.consumed === 0) return entry;
  const next: Entry = { ...entry };
  if (m.participants) next.participants = m.participants;
  if (m.unmatched.length) next.companions = m.unmatched;
  else delete next.companions;
  return next;
}
