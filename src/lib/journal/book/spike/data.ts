/**
 * WP0 spike: deterministic synthetic journal data.
 *
 * Shaped like real importer output (trips with legs, stays and concerts, plus
 * standalone books with source reviews and user reflections) so the spike PDF
 * exercises the same table, quote and reflection layouts the real book will use.
 * Seeded, so every run produces the same book.
 */
import {
  emptyJournalData,
  type Book,
  type JEvent,
  type JournalData,
  type Leg,
  type Stay,
  type Trip,
} from "../../types";

/** Small seeded PRNG (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS =
  "the we a day morning evening train station coffee walked along river old town market bridge rain sun cold warm long short quiet loud crowd friends family kids dinner lunch late early arrived left waited platform gate flight view hill lake sea harbour museum gallery concert stage band song encore home weekend again finally together laughed tired happy slow fast first last best small big new familiar strange lovely".split(
    " ",
  );

const CITIES = [
  "Berlin",
  "Hamburg",
  "Munich",
  "Vienna",
  "Prague",
  "Lisbon",
  "Porto",
  "Rome",
  "Milan",
  "Turin",
  "Sligo",
  "Cork",
  "Helsinki",
];
const AIRPORTS: Record<string, string> = {
  Berlin: "BER",
  Hamburg: "HAM",
  Munich: "MUC",
  Vienna: "VIE",
  Prague: "PRG",
  Lisbon: "LIS",
  Porto: "OPO",
  Rome: "FCO",
  Milan: "MXP",
  Turin: "TRN",
  Sligo: "SXL",
  Cork: "ORK",
  Helsinki: "HEL",
};
const ARTISTS = [
  "Fontaines D.C.",
  "Caribou",
  "Kraftwerk",
  "Lewis Capaldi",
  "Ed Sheeran",
  "Arctic Monkeys",
  "Bayer Leverkusen v Bayern",
  "Dermot Kennedy",
];
const BOOKS = [
  ["The Remains of the Day", "Kazuo Ishiguro"],
  ["Around the World in Eighty Days", "Jules Verne"],
  ["Small Things Like These", "Claire Keegan"],
  ["The Overstory", "Richard Powers"],
  ["Piranesi", "Susanna Clarke"],
];

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

export interface SpikeDataOptions {
  /** Approximate number of entries to generate. */
  entryCount: number;
  seed?: number;
  /** First day of the journal, "YYYY-MM-DD". */
  startDay?: string;
}

