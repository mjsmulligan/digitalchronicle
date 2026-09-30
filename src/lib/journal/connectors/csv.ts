/**
 * Shared CSV parsing helpers.
 * Moved verbatim from parsers.ts — no behaviour change.
 */

export function csvRows(
  text: string,
): { row: Record<string, string>; sourceRow: number }[] {
  const rows: { cells: string[]; line: number }[] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  let line = 1;
  let rowLine = 1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(cur);
      cur = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur);
      rows.push({ cells: row, line: rowLine });
      row = [];
      cur = "";
      rowLine = line + 1;
    } else cur += c;
    if (c === "\r" || (c === "\n" && text[i - 1] !== "\r")) line++;
  }
  if (cur || row.length) {
    row.push(cur);
    rows.push({ cells: row, line: rowLine });
  }
  const clean = rows.filter(({ cells }) => cells.some((c) => c.trim()));
  if (!clean.length) return [];
  const head = clean[0].cells.map((h) => h.replace(/^﻿/, "").trim());
  return clean.slice(1).map(({ cells, line }) => ({
    row: Object.fromEntries(head.map((h, i) => [h, (cells[i] ?? "").trim()])),
    sourceRow: line,
  }));
}

/** Parse CSV text into an array of header-keyed objects. */
export function parseCSV(text: string): Record<string, string>[] {
  return csvRows(text).map(({ row }) => row);
}
