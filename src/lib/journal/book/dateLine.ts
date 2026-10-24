/** Plain-text form of a dateLine block, shared by the Markdown and PDF renderers. */
import { formatDay } from "./blocks";
import type { Block } from "./types";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * "4 Jan 2026, 14:30 · Day 3 of the journey", "December 2010", "2010".
 * Undefined when nothing should print.
 */
export function dateLineText(b: Extract<Block, { type: "dateLine" }>): string | undefined {
  if (b.precision === "unknown") return b.label;
  let text: string;
  if (b.precision === "year") {
    text = b.date.slice(0, 4);
  } else if (b.precision === "month") {
    text = `${MONTH_NAMES[Number(b.date.slice(5, 7)) - 1]} ${b.date.slice(0, 4)}`;
  } else {
    text = formatDay(b.date);
    if (b.endDate && b.endDate !== b.date) text += ` to ${formatDay(b.endDate)}`;
    if (b.time) text += `, ${b.time}`;
  }
  return b.label ? `${text} · ${b.label}` : text;
}
