import { describe, it, expect } from "vitest";
import { connector } from "./index";
import sampleText from "./fixtures/sample.ics?raw";
import type { JEvent, Stay, Leg } from "../../types";

describe("icalendar connector", () => {
  it("has correct metadata", () => {
    expect(connector.id).toBe("icalendar");
    expect(connector.label).toBe("iCalendar (.ics)");
    expect(connector.kind).toBe("file");
    expect(connector.tier).toBe(3);
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

    it("all entries have source=icalendar and tier=3", () => {
      for (const { entry } of r.entries) {
        expect(entry.source).toBe("icalendar");
        expect(entry.tier).toBe(3);
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

    it("maps DESCRIPTION to reflection", () => {
      const entry = r.entries[0].entry as JEvent;
      expect(entry.reflection).toContain("Incredible energy");
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

    it("'Flight to Paris' → Leg with ??? placeholders and warning", () => {
      const { entries } = parseFlight("Flight to Paris");
      const leg = entries[0].entry as Leg;
      expect(leg.kind).toBe("leg");
      expect(leg.from).toBe("???");
      expect(leg.to).toBe("???");
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

    it("'ICE123 Hamburg → Berlin' → Leg with trainNumber", () => {
      const { entries } = parseTrain("ICE123 Hamburg → Berlin");
      const leg = entries[0].entry as Leg;
      expect(leg.kind).toBe("leg");
      expect(leg.mode).toBe("rail");
      expect(leg.from).toBe("ICE123 Hamburg");
      expect(leg.to).toBe("Berlin");
      expect(leg.trainNumber).toBeDefined();
    });

    it("'Train to Cork' → Leg with ??? placeholders and warning", () => {
      const { entries } = parseTrain("Train to Cork");
      const leg = entries[0].entry as Leg;
      expect(leg.kind).toBe("leg");
      expect(leg.mode).toBe("rail");
      expect(leg.from).toBe("???");
      expect(entries[0].warnings.length).toBeGreaterThan(0);
      expect(entries[0].warnings[0]).toMatch(/station names/i);
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
