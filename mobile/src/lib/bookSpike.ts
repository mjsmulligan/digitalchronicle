/**
 * WP0 spike runner (docs/specs/book-export.md): builds a realistic book with real
 * photos and prints it to PDF with expo-print, timing each phase.
 *
 * Throwaway. It answers "is expo-print good enough?" on a real device. The result
 * is a plain object the spike screen shows and the user can share back.
 */
import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as ImageManipulator from "expo-image-manipulator";
import * as MediaLibrary from "expo-media-library/legacy";
import * as Print from "expo-print";
import { loadBookFonts } from "./bookFonts";
import { buildBookModel } from "@chronicle/journal/book";
import {
  PAGE_PX,
  buildSpikeHtml,
  makeSpikeJournal,
  photoTargetWidthPx,
  type SpikeFont,
  type SpikePhoto,
} from "@chronicle/journal/book/spike";

export interface SpikeConfig {
  entryCount: number;
  pageSize: "A4" | "A5";
  /** "css": margins from @page. "native": margins passed to expo-print (iOS only). */
  marginMode: "css" | "native";
  pageNumbers: boolean;
  chapterBreak: "right" | "page";
  /** Photos to pull from the library and place in the book. */
  photoCount: number;
}

export const DEFAULT_CONFIG: SpikeConfig = {
  entryCount: 800,
  pageSize: "A4",
  marginMode: "css",
  pageNumbers: true,
  chapterBreak: "right",
  photoCount: 30,
};

export interface SpikeResult {
  ok: boolean;
  error?: string;
  platform: string;
  osVersion: string | number;
  config: SpikeConfig;
  /** Milliseconds per phase. */
  ms: Record<string, number>;
  photos: { requested: number; used: number; totalKB: number; targetWidthPx: number };
  htmlMB?: number;
  pdf?: {
    uri: string;
    sizeMB: number;
    /** Reported by expo-print. */
    numberOfPages: number;
    /** Counted in the PDF file; null when the file uses compressed page objects. */
    pagesInFile: number | null;
    mediaBoxPt: number[] | null;
    expectedPt: [number, number];
    fontNames: string[];
    fontFileObjects: number;
  };
  notes: string[];
}

const now = () => Date.now();

/** Most recent library photos, resampled one at a time to bound memory. */
async function loadPhotos(
  count: number,
  targetWidth: number,
  notes: string[],
): Promise<{ photos: SpikePhoto[]; totalKB: number }> {
  const perm = await MediaLibrary.requestPermissionsAsync();
  if (!perm.granted) {
    notes.push("Photo permission not granted: the book was built without photos.");
    return { photos: [], totalKB: 0 };
  }
  const page = await MediaLibrary.getAssetsAsync({
    first: count,
    mediaType: MediaLibrary.MediaType.photo,
    sortBy: [[MediaLibrary.SortBy.creationTime, false]],
  });
  const photos: SpikePhoto[] = [];
  let totalChars = 0;
  for (const asset of page.assets) {
    try {
      const info = await MediaLibrary.getAssetInfoAsync(asset);
      const source = info.localUri ?? asset.uri;
      const out = await ImageManipulator.manipulateAsync(source, [{ resize: { width: targetWidth } }], {
        compress: 0.8,
        format: ImageManipulator.SaveFormat.JPEG,
        base64: true,
      });
      if (!out.base64) continue;
      totalChars += out.base64.length;
      photos.push({ dataUri: `data:image/jpeg;base64,${out.base64}`, width: out.width, height: out.height });
    } catch (e) {
      notes.push(`Skipped one photo: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (photos.length < count) notes.push(`Only ${photos.length} of ${count} photos were usable.`);
  return { photos, totalKB: Math.round((totalChars * 0.75) / 1024) };
}

/** Best-effort facts read straight from the PDF bytes. */
function inspectPdf(text: string) {
  const media = /\/MediaBox\s*\[\s*([\d.\s-]+?)\s*\]/.exec(text);
  const mediaBoxPt = media ? media[1].trim().split(/\s+/).map(Number) : null;
  const pageObjects = text.match(/\/Type\s*\/Page(?![\w])/g);
  const fontNames = [...new Set([...text.matchAll(/\/BaseFont\s*\/([A-Za-z0-9+_,-]+)/g)].map((m) => m[1]))];
  const fontFileObjects = (text.match(/\/FontFile[23]?\b/g) ?? []).length;
  return { mediaBoxPt, pagesInFile: pageObjects ? pageObjects.length : null, fontNames, fontFileObjects };
}

export async function runSpike(config: SpikeConfig): Promise<SpikeResult> {
  const notes: string[] = [];
  const ms: Record<string, number> = {};
  const target = photoTargetWidthPx(config.pageSize);
  const result: SpikeResult = {
    ok: false,
    platform: Platform.OS,
    osVersion: Platform.Version,
    config,
    ms,
    photos: { requested: config.photoCount, used: 0, totalKB: 0, targetWidthPx: target },
    notes,
  };
  try {
    let t = now();
    const fonts = await loadBookFonts();
    ms.fonts = now() - t;

    t = now();
    const { photos, totalKB } = await loadPhotos(config.photoCount, target, notes);
    ms.photos = now() - t;
    result.photos.used = photos.length;
    result.photos.totalKB = totalKB;

    t = now();
    const data = makeSpikeJournal({ entryCount: config.entryCount });
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
    ms.model = now() - t;

    t = now();
    const native = config.marginMode === "native";
    const { html } = buildSpikeHtml({
      model,
      data,
      pageSize: config.pageSize,
      marginMode: config.marginMode,
      pageNumbers: config.pageNumbers,
      chapterBreak: config.chapterBreak,
      fonts,
      photos,
    });
    ms.html = now() - t;
    result.htmlMB = +(html.length / 1e6).toFixed(2);

    const { width, height } = PAGE_PX[config.pageSize];
    t = now();
    const printed = await Print.printToFileAsync({
      html,
      width,
      height,
      ...(native ? { margins: { top: 51, right: 45, bottom: 57, left: 45 } } : {}),
    });
    ms.print = now() - t;
    if (native && Platform.OS !== "ios") notes.push("Native margins are iOS only, so this run had no margins.");

    t = now();
    const info = await FileSystem.getInfoAsync(printed.uri);
    const sizeMB = info.exists && "size" in info ? +(info.size / 1e6).toFixed(2) : 0;
    let inspected: ReturnType<typeof inspectPdf> = { mediaBoxPt: null, pagesInFile: null, fontNames: [], fontFileObjects: 0 };
    try {
      // Binary read as text: ASCII tokens survive, which is all inspectPdf needs.
      inspected = inspectPdf(await FileSystem.readAsStringAsync(printed.uri, { encoding: FileSystem.EncodingType.UTF8 }));
    } catch (e) {
      notes.push(`Could not inspect the PDF bytes: ${e instanceof Error ? e.message : String(e)}`);
    }
    ms.inspect = now() - t;

    result.pdf = {
      uri: printed.uri,
      sizeMB,
      numberOfPages: printed.numberOfPages,
      expectedPt: [width, height],
      ...inspected,
    };
    result.ok = true;
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
  }
  return result;
}
