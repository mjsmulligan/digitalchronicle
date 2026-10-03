#!/usr/bin/env node
/**
 * populate-operator-icons.mjs
 *
 * Replaces TextMarkDef entries in src/lib/journal/connectors/icons.ts with
 * real PathMarkDef data sourced from the `simple-icons` package (CC0 license).
 *
 * Run once locally (where npm is not behind a blocking proxy):
 *
 *   cd ~/Documents/Claude/RN\ Learning/digitalchronicle
 *   npm install --save-dev simple-icons   # only needed once
 *   node scripts/populate-operator-icons.mjs
 *
 * The script patches icons.ts in-place, replacing every `type: "text"` entry
 * for which it can find a Simple Icons match with `type: "path"`.
 * Unknown slugs are left as TextMark so nothing breaks.
 *
 * After running, commit the result:
 *   git add src/lib/journal/connectors/icons.ts
 *   git commit -m "chore: populate operator icons from simple-icons"
 */

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ICONS_PATH = resolve(__dirname, "../src/lib/journal/connectors/icons.ts");

// ── Mapping: SOURCE_MARKS key → Simple Icons title (not slug) ───────────────
// Simple Icons uses the exact brand title as the lookup key, e.g.
//   import { siRyanair } from 'simple-icons'  (camelCase with "si" prefix)
// The mapping below uses the camelCase property name AFTER the "si" prefix.
// See https://simpleicons.org for titles.

const SLUG_MAP = {
  // Airlines
  "ryanair":               "Ryanair",
  "aer-lingus":            "Aer Lingus",
  "british-airways":       "British Airways",
  "lufthansa":             "Lufthansa",
  "air-france":            "Air France",
  "klm":                   "KLM",
  "easyjet":               "easyJet",
  "wizz-air":              "Wizz Air",
  "turkish-airlines":      "Turkish Airlines",
  "emirates":              "Emirates",
  "norwegian":             "Norwegian",
  "iberia":                "Iberia",
  "vueling":               "Vueling",
  "tap-air-portugal":      "TAP Air Portugal",
  "finnair":               "Finnair",
  "swiss-international":   "Swiss International Air Lines",
  "austrian-airlines":     "Austrian Airlines",
  "brussels-airlines":     "Brussels Airlines",
  "united-airlines":       "United Airlines",
  "american-airlines":     "American Airlines",
  "delta-air-lines":       "Delta Air Lines",
  "qantas":                "Qantas",
  "singapore-airlines":    "Singapore Airlines",
  "cathay-pacific":        "Cathay Pacific",
  "air-asia":              "AirAsia",

  // Train operators
  "trenitalia":            "Trenitalia",
  "db-fernverkehr":        "Deutsche Bahn",
  "renfe":                 "Renfe",
  "sncf":                  "SNCF",
  "eurostar":              "Eurostar",
  "obb":                   "ÖBB",
  "ns":                    "NS",
  "sbb":                   "SBB CFF FFS",
  "amtrak":                "Amtrak",
  "italo-treno":           "Italo",
  // china-railway, thalys, avlo not yet in Simple Icons — left as TextMark
};

// ── Load simple-icons ────────────────────────────────────────────────────────

let si;
try {
  si = await import("simple-icons");
} catch {
  console.error(
    "\n❌  Could not import 'simple-icons'.\n" +
    "   Run:  npm install --save-dev simple-icons\n" +
    "   then re-run this script.\n"
  );
  process.exit(1);
}

// simple-icons v9+: named exports like siRyanair, siLufthansa, …
// simple-icons v8 and below: default export with icons object.
// Try both shapes.
function findIcon(title) {
  // v9+ named export: convert title to camelCase "si" key
  const camel = "si" + title.replace(/[^a-zA-Z0-9]/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join("");
  if (si[camel]) return si[camel];

  // v9+ icons Map
  if (si.icons) {
    for (const icon of si.icons) {
      if (icon.title === title) return icon;
    }
  }

  // v8 default export
  if (si.default) {
    const slug = title.toLowerCase().replace(/[^a-z0-9]/g, "");
    return si.default[slug];
  }

  return undefined;
}

// ── Patch icons.ts ───────────────────────────────────────────────────────────

let source = readFileSync(ICONS_PATH, "utf-8");
let patched = 0;
let skipped = 0;

for (const [key, title] of Object.entries(SLUG_MAP)) {
  const icon = findIcon(title);
  if (!icon) {
    console.warn(`  ⚠️  '${title}' not found in simple-icons — keeping TextMark for '${key}'`);
    skipped++;
    continue;
  }

  const hex = "#" + icon.hex.toUpperCase();
  const path = icon.path.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

  // Match the TextMark line: "key": { type: "text", label: "XX", bg: "#XXXXXX", fg: "#XXXXXX" },
  // and replace with a PathMark.
  const textMarkRe = new RegExp(
    `("${key}":\\s*\\{\\s*type:\\s*"text"[^}]+\\})`,
    "g"
  );

  const replacement = `"${key}": { type: "path", d: '${path}', color: "${hex}" }`;
  const newSource = source.replace(textMarkRe, replacement);

  if (newSource !== source) {
    source = newSource;
    console.log(`  ✅  ${key} → ${title} (${hex})`);
    patched++;
  } else {
    console.warn(`  ⚠️  Pattern not found in icons.ts for key '${key}' — skipping`);
    skipped++;
  }
}

writeFileSync(ICONS_PATH, source, "utf-8");

console.log(`\nDone. ${patched} icons patched, ${skipped} skipped.`);
console.log(`File written: ${ICONS_PATH}`);
console.log("\nNext steps:");
console.log("  git add src/lib/journal/connectors/icons.ts");
console.log("  git commit -m 'chore: populate operator icons from simple-icons'");
console.log("  npm run test   # verify nothing broke");
