"use client";
import { dataAvailabilityMessage } from "@/lib/data-messages";
import { optionSeriesName } from "@/lib/instrument-labels";
import { lastCompletedEodAsof } from "@/lib/cme-session";
import { candleUnderlying, mergeCandlePayload, mergeDashboardCurrent, pickIntradayBars, sameUnderlying } from "./intraday-data";

import { useMemo } from "react";

import type { OptionScope } from "@/api/options";
import {
  buildDashboardViewModel,
  type DashboardViewModel,
} from "@/features/options/dashboard-view-model";
import {
  useOptionsDashboard,
  useOptionsDashboardMulti,
} from "@/features/options/use-options-dashboard";
import { useOptionsChain, useOptionsChainMulti } from "@/features/options/use-options-chain";
import { useOptionsCandleStream, useOptionsIntradayBars, useOptionsIntradayMulti } from "@/features/options/use-options-intraday";
import { useOptionVolumeProfile } from "@/features/options/use-option-volume-profile";
import { useOptionVolumeHeatmap } from "@/features/options/use-option-volume-heatmap";
import { useOptionStats } from "@/features/options/use-option-stats";
import { useOptionsTermMulti } from "@/features/options/use-options-term";

import {
  buildExpirationHeatmapModel,
  type HeatmapExpiryMode,
} from "./expiration-heatmap-model";
import { ExpirationHeatmapPanel } from "./ExpirationHeatmapPanel";
import { buildGexBreakdownModel } from "./gex-breakdown-model";
import { GexBreakdownPanel } from "./GexBreakdownPanel";
import { IntradayPanel } from "./IntradayPanel";
import { buildOptionVolumeProfileModel } from "./option-volume-profile-model";
import { buildOptionVolumeHeatmapModel } from "./option-volume-heatmap-model";
import { buildOptionsChainModel } from "./options-chain-model";
import { OptionsChainPanel } from "./OptionsChainPanel";
import { buildOverviewModel } from "./overview-model";
import { OverviewPanel } from "./OverviewPanel";
import { buildChainSmileModel, buildSmileSkewModel } from "./smile-skew-model";
import { SmileSkewPanel } from "./SmileSkewPanel";
import { TermSpreadPanel } from "./TermSpreadPanel";
import { IvTermPanel } from "./IvTermPanel";
import {
  effectiveLineScopes,
  effectiveTableScope,
  useBoardWindowStore,
} from "./board-window-store";
import { WindowToolbar, WindowToolbarControls } from "./WindowToolbar";
import { SpotFollowButton } from "./spot-follow-button";
import { useSpotFollow } from "./use-spot-follow";
import { useCmeTradingDayKey } from "@/features/options/trading-day-refresh";

/** 收盘档统一空态：收盘数据未接入，不报错、不造数 */
export function ClosePendingState() {
  return (
    <div className="grid h-full min-h-0 place-items-center bg-[var(--ms-plot-bg)] px-4 text-center">
      <div>
        <p className="text-xs text-[var(--ms-text-secondary)]">暂无完整的收盘数据</p>
        <p className="mt-1 font-mono text-[9px] tracking-[0.1em] text-[var(--ms-text-tertiary)]">
          每日一次结算真值 · 全天冻结 · 不展示模拟数据
        </p>
      </div>
    </div>
  );
}

function LoadingState({ text }: { text: string }) {
  // 真自适应（面板自适应规范）：h-full 填满父级弹性格，不写死 min-h——小窗也不撑出滚动条
  return (
    <div className="grid h-full min-h-0 place-items-center bg-[var(--ms-plot-bg)] px-4 text-center text-sm text-[var(--ms-text-secondary)]">
      {dataAvailabilityMessage(text)}
    </div>
  );
}

/** 窗口配置缺失兜底（理论上 DockPanelBody 的 ensureWindow 已补） */
function useWindowConfig(panelId: string) {
  return useBoardWindowStore((s) => s.windows[panelId]);
}

/**
 * 01 总览：口径固定跟随顶部主控（品种 + 全局多选的主周期）——
 * 概览面板语义锚定"当前主品种的全局口径"，不参与单窗解耦（演进文档五节决策，本轮从简）。
 */
