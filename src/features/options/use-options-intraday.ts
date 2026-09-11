import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import {
  getOptionIntraday,
  getOptionIntradayBars,
  type OptionProduct,
  type OptionScope,
  type OptionsIntradayResponse,
} from "../../api/options";
import { isCmeSessionOpen } from "../../lib/cme-session";
import { candleStreamSymbolMismatch, mergeCandleStreamBars, type CandleStreamBatch } from "../board/candle-stream";
import { candleUnderlying, unionBars } from "../board/intraday-data";
import { acquireCandleStream } from "./candle-stream-manager";
import { scopeStaleTimeMs } from "./data-freshness";

export const optionsIntradayKeys = {
  all: ["options-intraday"] as const,
  detail: (product: OptionProduct, scope: OptionScope, days = 1, offsetDays = 0) =>
    [...optionsIntradayKeys.all, product, scope, days, offsetDays] as const,
  bars: (product: OptionProduct, days = 1, offsetDays = 0) =>
    [...optionsIntradayKeys.all, "bars-only", product, days, offsetDays] as const,
  barsTail: (product: OptionProduct, days = 1, offsetDays = 0) =>
    [...optionsIntradayKeys.all, "bars-tail", product, days, offsetDays] as const,
};

function historyRange(days: number, offsetDays: number) {
  const to = Math.floor(Date.now() / 60_000) * 60 + 1 - offsetDays * 86400;
  return { from: to - days * 86400, to, asof: to - 1 };
}

/**
 * 刷新只取尾部窗口（2026-09-10 性能修复）。
 *
 * 实测：K 线是 **1 分钟 OHLC 定秒数据**（单根 `{unix,o,h,l,c,v,final}` 约 109B，无 tick 字段），
 * 但前端原先每次刷新都重拉整窗 24h —— 1379 根 = **142KB**，在 Go 链路上要 **16.7 秒**；
 * 而只取最近 30 分钟 = **3.3KB / 0.73 秒**。延迟几乎全部来自"重复传输用不到的历史"。
 * 因此：初始历史照旧拉全窗一次；之后的每分钟刷新、WS 看门狗补拉，一律只取尾部小窗，
 * 用与 WS 相同的 merge 逻辑并入主缓存（历史不丢，载荷降约 40 倍）。
 */
const TAIL_SECONDS = 1800;
function tailRange(offsetDays: number) {
  const to = Math.floor(Date.now() / 60_000) * 60 + 1 - offsetDays * 86400;
  return { from: to - TAIL_SECONDS, to, asof: to - 1 };
}

export function useOptionsIntradayBars(product: OptionProduct, days = 1, offsetDays = 0, enabled = true) {
  const queryClient = useQueryClient();
  const key = optionsIntradayKeys.bars(product, days, offsetDays);
  return useQuery({
    queryKey: key,
    enabled,
    // 整窗历史只拉一次（142KB / ~17s，不宜反复）。
    // ⚠️ 结果"只增不减"：任何一次上游瞬时缺数据的响应都不允许抹掉已有历史
    // （2026-09-10 用户实测：K 线历史被某次降级响应整体替换，只剩最后几根）。
    queryFn: async ({ signal }) => {
      const payload = await getOptionIntradayBars(product, signal, historyRange(days, offsetDays));
      const previous = queryClient.getQueryData<OptionsIntradayResponse>(key);
      const previousBars = previous?.bars;
      if (!payload.bars?.length) return previous ?? payload;
      if (!previousBars?.length) return payload;
      const merged = unionBars(previousBars, payload.bars, candleUnderlying(previous), candleUnderlying(payload));
      return merged.length === payload.bars.length ? payload : { ...payload, bars: merged };
    },
    // 实时增量：WS 推送（useOptionsCandleStream）+ 尾部小窗刷新（useOptionsCandleTail）。
    staleTime: Number.POSITIVE_INFINITY,
    refetchInterval: false,
    refetchIntervalInBackground: false,
  });
}

