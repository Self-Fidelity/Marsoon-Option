"use client";

import { create } from "zustand";

import type { OptionProduct, OptionScope, OptionStatsMetric } from "@/api/options";
import { DEFAULT_OPTION_STATS_METRICS, sanitizeOptionStatsMetrics } from "./option-stats-model";

/**
 * 窗口配置 store（看板架构演进 步二后半 + 一·五节三维联动模型）。
 *
 * 三个维度联动机制：
 *  - 标的：顶部选择修改所有窗口；窗口选择只修改本窗，不反向修改主控。
 *  - 期权周期：master.scopes / perProductScope 保留数组形状兼容旧存档，但当前只存 1 项；
 *    联动开 = 所有窗口跟随标的级单选口径；
 *    解耦 = 窗内冻结自治（解耦瞬间快照当时有效值）。第三十一轮起 📌 scopePinned
 *    语义废除。联动按钮已移除，productLinked 仅保留既有周期口径兼容。
 *  - K线周期：纯窗口私有（kPeriod），随布局持久化。
 *
 * 布局持久化 v3：windows / perProductScope / master 全部进 localStorage JSON
 * （见 board-dock-layout.ts）。旧单值存档（master.scope / perProductScope 单值）
 * 在 hydrate 时自动迁移为数组（见 sanitizeScopeArray）。
 */

export interface WindowConfig {
  product: OptionProduct;
  /** 旧存档字段，仅控制周期跟随/冻结；不再控制品种切换，UI 无联动开关。 */
  productLinked: boolean;
  /** 线条类面板的周期单选（数组形状仅为旧存档兼容）；联动开时被标的级数组覆盖 */
  scopes: OptionScope[];
  /** 表格类面板的周期单值（解耦时的窗内冻结值；解耦瞬间快照当时有效值） */
  scope: OptionScope;
  /** 06 K线周期（分钟），窗口私有 */
  kPeriod: number;
  /** 06 内嵌 GEX 剖面指标是否已添加；旧档默认已添加。 */
  vpOn: boolean;
  /** GEX 剖面指标已添加后可单独隐藏，删除则由 vpOn=false 表示。 */
  gexProfileVisible: boolean;
  /** GEX 剖面自己的单选周期，与期权水位 optionLayerScopes 分离。 */
  gexProfileScope: OptionScope;
  /** 当日 0DTE 期权成交量按执行价分布。 */
  optionVolumeProfileEnabled: boolean;
  optionVolumeProfileVisible: boolean;
  optionVolumeProfileScope: OptionScope;
  /** Rust Bar Statistics 风格的 0DTE 期权状态副图；旧布局默认未添加。 */
  optionStatsEnabled: boolean;
  optionStatsVisible: boolean;
  optionStatsMetrics: OptionStatsMetric[];
  /** 主图 Volume 指标是否已添加、是否可见。 */
  volumeIndicatorEnabled: boolean;
  volumeIndicatorVisible: boolean;
  /** 06 期权图层；旧档缺失时默认启用，维持原显示。 */
  optionLayerEnabled: boolean;
  /** TradingView 式眼睛开关：图层仍存在，只隐藏全部渲染。 */
  optionLayerVisible: boolean;
  /** 期权图层自己的周期，不占用图表标题栏；在 legend 设置面板修改。 */
  optionLayerScopes: OptionScope[];
  optionLevelsOn: boolean;
  optionHistoryOn: boolean;
  /** 06 内嵌 GEX Profile 宽度 px（clamp 120~400；undefined = 默认 200） */
  vpW?: number;
  /** K 线历史窗口：1/3/7 天；offset=0 当前，1 前一日。 */
  historyDays: 1 | 3 | 7;
  historyOffsetDays: number;
}

export interface BoardMaster {
  product: OptionProduct;
  /** 当前周期单选（数组形状仅为旧存档兼容） */
  scopes: OptionScope[];
}

const PRODUCTS: OptionProduct[] = ["ES", "NQ", "GC"];
const LINE_SCOPES_MAX = 1;

const VALID_SCOPES: OptionScope[] = ["close", "0dte", "d30", "d90"];