export function OverviewWindow() {
  const master = useBoardWindowStore((s) => s.master);
  // 表格类/单值消费：取多选中最高优先级（排序后 [0]）当主周期
  const scope = master.scopes[0] ?? "0dte";
  const query = useOptionsDashboard(master.product, scope);
  const model = useMemo(
    () =>
      query.data && query.data.has_data !== false
        ? buildOverviewModel(buildDashboardViewModel(query.data, scope))
        : undefined,
    [query.data, scope],
  );
  if (query.isPending) return <LoadingState text="加载总览中…" />;
  if (scope === "close" && query.data?.has_data === false) return <ClosePendingState />;
  // 真自适应（面板自适应规范）：01 为纯 DOM 面板、宽度天然弹性，根容器 overflow-hidden 兜底防溢出
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="min-h-0 flex-1">{model ? <OverviewPanel model={model} /> : <LoadingState text={query.isError ? "数据加载失败，请稍后重试。" : query.data?.missing_reason ?? "当前周期暂无总览数据"} />}</div>
    </div>
  );
}

/** 表格类窗口骨架：窗口工具行 + 单选 scope（📌）+ 各自的 dashboard 消费 */
function TableDashWindow({
  panelId,
  name,
  children,
  toolbarTrailing,
}: {
  panelId: string;
  name: string;
  children: (viewModel: DashboardViewModel) => React.ReactNode;
  toolbarTrailing?: React.ReactNode;
}) {
  const config = useWindowConfig(panelId);
  const perProductScope = useBoardWindowStore((s) => s.perProductScope);
  const product = config?.product ?? "NQ";
  const scope = config ? effectiveTableScope(config, perProductScope) : "0dte";
  const query = useOptionsDashboard(product, scope);
  const viewModel = useMemo(
    () =>
      query.data && query.data.has_data !== false
        ? buildDashboardViewModel(query.data, scope)
        : undefined,
    [query.data, scope],
  );
  // 真自适应（面板自适应规范）：flex 高度链撑满窗口；不加 overflow-hidden——
  // 05/08 为内容纵向滚动型（行数 × 固定行高），滚动由 DockPanelBody 承载（08 例外同口径）
  return (
    <div className="flex h-full min-h-0 flex-col">
      <WindowToolbar panelId={panelId} kind="table" trailing={toolbarTrailing} />
      <div className="min-h-0 flex-1">
        {query.isPending ? (
          <LoadingState text={`加载${name}中…`} />
        ) : scope === "close" && query.data?.has_data === false ? (
          <ClosePendingState />
        ) : viewModel ? (
          children(viewModel)
        ) : (
          <LoadingState text={query.isError ? "数据加载失败，请稍后重试。" : query.data?.missing_reason ?? `当前周期暂无${name}数据`} />
        )}
      </div>
    </div>
  );
}

/** 05 视图：固定EOD数据，面板内切换0DTE/最近到期与全部真实到期列。 */
function ExpirationHeatmapView({
  vm,
  tradingDay,
  expiryMode,
  onExpiryModeChange,
}: {
  vm: DashboardViewModel;
  tradingDay: string;
  expiryMode: HeatmapExpiryMode;
  onExpiryModeChange: (mode: HeatmapExpiryMode) => void;
}) {
  const model = useMemo(() => buildExpirationHeatmapModel(vm, [], expiryMode, tradingDay), [vm, expiryMode, tradingDay]);
  return <ExpirationHeatmapPanel model={model} expiryMode={expiryMode} onExpiryModeChange={onExpiryModeChange} />;
}

