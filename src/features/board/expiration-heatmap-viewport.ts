export function nearbyStrikeWindow(strikes: number[], spot: number | undefined, radius = 40): number[] {
  if (spot === undefined || !Number.isFinite(spot) || strikes.length <= radius * 2 + 1) return strikes;
  let nearest = 0;
  for (let index = 1; index < strikes.length; index++) {
    if (Math.abs(strikes[index]! - spot) < Math.abs(strikes[nearest]! - spot)) nearest = index;
  }
  const size = radius * 2 + 1;
  const start = Math.max(0, Math.min(strikes.length - size, nearest - radius));
  return strikes.slice(start, start + size);
}

export function virtualRowWindow(
  total: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  headerHeight: number,
  overscan = 10,
) {
  if (total <= 0) return { start: 0, end: 0, top: 0, bottom: 0 };
  const first = Math.max(0, Math.floor(Math.max(0, scrollTop - headerHeight) / rowHeight));
  const visible = Math.max(1, Math.ceil(Math.max(rowHeight, viewportHeight - headerHeight) / rowHeight));
  const start = Math.max(0, first - overscan);
  const end = Math.min(total, first + visible + overscan);
  return { start, end, top: start * rowHeight, bottom: (total - end) * rowHeight };
}
