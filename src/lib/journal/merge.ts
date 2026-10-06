import type { Entry } from "./types";

/**
 * Merges two entries into one. `winner` keeps its id and kind-specific fields.
 * All authored data is preserved: reflections concatenated, ratings kept,
 * overrides and participants unioned.
 */
export function mergeEntries<T extends Entry>(winner: T, loser: Entry): T {
  // Reflections: concatenate both if both exist
  const winnerRef = winner.reflection;
  const loserRef  = loser.reflection;
  const reflection =
    winnerRef && loserRef ? `${winnerRef}\n\n---\n\n${loserRef}`
    : winnerRef ?? loserRef;

  // Review: winner's wins; fall back to loser's
  const review = winner.review ?? loser.review;

  // Rating: if winner has no rating (or rating was source-locked and loser has a user rating), use loser's
  const rating = winner.rating ?? loser.rating;

  // Overrides: merge (winner's values win on key collision)
  const overrides =
    winner.overrides || loser.overrides
      ? { ...(loser.overrides ?? {}), ...(winner.overrides ?? {}) }
      : undefined;

  // Participants: union
  const winnerParts = winner.participants ?? [];
  const loserParts  = loser.participants ?? [];
  const participants =
    winnerParts.length || loserParts.length
      ? Array.from(new Set([...winnerParts, ...loserParts]))
      : undefined;

  // Container links: winner wins; loser is fallback
  const tripId   = winner.tripId   ?? loser.tripId;
  const seriesId = (winner as any).seriesId ?? (loser as any).seriesId;

  // Additional sources: collect from loser
  const existingAdditional = winner.additionalSources ?? [];
  const loserSources = [
    { source: loser.source, sourceRef: loser.sourceRef },
    ...(loser.additionalSources ?? []),
  ].filter(
    (ls) => ls.source !== winner.source &&
      !existingAdditional.some((s) => s.source === ls.source),
  );
  const additionalSources = [...existingAdditional, ...loserSources];

  return {
    ...winner,
    reflection,
    review,
    rating,
    overrides,
    participants: participants?.length ? participants : undefined,
    tripId,
    ...(seriesId !== undefined ? { seriesId } : {}),
    additionalSources: additionalSources.length ? additionalSources : undefined,
  };
}
