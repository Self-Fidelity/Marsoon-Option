"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";

import { Sidebar } from "./Sidebar";
import { SidebarToggleContext } from "./SidebarToggle";
import { ClientActivityReporter } from "@/features/retention/ClientActivityReporter";

const COLLAPSED_KEY = "marsoon-sidebar-collapsed";

// 侧栏收起开关只存在于功能栏页面（同一 SidebarToggleButton：/board 顶栏 leading 位、
// /teaching 功能栏）。其余页面（占位页/旧仪表盘/panel-shot 等）强制展开，
// 避免出现"收起后当前页没有展开入口"的死状态。收起态仍记 localStorage 全站共享。
const TOGGLE_PATHS = ["/board", "/teaching"];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(localStorage.getItem(COLLAPSED_KEY) === "1");
  }, []);

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
      return next;
    });
  }, []);

  const effectiveCollapsed = collapsed && TOGGLE_PATHS.includes(pathname);

  return (
    <SidebarToggleContext.Provider value={{ collapsed: effectiveCollapsed, toggle }}>
      <ClientActivityReporter enabled={pathname !== "/login"} />
      <div className="flex min-h-screen bg-[var(--ms-app-bg)] text-[var(--ms-text-primary)]">
        <Sidebar collapsed={effectiveCollapsed} />
        <main className="min-w-0 flex-1 pb-16 lg:pb-0">{children}</main>
      </div>
    </SidebarToggleContext.Provider>
  );
}