/** 05 到期热力图：近月用 0DTE 表面，全部到期用 all/90 天表面。 */
export function ExpirationWindow({ panelId }: { panelId: string }) {
  const config = useWindowConfig(panelId);
  const product = config?.product ?? "NQ";
  const expiryMode = config?.heatmapExpiryMode ?? "front";
  const setHeatmapExpiryMode = useBoardWindowStore((s) => s.setHeatmapExpiryMode);
  const tradingDay = useCmeTradingDayKey();
  const heatScope = expiryMode === "front" ? "0dte" : "d90";
  const primary = useOptionsDashboard(product, heatScope, { days: expiryMode === "front" ? 1 : 90 });
  const viewModel = useMemo(
    () =>
      primary.data && primary.data.has_data !== false
        ? buildDashboardViewModel(primary.data, heatScope)
        : undefined,
    [primary.data, heatScope],
  );
  // 真自适应（面板自适应规范）：flex 高度链撑满窗口；不加 overflow-hidden——
  // 05 为内容纵向滚动型（行数 × 固定行高），滚动由 DockPanelBody 承载
  return (
    <div className="flex h-full min-h-0 flex-col">
      <WindowToolbar panelId={panelId} kind="table" showScopes={false} />
      <div className="min-h-0 flex-1">
        {primary.isPending ? (
          <LoadingState text="加载到期热力图中…" />
        ) : viewModel ? (
          <ExpirationHeatmapView vm={viewModel} tradingDay={tradingDay} expiryMode={expiryMode} onExpiryModeChange={(mode) => setHeatmapExpiryMode(panelId, mode)} />
        ) : (
          <LoadingState text={primary.data?.missing_reason ?? "当前暂无到期热力图数据"} />
        )}
      </div>
    </div>
  );
}

export function GexWindow({ panelId }: { panelId: string }) {
  const spotFollow = useSpotFollow<HTMLDivElement>();
  return (
    <TableDashWindow
      panelId={panelId}
      name="GEX 拆分"
      toolbarTrailing={<SpotFollowButton follow={spotFollow.follow} onToggle={spotFollow.toggleFollow} />}
    >
      {(vm) => <GexBreakdownPanel model={buildGexBreakdownModel(vm)} spotFollow={spotFollow} />}
    </TableDashWindow>
  );
}

/** 07 微笑偏斜（线条类）：多 scope 叠加——主 scope 实线，其余虚线低透明度；联动开时跟随总控 */
export function SmileWindow({ panelId }: { panelId: string }) {
  const config = useWindowConfig(panelId);
  const perProductScope = useBoardWindowStore((s) => s.perProductScope);
  const product = config?.product ?? "NQ";
  const scopes = useMemo(
    () => (config ? effectiveLineScopes(config, perProductScope) : ["0dte" as OptionScope]),
    [config, perProductScope],
  );
  const selectedSeries = config?.smileSelectedSeries ?? {};
  const setSmileSelectedSeries = useBoardWindowStore((s) => s.setSmileSelectedSeries);
  const results = useOptionsChainMulti(product, scopes, selectedSeries);
  const dashboardFallbackEnabled = results.map((result, index) => {
    if (result.isPending) return false;
    const data = result.data;
    return !data || data.has_data === false || !buildChainSmileModel(data, product, scopes[index]!)?.points.length;
  });
  const dashResults = useOptionsDashboardMulti(product, scopes, dashboardFallbackEnabled);
  const models = useMemo(
    () =>
      scopes.map((scope, i) => {
        const data = results[i]?.data;
        const fromChain = data && data.has_data !== false ? buildChainSmileModel(data, product, scope) : null;
        if (fromChain?.points.length) return { scope, model: fromChain };
        const dash = dashResults[i]?.data;
        if (dash && dash.has_data !== false) {
          const model = buildSmileSkewModel(buildDashboardViewModel(dash, scope));
          return { scope, model: model.points.some((point) => point.callIV != null || point.putIV != null) ? model : null };
        }
        return { scope, model: null };
      }),
    [scopes, results, dashResults, product],
  );
  const anyPending = models.every((item) => !item.model) && (
    results.some((result) => result.isPending) ||
    dashResults.some((result, index) => dashboardFallbackEnabled[index] && result.isPending)
  );
  // 真自适应（面板自适应规范）：flex 高度链 + overflow-hidden，07 精确填满窗口不出滚动条
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <WindowToolbar panelId={panelId} kind="line" scopeSelection="multiple" />
      <div className="flex shrink-0 flex-wrap gap-1 px-3 py-1">
        {scopes.map((scope, i) => results[i]?.data?.series.length ? <select key={scope} aria-label={`${scope}微笑系列`} className="min-w-0 max-w-full bg-[var(--ms-panel-bg)] text-[10px] text-[var(--ms-text-secondary)]" value={selectedSeries[`${product}:${scope}`] ?? results[i]?.data?.chain?.code ?? ""} onChange={(e) => setSmileSelectedSeries(panelId, `${product}:${scope}`, e.target.value)}>
          {results[i]?.data?.series.map((serie) => <option key={serie.code} value={serie.code}>{scope} · {optionSeriesName(serie, product)}</option>)}
        </select> : null)}
      </div>
      <div className="min-h-0 flex-1">
        {anyPending ? (
          <LoadingState text="加载波动率微笑中…" />
        ) : (
          <SmileSkewPanel models={models} />
        )}
      </div>
    </div>
  );
}

