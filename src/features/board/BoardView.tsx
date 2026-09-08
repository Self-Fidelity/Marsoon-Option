"use client";

import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DockviewApi } from "dockview-react";

import type { OptionProduct, OptionScope } from "@/api/options";
import { FullscreenToggleButton } from "@/components/FullscreenToggleButton";
import { SidebarToggleButton } from "@/components/SidebarToggle";
import { useSnapshotSync } from "@/features/options/ingest-status";
import {
  DashboardToolbar,
  LoadingDashboard,
} from "@/features/options/components/dashboard-ui";

import { BoardAddMenu } from "./BoardAddMenu";
import { BoardTemplateMenu } from "./BoardTemplateMenu";
import {
  addBoardPanel,
  buildDefaultLayout,
  saveLayout,
  type BoardDockPayload,
} from "./board-dock-layout";
import { decodeBoardShare } from "./board-share-codec";
import { useBoardWindowStore } from "./board-window-store";

// Dockview 依赖浏览器环境，禁 SSR；也避免持久化布局还原前后的水合不一致
const BoardDock = dynamic(
  () => import("./BoardDock").then((module) => module.BoardDock),
  { ssr: false },
);

const products = new Set<OptionProduct>(["NQ", "ES", "GC"]);
const scopes = new Set<OptionScope>(["close", "0dte", "d30", "d90"]);

function parseProduct(value: string | null): OptionProduct | null {
  const candidate = value?.toUpperCase() as OptionProduct | undefined;
  return candidate && products.has(candidate) ? candidate : null;
}

/** URL ?scope= 支持逗号多值（?scope=0dte,d90）；无有效值返回 null */
function parseScopes(value: string | null): OptionScope[] | null {
  if (!value) return null;
  const list = value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .map((item) => (item === "all" ? "d90" : item) as OptionScope)
    .filter((item) => scopes.has(item));
  return list.length > 0 ? [...new Set(list)] : null;
}

/**
 * /board 拼装看板：Dockview 自由分窗容器。
 * 顶部品种/周期选择器 = 主控：改它 = 改所有联动窗的品种 + 当前主品种的标的级 scope
 * （窗口配置 store 打通，URL 仅作主控的初始化来源与可分享入口）。
 * 每窗三要素自包含，面板数据不再经 BoardView 组装。
 */
export function BoardView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const master = useBoardWindowStore((s) => s.master);
  const setMasterProduct = useBoardWindowStore((s) => s.setMasterProduct);
  const setMasterScopes = useBoardWindowStore((s) => s.setMasterScopes);
  // URL 显式参数优先（深链/分享），只在变化时覆盖 store 主控；无参数时沿用持久化还原值
  const urlProduct = parseProduct(searchParams.get("product"));
  const urlScopes = parseScopes(searchParams.get("scope"));
  const lastUrlSync = useRef<string>("");
  useEffect(() => {
    const sig = `${urlProduct ?? ""}|${urlScopes?.join(",") ?? ""}`;
    if (sig === lastUrlSync.current) return;
    lastUrlSync.current = sig;
    if (urlProduct) setMasterProduct(urlProduct);
    if (urlScopes) setMasterScopes(urlScopes);
  }, [urlProduct, urlScopes, setMasterProduct, setMasterScopes]);

  // 主控回写 URL（可分享、刷新还原；多值逗号连接），不造成导航抖动
  // 第三十三轮：剥掉 layout 分享参数，避免回写把它带上 / 刷新重复弹
  useEffect(() => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("layout");
    next.set("product", master.product);
    next.set("scope", master.scopes.join(","));
    const target = `${pathname}?${next.toString()}`;
    const current = `${pathname}?${searchParams.toString()}`;
    if (target !== current) router.replace(target, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [master.product, master.scopes]);

  // R3：快照版本（capturedAt）变化驱动失效，同版本各面板零重复请求
  useSnapshotSync();

  const [dockApi, setDockApi] = useState<DockviewApi | null>(null);
  const handleApiReady = useCallback((api: DockviewApi) => setDockApi(api), []);

  // 第三十三轮：?layout= 分享链接入口——解析完成前不渲染 BoardDock（避免先还原旧存档再被覆盖闪烁），
  // 成功→sharedPayload 传 BoardDock，失败→null 走常规恢复链；解析后立即从 URL 剥掉该参数
  const layoutParam = searchParams.get("layout");
  const [sharedPayload, setSharedPayload] = useState<BoardDockPayload | null>(null);
  const [shareResolved, setShareResolved] = useState(!layoutParam);
  useEffect(() => {
    if (!layoutParam) return;
    let cancelled = false;
    void decodeBoardShare(layoutParam).then((payload) => {
      if (cancelled) return;
      setSharedPayload(payload);
      setShareResolved(true);
      const next = new URLSearchParams(searchParams.toString());
      next.delete("layout");
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutParam]);

  const addPanel = useCallback(
    (panelKey: string) => {
      if (dockApi) addBoardPanel(dockApi, panelKey);
    },
    [dockApi],
  );

  const resetLayout = useCallback(() => {
    if (!dockApi) return;
    dockApi.clear();
    buildDefaultLayout(dockApi);
    saveLayout(dockApi);
  }, [dockApi]);

  return (
    <>
      <DashboardToolbar
        product={master.product}
        onProductChange={setMasterProduct}
        leading={<SidebarToggleButton />}
        productTrailing={
          <div className="flex items-center gap-1.5">
            <BoardAddMenu onAdd={addPanel} onReset={resetLayout} />
            <BoardTemplateMenu api={dockApi} />
          </div>
        }
        trailing={<FullscreenToggleButton />}
      />

      <div className="h-[calc(100vh-56px)] min-h-[320px] p-3 sm:p-4">
        {!shareResolved ? <LoadingDashboard /> : (
          <BoardDock onApiReady={handleApiReady} sharedPayload={sharedPayload} />
        )}
      </div>
    </>
  );
}
