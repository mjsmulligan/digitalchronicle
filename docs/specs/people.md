# People — Feature Specification

**Status:** Ready for implementation  
**Branch:** `feat/people`

---

## Motivation

Every journal entry involves people. The current model stores companions as free-text strings with no lookup, dedup, or person-centric view. This feature makes people first-class entities:

- A `Person` record in IndexedDB links entries to the same individual across imports and manual adds.
- The journal owner is a special "self" person who is implicitly a participant on every entry by default.
- A `/people` page surfaces the people in your journal and (in future) lets you browse the world through their lens.
- The design follows the app's "ingest, don't create" principle: people are imported from an existing contact list rather than typed in from scratch.

---

## Data model

### `Person` type

```ts
export interface Person {
  id: string;
  name: string;
  /** Alternative names / nicknames for matching (e.g. "Rob" for "Robert Smith"). */
  aliases?: string[];
  notes?: string;
  /** Marks the journal owner. Exactly one Person should have isSelf: true. */
  isSelf?: boolean;
  createdAt: string;
}
```

Added to `STORES` and `JournalData` as `people: Person[]`.

### `participants` field on Base

```ts
/** Person IDs (from the people store) who were present at this entry. */
participants?: string[];
```

**Display rule:**
- `participants` undefined / absent → the journal owner (the `isSelf` person) is implicitly present. Render self's name by default.
- `participants = []` → self was explicitly removed; no participants.
- `participants = ["selfId", "otherId"]` → self and one other person.

This avoids a retroactive migration: existing entries without `participants` are treated as "self only".

### Legacy `companions` field

The existing `companions?: string[]` on Base (and `people?: string[]` on JEvent) remains. Free-text names from imports (setlist.fm, iCal ATTENDEES, etc.) are stored there. They will not be linked to Person records automatically — that remains a future manual resolution step.

---

## Contacts import

### Parser

A standalone parser at `src/lib/journal/contacts.ts` — not using the Connector interface, since it produces `Person` records rather than journal entries.

```ts
export interface ContactDraft { name: string; aliases?: string[]; }
export interface ContactParseResult {
  contacts: { draft: ContactDraft; sourceRow: number }[];
  errors: string[];
}
export function parseContacts(filename: string, text: string): ContactParseResult;
```

**vCard (.vcf)**

- Unfold line continuations (same RFC 5545 rule as iCal: `\r\n ` or `\r\n\t`)
- Extract `BEGIN:VCARD` … `END:VCARD` blocks
- Properties used: `FN` (full name), `N` (structured name as fallback), `NICKNAME` (→ aliases, comma-separated)
- Skip contacts with no resolvable name

**Contacts CSV**

Accepts two common formats:
- *Google Contacts*: `First Name` + `Last Name` columns (+ optional `Nickname`)
- *Generic*: `Name` or `Full Name` column

Detection: if headers contain `First Name` / `Last Name` → Google format. If headers contain `Name` or `Full Name` → generic. Otherwise emit an error.

### Import UI on `/people`

A file drop zone on the `/people` page accepts `.vcf` and `.csv` files.

After parsing:
1. Show a preview list of found names.
2. Contacts whose normalised name already exists in the people store are shown as "already exists" and pre-deselected.
3. User selects which to import (default: all new ones selected).
4. "Import N contacts" button writes `Person` records to IndexedDB via `putMany("people", [...])`.

No staging hub involvement — contacts have no tier precedence or dedup key logic.

---

## `/people` route

### URL

`/people` — added to the main nav with the `Users` icon.

### Page structure

#### 1. Self setup (first visit only)

If no `Person` with `isSelf: true` exists, show a prompt card:

> **Set up your profile**  
> Add your name to appear as the default participant on all your entries.

Single input for name + Save button. Creates a `Person` with `isSelf: true`.

Once self exists, show a compact profile row at the top of the page with their name and an edit affordance.

#### 2. People index

- Filter pills: **All | Trips | Culture | Moments** — affects which entry types are counted
- Self person always appears first
- Others sorted alphabetically
- Each person card shows: name, aliases if any, entry count, most recent shared entry date
  - Entry count for self: computed from the filtered entry set (since self is implicitly present on all entries)
  - Entry count for others: computed from entries whose `participants` array contains this person's ID
- Clicking a person opens an inline detail panel (see Person view below)

#### 3. Contact import section

Collapsible section with file drop zone. Rendered below the people index.

### Person view (inline, first iteration)

Clicking a person on the index expands an inline detail panel showing their entries in reverse-chronological order, filtered by the active filter pill.

A dedicated `/people/:id` route (separate page per person) is deferred to a future iteration.

---

## Participant picker on entry cards

When an entry card is expanded:

- A **People** section appears below the trip selector
- Shows the current `participants` (resolved to names), plus self if participants is empty/absent
- Self appears first with a × to remove
- Each other participant also has a ×
- A typeahead input searches the people store by name and aliases, shows matching suggestions, and adds on selection
- Selecting a person who isn't in the store shows a "Create [name]" option that creates a new `Person` on the fly
- Saving the card writes the updated `participants` array

---

## DB changes

- `DB_VERSION` bumped from 3 → 4
- `people` object store created with `keyPath: "id"` on upgrade
- `empty()` and `clearAll()` updated to include `people: []`

---

## Build order

1. **types.ts + db.ts** — `Person` type, `participants` on Base, "people" store, DB_VERSION bump
2. **contacts.ts** — standalone vCard + CSV parser
3. **/people route** — self setup, contacts import, people index, inline person detail
4. **routeTree.gen.ts + __root.tsx** — route registration, nav link
5. **EntryCard** — participant picker (add/remove, typeahead, self default)

PRs 1–4 can ship together as `feat/people-foundation`. The participant picker (step 5) ships as `feat/participant-picker` once the store is populated.

---

## Out of scope for this iteration

- Name resolution on import: matching free-text `companions` strings to Person records
- Automated self-tagging on new imports
- `/people/:id` dedicated person timeline page
- People filter pills on Chronicle / Trips / Culture / Moments pages
- Merging duplicate Person records
