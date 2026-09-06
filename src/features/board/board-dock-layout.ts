import type { DockviewApi, SerializedDockview } from "dockview-react";

import type { OptionProduct, OptionScope } from "@/api/options";

import {
  useBoardWindowStore,
  type BoardMaster,
  type WindowConfig,
} from "./board-window-store";
import { BOARD_PANELS } from "./panel-registry";

/**
 * Dockview 布局持久化：toJSON/fromJSON → localStorage。
 * v4 key：布局 payload 结构仍为 v3；仅切换自动存档键，让新出厂双栏布局生效。
 * v3 payload 扩展到"每窗配置（品种/联动/周期/钉住/K线周期）+ 标的级 scope + 主控"全量存档
 * （一·五节坑 8：📌/捆绑状态必须进布局 JSON）。
 * 旧键整体作废：v1 RGL（marsoon:board:v2）与 v2（marsoon-board-layout-v2）结构不兼容，
 * 不回迁移，读取失败即回退默认布局。
 */
export const BOARD_DOCK_STORAGE_KEY = "marsoon-board-layout-v4";
const STORAGE_VERSION = 3;

/**
 * 布局存档 payload（第三十三轮导出）：localStorage 自动存档、本地模板、
 * 分享链接（?layout=）三处共用同一结构。
 */
export interface BoardDockPayload {
  version: number;
  layout: SerializedDockview;
  windows: Record<string, WindowConfig>;
  perProductScope: Record<OptionProduct, OptionScope[]>;
  master: BoardMaster;
}

function panelDef(panelKey: string) {
  const def = BOARD_PANELS.find((panel) => panel.key === panelKey);
  if (!def) throw new Error(`unknown panel key: ${panelKey}`);
  return def;
}

/** 多开时生成唯一 panel id（同类型允许多实例，多窗对照） */
export function newPanelId(panelKey: string): string {
  return `${panelKey}-${Math.random().toString(36).slice(2, 8)}`;
}

export function addBoardPanel(api: DockviewApi, panelKey: string) {
  const def = panelDef(panelKey);
  const id = newPanelId(panelKey);
  useBoardWindowStore.getState().ensureWindow(id);
  api.addPanel({
    id,
    component: "boardPanel",
    title: def.chipLabel,
    params: { panelKey },
  });
}

/**
 * 默认布局：日内 K线在左，GEX 拆分在右。其他面板仍可从“+ 面板”添加，
 * 用户主动保存的模板继续优先于自动存档和出厂布局。
 */
export function buildDefaultLayout(api: DockviewApi) {
  const add = (panelKey: string, position?: Parameters<DockviewApi["addPanel"]>[0]["position"]) => {
    const def = panelDef(panelKey);
    const id = `${panelKey}-1`;
    useBoardWindowStore.getState().ensureWindow(id);
    api.addPanel({
      id,
      component: "boardPanel",
      title: def.chipLabel,
      params: { panelKey },
      ...(position ? { position } : {}),
    });
    return id;
  };

  const intraday = add("intraday");
  add("gex", { referencePanel: intraday, direction: "right" });
}

/** 采集当前布局 + 窗口配置为 payload（第三十三轮抽出，saveLayout/保存模板共用） */
export function capturePayload(api: DockviewApi): BoardDockPayload {
  const store = useBoardWindowStore.getState();
  // 只持久化活着的窗口配置，key 空间有界
  store.prune(api.panels.map((panel) => panel.id));
  const { windows, perProductScope, master } = useBoardWindowStore.getState();
  return {
    version: STORAGE_VERSION,
    layout: api.toJSON(),
    windows,
    perProductScope,
    master,
  };
}

export function saveLayout(api: DockviewApi) {
  try {
    window.localStorage.setItem(BOARD_DOCK_STORAGE_KEY, JSON.stringify(capturePayload(api)));
  } catch {
    // 存储不可用时静默降级（布局不持久）
  }
}

/**
 * 应用一份 payload 到 dock + store（第三十三轮抽出，restoreLayout/模板/分享链接共用）。
 * 版本不符 / 解析失败 / 含未知面板类型 → false（store 一并重置为空，逐窗走默认）。
 */
