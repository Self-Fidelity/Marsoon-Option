import {
  optionProductConfig,
  type OptionProduct,
  type OptionScope,
  type OptionsChainResponse,
  type OptionsChainRow,
  type OptionsChainSerieMeta,
  type OptionsChainSide,
  type OptionsDashboardResponse,
  type StrikeHeatmapCell,
} from "@/api/options";

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function emptySide(partial: Partial<OptionsChainSide> = {}): OptionsChainSide {
  return {
    bid: null,
    ask: null,
    last: null,
    mid: null,
    iv: null,
    delta: null,
    gamma: null,
    theta: null,
    vega: null,
    gex: null,
    oi: null,
    volume: null,
    prev_close: null,
    change: null,
    change_pct: null,
    is_settlement: false,
    iv_fallback: false,
    ...partial,
  };
}

function sideFromCell(cell: StrikeHeatmapCell, kind: "call" | "put"): OptionsChainSide {
  const iv = kind === "call" ? cell.call_iv : cell.put_iv;
  const oi = kind === "call" ? cell.call_oi : cell.put_oi;
  const volume = kind === "call" ? cell.call_vol : cell.put_vol;
  const gex = kind === "call" ? cell.call_gex : cell.put_gex;
  return emptySide({
    iv: finite(iv),
    oi: finite(oi) ?? 0,
    volume: finite(volume),
    gex: finite(gex) ?? 0,
  });
}

function wallFromLevels(
  levels: OptionsDashboardResponse["levels"] | undefined,
  metric: "call_wall" | "put_wall" | "gamma_flip",
): number | null {
  const aliases =
    metric === "call_wall"
      ? ["call_wall", "call_oi_wall", "call_gex_wall", "positive_gex_wall"]
      : metric === "put_wall"
        ? ["put_wall", "put_oi_wall", "put_gex_wall", "negative_gex_wall"]
        : ["gamma_flip", "zero_gamma"];
  const row = (levels ?? []).find(
    (level) => aliases.includes(level.metric ?? "") && (level.rank ?? 1) === 1,
  );
  return finite(row?.level ?? row?.strike ?? row?.value);
}

function maxPainStrike(rows: OptionsChainRow[]): number | null {
  const withOi = rows.map((row) => ({
    strike: row.strike,
    callOi: row.call?.oi ?? 0,
    putOi: row.put?.oi ?? 0,
  }));
  if (!withOi.some((row) => row.callOi > 0 || row.putOi > 0)) return null;
  let best = withOi[0]!.strike;
  let bestPain = Number.POSITIVE_INFINITY;
  for (const candidate of withOi) {
    let pain = 0;
    for (const row of withOi) {
      pain += row.callOi * Math.max(candidate.strike - row.strike, 0);
      pain += row.putOi * Math.max(row.strike - candidate.strike, 0);
    }
    if (pain < bestPain) {
      bestPain = pain;
      best = candidate.strike;
    }
  }
  return best;
}

function keyGammaStrike(rows: OptionsChainRow[]): number | null {
  let best: { strike: number; gross: number } | undefined;
  for (const row of rows) {
    const gross = Math.abs(row.call?.gex ?? 0) + Math.abs(row.put?.gex ?? 0);
    if (!best || gross > best.gross) best = { strike: row.strike, gross };
  }
  return best && best.gross > 0 ? best.strike : null;
}

function serieKind(daysToExpiration: number): OptionsChainSerieMeta["kind"] {
  if (daysToExpiration <= 7) return "weekly";
  if (daysToExpiration <= 45) return "monthly";
  return "unknown";
}

