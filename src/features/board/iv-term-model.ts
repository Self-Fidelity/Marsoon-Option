import type { IvTermPoint, IvTermResponse } from "@/api/options";

export type IvTermAxis = "date" | "dte";
export function ivTermX(point: IvTermPoint, snapshot: number, axis: IvTermAxis) {
  return axis === "date" ? point.expiration / 86400 : (point.expiration - snapshot) / 86400;
}
export function ivTermGroups(data: IvTermResponse) {
  const groups = new Map<string, IvTermPoint[]>();
  for (const point of data.points) {
    const group = groups.get(point.underlying_symbol) ?? [];
    group.push(point); groups.set(point.underlying_symbol, group);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([symbol, points]) => ({ symbol, points: points.sort((a, b) => a.expiration - b.expiration) }));
}
export function ivTermPaths(points: IvTermPoint[], x: (p: IvTermPoint) => number, y: (iv: number) => number) {
  const paths: string[] = []; let path = "";
  for (const p of points) {
    if (p.atm_iv === null || !Number.isFinite(p.atm_iv) || p.atm_iv <= 0) { if (path) paths.push(path); path = ""; continue; }
    path += `${path ? " L" : "M"}${x(p)},${y(p.atm_iv)}`;
  }
  if (path) paths.push(path);
  return paths;
}
