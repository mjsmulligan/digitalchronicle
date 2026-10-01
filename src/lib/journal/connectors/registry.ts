/**
 * Connector registry.
 *
 * To add a new connector:
 *   1. Create a folder (e.g. connectors/myservice/) with index.ts, fixtures/, and a test file.
 *   2. Import the connector here and add it to CONNECTORS.
 *
 * See connectors/README.md for the full checklist.
 */
import { connector as viaduct } from "./viaduct/index";
import { connector as setlistfm } from "./setlistfm/index";
import { connector as letterboxd } from "./letterboxd/index";
import { connector as netflix } from "./netflix/index";
import { connector as generic } from "./generic/index";
import type { Connector } from "./types";

/**
 * All registered file connectors.
 * Detection picks the connector with the highest sniff score above
 * SNIFF_THRESHOLD; order is a tiebreaker only.  Put more-specific connectors
 * before generic as a safeguard when two connectors return equal scores.
 */
export const CONNECTORS: Connector[] = [setlistfm, viaduct, letterboxd, netflix, generic];

/**
 * Formats that are explicitly unsupported — checked before detection so the
 * user gets a clear error message instead of a failed parse.
 *
 * Each entry describes how to recognise the format and what error to surface.
 * Replaces the hard-coded Flightradar24 check that previously lived in stageFile.
 */
export const UNSUPPORTED_FORMATS: Array<{
  name: string;
  detect(header: string): boolean;
  message: string;
}> = [
  {
    name: "Flightradar24",
    detect(header) {
      const cols = new Set(
        header
          .toLowerCase()
          .split(",")
          .map((c) => c.trim()),
      );
      return ["flight number", "dep time", "arr time", "aircraft"].every((f) =>
        cols.has(f),
      );
    },
    message:
      "Flightradar24 exports are not supported. Use a generic flight CSV or add flights manually.",
  },
];

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

const SNIFF_THRESHOLD = 0.5;

/** Return the connector with the given id, or undefined if not registered. */
export function getConnector(id: string): Connector | undefined {
  return CONNECTORS.find((c) => c.id === id);
}

/** Return all registered connectors. */
export function listConnectors(): Connector[] {
  return CONNECTORS;
}

/**
 * Auto-detect the best connector for a file.
 *
 * Each connector with a `sniff` function is scored against the filename and
 * the first 400 characters of the file content (lowercased).  The connector
 * with the highest score above SNIFF_THRESHOLD wins.  If no connector scores
 * above the threshold, the generic connector is returned as the fallback.
 */
export function detectConnector(name: string, text: string): Connector {
  const head = text.slice(0, 400).toLowerCase();
  let best: Connector | null = null;
  let bestScore = SNIFF_THRESHOLD - 0.001;

  for (const c of CONNECTORS) {
    if (!c.sniff) continue;
    const score = c.sniff(name, head);
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }

  return best ?? (CONNECTORS.find((c) => c.id === "generic") as Connector);
}

/** Human-readable label for a connector id. Falls back to the id itself. */
export function sourceLabel(id: string): string {
  if (id === "manual") return "Manual";
  return getConnector(id)?.label ?? id;
}
