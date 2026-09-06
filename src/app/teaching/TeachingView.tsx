"use client";

import { SidebarToggleButton } from "@/components/SidebarToggle";

/**
 * 教学看板视图：功能栏（与 /board 顶栏同高同款）+ 整页 iframe 加载 public/teaching.html。
 * 更换内容只需替换 public/teaching.html，无需改代码。
 * 移动端底部导航由 iframe 自己留白（功能栏 + flex-1 撑满视口高度）。
 */
export function TeachingView() {
  return (
    <div className="flex h-dvh flex-col bg-[var(--ms-app-bg)]">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--ms-separator)] bg-[var(--ms-app-bg)] px-3 sm:px-4">
        <SidebarToggleButton />
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="text-[13px] font-bold text-[var(--ms-text-primary)]">
            投教
          </span>
        </div>
      </header>
      <iframe
        src="/teaching.html"
        title="教学看板"
        className="min-h-0 w-full flex-1 border-0 bg-[var(--ms-app-bg)]"
      />
    </div>
  );
}
