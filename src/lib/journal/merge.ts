/**
 * One merge policy for everything that combines two records of the same thing
 * (docs/specs/merge-dedup.md, section 4.4).
 *
 *   refreshFromSource  the same source says something new about an entry
 *   mergeEntries       fold another record into a base entry (import enrich, same-file
 *                      duplicate rows, manual merge)
 *   enrichEntry        mergeEntries for imports, with a "did anything change" report
 *
 * Principles: no source overwrites another source, the user's data always stays, and
 * provenance is never lost.
 */
import { stable } from "./classify";
import { mergeEvaluation } from "./evaluation";
import { KIND_REGISTRY } from "./kinds";
import type { Entry } from "./types";

/** A row folded into an entry is kept for splitting; older ones are dropped beyond this. */
export const MAX_ABSORBED = 5;

type Rec = Record<string, unknown>;
type SourceRef = { source: string; sourceRef?: string };

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
}

const sameRef = (a: SourceRef, b: SourceRef) => a.source === b.source && a.sourceRef === b.sourceRef;
const toRef = (r: SourceRef): SourceRef => ({ source: r.source, ...(r.sourceRef ? { sourceRef: r.sourceRef } : {}) });

export interface MergeOptions {
  /**
   * Record the folded-in row in `absorbed` and the fields it filled in `fieldSources`,
   * so the merge can be split again. Used by import, not by manual merge.
   */
  absorb?: boolean;
}

/**
 * Folds `other` into `base`. `base` keeps its id, kind, source and sourceRef, and nothing
 * is forced to "manual".
 *
 *  - Gaps are filled: a field that is empty on `base` and present on `other` is copied.
 *    Only the kind's editable fields (plus end and the time zone / UTC fields) are filled.
 *    Where both sides hold a value, `base` keeps its own (conflicts are not stored).
 *  - reflection: concatenated when both exist in a manual merge (not repeated if already
 *    contained). An import (`absorb`) only fills it when the base has none.
 *  - review and rating: `base`'s, else `other`'s (a source-locked rating stays locked).
 *    When both sides have a review, `other`'s is dropped.
 *  - overrides: unioned, `base` wins on a clash. participants: unioned.
 *  - tripId and seriesId: `base`'s, else `other`'s.
 *  - additionalSources: `other`'s source (and its own extras), by source plus sourceRef.
 *
 * Both entries must be of the same kind.
 */
