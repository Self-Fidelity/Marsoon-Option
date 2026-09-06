"use client";

import { Plus } from "lucide-react";
import { useCallback, useState } from "react";
import { createPortal } from "react-dom";

import { BOARD_PANELS } from "./panel-registry";
import { useFloatingPopover } from "./use-floating-popover";

const MENU_WIDTH = 224;

/**
 * 「添加面板」浮层（布局极致简约化 B）：
 * 原 /board 顶部整行 chips 收进顶栏品种选择器右侧「+ 数据面板」按钮——点开浮层列出全部可添加面板，
 * 底部「重置布局」+ 一行小字提示；点外部自动关闭。添加/重置逻辑不变。
 * 浮层挂到 document.body，避免被 dockview / widget 内部层叠压住。
 */
export function BoardAddMenu({
  onAdd,
  onReset,
}: {
  onAdd: (panelKey: string) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const { anchorRef, popoverRef, position } = useFloatingPopover(open, MENU_WIDTH, close);

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        aria-label="添加面板"
        aria-expanded={open}
        title="添加面板 / 重置布局"
        onClick={() => setOpen((v) => !v)}
        className="ms-control flex h-9 items-center gap-1.5 px-2.5 text-[12px] font-semibold text-[var(--ms-text-secondary)] transition-colors hover:border-[var(--ms-brand)] hover:text-[var(--ms-brand)]"
      >
        <Plus size={15} strokeWidth={1.5} />
        面板
      </button>

      {open && position
        ? createPortal(
            <div
              ref={popoverRef}
              role="menu"
              className="ms-popover fixed z-[10000] w-56 p-2"
              style={{ left: position.left, top: position.top }}
            >
              <div className="flex flex-wrap gap-1.5">
                {BOARD_PANELS.map((panel) => (
                  <button
                    key={panel.key}
                    type="button"
                    role="menuitem"
                    title={`${panel.title}（可重复添加）`}
                    onClick={() => {
                      onAdd(panel.key);
                      close();
                    }}
                    className="h-7 border border-[var(--ms-separator)] px-2.5 text-[10px] text-[var(--ms-text-secondary)] transition-colors hover:border-[var(--ms-brand)] hover:text-[var(--ms-brand)]"
                  >
                    + {panel.chipLabel}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => {
                  onReset();
                  close();
                }}
                className="ms-control mt-2 h-7 w-full px-2.5 text-[10px] text-[var(--ms-text-secondary)] transition-colors hover:border-[var(--ms-brand)] hover:text-[var(--ms-brand)]"
              >
                重置布局
              </button>
              <p className="mt-2 font-mono text-[8px] leading-4 text-[var(--ms-text-tertiary)]">
                拖拽标签分栏/编组 · 可浮动 · 布局与窗口配置自动保存
              </p>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
