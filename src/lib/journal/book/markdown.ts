/**
 * WP3 of docs/specs/book-export.md: BookModel to Markdown.
 *
 * Pure and deterministic. Produces one `book.md` and the list of images it
 * references; the caller decides how to fetch, resize and zip them (WP4, mobile).
 *
 * Plain Markdown only, no HTML. Heading levels: `#` book, `##` chapter,
 * `###` trip, `####` entry. Icons become text labels. Source reviews are
 * blockquotes with attribution; reflections are italic paragraphs.
 */
import { formatDay } from "./blocks";
import { dateLineText } from "./dateLine";
import type { Block, BookModel } from "./types";

export interface MarkdownMedia {
  mediaId: string;
  /** Path relative to book.md, for example "media/photo-001.jpg". */
  path: string;
}

export interface MarkdownResult {
  markdown: string;
  /** Every image the markdown references, once each, in order of first use. */
  media: MarkdownMedia[];
}

export interface MarkdownOptions {
  /**
   * Maps the nth distinct media id (1-based) to a relative path.
   * Defaults to `media/photo-001.jpg`, `media/photo-002.jpg` and so on.
   */
  mediaPath?: (mediaId: string, n: number) => string;
  /**
   * Return false for images that cannot be provided. Their photo blocks are left
   * out (and a missing cover is dropped) so the file never has broken links.
   */
  hasMedia?: (mediaId: string) => boolean;
}

const ICON_LABELS: Record<string, string> = {
  plane: "Flight",
  train: "Train",
  car: "Car",
  leg: "Journey",
  hotel: "Stay",
};

function iconLabel(icon: string): string {
  return ICON_LABELS[icon] ?? icon.charAt(0).toUpperCase() + icon.slice(1);
}

/** Escape characters that would be read as Markdown or HTML inside running text. */
export function escapeInline(text: string): string {
  return text.replace(/[\\`*_[\]<>|~]/g, "\\$&");
}

/** As escapeInline, plus markers that matter only at the start of a line. */
function escapeLine(line: string): string {
  const e = escapeInline(line);
  return e
    .replace(/^(\s*)([#>+-])/, "$1\\$2")
    .replace(/^(\s*\d+)([.)])(\s)/, "$1\\$2$3")
    .replace(/^(\s*)(={2,}|-{2,})\s*$/, "$1\\$2");
}

function lines(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

function cell(text: string): string {
  const c = escapeInline(text.replace(/\s*\n\s*/g, " ").trim());
  return c === "" ? " " : c;
}

export function renderMarkdown(model: BookModel, opts: MarkdownOptions = {}): MarkdownResult {
  const media: MarkdownMedia[] = [];
  const pathById = new Map<string, string>();
  const mediaPath =
    opts.mediaPath ?? ((_id: string, n: number) => `media/photo-${String(n).padStart(3, "0")}.jpg`);

  const available = (mediaId: string) => opts.hasMedia?.(mediaId) ?? true;

  const use = (mediaId: string): string => {
    let p = pathById.get(mediaId);
    if (!p) {
      p = mediaPath(mediaId, pathById.size + 1);
      pathById.set(mediaId, p);
      media.push({ mediaId, path: p });
    }
    return p;
  };

  const out: string[] = [];
  const para = (text: string) => out.push(text);

  // Front matter.
  const { meta } = model;
  para(`# ${escapeLine(meta.title)}`);
  if (meta.subtitle) para(`*${escapeInline(meta.subtitle.trim())}*`);
  para(`${formatDay(meta.dateRange.start)} to ${formatDay(meta.dateRange.end)}`);
  if (meta.coverMediaId && available(meta.coverMediaId))
    para(`![Cover](${use(meta.coverMediaId)})`);
  if (meta.dedication) {
    para(
      lines(meta.dedication)
        .map((l) => `*${escapeInline(l)}*`)
        .join("  \n"),
    );
  }
  const colophon = [
    meta.sources.length
      ? `Compiled by Chronicle from: ${meta.sources.map(escapeInline).join(", ")}.`
      : "Compiled by Chronicle.",
    `Generated ${formatDay(meta.generatedOn)}.`,
  ];
  para(colophon.join(" "));

  const renderBlock = (b: Block) => {
    switch (b.type) {
      case "heading": {
        const level = Math.max(b.level, 3);
        para(`${"#".repeat(level)} ${escapeLine(b.text.trim())}`);
        return;
      }
      case "dateLine": {
        const t = dateLineText(b);
        if (t) para(`**${escapeInline(t)}**`);
        return;
      }
      case "paragraph": {
        const ls = lines(b.text);
        if (!ls.length) return;
        para(ls.map((l) => (b.italic ? `*${escapeInline(l)}*` : escapeLine(l))).join("  \n"));
        return;
      }
      case "quote": {
        const ls = lines(b.text).map((l) => `> ${escapeInline(l)}`);
        if (!ls.length) return;
        if (b.attribution) ls.push(">", `> Source: ${escapeInline(b.attribution)}`);
        para(ls.join("\n"));
        return;
      }
      case "table": {
        if (!b.columns.length) return;
        const withIcons = b.rows.some((r) => r.icon);
        const cols = withIcons ? ["Type", ...b.columns] : b.columns;
        const row = (cells: string[]) => `| ${cells.map(cell).join(" | ")} |`;
        if (b.caption) para(`**${escapeInline(b.caption)}**`);
        para(
          [
            row(cols),
            `| ${cols.map(() => "---").join(" | ")} |`,
            ...b.rows.map((r) => {
              const cells = r.cells.slice(0, b.columns.length);
              while (cells.length < b.columns.length) cells.push("");
              return row(withIcons ? [r.icon ? iconLabel(r.icon) : "", ...cells] : cells);
            }),
          ].join("\n"),
        );
        return;
      }
      case "photo": {
        if (!available(b.mediaId)) return;
        const alt = (b.caption?.trim() || "Photo").replace(/\s+/g, " ").replace(/[\\[\]]/g, "\\$&");
        para(`![${alt}](${use(b.mediaId)})`);
        return;
      }
    }
  };

  for (const chapter of model.chapters) {
    para(`## ${escapeLine(chapter.title)}`);
    for (const section of chapter.sections) for (const b of section.blocks) renderBlock(b);
  }

  return { markdown: `${out.join("\n\n")}\n`, media };
}
