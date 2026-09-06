/**
 * Black-76 期货期权定价引擎：由链上 bid/ask 中价反推 IV，再算逐档 gamma/GEX。
 * 免费数据源不提供 Greeks（Barchart 期货期权 delta/gamma 全 0 占位），必须自算。
 *
 * 口径：GEX = OI × gamma × F² × multiplier × 1%（现货 1% 变动的美元敞口，call 正 put 负）。
 *
 * v2：analyzeChain 改为显式 T（到期日由采集器按 serie 类型推断：weekly 按星期几
 * 匹配 expirations、monthly 按合约月），引擎不再猜测到期。
 */

import type { BarchartChainRow } from "./barchart-store";

const SQRT_2PI = Math.sqrt(2 * Math.PI);
const RISK_FREE = 0.04; // 常数无风险利率，MVP 精度足够

function nPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / SQRT_2PI;
}

/** Abramowitz-Stegun 7 位精度 erf 近似 */
function nCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * ax);
  const erf =
    sign *
    (1 -
      (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
        0.254829592) *
        t) *
        Math.exp(-ax * ax));
  return 0.5 * (1 + erf);
}

export function b76Price(
  F: number,
  K: number,
  T: number,
  sigma: number,
  isCall: boolean,
  r = RISK_FREE,
): number {
  const intrinsic = Math.max(isCall ? F - K : K - F, 0);
  if (T <= 0 || sigma <= 0 || F <= 0 || K <= 0) return intrinsic;
  const volSqrtT = sigma * Math.sqrt(T);
  const d1 = (Math.log(F / K) + 0.5 * sigma * sigma * T) / volSqrtT;
  const d2 = d1 - volSqrtT;
  const df = Math.exp(-r * T);
  return isCall
    ? df * (F * nCdf(d1) - K * nCdf(d2))
    : df * (K * nCdf(-d2) - F * nCdf(-d1));
}

