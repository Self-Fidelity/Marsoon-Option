"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { createContext, useContext } from "react";

/**
 * 侧栏开关上下文（2026-09-04 侧栏全站统一）：
 * 收起状态由 AppShell 持有（记 localStorage），开关按钮只存在于各页功能栏
 * （/board 顶栏 leading 位、/teaching 功能栏，均为本组件，样式与交互全站一致）。
 */
export const SidebarToggleContext = createContext<{ collapsed: boolean; toggle: () => void }>({
  collapsed: false,
  toggle: () => {},
});

/** 功能栏侧栏开关：图标随状态切换（展开态=收起箭头，收起态=展开箭头），样式同旧 NavDrawer 按钮。 */
export function SidebarToggleButton() {
  const { collapsed, toggle } = useContext(SidebarToggleContext);
  return (
    <button
      type="button"
      aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
      title={collapsed ? "展开侧栏" : "收起侧栏"}
      aria-expanded={!collapsed}
      onClick={toggle}
      className="ms-control grid size-9 shrink-0 place-items-center text-[var(--ms-text-secondary)] transition-colors hover:border-[var(--ms-brand)] hover:text-[var(--ms-brand)]"
    >
      {collapsed ? (
        <PanelLeftOpen size={15} strokeWidth={1.5} />
      ) : (
        <PanelLeftClose size={15} strokeWidth={1.5} />
      )}
    </button>
  );
}
