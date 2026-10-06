import { useState } from "react";
import { Star, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

interface StarRatingProps {
  /** Normalised 0–10 value. Undefined = unrated. */
  rating: number | undefined;
  className?: string;
  /**
   * When provided, the component becomes an interactive editor.
   * Clicking a star position sets the rating; clicking the current rating clears it.
   */
  onChange?: (rating: number | undefined) => void;
  /** When true, stars are read-only regardless of onChange. */
  locked?: boolean;
}

/** Star display (read-only half-star precision). */
function StarDisplay({ rating, className }: { rating: number; className?: string }) {
  const stars = rating / 2; // 0–10 → 0–5
  const full = Math.floor(stars);
  const half = stars - full >= 0.5;
  const empty = 5 - full - (half ? 1 : 0);

  return (
    <span
      className={cn("inline-flex items-center gap-px", className)}
      aria-label={`${stars.toFixed(1)} out of 5 stars`}
    >
      {Array.from({ length: full }).map((_, i) => (
        <Star key={`f${i}`} className="h-3 w-3 fill-amber-400 text-amber-400" />
      ))}
      {half && (
        <span className="relative inline-block h-3 w-3">
          <Star className="absolute h-3 w-3 text-amber-400" />
          <span className="absolute inset-0 overflow-hidden w-[50%]">
            <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
          </span>
        </span>
      )}
      {Array.from({ length: empty }).map((_, i) => (
        <Star key={`e${i}`} className="h-3 w-3 text-muted-foreground/30" />
      ))}
    </span>
  );
}

/**
 * StarRating — display-only or interactive 0–10 rating widget (5-star UI).
 *
 * Interactive mode: pass `onChange`. Each star position covers 2 full-star
 * values (left half = 0.5 increments, right half = 1.0 increments) giving
 * 10 clickable positions across 5 stars. Clicking the currently-set star
 * position clears the rating.
 *
 * Locked mode: pass `locked`. Renders a read-only view with a lock icon.
 */
export function StarRating({ rating, className, onChange, locked }: StarRatingProps) {
  const [hover, setHover] = useState<number | undefined>(undefined);

  const interactive = !!onChange && !locked;
  const displayRating = hover ?? rating;

  if (!interactive) {
    // Display-only: render nothing when unrated, or show stars + optional lock
    if (rating === undefined) return null;
    return (
      <span className={cn("inline-flex items-center gap-1", className)}>
        <StarDisplay rating={rating} />
        {locked && <Lock className="h-2.5 w-2.5 text-muted-foreground/60" />}
      </span>
    );
  }

  // Interactive mode: 5 stars, each split into two hover zones (left = n-0.5, right = n)
  // for 10 half-step values. We render 5 star buttons.
  function valueForStar(starIdx: number, half: boolean): number {
    // starIdx 0-4, half = left half of the star
    return half ? (starIdx) * 2 + 1 : (starIdx + 1) * 2;
    // Maps to 1,2,3,4,5,6,7,8,9,10 (i.e. 0.5–5.0 on display)
  }

  function handleClick(value: number) {
    // Clicking the already-set value clears the rating
    if (rating === value) {
      onChange(undefined);
    } else {
      onChange(value);
    }
  }

  const filledUpTo = displayRating !== undefined ? displayRating / 2 : 0; // 0–5

  return (
    <span
      className={cn("inline-flex items-center gap-px", className)}
      aria-label={rating !== undefined ? `${(rating / 2).toFixed(1)} out of 5 — click to change` : "Not rated — click to rate"}
      onMouseLeave={() => setHover(undefined)}
    >
      {Array.from({ length: 5 }).map((_, i) => {
        const isFull = filledUpTo >= i + 1;
        const isHalf = !isFull && filledUpTo > i && filledUpTo < i + 1;
        return (
          <span
            key={i}
            className="relative inline-block h-4 w-4 cursor-pointer"
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const leftHalf = e.clientX - rect.left < rect.width / 2;
              setHover(valueForStar(i, leftHalf));
            }}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const leftHalf = e.clientX - rect.left < rect.width / 2;
              handleClick(valueForStar(i, leftHalf));
            }}
          >
            {/* Background (empty) star */}
            <Star className="absolute h-4 w-4 text-muted-foreground/30" />
            {/* Filled overlay */}
            {(isFull || isHalf) && (
              <span
                className={cn(
                  "absolute inset-0 overflow-hidden",
                  isHalf && "w-[50%]",
                )}
              >
                <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
              </span>
            )}
          </span>
        );
      })}
      {rating !== undefined && (
        <span className="ml-1 font-mono text-[10px] text-muted-foreground">
          {(rating / 2).toFixed(1)}
        </span>
      )}
    </span>
  );
}
