/** Map one real price tick through the active price scale; retain one pixel at minimum. */
export function profileBinHeight(
  strike: number,
  tickSize: number,
  priceToCoordinate: (price: number) => number | null,
): number {
  if (!Number.isFinite(strike) || !Number.isFinite(tickSize) || tickSize <= 0) return 1;
  const upper = priceToCoordinate(strike + tickSize / 2);
  const lower = priceToCoordinate(strike - tickSize / 2);
  return upper === null || lower === null ? 1 : Math.max(1, Math.abs(lower - upper));
}