export function makeSpikeJournal(opts: SpikeDataOptions): JournalData {
  const rand = rng(opts.seed ?? 1);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
  const sentence = (min: number, max: number) => {
    const n = min + Math.floor(rand() * (max - min + 1));
    const w = Array.from({ length: n }, () => pick(WORDS));
    return w[0][0].toUpperCase() + w[0].slice(1) + " " + w.slice(1).join(" ") + ".";
  };
  const paragraph = () =>
    Array.from({ length: 2 + Math.floor(rand() * 3) }, () => sentence(8, 16)).join(" ");

  const data = emptyJournalData();
  const day = new Date(`${opts.startDay ?? "2023-01-10"}T00:00:00Z`);
  let n = 0;
  let id = 0;
  const nextId = () => `spike-${++id}`;
  const advance = (days: number) => day.setUTCDate(day.getUTCDate() + days);
  const base = (start: string, key: string) => ({
    id: nextId(),
    source: "spike",
    start,
    dedupeKey: key,
    createdAt: "2026-10-22T00:00:00Z",
  });

  while (n < opts.entryCount) {
    const roll = rand();
    if (roll < 0.45) {
      // A trip: outbound leg, stay, one or two events, return leg.
      const city = pick(CITIES);
      const nights = 2 + Math.floor(rand() * 4);
      const tripId = `trip-${id}`;
      const start = iso(day);
      const air = rand() < 0.5;
      const code = AIRPORTS[city];
      const mkLeg = (from: string, to: string, date: string, time: string, k: string): Leg =>
        ({
          ...base(`${date}T${time}`, `leg|${date}|${k}`),
          kind: "leg",
          mode: air ? "air" : "rail",
          from,
          to,
          fromName: from,
          toName: to,
          tripId,
          ...(air
            ? { flightNumber: `EI${300 + Math.floor(rand() * 600)}` }
            : { trainNumber: `ICE ${100 + Math.floor(rand() * 800)}` }),
          end: `${date}T${pad(Number(time.slice(0, 2)) + 2)}:${time.slice(3)}`,
        }) as Leg;
      data.legs.push(
        mkLeg(
          air ? "DUB" : "Dublin",
          air ? code : city,
          start,
          `${pad(6 + Math.floor(rand() * 8))}:${pick(["05", "20", "45"])}`,
          "out",
        ),
      );
      const stay: Stay = {
        ...base(start, `stay|${start}|${city}`),
        kind: "stay",
        place: `Hotel ${pick(["Arts", "Central", "Riverside", "Old Town"])} ${city}`,
        city,
        end: undefined,
        tripId,
        notes: undefined,
      } as Stay;
      data.stays.push(stay);
      n += 2;
      for (let i = 0; i < 1 + Math.floor(rand() * 2); i++) {
        const d = new Date(day);
        d.setUTCDate(d.getUTCDate() + 1 + i);
        const ev: JEvent = {
          ...base(iso(d), `event|${iso(d)}|${i}`),
          kind: "event",
          category: "concert",
          artist: pick(ARTISTS),
          venue: pick(["Tempodrom", "3Arena", "O2 Arena", "Kesselhaus"]),
          city,
          country: "",
          tripId,
          rating: Math.round(rand() * 40 + 60) / 10,
          reflection: rand() < 0.5 ? paragraph() : undefined,
        } as JEvent;
        data.events.push(ev);
        n++;
      }
      const back = new Date(day);
      back.setUTCDate(back.getUTCDate() + nights);
      data.legs.push(
        mkLeg(
          air ? code : city,
          air ? "DUB" : "Dublin",
          iso(back),
          `${pad(14 + Math.floor(rand() * 6))}:${pick(["10", "35", "50"])}`,
          "back",
        ),
      );
      n++;
      data.trips.push({
        id: tripId,
        title: `${city} ${day.getUTCFullYear()}`,
        start,
        end: iso(back),
        cover: "",
        createdAt: "2026-10-22T00:00:00Z",
        reflection: rand() < 0.5 ? paragraph() : undefined,
      } as Trip);
      advance(nights + 3 + Math.floor(rand() * 10));
    } else if (roll < 0.75) {
      const [title, author] = pick(BOOKS);
      const book: Book = {
        ...base(iso(day), `book|${iso(day)}|${title}`),
        kind: "book",
        title,
        author,
        year: 1990 + Math.floor(rand() * 30),
        rating: Math.round(rand() * 50 + 50) / 10,
        review: rand() < 0.6 ? paragraph() : undefined,
        reflection: rand() < 0.4 ? paragraph() : undefined,
        source: "goodreads",
      } as Book;
      data.books.push(book);
      n++;
      advance(2 + Math.floor(rand() * 12));
    } else {
      const ev: JEvent = {
        ...base(iso(day), `event|${iso(day)}|solo`),
        kind: "event",
        category: rand() < 0.5 ? "concert" : "milestone",
        artist: pick(ARTISTS),
        venue: pick(["3Arena", "Aviva Stadium", "Home"]),
        city: "Dublin",
        country: "Ireland",
        reflection: rand() < 0.6 ? paragraph() : undefined,
        rating: rand() < 0.5 ? Math.round(rand() * 40 + 60) / 10 : undefined,
      } as JEvent;
      data.events.push(ev);
      n++;
      advance(3 + Math.floor(rand() * 15));
    }
  }
  return data;
}