/** 06 日内变化（线条类）：多 scope 叠加 + 窗口私有 K 线周期；联动开时跟随总控 */
export function IntradayWindow({ panelId }: { panelId: string }) {
  const config = useWindowConfig(panelId);
  const perProductScope = useBoardWindowStore((s) => s.perProductScope);
  const product = config?.product ?? "NQ";
  const layerScopes = useMemo(
    () => config?.optionLayerScopes ?? (config ? effectiveLineScopes(config, perProductScope) : ["0dte" as OptionScope]),
    [config, perProductScope],
  );
  const levelLayerEnabled = config?.optionLayerEnabled !== false;
  const levelLayerVisible = config?.optionLayerVisible !== false;
  const vpOn = config?.vpOn !== false;
  const gexProfileVisible = config?.gexProfileVisible !== false;
  const optionVolumeProfileEnabled = config?.optionVolumeProfileEnabled !== false;
  const optionVolumeProfileVisible = config?.optionVolumeProfileVisible !== false;
  const optionVolumeHeatmapEnabled = config?.optionVolumeHeatmapEnabled === true;
  const optionVolumeHeatmapVisible = config?.optionVolumeHeatmapVisible !== false;
  const optionVolumeHeatmapMetric = config?.optionVolumeHeatmapMetric ?? "difference";
  const optionVolumeHeatmapWindow = config?.optionVolumeHeatmapWindow ?? "1m";
  const optionStatsEnabled = config?.optionStatsEnabled === true;
  const optionStatsVisible = config?.optionStatsVisible !== false;
  const profileScope = config?.gexProfileScope === "close" ? "close" : "0dte";
  const volumeProfileScope = config?.optionVolumeProfileScope === "close" ? "close" : "0dte";
  const scopes = useMemo(
    () => [...new Set<OptionScope>(["0dte", ...((levelLayerEnabled || vpOn) ? layerScopes : [])])],
    [levelLayerEnabled, vpOn, layerScopes],
  );
  const minutes = config?.kPeriod ?? 5;
  const setKPeriod = useBoardWindowStore((s) => s.setKPeriod);
  const setOptionLayerEnabled = useBoardWindowStore((s) => s.setOptionLayerEnabled);
  const setOptionLayerVisible = useBoardWindowStore((s) => s.setOptionLayerVisible);
  const setVpEnabled = useBoardWindowStore((s) => s.setVpEnabled);
  const setVpVisible = useBoardWindowStore((s) => s.setVpVisible);
  const setGexProfileScope = useBoardWindowStore((s) => s.setGexProfileScope);
  const setOptionVolumeProfileEnabled = useBoardWindowStore((s) => s.setOptionVolumeProfileEnabled);
  const setOptionVolumeProfileVisible = useBoardWindowStore((s) => s.setOptionVolumeProfileVisible);
  const setOptionVolumeProfileScope = useBoardWindowStore((s) => s.setOptionVolumeProfileScope);
  const setOptionVolumeHeatmapEnabled = useBoardWindowStore((s) => s.setOptionVolumeHeatmapEnabled);
  const setOptionVolumeHeatmapVisible = useBoardWindowStore((s) => s.setOptionVolumeHeatmapVisible);
  const setOptionVolumeHeatmapMetric = useBoardWindowStore((s) => s.setOptionVolumeHeatmapMetric);
  const setOptionVolumeHeatmapWindow = useBoardWindowStore((s) => s.setOptionVolumeHeatmapWindow);
  const setOptionStatsEnabled = useBoardWindowStore((s) => s.setOptionStatsEnabled);
  const setOptionStatsVisible = useBoardWindowStore((s) => s.setOptionStatsVisible);
  const toggleOptionStatsMetric = useBoardWindowStore((s) => s.toggleOptionStatsMetric);
  const setVolumeIndicatorEnabled = useBoardWindowStore((s) => s.setVolumeIndicatorEnabled);
  const setVolumeIndicatorVisible = useBoardWindowStore((s) => s.setVolumeIndicatorVisible);
  const toggleOptionLayerScope = useBoardWindowStore((s) => s.toggleOptionLayerScope);
  const setOptionLayerPart = useBoardWindowStore((s) => s.setOptionLayerPart);
  const setHistoryWindow = useBoardWindowStore((s) => s.setHistoryWindow);
  const historyDays = config?.historyDays ?? 1;
  const historyOffsetDays = config?.historyOffsetDays ?? 0;
  const barsQuery = useOptionsIntradayBars(product, historyDays, historyOffsetDays);
  useOptionsCandleStream(
    product,
    barsQuery.data?.candle_underlying_symbol ?? barsQuery.data?.underlying_symbol,
    historyDays,
    historyOffsetDays,
  );
  const intradayResults = useOptionsIntradayMulti(product, scopes, historyDays, historyOffsetDays);
  const levelDashboardResults = useOptionsDashboardMulti(product, levelLayerEnabled ? layerScopes : []);
  const results = useMemo(
    () => scopes.map((scope, index) => {
      const base = intradayResults[index];
      const dashboard = levelDashboardResults[layerScopes.indexOf(scope)]?.data;
      const withCandles = scope === "0dte" ? mergeCandlePayload(base?.data, barsQuery.data) : base?.data;
      return {
        data: mergeDashboardCurrent(withCandles, dashboard),
        isPending: !withCandles && !!base?.isPending && (scope !== "0dte" || barsQuery.isPending),
        isError: !withCandles && !!base?.isError && (scope !== "0dte" || barsQuery.isError),
      };
    }),
    [scopes, intradayResults, barsQuery.data, barsQuery.isPending, barsQuery.isError, levelDashboardResults, layerScopes],
  );
  // 06 内嵌 VP 条带（第二十轮，替代已废弃的 06↔08 跨窗 VP 联动）：
  // 08 同源 GEX 模型——当前品种 + 主周期（多选中固定优先级最高者）dashboard + buildGexBreakdownModel。
  // vpOn 关时不取数（enabled 门控），06 其余渲染零变化。
  // 调试剖面仍灌；开关走窗口配置（默认开，可再点关闭）
  const primaryScope = useMemo(
    () =>
      layerScopes
        .slice()
        .sort(
          (a, b) =>
            (["0dte", "d30", "d90", "close"] as OptionScope[]).indexOf(a) -
            (["0dte", "d30", "d90", "close"] as OptionScope[]).indexOf(b),
        )[0] ?? layerScopes[0] ?? "0dte",
    [layerScopes],
  );
  const vpQuery = useOptionsDashboard(product, profileScope, { enabled: vpOn && gexProfileVisible });
  const barsSource = pickIntradayBars(scopes.map((scope, i) => ({scope, data: results[i]?.data})), primaryScope);
  const barSymbol = candleUnderlying(barsSource);
  const optionVolumeRange = useMemo(() => {
    if (volumeProfileScope === "close") {
      const asof = lastCompletedEodAsof();
      return { from: asof - 23 * 3600, to: asof };
    }
    const first = barsSource?.bars[0]?.unix;
    const last = barsSource?.bars.at(-1)?.unix;
    return first && last ? { from: first, to: last + 60 } : undefined;
  }, [volumeProfileScope, barsSource?.bars]);
  const optionVolumeQuery = useOptionVolumeProfile(product, optionVolumeRange?.from, optionVolumeRange?.to, optionVolumeProfileEnabled && optionVolumeProfileVisible);
  const optionVolumeHeatmapQuery = useOptionVolumeHeatmap(product, optionVolumeRange?.from, optionVolumeRange?.to, optionVolumeHeatmapEnabled && optionVolumeHeatmapVisible);
  const optionStatsQuery = useOptionStats(product, optionVolumeRange?.from, optionVolumeRange?.to, minutes * 60, optionStatsEnabled && optionStatsVisible);
  const vpModel = useMemo(() => {
    if (!vpQuery.data || vpQuery.data.has_data === false || (!vpQuery.data.portfolio && !sameUnderlying(vpQuery.data.market_state?.underlying_symbol, barSymbol))) return undefined;
    return buildGexBreakdownModel(buildDashboardViewModel(vpQuery.data, profileScope));
  }, [vpQuery.data, profileScope, barSymbol]);
  const optionVolumeModel = useMemo(() => {
    const data = optionVolumeQuery.data;
    if (!data?.has_data) return undefined;
    const model = buildOptionVolumeProfileModel(data);
    return model.rows.length ? model : undefined;
  }, [optionVolumeQuery.data]);
  const optionVolumeHeatmapModel = useMemo(() => {
    const data = optionVolumeHeatmapQuery.data;
    if (!data?.has_data) return undefined;
    const model = buildOptionVolumeHeatmapModel(data, optionVolumeHeatmapMetric, optionVolumeHeatmapWindow);
    return model.cells.length ? model : undefined;
  }, [optionVolumeHeatmapQuery.data, optionVolumeHeatmapMetric, optionVolumeHeatmapWindow]);
  return (
    // 真自适应（第十九轮）：flex 高度链 + overflow-hidden，06 面板精确填满窗口、不出滚动条
    // 布局极致简约化 C：WindowToolbar 外壳不再单列一行，控件本体注入 IntradayPanel 与图表工具控件并单行
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="min-h-0 flex-1">
        <IntradayPanel
          product={product}
          scopes={scopes}
          layerScopes={layerScopes}
          results={results}
          minutes={minutes}
          onMinutesChange={(m) => setKPeriod(panelId, m)}
          levelLayerEnabled={levelLayerEnabled}
          onLevelLayerEnabled={(enabled) => setOptionLayerEnabled(panelId, enabled)}
          levelLayerVisible={levelLayerVisible}
          onLevelLayerVisible={(visible) => setOptionLayerVisible(panelId, visible)}
          volumeIndicatorEnabled={config?.volumeIndicatorEnabled !== false}
          onVolumeIndicatorEnabled={(enabled) => setVolumeIndicatorEnabled(panelId, enabled)}
          volumeIndicatorVisible={config?.volumeIndicatorVisible !== false}
          onVolumeIndicatorVisible={(visible) => setVolumeIndicatorVisible(panelId, visible)}
          levelsOn={config?.optionLevelsOn !== false}
          onLevelsOn={(enabled) => setOptionLayerPart(panelId, "levels", enabled)}
          historyOn={config?.optionHistoryOn === true}
          onHistoryOn={(enabled) => setOptionLayerPart(panelId, "history", enabled)}
          vpOn={vpOn}
          onVpEnabled={(enabled) => setVpEnabled(panelId, enabled)}
          gexProfileVisible={gexProfileVisible}
          onGexProfileVisible={(visible) => setVpVisible(panelId, visible)}
          profileScope={profileScope}
          onProfileScopeChange={(scope) => setGexProfileScope(panelId, scope)}
          optionVolumeProfileEnabled={optionVolumeProfileEnabled}
          onOptionVolumeProfileEnabled={(enabled) => setOptionVolumeProfileEnabled(panelId, enabled)}
          optionVolumeProfileVisible={optionVolumeProfileVisible}
          onOptionVolumeProfileVisible={(visible) => setOptionVolumeProfileVisible(panelId, visible)}
          optionVolumeHeatmapEnabled={optionVolumeHeatmapEnabled}
          onOptionVolumeHeatmapEnabled={(enabled) => setOptionVolumeHeatmapEnabled(panelId, enabled)}
          optionVolumeHeatmapVisible={optionVolumeHeatmapVisible}
          onOptionVolumeHeatmapVisible={(visible) => setOptionVolumeHeatmapVisible(panelId, visible)}
          optionVolumeHeatmapMetric={optionVolumeHeatmapMetric}
          onOptionVolumeHeatmapMetric={(metric) => setOptionVolumeHeatmapMetric(panelId, metric)}
          optionVolumeHeatmapWindow={optionVolumeHeatmapWindow}
          onOptionVolumeHeatmapWindow={(window) => setOptionVolumeHeatmapWindow(panelId, window)}
          volumeProfileScope={volumeProfileScope}
          onVolumeProfileScopeChange={(scope) => setOptionVolumeProfileScope(panelId, scope)}
          optionVolumeModel={optionVolumeModel}
          optionVolumeHeatmapModel={optionVolumeHeatmapModel}
          optionStatsEnabled={optionStatsEnabled}
          onOptionStatsEnabled={(enabled) => setOptionStatsEnabled(panelId, enabled)}
          optionStatsVisible={optionStatsVisible}
          onOptionStatsVisible={(visible) => setOptionStatsVisible(panelId, visible)}
          optionStatsMetrics={config?.optionStatsMetrics}
          onToggleOptionStatsMetric={(metric) => toggleOptionStatsMetric(panelId, metric)}
          optionStatsResponse={optionStatsQuery.data}
          onToggleLayerScope={(scope) => toggleOptionLayerScope(panelId, scope)}
          historyDays={historyDays}
          historyOffsetDays={historyOffsetDays}
          onHistoryWindow={(days, offset) => setHistoryWindow(panelId, days, offset)}
          vpModel={vpModel}
          vpW={config?.vpW}
          leadingControls={<WindowToolbarControls panelId={panelId} kind="line" showScopes={false} />}
        />
      </div>
    </div>
  );
}

