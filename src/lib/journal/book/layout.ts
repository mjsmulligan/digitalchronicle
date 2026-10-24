/** Page geometry shared by the PDF renderer and the on-device spike. */
import type { PageSize } from "./types";

/** printToFileAsync takes width and height in pixels at 72 PPI, which is points. */
export const PAGE_PX: Record<PageSize, { width: number; height: number }> = {
  A4: { width: 595, height: 842 },
  A5: { width: 420, height: 595 },
};

/** Page margins in points. */
export const MARGIN_X_PT = 45; // 16 mm
export const MARGIN_TOP_PT = 51; // 18 mm
export const MARGIN_BOTTOM_PT = 57; // 20 mm

/** Pixel width to resample a full-width photo to for 150 ppi at the placed size. */
export function photoTargetWidthPx(pageSize: PageSize, ppi = 150): number {
  const contentPt = PAGE_PX[pageSize].width - 2 * MARGIN_X_PT;
  return Math.round((contentPt / 72) * ppi);
}