/**
 * scope 的固定优先级（0dte > d30 > d90 > close），仅用于旧多选存档迁移时取第一项。
 * 全局总控与线条窗追加后都按此排序，保证所有消费者的 scopes[0] 恒为
 * 最高优先级选中项（主周期不随点击顺序漂移）。
 * 注意：与 IntradayPanel.tsx 的 SCOPE_MERGE_ORDER 保持同步（store 被该面板
 * 引用，反向引用会成环，故此处单独定义一份）。
 */
const LINE_SCOPE_ORDER: OptionScope[] = ["0dte", "d30", "d90", "close"];

function sortLineScopes(scopes: OptionScope[]): OptionScope[] {
  return [...scopes].sort(
    (a, b) => LINE_SCOPE_ORDER.indexOf(a) - LINE_SCOPE_ORDER.indexOf(b),
  );
}

/**
 * 多选数组清洗 + 旧单值迁移：接受数组或单值字符串，过滤非法项、去重、
 * 按固定优先级排序；结果为空回退 fallback。v3 旧存档（master.scope 单值、
 * perProductScope 单值）经此自动升为数组。
 */
function sanitizeScopeArray(value: unknown, fallback: OptionScope[]): OptionScope[] {
  const raw: unknown[] = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? [value]
      : [];
  // v3/v4 旧布局里的 all/RTH 不再是 Main 状态；迁移为覆盖范围最接近的 d90。
  const normalized = raw.map((scope) => scope === "all" ? "d90" : scope);
  const filtered = normalized.filter((s): s is OptionScope => VALID_SCOPES.includes(s as OptionScope));
  const unique = [...new Set(filtered)];
  return unique.length > 0 ? sortLineScopes(unique).slice(0, 1) : fallback.slice(0, 1);
}

/** 期权水位层允许四档复选；与全局/图表 scope 单选清洗分开。 */
function sanitizeLevelScopeArray(value: unknown, fallback: OptionScope[]): OptionScope[] {
  const raw: unknown[] = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const normalized = raw.map((scope) => scope === "all" ? "d90" : scope);
  const filtered = normalized.filter((scope): scope is OptionScope => VALID_SCOPES.includes(scope as OptionScope));
  const unique = sortLineScopes([...new Set(filtered)]);
  return unique.length > 0 ? unique : fallback.slice(0, 1);
}

function defaultPerProductScope(): Record<OptionProduct, OptionScope[]> {
  return { ES: ["0dte"], NQ: ["0dte"], GC: ["0dte"] };
}

interface BoardWindowState {
  master: BoardMaster;
  perProductScope: Record<OptionProduct, OptionScope[]>;
  windows: Record<string, WindowConfig>;

  /** 面板渲染时确保配置存在（新加窗口给默认值：跟随主控品种 + 标的级 scope） */
  ensureWindow: (id: string) => void;
  /** 主控（顶部工具条）：切品种 → 所有窗口跟随，忽略旧联动标志 */
  setMasterProduct: (product: OptionProduct) => void;
  /** 主控周期切换：始终只保留目标 scope，同时写标的级 scope */
  toggleMasterScope: (scope: OptionScope) => void;
  /** 主控周期整体注入（URL 深链 ?scope=0dte,d90），清洗后写主控 + 标的级 */
  setMasterScopes: (scopes: OptionScope[]) => void;
  /** 窗口级：切品种只修改本窗，主控和其他窗口保持不变 */
  setWindowProduct: (id: string, product: OptionProduct) => void;
  toggleProductLinked: (id: string) => void;
  /** 表格类单选（仅解耦态可用，chips 在联动态置灰）：只写本窗冻结值 */
  setWindowScope: (id: string, scope: OptionScope) => void;
  /** 线条类周期切换：始终只保留目标 scope */
  toggleLineScope: (id: string, scope: OptionScope) => void;
  setKPeriod: (id: string, minutes: number) => void;
  setVpEnabled: (id: string, enabled: boolean) => void;
  setVpVisible: (id: string, visible: boolean) => void;
  setGexProfileScope: (id: string, scope: OptionScope) => void;
  setOptionVolumeProfileEnabled: (id: string, enabled: boolean) => void;
  setOptionVolumeProfileVisible: (id: string, visible: boolean) => void;
  setOptionVolumeProfileScope: (id: string, scope: OptionScope) => void;
  setOptionStatsEnabled: (id: string, enabled: boolean) => void;
  setOptionStatsVisible: (id: string, visible: boolean) => void;
  toggleOptionStatsMetric: (id: string, metric: OptionStatsMetric) => void;
  /** 06 内嵌 VP 条带宽度（clamp 60~240） */
  setVpW: (id: string, w: number) => void;
  setOptionLayerEnabled: (id: string, enabled: boolean) => void;
  setOptionLayerVisible: (id: string, visible: boolean) => void;
  setVolumeIndicatorEnabled: (id: string, enabled: boolean) => void;
  setVolumeIndicatorVisible: (id: string, visible: boolean) => void;
  toggleOptionLayerScope: (id: string, scope: OptionScope) => void;
  setOptionLayerPart: (id: string, part: "levels" | "history", enabled: boolean) => void;
  setHistoryWindow: (id: string, days: 1 | 3 | 7, offsetDays: number) => void;
  /** 布局还原时整体注入（v3 存档；旧单值自动迁移为数组） */
  hydrate: (payload: {
    master?: BoardMaster | { product: OptionProduct; scope: OptionScope };
    perProductScope?: Record<OptionProduct, OptionScope | OptionScope[]>;
    windows: Record<string, WindowConfig>;
  }) => void;
  /** 布局保存前裁剪掉已关闭窗口的配置，key 空间有界 */
  prune: (liveIds: string[]) => void;
}

