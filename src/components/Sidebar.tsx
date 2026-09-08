"use client";

import { Activity, GraduationCap, LayoutGrid } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { LogoutButton } from "./LogoutButton";

export const navigation = [
  { label: "面板", code: "01", href: "/board", icon: LayoutGrid },
  { label: "投教", code: "02", href: "/teaching", icon: GraduationCap },
  { label: "订单流", code: "03", href: "https://subapp.marsoon.cn/", icon: Activity },
];

export function Sidebar({ collapsed }: { collapsed: boolean }) {
  const pathname = usePathname();

  return (
    <>
      <div
        className={`hidden shrink-0 overflow-hidden transition-[width] duration-200 ease-out lg:block ${
          collapsed ? "w-0" : "w-36"
        }`}
      >
        <aside
          className={`sticky top-0 flex h-screen w-36 flex-col border-r border-[var(--ms-separator)] bg-[var(--ms-panel-bg)] transition-transform duration-200 ease-out ${
            collapsed ? "-translate-x-full" : "translate-x-0"
          }`}
        >
          <div className="flex h-14 items-center justify-start border-b border-[var(--ms-separator)] px-3">
            <span className="grid size-8 place-items-center rounded-[10px] bg-[var(--ms-brand)] text-[13px] font-bold tracking-tight text-[var(--ms-brand-ink)]" aria-label="Marsoon">
              M
            </span>
          </div>

          <nav className="space-y-1 px-2 py-3" aria-label="期权看板导航">
            {navigation.map(({ label, href, icon: Icon }) => {
              const active = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`group flex h-9 w-full items-center gap-2 rounded-[10px] border px-2.5 text-left text-[12px] font-semibold transition-colors ${
                    active
                      ? "border-[var(--ms-brand)] bg-[var(--ms-brand-dim)] text-[var(--ms-text-primary)]"
                      : "border-transparent text-[var(--ms-text-secondary)] hover:bg-[var(--ms-elevated-bg)] hover:text-[var(--ms-text-primary)]"
                  }`}
                >
                  <Icon size={15} strokeWidth={1.5} aria-hidden="true" />
                  <span className="flex-1">{label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="mt-auto border-t border-[var(--ms-separator)] px-2 py-3">
            <LogoutButton />
          </div>
        </aside>
      </div>

      <nav
        className="fixed inset-x-0 bottom-0 z-50 grid h-16 grid-cols-3 border-t border-[var(--ms-separator)] bg-[var(--ms-panel-bg)] lg:hidden"
        aria-label="移动端期权看板导航"
      >
        {navigation.map(({ label, href, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex flex-col items-center justify-center gap-1 text-[11px] font-semibold ${
                active ? "text-[var(--ms-brand)]" : "text-[var(--ms-text-tertiary)]"
              }`}
            >
              <Icon size={15} strokeWidth={1.5} aria-hidden="true" />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
