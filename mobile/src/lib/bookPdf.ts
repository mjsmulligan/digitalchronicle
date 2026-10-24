/**
 * WP5: render a BookModel to a PDF with expo-print and save it under books/.
 *
 * margins: Android and the iOS WebView honour CSS @page margins inconsistently,
 * so iOS gets native margins and Android uses @page (see the WP0 note).
 */
import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Print from "expo-print";
import {
  MARGIN_BOTTOM_PT,
  MARGIN_TOP_PT,
  MARGIN_X_PT,
  PAGE_PX,
  renderBookHtml,
  type BookModel,
  type BookPhoto,
  type PageSize,
} from "@chronicle/journal/book";
import { loadBookFonts } from "./bookFonts";

export interface BookPdfResult {
  uri: string;
  sizeBytes: number;
  numberOfPages: number;
  htmlBytes: number;
  photosPlaced: number;
  timingsMs: { fonts: number; html: number; print: number };
}

export async function writeBookPdf(
  model: BookModel,
  opts: {
    pageSize: PageSize;
    fileName: string;
    /** Photos already resampled (WP4). Absent until the media vault exists. */
    photo?: (mediaId: string) => BookPhoto | null;
  },
): Promise<BookPdfResult> {
  const native = Platform.OS === "ios";
  let t = Date.now();
  const fonts = await loadBookFonts();
  const fontsMs = Date.now() - t;

  t = Date.now();
  const { html, stats } = renderBookHtml(model, {
    pageSize: opts.pageSize,
    marginMode: native ? "native" : "css",
    pageNumbers: true,
    chapterBreak: "right",
    fonts,
    photo: opts.photo,
  });
  const htmlMs = Date.now() - t;

  t = Date.now();
  const { width, height } = PAGE_PX[opts.pageSize];
  const printed = await Print.printToFileAsync({
    html,
    width,
    height,
    ...(native
      ? {
          margins: {
            top: MARGIN_TOP_PT,
            right: MARGIN_X_PT,
            bottom: MARGIN_BOTTOM_PT,
            left: MARGIN_X_PT,
          },
        }
      : {}),
  });
  const printMs = Date.now() - t;

  const dir = `${FileSystem.documentDirectory}books/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  const uri = `${dir}${opts.fileName}`;
  await FileSystem.deleteAsync(uri, { idempotent: true });
  await FileSystem.moveAsync({ from: printed.uri, to: uri });
  const info = await FileSystem.getInfoAsync(uri);

  return {
    uri,
    sizeBytes: info.exists && "size" in info ? info.size : 0,
    numberOfPages: printed.numberOfPages,
    htmlBytes: stats.htmlBytes,
    photosPlaced: stats.photosPlaced,
    timingsMs: { fonts: fontsMs, html: htmlMs, print: printMs },
  };
}