function defaultWindowConfig(state: Pick<BoardWindowState, "master" | "perProductScope">): WindowConfig {
  const scopes = state.perProductScope[state.master.product] ?? state.master.scopes;
  return {
    product: state.master.product,
    productLinked: true,
    scopes: scopes.slice(0, LINE_SCOPES_MAX),
    scope: scopes[0] ?? "0dte",
    kPeriod: 5,
    vpOn: true,
    gexProfileVisible: true,
    gexProfileScope: scopes[0] ?? "0dte",
    optionVolumeProfileEnabled: true,
    optionVolumeProfileVisible: true,
    optionVolumeProfileScope: "0dte",
    optionStatsEnabled: false,
    optionStatsVisible: true,
    optionStatsMetrics: [...DEFAULT_OPTION_STATS_METRICS],
    volumeIndicatorEnabled: true,
    volumeIndicatorVisible: true,
    optionLayerEnabled: true,
    optionLayerVisible: true,
    optionLayerScopes: scopes.slice(0, LINE_SCOPES_MAX),
    optionLevelsOn: true,
    optionHistoryOn: false,
    historyDays: 1,
    historyOffsetDays: 0,
  };
}

/** 表格类窗口的有效 scope（单值，第三十一轮统一语义）：
 *  联动开（productLinked）= 跟随标的级主周期（数组 [0]）；联动关（解耦）= 窗内自存 scope
 * （解耦瞬间已冻结当时有效值，见 toggleProductLinked）。旧 📌 scopePinned 语义废除，解耦 chip 唯一入口。 */
export function effectiveTableScope(
  config: WindowConfig,
  perProductScope: Record<OptionProduct, OptionScope[]>,
): OptionScope {
  return config.productLinked
    ? (perProductScope[config.product]?.[0] ?? "0dte")
    : config.scope;
}

/**
 * 线条类窗口的有效 scopes：联动开（productLinked）= 跟随标的级数组
 * （排序后截断到上限 3）；联动关 = 窗内自治 scopes。
 */
export function effectiveLineScopes(
  config: WindowConfig,
  perProductScope: Record<OptionProduct, OptionScope[]>,
): OptionScope[] {
  if (config.productLinked) {
    const linked = perProductScope[config.product];
    if (linked && linked.length > 0) {
      return sortLineScopes(linked).slice(0, 1);
    }
  }
  return config.scopes.slice(0, 1);
}

