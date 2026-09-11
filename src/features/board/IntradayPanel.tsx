"use client";
import { instrumentName } from "@/lib/instrument-labels";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import {
  CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, LineSeries, LineStyle, LineType, TickMarkType, createChart,
  type IChartApi, type IPriceLine, type ISeriesApi, type Time, type UTCTimestamp,
} from "lightweight-charts";
import { Check, Eye, EyeOff, Settings2, X } from "lucide-react";
import { optionProductConfig, type IntradayBar, type OptionProduct, type OptionScope, type OptionsIntradayResponse } from "@/api/options";
import { dataAvailabilityMessage } from "@/lib/data-messages";
import { cmeTradingDayKey, sessionStart } from "@/lib/cme-session";
import { formatInteger, formatPrice } from "@/lib/formatters";
import type { GexBreakdownModel } from "./gex-breakdown-model";
import { ExposureProfilePane } from "./ExposureProfilePane";
import type { ExposureProfileModel } from "./exposure-profile-model";
import { candleUnderlying, pickIntradayBars, sameUnderlying } from "./intraday-data";
import { INTRADAY_SCOPES, aggregateIntradayBars, buildChartPositions, tailUpdateStart, preserveLogicalRange } from "./lightweight-model";
import { OptionOiProfilePrimitive } from "./lightweight-gex-profile";
import { OptionVolumeProfilePrimitive } from "./lightweight-option-volume-profile";
import type { OptionVolumeProfileModel } from "./option-volume-profile-model";
import { useMeasureSize } from "./use-measure-size";

const PERIODS = [{ minutes: 1, label: "1m" }, { minutes: 5, label: "5m" }, { minutes: 15, label: "15m" }, { minutes: 30, label: "30m" }, { minutes: 60, label: "1h" }];
const PREFIX: Record<OptionScope, string> = { "0dte": "0DTE", d30: "30DTE", d90: "90DTE", close: "EOD" };
const LEGEND_PREFIX: Record<OptionScope, string> = { "0dte": "0DTE", d30: "30DTE", d90: "90DTE", close: "前日EOD" };
// 06 时间轴/读数一律用美东（America/New_York，后缀 ET）：用户口径 2026-09-11，CT 不习惯。
const clock = new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const date = new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", month: "2-digit", day: "2-digit" });
function timeDate(time: Time): Date { return typeof time === "number" ? new Date(time * 1000) : typeof time === "string" ? new Date(time) : new Date(Date.UTC(time.year, time.month - 1, time.day)); }
function chartColors(node: HTMLElement) {
  const style = getComputedStyle(node), color = (name: string) => style.getPropertyValue(name).trim();
  return { background: color("--ms-plot-bg"), text: color("--ms-text-secondary"), border: color("--ms-grid"), buy: color("--ms-chart-buy"), sell: color("--ms-chart-sell"), cw: color("--ms-buy-bright"), pw: color("--ms-sell-bright"), flip: color("--ms-brand"), spot: color("--ms-key-gamma"), font: style.fontFamily };
}
type Colors = ReturnType<typeof chartColors>;
type PriceSeries = ISeriesApi<"Candlestick"> | ISeriesApi<"Line">;

/**
 * 默认视野 = 当前 CME 交易日完整时段（开盘 17:00 CT / 18:00 ET → 收盘 16:00 CT / 17:00 ET）。
 * 用户口径（2026-09-11）：每次展示的 K 线都是开盘到收盘，右侧未开盘段留白。
 */
function fitSession(chart: IChartApi) {
  const open = sessionStart(cmeTradingDayKey());
  chart.priceScale("right").setAutoScale(true);
  chart.timeScale().setVisibleRange({ from: open as UTCTimestamp, to: (open + 23 * 3600) as UTCTimestamp });
}
interface Runtime {
  chart: IChartApi;
  candles: ISeriesApi<"Candlestick">;
  line: ISeriesApi<"Line">;
  volume: ISeriesApi<"Histogram">;
  active: PriceSeries;
  profile: OptionOiProfilePrimitive;
  optionVolumeProfile: OptionVolumeProfilePrimitive;
  priceLines: Array<{ series: PriceSeries; line: IPriceLine }>;
  bars: IntradayBar[];
  key: string;
  colors: Colors;
}
export interface IntradayScopeResult { data?: OptionsIntradayResponse; isPending: boolean; isError: boolean }

