/**
 * Feed filter predicates, shared by anything that needs "what the main feed would show".
 *
 * These mirror `matchesFilter` and `entryHasPerson` in mobile/app/(tabs)/index.tsx
 * and `matches()` / `entryHasPerson()` in src/routes/index.tsx. The screens keep their
 * own copies for now; moving them onto this module is a separate, optional cleanup.
 * The book export (docs/specs/book-export.md) uses this module so a book built from
 * a filter matches what the feed shows for the same filter.
 *
 * Pure: no storage, no React, no device APIs.
 */
import type { Entry, JEvent, Person } from "./types";

/** Kind filters offered in the feed, excluding the transient "new" review filter. */
export type FeedKind =
  "all" | "travel" | "film" | "episode" | "book" | "concert" | "social" | "milestone" | "memory";

/** Every filter the feed can apply. "new" shows entries awaiting review. */
export type FeedFilter = FeedKind | "new";

export function matchesFilter(e: Entry, f: FeedFilter): boolean {
  if (f === "all") return true;
  if (f === "new") return e.unreviewed !== undefined;
  if (f === "travel") return e.kind === "leg" || e.kind === "stay";
  if (f === "film") return e.kind === "film";
  if (f === "episode") return e.kind === "episode";
  if (f === "book") return e.kind === "book";
  if (e.kind !== "event") return false;
  const ev = e as JEvent;
  if (f === "social") return ev.category === "gathering" || ev.category === "celebration";
  if (f === "memory") return ev.category === "memory" || ev.category === "activity";
  return ev.category === f; // "concert" | "milestone"
}

/**
 * The journal owner is implicitly present when `participants` is absent
 * (see docs/specs/people.md), so an absent list matches the self person.
 */
export function entryHasPerson(e: Entry, person: Person): boolean {
  if (person.isSelf) return !e.participants || e.participants.includes(person.id);
  return e.participants?.includes(person.id) ?? false;
}
