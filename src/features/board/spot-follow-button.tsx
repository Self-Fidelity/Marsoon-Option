"use client";

import { Crosshair } from "lucide-react";

/**
 * 追踪标的价居中开关（05/08/09 面板工具栏共用）：
 * 未激活 = 文字/边框 tertiary 灰；激活 = 面板 chip 选中态（brand 边框 + dim 底）。
 * 行为由面板持有的 useSpotFollow 驱动，本组件纯展示。
 */
export function SpotFollowButton({ follow, onToggle }: { follow: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={follow}
      title={follow ? "取消追踪" : "追踪标的价居中"}
      aria-label={follow ? "取消追踪" : "追踪标的价居中"}
      onClick={onToggle}
      className={`ms-control flex h-7 items-center gap-1 px-2 font-mono text-[9px] tracking-[0.08em] transition-colors ${
        follow
          ? "border-[var(--ms-brand)] bg-[var(--ms-brand-dim)] text-[var(--ms-text-primary)]"
          : "text-[var(--ms-text-tertiary)] hover:text-[var(--ms-text-primary)]"
      }`}
    >
      <Crosshair size={12} strokeWidth={1.5} />
      追踪
    </button>
  );
}