/** 二分反推 IV；价格低于内在价值或超出上界时返回 null */
export function b76ImpliedVol(
  F: number,
  K: number,
  T: number,
  price: number,
  isCall: boolean,
): number | null {
  const intrinsic = Math.max(isCall ? F - K : K - F, 0) * Math.exp(-RISK_FREE * T);
  if (!(price > intrinsic + 1e-9) || T <= 0) return null;
  let lo = 0.0001;
  let hi = 5;
  if (b76Price(F, K, T, hi, isCall) < price) return null;
  for (let i = 0; i < 64; i++) {
    const mid = (lo + hi) / 2;
    if (b76Price(F, K, T, mid, isCall) > price) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

export function b76Gamma(
  F: number,
  K: number,
  T: number,
  sigma: number,
  r = RISK_FREE,
): number {
  if (T <= 0 || sigma <= 0 || F <= 0 || K <= 0) return 0;
  const d1 = (Math.log(F / K) + 0.5 * sigma * sigma * T) / (sigma * Math.sqrt(T));
  return (Math.exp(-r * T) * nPdf(d1)) / (F * sigma * Math.sqrt(T));
}

/** Black-76 delta：call = e^(-rT)·N(d1)，put = -e^(-rT)·N(-d1) */
export function b76Delta(
  F: number,
  K: number,
  T: number,
  sigma: number,
  isCall: boolean,
  r = RISK_FREE,
): number {
  if (T <= 0 || sigma <= 0 || F <= 0 || K <= 0) {
    const itm = isCall ? F > K : K > F;
    return itm ? (isCall ? 1 : -1) : 0;
  }
  const d1 = (Math.log(F / K) + 0.5 * sigma * sigma * T) / (sigma * Math.sqrt(T));
  const df = Math.exp(-r * T);
  return isCall ? df * nCdf(d1) : -df * nCdf(-d1);
}

/** Black-76 vega（原始口径：每 1.00 波动率，展示层 ÷100 得每 1 vol pt） */
export function b76Vega(
  F: number,
  K: number,
  T: number,
  sigma: number,
  r = RISK_FREE,
): number {
  if (T <= 0 || sigma <= 0 || F <= 0 || K <= 0) return 0;
  const d1 = (Math.log(F / K) + 0.5 * sigma * sigma * T) / (sigma * Math.sqrt(T));
  return F * Math.exp(-r * T) * nPdf(d1) * Math.sqrt(T);
}

/**
 * Black-76 theta（原始口径：每年，展示层 ÷365 得每日时间损耗）。
 * call = −F·e^(−rT)·n'(d1)·σ/(2√T) + r·e^(−rT)·(F·N(d1) − K·N(d2))
 * put  = −F·e^(−rT)·n'(d1)·σ/(2√T) + r·e^(−rT)·(K·N(−d2) − F·N(−d1))
 * （即 decay + r·理论价，Call/Put 同式；ATM 处两侧 theta 相等，满足看跌看涨平价）
 */
export function b76Theta(
  F: number,
  K: number,
  T: number,
  sigma: number,
  isCall: boolean,
  r = RISK_FREE,
): number {
  if (T <= 0 || sigma <= 0 || F <= 0 || K <= 0) return 0;
  const volSqrtT = sigma * Math.sqrt(T);
  const d1 = (Math.log(F / K) + 0.5 * sigma * sigma * T) / volSqrtT;
  const d2 = d1 - volSqrtT;
  const df = Math.exp(-r * T);
  const decay = -(F * df * nPdf(d1) * sigma) / (2 * Math.sqrt(T));
  return isCall
    ? decay + r * df * (F * nCdf(d1) - K * nCdf(d2))
    : decay + r * df * (K * nCdf(-d2) - F * nCdf(-d1));
}

export interface ChainAnalyticsRow extends BarchartChainRow {
  mid: number | null;
  iv: number | null;
  gamma: number;
  delta: number;
  /** 原始口径：每年（展示层 ÷365） */
  theta: number;
  /** 原始口径：每 1.00 波动率（展示层 ÷100） */
  vega: number;
  gex: number;
  ivFallback: boolean;
}

export interface ChainAnalytics {
  rows: ChainAnalyticsRow[];
  daysToExpiration: number;
  atmIv: number | null;
  callWall: number | null;
  putWall: number | null;
  gammaFlip: number | null;
  netGex: number;
  grossGex: number;
  callOi: number;
  putOi: number;
  expectedMove: number | null;
}

/**
 * flip 扫描区间：按逐档 |GEX| 累积份额取 0.5%~99.5% 的范围。
 * 链里存在 100~10100 全跨度的"尘埃档"（OI 极小但非零），用全档位区间
 * 扫描会在无持仓区误捕浮点粉尘变号（曾把 0DTE flip 算到 162.5）。
 */
function gexScanRange(absByStrike: Array<[number, number]>, F: number): [number, number] {
  const ordered = [...absByStrike].sort((a, b) => a[0] - b[0]);
  const total = ordered.reduce((a, [, v]) => a + v, 0);
  if (ordered.length > 1 && total > 0) {
    let cum = 0;
    let lo = ordered[0]![0];
    let hi = ordered.at(-1)![0];
    let loSet = false;
    for (const [k, v] of ordered) {
      cum += v;
      if (!loSet && cum >= total * 0.005) {
        lo = k;
        loSet = true;
      }
      if (cum >= total * 0.995) {
        hi = k;
        break;
      }
    }
    if (hi > lo) return [lo, hi];
  }
  return [F * 0.9, F * 1.1];
}

/**
 * 全链计算：逐档 IV（mid 失效时回退 ATM IV）、gamma/delta、GEX、墙、翻转位。
 * gammaFlip 用精确口径：扫描候选 spot，重算全链 gamma，取净 GEX 变号点。
 *
 * @param chain 单 serie 的链
 * @param F     标的价格（期货现价）
 * @param daysToExpiration 该 serie 的 DTE（采集器推断）；0DTE 时按 0.35 天近似
 */
export function analyzeChain(
  chain: BarchartChainRow[],
  F: number,
  daysToExpiration: number,
  multiplier: number,
): ChainAnalytics | null {
  if (!(F > 0) || chain.length === 0) return null;
  const T = Math.max(daysToExpiration, 0.35) / 365;

  // 逐档 mid
  const withMid = chain.map((row) => {
    const mid =
      row.bid !== null && row.ask !== null && row.bid > 0 && row.ask > 0
        ? (row.bid + row.ask) / 2
        : row.last !== null && row.last > 0
          ? row.last
          : null;
    return { row, mid };
  });

  // ATM IV：|K-F| 最小的 call/put 各反推一个，取均值
  const atmSorted = [...withMid]
    .filter((x) => x.mid !== null && x.row.oi !== null && x.row.oi > 0)
    .sort((a, b) => Math.abs(a.row.strike - F) - Math.abs(b.row.strike - F));
  const atmVols: number[] = [];
  for (const want of ["Call", "Put"] as const) {
    const cand = atmSorted.find((x) => x.row.optionType === want);
    if (cand && cand.mid !== null) {
      const iv = b76ImpliedVol(F, cand.row.strike, T, cand.mid, want === "Call");
      if (iv !== null && iv > 0.005 && iv < 3) atmVols.push(iv);
    }
  }
  const atmIv = atmVols.length
    ? atmVols.reduce((a, b) => a + b, 0) / atmVols.length
    : null;
  const baseIv = atmIv ?? 0.15; // 反推全灭时兜底，面板标 flag

  // 逐档 IV + gamma/delta/theta/vega + GEX
  const rows: ChainAnalyticsRow[] = withMid.map(({ row, mid }) => {
    let iv: number | null = null;
    if (mid !== null) {
      const got = b76ImpliedVol(F, row.strike, T, mid, row.optionType === "Call");
      if (got !== null && got > 0.005 && got < 3) iv = got;
    }
    const usedIv = iv ?? baseIv;
    const isCall = row.optionType === "Call";
    const gamma = b76Gamma(F, row.strike, T, usedIv);
    const delta = b76Delta(F, row.strike, T, usedIv, isCall);
    const theta = b76Theta(F, row.strike, T, usedIv, isCall);
    const vega = b76Vega(F, row.strike, T, usedIv);
    const sign = isCall ? 1 : -1;
    const gex = sign * (row.oi ?? 0) * gamma * F * F * multiplier * 0.01;
    return { ...row, mid, iv, gamma, delta, theta, vega, gex, ivFallback: iv === null };
  });

  const calls = rows.filter((r) => r.optionType === "Call");
  const puts = rows.filter((r) => r.optionType === "Put");
  const callOi = calls.reduce((a, r) => a + (r.oi ?? 0), 0);
  const putOi = puts.reduce((a, r) => a + (r.oi ?? 0), 0);
  const netGex = rows.reduce((a, r) => a + r.gex, 0);
  const grossGex = rows.reduce((a, r) => a + Math.abs(r.gex), 0);

  // 墙：OI 加权 gamma 敞口最大的档位（业界口径）
  const callWall = calls.length
    ? calls.reduce((a, b) => (b.gex > a.gex ? b : a)).strike
    : null;
  const putWall = puts.length
    ? puts.reduce((a, b) => (b.gex < a.gex ? b : a)).strike
    : null;

  // gamma flip：候选 spot 扫描，净 gamma 变号点（线性插值）。
  // 取"距现货最近"的变号点，而非区间低端第一个——低端先扫会捕到远离盘面的
  // 深虚值区变号（曾把 GC 0DTE flip 算到 call wall 之上）。
  let gammaFlip: number | null = null;
  const absMap = new Map<number, number>();
  for (const r of rows) {
    absMap.set(r.strike, (absMap.get(r.strike) ?? 0) + Math.abs(r.gex));
  }
  const [kMin, kMax] = gexScanRange([...absMap.entries()], F);
  const netGammaAt = (S: number) =>
    rows.reduce(
      (a, r) =>
        a +
        (r.optionType === "Call" ? 1 : -1) *
          (r.oi ?? 0) *
          b76Gamma(S, r.strike, T, r.iv ?? baseIv),
      0,
    );
  const steps = 160;
  let prevS = kMin;
  let prevG = netGammaAt(kMin);
  let bestFlip: number | null = null;
  for (let i = 1; i <= steps; i++) {
    const S = kMin + ((kMax - kMin) * i) / steps;
    const G = netGammaAt(S);
    if (prevG === 0 || G === 0 || prevG > 0 !== G > 0) {
      const flip = prevG === G ? S : prevS + ((S - prevS) * prevG) / (prevG - G);
      if (bestFlip === null || Math.abs(flip - F) < Math.abs(bestFlip - F)) bestFlip = flip;
    }
    prevS = S;
    prevG = G;
  }
  gammaFlip = bestFlip;

  const expectedMove = atmIv !== null ? F * atmIv * Math.sqrt(T) : null;

  return {
    rows,
    daysToExpiration,
    atmIv,
    callWall,
    putWall,
    gammaFlip,
    netGex,
    grossGex,
    callOi,
    putOi,
    expectedMove,
  };
}

/**
 * 多 serie 聚合：把多个 ChainAnalytics 合并为"全到期"口径
 * （walls 取极值档、GEX 求和、flip 按聚合后净 gamma 重扫）。
 *
 * parts[].F = 该 serie 的标的期货价（serie 可能挂在非主合约上，如 GC 周期权→GCV26）。
 * flip 扫描在主合约价格空间进行，每个 serie 的 gamma 按 S×(partF/F) 折算回自己的标的空间。
 */
export function combineAnalytics(
  parts: Array<{ analytics: ChainAnalytics; expirationUnix: number; F?: number }>,
  F: number,
  multiplier: number,
): ChainAnalytics | null {
  if (parts.length === 0 || !(F > 0)) return null;
  const rows = parts.flatMap((p) => p.analytics.rows);
  const netGex = parts.reduce((a, p) => a + p.analytics.netGex, 0);
  const grossGex = parts.reduce((a, p) => a + p.analytics.grossGex, 0);
  const callOi = parts.reduce((a, p) => a + p.analytics.callOi, 0);
  const putOi = parts.reduce((a, p) => a + p.analytics.putOi, 0);

  // 按 strike 聚合（跨 serie 同档合并）
  const byStrike = new Map<number, { callGex: number; putGex: number; oiCall: number; oiPut: number }>();
  for (const r of rows) {
    const e = byStrike.get(r.strike) ?? { callGex: 0, putGex: 0, oiCall: 0, oiPut: 0 };
    if (r.optionType === "Call") {
      e.callGex += r.gex;
      e.oiCall += r.oi ?? 0;
    } else {
      e.putGex += r.gex;
      e.oiPut += r.oi ?? 0;
    }
    byStrike.set(r.strike, e);
  }
  let callWall: number | null = null;
  let putWall: number | null = null;
  for (const [strike, e] of byStrike) {
    if (callWall === null || e.callGex > (byStrike.get(callWall)?.callGex ?? -Infinity)) callWall = strike;
    if (putWall === null || e.putGex < (byStrike.get(putWall)?.putGex ?? Infinity)) putWall = strike;
  }

  // flip：用各 serie 自己的 T/IV 重算净 gamma 曲线（区间同样按 |GEX| 累积份额截取）
  const strikes = [...byStrike.keys()].sort((a, b) => a - b);
  let gammaFlip: number | null = null;
  if (strikes.length > 1) {
    const [kMin, kMax] = gexScanRange(
      [...byStrike.entries()].map(
        ([k, e]) => [k, Math.abs(e.callGex) + Math.abs(e.putGex)] as [number, number],
      ),
      F,
    );
    const netGammaAt = (S: number) =>
      parts.reduce(
        (acc, p) =>
          acc +
          p.analytics.rows.reduce(
            (a, r) =>
              a +
              (r.optionType === "Call" ? 1 : -1) *
                (r.oi ?? 0) *
                b76Gamma(
                  p.F && p.F > 0 ? S * (p.F / F) : S,
                  r.strike,
                  Math.max(p.analytics.daysToExpiration, 0.35) / 365,
                  r.iv ?? p.analytics.atmIv ?? 0.15,
                ),
            0,
          ),
        0,
      );
    const steps = 200;
    let prevS = kMin;
    let prevG = netGammaAt(kMin);
    let bestFlip: number | null = null; // 距现货最近的变号点（口径同 analyzeChain）
    for (let i = 1; i <= steps; i++) {
      const S = kMin + ((kMax - kMin) * i) / steps;
      const G = netGammaAt(S);
      if (prevG === 0 || G === 0 || prevG > 0 !== G > 0) {
        const flip = prevG === G ? S : prevS + ((S - prevS) * prevG) / (prevG - G);
        if (bestFlip === null || Math.abs(flip - F) < Math.abs(bestFlip - F)) bestFlip = flip;
      }
      prevS = S;
      prevG = G;
    }
    gammaFlip = bestFlip;
  }

  // ATM IV：DTE 最小的 serie 的 ATM IV（最具盘面代表性）
  const front = [...parts].sort(
    (a, b) => a.analytics.daysToExpiration - b.analytics.daysToExpiration,
  )[0]!;
  const expectedMove =
    front.analytics.atmIv !== null
      ? F * front.analytics.atmIv * Math.sqrt(Math.max(front.analytics.daysToExpiration, 0.35) / 365)
      : null;

  return {
    rows,
    daysToExpiration: front.analytics.daysToExpiration,
    atmIv: front.analytics.atmIv,
    callWall,
    putWall,
    gammaFlip,
    netGex,
    grossGex,
    callOi,
    putOi,
    expectedMove,
  };
}