/** Build a 09 chain payload from dashboard strike rows. Quotes stay null. */
export function composeChainFromDashboard(
  dashboard: OptionsDashboardResponse,
  product: OptionProduct,
  scope: OptionScope,
  requestedExpiration?: number,
): OptionsChainResponse {
  const empty: OptionsChainResponse = {
    product,
    scope,
    source: dashboard.source ?? "options-http",
    has_data: false,
    snapshot_unix: dashboard.snapshot_unix ?? 0,
    selected_expiration: 0,
    series: [],
    chain: null,
    missing_reason: dashboard.missing_reason ?? "当前暂无期权链数据",
    underlying_symbol: dashboard.underlying_symbol,
  };
  const cells = dashboard.heatmap?.cells ?? [];
  if (dashboard.has_data === false || cells.length === 0) return empty;

  const expirations = [...new Set(cells.map((cell) => cell.expiration))].filter((value) => value > 0).sort((a, b) => a - b);
  const marketExpiration = dashboard.market_state?.expiration;
  const selectedExpiration =
    requestedExpiration && expirations.includes(requestedExpiration)
      ? requestedExpiration
      : marketExpiration && expirations.includes(marketExpiration)
        ? marketExpiration
        : expirations[0];
  if (!selectedExpiration) return empty;

  const selectedCells = cells.filter((cell) => cell.expiration === selectedExpiration);
  const rowsByStrike = new Map<number, OptionsChainRow>();
  for (const cell of selectedCells) {
    const existing = rowsByStrike.get(cell.strike);
    const call = sideFromCell(cell, "call");
    const put = sideFromCell(cell, "put");
    if (existing) {
      const merge = (current: OptionsChainSide | null, next: OptionsChainSide): OptionsChainSide => {
        if (!current) return next;
        return emptySide({
          iv: current.iv ?? next.iv,
          oi: (current.oi ?? 0) + (next.oi ?? 0),
          volume: current.volume == null && next.volume == null ? null : (current.volume ?? 0) + (next.volume ?? 0),
          gex: (current.gex ?? 0) + (next.gex ?? 0),
        });
      };
      existing.call = merge(existing.call, call);
      existing.put = merge(existing.put, put);
    } else {
      rowsByStrike.set(cell.strike, { strike: cell.strike, call, put });
    }
  }
  const rows = [...rowsByStrike.values()].sort((a, b) => b.strike - a.strike);
  if (!rows.length) return empty;

  const snapshot = dashboard.snapshot_unix || selectedCells[0]?.unix || 0;
  const spot =
    finite(dashboard.summary?.underlying_price) ??
    finite(dashboard.market_state?.underlying_price) ??
    finite((selectedCells[0] as StrikeHeatmapCell & { underlying_price?: number } | undefined)?.underlying_price) ??
    0;
  const underlying =
    dashboard.underlying_symbol ??
    dashboard.market_state?.underlying_symbol ??
    selectedCells[0]?.underlying_symbol ??
    product;
  const now = snapshot || Math.floor(Date.now() / 1000);
  const series: OptionsChainSerieMeta[] = expirations.map((expiration) => {
    const expiry = dashboard.expiries?.find((item) => item.expiration === expiration);
    const days = Math.max(0, Math.round((expiration - now) / 86400));
    const kind = serieKind(days);
    return {
      expiration,
      code: `${underlying}-${expiration}`,
      kind,
      label: kind === "weekly" ? "周度" : kind === "monthly" ? "月度" : "期权",
      weekday: new Date(expiration * 1000).getUTCDay(),
      days_to_expiration: days,
      futures: expiry?.underlying_symbol ?? underlying,
      underlying_price: finite((expiry as { underlying_price?: number } | undefined)?.underlying_price) ?? spot,
      strikes: cells.filter((cell) => cell.expiration === expiration).length,
    };
  });
  const selectedSerie = series.find((item) => item.expiration === selectedExpiration)!;
  const levels = dashboard.levels ?? dashboard.heatmap?.levels;
  const days = selectedSerie.days_to_expiration;

  return {
    product,
    scope,
    source: dashboard.source ?? "options-http",
    has_data: true,
    snapshot_unix: snapshot,
    selected_expiration: selectedExpiration,
    series,
    underlying_symbol: underlying,
    data_notice: "OI / GEX / IV 来自看板到期表面；原始买卖报价尚未提供",
    chain: {
      code: selectedSerie.code,
      label: selectedSerie.label,
      kind: selectedSerie.kind,
      expiration: selectedExpiration,
      days_to_expiration: days,
      futures: selectedSerie.futures,
      underlying_price: spot,
      multiplier: optionProductConfig[product].multiplier,
      atm_iv: finite(dashboard.summary?.atm_iv) ?? finite(dashboard.expiries?.find((item) => item.expiration === selectedExpiration)?.atm_iv),
      call_wall: wallFromLevels(levels, "call_wall"),
      put_wall: wallFromLevels(levels, "put_wall"),
      gamma_flip: wallFromLevels(levels, "gamma_flip"),
      key_gamma_strike: keyGammaStrike(rows),
      max_pain: maxPainStrike(rows),
      expected_move_upper: finite(dashboard.summary?.expected_move_upper),
      expected_move_lower: finite(dashboard.summary?.expected_move_lower),
      rows,
    },
  };
}