export function applyPayload(api: DockviewApi, payload: BoardDockPayload): boolean {
  try {
    if (payload.version !== STORAGE_VERSION || !payload.layout) return false;
    api.fromJSON(payload.layout);
    // 注册表演进后存档里可能残留未知面板类型：整档作废，避免半残布局
    const unknown = api.panels.some(
      (panel) => !BOARD_PANELS.some((def) => def.key === (panel.params as { panelKey?: string })?.panelKey),
    );
    if (unknown) {
      api.clear();
      return false;
    }
    // 窗口配置注入 store（sanitize + 旧单值存档→数组迁移在 hydrate 内做），
    // 面板渲染时 ensureWindow 兜底缺项
    useBoardWindowStore.getState().hydrate({
      master: payload.master,
      perProductScope: payload.perProductScope as
        | Record<OptionProduct, OptionScope | OptionScope[]>
        | undefined,
      windows: payload.windows ?? {},
    });
    for (const panel of api.panels) {
      useBoardWindowStore.getState().ensureWindow(panel.id);
    }
    return true;
  } catch {
    try {
      api.clear();
    } catch {
      // 忽略
    }
    return false;
  }
}

/**
 * 尝试从 localStorage 还原布局 + 窗口配置；成功返回 true。
 * 失败回退默认布局（读取异常时清 dock，避免半残布局）。
 */
export function restoreLayout(api: DockviewApi): boolean {
  try {
    const raw = window.localStorage.getItem(BOARD_DOCK_STORAGE_KEY);
    if (!raw) return false;
    return applyPayload(api, JSON.parse(raw) as BoardDockPayload);
  } catch {
    return false;
  }
}

/* ---------- 看板级第三十三轮：本地模板库（多模板 + 默认模板） ---------- */

export const BOARD_TEMPLATES_STORAGE_KEY = "marsoon-board-templates-v1";

interface BoardTemplateStore {
  defaultName: string | null;
  templates: Record<string, { savedAt: string; payload: BoardDockPayload }>;
}

function readTemplateStore(): BoardTemplateStore {
  try {
    const raw = window.localStorage.getItem(BOARD_TEMPLATES_STORAGE_KEY);
    if (!raw) return { defaultName: null, templates: {} };
    const parsed = JSON.parse(raw) as Partial<BoardTemplateStore>;
    return {
      defaultName: typeof parsed.defaultName === "string" ? parsed.defaultName : null,
      templates: parsed.templates && typeof parsed.templates === "object" ? parsed.templates : {},
    };
  } catch {
    return { defaultName: null, templates: {} };
  }
}

function writeTemplateStore(store: BoardTemplateStore) {
  try {
    window.localStorage.setItem(BOARD_TEMPLATES_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // 存储不可用时静默降级（同 saveLayout 风格）
  }
}

/** 模板名校验（第三十三轮）：trim、≤24 字符、空名拒绝；store 层兜底，菜单层提示 */
export function normalizeTemplateName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 24) return null;
  return trimmed;
}

export function listBoardTemplates(): { name: string; savedAt: string }[] {
  return Object.entries(readTemplateStore().templates)
    .map(([name, entry]) => ({ name, savedAt: entry.savedAt }))
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export function saveBoardTemplate(name: string, payload: BoardDockPayload): boolean {
  const trimmed = normalizeTemplateName(name);
  if (!trimmed) return false;
  const store = readTemplateStore();
  store.templates[trimmed] = { savedAt: new Date().toISOString(), payload };
  writeTemplateStore(store);
  return true;
}

export function deleteBoardTemplate(name: string) {
  const store = readTemplateStore();
  delete store.templates[name];
  if (store.defaultName === name) store.defaultName = null;
  writeTemplateStore(store);
}

export function setDefaultBoardTemplate(name: string | null) {
  const store = readTemplateStore();
  store.defaultName = name && store.templates[name] ? name : null;
  writeTemplateStore(store);
}

export function getDefaultTemplateName(): string | null {
  return readTemplateStore().defaultName;
}

export function getBoardTemplate(name: string): BoardDockPayload | null {
  return readTemplateStore().templates[name]?.payload ?? null;
}
