/**
 * Goodreads "read" shelf RSS → Goodreads-export-shaped CSV.
 *
 * Lets devices fetch https://www.goodreads.com/review/list_rss/{id}?shelf=read
 * directly (no server, no key) and reuse the existing goodreads CSV connector
 * unchanged, so dedup keys match file imports exactly.
 * Pure string parsing — no DOMParser, so it runs in React Native too.
 */

const HEADER = [
  "Book Id", "Title", "Author", "My Rating", "Original Publication Year",
  "Date Read", "Date Added", "My Review", "Exclusive Shelf", "ISBN13",
];

/**
 * Accepts a bare username, numeric ID, or any goodreads profile/shelf URL.
 * Returns the identifier to use in the RSS URL (username or numeric ID as-is).
 */
export function parseGoodreadsUserId(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  // Bare username or numeric ID (no slashes) — accept as-is
  if (!/\//.test(s)) return /^[\w-]+$/.test(s) ? s : null;
  // Extract numeric ID from a profile or shelf URL
  const m = s.match(/goodreads\.com\/(?:user\/show|review\/list(?:_rss)?)\/(\d+)/i);
  return m ? m[1] : null;
}

export function goodreadsRssUrl(userId: string, page = 1): string {
  return `https://www.goodreads.com/review/list_rss/${userId}?shelf=read&page=${page}`;
}

function decode(s: string): string {
  return s
    .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&amp;/g, "&")
    .trim();
}

function tag(item: string, name: string): string {
  const m = item.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1]) : "";
}

/** RFC-822 date → YYYY/MM/DD (Goodreads export format), using the stated UTC day. */
function toExportDate(raw: string): string {
  if (!raw) return "";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())}`;
}

function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export interface RssItemRow { bookId: string; cells: string[] }

export function rssItems(xml: string): RssItemRow[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  return items.map((it) => {
    const review = tag(it, "user_review").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "");
    const bookId = tag(it, "book_id");
    return {
      bookId,
      cells: [
        bookId,
        tag(it, "title"),
        tag(it, "author_name"),
        tag(it, "user_rating") || "0",
        tag(it, "book_published"),
        toExportDate(tag(it, "user_read_at")),
        toExportDate(tag(it, "user_date_added")),
        review,
        "read",
        tag(it, "isbn13") || tag(it, "isbn"),
      ],
    };
  });
}

export function rowsToCsv(rows: RssItemRow[]): string {
  return [HEADER, ...rows.map((r) => r.cells)].map((r) => r.map(csvCell).join(",")).join("\n");
}

export function rssToGoodreadsCsv(xml: string): string {
  return rowsToCsv(rssItems(xml));
}

/** Fetch every page of the read shelf (stops when a page adds nothing new). */
export async function fetchGoodreadsShelfCsv(
  userId: string,
  opts: { maxPages?: number; fetchFn?: typeof fetch } = {},
): Promise<{ csv: string; count: number }> {
  const f = opts.fetchFn ?? fetch;
  const seen = new Map<string, RssItemRow>();
  for (let page = 1; page <= (opts.maxPages ?? 20); page++) {
    const res = await f(goodreadsRssUrl(userId, page));
    if (!res.ok) {
      if (page === 1) throw new Error(
        res.status === 404 ? "Goodreads profile not found — check the ID." :
        `Goodreads returned HTTP ${res.status}. Is the profile public?`);
      break;
    }
    const rows = rssItems(await res.text());
    let added = 0;
    for (const r of rows) if (!seen.has(r.bookId)) { seen.set(r.bookId, r); added++; }
    if (!added) break;
  }
  const all = [...seen.values()];
  return { csv: rowsToCsv(all), count: all.length };
}
