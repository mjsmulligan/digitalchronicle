import type { Entry, Tier } from "../types";

/**
 * The result returned by every connector's parse() function.
 * Mirrors the shape previously defined in parsers.ts.
 */
export interface ParseResult {
  entries: { entry: Entry; warnings: string[]; sourceRow: number }[];
  errors: string[];
}

/**
 * A Connector describes a single import source.
 *
 * - id        Stable, lowercase slug stored in IndexedDB as `entry.source`.
 * - label     Human-readable name shown in the UI.
 * - kind      "file" connectors accept uploaded/dropped files.
 *             "api" connectors are reserved for future direct-pull integrations.
 * - tier      Default precedence tier for entries produced by this connector.
 * - accepts   File-extension hints for the drop-zone / file-input (file connectors only).
 * - sniff     Optional detector. Returns a score in [0, 1]; higher = better match.
 *             Receives the filename and the lowercased first 400 chars of content.
 *             Omit for connectors that should only be selected manually.
 * - parse     Synchronous or async parse of a file's text.
 *
 * API connectors may add a sync() method in a future iteration; the slot is
 * intentionally left open in the kind union above.
 */
export interface Connector {
  id: string;
  label: string;
  kind: "file" | "api";
  tier: Tier;
  accepts?: string[];
  sniff?(name: string, head: string): number;
  parse(input: { name: string; text: string }): ParseResult | Promise<ParseResult>;
}
