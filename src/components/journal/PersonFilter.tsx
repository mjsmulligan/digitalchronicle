import { type Person } from "@/lib/journal/types";
import { cn } from "@/lib/utils";

interface PersonFilterProps {
  people: Person[];
  value: string | null;
  onChange: (id: string | null) => void;
}

/**
 * A row of avatar pills for filtering entries by participant.
 * Renders nothing when no people are set up.
 */
export function PersonFilter({ people, value, onChange }: PersonFilterProps) {
  if (people.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      <button
        type="button"
        onClick={() => onChange(null)}
        className={cn(
          "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
          value === null
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground hover:bg-muted/80",
        )}
      >
        Everyone
      </button>
      {people.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onChange(value === p.id ? null : p.id)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
            value === p.id
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:bg-muted/80",
          )}
        >
          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-current/20 text-[9px] font-bold leading-none">
            {p.name.charAt(0).toUpperCase()}
          </span>
          {p.name}
          {p.isSelf && <span className="opacity-60">you</span>}
        </button>
      ))}
    </div>
  );
}
