import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

interface StarRatingProps {
  /** Normalised 0–10 value. Undefined = unrated (renders nothing). */
  rating: number | undefined;
  className?: string;
}

/**
 * Renders a 5-star display from a 0–10 normalised rating.
 * Supports half-star precision. Unrated entries render nothing.
 */
export function StarRating({ rating, className }: StarRatingProps) {
  if (rating === undefined) return null;

  const stars = rating / 2; // 0–10 → 0–5
  const full = Math.floor(stars);
  const half = stars - full >= 0.5;
  const empty = 5 - full - (half ? 1 : 0);

  return (
    <span className={cn("inline-flex items-center gap-px", className)} aria-label={`${stars} out of 5 stars`}>
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
