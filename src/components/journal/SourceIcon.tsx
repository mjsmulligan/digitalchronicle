import { sourceMark } from "@/lib/journal/connectors/icons";
import { cn } from "@/lib/utils";

/**
 * Source mark as a small brand-tinted badge.
 *
 * Two visual variants driven by `SourceMarkDef.type`:
 *   "path"  — SVG glyph in the brand hue on a 15 % tinted background.
 *   "text"  — Short operator label (IATA code / initials) on a solid brand
 *             background. Used for airlines and train operators.
 *
 * Renders nothing for sources without a registered mark.
 */
export function SourceIcon({ source, className }: { source: string; className?: string }) {
  const mark = sourceMark(source);
  if (!mark) return null;

  if (mark.type === "path") {
    const isSolid = mark.style === "solid";
    return (
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px]",
          className,
        )}
        style={{
          backgroundColor: isSolid ? mark.color : `${mark.color}26`,
          color: isSolid ? "#ffffff" : mark.color,
        }}
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
          <path d={mark.d} />
        </svg>
      </span>
    );
  }

  // TextMark — solid chip with operator label
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px]",
        className,
      )}
      style={{ backgroundColor: mark.bg, color: mark.fg }}
    >
      <span
        style={{
          fontSize: mark.label.length <= 2 ? "7px" : "5.5px",
          fontWeight: 700,
          letterSpacing: "-0.2px",
          lineHeight: 1,
          fontFamily: "monospace",
        }}
      >
        {mark.label}
      </span>
    </span>
  );
}
