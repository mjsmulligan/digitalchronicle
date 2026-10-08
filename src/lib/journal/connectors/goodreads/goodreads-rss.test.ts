import { describe, expect, it } from "vitest";
import { fetchGoodreadsShelfCsv, parseGoodreadsUserId, rssToGoodreadsCsv } from "./rss";
import { csvRows } from "../csv";

const item = (id: string, title: string) => `<item>
<title><![CDATA[${title}]]></title><book_id>${id}</book_id>
<author_name>Ann Leckie</author_name><user_rating>4</user_rating>
<user_read_at><![CDATA[Tue, 18 Aug 2026 00:00:00 +0000]]></user_read_at>
<user_date_added><![CDATA[Mon, 03 Aug 2026 10:00:00 -0700]]></user_date_added>
<user_review><![CDATA[Great, "loved" it<br/>really]]></user_review>
<book_published>2013</book_published><isbn>0316246638</isbn></item>`;

describe("goodreads rss", () => {
  it("parses user ids and usernames", () => {
    expect(parseGoodreadsUserId("12345")).toBe("12345");
    expect(parseGoodreadsUserId("janedoe")).toBe("janedoe");
    expect(parseGoodreadsUserId("jane-doe")).toBe("jane-doe");
    expect(parseGoodreadsUserId("https://www.goodreads.com/user/show/12345-jane-doe")).toBe("12345");
    expect(parseGoodreadsUserId("")).toBeNull();
    expect(parseGoodreadsUserId("not a valid/url")).toBeNull();
  });

  it("converts items to export-shaped csv", () => {
    const rows = csvRows(rssToGoodreadsCsv(`<rss><channel>${item("1", "Ancillary Justice (Imperial Radch, #1)")}</channel></rss>`));
    expect(rows).toHaveLength(1);
    const r = rows[0].row;
    expect(r["Title"]).toBe("Ancillary Justice (Imperial Radch, #1)");
    expect(r["Date Read"]).toBe("2026/08/18");
    expect(r["My Rating"]).toBe("4");
    expect(r["My Review"]).toBe('Great, "loved" it\nreally');
    expect(r["Exclusive Shelf"]).toBe("read");
  });

  it("paginates until no new items", async () => {
    const pages = [item("1", "A") + item("2", "B"), item("2", "B") + item("3", "C"), item("3", "C")];
    let calls = 0;
    const fetchFn = (async () => ({ ok: true, status: 200, text: async () => pages[calls++] ?? "" })) as unknown as typeof fetch;
    const { count } = await fetchGoodreadsShelfCsv("1", { fetchFn });
    expect(count).toBe(3);
    expect(calls).toBe(3);
  });
});
