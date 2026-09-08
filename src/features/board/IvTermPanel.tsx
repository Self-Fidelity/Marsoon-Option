"use client";

import { useId, useMemo, useRef, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { getIvTerm, type IvTermPoint, type IvTermResponse, type OptionProduct, type OptionScope } from "@/api/options";
import { dataAvailabilityMessage } from "@/lib/data-messages";
import { useMeasureSize } from "./use-measure-size";
import { ivTermGroups, ivTermPaths, ivTermX, type IvTermAxis } from "./iv-term-model";
import { clampStrikeViewport, panStrikeViewport, zoomStrikeViewport, type StrikeViewport } from "./overview-viewport";
import { useBoardWindowStore } from "./board-window-store";

const COLORS = ["var(--ms-brand)", "var(--ms-key-gamma)", "var(--ms-buy-bright)", "var(--ms-sell-bright)", "var(--ms-text-secondary)"];
const timeFormat = new Intl.DateTimeFormat("zh-CN", { timeZone: "America/Chicago", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const expiryFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Chicago", month: "2-digit", day: "2-digit" });
const control = "ms-control h-8 px-2 text-[11px] font-semibold text-[var(--ms-text-secondary)]";
const percent = (value: number) => `${(value * 100).toFixed(2)}%`;
function calendarDate(unix: number) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(unix * 1000);
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
function earlierDate(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - days);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Every curve is one real futures contract and one observed snapshot. */
export function IvTermPanel({ product, scope, panelId }: { product: OptionProduct; scope: OptionScope; panelId: string }) {
  const axis = useBoardWindowStore((state) => state.windows[panelId]?.ivTermAxis ?? "dte") as IvTermAxis;
  const dates = useBoardWindowStore((state) => state.windows[panelId]?.ivTermDates ?? []);
  const setIvTermAxis = useBoardWindowStore((state) => state.setIvTermAxis);
  const setIvTermDates = useBoardWindowStore((state) => state.setIvTermDates);
  const [dateInput, setDateInput] = useState("");
  const [hidden, setHidden] = useState<string[]>([]);
  const [viewport, setViewport] = useState<StrikeViewport | null>(null);
  const [hover, setHover] = useState<{ point: IvTermPoint; data: IvTermResponse; label: string } | null>(null);
  const drag = useRef<{ x: number; viewport: StrikeViewport } | null>(null);
  const [plotRef, size] = useMeasureSize<HTMLDivElement>();
  const clipId = useId();
  const requests = [undefined, ...dates];
  const results = useQueries({ queries: requests.map((date) => ({
    queryKey: ["iv-term", product, scope, date ?? "current"],
    queryFn: ({ signal }: { signal: AbortSignal }) => getIvTerm(
      product,
      scope,
      date,
      AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
    ),
    staleTime: date ? Infinity : 30_000,
    retry: false,
    refetchInterval: date ? false as const : 60_000,
    refetchOnWindowFocus: false,
  })) });
  const curves = results.flatMap((result, i) => result.data?.has_data && !result.isError
    ? ivTermGroups(result.data).map((group) => ({ ...group, data: result.data!, label: requests[i] ?? "当前", index: i, key: `${requests[i] ?? "current"}:${group.symbol}` })) : []);
  const symbols = [...new Set(curves.map((curve) => curve.symbol))].sort();
  const shown = curves.filter((curve) => !hidden.includes(curve.key));
  const points = shown.flatMap((curve) => curve.points.map((point) => ({ point, curve })));
  const allX = points.map(({ point, curve }) => ivTermX(point, curve.data.snapshot_unix, axis));
  const xMin = allX.length ? Math.min(...allX) : 0, xMax = allX.length ? Math.max(...allX) : 1;
  const full = { lo: xMin, hi: Math.max(xMin + 1, xMax) };
  const view = viewport ? clampStrikeViewport(viewport, full, .25) : full;
  const w = size.width || 560, h = size.height || 330;
  const left = 48, right = Math.max(left + 1, w - 14), top = 14, bottom = Math.max(top + 1, h - 28);
  const x = (value: number) => left + (value - view.lo) / (view.hi - view.lo) * (right - left);
  const valid = points.filter(({ point }) => point.atm_iv !== null && Number.isFinite(point.atm_iv));
  const ivs = valid.map(({ point }) => point.atm_iv!);
  const ivMin = ivs.length ? Math.min(...ivs) : 0, ivMax = ivs.length ? Math.max(...ivs) : .1;
  const pad = Math.max(.005, (ivMax - ivMin) * .15), yLo = Math.max(0, ivMin - pad), yHi = ivMax + pad;
  const y = (iv: number) => bottom - (iv - yLo) / (yHi - yLo) * (bottom - top);
  const tickCount = Math.max(2, Math.min(6, Math.floor((right - left) / 80)));
  const ticks = Array.from({ length: tickCount }, (_, i) => view.lo + (view.hi - view.lo) * i / (tickCount - 1));
  const sourceDate = results[0]?.data?.snapshot_unix ? calendarDate(results[0].data.snapshot_unix) : calendarDate(Date.now() / 1000);
  const addDate = (date: string) => { if (date && !dates.includes(date) && dates.length < 2) { setIvTermDates(panelId, [...dates, date]); setDateInput(""); setViewport(null); setHover(null); } };
  const color = (symbol: string) => COLORS[symbols.indexOf(symbol) % COLORS.length]!;
  const current = shown.filter((curve) => curve.index === 0);
  const spreads = current.map((curve) => {
    const values = curve.points.filter((point) => point.atm_iv !== null);
    return { symbol: curve.symbol, front: values[0], back: values[1] };
  });
  const loading = results.some((r) => r.isPending);

  return <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--ms-plot-bg)] p-2" data-iv-term-axis={axis}>
    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
      <div className="ms-control flex p-0.5" aria-label="期限横轴">
        {([['dte', 'DTE'], ['date', '到期日期']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={axis === value} onClick={() => { setIvTermAxis(panelId, value); setViewport(null); setHover(null); }} className={`h-7 rounded-[7px] px-2 text-[11px] font-semibold ${axis === value ? "bg-[var(--ms-brand)] text-black" : "text-[var(--ms-text-secondary)]"}`}>{label}</button>)}
      </div>
      <button type="button" className={control} disabled={dates.length >= 2} onClick={() => addDate(earlierDate(sourceDate, 1))}>前一日</button>
      <button type="button" className={control} disabled={dates.length >= 2} onClick={() => addDate(earlierDate(sourceDate, 7))}>一周前</button>
      <input aria-label="历史IV对比日期" type="date" value={dateInput} onChange={(e) => setDateInput(e.target.value)} max={new Date(Date.parse(`${calendarDate(Date.now()/1000)}T00:00:00Z`) - 86400000).toISOString().slice(0, 10)} className={`${control} min-w-0 w-[128px] [color-scheme:dark]`} />
      <button type="button" className={control} disabled={!dateInput || dates.length >= 2 || dates.includes(dateInput)} onClick={() => addDate(dateInput)}>添加对比</button>
      <button type="button" className={`${control} ml-auto`} onClick={() => setViewport(null)} title="复位；图内滚轮缩放、拖动平移、双击复位">↺</button>
    </div>
    <div className="mt-1 flex shrink-0 flex-wrap gap-x-3 text-[10px] text-[var(--ms-text-secondary)]">
      <span>ATM IV · 同合约连线</span>
      {spreads.map(({ symbol, front, back }) => <span key={symbol} className="font-mono" title="同一期货标的、最近两个有效到期的ATM IV之差">{symbol} 近−远 {front && back ? `${((front.atm_iv! - back.atm_iv!) * 100).toFixed(2)}pt` : "—"}</span>)}
    </div>
    <div className="mt-1 flex shrink-0 flex-wrap gap-1 text-[10px]">
      {requests.map((date, i) => <span key={date ?? 'current'} className="flex items-center gap-1 text-[var(--ms-text-tertiary)]">
        {date ?? '当前'}：{results[i]?.isPending ? '加载中…' : results[i]?.isError ? '读取失败' : results[i]?.data?.has_data ? `${timeFormat.format(new Date(results[i].data!.snapshot_unix * 1000))} CT` : dataAvailabilityMessage(results[i]?.data?.missing_reason, '无数据')}
        {date ? <button className="px-1 text-[var(--ms-text-secondary)]" aria-label={`删除${date}对比`} onClick={() => { setIvTermDates(panelId, dates.filter((d) => d !== date)); setHover(null); }}>×</button> : null}
      </span>)}
    </div>
    <div ref={plotRef} className="relative mt-1 min-h-0 flex-1 overflow-hidden">
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="absolute left-0 top-0 touch-none select-none" role="img" aria-label="ATM IV期限结构，按期货合约与快照分组" data-iv-point-count={valid.length}
        onDoubleClick={() => setViewport(null)}
        onWheel={(e) => { e.preventDefault(); const bounds = e.currentTarget.getBoundingClientRect(); const fraction = Math.max(0, Math.min(1, (e.clientX - bounds.left - left)/(right-left))); setViewport(zoomStrikeViewport(view, full, view.lo + fraction*(view.hi-view.lo), e.deltaY, .25)); setHover(null); }}
        onPointerDown={(e) => { if (e.button !== 0) return; drag.current = { x: e.clientX, viewport: view }; e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerUp={(e) => { drag.current = null; if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
        onPointerCancel={() => { drag.current = null; }}
        onPointerLeave={() => { if (!drag.current) setHover(null); }}
        onPointerMove={(e) => {
          if (drag.current) { setViewport(panStrikeViewport(drag.current.viewport, full, (drag.current.x-e.clientX)/(right-left), .25)); setHover(null); return; }
          const rect = e.currentTarget.getBoundingClientRect(), px=e.clientX-rect.left, py=e.clientY-rect.top;
          if (px<left || px>right || py<top || py>bottom) { setHover(null); return; }
          const nearest = valid.filter(({ point, curve }) => { const xp=x(ivTermX(point,curve.data.snapshot_unix,axis)); return xp>=left && xp<=right; }).reduce<{ point: IvTermPoint; curve: typeof curves[number]; distance: number } | null>((best, item) => {
            const distance=Math.hypot(x(ivTermX(item.point,item.curve.data.snapshot_unix,axis))-px,y(item.point.atm_iv!)-py);
            return !best || distance<best.distance ? {...item,distance} : best;
          },null);
          setHover(nearest && nearest.distance<36 ? { point: nearest.point, data: nearest.curve.data, label: nearest.curve.label } : null);
        }}>
        <defs><clipPath id={clipId}><rect x={left} y={top} width={right-left} height={bottom-top} /></clipPath></defs>
        <line x1={left} y1={bottom} x2={right} y2={bottom} stroke="var(--ms-separator)" />
        {Array.from({length:4},(_,i)=> yLo+(yHi-yLo)*i/3).map((v) => <text key={v} x={left-5} y={y(v)+3} textAnchor="end" fontSize={10} className="font-mono" fill="var(--ms-text-secondary)">{(v*100).toFixed(1)}%</text>)}
        {ticks.map((v) => <text key={v} x={x(v)} y={h-9} textAnchor="middle" fontSize={9} className="font-mono" fill="var(--ms-text-secondary)">{axis==='dte' ? `${v.toFixed(v<10?1:0)}d` : expiryFormat.format(new Date(v*86400000))}</text>)}
        <g clipPath={`url(#${clipId})`}>
          {shown.map((curve) => <g key={curve.key} opacity={curve.index===0?1:.72}>
            {ivTermPaths(curve.points,(p)=>x(ivTermX(p,curve.data.snapshot_unix,axis)),y).map((d,i)=><path key={i} d={d} fill="none" stroke={color(curve.symbol)} strokeWidth={curve.index===0?1.8:1.2} strokeDasharray={curve.index===0?undefined:curve.index===1?'6 4':'2 4'} />)}
            {curve.points.map((p,i)=>p.atm_iv!==null?<circle key={i} cx={x(ivTermX(p,curve.data.snapshot_unix,axis))} cy={y(p.atm_iv)} r={curve.index===0?3:2} fill={color(curve.symbol)} />:null)}
          </g>)}
          {hover ? <><line x1={x(ivTermX(hover.point,hover.data.snapshot_unix,axis))} x2={x(ivTermX(hover.point,hover.data.snapshot_unix,axis))} y1={top} y2={bottom} stroke="var(--ms-axis)" strokeDasharray="3 3" /><circle cx={x(ivTermX(hover.point,hover.data.snapshot_unix,axis))} cy={y(hover.point.atm_iv!)} r={5} fill="none" stroke="var(--ms-text-primary)" /></> : null}
        </g>
      </svg>
      {!valid.length ? <div className="pointer-events-none absolute inset-0 grid place-items-center text-[12px] text-[var(--ms-text-secondary)]">{loading ? '加载ATM IV…' : curves.length ? '图例已隐藏，点击下方图例恢复' : '所选范围暂无有效 ATM IV'}</div> : null}
      {hover ? <div className="ms-popover pointer-events-none absolute right-3 top-2 p-2 text-[10px] text-[var(--ms-text-primary)]">
        <div>{hover.label} · {hover.point.underlying_symbol}</div>
        <div className="font-mono">到期 {calendarDate(hover.point.expiration)} · {((hover.point.expiration-hover.data.snapshot_unix)/86400).toFixed(2)} DTE</div>
        <div className="font-mono">ATM IV {percent(hover.point.atm_iv!)}</div>
        <div className="text-[var(--ms-text-tertiary)]">采样 {timeFormat.format(new Date(hover.point.observed_min_unix*1000))}–{timeFormat.format(new Date(hover.point.observed_max_unix*1000))} CT</div>
      </div> : null}
    </div>
    <div className="mt-1 flex shrink-0 flex-wrap gap-x-3 gap-y-1">
      {curves.map((curve)=><button key={curve.key} type="button" aria-pressed={!hidden.includes(curve.key)} onClick={()=>{setHidden((old)=>old.includes(curve.key)?old.filter((key)=>key!==curve.key):[...old,curve.key]);setHover(null);}} className={`flex items-center gap-1 text-[10px] ${hidden.includes(curve.key)?'opacity-35':''}`} style={{color:color(curve.symbol)}}><span>{curve.index===0?'━':curve.index===1?'┄':'┈'}</span>{curve.label} · {curve.symbol}</button>)}
    </div>
    <p className="mt-1 shrink-0 text-[9px] text-[var(--ms-text-tertiary)]">历史取所选日16:00 CT前可用快照；缺失断线。DTE按各自快照计算。最多对比两日。</p>
  </div>;
}
