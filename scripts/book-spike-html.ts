/**
 * WP0 spike helper: write the spike HTML to disk so it can be rendered by any
 * browser engine (for a baseline against what expo-print produces on a device).
 *
 *   npx vite-node scripts/book-spike-html.ts -- <outDir> <entryCount> <A4|A5> <fontDir> <photoDir> [pageNumbers=1] [chapterBreak=right]
 *
 * fontDir holds Lora and Fraunces .ttf files (from @expo-google-fonts/lora and /fraunces).
 * photoDir holds already-resampled .jpg files. Both are read as binary and inlined.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { buildBookModel } from "../src/lib/journal/book";
import {
  buildSpikeHtml,
  makeSpikeJournal,
  type SpikeFont,
  type SpikePhoto,
} from "../src/lib/journal/book/spike";

const args = process.argv.slice(process.argv.indexOf("--") + 1);
const [
  outDir,
  entryCountArg,
  pageSizeArg,
  fontDir,
  photoDir,
  pageNumbersArg = "1",
  chapterBreakArg = "right",
] = args;
if (!outDir || !entryCountArg || !pageSizeArg || !fontDir || !photoDir) {
  console.error(
    "usage: book-spike-html.ts -- <outDir> <entryCount> <A4|A5> <fontDir> <photoDir> [pageNumbers] [chapterBreak]",
  );
  process.exit(1);
}

const ttf = (name: string) => readFileSync(join(fontDir, name)).toString("base64");
const fonts: SpikeFont[] = [
  { family: "Lora", weight: 400, style: "normal", base64: ttf("Lora_400Regular.ttf") },
  { family: "Lora", weight: 400, style: "italic", base64: ttf("Lora_400Regular_Italic.ttf") },
  { family: "Lora", weight: 700, style: "normal", base64: ttf("Lora_700Bold.ttf") },
  { family: "Fraunces", weight: 600, style: "normal", base64: ttf("Fraunces_600SemiBold.ttf") },
];
const photos: SpikePhoto[] = readdirSync(photoDir)
  .filter((f) => f.endsWith(".jpg"))
  .sort()
  .map((f) => ({
    dataUri: `data:image/jpeg;base64,${readFileSync(join(photoDir, f)).toString("base64")}`,
    width: 1050,
    height: 700,
  }));

const data = makeSpikeJournal({ entryCount: Number(entryCountArg) });
const model = buildBookModel(
  data,
  {
    title: "Spike Journal",
    subtitle: "WP0 test book",
    dedication: "For the family",
    start: "2000-01-01",
    end: "2100-01-01",
    chapterMode: "year",
  },
  { generatedOn: "2026-10-22" },
);
const { html, stats } = buildSpikeHtml({
  model,
  data,
  pageSize: pageSizeArg as "A4" | "A5",
  marginMode: "css",
  pageNumbers: pageNumbersArg === "1",
  chapterBreak: chapterBreakArg === "page" ? "page" : "right",
  fonts,
  photos,
});
mkdirSync(outDir, { recursive: true });
const file = join(outDir, `spike-${pageSizeArg}-${entryCountArg}.html`);
writeFileSync(file, html);
console.log(JSON.stringify({ file, ...stats, htmlMB: +(stats.htmlBytes / 1e6).toFixed(2) }));
