import type { ReactNode } from "react";

export function SectionPlaceholder({
  code,
  title,
  description,
  children,
}: {
  code: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="dashboard-grid min-h-screen p-3 sm:p-4">
      <header className="ms-panel mb-3 flex min-h-16 items-center justify-between px-4">
        <div>
          <p className="font-mono text-[8px] tracking-[0.16em] text-[var(--ms-brand)]">
            MODULE // {code}
          </p>
          <h1 className="mt-1 text-base font-medium text-[var(--ms-text-primary)]">{title}</h1>
        </div>
        <span className="font-mono text-[8px] tracking-[0.12em] text-[var(--ms-text-tertiary)]">功能准备中</span>
      </header>

      <section className="ms-panel grid min-h-[420px] place-items-center px-6 text-center">
        <div className="max-w-lg">
          <h2 className="text-lg font-medium text-[var(--ms-text-primary)]">{title}功能准备中</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--ms-text-secondary)]">{description}</p>
          {children}
        </div>
      </section>
    </div>
  );
}
