/**
 * Device calendar bridge — reads events from the phone's calendars via
 * expo-calendar and turns them into iCalendar text, so the shared iCalendar
 * connector classifies them (multi-day all-day → Stay, otherwise Event) and
 * the normal staging/review pipeline handles dedup before anything is committed.
 *
 * Read-only and fully on-device: nothing is written back, nothing leaves the phone.
 */
import * as Calendar from "expo-calendar/legacy";

export type DeviceCalendarResult =
  | { status: "ok"; ics: string; count: number }
  | { status: "denied"; canAskAgain: boolean }
  | { status: "unavailable" };

const pad = (n: number) => String(n).padStart(2, "0");
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
const dateOnly = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const localDt = (d: Date) => `${dateOnly(d)}T${pad(d.getHours())}${pad(d.getMinutes())}00`;

export function eventsToIcs(events: Calendar.Event[], tz: string): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Chronicle//Device Calendar//EN"];
  for (const e of events) {
    if (!e.title?.trim()) continue;
    // Recurring series (standups, gym) stay out of the journal, like .ics imports.
    if (e.recurrenceRule) continue;
    const start = new Date(e.startDate);
    const end = new Date(e.endDate);
    lines.push("BEGIN:VEVENT", `UID:device-${e.id}`, `SUMMARY:${esc(e.title.trim())}`);
    if (e.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${dateOnly(start)}`, `DTEND;VALUE=DATE:${dateOnly(end)}`);
    } else {
      lines.push(`DTSTART;TZID=${tz}:${localDt(start)}`, `DTEND;TZID=${tz}:${localDt(end)}`);
    }
    if (e.location?.trim()) lines.push(`LOCATION:${esc(e.location.trim())}`);
    if (e.notes?.trim()) lines.push(`DESCRIPTION:${esc(e.notes.trim())}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

/** Reads all event calendars for a window (default: past year → next 30 days). */
export async function readDeviceCalendar(pastDays = 365, futureDays = 30): Promise<DeviceCalendarResult> {
  if (!(await Calendar.isAvailableAsync())) return { status: "unavailable" };
  const perm = await Calendar.requestCalendarPermissionsAsync();
  if (perm.status !== "granted") return { status: "denied", canAskAgain: perm.canAskAgain };

  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  const ids = calendars.map((c) => c.id);
  if (!ids.length) return { status: "ok", ics: eventsToIcs([], "UTC"), count: 0 };

  const now = Date.now();
  const events = await Calendar.getEventsAsync(
    ids,
    new Date(now - pastDays * 86_400_000),
    new Date(now + futureDays * 86_400_000),
  );
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const kept = events.filter((e) => e.title?.trim() && !e.recurrenceRule);
  return { status: "ok", ics: eventsToIcs(kept, tz), count: kept.length };
}