function sanitizeWindows(
  windows: Record<string, WindowConfig>,
  perProductScope: Record<OptionProduct, OptionScope[]>,
): Record<string, WindowConfig> {
  const out: Record<string, WindowConfig> = {};
  for (const [id, config] of Object.entries(windows)) {
    if (!config || !PRODUCTS.includes(config.product)) continue;
    const fallback = perProductScope[config.product]?.[0] ?? "0dte";
    const scopes = sanitizeScopeArray(config.scopes, [fallback]).slice(0, LINE_SCOPES_MAX);
    const legacyScope = (config as unknown as { scope: string }).scope;
    const normalizedScope = (legacyScope === "all" ? "d90" : legacyScope) as OptionScope;
    const scope = VALID_SCOPES.includes(normalizedScope) ? normalizedScope : fallback;
    out[id] = {
      product: config.product,
      productLinked: config.productLinked !== false,
      scopes: scopes.length > 0 ? scopes : [scope],
      scope,
      kPeriod: typeof config.kPeriod === "number" && config.kPeriod > 0 ? config.kPeriod : 5,
      // 旧档无 vpOn → 默认开（调试阶段与 defaultWindowConfig 对齐）
      vpOn: config.vpOn !== false,
      gexProfileVisible: config.gexProfileVisible !== false,
      gexProfileScope: VALID_SCOPES.includes(config.gexProfileScope)
        ? config.gexProfileScope
        : (config.optionLayerScopes?.[0] ?? scope),
      optionVolumeProfileEnabled: config.optionVolumeProfileEnabled !== false,
      optionVolumeProfileVisible: config.optionVolumeProfileVisible !== false,
      optionVolumeProfileScope: config.optionVolumeProfileScope === "close" ? "close" : "0dte",
      optionStatsEnabled: config.optionStatsEnabled === true,
      optionStatsVisible: config.optionStatsVisible !== false,
      optionStatsMetrics: sanitizeOptionStatsMetrics(config.optionStatsMetrics),
      volumeIndicatorEnabled: config.volumeIndicatorEnabled !== false,
      volumeIndicatorVisible: config.volumeIndicatorVisible !== false,
      // 旧档无 vpW 字段 → undefined（默认 200）；已有过窄值迁移到 120，最大 400
      vpW:
        typeof config.vpW === "number" && Number.isFinite(config.vpW)
          ? Math.min(400, Math.max(120, Math.round(config.vpW)))
          : undefined,
      optionLayerEnabled: config.optionLayerEnabled !== false,
      optionLayerVisible: config.optionLayerVisible !== false,
      optionLayerScopes: sanitizeLevelScopeArray(config.optionLayerScopes ?? scopes, scopes),
      optionLevelsOn: config.optionLevelsOn !== false,
      optionHistoryOn: config.optionHistoryOn === true,
      historyDays: config.historyDays === 3 || config.historyDays === 7 ? config.historyDays : 1,
      historyOffsetDays: typeof config.historyOffsetDays === "number" && Number.isFinite(config.historyOffsetDays) ? Math.max(0, Math.min(30, Math.round(config.historyOffsetDays))) : 0,
    };
  }
  return out;
}

