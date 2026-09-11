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
import { useOptionsCandleStream, useOptionsCandleTail, useOptionsIntradayBars, useOptionsIntradayMulti } from "@/features/options/use-options-intraday";
import { useOptionVolumeProfile } from "@/features/options/use-option-volume-profile";
import { useOptionsTermMulti } from "@/features/options/use-options-term";

import {
  buildExpirationHeatmapModel,
  type HeatmapExpiryMode,
} from "./expiration-heatmap-model";
import { ExpirationHeatmapPanel } from "./ExpirationHeatmapPanel";
import { buildExposureProfileModel } from "./exposure-profile-model";
import { buildGexBreakdownModel } from "./gex-breakdown-model";
import { IntradayPanel } from "./IntradayPanel";
import { buildOptionVolumeProfileModel } from "./option-volume-profile-model";
import { buildOptionsChainModel } from "./options-chain-model";
import { OptionsChainPanel } from "./OptionsChainPanel";
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
export function ExpirationWindow({ panelId, visible = true }: { panelId: string; visible?: boolean }) {
  const config = useWindowConfig(panelId);
  const product = config?.product ?? "NQ";
  const expiryMode = config?.heatmapExpiryMode ?? "front";
  const setHeatmapExpiryMode = useBoardWindowStore((s) => s.setHeatmapExpiryMode);
  const tradingDay = useCmeTradingDayKey();
  const heatScope = expiryMode === "front" ? "0dte" : "d90";
  const primary = useOptionsDashboard(product, heatScope, { days: expiryMode === "front" ? 1 : 90, enabled: visible });
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

/** 07 微笑偏斜（线条类）：多 scope 叠加——主 scope 实线，其余虚线低透明度；联动开时跟随总控 */
export function SmileWindow({ panelId, visible = true }: { panelId: string; visible?: boolean }) {
  const config = useWindowConfig(panelId);
  const perProductScope = useBoardWindowStore((s) => s.perProductScope);
  const product = config?.product ?? "NQ";
  const scopes = useMemo(
    () => (config ? effectiveLineScopes(config, perProductScope) : ["0dte" as OptionScope]),
    [config, perProductScope],
  );
  const selectedSeries = config?.smileSelectedSeries ?? {};
  const setSmileSelectedSeries = useBoardWindowStore((s) => s.setSmileSelectedSeries);
  const results = useOptionsChainMulti(product, scopes, selectedSeries, visible);
  const dashboardFallbackEnabled = results.map((result, index) => {
    if (result.isPending) return false;
    const data = result.data;
    return !data || data.has_data === false || !buildChainSmileModel(data, product, scopes[index]!)?.points.length;
  });
  const dashResults = useOptionsDashboardMulti(product, scopes, visible ? dashboardFallbackEnabled : false);
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
export function IntradayWindow({ panelId, visible = true }: { panelId: string; visible?: boolean }) {
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
  const exposureProfileEnabled = config?.exposureProfileEnabled !== false;
  const exposureProfileVisible = config?.exposureProfileVisible !== false;
  const exposureScope = config?.exposureProfileScope ?? "0dte";
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
  const setExposureProfileEnabled = useBoardWindowStore((s) => s.setExposureProfileEnabled);
  const setExposureProfileVisible = useBoardWindowStore((s) => s.setExposureProfileVisible);
  const setExposureProfileScope = useBoardWindowStore((s) => s.setExposureProfileScope);
  const setVolumeIndicatorEnabled = useBoardWindowStore((s) => s.setVolumeIndicatorEnabled);
  const setVolumeIndicatorVisible = useBoardWindowStore((s) => s.setVolumeIndicatorVisible);
  const toggleOptionLayerScope = useBoardWindowStore((s) => s.toggleOptionLayerScope);
  const setOptionLayerPart = useBoardWindowStore((s) => s.setOptionLayerPart);
  const setHistoryWindow = useBoardWindowStore((s) => s.setHistoryWindow);
  const historyDays = config?.historyDays ?? 1;
  const historyOffsetDays = config?.historyOffsetDays ?? 0;
  const barsQuery = useOptionsIntradayBars(product, historyDays, historyOffsetDays, visible);
  // 整窗历史只拉一次；每分钟的增量走尾部小窗（3KB）而非重传 24h（142KB）
  useOptionsCandleTail(product, historyDays, historyOffsetDays, visible);
  useOptionsCandleStream(
    product,
    barsQuery.data?.candle_underlying_symbol ?? barsQuery.data?.underlying_symbol,
    historyDays,
    historyOffsetDays,
    visible,
  );
  const intradayResults = useOptionsIntradayMulti(product, scopes, historyDays, historyOffsetDays, visible);
  const levelDashboardResults = useOptionsDashboardMulti(product, levelLayerEnabled ? layerScopes : [], visible);
  // K 线是期货价格，与期权档位无关：挂在"承载 K 线的那个 scope"上（优先 0DTE，其次主档）。
  // 原先写死只给 0dte 合并，导致只勾 30DTE/90DTE 时该窗口整块 K 线为空。
  const barsScope = scopes.includes("0dte") ? "0dte" : scopes[0];
  const results = useMemo(
    () => scopes.map((scope, index) => {
      const base = intradayResults[index];
      const dashboard = levelDashboardResults[layerScopes.indexOf(scope)]?.data;
      const withCandles = scope === barsScope ? mergeCandlePayload(base?.data, barsQuery.data) : base?.data;
      return {
        // 历史回看窗（offsetDays>0）跳过实时 dashboard 叠加：水位层显示历史 asof 原值，
        // 避免"今天的墙画在昨天的图上"（SPOT 又是历史末根收盘，语义矛盾）。
        data: historyOffsetDays > 0 ? withCandles : mergeDashboardCurrent(withCandles, dashboard),
        isPending: !withCandles && !!base?.isPending && (scope !== barsScope || barsQuery.isPending),
        isError: !withCandles && !!base?.isError && (scope !== barsScope || barsQuery.isError),
      };
    }),
    [scopes, intradayResults, barsQuery.data, barsQuery.isPending, barsQuery.isError, levelDashboardResults, layerScopes, barsScope, historyOffsetDays],
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
  const vpQuery = useOptionsDashboard(product, profileScope, { enabled: visible && vpOn && gexProfileVisible });
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
  const optionVolumeQuery = useOptionVolumeProfile(product, optionVolumeRange?.from, optionVolumeRange?.to, visible && optionVolumeProfileEnabled && optionVolumeProfileVisible);
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
  // 06 底部 Exposure 剖面副图：未添加或眼睛关闭时不发 dashboard 请求（同 vpOn && gexProfileVisible 门控先例）
  const exposureQuery = useOptionsDashboard(product, exposureScope, { enabled: visible && exposureProfileEnabled && exposureProfileVisible });
  const exposureModel = useMemo(
    () =>
      exposureQuery.data && exposureQuery.data.has_data !== false
        ? buildExposureProfileModel(buildDashboardViewModel(exposureQuery.data, exposureScope))
        : undefined,
    [exposureQuery.data, exposureScope],
  );
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
          volumeProfileScope={volumeProfileScope}
          onVolumeProfileScopeChange={(scope) => setOptionVolumeProfileScope(panelId, scope)}
          optionVolumeModel={optionVolumeModel}
          exposureProfileEnabled={exposureProfileEnabled}
          onExposureProfileEnabled={(enabled) => setExposureProfileEnabled(panelId, enabled)}
          exposureProfileVisible={exposureProfileVisible}
          onExposureProfileVisible={(visible) => setExposureProfileVisible(panelId, visible)}
          exposureScope={exposureScope}
          onExposureScopeChange={(scope) => setExposureProfileScope(panelId, scope)}
          exposureModel={exposureModel}
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
export function ChainWindow({ panelId, visible = true }: { panelId: string; visible?: boolean }) {
  const config = useWindowConfig(panelId);
  const perProductScope = useBoardWindowStore((s) => s.perProductScope);
  const product = config?.product ?? "NQ";
  const scope = config ? effectiveTableScope(config, perProductScope) : "0dte";
  const chainQuery = useOptionsChain(product, undefined, scope, visible && config?.chainExpiration === undefined);
  const model = useMemo(
    () => buildOptionsChainModel(product, chainQuery.data, scope),
    [product, scope, chainQuery.data],
  );
  // 内容纵向滚动型（表格行随档位增长，滚动由 DockPanelBody 承载），wrapper 不加 overflow-hidden
  return (
    <div>
      <WindowToolbar panelId={panelId} kind="chain" />
      {config?.chainExpiration === undefined && chainQuery.isPending ? (
        <LoadingState text="加载期权链中…" />
      ) : config?.chainExpiration === undefined && scope === "close" && chainQuery.data?.has_data === false ? (
        <ClosePendingState />
      ) : (
        <OptionsChainPanel key={`${product}:${scope}`} panelId={panelId} model={model} visible={visible} />
      )}
    </div>
  );
}

/** 10 月间价差 · PCR（线条类）：多 scope 叠加（第二 scope 起虚线+低透明度）；联动开时跟随总控 */
export function SpreadWindow({ panelId, visible = true }: { panelId: string; visible?: boolean }) {
  const config = useWindowConfig(panelId);
  const view = config?.spreadView ?? "iv";
  const setSpreadView = useBoardWindowStore((s) => s.setSpreadView);
  const perProductScope = useBoardWindowStore((s) => s.perProductScope);
  const product = config?.product ?? "NQ";
  const scopes = useMemo(
    () => (config ? effectiveLineScopes(config, perProductScope) : ["d90" as OptionScope]),
    [config, perProductScope],
  );
  const results = useOptionsTermMulti(product, view === "pcr" ? scopes : [], true, visible);
  // 真自适应（面板自适应规范）：flex 高度链 + overflow-hidden，10 精确填满窗口不出滚动条
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <WindowToolbar panelId={panelId} kind="line" />
      <div className="flex shrink-0 gap-1 border-b border-[var(--ms-separator)] px-2 py-1">
        {([['iv', 'IV 期限结构'], ['pcr', '价差 / PCR']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={view === value} onClick={() => setSpreadView(panelId, value)} className={`ms-control h-7 px-2 text-[11px] font-semibold ${view === value ? 'text-[var(--ms-brand)]' : 'text-[var(--ms-text-secondary)]'}`}>{label}</button>)}
      </div>
      <div className="min-h-0 flex-1">
        {view === "iv" ? <IvTermPanel key={`${product}:${scopes[0]}`} panelId={panelId} product={product} scope={scopes[0] ?? "d90"} visible={visible} /> : <TermSpreadPanel product={product} scopes={scopes} results={results} />}
      </div>
    </div>
  );
}
