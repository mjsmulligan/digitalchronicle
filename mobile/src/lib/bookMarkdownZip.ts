/**
 * WP3: zip the Markdown package and save it to the document directory.
 * Images are already JPEG, so they are stored rather than deflated.
 */
import * as FileSystem from "expo-file-system/legacy";
import { zipSync, strToU8, type Zippable } from "fflate";
import { buildMarkdownPackage, type BookModel, type LoadImage } from "@chronicle/journal/book";

export interface MarkdownZipResult {
  uri: string;
  sizeBytes: number;
  imageCount: number;
  /** Media ids whose image could not be loaded and so are not in the book. */
  missing: string[];
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export async function writeMarkdownZip(
  model: BookModel,
  loadImage: LoadImage,
  fileName: string,
): Promise<MarkdownZipResult> {
  const pkg = await buildMarkdownPackage(model, loadImage);
  const zippable: Zippable = {};
  for (const f of pkg.files) {
    zippable[f.path] = typeof f.data === "string" ? strToU8(f.data) : [f.data, { level: 0 }];
  }
  const zipped = zipSync(zippable);
  const dir = `${FileSystem.documentDirectory}books/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  const uri = `${dir}${fileName}`;
  await FileSystem.writeAsStringAsync(uri, toBase64(zipped), {
    encoding: FileSystem.EncodingType.Base64,
  });
  return {
    uri,
    sizeBytes: zipped.length,
    imageCount: pkg.files.length - 1,
    missing: pkg.missing,
  };
}
