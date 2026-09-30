/**
 * @deprecated
 *
 * This file is a thin compatibility re-export.  New code should import
 * directly from the connectors package:
 *
 *   import { connector } from "@/lib/journal/connectors/viaduct";
 *   import { detectConnector, sourceLabel } from "@/lib/journal/connectors/registry";
 *
 * This file exists so that existing imports (AddEntryDialog, tests, etc.)
 * continue to resolve unchanged after the refactor.
 */

import type { ParseResult } from "./connectors/types";
import { connector as viaductConnector } from "./connectors/viaduct/index";
import { connector as setlistConnector } from "./connectors/setlistfm/index";
import { connector as genericConnector } from "./connectors/generic/index";
import { detectConnector, listConnectors } from "./connectors/registry";

// --- shared helpers (still used by AddEntryDialog and the tests) ------------
export { parseCSV, csvRows } from "./connectors/csv";
export { normDate } from "./connectors/dates";
export { legKey, eventKey, stayKey } from "./connectors/keys";
export type { ParseResult } from "./connectors/types";

// --- connector parse functions (sync wrappers for backward compat) ----------
export function parseViaduct(text: string): ParseResult {
  return viaductConnector.parse({ name: "", text }) as ParseResult;
}
export function parseSetlist(text: string): ParseResult {
  return setlistConnector.parse({ name: "", text }) as ParseResult;
}
export function parseGeneric(text: string): ParseResult {
  return genericConnector.parse({ name: "", text }) as ParseResult;
}

/** @deprecated Use detectConnector from connectors/registry.ts */
export function detectSource(filename: string, text: string): string {
  return detectConnector(filename, text).id;
}

/** @deprecated Use getConnector(id).parse from connectors/registry.ts */
export const PARSERS: Record<string, (t: string) => ParseResult> = Object.fromEntries(
  listConnectors().map((c) => [
    c.id,
    (t: string) => c.parse({ name: "", text: t }) as ParseResult,
  ]),
);
