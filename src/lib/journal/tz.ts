/**
 * Local-time <-> UTC conversion using only the built-in Intl API, so no date library
 * is added to the bundle. Journal entries store local wall-clock time plus an IANA
 * zone (the authoritative values); UTC is derived from those at write time so the
 * data can be sorted and checked for overnight/timezone-crossing gaps.
 */

/** Minutes to ADD to a UTC instant to get local wall-clock time in `tz`, at that instant. */
function offsetMinutes(utcInstant: Date, tz: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(utcInstant).map((p) => [p.type, p.value]));
  // Some locales render midnight as "24"; normalise it.
  const hour = parts.hour === "24" ? 0 : Number(parts.hour);
  const asIfUTC = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), hour, Number(parts.minute), Number(parts.second));
  return (asIfUTC - utcInstant.getTime()) / 60000;
}

/**
 * Converts a local "YYYY-MM-DDTHH:mm" (or "YYYY-MM-DD" with no time) plus an IANA zone
 * to a UTC ISO string. Returns undefined if there's no time component or no known zone,
 * since a date alone doesn't have a meaningful instant.
 *
 * Note: this resolves the UTC offset at the wall-clock instant treated as UTC, then
 * applies it once. That's correct for the vast majority of times; it can be off by the
 * DST shift (typically 1 hour) for times that fall inside the ~1 hour spring-forward
 * gap or fall-back overlap in `tz`, which is rare enough to accept rather than pull in
 * a full tz-database library for.
 */
export function localToUTC(local: string, tz?: string): string | undefined {
  if (!tz || !local.includes("T")) return undefined;
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return undefined;
  const [, y, mo, d, h, mi] = m;
  const naiveUTC = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi)));
  const offset = offsetMinutes(naiveUTC, tz);
  return new Date(naiveUTC.getTime() - offset * 60000).toISOString();
}