/** 09 期权链（chain 类，第三十一轮）：周期统一顶栏总控，窗内不再有周期 chips；
 *  联动 = 跟随总控主周期（close 档整窗空态）；解耦 = 冻结解耦瞬间的周期快照（toggleProductLinked 内固化）；
 *  工具行只剩品种 select + 🔗chip */
export function ChainWindow({ panelId }: { panelId: string }) {
  const config = useWindowConfig(panelId);
  const perProductScope = useBoardWindowStore((s) => s.perProductScope);
  const product = config?.product ?? "NQ";
  const scope = config ? effectiveTableScope(config, perProductScope) : "0dte";
  const chainQuery = useOptionsChain(product, undefined, scope);
  const model = useMemo(
    () => buildOptionsChainModel(product, chainQuery.data, scope),
    [product, scope, chainQuery.data],
  );
  // 内容纵向滚动型（表格行随档位增长，滚动由 DockPanelBody 承载），wrapper 不加 overflow-hidden
  return (
    <div>
      <WindowToolbar panelId={panelId} kind="chain" />
      {chainQuery.isPending ? (
        <LoadingState text="加载期权链中…" />
      ) : scope === "close" && chainQuery.data?.has_data === false ? (
        <ClosePendingState />
      ) : (
        <OptionsChainPanel key={`${product}:${scope}`} panelId={panelId} model={model} />
      )}
    </div>
  );
}

