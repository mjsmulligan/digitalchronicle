import { describe, it, expect } from "vitest";
import { buildPeopleIndex, matchPeople, withMatchedPeople } from "../peopleMatch";
import { connector } from "../connectors/icalendar";
import type { Entry, JEvent, Person } from "../types";

const person = (id: string, name: string, extra: Partial<Person> = {}): Person => ({
  id, name, createdAt: "2026-01-01T00:00:00Z", ...extra,
});

const people: Person[] = [
  person("me", "Mike Mulligan", { isSelf: true }),
  person("kelly", "Kelly Fitzsimons", { aliases: ["Kel"] }),
  person("rosie", "Rosie"),
  person("sinead", "Sinéad Whelan"),
  person("john1", "John Smith"),
  person("john2", "John Smith"),
];
const index = buildPeopleIndex(people);

function event(over: Partial<JEvent> = {}): JEvent {
  return {
    id: "e1", source: "icalendar", tier: 3, createdAt: "2026-01-01T00:00:00Z",
    kind: "event", category: "gathering", artist: "Dinner", venue: "", city: "",
    start: "2026-03-01T19:00", dedupeKey: "event|2026-03-01|dinner",
    ...over,
  } as JEvent;
}

describe("matchPeople: attendees", () => {
  it("matches a full name and lists self first", () => {
    const m = matchPeople(event({ companions: ["Kelly Fitzsimons"] }), index);
    expect(m.participants).toEqual(["me", "kelly"]);
    expect(m.unmatched).toEqual([]);
  });

  it("ignores case and accents", () => {
    const m = matchPeople(event({ companions: ["SINEAD WHELAN"] }), index);
    expect(m.participants).toEqual(["me", "sinead"]);
  });

  it("matches an alias on an invite", () => {
    expect(matchPeople(event({ companions: ["Kel"] }), index).participants).toEqual(["me", "kelly"]);
  });

  it("keeps unknown attendees as free-text companions", () => {
    const m = matchPeople(event({ companions: ["Kelly Fitzsimons", "Someone Else"] }), index);
    expect(m.participants).toEqual(["me", "kelly"]);
    expect(m.unmatched).toEqual(["Someone Else"]);
  });

  it("never matches a name shared by two people", () => {
    const m = matchPeople(event({ companions: ["John Smith"] }), index);
    expect(m.participants).toBeUndefined();
    expect(m.unmatched).toEqual(["John Smith"]);
  });
});

describe("matchPeople: free text", () => {
  it("finds a full name in the title", () => {
    const m = matchPeople(event({ artist: "Lunch with Kelly Fitzsimons" }), index);
    expect(m.participants).toEqual(["me", "kelly"]);
  });

  it("finds a full name in notes", () => {
    const m = matchPeople(event({ review: "Booked by Sinéad Whelan" }), index);
    expect(m.participants).toEqual(["me", "sinead"]);
  });

  it("does not match first names or nicknames in free text", () => {
    expect(matchPeople(event({ artist: "Dinner with Kelly" }), index).participants).toBeUndefined();
    expect(matchPeople(event({ artist: "Kel's birthday" }), index).participants).toBeUndefined();
  });

  it("does not match single-word people in free text", () => {
    expect(matchPeople(event({ artist: "Rosie's party" }), index).participants).toBeUndefined();
  });

  it("matches a single-word person when they are an attendee", () => {
    expect(matchPeople(event({ companions: ["Rosie"] }), index).participants).toEqual(["me", "rosie"]);
  });

  it("matches whole phrases only", () => {
    expect(matchPeople(event({ artist: "Kellyn Fitzsimonsen" }), index).participants).toBeUndefined();
  });

  it("does not match the journal owner alone", () => {
    const m = matchPeople(event({ artist: "Mike Mulligan retirement" }), index);
    expect(m.participants).toBeUndefined();
  });
});

describe("withMatchedPeople", () => {
  it("leaves entries with no match untouched", () => {
    const e = event({ companions: ["Someone Else"] });
    expect(withMatchedPeople(e, index)).toBe(e);
  });

  it("never overrides participants the user already set", () => {
    const e = event({ participants: ["rosie"], companions: ["Kelly Fitzsimons"] });
    expect(withMatchedPeople(e, index)).toBe(e);
  });

  it("removes matched names from companions", () => {
    const e = event({ companions: ["Kelly Fitzsimons", "Someone Else"] });
    const out = withMatchedPeople(e, index) as Entry;
    expect(out.participants).toEqual(["me", "kelly"]);
    expect(out.companions).toEqual(["Someone Else"]);
  });

  it("drops companions entirely when every name matched", () => {
    const out = withMatchedPeople(event({ companions: ["Kelly Fitzsimons"] }), index) as Entry;
    expect(out.companions).toBeUndefined();
  });

  it("works with no people at all", () => {
    const empty = buildPeopleIndex(undefined);
    const e = event({ companions: ["Kelly Fitzsimons"] });
    expect(withMatchedPeople(e, empty)).toBe(e);
  });

  it("omits self from participants when no self person exists", () => {
    const noSelf = buildPeopleIndex(people.filter((p) => !p.isSelf));
    const m = matchPeople(event({ companions: ["Kelly Fitzsimons"] }), noSelf);
    expect(m.participants).toEqual(["kelly"]);
  });
});

describe("icalendar attendees", () => {
  it("reads display names, skipping rooms, plain emails and duplicates", () => {
    const text = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "DTSTART:20260301T190000Z",
      "DTEND:20260301T210000Z",
      "SUMMARY:Dinner",
      'ATTENDEE;CN="Kelly Fitzsimons":mailto:kelly@example.com',
      "ATTENDEE;CN=Sinéad Whelan;PARTSTAT=ACCEPTED:mailto:s@example.com",
      "ATTENDEE;CN=Meeting Room 4;CUTYPE=RESOURCE:mailto:room@example.com",
      "ATTENDEE;CN=someone@example.com:mailto:someone@example.com",
      'ATTENDEE;CN="Kelly Fitzsimons":mailto:kelly@example.com',
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const r = connector.parse({ name: "t.ics", text });
    if (r instanceof Promise) throw new Error("expected sync parse");
    expect(r.entries[0].entry.companions).toEqual(["Kelly Fitzsimons", "Sinéad Whelan"]);
    expect((r.entries[0].entry.raw as Record<string, unknown>).summary).toBe("Dinner");
  });
});