export function IntradayPanel({ product, scopes, layerScopes, results, minutes, onMinutesChange, levelLayerEnabled, onLevelLayerEnabled, levelLayerVisible, onLevelLayerVisible, volumeIndicatorEnabled, onVolumeIndicatorEnabled, volumeIndicatorVisible, onVolumeIndicatorVisible, levelsOn, onLevelsOn, vpOn, onVpEnabled, gexProfileVisible, onGexProfileVisible, profileScope, onProfileScopeChange, optionVolumeProfileEnabled, onOptionVolumeProfileEnabled, optionVolumeProfileVisible, onOptionVolumeProfileVisible, onToggleLayerScope, historyDays, historyOffsetDays, onHistoryWindow, vpModel, optionVolumeModel, vpW, leadingControls, exposureProfileEnabled, onExposureProfileEnabled, exposureProfileVisible, onExposureProfileVisible, exposureScope, onExposureScopeChange, exposureModel }: {
  product: OptionProduct; scopes: OptionScope[]; results: IntradayScopeResult[]; minutes: number; onMinutesChange: (value: number) => void;
  layerScopes: OptionScope[]; levelLayerEnabled: boolean; onLevelLayerEnabled: (enabled: boolean) => void;
  levelLayerVisible: boolean; onLevelLayerVisible: (visible: boolean) => void;
  volumeIndicatorEnabled: boolean; onVolumeIndicatorEnabled: (enabled: boolean) => void;
  volumeIndicatorVisible: boolean; onVolumeIndicatorVisible: (visible: boolean) => void;
  levelsOn: boolean; onLevelsOn: (enabled: boolean) => void;
  vpOn: boolean; onVpEnabled: (enabled: boolean) => void; gexProfileVisible: boolean; onGexProfileVisible: (visible: boolean) => void;
  profileScope: OptionScope; onProfileScopeChange: (scope: OptionScope) => void;
  optionVolumeProfileEnabled: boolean; onOptionVolumeProfileEnabled: (enabled: boolean) => void;
  optionVolumeProfileVisible: boolean; onOptionVolumeProfileVisible: (visible: boolean) => void;
  volumeProfileScope?: OptionScope; onVolumeProfileScopeChange?: (scope: OptionScope) => void;
  onToggleLayerScope: (scope: OptionScope) => void;
  historyDays: 1 | 3 | 7; historyOffsetDays: number; onHistoryWindow: (days: 1 | 3 | 7, offsetDays: number) => void;
  vpModel?: GexBreakdownModel; optionVolumeModel?: OptionVolumeProfileModel; vpW?: number; leadingControls?: ReactNode;
  exposureProfileEnabled: boolean; onExposureProfileEnabled: (enabled: boolean) => void;
  exposureProfileVisible: boolean; onExposureProfileVisible: (visible: boolean) => void;
  exposureScope: OptionScope; onExposureScopeChange: (scope: OptionScope) => void;
  exposureModel?: ExposureProfileModel;
}) {
  const [mode, setMode] = useState<"candles" | "line">("candles");
  const [legendsCollapsed, setLegendsCollapsed] = useState(false);
  const legendListId = useId();
  const [levelSettingsOpen, setLevelSettingsOpen] = useState(false);
  const [profileSettingsOpen, setProfileSettingsOpen] = useState(false);
  const [exposureSettingsOpen, setExposureSettingsOpen] = useState(false);
  const [indicatorMenuOpen, setIndicatorMenuOpen] = useState(false);
  const [hovered, setHovered] = useState<IntradayBar | null>(null);
  const [chartApi, setChartApi] = useState<IChartApi | null>(null);
  const [chartHost, setChartHost] = useState<HTMLDivElement | null>(null);
  const runtime = useRef<Runtime | null>(null);
  const legendRef = useRef<HTMLDivElement | null>(null);
  const barsByTime = useRef(new Map<number, IntradayBar>());
  /**
   * 空态遮罩守卫（2026-09-10）：遮罩是不透明的（bg-[var(--ms-plot-bg)]，整块盖住绘图区），
   * 一旦 bars 因为重新取数、切换窗口或上游抖动而瞬时为空，用户看到的就是"画面黑一段时间"。
   * 只在"从未渲染过任何 K 线"时才允许出现遮罩；已经画过图就保留最后一帧，
   * 由数据自己补上来（chart 内容不会因为 React 侧 bars 为空而消失）。
   */
  const renderedOnce = useRef(false);
  const [barsEverRendered, setBarsEverRendered] = useState(false);
  const [measureRef, size] = useMeasureSize<HTMLDivElement>();
  const setHost = useCallback((node: HTMLDivElement | null) => { measureRef(node); setChartHost(node); }, [measureRef]);
  const primary = useMemo(() => INTRADAY_SCOPES.find((scope) => layerScopes.includes(scope)) ?? "0dte", [layerScopes]);
  const segments = useMemo(() => scopes.map((scope, i) => ({ scope, data: results[i]?.data })), [scopes, results]);
  const source = useMemo(() => pickIntradayBars(segments, "0dte"), [segments]);
  const symbol = candleUnderlying(source);
  const aligned = useMemo(() => segments.filter((s) => sameUnderlying(s.data?.underlying_symbol, symbol)), [segments, symbol]);
  const layerSegments = useMemo(() => aligned.filter((segment) => layerScopes.includes(segment.scope)), [aligned, layerScopes]);
  const bars = useMemo(() => aggregateIntradayBars(source?.bars ?? [], minutes), [source?.bars, minutes]);
  const latestPrice = bars.at(-1)?.close;
  const levelsLayerVisible = levelLayerEnabled && levelLayerVisible;
  const positions = useMemo(
    () => levelsLayerVisible && levelsOn ? buildChartPositions(layerSegments, primary, symbol, latestPrice) : [],
    [levelsLayerVisible, levelsOn, layerSegments, primary, symbol, latestPrice],
  );
  const tick = optionProductConfig[product].tickSize;
  const profileWidth = Math.max(120, Math.min(400, vpW ?? 200));
  const profileVisible = vpOn && gexProfileVisible && !!vpModel?.rows.length;
  const optionVolumeVisible = optionVolumeProfileEnabled && optionVolumeProfileVisible && !!optionVolumeModel?.rows.length;
  const availableProfileWidth = Math.max(80, Math.floor((size.width || 920) * .46));
  const visibleProfileCount = Number(profileVisible) + Number(optionVolumeVisible);
  const renderedProfileWidth = visibleProfileCount > 1
    ? Math.max(36, Math.min(profileWidth, Math.floor((availableProfileWidth - 8) / 2)))
    : Math.min(profileWidth, availableProfileWidth);
  const gexRenderWidth = profileVisible ? renderedProfileWidth : 0;
  const optionVolumeRenderWidth = optionVolumeVisible ? renderedProfileWidth : 0;
  const profileGap = profileVisible && optionVolumeVisible ? 8 : 0;
  const primaryFlip = levelsLayerVisible ? layerSegments.find((s) => s.scope === primary)?.data?.current?.gamma_flip : undefined;
  const currentBarsByTime = useMemo(() => new Map(bars.map((bar) => [bar.unix, bar])), [bars]);
  const last = bars.at(-1), readout = (hovered ? currentBarsByTime.get(hovered.unix) : undefined) ?? last;
  const pending = results.length > 0 && results.every((r) => r.isPending);
  const failed = results.length > 0 && results.every((r) => r.isError);
  const emptyNotice = dataAvailabilityMessage(
    results.find((result) => result.data?.candle_notice)?.data?.candle_notice
      ?? results.find((result) => result.data?.missing_reason)?.data?.missing_reason,
    "当前交易时段暂无K线",
  );

  useEffect(() => {
    if (!profileSettingsOpen && !levelSettingsOpen && !exposureSettingsOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!legendRef.current?.contains(event.target as Node)) {
        setProfileSettingsOpen(false);
        setLevelSettingsOpen(false);
        setExposureSettingsOpen(false);
      }
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setProfileSettingsOpen(false);
        setLevelSettingsOpen(false);
        setExposureSettingsOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOutside, true);
    document.addEventListener("keydown", closeEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside, true);
      document.removeEventListener("keydown", closeEscape);
    };
  }, [profileSettingsOpen, levelSettingsOpen, exposureSettingsOpen]);

  // One chart per mounted panel. StrictMode/unmount destroys its canvas and listeners.
  useEffect(() => {
    const node = chartHost;
    if (!node) return;
    const colors = chartColors(node);
    const chart = createChart(node, {
      width: Math.max(1, node.clientWidth), height: Math.max(1, node.clientHeight),
      layout: { background: { type: ColorType.Solid, color: colors.background }, textColor: colors.text, fontFamily: colors.font, fontSize: 11, attributionLogo: true },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: colors.border, scaleMargins: { top: .1, bottom: .1 } },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: colors.border, rightOffsetPixels: 16, minBarSpacing: .5,
        tickMarkFormatter: (time: Time, kind: TickMarkType) => kind === TickMarkType.Year || kind === TickMarkType.Month || kind === TickMarkType.DayOfMonth ? date.format(timeDate(time)) : clock.format(timeDate(time)) },
      localization: { locale: "en-US", timeFormatter: (time: Time) => `${date.format(timeDate(time))} ${clock.format(timeDate(time))} ET` },
      handleScroll: true, handleScale: true,
    });
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: colors.buy,
      downColor: colors.sell,
      wickUpColor: colors.buy,
      wickDownColor: colors.sell,
      borderVisible: false,
      lastValueVisible: false,
      priceLineVisible: false,
    });
    const line = chart.addSeries(LineSeries, {
      color: colors.text,
      lineWidth: 2,
      visible: false,
      crosshairMarkerVisible: true,
      lastValueVisible: false,
      priceLineVisible: false,
    });
    const volume = chart.addSeries(HistogramSeries, {
      priceScaleId: "volume",
      priceFormat: { type: "volume" },
      priceLineVisible: false,
      lastValueVisible: false,
    });
    // Volume 是主图 Overlay 指标：独立隐藏比例尺，只占底部 20%，不改变价格轴。
    volume.priceScale().applyOptions({ scaleMargins: { top: .8, bottom: 0 } });
    const profile = new OptionOiProfilePrimitive(); candles.attachPrimitive(profile);
    const optionVolumeProfile = new OptionVolumeProfilePrimitive(); candles.attachPrimitive(optionVolumeProfile);
    runtime.current = { chart, candles, line, volume, active: candles, profile, optionVolumeProfile, priceLines: [], bars: [], key: "", colors };
    setChartApi(chart);
    const onCrosshair: Parameters<IChartApi["subscribeCrosshairMove"]>[0] = (event) => {
      setHovered(typeof event.time === "number" ? barsByTime.current.get(event.time) ?? null : null);
    };
    chart.subscribeCrosshairMove(onCrosshair);
    return () => { chart.unsubscribeCrosshairMove(onCrosshair); setChartApi((current) => current === chart ? null : current); chart.remove(); runtime.current = null; };
  }, [chartHost]);

  useEffect(() => { if (size.width > 0 && size.height > 0) runtime.current?.chart.resize(size.width, size.height); }, [chartApi, size]);

  useEffect(() => {
    const rt = runtime.current; if (!rt) return;
    // day 维度用 CME 交易日（17:00 CT 换日），不用 BFF 的 UTC 日期——后者在 UTC 00:00
    // （CT 18:00/19:00，晚盘交易中）突变，会盘中强制重置用户缩放平移。
    const key = `${symbol ?? product}:${minutes}:${cmeTradingDayKey()}`;
    const prevKey = rt.key;
    const hadBars = rt.bars.length > 0;
    const reset = prevKey !== key || !hadBars;
    const visibleLogical = rt.chart.timeScale().getVisibleLogicalRange();
    // reset 前抓时间域视野：整体重灌后按"同一时钟窗口"恢复，位置不再跳动（2026-09-11）
    const visibleTime = hadBars ? rt.chart.timeScale().getVisibleRange() : null;
    const updateFrom = !reset ? tailUpdateStart(rt.bars, bars) : null;
    const candleData = (b: IntradayBar) => ({ time: b.unix as UTCTimestamp, open: b.open, high: b.high, low: b.low, close: b.close });
    const lineData = (b: IntradayBar) => ({ time: b.unix as UTCTimestamp, value: b.close });
    const volumeData = (b: IntradayBar) => ({ time: b.unix as UTCTimestamp, value: b.volume, color: b.close >= b.open ? rt.colors.buy : rt.colors.sell });
    for (const series of [rt.candles, rt.line]) series.applyOptions({ priceFormat: { type: "custom", minMove: tick, formatter: (price: number) => formatPrice(price, tick) } });
    if (updateFrom === null) {
      rt.candles.setData(bars.map(candleData)); rt.line.setData(bars.map(lineData)); rt.volume.setData(bars.map(volumeData));
    } else {
      for (const bar of bars.slice(updateFrom)) { rt.candles.update(candleData(bar)); rt.line.update(lineData(bar)); rt.volume.update(volumeData(bar)); }
    }
    // Lightweight Charts 会在追加新 bar 时自动滚动到实时边缘。恢复更新前的逻辑区间，
    // 让用户当前观察位置保持不动；若补入更早历史，则按新增数量平移以锚定原蜡烛。
    if (!reset && visibleLogical) rt.chart.timeScale().setVisibleLogicalRange(preserveLogicalRange(rt.bars, bars, visibleLogical));
    barsByTime.current = new Map(bars.map((b) => [b.unix, b])); rt.bars = bars; rt.key = key;
    if (bars.length && !renderedOnce.current) { renderedOnce.current = true; setBarsEverRendered(true); }
    if (!reset || !bars.length) return;
    // 整体重灌后的视野处置分三种（旧实现一律 fitContent，任意 reset 都跳视野）：
    const dayChanged = !prevKey || prevKey.split(":").slice(2).join(":") !== key.split(":").slice(2).join(":");
    if (hadBars && !dayChanged && visibleTime) {
      // 合约符号/K线周期切换：锚定原时钟窗口，用户缩放平移不丢
      rt.chart.timeScale().setVisibleRange(visibleTime as { from: UTCTimestamp; to: UTCTimestamp });
      console.debug(`[ms-data] 06 数据重灌（${prevKey} → ${key}），视野按时间锚定`);
    } else {
      // 首次渲染 / 跨交易日 / 历史回看窗：回到默认视野（当日=开盘到收盘，回看=整窗）
      setHovered(null);
      if (historyOffsetDays > 0) {
        rt.chart.priceScale("right").setAutoScale(true);
        rt.chart.timeScale().fitContent();
      } else {
        fitSession(rt.chart);
      }
    }
  }, [bars, chartApi, symbol, product, minutes, tick, historyOffsetDays]);

  useEffect(() => {
    const rt = runtime.current; if (!rt) return;
    rt.candles.applyOptions({ visible: mode === "candles" });
    rt.line.applyOptions({ visible: mode === "line", color: primaryFlip != null && last ? (last.close >= primaryFlip ? rt.colors.buy : rt.colors.sell) : rt.colors.text });
    rt.active.detachPrimitive(rt.profile); rt.active.detachPrimitive(rt.optionVolumeProfile);
    rt.active = mode === "candles" ? rt.candles : rt.line;
    rt.active.attachPrimitive(rt.profile); rt.active.attachPrimitive(rt.optionVolumeProfile);
  }, [chartApi, mode, primaryFlip, last]);

  useEffect(() => {
    runtime.current?.volume.applyOptions({ visible: volumeIndicatorEnabled && volumeIndicatorVisible });
  }, [chartApi, volumeIndicatorEnabled, volumeIndicatorVisible]);

  useEffect(() => {
    const rt = runtime.current; if (!rt) return;
    rt.profile.configure(profileVisible ? vpModel!.rows : [], gexRenderWidth, tick, rt.colors);
    rt.optionVolumeProfile.configure(optionVolumeVisible ? optionVolumeModel!.rows : [], optionVolumeRenderWidth, profileVisible ? gexRenderWidth + profileGap : 0, tick, rt.colors);
    const reserved = gexRenderWidth + optionVolumeRenderWidth + profileGap;
    rt.chart.timeScale().applyOptions({ rightOffsetPixels: reserved > 0 ? reserved + 12 : 16 });
  }, [chartApi, profileVisible, vpModel, gexRenderWidth, optionVolumeVisible, optionVolumeModel, optionVolumeRenderWidth, profileGap, mode, tick]);

  useEffect(() => {
    const rt = runtime.current; if (!rt) return;
    for (const item of rt.priceLines) item.series.removePriceLine(item.line);
    rt.priceLines = positions.map((position) => {
      const color = position.kind === "CW" ? rt.colors.cw : position.kind === "PW" ? rt.colors.pw : position.kind === "FLIP" ? rt.colors.flip : rt.colors.spot;
      const title = position.kind === "SPOT" ? "SPOT" : `${position.scopes.map((s) => PREFIX[s]).join("+")}·${position.kind}`;
      return { series: rt.active, line: rt.active.createPriceLine({ price: position.price, title, color, lineWidth: 1, lineStyle: position.kind === "SPOT" ? LineStyle.Dotted : LineStyle.Dashed, axisLabelVisible: true }) };
    });
  }, [chartApi, positions, mode]);

  const resetView = () => { const rt = runtime.current; if (rt && bars.length) { if (historyOffsetDays > 0) { rt.chart.priceScale("right").setAutoScale(true); rt.chart.timeScale().fitContent(); } else fitSession(rt.chart); } };
  const button = "ms-control h-7 px-2 text-[11px] font-semibold text-[var(--ms-text-secondary)] aria-pressed:bg-[var(--ms-brand-dim)] aria-pressed:text-[var(--ms-brand)]";
  const scopeOptions: Array<{ value: OptionScope; label: string }> = [{value:"close",label:"前日EOD"},{value:"0dte",label:"0DTE"},{value:"d30",label:"30DTE"},{value:"d90",label:"90DTE"}];
  const profileSettingsPanel = (
    <div className="ms-popover w-56 p-2.5">
      <p className="mb-1.5 text-[11px] font-semibold text-[var(--ms-text-secondary)]">期权 OI 分布设置</p>
      <div className="flex flex-wrap gap-1">{scopeOptions.map((item) => <button key={item.value} type="button" className={button} aria-pressed={profileScope === item.value} onClick={() => onProfileScopeChange(item.value)}>{item.label}</button>)}</div>
    </div>
  );
  const exposureSettingsPanel = (
    <div className="ms-popover w-56 p-2.5">
      <p className="mb-1.5 text-[11px] font-semibold text-[var(--ms-text-secondary)]">Exposure 剖面设置</p>
      <div className="flex flex-wrap gap-1">{scopeOptions.map((item) => <button key={item.value} type="button" className={button} aria-pressed={exposureScope === item.value} onClick={() => onExposureScopeChange(item.value)}>{item.label}</button>)}</div>
    </div>
  );
  const levelSettingsPanel = (
    <div className="ms-popover w-56 p-2.5">
      <p className="mb-1.5 text-[11px] font-semibold text-[var(--ms-text-secondary)]">期权水位设置</p>
      <div className="flex flex-wrap gap-1">{scopeOptions.map((item) => <button key={item.value} type="button" className={button} aria-pressed={layerScopes.includes(item.value)} onClick={() => onToggleLayerScope(item.value)}>{item.label}</button>)}</div>
      <label className="mt-2 flex items-center justify-between text-[10px] text-[var(--ms-text-secondary)]">当前水位<input type="checkbox" checked={levelsOn} onChange={(e) => onLevelsOn(e.target.checked)} /></label>
    </div>
  );
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--ms-plot-bg)]" data-chart-engine="lightweight-charts" data-chart-symbol={symbol ?? ""} data-bar-count={bars.length} data-position-count={positions.length} data-gex-row-count={profileVisible ? vpModel?.rows.length ?? 0 : 0} data-option-volume-row-count={optionVolumeVisible ? optionVolumeModel?.rows.length ?? 0 : 0}>
      <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-1.5 border-b border-[var(--ms-separator)] bg-[var(--ms-panel-bg)] px-2.5 py-1.5">
        {leadingControls}
        <select aria-label="K线周期" className={button} value={minutes} onChange={(e) => onMinutesChange(Number(e.target.value))}>{PERIODS.map((p) => <option key={p.minutes} value={p.minutes}>{p.label}</option>)}</select>
        <select aria-label="价格渲染模式" className={button} value={mode} onChange={(e) => setMode(e.target.value as "candles" | "line")}><option value="candles">蜡烛</option><option value="line">折线</option></select>
        <div className="relative">
          <button type="button" aria-label="添加指标" aria-expanded={indicatorMenuOpen} className={button} onClick={() => setIndicatorMenuOpen((open) => !open)}>+ 指标</button>
          {indicatorMenuOpen ? <div className="ms-popover absolute left-0 top-full z-50 mt-2 w-44 p-1.5">
            <button type="button" disabled={vpOn} onClick={() => { onVpEnabled(true); setIndicatorMenuOpen(false); }} className="flex w-full items-center justify-between rounded-[8px] px-2.5 py-2 text-left text-[11px] font-semibold text-[var(--ms-text-secondary)] hover:bg-[var(--ms-brand-dim)] hover:text-[var(--ms-text-primary)] disabled:opacity-60"><span>期权 OI 分布</span>{vpOn ? <Check size={12} /> : <span>添加</span>}</button>
            <button type="button" disabled={optionVolumeProfileEnabled} onClick={() => { onOptionVolumeProfileEnabled(true); setIndicatorMenuOpen(false); }} className="flex w-full items-center justify-between rounded-[8px] px-2.5 py-2 text-left text-[11px] font-semibold text-[var(--ms-text-secondary)] hover:bg-[var(--ms-brand-dim)] hover:text-[var(--ms-text-primary)] disabled:opacity-60"><span>期权成交量分布</span>{optionVolumeProfileEnabled ? <Check size={12} /> : <span>添加</span>}</button>
            <button type="button" disabled={exposureProfileEnabled} onClick={() => { onExposureProfileEnabled(true); setIndicatorMenuOpen(false); }} className="flex w-full items-center justify-between rounded-[8px] px-2.5 py-2 text-left text-[11px] font-semibold text-[var(--ms-text-secondary)] hover:bg-[var(--ms-brand-dim)] hover:text-[var(--ms-text-primary)] disabled:opacity-60"><span>Exposure 剖面</span>{exposureProfileEnabled ? <Check size={12} /> : <span>添加</span>}</button>
            <a href="https://subapp.marsoon.cn/" target="_blank" rel="noopener noreferrer" onClick={() => setIndicatorMenuOpen(false)} className="flex w-full items-center justify-between rounded-[8px] px-2.5 py-2 text-left text-[11px] font-semibold text-[var(--ms-text-secondary)] hover:bg-[var(--ms-brand-dim)] hover:text-[var(--ms-text-primary)]"><span>期权成交热图</span><span>打开</span></a>
            <button type="button" disabled={levelLayerEnabled} onClick={() => { onLevelLayerEnabled(true); setIndicatorMenuOpen(false); }} className="flex w-full items-center justify-between rounded-[8px] px-2.5 py-2 text-left text-[11px] font-semibold text-[var(--ms-text-secondary)] hover:bg-[var(--ms-brand-dim)] hover:text-[var(--ms-text-primary)] disabled:opacity-60"><span>期权水位</span>{levelLayerEnabled ? <Check size={12} /> : <span>添加</span>}</button>
            <button type="button" disabled={volumeIndicatorEnabled} onClick={() => { onVolumeIndicatorEnabled(true); setIndicatorMenuOpen(false); }} className="flex w-full items-center justify-between rounded-[8px] px-2.5 py-2 text-left text-[11px] font-semibold text-[var(--ms-text-secondary)] hover:bg-[var(--ms-brand-dim)] hover:text-[var(--ms-text-primary)] disabled:opacity-60"><span>成交量</span>{volumeIndicatorEnabled ? <Check size={12} /> : <span>添加</span>}</button>
          </div> : null}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" className={button} onClick={() => onHistoryWindow(historyDays, historyOffsetDays + 1)} title="向前加载历史">‹</button>
          <select aria-label="历史K线范围" className={button} value={historyDays} onChange={(e) => onHistoryWindow(Number(e.target.value) as 1 | 3 | 7, historyOffsetDays)}><option value={1}>{historyOffsetDays ? `前 ${historyOffsetDays + 1} 日` : "当日"}</option><option value={3}>3日</option><option value={7}>7日</option></select>
          {historyOffsetDays > 0 ? <span className="font-mono text-[9px] text-[var(--ms-text-tertiary)]">前移 {historyOffsetDays} 日</span> : null}
          {historyOffsetDays > 0 ? <button type="button" className={button} onClick={() => onHistoryWindow(historyDays, historyOffsetDays - 1)} title="向后一天">›</button> : null}
          <button type="button" className={button} onClick={resetView} disabled={!bars.length} title="重置视野">↺</button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <div ref={setHost} className="absolute inset-0" role="img" aria-label={`${instrumentName(symbol ?? product)} K线、期货成交量、期权成交量分布与期权价位`} />
          {readout && size.width >= 360 ? <div className="pointer-events-none absolute left-2 top-2 z-30 max-w-[calc(100%-1rem)] truncate rounded-[4px] bg-[color-mix(in_srgb,var(--ms-panel-bg)_88%,transparent)] px-1.5 py-1 font-mono text-[10px] tabular-nums text-[var(--ms-text-secondary)]" aria-live="off">
            <span>{clock.format(new Date(readout.unix * 1000))} ET　O {formatPrice(readout.open, tick)}　H {formatPrice(readout.high, tick)}　L {formatPrice(readout.low, tick)}　C {formatPrice(readout.close, tick)}　V {formatInteger(readout.volume)}</span>
          </div> : null}
        {vpOn || optionVolumeProfileEnabled || levelLayerEnabled || volumeIndicatorEnabled || exposureProfileEnabled ? <div ref={legendRef} className={`absolute left-2 ${readout && size.width >= 360 ? "top-10" : "top-2"} z-30 flex flex-col items-start gap-1 font-mono text-[10px]`}>
          <div id={legendListId} className={legendsCollapsed ? "hidden" : "flex flex-col items-start gap-1"}>
          {vpOn ? <div className="group/profile relative">
            <div onClick={() => { setProfileSettingsOpen((open) => !open); setLevelSettingsOpen(false); }} className={`flex h-7 cursor-pointer items-center gap-1 rounded-[8px] border border-[var(--ms-separator)] bg-[var(--ms-panel-bg)] px-1.5 ${gexProfileVisible ? "text-[var(--ms-text-primary)]" : "text-[var(--ms-text-tertiary)]"}`}>
              <span className="mr-1 text-[var(--ms-text-primary)]">期权OI分布 · {LEGEND_PREFIX[profileScope]}</span>
              <button type="button" aria-label={gexProfileVisible ? "隐藏期权 OI 分布" : "显示期权 OI 分布"} aria-pressed={gexProfileVisible} onClick={(event) => { event.stopPropagation(); onGexProfileVisible(!gexProfileVisible); }} className="p-0.5 text-[var(--ms-text-secondary)] hover:text-[var(--ms-text-primary)]">{gexProfileVisible ? <Eye size={13} /> : <EyeOff size={13} />}</button>
              <button type="button" aria-label="设置期权 OI 分布" aria-expanded={profileSettingsOpen} onClick={(event) => { event.stopPropagation(); setProfileSettingsOpen((open) => !open); setLevelSettingsOpen(false); }} className="p-0.5 text-[var(--ms-text-secondary)] hover:text-[var(--ms-text-primary)]"><Settings2 size={13} /></button>
              <button type="button" aria-label="删除期权 OI 分布" onClick={(event) => { event.stopPropagation(); setProfileSettingsOpen(false); onVpEnabled(false); }} className="p-0.5 text-[var(--ms-text-secondary)] hover:text-[var(--ms-danger)]"><X size={13} /></button>
            </div>
            <div className={`${profileSettingsOpen ? "visible opacity-100" : "invisible opacity-0"} absolute left-0 top-full z-40 mt-1 transition`}>
              {profileSettingsPanel}
            </div>
          </div> : null}
          {optionVolumeProfileEnabled ? <div className={`flex h-7 items-center gap-1 rounded-[8px] border border-[var(--ms-separator)] bg-[var(--ms-panel-bg)] px-1.5 ${optionVolumeProfileVisible ? "text-[var(--ms-text-primary)]" : "text-[var(--ms-text-tertiary)]"}`}>
            <span className="mr-1 text-[var(--ms-text-primary)]" title={optionVolumeModel?.isFallback ? "当前范围无成交，显示最近一个有数据的 CME 交易日" : "当前图表时间范围内的 0DTE 期权成交量"}>期权成交量分布 · 0DTE{optionVolumeModel?.isFallback ? " · 上一交易日" : ""}</span>
            <button type="button" aria-label={optionVolumeProfileVisible ? "隐藏期权成交量分布" : "显示期权成交量分布"} aria-pressed={optionVolumeProfileVisible} onClick={() => onOptionVolumeProfileVisible(!optionVolumeProfileVisible)} className="p-0.5 text-[var(--ms-text-secondary)] hover:text-[var(--ms-text-primary)]">{optionVolumeProfileVisible ? <Eye size={13} /> : <EyeOff size={13} />}</button>
            <button type="button" aria-label="删除期权成交量分布" onClick={() => onOptionVolumeProfileEnabled(false)} className="p-0.5 text-[var(--ms-text-secondary)] hover:text-[var(--ms-danger)]"><X size={13} /></button>
          </div> : null}
          {exposureProfileEnabled ? <div className="group/exposure relative">
            <div onClick={() => { setExposureSettingsOpen((open) => !open); setProfileSettingsOpen(false); setLevelSettingsOpen(false); }} className={`flex h-7 cursor-pointer items-center gap-1 rounded-[8px] border border-[var(--ms-separator)] bg-[var(--ms-panel-bg)] px-1.5 ${exposureProfileVisible ? "text-[var(--ms-text-primary)]" : "text-[var(--ms-text-tertiary)]"}`}>
              <span className="mr-1 text-[var(--ms-text-primary)]">Exposure 剖面 · {LEGEND_PREFIX[exposureScope]}</span>
              <button type="button" aria-label={exposureProfileVisible ? "隐藏 Exposure 剖面" : "显示 Exposure 剖面"} aria-pressed={exposureProfileVisible} onClick={(event) => { event.stopPropagation(); onExposureProfileVisible(!exposureProfileVisible); }} className="p-0.5 text-[var(--ms-text-secondary)] hover:text-[var(--ms-text-primary)]">{exposureProfileVisible ? <Eye size={13} /> : <EyeOff size={13} />}</button>
              <button type="button" aria-label="设置 Exposure 剖面" aria-expanded={exposureSettingsOpen} onClick={(event) => { event.stopPropagation(); setExposureSettingsOpen((open) => !open); setProfileSettingsOpen(false); setLevelSettingsOpen(false); }} className="p-0.5 text-[var(--ms-text-secondary)] hover:text-[var(--ms-text-primary)]"><Settings2 size={13} /></button>
              <button type="button" aria-label="删除 Exposure 剖面" onClick={(event) => { event.stopPropagation(); setExposureSettingsOpen(false); onExposureProfileEnabled(false); }} className="p-0.5 text-[var(--ms-text-secondary)] hover:text-[var(--ms-danger)]"><X size={13} /></button>
            </div>
            <div className={`${exposureSettingsOpen ? "visible opacity-100" : "invisible opacity-0"} absolute left-0 top-full z-40 mt-1 transition`}>
              {exposureSettingsPanel}
            </div>
          </div> : null}
          {levelLayerEnabled ? <div className="group/levels relative">
            <div onClick={() => { setLevelSettingsOpen((open) => !open); setProfileSettingsOpen(false); }} className={`flex h-7 cursor-pointer items-center gap-1 rounded-[8px] border border-[var(--ms-separator)] bg-[var(--ms-panel-bg)] px-1.5 ${levelLayerVisible ? "text-[var(--ms-text-primary)]" : "text-[var(--ms-text-tertiary)]"}`}>
              <span className="mr-1 text-[var(--ms-text-primary)]">期权水位 · {layerScopes.map((scope) => LEGEND_PREFIX[scope]).join("+")}</span>
              <button type="button" aria-label={levelLayerVisible ? "隐藏期权水位" : "显示期权水位"} aria-pressed={levelLayerVisible} onClick={(event) => { event.stopPropagation(); onLevelLayerVisible(!levelLayerVisible); }} className="p-0.5 text-[var(--ms-text-secondary)] hover:text-[var(--ms-text-primary)]">{levelLayerVisible ? <Eye size={13} /> : <EyeOff size={13} />}</button>
              <button type="button" aria-label="设置期权水位" aria-expanded={levelSettingsOpen} onClick={(event) => { event.stopPropagation(); setLevelSettingsOpen((open) => !open); setProfileSettingsOpen(false); }} className="p-0.5 text-[var(--ms-text-secondary)] hover:text-[var(--ms-text-primary)]"><Settings2 size={13} /></button>
              <button type="button" aria-label="删除期权水位" onClick={(event) => { event.stopPropagation(); setLevelSettingsOpen(false); onLevelLayerEnabled(false); }} className="p-0.5 text-[var(--ms-text-secondary)] hover:text-[var(--ms-danger)]"><X size={13} /></button>
            </div>
            <div className={`${levelSettingsOpen ? "visible opacity-100" : "invisible opacity-0"} absolute left-0 top-full z-40 mt-1 transition`}>
              {levelSettingsPanel}
            </div>
          </div> : null}
          {volumeIndicatorEnabled ? <div className={`flex h-7 items-center gap-1 rounded-[8px] border border-[var(--ms-separator)] bg-[var(--ms-panel-bg)] px-1.5 ${volumeIndicatorVisible ? "text-[var(--ms-text-primary)]" : "text-[var(--ms-text-tertiary)]"}`}>
            <span className="mr-1 text-[var(--ms-text-primary)]">成交量</span>
            <button type="button" aria-label={volumeIndicatorVisible ? "隐藏 Volume" : "显示 Volume"} aria-pressed={volumeIndicatorVisible} onClick={() => onVolumeIndicatorVisible(!volumeIndicatorVisible)} className="p-0.5 text-[var(--ms-text-secondary)] hover:text-[var(--ms-text-primary)]">{volumeIndicatorVisible ? <Eye size={13} /> : <EyeOff size={13} />}</button>
            <button type="button" aria-label="删除 Volume" onClick={() => onVolumeIndicatorEnabled(false)} className="p-0.5 text-[var(--ms-text-secondary)] hover:text-[var(--ms-danger)]"><X size={13} /></button>
          </div> : null}
          </div>
          <button
            type="button"
            aria-label={legendsCollapsed ? "展开图例列表" : "折叠图例列表"}
            aria-expanded={!legendsCollapsed}
            aria-controls={legendListId}
            title={legendsCollapsed ? "展开图例列表" : "折叠图例列表"}
            onClick={() => {
              setLegendsCollapsed((collapsed) => !collapsed);
              setProfileSettingsOpen(false);
              setLevelSettingsOpen(false);
              setExposureSettingsOpen(false);
            }}
            className="ms-control grid h-6 w-7 place-items-center text-[10px] text-[var(--ms-text-primary)]"
          >
            <span aria-hidden="true">{legendsCollapsed ? "▼" : "▲"}</span>
          </button>
        </div> : null}
          {!bars.length && !barsEverRendered && <div className="absolute inset-0 grid place-items-center bg-[var(--ms-plot-bg)] px-4 text-center text-sm text-[var(--ms-text-secondary)]">{pending ? "读取分钟K线中…" : failed ? "日内数据加载失败" : emptyNotice}</div>}
        </div>
        {exposureProfileEnabled && exposureProfileVisible ? (
          <div className="h-[clamp(140px,28%,240px)] shrink-0 border-t border-[var(--ms-separator)]">
            <ExposureProfilePane model={exposureModel} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
