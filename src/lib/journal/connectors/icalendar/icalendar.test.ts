import { describe, it, expect } from "vitest";
import { connector } from "./index";
import sampleText from "./fixtures/sample.ics?raw";
import type { JEvent, Stay, Leg } from "../../types";

describe("icalendar connector", () => {
  it("has correct metadata", () => {
    expect(connector.id).toBe("icalendar");
    expect(connector.label).toBe("iCalendar (.ics)");
    expect(connector.kind).toBe("file");
    expect(connector.accepts).toContain(".ics");
  });

  describe("sniff", () => {
    it("scores .ics filename highly", () => {
      expect(connector.sniff!("my-calendar.ics", "")).toBeGreaterThanOrEqual(0.9);
    });

    it("scores BEGIN:VCALENDAR content at maximum", () => {
      expect(connector.sniff!("export.txt", "begin:vcalendar\nversion:2.0")).toBeGreaterThan(0.95);
    });

    it("scores zero for unrelated content", () => {
      expect(connector.sniff!("diary.csv", "date,title,rating,notes")).toBe(0);
    });
  });

  describe("parse — fixture", () => {
    const r = (() => {
      const result = connector.parse({ name: "sample.ics", text: sampleText });
      if (result instanceof Promise) throw new Error("expected sync parse");
      return result;
    })();

    it("parses 4 entries (recurring event skipped)", () => {
      expect(r.entries).toHaveLength(4);
    });

    it("emits one error for the recurring standup event", () => {
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]).toMatch(/Morning Standup/);
      expect(r.errors[0]).toMatch(/recurring/i);
    });

    it("all entries have source=icalendar", () => {
      for (const { entry } of r.entries) {
        expect(entry.source).toBe("icalendar");
      }
    });

    it("all entries have non-empty dedupeKeys", () => {
      for (const { entry } of r.entries) {
        expect(entry.dedupeKey.length).toBeGreaterThan(0);
      }
    });
  });

  describe("concert event (TZID, CATEGORIES:MUSIC)", () => {
    const r = connector.parse({ name: "sample.ics", text: sampleText }) as ReturnType<typeof connector.parse> extends Promise<infer T> ? T : ReturnType<typeof connector.parse>;
    if (r instanceof Promise) throw new Error("sync expected");

    it("parses as JEvent with category concert", () => {
      const entry = r.entries[0].entry as JEvent;
      expect(entry.kind).toBe("event");
      expect(entry.category).toBe("concert");
      expect(entry.artist).toBe("Fontaines D.C.");
    });

    it("extracts venue from LOCATION", () => {
      const entry = r.entries[0].entry as JEvent;
      expect(entry.venue).toBe("3Arena");
    });

    it("extracts city from LOCATION", () => {
      const entry = r.entries[0].entry as JEvent;
      expect(entry.city).toBe("Dublin");
    });

    it("preserves TZID as startTz", () => {
      const entry = r.entries[0].entry as JEvent;
      expect(entry.startTz).toBe("Europe/Dublin");
    });

    it("sets start to local datetime", () => {
      const entry = r.entries[0].entry as JEvent;
      expect(entry.start).toBe("2026-03-14T20:00");
    });

    it("maps DESCRIPTION to review", () => {
      const entry = r.entries[0].entry as JEvent;
      expect(entry.review).toContain("Incredible energy");
    });

    it("dedupeKey starts with event|", () => {
      expect(r.entries[0].entry.dedupeKey).toMatch(/^event\|/);
    });
  });

  describe("multi-day all-day event → Stay", () => {
    const r = connector.parse({ name: "sample.ics", text: sampleText }) as ReturnType<typeof connector.parse> extends Promise<infer T> ? T : ReturnType<typeof connector.parse>;
    if (r instanceof Promise) throw new Error("sync expected");

    it("parses as Stay", () => {
      const entry = r.entries[1].entry as Stay;
      expect(entry.kind).toBe("stay");
    });

    it("uses SUMMARY as place", () => {
      const entry = r.entries[1].entry as Stay;
      expect(entry.place).toBe("Hotel Arts Barcelona");
    });

    it("extracts city from LOCATION", () => {
      const entry = r.entries[1].entry as Stay;
      expect(entry.city).toBe("Barcelona");
    });

    it("sets start and end dates", () => {
      const entry = r.entries[1].entry as Stay;
      expect(entry.start).toBe("2026-06-01");
      expect(entry.end).toBe("2026-06-08");
    });

    it("dedupeKey starts with stay|", () => {
      expect(r.entries[1].entry.dedupeKey).toMatch(/^stay\|/);
    });
  });

  describe("single-day all-day birthday → JEvent celebration", () => {
    const r = connector.parse({ name: "sample.ics", text: sampleText }) as ReturnType<typeof connector.parse> extends Promise<infer T> ? T : ReturnType<typeof connector.parse>;
    if (r instanceof Promise) throw new Error("sync expected");

    it("parses as JEvent", () => {
      expect(r.entries[2].entry.kind).toBe("event");
    });

    it("infers category celebration from CATEGORIES:BIRTHDAY", () => {
      const entry = r.entries[2].entry as JEvent;
      expect(entry.category).toBe("celebration");
    });

    it("start is date-only (no time)", () => {
      expect(r.entries[2].entry.start).toBe("2026-07-15");
    });
  });

  describe("UTC datetime event → JEvent gathering", () => {
    const r = connector.parse({ name: "sample.ics", text: sampleText }) as ReturnType<typeof connector.parse> extends Promise<infer T> ? T : ReturnType<typeof connector.parse>;
    if (r instanceof Promise) throw new Error("sync expected");

    it("parses as JEvent", () => {
      expect(r.entries[3].entry.kind).toBe("event");
    });

    it("infers category gathering from title", () => {
      const entry = r.entries[3].entry as JEvent;
      expect(entry.category).toBe("gathering");
    });

    it("sets start to datetime", () => {
      expect(r.entries[3].entry.start).toBe("2026-08-20T18:00");
    });

    it("sets startTz to UTC", () => {
      const entry = r.entries[3].entry as JEvent;
      expect(entry.startTz).toBe("UTC");
    });
  });

  describe("flight detection → Leg", () => {
    function parseFlight(summary: string, dtstart = "20261015T060000Z", dtend = "20261015T080000Z") {
      const ics = [
        "BEGIN:VCALENDAR",
        "BEGIN:VEVENT",
        `DTSTART:${dtstart}`,
        `DTEND:${dtend}`,
        `SUMMARY:${summary}`,
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\n");
      const r = connector.parse({ name: "test.ics", text: ics });
      if (r instanceof Promise) throw new Error("sync expected");
      return r;
    }

    it("'Flight LHR-CDG' → Leg with from/to", () => {
      const { entries } = parseFlight("Flight LHR-CDG");
      expect(entries).toHaveLength(1);
      const leg = entries[0].entry as Leg;
      expect(leg.kind).toBe("leg");
      expect(leg.mode).toBe("air");
      expect(leg.from).toBe("LHR");
      expect(leg.to).toBe("CDG");
    });

    it("'BA123 LHR → CDG' → Leg with flightNumber", () => {
      const { entries } = parseFlight("BA123 LHR → CDG");
      const leg = entries[0].entry as Leg;
      expect(leg.kind).toBe("leg");
      expect(leg.from).toBe("LHR");
      expect(leg.to).toBe("CDG");
      expect(leg.flightNumber).toBe("BA123");
    });

    it("'Flight to Paris' → Leg with place name in to and warning", () => {
      // Ambiguous destination: place name is preserved in `to`, origin unknown → "".
      const { entries } = parseFlight("Flight to Paris");
      const leg = entries[0].entry as Leg;
      expect(leg.kind).toBe("leg");
      expect(leg.from).toBe("");       // origin unknown
      expect(leg.to).toBe("Paris");   // place name stored directly
      expect(entries[0].warnings.length).toBeGreaterThan(0);
    });

    it("'EI204 DUB ORD' → Leg without 'flight' keyword", () => {
      const { entries } = parseFlight("EI204 DUB ORD");
      const leg = entries[0].entry as Leg;
      expect(leg.kind).toBe("leg");
      expect(leg.from).toBe("DUB");
      expect(leg.to).toBe("ORD");
      expect(leg.flightNumber).toBe("EI204");
    });

    it("dedupeKey starts with leg|", () => {
      const { entries } = parseFlight("Flight LHR-CDG");
      expect(entries[0].entry.dedupeKey).toMatch(/^leg\|/);
    });

    it("end date set from DTEND", () => {
      const { entries } = parseFlight("Flight LHR-CDG", "20261015T060000Z", "20261015T085500Z");
      const leg = entries[0].entry as Leg;
      expect(leg.end).toBeDefined();
    });
  });

  describe("train detection → Leg", () => {
    function parseTrain(summary: string, dtstart = "20261015T090000Z", dtend = "20261015T120000Z") {
      const ics = [
        "BEGIN:VCALENDAR",
        "BEGIN:VEVENT",
        `DTSTART:${dtstart}`,
        `DTEND:${dtend}`,
        `SUMMARY:${summary}`,
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\n");
      const r = connector.parse({ name: "test.ics", text: ics });
      if (r instanceof Promise) throw new Error("sync expected");
      return r;
    }

    it("'Train London to Edinburgh' → Leg mode rail", () => {
      const { entries } = parseTrain("Train London to Edinburgh");
      expect(entries).toHaveLength(1);
      const leg = entries[0].entry as Leg;
      expect(leg.kind).toBe("leg");
      expect(leg.mode).toBe("rail");
      expect(leg.from).toBe("London");
      expect(leg.to).toBe("Edinburgh");
    });

    it("'Eurostar London → Paris' → Leg with arrow extraction", () => {
      const { entries } = parseTrain("Eurostar London → Paris");
      const leg = entries[0].entry as Leg;
      expect(leg.kind).toBe("leg");
      expect(leg.mode).toBe("rail");
      expect(leg.from).toBe("London");
      expect(leg.to).toBe("Paris");
    });

    it("'ICE123 Hamburg → Berlin' → Leg with trainNumber; service number stripped from from", () => {
      // The improved extractor strips the service-number prefix from the origin side.
      const { entries } = parseTrain("ICE123 Hamburg → Berlin");
      const leg = entries[0].entry as Leg;
      expect(leg.kind).toBe("leg");
      expect(leg.mode).toBe("rail");
      expect(leg.from).toBe("Hamburg"); // service number stripped
      expect(leg.to).toBe("Berlin");
      expect(leg.trainNumber).toBeDefined();
    });

    it("'Train to Cork' → Leg with destination captured and origin warning", () => {
      // Destination-only: "Train to Cork" now captures "Cork" as `to`
      // and emits a warning about the unknown origin (not "no station names").
      const { entries } = parseTrain("Train to Cork");
      const leg = entries[0].entry as Leg;
      expect(leg.kind).toBe("leg");
      expect(leg.mode).toBe("rail");
      expect(leg.from).toBe("");     // origin unknown → empty string
      expect(leg.to).toBe("Cork");  // destination captured
      expect(entries[0].warnings.length).toBeGreaterThan(0);
      expect(entries[0].warnings[0]).toMatch(/origin/i);
    });

    describe("origin from LOCATION when the title has only a destination", () => {
      function parseTrainAt(summary: string, location?: string) {
        const ics = [
          "BEGIN:VCALENDAR",
          "BEGIN:VEVENT",
          "DTSTART;TZID=Europe/Dublin:20260920T171500",
          "DTEND;TZID=Europe/Dublin:20260920T181500",
          `SUMMARY:${summary}`,
          ...(location ? [`LOCATION:${location}`] : []),
          "END:VEVENT",
          "END:VCALENDAR",
        ].join("\n");
        const r = connector.parse({ name: "device-calendar.ics", text: ics });
        if (r instanceof Promise) throw new Error("sync expected");
        return r.entries[0];
      }

      it("'Train to Köln/Bonn Flughafen' at 'Leverkusen Mitte' → From and To both set, no warning", () => {
        const e = parseTrainAt("Train to Köln/Bonn Flughafen", "Leverkusen Mitte");
        const leg = e.entry as Leg;
        expect(leg.mode).toBe("rail");
        expect(leg.from).toBe("Leverkusen Mitte");
        expect(leg.to).toBe("Köln/Bonn Flughafen");
        expect(e.warnings).toHaveLength(0);
      });

      it("uses only the first part of a full address", () => {
        const leg = parseTrainAt("Train to Cork", "Heuston Station, Dublin 8, Ireland").entry as Leg;
        expect(leg.from).toBe("Heuston Station");
        expect(leg.to).toBe("Cork");
      });

      it("does not use LOCATION when it just repeats the destination", () => {
        const e = parseTrainAt("Train to Cork", "Cork");
        expect((e.entry as Leg).from).toBe("");
        expect(e.warnings[0]).toMatch(/origin/i);
      });

      it("keeps the origin from the title when both are present", () => {
        const leg = parseTrainAt("Train London to Edinburgh", "Somewhere Else").entry as Leg;
        expect(leg.from).toBe("London");
      });

      it("without a LOCATION, still warns about the unknown origin", () => {
        const e = parseTrainAt("Train to Cork");
        expect((e.entry as Leg).from).toBe("");
        expect(e.warnings[0]).toMatch(/origin/i);
      });

      it("does not guess an origin when the title has no destination either", () => {
        const e = parseTrainAt("Train", "Leverkusen Mitte");
        const leg = e.entry as Leg;
        expect(leg.from).toBe("");
        expect(leg.to).toBe("");
      });
    });

    it("train does not set flightNumber", () => {
      const { entries } = parseTrain("Train London → Edinburgh");
      const leg = entries[0].entry as Leg;
      expect(leg.flightNumber).toBeUndefined();
    });

    it("dedupeKey starts with leg|", () => {
      const { entries } = parseTrain("Train London → Edinburgh");
      expect(entries[0].entry.dedupeKey).toMatch(/^leg\|/);
    });
  });

  describe("edge cases", () => {
    it("skips events without SUMMARY", () => {
      const ics = `BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART:20260101\nDTEND:20260102\nEND:VEVENT\nEND:VCALENDAR`;
      const r = connector.parse({ name: "test.ics", text: ics });
      if (r instanceof Promise) throw new Error("sync expected");
      expect(r.entries).toHaveLength(0);
      expect(r.errors).toHaveLength(1);
    });

    it("handles line folding (RFC 5545 §3.1)", () => {
      const ics = [
        "BEGIN:VCALENDAR",
        "BEGIN:VEVENT",
        "DTSTART:20260601T100000Z",
        "DTEND:20260601T110000Z",
        "SUMMARY:A Very Long Event Title That Gets",
        " Folded Across Two Lines",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\n");
      const r = connector.parse({ name: "test.ics", text: ics });
      if (r instanceof Promise) throw new Error("sync expected");
      expect(r.entries).toHaveLength(1);
      expect((r.entries[0].entry as JEvent).artist).toBe(
        "A Very Long Event Title That GetsFolded Across Two Lines",
      );
    });

    it("dedupeKey format: event|date|artist", () => {
      const ics = `BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART:20260601\nDTEND:20260602\nSUMMARY:Test Event\nEND:VEVENT\nEND:VCALENDAR`;
      const r = connector.parse({ name: "test.ics", text: ics });
      if (r instanceof Promise) throw new Error("sync expected");
      expect(r.entries[0].entry.dedupeKey).toBe("event|2026-06-01|test event");
    });
  });
});

describe("icalendar connector: hotel bookings and addresses", () => {
  const ics = (extra: string) =>
    ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", "UID:a@test", ...extra.split("\n"), "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  const parse = (extra: string) => {
    const r = connector.parse({ name: "h.ics", text: ics(extra) });
    if (r instanceof Promise) throw new Error("sync expected");
    return r;
  };
  const booking = [
    "SUMMARY:EXAMPLE HOTEL SHENZHEN\\, 04 February\\, 2026 – 05 February\\, 2026\\, DOE Jane Ms",
    "LOCATION:HAI DE SAN DAO\\, HOU HAI BIN RD\\,SHENZHEN\\,518054\\, CN\\,",
    "DESCRIPTION:Hotel: EXAMPLE HOTEL SHENZHEN\\nAddress: HAI DE SAN DAO\\, HOU HAI BIN RD\\,SHENZHEN\\,518054\\, CN\\,\\nNo. of nights: 1\\nConfirmation: 12345",
  ].join("\n");

  it("a one-night hotel booking with date-only times is a Stay named after the hotel", () => {
    const r = parse(`${booking}\nDTSTART;VALUE=DATE:20260204\nDTEND;VALUE=DATE:20260205`);
    const s = r.entries[0].entry as Stay;
    expect(s.kind).toBe("stay");
    expect(s.place).toBe("EXAMPLE HOTEL SHENZHEN");
    expect(s.city).toBe("SHENZHEN");
    expect(s.start).toBe("2026-02-04");
    expect(s.end).toBe("2026-02-05");
  });

  it("a timed hotel booking is also a Stay", () => {
    const r = parse(`${booking}\nDTSTART:20260204T150000\nDTEND:20260205T120000`);
    const s = r.entries[0].entry as Stay;
    expect(s.kind).toBe("stay");
    expect(s.end).toBe("2026-02-05");
  });

  it("takes the end from No. of nights when DTEND does not help", () => {
    const r = parse(`${booking.replace("nights: 1", "nights: 3")}\nDTSTART;VALUE=DATE:20260204`);
    expect((r.entries[0].entry as Stay).end).toBe("2026-02-07");
  });

  it("skips trailing postcode and country code when finding the city", () => {
    const r = parse("SUMMARY:Dinner\nLOCATION:Some Place\\, 1 High St\\, Cork\\, T12 AB34\\, IE\nDTSTART:20260204T190000\nDTEND:20260204T210000");
    const e = r.entries[0].entry as JEvent;
    expect(e.venue).toBe("Some Place");
    expect(e.city).toBe("Cork");
  });

  it("a plain event with only a Hotel: line is not turned into a stay", () => {
    const r = parse("SUMMARY:Chat\nDESCRIPTION:Hotel: lobby bar\nDTSTART:20260204T190000\nDTEND:20260204T200000");
    expect(r.entries[0].entry.kind).toBe("event");
  });
});
