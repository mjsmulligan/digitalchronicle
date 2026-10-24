/**
 * WP3: gather the files of a Markdown package. Pure apart from the injected image
 * loader, so it is testable here; the mobile app zips the result.
 *
 * Images are loaded one at a time so memory stays bounded. An image that cannot
 * be loaded is reported in `missing` and left out of book.md, so there are never
 * broken links.
 */
import { renderMarkdown, type MarkdownOptions } from "./markdown";
import type { BookModel } from "./types";

export interface PackageFile {
  /** Path inside the package, for example "book.md" or "media/photo-001.jpg". */
  path: string;
  data: string | Uint8Array;
}

export interface MarkdownPackage {
  files: PackageFile[];
  /** Media ids whose image could not be loaded. */
  missing: string[];
}

/** Returns JPEG bytes already resized for the package (WP4), or null if unavailable. */
export type LoadImage = (mediaId: string) => Promise<Uint8Array | null>;

export async function buildMarkdownPackage(
  model: BookModel,
  loadImage: LoadImage,
  opts: Pick<MarkdownOptions, "mediaPath"> = {},
): Promise<MarkdownPackage> {
  const first = renderMarkdown(model, opts);
  const loaded = new Map<string, Uint8Array>();
  const missing: string[] = [];
  for (const m of first.media) {
    let bytes: Uint8Array | null = null;
    try {
      bytes = await loadImage(m.mediaId);
    } catch {
      bytes = null;
    }
    if (bytes && bytes.length > 0) loaded.set(m.mediaId, bytes);
    else missing.push(m.mediaId);
  }

  // Render again without the missing images; numbering then stays contiguous.
  const final = missing.length
    ? renderMarkdown(model, { ...opts, hasMedia: (id) => loaded.has(id) })
    : first;

  const files: PackageFile[] = [{ path: "book.md", data: final.markdown }];
  for (const m of final.media) files.push({ path: m.path, data: loaded.get(m.mediaId)! });
  return { files, missing };
}
