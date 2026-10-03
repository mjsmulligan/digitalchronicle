/**
 * Contacts parser — produces Person drafts from vCard (.vcf) or contacts CSV files.
 *
 * This is NOT a Connector (it returns Person records, not Entry records).
 * It is used directly on the /people page import section.
 *
 * Supported formats:
 *   - vCard 3.0 / 4.0 (.vcf): FN, N (fallback), NICKNAME
 *   - Google Contacts CSV: First Name + Last Name + Nickname columns
 *   - Generic CSV: Name or Full Name column
 */
import { csvRows } from "./connectors/csv";

export interface ContactDraft {
  name: string;
  /** Nicknames / alternative spellings for matching. */
  aliases?: string[];
}

export interface ContactParseResult {
  contacts: { draft: ContactDraft; sourceRow: number }[];
  errors: string[];
}

// ---------------------------------------------------------------------------
// vCard parser
// ---------------------------------------------------------------------------

/** Unfold vCard line continuations (RFC 6350 §3.2). */
function unfold(text: string): string {
  return text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
}

function parseVCard(text: string): ContactParseResult {
  const out: ContactParseResult = { contacts: [], errors: [] };
  const unfolded = unfold(text);
  const re = /BEGIN:VCARD([\s\S]*?)END:VCARD/gi;
  let m: RegExpExecArray | null;
  let idx = 0;

  while ((m = re.exec(unfolded)) !== null) {
    idx++;
    const block = m[1];
    const props = new Map<string, string>();

    for (const line of block.split(/\r?\n/)) {
      const ci = line.indexOf(":");
      if (ci < 0) continue;
      // Strip parameter part: "FN;CHARSET=UTF-8" → "FN"
      const propName = line.slice(0, ci).split(";")[0].toUpperCase();
      const value = line
        .slice(ci + 1)
        .replace(/\\n/g, " ")
        .replace(/\\,/g, ",")
        .replace(/\\;/g, ";")
        .replace(/\\\\/g, "\\")
        .trim();
      if (!props.has(propName)) props.set(propName, value);
    }

    const fn = props.get("FN") ?? "";
    const nRaw = props.get("N") ?? "";
    const nickname = props.get("NICKNAME") ?? "";

    let name = fn;
    if (!name && nRaw) {
      // N format: Last;First;Middle;Prefix;Suffix
      const [last = "", first = "", middle = ""] = nRaw.split(";").map((s) => s.trim());
      name = [first, middle, last].filter(Boolean).join(" ");
    }

    if (!name) {
      out.errors.push(`Contact ${idx}: no name found — skipped`);
      continue;
    }

    const aliases = nickname
      ? nickname.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;

    out.contacts.push({
      draft: { name, ...(aliases?.length ? { aliases } : {}) },
      sourceRow: idx,
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// CSV parser
// ---------------------------------------------------------------------------

function parseCsv(text: string): ContactParseResult {
  const out: ContactParseResult = { contacts: [], errors: [] };
  const rows = csvRows(text);

  if (!rows.length) {
    out.errors.push("No rows found in CSV");
    return out;
  }

  // Detect column strategy from headers of the first row
  const headers = Object.keys(rows[0].row);
  const hl = headers.map((h) => h.toLowerCase());

  // Google Contacts: has both First Name and Last Name
  const hasFirstLast =
    hl.includes("first name") && hl.includes("last name");

  // Generic: has a Name or Full Name column
  const nameCol =
    headers.find((h) => h.toLowerCase() === "name") ??
    headers.find((h) => h.toLowerCase() === "full name") ??
    headers.find((h) => h.toLowerCase() === "display name");

  if (!hasFirstLast && !nameCol) {
    out.errors.push(
      'Could not find a name column. Expected "Name", "Full Name", or "First Name" + "Last Name" columns.',
    );
    return out;
  }

  const firstCol = headers.find((h) => h.toLowerCase() === "first name");
  const lastCol = headers.find((h) => h.toLowerCase() === "last name");
  const nickCol = headers.find((h) => h.toLowerCase() === "nickname");

  rows.forEach(({ row: r, sourceRow }) => {
    let name = "";

    if (hasFirstLast) {
      const first = (r[firstCol!] ?? "").trim();
      const last = (r[lastCol!] ?? "").trim();
      name = [first, last].filter(Boolean).join(" ");
    } else if (nameCol) {
      name = (r[nameCol] ?? "").trim();
    }

    if (!name) return; // blank row — skip silently

    const nick = nickCol ? (r[nickCol] ?? "").trim() : "";
    const aliases = nick
      ? nick.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;

    out.contacts.push({
      draft: { name, ...(aliases?.length ? { aliases } : {}) },
      sourceRow,
    });
  });

  return out;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Parse a contacts file into a list of Person drafts.
 * Auto-detects vCard vs CSV from filename and content.
 */
export function parseContacts(filename: string, text: string): ContactParseResult {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".vcf") || lower.endsWith(".vcard") || /BEGIN:VCARD/i.test(text.slice(0, 200))) {
    return parseVCard(text);
  }
  return parseCsv(text);
}