/**
 * 尾部小窗刷新：每分钟只取最近 TAIL_SECONDS 秒的 K 线（约 3KB / <1s），
 * 用与 WS 相同的 merge 逻辑并入主缓存。
 *
 * 为什么不直接给主查询挂 refetchInterval：主查询的 queryFn 用固定整窗范围，
 * 每次 refetch 都会重传 142KB 的整窗历史 —— 这正是"K线更新很慢"的主因。
 */
export function useOptionsCandleTail(product: OptionProduct, days = 1, offsetDays = 0, enabled = true) {
  const queryClient = useQueryClient();
  const mainKey = optionsIntradayKeys.bars(product, days, offsetDays);
  const query = useQuery({
    queryKey: optionsIntradayKeys.barsTail(product, days, offsetDays),
    queryFn: ({ signal }) => getOptionIntradayBars(product, signal, tailRange(offsetDays)),
    enabled,
    staleTime: 30_000,
    // 定频对齐整分钟 +4s（§3.2）：refetchInterval 从上次完成起算会漂移，
    // 改用下方 useEffect 的墙钟对齐定时器；休市与历史回看窗不排程。
    refetchInterval: false,
    refetchIntervalInBackground: false,
  });
  const { refetch } = query;
  useEffect(() => {
    if (!enabled || offsetDays > 0) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      const now = Date.now();
      const next = (Math.floor(now / 60_000) + 1) * 60_000 + 4_000;
      timer = setTimeout(fire, next - now);
    };
    const fire = () => {
      if (isCmeSessionOpen() && !document.hidden) void refetch();
      schedule();
    };
    schedule();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [enabled, offsetDays, refetch]);
  const tail = query.data;
  // 换月/参考合约重锚定节流：状态变化（新符号出现）即触发一次整窗 refetch；
  // 若 refetch 未能消除不匹配，冷却 RESYNC_COOLDOWN_MS 后允许重试，避免永久卡死。
  const RESYNC_COOLDOWN_MS = 120_000;
  const resyncRef = useRef<{ symbol: string; at: number } | null>(null);
  useEffect(() => {
    const bars = tail?.bars;
    const symbol = tail?.candle_underlying_symbol ?? tail?.underlying_symbol;
    if (!bars?.length || !symbol) return;
    const upper = symbol.toUpperCase();
    const current = queryClient.getQueryData<OptionsIntradayResponse>(mainKey);
    if (current && candleStreamSymbolMismatch(current, upper)) {
      const last = resyncRef.current;
      if (!last || last.symbol !== upper || Date.now() - last.at > RESYNC_COOLDOWN_MS) {
        resyncRef.current = { symbol: upper, at: Date.now() };
        void queryClient.refetchQueries({ queryKey: mainKey, exact: true });
      }
      return;
    }
    resyncRef.current = null;
    queryClient.setQueryData(mainKey, (current: OptionsIntradayResponse | undefined) =>
      current ? mergeCandleStreamBars(current, { symbol: upper, timeframe: 60, bars }, days) : tail);
  }, [tail, mainKey, days, queryClient]);
  // 整窗覆盖恢复（2026-09-11）：整窗首拉失败/被超时切掉后，尾部刷新让最后一根 bar 永远新鲜，
  // 看门狗"缺口 >30min 才补整窗"永远触不到，历史缺口会一直缺着（实测 K 线只剩尾部 30 分钟）。
  // 按覆盖度判定：整窗 error / 无 bars / 最早 bar 晚于窗口起点 2h 以上 → 冷却 180s 补拉整窗。
  const HISTORY_RECOVERY_COOLDOWN_MS = 180_000;
  const historyRecoveryRef = useRef(0);
  useEffect(() => {
    if (!enabled || offsetDays > 0 || !isCmeSessionOpen()) return;
    const state = queryClient.getQueryState(mainKey);
    if (!state || state.fetchStatus === "fetching") return;
    const current = state.data as OptionsIntradayResponse | undefined;
    const earliest = current?.bars?.[0]?.unix;
    const expectedFrom = historyRange(days, offsetDays).from;
    const missing =
      state.status === "error" ||
      !current?.bars?.length ||
      (typeof earliest === "number" && earliest > expectedFrom + 7200);
    if (!missing) return;
    const now = Date.now();
    if (now - historyRecoveryRef.current < HISTORY_RECOVERY_COOLDOWN_MS) return;
    historyRecoveryRef.current = now;
    console.debug(`[ms-data] K线整窗覆盖缺失，补拉整窗 ${product}`);
    void queryClient.refetchQueries({ queryKey: mainKey, exact: true });
  }, [enabled, offsetDays, days, mainKey, queryClient, tail, product]);
  return query;
}

