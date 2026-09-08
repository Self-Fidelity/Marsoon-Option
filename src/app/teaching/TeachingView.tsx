"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { SyntheticEvent } from "react";

import { SidebarToggleButton } from "@/components/SidebarToggle";

const LESSONS = [
  { key: "home", label: "首页", file: "首页.html", title: "Gamma 交易框架" },
  { key: "05", label: "05 热力图", file: "面板05_到期热力图_React.html", title: "到期热力图" },
  { key: "06", label: "06 日内", file: "面板06_日内变化_React.html", title: "日内变化" },
  { key: "07", label: "07 波动率", file: "面板07_波动率微笑偏斜_React.html", title: "波动率微笑与偏斜" },
  { key: "08", label: "08 GEX", file: "面板08_CallPutGEX_React.html", title: "Call / Put GEX" },
  { key: "09", label: "09 期权链", file: "面板09_期权链下钻_React.html", title: "期权链下钻" },
  { key: "10", label: "10 月间价差", file: "面板10_月间价差PCR_React.html", title: "月间价差与 PCR" },
] as const;

type LessonKey = typeof LESSONS[number]["key"];

function lessonOf(value: string | null) {
  return LESSONS.find((lesson) => lesson.key === value) ?? LESSONS[0];
}

function lessonHref(key: LessonKey) {
  return key === "home" ? "/teaching" : `/teaching?lesson=${key}`;
}

/** Next.js navigation shell around the seven self-contained React teaching modules. */
export function TeachingView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selected = lessonOf(searchParams.get("lesson"));
  const src = `/teaching-content/${selected.file}`;

  const syncEmbeddedNavigation = (event: SyntheticEvent<HTMLIFrameElement>) => {
    try {
      const pathname = event.currentTarget.contentWindow?.location.pathname ?? "";
      const filename = decodeURIComponent(pathname.split("/").at(-1) ?? "");
      const lesson = LESSONS.find((item) => item.file === filename);
      if (lesson && lesson.key !== selected.key) router.replace(lessonHref(lesson.key), { scroll: false });
    } catch {
      // External reference links may navigate the iframe cross-origin; the shell remains usable.
    }
  };

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-[var(--ms-app-bg)]">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--ms-separator)] bg-[var(--ms-app-bg)] px-3 sm:px-4">
        <SidebarToggleButton />
        <span className="shrink-0 text-[13px] font-bold text-[var(--ms-text-primary)]">投教</span>
        <span className="min-w-0 truncate text-[11px] text-[var(--ms-text-secondary)]">{selected.title}</span>
      </header>

      <nav className="flex h-11 shrink-0 items-center gap-1 overflow-x-auto border-b border-[var(--ms-separator)] bg-[var(--ms-panel-bg)] px-2" aria-label="教学页面导航">
        {LESSONS.map((lesson) => {
          const active = lesson.key === selected.key;
          return (
            <Link
              key={lesson.key}
              href={lessonHref(lesson.key)}
              aria-current={active ? "page" : undefined}
              className={`ms-control flex h-7 shrink-0 items-center px-2.5 text-[11px] font-semibold transition-colors ${
                active
                  ? "border-[var(--ms-brand)] bg-[var(--ms-brand-dim)] text-[var(--ms-brand)]"
                  : "text-[var(--ms-text-secondary)] hover:text-[var(--ms-text-primary)]"
              }`}
            >
              {lesson.label}
            </Link>
          );
        })}
      </nav>

      <iframe
        src={src}
        title={selected.title}
        onLoad={syncEmbeddedNavigation}
        className="min-h-0 w-full flex-1 border-0 bg-[#050505]"
      />
    </div>
  );
}
