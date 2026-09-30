/**
 * Date / time normalisation helper.
 * Moved verbatim from parsers.ts — no behaviour change.
 */

/**
 * Normalise many date/time spellings to local wall-clock "YYYY-MM-DDTHH:mm"
 * (keeps local time, no TZ shift).
 */
export function normDate(date: string, time = ""): string | null {
  let d = date.trim();
  let t = time.trim();
  const both = d.match(/^(.+?)[T ](\d{1,2}:\d{2}(:\d{2})?)/);
  if (both) (d = both[1]), (t = t || both[2]);
  let y: string, m: string, dd: string;
  let mm = d.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (mm) [, y, m, dd] = mm;
  else if ((mm = d.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/)))
    [, dd, m, y] = mm;
  else {
    const p = new Date(d);
    if (isNaN(p.getTime())) return null;
    y = String(p.getFullYear());
    m = String(p.getMonth() + 1);
    dd = String(p.getDate());
  }
  const base = `${y}-${m.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  const tm = t.match(/^(\d{1,2}):(\d{2})/);
  return tm ? `${base}T${tm[1].padStart(2, "0")}:${tm[2]}` : base;
}
