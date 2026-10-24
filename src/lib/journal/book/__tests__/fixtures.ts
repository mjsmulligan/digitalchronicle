/**
 * Shared fixture for the book tests: entries parsed by the real importers, wired
 * into two trips, plus people. Built fresh per call because entries carry random ids.
 */
import { connector as viaduct } from "../../connectors/viaduct";
import { connector as setlistfm } from "../../connectors/setlistfm";
import { connector as goodreads } from "../../connectors/goodreads";
import { connector as icalendar } from "../../connectors/icalendar";
import viaductCsv from "../../connectors/viaduct/fixtures/sample.csv?raw";
import setlistJson from "../../connectors/setlistfm/fixtures/sample.json?raw";
import goodreadsCsv from "../../connectors/goodreads/fixtures/goodreads_library_export.csv?raw";
import icsText from "../../connectors/icalendar/fixtures/sample.ics?raw";
import {
  emptyJournalData,
  type Book,
  type Entry,
  type JEvent,
  type JournalData,
  type Leg,
  type Person,
  type Stay,
  type Trip,
} from "../../types";

export const SELF: Person = {
  id: "p-self",
  name: "Mike",
  isSelf: true,
  createdAt: "2026-01-01T00:00:00Z",
};
export const FRIEND: Person = { id: "p-friend", name: "Sarah", createdAt: "2026-01-01T00:00:00Z" };

export const TRIP_EUROPE: Trip = {
  id: "trip-europe",
  title: "Berlin and Hamburg",
  start: "2026-05-15",
  end: "2026-05-20",
  cover: "",
  createdAt: "2026-01-01T00:00:00Z",
};
export const TRIP_JAPAN: Trip = {
  id: "trip-japan",
  title: "Japan",
  start: "2026-08-06",
  end: "2026-08-09",
  cover: "",
  createdAt: "2026-01-01T00:00:00Z",
};

export interface Fixture {
  data: JournalData;
  /** Named entries. Keys are stable even though ids are random. */
  e: {
    fontaines: JEvent;
    hotel: Stay;
    birthday: JEvent;
    drinks: JEvent;
    caribou: JEvent;
    kraftwerk: JEvent;
    japanConcert: JEvent;
    legMay17: Leg;
    legMay19: Leg;
    legAug6: Leg;
    legAug9: Leg;
    book2010: Book;
    bookMay15: Book;
    bookJun22: Book;
    bookAug6: Book;
    bookSep9: Book;
  };
}

async function parse(
  c: { parse(i: { name: string; text: string }): unknown },
  name: string,
  text: string,
): Promise<Entry[]> {
  // The iCalendar fixture reports one "recurring event skipped" message in `errors`
  // by design, so parse messages are not treated as failures here.
  const r = (await c.parse({ name, text })) as { entries: { entry: Entry }[] };
  return r.entries.map((x) => x.entry);
}

export async function makeFixture(): Promise<Fixture> {
  const legs = (await parse(viaduct, "v.csv", viaductCsv)) as Leg[];
  const setlists = (await parse(setlistfm, "s.json", setlistJson)) as JEvent[];
  const books = (await parse(goodreads, "g.csv", goodreadsCsv)) as Book[];
  const cal = await parse(icalendar, "c.ics", icsText);
  const calEvents = cal.filter((x): x is JEvent => x.kind === "event");

  const byStart = <T extends Entry>(list: T[], prefix: string): T => {
    const hit = list.find((x) => x.start.startsWith(prefix));
    if (!hit) throw new Error(`fixture entry starting ${prefix} not found`);
    return hit;
  };

  const e = {
    fontaines: byStart(calEvents, "2026-03-14"),
    birthday: byStart(calEvents, "2026-07-15"),
    drinks: byStart(calEvents, "2026-08-20"),
    hotel: cal.find((x): x is Stay => x.kind === "stay")!,
    caribou: byStart(setlists, "2026-05-15"),
    kraftwerk: byStart(setlists, "2026-05-18"),
    japanConcert: byStart(setlists, "2026-08-07"),
    legMay17: byStart(legs, "2026-05-17"),
    legMay19: byStart(legs, "2026-05-19"),
    legAug6: byStart(legs, "2026-08-06"),
    legAug9: byStart(legs, "2026-08-09"),
    book2010: byStart(books, "2010-12-15"),
    bookMay15: byStart(books, "2026-05-15"),
    bookJun22: byStart(books, "2026-06-22"),
    bookAug6: byStart(books, "2026-08-06"),
    bookSep9: byStart(books, "2026-09-09"),
  };

  // Two trips. bookMay15 and bookAug6 fall inside trip dates but are NOT linked,
  // so they exercise the "unlinked entry inside a trip span" rule.
  for (const x of [e.caribou, e.kraftwerk, e.legMay17, e.legMay19]) x.tripId = TRIP_EUROPE.id;
  for (const x of [e.legAug6, e.legAug9, e.japanConcert]) x.tripId = TRIP_JAPAN.id;

  const data = emptyJournalData();
  data.trips = [TRIP_EUROPE, TRIP_JAPAN];
  data.people = [{ ...SELF }, { ...FRIEND }];
  data.legs = [e.legMay17, e.legMay19, e.legAug6, e.legAug9];
  data.stays = [e.hotel];
  data.events = [e.fontaines, e.birthday, e.drinks, e.caribou, e.kraftwerk, e.japanConcert];
  data.books = [e.book2010, e.bookMay15, e.bookJun22, e.bookAug6, e.bookSep9];
  return { data, e };
}

/** Flatten a model's entry ids in print order. */
export function printOrder(model: {
  chapters: { sections: { entryIds: string[] }[] }[];
}): string[] {
  return model.chapters.flatMap((c) => c.sections.flatMap((s) => s.entryIds));
}