export function mergeEntries<T extends Entry>(base: T, other: Entry, opts: MergeOptions = {}): T {
  if (other.kind !== base.kind) {
    throw new Error(`Cannot merge a ${other.kind} entry into a ${base.kind} entry`);
  }
  const out: Rec = { ...(base as unknown as Rec) };
  const o = other as unknown as Rec;
  const ref = other.sourceRef ?? other.source;
  const filled: Record<string, string> = {};
  const fill = (k: string) => {
    if (isEmpty(out[k]) && !isEmpty(o[k])) { out[k] = o[k]; filled[k] = ref; }
  };

  // Fillable fields. The zone and UTC fields are only copied when they describe the same
  // local time as the base, so a date-only start never gains a UTC instant.
  for (const k of KIND_REGISTRY[base.kind].editableFields) fill(k);
  if (out.start === o.start) { fill("startTz"); fill("startUTC"); }
  if (out.end !== undefined && out.end === o.end) { fill("endTz"); fill("endUTC"); }

  // Evaluation: reflection is the user's, review and rating come from sources.
  const bRef = base.reflection;
  const oRef = other.reflection;
  if (opts.absorb) {
    // An import never adds to the user's own words (some connectors put source notes in
    // `reflection`): it only fills the gap when there is nothing.
    out.reflection = bRef ?? oRef;
    if (!bRef && oRef) filled.reflection = ref;
  } else {
    // A manual merge keeps both people's notes.
    out.reflection =
      bRef && oRef ? (bRef.includes(oRef) ? bRef : `${bRef}\n\n---\n\n${oRef}`) : (bRef ?? oRef);
  }
  fill("review");
  if (base.rating === undefined || base.rating === null) {
    if (other.rating !== undefined && other.rating !== null) {
      out.rating = other.rating;
      filled.rating = ref;
      if (other.sourceLocked?.includes("rating")) out.sourceLocked = ["rating"];
    }
  }

  // User-owned data.
  if (base.overrides || other.overrides) {
    out.overrides = { ...(other.overrides ?? {}), ...(base.overrides ?? {}) };
  }
  // Undefined participants mean "the journal owner only", so an unset base adopts the
  // other side's tagged people (as a refresh does) instead of unioning with nothing.
  if (base.participants === undefined) {
    out.participants = other.participants;
  } else {
    out.participants = Array.from(new Set([...base.participants, ...(other.participants ?? [])]));
  }
  out.tripId = base.tripId ?? other.tripId;
  const seriesOf = (e: Entry) => ("seriesId" in e ? (e as { seriesId?: string }).seriesId : undefined);
  const seriesId = seriesOf(base) ?? seriesOf(other);
  if (seriesId !== undefined) out.seriesId = seriesId;

  // Provenance.
  const own: SourceRef = { source: base.source, sourceRef: base.sourceRef };
  const additional: SourceRef[] = [...(base.additionalSources ?? [])];
  for (const s of [{ source: other.source, sourceRef: other.sourceRef }, ...(other.additionalSources ?? [])]) {
    if (sameRef(s, own) || additional.some((a) => sameRef(a, s))) continue;
    additional.push(toRef(s));
  }
  out.additionalSources = additional.length ? additional : undefined;

  if (opts.absorb) {
    const absorbed = [...(base.absorbed ?? [])];
    const row: SourceRef = { source: other.source, sourceRef: other.sourceRef };
    if (!absorbed.some((a) => sameRef(a, row))) {
      const { absorbed: _a, fieldSources: _f, ...snapshot } = other;
      absorbed.push({ ...toRef(row), entry: snapshot as Entry });
    }
    out.absorbed = absorbed.length ? absorbed.slice(-MAX_ABSORBED) : undefined;
    const fieldSources = { ...(base.fieldSources ?? {}), ...filled };
    out.fieldSources = Object.keys(fieldSources).length ? fieldSources : undefined;
  }

  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out as unknown as T;
}

/**
 * mergeEntries for an import (a row from another source, or another row of the same
 * file), reporting whether the entry actually changed so an unchanged re-import stays
 * a no-op.
 */
export function enrichEntry<T extends Entry>(base: T, incoming: Entry): { entry: T; changed: boolean } {
  const entry = mergeEntries(base, incoming, { absorb: true });
  return { entry, changed: stable(entry) !== stable(base) };
}

/**
 * The same source says something new about an entry it already supplied. Source fields
 * come from `incoming`; the user's id, trip, series, overrides, reflection and participants
 * stay, and so do the extra sources, absorbed rows and anything another source filled in
 * that this source does not itself define.
 */
export function refreshFromSource<T extends Entry>(old: Entry, incoming: T): T {
  const inc: Rec = { ...(incoming as unknown as Rec) };
  const prev = old as unknown as Rec;

  // Fields another row filled in survive unless this source now defines them.
  const fieldSources: Record<string, string> = {};
  for (const [field, from] of Object.entries(old.fieldSources ?? {})) {
    if (isEmpty(inc[field])) inc[field] = prev[field];
    else continue; // the source now says it itself: no longer attributed to another row
    fieldSources[field] = from;
  }

  const seriesId = "seriesId" in old ? (old as { seriesId?: string }).seriesId : undefined;
  const merged = mergeEvaluation(
    {
      ...inc,
      id: old.id,
      tripId: old.tripId,
      overrides: old.overrides,
      participants: old.participants ?? incoming.participants,
      additionalSources: old.additionalSources,
      absorbed: old.absorbed,
      fieldSources: Object.keys(fieldSources).length ? fieldSources : undefined,
      ...(seriesId !== undefined ? { seriesId } : {}),
    } as unknown as Entry,
    old,
  ) as unknown as Rec;

  // A rating another row supplied keeps its lock when this source has none of its own.
  if (fieldSources.rating && old.sourceLocked?.includes("rating") && merged.rating === old.rating) {
    merged.sourceLocked = ["rating"];
  }
  for (const k of Object.keys(merged)) if (merged[k] === undefined) delete merged[k];
  return merged as unknown as T;
}
