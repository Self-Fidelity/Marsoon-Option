export interface StrikeViewport { lo: number; hi: number }

export function clampStrikeViewport(
  viewport: StrikeViewport,
  full: StrikeViewport,
  minimumSpan: number,
): StrikeViewport {
  const fullSpan = Math.max(0, full.hi - full.lo);
  if (fullSpan <= 0) return { ...full };
  const span = Math.min(fullSpan, Math.max(minimumSpan, viewport.hi - viewport.lo));
  let lo = viewport.lo;
  if (lo < full.lo) lo = full.lo;
  if (lo + span > full.hi) lo = full.hi - span;
  return { lo, hi: lo + span };
}

export function zoomStrikeViewport(
  viewport: StrikeViewport,
  full: StrikeViewport,
  anchor: number,
  wheelDelta: number,
  minimumSpan: number,
): StrikeViewport {
  const span = Math.max(minimumSpan, viewport.hi - viewport.lo);
  const ratio = Math.max(0, Math.min(1, (anchor - viewport.lo) / span));
  const nextSpan = span * Math.exp(wheelDelta * 0.0015);
  return clampStrikeViewport({ lo: anchor - nextSpan * ratio, hi: anchor + nextSpan * (1 - ratio) }, full, minimumSpan);
}

export function panStrikeViewport(
  viewport: StrikeViewport,
  full: StrikeViewport,
  deltaFraction: number,
  minimumSpan: number,
): StrikeViewport {
  const delta = (viewport.hi - viewport.lo) * deltaFraction;
  return clampStrikeViewport({ lo: viewport.lo + delta, hi: viewport.hi + delta }, full, minimumSpan);
}

/** 首屏落在现货附近可读档数；档数不多时直接展示全链。 */
export function defaultStrikeViewport(
  full: StrikeViewport,
  spot: number | undefined,
  step: number,
  minimumSpan: number,
  visibleSteps = 24,
): StrikeViewport {
  const preferredSpan = Math.max(minimumSpan, step * visibleSteps);
  if (!Number.isFinite(spot) || full.hi - full.lo <= preferredSpan * 1.1) {
    return clampStrikeViewport(full, full, minimumSpan);
  }
  return clampStrikeViewport(
    { lo: (spot as number) - preferredSpan / 2, hi: (spot as number) + preferredSpan / 2 },
    full,
    minimumSpan,
  );
}
