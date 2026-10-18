/**
 * Device calendar connected source.
 *
 * Uses a silent permission check so it never prompts on startup.
 * If permission is denied the function throws so connectedSources stores the
 * message as lastError (shown on the source card) without any dialog.
 *
 * Imports only events that have already ended, using an incremental window:
 *   start = max(1 year ago, lastCheckedAt - 7 days)
 *   end   = now
 * The 7-day overlap ensures events created or modified between launches are
 * picked up even when their start date predates the last check.
 */
import * as Calendar from "expo-calendar/legacy";
import { importFile } from "@chronicle/journal/import";
import { eventsToIcs } from "./deviceCalendar";
import { getCalendarPrefs } from "./calendarPrefs";
import { makeSyncPrefsStorage } from "./syncPrefsStorage";
import type { SourceDef } from "./connectedSources";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const ONE_YEAR_MS   = 365 * 24 * 60 * 60 * 1000;

export function makeCalendarSource(): SourceDef {
  return {
    id: "icalendar",

    async isConnected() {
      return (await getCalendarPrefs()).connected;
    },

    async check() {
      if (!(await Calendar.isAvailableAsync())) return;

      // Silent check: no permission prompt
      const perm = await Calendar.getCalendarPermissionsAsync();
      if (perm.status !== "granted") {
        throw new Error("Permission needed");
      }

      const prefs = await getCalendarPrefs();
      if (!prefs.connected || !prefs.calendarIds.length) return;

      // Incremental window
      const storage = makeSyncPrefsStorage();
      const lastCheckedStr = await storage.get("lastCheckedAt_icalendar");
      const now = Date.now();
      const windowStart = lastCheckedStr
        ? new Date(lastCheckedStr).getTime() - SEVEN_DAYS_MS
        : now - ONE_YEAR_MS;

      const events = await Calendar.getEventsAsync(
        prefs.calendarIds,
        new Date(windowStart),
        new Date(now),
      );

      // Ended events only: endDate has already passed, non-recurring, has a title
      const ended = events.filter(
        (e) =>
          e.title?.trim() &&
          !e.recurrenceRule &&
          new Date(e.endDate).getTime() <= now
      );

      if (!ended.length) return;

      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      const ics = eventsToIcs(ended, tz);

      await importFile("device-calendar.ics", ics, {
        forced: "icalendar",
        trigger: "startup",
      });
    },
  };
}
