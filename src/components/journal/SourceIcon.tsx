import { sourceIconPath, sourceColor } from "@/lib/journal/connectors/icons";
import { cn } from "@/lib/utils";

/**
 * Source mark as a small brand-tinted badge: glyph in the source's muted brand
 * hue on a faint tinted chip. Renders nothing for sources without a mark.
 */
export function SourceIcon({ source, className }: { source: string; className?: string }) {
  const d = sourceIconPath(source);
  const color = sourceColor(source);
  if (!d) return null;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px]",
        className,
      )}
      style={{ backgroundColor: `${color}26`, color }}
    >
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
        <path d={d} />
      </svg>
    </span>
  );
}
