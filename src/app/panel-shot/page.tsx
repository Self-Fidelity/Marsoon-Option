"use client";

import { Suspense, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";

import { optionProductConfig, type OptionProduct, type OptionScope } from "@/api/options";
import { BOARD_PANELS } from "@/features/board/panel-registry";
import { useBoardWindowStore } from "@/features/board/board-window-store";

const VALID_PRODUCTS: OptionProduct[] = ["ES", "NQ", "GC"];
const VALID_SCOPES: OptionScope[] = ["close", "0dte", "d30", "d90"];

const SCOPE_LABEL: Record<OptionScope, string> = {
  close: "收盘",
  "0dte": "0DTE",
  d30: "30DTE",
  d90: "90D",
};

// 抓取会话标签页常为 hidden，原生 rAF 被冻结导致 useMeasureSize 永远首帧骨架；
// 本页只是快照工具，用 setTimeout 兜底 rAF 即可（不影响生产页面）。
if (typeof window !== "undefined") {
  window.requestAnimationFrame = (cb) =>
    window.setTimeout(() => cb(performance.now()), 16) as unknown as number;
}

/**
 * 面板静态快照导出页（配合 scripts/panel-shots.mjs 抓取单文件 HTML）。
 * 不用 dockview，单面板直出；窗口配置解耦后按 URL 参数写死 product/scope。
 * 就绪信号：容器出现真实内容（无"加载"字样且长度足够）后给 body 打 data-shot-ready="1"。
 */
function PanelShotView() {
  const params = useSearchParams();
  const key = params.get("panel") ?? "";
  const product = (
    VALID_PRODUCTS.includes(params.get("product") as OptionProduct)
      ? params.get("product")
      : "NQ"
  ) as OptionProduct;
  const scope = (
    VALID_SCOPES.includes(params.get("scope") as OptionScope)
      ? params.get("scope")
      : "0dte"
  ) as OptionScope;

  const def = BOARD_PANELS.find((p) => p.key === key);
  const panelId = `${key}-shot`;
  const containerRef = useRef<HTMLDivElement>(null);

  // 窗口配置：ensure 后解耦并直写 product/scope/scopes；01 总览读 master，同步写 master
  useEffect(() => {
    if (!def) return;
    const store = useBoardWindowStore;
    store.getState().ensureWindow(panelId);
    const config = store.getState().windows[panelId];
    if (config) {
      store.setState((s) => ({
        master: { product, scopes: [scope] },
        windows: {
          ...s.windows,
          [panelId]: { ...config, product, productLinked: false, scope, scopes: [scope] },
        },
      }));
    }
  }, [def, panelId, product, scope]);

  // 就绪轮询：真实内容出现（无"加载/Loading"字样且 textContent 足够长）后打标
  useEffect(() => {
    const timer = setInterval(() => {
      const el = containerRef.current;
      if (!el) return;
      const text = el.textContent ?? "";
      if (text.length > 100 && !text.includes("加载") && !/loading/i.test(text)) {
        document.body.dataset.shotReady = "1";
        clearInterval(timer);
      }
    }, 500);
    return () => clearInterval(timer);
  }, []);

  if (!def) {
    return (
      <div className="min-h-screen bg-[var(--ms-app-bg)] p-8 text-sm text-[var(--ms-text-secondary)]">
        未知面板 key：{key || "(空)"}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--ms-app-bg)] text-[var(--ms-text-primary)]">
      <div
        ref={containerRef}
        data-panel-shot={key}
        className="mx-auto w-[1000px] max-w-5xl p-4"
      >
        <p className="mb-2 font-mono text-[11px] tracking-[0.08em] text-[var(--ms-text-tertiary)]">
          {def.title} · {optionProductConfig[product].label} · {SCOPE_LABEL[scope]}
        </p>
        {/* 定高外框：06/07/08/10 依赖 useMeasureSize 实测高，h-full 链需要定值高度 */}
        <div className="h-[620px] rounded-[10px] border border-[var(--ms-separator)] bg-[var(--ms-panel-bg)]">
          {def.render(panelId)}
        </div>
      </div>
    </div>
  );
}

export default function PanelShotPage() {
  return (
    <Suspense fallback={null}>
      <PanelShotView />
    </Suspense>
  );
}
