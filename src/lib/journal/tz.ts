/** Local wall-clock time and IANA zone are authoritative; UTC is derived when unambiguous. */

/** Minutes to ADD to a UTC instant to get local wall-clock time in `tz`, at that instant. */
function offsetMinutes(utcInstant: Date, fmt: Intl.DateTimeFormat): number {
  const parts = Object.fromEntries(fmt.formatToParts(utcInstant).map((p) => [p.type, p.value]));
  const hour = parts.hour === "24" ? 0 : Number(parts.hour);
  const asIfUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    hour,
    Number(parts.minute),
    Number(parts.second),
  );
  return (asIfUTC - utcInstant.getTime()) / 60000;
}

function formatter(tz: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * Converts a local "YYYY-MM-DDTHH:mm" (or "YYYY-MM-DD" with no time) plus an IANA zone
 * to a UTC ISO string. Returns undefined if there's no time component or no known zone,
 * since a date alone doesn't have a meaningful instant. Also returns undefined for
 * nonexistent or ambiguous local times at timezone transitions instead of guessing.
 */
export function localToUTC(local: string, tz?: string): string | undefined {
  if (!tz) return undefined;
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return undefined;
  const [, y, mo, d, h, mi] = m;
  const wall = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
  const date = new Date(wall);
  if (
    date.getUTCFullYear() !== Number(y) ||
    date.getUTCMonth() + 1 !== Number(mo) ||
    date.getUTCDate() !== Number(d) ||
    date.getUTCHours() !== Number(h) ||
    date.getUTCMinutes() !== Number(mi)
  )
    return undefined;

  const fmt = formatter(tz);
  const offsets = new Set(
    [-36, 0, 36].map((hours) => offsetMinutes(new Date(wall + hours * 3600000), fmt)),
  );
  const matches = [...offsets]
    .map((offset) => new Date(wall - offset * 60000))
    .filter((instant) => {
      const parts = Object.fromEntries(fmt.formatToParts(instant).map((p) => [p.type, p.value]));
      return (
        Number(parts.year) === Number(y) &&
        Number(parts.month) === Number(mo) &&
        Number(parts.day) === Number(d) &&
        Number(parts.hour) % 24 === Number(h) &&
        Number(parts.minute) === Number(mi)
      );
    });
  return matches.length === 1 ? matches[0].toISOString() : undefined;
}
