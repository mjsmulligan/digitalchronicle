import { describe, it, expect } from "vitest";
import { parseFlight } from "./flights";
import { connector } from "./index";
import { resolveAirportText, airportByCode } from "../../airports";
import { timezoneFor } from "../../geo";
import type { Leg } from "../../types";

describe("airport resolution", () => {
  it("resolves codes and names", () => {
    expect(resolveAirportText("DUB").code).toBe("DUB");
    expect(resolveAirportText("Faro").code).toBe("FAO");
    expect(resolveAirportText("Faro Airport").code).toBe("FAO");
    expect(resolveAirportText("Dublin Airport").code).toBe("DUB");
  });

  it("lets a large airport beat a small one with the same city name", () => {
    // A small US airport is also in a town called Dublin.
    expect(resolveAirportText("Dublin").code).toBe("DUB");
  });

  it("leaves multi-airport cities ambiguous", () => {
    const r = resolveAirportText("London");
    expect(r.code).toBeUndefined();
    expect(r.candidates).toEqual(expect.arrayContaining(["LHR", "LGW"]));
  });

  it("returns nothing for unknown text", () => {
    expect(resolveAirportText("Atlantis")).toEqual({ candidates: [] });
  });

  it("gives airport timezones through the shared place lookup", () => {
    expect(airportByCode("FAO")?.timezone).toBe("Europe/Lisbon");
    expect(timezoneFor("FAO")).toBe("Europe/Lisbon");
    expect(timezoneFor("ORD")).toBe("America/Chicago");
  });
});

describe("parseFlight", () => {
  it("Gmail style: destination in title, departure airport in location", () => {
    const f = parseFlight({ summary: "Flight to Faro (FR 123)", location: "Dublin Airport (DUB)" })!;
    expect(f.from.code).toBe("DUB");
    expect(f.to.code).toBe("FAO");
    expect(f.flightNumber).toBe("FR123");
    expect(f.warnings).toEqual([]);
  });

  it("reads a bare code after the place name in location (\"Dublin DUB\")", () => {
    const f = parseFlight({ summary: "Flight to Stuttgart (EW 2775)", location: "Dublin DUB" })!;
    expect(f.from.code).toBe("DUB");
    expect(f.to.code).toBe("STR");
    expect(f.flightNumber).toBe("EW2775");
    expect(f.warnings).toEqual([]);
  });

  it("reads the departure airport from a plain airport name in location", () => {
    const f = parseFlight({ summary: "Flight to Faro (FR 123)", location: "Dublin Airport, Dublin" })!;
    expect(f.from.code).toBe("DUB");
  });

  it("takes the full route from the notes when the title only has a destination", () => {
    const f = parseFlight({
      summary: "Flight to Faro",
      description: "Flight FR 123\nDublin (DUB) to Faro (FAO)\nConfirmation ABC123",
    })!;
    expect(f.from.code).toBe("DUB");
    expect(f.to.code).toBe("FAO");
    expect(f.flightNumber).toBe("FR123");
  });

  it("prefers the title route over location", () => {
    const f = parseFlight({ summary: "Flight LHR-CDG", location: "Dublin Airport" })!;
    expect(f.from.code).toBe("LHR");
    expect(f.to.code).toBe("CDG");
  });

  it("typed titles with place names", () => {
    const f = parseFlight({ summary: "Flight from Dublin to Faro" })!;
    expect(f.from.code).toBe("DUB");
    expect(f.to.code).toBe("FAO");
  });

  it("flight number with a route and no 'flight' word", () => {
    const f = parseFlight({ summary: "FR 123 Dublin to Faro" })!;
    expect(f.from.code).toBe("DUB");
    expect(f.to.code).toBe("FAO");
    expect(f.flightNumber).toBe("FR123");
  });

  it("two bare codes without a flight number still count", () => {
    const f = parseFlight({ summary: "EI204 DUB ORD" })!;
    expect(f.from.code).toBe("DUB");
    expect(f.to.code).toBe("ORD");
    expect(f.flightNumber).toBe("EI204");
  });

  it("keeps the place name when a city has several airports", () => {
    const f = parseFlight({ summary: "Flight to Paris", location: "Dublin Airport" })!;
    expect(f.from.code).toBe("DUB");
    expect(f.to.code).toBeUndefined();
    expect(f.to.name).toBe("Paris");
    expect(f.warnings.join(" ")).toMatch(/several airports/);
  });

  it("falls back to placeholders with a warning when nothing resolves", () => {
    const f = parseFlight({ summary: "Fly home" })!;
    expect(f.from.code).toBeUndefined();
    expect(f.to.code).toBeUndefined();
    expect(f.warnings[0]).toMatch(/No airport codes/);
  });

  it("names the missing side when only one is known", () => {
    const f = parseFlight({ summary: "Flight to Faro" })!;
    expect(f.to.code).toBe("FAO");
    expect(f.warnings).toEqual(["Departure airport not found — fill in From"]);
  });

  it("drops an origin that equals the destination", () => {
    const f = parseFlight({ summary: "Flight to Faro", location: "Faro Airport" })!;
    expect(f.from.code).toBeUndefined();
    expect(f.to.code).toBe("FAO");
  });

  it.each([
    "Q1 2026 planning",
    "Dinner at Terminal 2",
    "Train Dublin to Cork",
    "ICE 1234 Berlin → Hamburg",
    "Team standup",
    "Sarah's Birthday",
  ])("does not treat %j as a flight", (summary) => {
    expect(parseFlight({ summary })).toBeNull();
  });
});

describe("icalendar connector: flights end to end", () => {
  function parse(vevent: string) {
    const text = `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\n${vevent}\r\nEND:VEVENT\r\nEND:VCALENDAR`;
    const r = connector.parse({ name: "t.ics", text });
    if (r instanceof Promise) throw new Error("expected sync parse");
    return r;
  }

  it("a Gmail-style flight becomes a resolved leg whose key matches other sources", () => {
    const r = parse(
      [
        "DTSTART:20261015T060000Z",
        "DTEND:20261015T090000Z",
        "SUMMARY:Flight to Faro (FR 123)",
        "LOCATION:Dublin Airport (DUB)",
      ].join("\r\n"),
    );
    const leg = r.entries[0].entry as Leg;
    expect(leg.kind).toBe("leg");
    expect(leg.from).toBe("DUB");
    expect(leg.to).toBe("FAO");
    expect(leg.flightNumber).toBe("FR123");
    expect(leg.dedupeKey).toBe("leg|2026-10-15|DUB|FAO");
    expect(r.entries[0].warnings).toEqual([]);
  });

  it("an unresolved flight stores the place name directly and emits a warning", () => {
    // "Flight to Paris" — origin unknown, destination name extracted but ambiguous.
    // from/to now carry the best available text rather than "???".
    const r = parse(["DTSTART:20261015T060000Z", "DTEND:20261015T090000Z", "SUMMARY:Flight to Paris"].join("\r\n"));
    const leg = r.entries[0].entry as Leg;
    expect(leg.from).toBe("");       // origin unknown → empty string
    expect(leg.to).toBe("Paris");    // destination name stored directly in `to`
    expect(leg.toName).toBeUndefined(); // no longer needed as a separate field
    expect(r.entries[0].warnings.length).toBeGreaterThan(0);
  });
});