/** Initial history comes from HTTP once; the active 1m tail is maintained by the shared per-symbol candles websocket. */
export function useOptionsCandleStream(
  product: OptionProduct,
  underlying: string | undefined,
  days = 1,
  offsetDays = 0,
  enabled = true,
) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    const symbol = underlying?.toUpperCase();
    if (!symbol || offsetDays !== 0) return;
    let stopped = false;
    // WS 看门狗：连接"看起来开着"但实际不再推数据时（半开连接、后端静默丢订阅），
    // 前端不会收到任何事件，图表就停在旧数据上。超过 STREAM_IDLE_MS 没有收到有效批次
    // 就主动补拉一次 HTTP（限频 RECOVERY_COOLDOWN_MS），保证画面最多滞后约两分钟。
    const STREAM_IDLE_MS = 150_000;
    const RECOVERY_COOLDOWN_MS = 120_000;
    let lastBatchAt = Date.now();
    let lastRecoveryAt = 0;
    // 换月/参考合约重锚定节流：状态变化（新符号出现）即触发一次整窗 refetch；
    // 若 refetch 未能消除不匹配，冷却 RESYNC_COOLDOWN_MS 后允许重试，避免永久卡死。
    const RESYNC_COOLDOWN_MS = 120_000;
    let lastResync: { symbol: string; at: number } | null = null;
    const key = optionsIntradayKeys.bars(product, days, offsetDays);
    const tailKey = optionsIntradayKeys.barsTail(product, days, offsetDays);
    const pendingBatches: CandleStreamBatch[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      flushTimer = null;
      if (!pendingBatches.length) return;
      const batches = pendingBatches.splice(0, pendingBatches.length);
      if (stopped) return;
      const current = queryClient.getQueryData<OptionsIntradayResponse>(key);
      const mismatched = current ? batches.find((batch) => candleStreamSymbolMismatch(current, batch.symbol)) : undefined;
      if (mismatched) {
        if (!lastResync || lastResync.symbol !== mismatched.symbol || Date.now() - lastResync.at > RESYNC_COOLDOWN_MS) {
          lastResync = { symbol: mismatched.symbol, at: Date.now() };
          void queryClient.refetchQueries({ queryKey: key, exact: true });
        }
        return;
      }
      lastResync = null;
      queryClient.setQueryData(key, (current: OptionsIntradayResponse | undefined) =>
        batches.reduce((acc, batch) => (acc ? mergeCandleStreamBars(acc, batch, days) : acc), current));
    };
    const scheduleFlush = () => {
      if (flushTimer) return;
      flushTimer = setTimeout(flush, 1000);
    };
    /**
     * 断线/静默丢订阅后的补齐。整窗是 142KB(~17s)、尾部窗口是 3KB(<1s)，
     * 所以只有缺口超过尾部窗口（真的断久了）才回退整窗，否则一律只补尾部。
     */
    const recover = () => {
      const current = queryClient.getQueryData<OptionsIntradayResponse>(key);
      const lastUnix = current?.bars?.at(-1)?.unix ?? 0;
      const gapTooLarge = Date.now() / 1000 - lastUnix > TAIL_SECONDS;
      void queryClient.refetchQueries({ queryKey: gapTooLarge ? key : tailKey, exact: true });
    };

    const release = acquireCandleStream(symbol, {
      onBatch: (batch) => {
        if (stopped) return;
        lastBatchAt = Date.now();
        // 快慢分离（治卡顿）：WS 消息只进缓冲，最多每秒合并写回缓存一次。
        // 若后端高频推送 in-progress bar，每条消息都穿透 React 全组件树
        // （union+sort 上千根 + 全部 memo 重算 + 图表 effect + primitive 重配），
        // 多窗叠加时就是肉眼卡顿；节流后无论推多快，渲染频率恒定 ≤1Hz。
        pendingBatches.push(batch);
        scheduleFlush();
      },
      onOpen: (reconnected) => {
        if (stopped) return;
        lastBatchAt = Date.now();
        if (reconnected && isCmeSessionOpen()) recover();
      },
    });

    const watchdog = setInterval(() => {
      if (stopped) return;
      // 休市（CME Globex 闭市/日盘间歇）无新 K 线是正常状态：不补拉、不计静默，
      // 避免每次巡检都触发 BFF 的 7 天历史回退扇出；开市后第一次巡检照常补拉。
      if (!isCmeSessionOpen()) return;
      const now = Date.now();
      if (now - lastBatchAt < STREAM_IDLE_MS) return;
      if (now - lastRecoveryAt < RECOVERY_COOLDOWN_MS) return;
      lastRecoveryAt = now;
      lastBatchAt = now;
      recover();
    }, 30_000);
    return () => {
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      flush();
      stopped = true;
      clearInterval(watchdog);
      release();
    };
  }, [days, enabled, offsetDays, product, queryClient, underlying]);
}

