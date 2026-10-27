/** Calendar text can carry HTML (booking emails put <b> around names): entries show plain text. */
import { describe, it, expect } from "vitest";
import { connector, htmlToText } from "./index";
import type { Stay, JEvent } from "../../types";

const run = (ics: string) => {
  const r = connector.parse({ name: "x.ics", text: ics });
  if (r instanceof Promise) throw new Error("expected sync parse");
  return r.entries.map((e) => e.entry);
};
const cal = (...lines: string[]) => ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", ...lines, "END:VEVENT", "END:VCALENDAR"].join("\n");

describe("htmlToText", () => {
  it("drops tags, keeps line breaks and decodes entities", () => {
    expect(htmlToText("<b>Hotel</b> A &amp; B<br>Line two<br/>&lt;ok&gt; it&#39;s")).toBe("Hotel A & B\nLine two\n<ok> it's");
  });
  it("leaves plain text alone", () => {
    expect(htmlToText("Fontaines D.C.")).toBe("Fontaines D.C.");
  });
});

describe("html in calendar fields", () => {
  it("a hotel booking with a bold name becomes a stay with a plain name and a clean key", () => {
    const [s] = run(cal(
      "DTSTART;TZID=Europe/Dublin:20261012T150000", "DTEND;TZID=Europe/Dublin:20261014T110000",
      "SUMMARY:Booking",
      "DESCRIPTION:Hotel: <b>Hôtel Le Marianne</b>\\nAddress: 1 Rue Exemple\\, Paris\\nNo. of nights: 2",
    )) as Stay[];
    expect(s.kind).toBe("stay");
    expect(s.place).toBe("Hôtel Le Marianne");
    expect(s.dedupeKey).toBe("stay|2026-10-12|hotel-le-marianne");
  });

  it("a title with tags is clean, and the location too", () => {
    const [e] = run(cal(
      "DTSTART;TZID=Europe/Dublin:20260314T200000", "DTEND;TZID=Europe/Dublin:20260314T230000",
      "SUMMARY:<b>Fontaines D.C.</b>", "LOCATION:3Arena\\, <i>Dublin</i>",
    )) as JEvent[];
    expect(e.artist).toBe("Fontaines D.C.");
    expect(e.venue).toBe("3Arena");
    expect(e.city).toBe("Dublin");
  });
});
