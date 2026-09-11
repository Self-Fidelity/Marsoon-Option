"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  DockviewReact,
  themeDark,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
  type IWatermarkPanelProps,
} from "dockview-react";
import "dockview-react/dist/styles/dockview.css";

import {
  applyPayload,
  buildDefaultLayout,
  getBoardTemplate,
  getDefaultTemplateName,
  restoreLayout,
  saveLayout,
  type BoardDockPayload,
} from "./board-dock-layout";
import { useBoardWindowStore } from "./board-window-store";
import { BOARD_PANELS } from "./panel-registry";
import { usePanelVisible } from "./use-panel-visible";

/**
 * 每窗三要素自包含：面板按自己的 panel id 从窗口配置 store 取品种/周期，
 * 不再依赖外层 ctx 透传。params 只放可序列化的 { panelKey }，配置不进 dockview params。
 */
function DockPanelBody({ api, params }: IDockviewPanelProps<{ panelKey: string }>) {
  const panelId = api.id;
  const visible = usePanelVisible(api);
  // 新窗口（含还原存档缺项）补默认配置
  useEffect(() => {
    useBoardWindowStore.getState().ensureWindow(panelId);
  }, [panelId]);
  const def = BOARD_PANELS.find((panel) => panel.key === params.panelKey);
  return (
    <div className="h-full min-h-0 overflow-auto [overscroll-behavior:contain]">
      {def ? (
        def.render(panelId, visible)
      ) : (
        <div className="grid h-full place-items-center bg-[var(--ms-plot-bg)] px-4 text-center text-xs text-[var(--ms-text-secondary)]">
          未知面板类型（{params.panelKey}），请关闭本窗口
        </div>
      )}
    </div>
  );
}

function DockWatermark(_props: IWatermarkPanelProps) {
  return (
    <div className="grid h-full place-items-center text-sm text-[var(--ms-text-secondary)]">
      所有面板已关闭，用上方「添加面板」重新打开
    </div>
  );
}

const DOCK_COMPONENTS = { boardPanel: DockPanelBody };

/**
 * /board 的 Dockview 容器：分栏 / 拖拽 / tab 编组 / 浮动 / 缩放 + 布局持久化。
 * 持久化 = dockview 布局 + 窗口配置 store（v3 存档），store 变更也触发防抖保存。
 * 第三十三轮恢复优先级：分享链接 payload → 默认模板 → 自动存档 → 出厂布局，
 * 最终照常 saveLayout（分享布局落地为当前自动存档）。
 */
export function BoardDock({
  onApiReady,
  sharedPayload,
}: {
  onApiReady: (api: DockviewApi) => void;
  sharedPayload?: BoardDockPayload | null;
}) {
  const saveTimerRef = useRef<number | undefined>(undefined);
  const layoutDisposableRef = useRef<{ dispose(): void } | null>(null);
  const apiRef = useRef<DockviewApi | null>(null);

  const debouncedSave = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => saveLayout(api), 300);
  }, []);

  const onReady = useCallback(
    (event: DockviewReadyEvent) => {
      const { api } = event;
      apiRef.current = api;
      const defaultName = getDefaultTemplateName();
      const defaultPayload = defaultName ? getBoardTemplate(defaultName) : null;
      const restored =
        (sharedPayload ? applyPayload(api, sharedPayload) : false) ||
        (defaultPayload ? applyPayload(api, defaultPayload) : false) ||
        restoreLayout(api);
      if (!restored) buildDefaultLayout(api);
      saveLayout(api);
      layoutDisposableRef.current = api.onDidLayoutChange(debouncedSave);
      onApiReady(api);
    },
    [debouncedSave, onApiReady, sharedPayload],
  );

  // 窗口配置（品种/联动/周期/📌/K线周期）变更同样落盘（一·五节坑 8）
  useEffect(() => useBoardWindowStore.subscribe(debouncedSave), [debouncedSave]);

  useEffect(
    () => () => {
      window.clearTimeout(saveTimerRef.current);
      layoutDisposableRef.current?.dispose();
    },
    [],
  );

  return (
    <DockviewReact
      className="ms-dock h-full w-full"
      theme={themeDark}
      components={DOCK_COMPONENTS}
      watermarkComponent={DockWatermark}
      onReady={onReady}
    />
  );
}