/**
 * 一·五节联动模型：06 面板多 scope 叠加——缓存 key 仍单 scope，
 * 前端按 scopes 并发取多 key（React Query 去重），回放游标按 key 各算一份（成本线性）。
 *
 * ⚠️ 刷新频率 60s → 300s（2026-09-10）：响应里的 `levels[]` 轨迹序列自第九轮
 * "移除历史期权水位"后已无任何消费方（全仓 grep 确认），面板实际只用 `current` 与空态文案，
 * 而 `current` 在水位层开启时由 dashboard 提供（版本驱动、60s）。这个接口却是全站最贵、
 * 最慢、最容易 502 的一个（实测 9~38s）。降频为 300s 作为兜底，不再参与实时更新。
 */
export function useOptionsIntradayMulti(product: OptionProduct, scopes: OptionScope[], days = 1, offsetDays = 0, enabled = true) {
  // useQueries 支持动态长度数组，避免变长 hooks 调用
  return useQueries({
    queries: scopes.map((scope) => ({
      queryKey: optionsIntradayKeys.detail(product, scope, days, offsetDays),
      queryFn: ({ signal }: { signal: AbortSignal }) => getOptionIntraday(product, scope, signal, historyRange(days, offsetDays)),
      enabled,
      // 历史回看窗（offsetDays>0）asof 固定后数据不可变：拉一次即永久有效，不再轮询白拉。
      // 分档节奏（§3.2）：0dte 60s，d30/d90 3600s；休市停轮。不做降频——定时拉取即合理。
      staleTime: offsetDays > 0 ? Number.POSITIVE_INFINITY : scopeStaleTimeMs(scope),
      refetchInterval: () => {
        if (offsetDays > 0 || !isCmeSessionOpen()) return false;
        return scope === "0dte" ? 60_000 : 3_600_000;
      },
      refetchIntervalInBackground: false,
    })),
  }) as Array<{
    data?: import("../../api/options").OptionsIntradayResponse;
    isPending: boolean;
    isError: boolean;
  }>;
}
