import {
  optionProductConfig,
  type OptionProduct,
  type OptionScope,
  type OptionsChainDetail,
  type OptionsChainResponse,
  type OptionsChainRow,
} from "@/api/options";

/**
 * 09 期权链下钻面板的输入契约。
 * BoardView 用自动查询（最小 DTE）建默认 model；面板内切换到期后用自己的查询结果重建。
 * data 为 undefined 表示快照缺失（404 / 加载中）——面板走空态，不造假数据。
 */
export interface OptionsChainModel {
  product: OptionProduct;
  tickSize: number;
  scope?: OptionScope;
  /** BoardView 自动查询（最小 DTE）结果；面板内切换到期后以面板自己的查询为准 */
  data?: OptionsChainResponse;
}

export function buildOptionsChainModel(
  product: OptionProduct,
  data?: OptionsChainResponse,
  scope?: OptionScope,
): OptionsChainModel {
  return { product, tickSize: optionProductConfig[product].tickSize, data, scope };
}

export type ChainSortKey = "strike" | "callOi" | "putOi" | "absGex";

export const CHAIN_SORT_TABS: Array<{ value: ChainSortKey; label: string }> = [
  { value: "strike", label: "行权价" },
  { value: "callOi", label: "Call OI" },
  { value: "putOi", label: "Put OI" },
  { value: "absGex", label: "|GEX|" },
];

function sortMetric(row: OptionsChainRow, sort: Exclude<ChainSortKey, "strike">): number {
  if (sort === "callOi") return row.call?.oi ?? -1;
  if (sort === "putOi") return row.put?.oi ?? -1;
  return Math.abs(row.call?.gex ?? 0) + Math.abs(row.put?.gex ?? 0);
}

/** 排序只换阅读顺序：指标序降序、缺失沉底；行权价序高档在上（同 08 GEX 面板方向）。 */
export function sortChainRows(rows: OptionsChainRow[], sort: ChainSortKey): OptionsChainRow[] {
  const sorted = [...rows];
  if (sort === "strike") return sorted.sort((a, b) => b.strike - a.strike);
  return sorted.sort(
    (a, b) => sortMetric(b, sort) - sortMetric(a, sort) || b.strike - a.strike,
  );
}

const MIN_WINDOW_ROWS = 15;
const MAX_WINDOW_ROWS = 25;

/**
 * ATM 窗口（输入为行权价升序）：优先按 expected_move 上下界圈档，缺 EM 退回 ±5%。
 * 圈出的档数不足 MIN_WINDOW_ROWS 时以 ATM 为中心向两侧扩；
 * 超过 MAX_WINDOW_ROWS 时以 ATM 为中心截断。总档数不足窗口下限则全量返回。
 */
export function sliceAtmWindow(
  rowsAsc: OptionsChainRow[],
  spot: number,
  expectedMoveLower?: number | null,
  expectedMoveUpper?: number | null,
): OptionsChainRow[] {
  if (rowsAsc.length <= MAX_WINDOW_ROWS) return rowsAsc;

  const atmIndex = rowsAsc.reduce(
    (best, row, index) =>
      Math.abs(row.strike - spot) < Math.abs(rowsAsc[best]!.strike - spot) ? index : best,
    0,
  );

  const lower = expectedMoveLower ?? spot * 0.95;
  const upper = expectedMoveUpper ?? spot * 1.05;
  let start = rowsAsc.findIndex((row) => row.strike >= lower);
  if (start === -1) start = rowsAsc.length;
  let end = rowsAsc.findIndex((row) => row.strike > upper);
  if (end === -1) end = rowsAsc.length;

  if (end - start < MIN_WINDOW_ROWS) {
    const half = Math.floor(MIN_WINDOW_ROWS / 2);
    start = Math.max(0, atmIndex - half);
    end = Math.min(rowsAsc.length, start + MIN_WINDOW_ROWS);
    start = Math.max(0, end - MIN_WINDOW_ROWS);
  }
  if (end - start > MAX_WINDOW_ROWS) {
    const half = Math.floor(MAX_WINDOW_ROWS / 2);
    start = Math.max(0, Math.min(atmIndex - half, rowsAsc.length - MAX_WINDOW_ROWS));
    end = start + MAX_WINDOW_ROWS;
  }
  return rowsAsc.slice(start, end);
}

export type ChainMark = "atm" | "callWall" | "putWall" | "keyGamma" | "maxPain";

/**
 * 每个执行价命中哪些标注（输入为行权价升序）。
 * 标注价位对不齐档位时吸附最近档，容差半个最小档距，超出不标；
 * gamma_flip 可落在两档之间，由面板画虚线行，不在此吸附。
 */
export function buildChainMarks(
  rowsAsc: OptionsChainRow[],
  chain: OptionsChainDetail,
): Map<number, ChainMark[]> {
  const marks = new Map<number, ChainMark[]>();
  if (rowsAsc.length === 0) return marks;

  let gap = Number.POSITIVE_INFINITY;
  for (let i = 1; i < rowsAsc.length; i += 1) {
    gap = Math.min(gap, rowsAsc[i]!.strike - rowsAsc[i - 1]!.strike);
  }
  if (!Number.isFinite(gap) || gap <= 0) gap = 5;
  const tolerance = gap * 0.51;

  const snap = (level: number | null): number | undefined => {
    if (level === null) return undefined;
    let best: OptionsChainRow | undefined;
    for (const row of rowsAsc) {
      if (!best || Math.abs(row.strike - level) < Math.abs(best.strike - level)) best = row;
    }
    return best && Math.abs(best.strike - level) <= tolerance ? best.strike : undefined;
  };
  const add = (strike: number | undefined, mark: ChainMark) => {
    if (strike === undefined) return;
    const list = marks.get(strike) ?? [];
    list.push(mark);
    marks.set(strike, list);
  };

  add(snap(chain.underlying_price), "atm");
  add(snap(chain.call_wall), "callWall");
  add(snap(chain.put_wall), "putWall");
  add(snap(chain.key_gamma_strike), "keyGamma");
  add(snap(chain.max_pain), "maxPain");
  return marks;
}