export const useBoardWindowStore = create<BoardWindowState>((set, get) => ({
  master: { product: "NQ", scopes: ["0dte"] },
  perProductScope: defaultPerProductScope(),
  windows: {},

  ensureWindow: (id) => {
    const state = get();
    if (state.windows[id]) return;
    set({ windows: { ...state.windows, [id]: defaultWindowConfig(state) } });
  },

  setMasterProduct: (product) => {
    const state = get();
    const windows = { ...state.windows };
    for (const [id, config] of Object.entries(windows)) {
      windows[id] = { ...config, product };
    }
    set({ master: { ...state.master, product }, windows });
  },

  toggleMasterScope: (scope) => {
    const state = get();
    const sorted = [scope];
    set({
      master: { ...state.master, scopes: sorted },
      perProductScope: { ...state.perProductScope, [state.master.product]: sorted },
    });
  },

  setMasterScopes: (scopes) => {
    const state = get();
    const sorted = sanitizeScopeArray(scopes, state.master.scopes);
    set({
      master: { ...state.master, scopes: sorted },
      perProductScope: { ...state.perProductScope, [state.master.product]: sorted },
    });
  },

  setWindowProduct: (id, product) => {
    const state = get();
    const config = state.windows[id];
    if (!config) return;
    set({ windows: { ...state.windows, [id]: { ...config, product } } });
  },

  toggleProductLinked: (id) => {
    const state = get();
    const config = state.windows[id];
    if (!config) return;
    if (config.productLinked) {
      // 解耦瞬间冻结当前有效周期（scope=表格主周期单值、scopes=线条数组），避免跳变（第三十一轮）
      const linkedScopes = state.perProductScope[config.product];
      const scope = linkedScopes?.[0] ?? config.scope;
      const scopes =
        linkedScopes && linkedScopes.length > 0
          ? sortLineScopes(linkedScopes).slice(0, LINE_SCOPES_MAX)
          : config.scopes;
      set({
        windows: { ...state.windows, [id]: { ...config, productLinked: false, scope, scopes } },
      });
      return;
    }
    // 重新联动：窗内冻结值作废，跟随标的级口径
    set({
      windows: { ...state.windows, [id]: { ...config, productLinked: true } },
    });
  },

  setWindowScope: (id, scope) => {
    const state = get();
    const config = state.windows[id];
    if (!config) return;
    // 窗口内控件只更新当前窗口。首次自主选择时退出旧周期联动，避免触发全局查询。
    set({ windows: { ...state.windows, [id]: { ...config, productLinked: false, scope, scopes: [scope] } } });
  },

  toggleLineScope: (id, scope) => {
    const state = get();
    const config = state.windows[id];
    if (!config) return;
    const sorted = [scope];
    set({
      windows: {
        ...state.windows,
        [id]: { ...config, productLinked: false, scope, scopes: sorted },
      },
    });
  },

  setKPeriod: (id, minutes) => {
    const state = get();
    const config = state.windows[id];
    if (!config) return;
    set({ windows: { ...state.windows, [id]: { ...config, kPeriod: minutes } } });
  },

  setVpEnabled: (id, enabled) => {
    const state = get();
    const config = state.windows[id];
    if (!config) return;
    set({ windows: { ...state.windows, [id]: { ...config, vpOn: enabled, gexProfileVisible: enabled ? true : config.gexProfileVisible } } });
  },

  setVpVisible: (id, visible) => {
    const state = get();
    const config = state.windows[id];
    if (!config) return;
    set({ windows: { ...state.windows, [id]: { ...config, gexProfileVisible: visible } } });
  },

  setGexProfileScope: (id, scope) => {
    const state = get();
    const config = state.windows[id];
    if (!config) return;
    set({ windows: { ...state.windows, [id]: { ...config, gexProfileScope: scope } } });
  },

  setOptionVolumeProfileEnabled: (id, enabled) => {
    const state = get();
    const config = state.windows[id];
    if (!config) return;
    set({ windows: { ...state.windows, [id]: { ...config, optionVolumeProfileEnabled: enabled, optionVolumeProfileVisible: enabled ? true : config.optionVolumeProfileVisible } } });
  },

  setOptionVolumeProfileVisible: (id, visible) => {
    const state = get();
    const config = state.windows[id];
    if (!config) return;
    set({ windows: { ...state.windows, [id]: { ...config, optionVolumeProfileVisible: visible } } });
  },

  setOptionVolumeProfileScope: (id, scope) => {
    const state = get();
    const config = state.windows[id];
    if (!config) return;
    set({ windows: { ...state.windows, [id]: { ...config, optionVolumeProfileScope: scope === "close" ? "close" : "0dte" } } });
  },

  setOptionStatsEnabled: (id, enabled) => {
    const state = get();
    const config = state.windows[id];
    if (!config) return;
    set({ windows: { ...state.windows, [id]: { ...config, optionStatsEnabled: enabled, optionStatsVisible: enabled ? true : config.optionStatsVisible } } });
  },

  setOptionStatsVisible: (id, visible) => {
    const state = get();
    const config = state.windows[id];
    if (!config) return;
    set({ windows: { ...state.windows, [id]: { ...config, optionStatsVisible: visible } } });
  },

  toggleOptionStatsMetric: (id, metric) => {
    const state = get();
    const config = state.windows[id];
    if (!config) return;
    const current = sanitizeOptionStatsMetrics(config.optionStatsMetrics);
    const metrics = current.includes(metric)
      ? current.length === 1 ? current : current.filter((item) => item !== metric)
      : DEFAULT_OPTION_STATS_METRICS.filter((item) => item === metric || current.includes(item));
    set({ windows: { ...state.windows, [id]: { ...config, optionStatsMetrics: metrics } } });
  },

  setVpW: (id, w) => {
    const state = get();
    const config = state.windows[id];
    if (!config || !Number.isFinite(w)) return;
    set({
      windows: {
        ...state.windows,
        [id]: { ...config, vpW: Math.min(400, Math.max(120, Math.round(w))) },
      },
    });
  },

  setOptionLayerEnabled: (id, enabled) => {
    const state = get(), config = state.windows[id]; if (!config) return;
    set({ windows: { ...state.windows, [id]: { ...config, optionLayerEnabled: enabled, optionLayerVisible: enabled ? true : config.optionLayerVisible } } });
  },
  setOptionLayerVisible: (id, visible) => {
    const state = get(), config = state.windows[id]; if (!config) return;
    set({ windows: { ...state.windows, [id]: { ...config, optionLayerVisible: visible } } });
  },
  setVolumeIndicatorEnabled: (id, enabled) => {
    const state = get(), config = state.windows[id]; if (!config) return;
    set({ windows: { ...state.windows, [id]: { ...config, volumeIndicatorEnabled: enabled, volumeIndicatorVisible: enabled ? true : config.volumeIndicatorVisible } } });
  },
  setVolumeIndicatorVisible: (id, visible) => {
    const state = get(), config = state.windows[id]; if (!config) return;
    set({ windows: { ...state.windows, [id]: { ...config, volumeIndicatorVisible: visible } } });
  },
  toggleOptionLayerScope: (id, scope) => {
    const state = get(), config = state.windows[id]; if (!config) return;
    const current = config.optionLayerScopes;
    const next = current.includes(scope)
      ? current.length === 1 ? current : current.filter((item) => item !== scope)
      : sortLineScopes([...current, scope]);
    set({ windows: { ...state.windows, [id]: { ...config, optionLayerScopes: next } } });
  },
  setOptionLayerPart: (id, part, enabled) => {
    const state = get(), config = state.windows[id]; if (!config) return;
    const patch = part === "levels" ? { optionLevelsOn: enabled } : { optionHistoryOn: enabled };
    set({ windows: { ...state.windows, [id]: { ...config, ...patch } } });
  },
  setHistoryWindow: (id, days, offsetDays) => {
    const state = get(), config = state.windows[id]; if (!config) return;
    set({ windows: { ...state.windows, [id]: { ...config, historyDays: days, historyOffsetDays: Math.max(0, Math.min(30, Math.round(offsetDays))) } } });
  },

  hydrate: (payload) => {
    const defaults = defaultPerProductScope();
    const perProductScope: Record<OptionProduct, OptionScope[]> = { ...defaults };
    // 旧存档 perProductScope 为单值，sanitizeScopeArray 自动迁移为数组
    for (const product of PRODUCTS) {
      const value = payload.perProductScope?.[product];
      if (value !== undefined) {
        perProductScope[product] = sanitizeScopeArray(value, defaults[product]);
      }
    }
    // 旧存档 master.scope 单值 → master.scopes 数组
    const rawMaster = payload.master as
      | (Partial<BoardMaster> & { scope?: OptionScope })
      | undefined;
    const master: BoardMaster = rawMaster
      ? {
          product: PRODUCTS.includes(rawMaster.product as OptionProduct)
            ? (rawMaster.product as OptionProduct)
            : get().master.product,
          scopes: sanitizeScopeArray(
            rawMaster.scopes ?? rawMaster.scope,
            perProductScope[
              PRODUCTS.includes(rawMaster.product as OptionProduct)
                ? (rawMaster.product as OptionProduct)
                : get().master.product
            ],
          ),
        }
      : get().master;
    set({
      master,
      perProductScope,
      windows: sanitizeWindows(payload.windows, perProductScope),
    });
  },

  prune: (liveIds) => {
    const state = get();
    const live = new Set(liveIds);
    const windows: Record<string, WindowConfig> = {};
    for (const [id, config] of Object.entries(state.windows)) {
      if (live.has(id)) windows[id] = config;
    }
    set({ windows });
  },
}));
