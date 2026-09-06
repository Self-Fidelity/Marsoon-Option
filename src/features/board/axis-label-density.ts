/** Return evenly distributed label indices, always retaining both axis ends. */
export function adaptiveLabelIndices(
  itemCount: number,
  availablePx: number,
  minSpacingPx: number,
  maxLabels = Number.POSITIVE_INFINITY,
): number[] {
  if (itemCount <= 0) return [];
  if (itemCount === 1) return [0];
  const byWidth = Math.max(2, Math.floor(Math.max(0, availablePx) / Math.max(1, minSpacingPx)) + 1);
  const count = Math.max(2, Math.min(itemCount, maxLabels, byWidth));
  return [...new Set(Array.from({ length: count }, (_, index) =>
    Math.round((index / (count - 1)) * (itemCount - 1)),
  ))];
}
