/**
 * Goodreads connected source.
 *
 * On each startup check: builds a set of Goodreads book IDs already in the
 * journal, passes that to fetchGoodreadsShelfCsv so paging stops early when
 * nothing is new, and only calls importFile when there are new books.
 */
import { importFile } from "@chronicle/journal/import";
import { getState } from "@chronicle/journal/db";
import {
  fetchGoodreadsShelfCsv,
} from "@chronicle/journal/connectors/goodreads/rss";
import { getGoodreadsUserId } from "./goodreadsPrefs";
import type { SourceDef } from "./connectedSources";

export function makeGoodreadsSource(): SourceDef {
  return {
    id: "goodreads",

    async isConnected() {
      return (await getGoodreadsUserId()) !== null;
    },

    async check() {
      const userId = await getGoodreadsUserId();
      if (!userId) return;

      // Build the set of book IDs already in the journal for early-stop paging
      const journal = getState();
      const knownIds = new Set(
        journal.books
          .map((b) => b.goodreadsId)
          .filter((id): id is string => typeof id === "string" && id.length > 0)
      );

      const { csv, count } = await fetchGoodreadsShelfCsv(userId, { knownIds });
      if (!count) return; // nothing new in the journal

      await importFile(`goodreads-${userId}.csv`, csv, {
        forced: "goodreads",
        trigger: "startup",
      });
    },
  };
}