/** 10 月间价差 · PCR（线条类）：多 scope 叠加（第二 scope 起虚线+低透明度）；联动开时跟随总控 */
export function SpreadWindow({ panelId }: { panelId: string }) {
  const config = useWindowConfig(panelId);
  const view = config?.spreadView ?? "iv";
  const setSpreadView = useBoardWindowStore((s) => s.setSpreadView);
  const perProductScope = useBoardWindowStore((s) => s.perProductScope);
  const product = config?.product ?? "NQ";
  const scopes = useMemo(
    () => (config ? effectiveLineScopes(config, perProductScope) : ["d90" as OptionScope]),
    [config, perProductScope],
  );
  const results = useOptionsTermMulti(product, view === "pcr" ? scopes : [], true);
  // 真自适应（面板自适应规范）：flex 高度链 + overflow-hidden，10 精确填满窗口不出滚动条
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <WindowToolbar panelId={panelId} kind="line" />
      <div className="flex shrink-0 gap-1 border-b border-[var(--ms-separator)] px-2 py-1">
        {([['iv', 'IV 期限结构'], ['pcr', '价差 / PCR']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={view === value} onClick={() => setSpreadView(panelId, value)} className={`ms-control h-7 px-2 text-[11px] font-semibold ${view === value ? 'text-[var(--ms-brand)]' : 'text-[var(--ms-text-secondary)]'}`}>{label}</button>)}
      </div>
      <div className="min-h-0 flex-1">
        {view === "iv" ? <IvTermPanel key={`${product}:${scopes[0]}`} panelId={panelId} product={product} scope={scopes[0] ?? "d90"} /> : <TermSpreadPanel product={product} scopes={scopes} results={results} />}
      </div>
    </div>
  );
}
