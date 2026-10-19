/**
 * Build the offline airport lookup from OurAirports (public domain) airports.csv.
 *
 *   npm install --no-save tz-lookup
 *   node scripts/build-airport-gazetteer.mjs <airports.csv> src/lib/journal/airports.generated.json
 *
 * Output: { "DUB": ["Dublin Airport", "Dublin", "IE", 53.4287, -6.2621, "Europe/Dublin", 3], ... }
 * The last element is a size rank (3 large, 2 medium, 1 small) used to break ties between
 * airports in the same city.
 * Only airports with an IATA code and scheduled-service-capable types are kept.
 * Nothing is looked up at runtime; the file is bundled like stations.generated.json.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const tzlookup = require("tz-lookup");

const [source, destination] = process.argv.slice(2);
if (!source || !destination) {
  console.error("usage: build-airport-gazetteer.mjs <airports.csv> <out.json>");
  process.exit(1);
}

/** Minimal RFC 4180 parser (quoted fields, doubled quotes, newlines in quotes). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const [header, ...rows] = parseCsv(readFileSync(source, "utf8").replace(/^﻿/, ""));
const col = Object.fromEntries(header.map((h, i) => [h, i]));
const KEEP_TYPES = new Set(["large_airport", "medium_airport", "small_airport"]);

const out = {};
// Prefer the larger airport when two records share an IATA code.
const rank = { large_airport: 3, medium_airport: 2, small_airport: 1 };
const best = {};
for (const r of rows) {
  const iata = (r[col.iata_code] ?? "").trim().toUpperCase();
  const type = r[col.type];
  if (!/^[A-Z]{3}$/.test(iata) || !KEEP_TYPES.has(type)) continue;
  if (best[iata] && rank[best[iata]] >= rank[type]) continue;
  const lat = Number(r[col.latitude_deg]);
  const lon = Number(r[col.longitude_deg]);
  let tz;
  try { tz = tzlookup(lat, lon); } catch { continue; }
  best[iata] = type;
  out[iata] = [
    r[col.name].trim(),
    (r[col.municipality] ?? "").trim(),
    r[col.iso_country],
    Math.round(lat * 1e4) / 1e4,
    Math.round(lon * 1e4) / 1e4,
    tz,
    rank[type],
  ];
}

const sorted = Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(destination, JSON.stringify(sorted));
console.log(`${Object.keys(sorted).length} airports -> ${destination}`);
