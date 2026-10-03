import { sourceIconPath } from "@/lib/journal/connectors/icons";
import { cn } from "@/lib/utils";

/** Quiet monochrome source mark; renders nothing for sources without one. */
export function SourceIcon({ source, className }: { source: string; className?: string }) {
  const d = sourceIconPath(source);
  if (!d) return null;
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" className={cn("inline-block h-2.5 w-2.5 shrink-0 opacity-60", className)}>
      <path d={d} />
    </svg>
  );
}
