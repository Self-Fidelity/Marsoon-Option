"use client";

import { LayoutTemplate } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { DockviewApi } from "dockview-react";

import {
  applyPayload,
  capturePayload,
  deleteBoardTemplate,
  getBoardTemplate,
  getDefaultTemplateName,
  listBoardTemplates,
  normalizeTemplateName,
  saveBoardTemplate,
  saveLayout,
  setDefaultBoardTemplate,
} from "./board-dock-layout";
import { encodeBoardShare } from "./board-share-codec";
import { useFloatingPopover } from "./use-floating-popover";

const MENU_WIDTH = 288;

/**
 * 看板级第三十三轮：「模板」浮层（照 BoardAddMenu 样式）——
 * 本地多模板固化布局 + 默认模板（启动优先应用）+ 复制分享链接（?layout= 编码 payload）。
 * 布局自动存档不受影响，模板是其上的一层快照。
 */
export function BoardTemplateMenu({ api }: { api: DockviewApi | null }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<{ name: string; savedAt: string }[]>([]);
  const [defaultName, setDefaultName] = useState<string | null>(null);
  // 复制成功反馈：记录刚复制的模板名，按钮短暂变「已复制 ✓」，1.5s 自动还原
  const [copiedName, setCopiedName] = useState<string | null>(null);
  const close = useCallback(() => setOpen(false), []);
  const { anchorRef, popoverRef, position } = useFloatingPopover(open, MENU_WIDTH, close);

  const refresh = () => {
    setItems(listBoardTemplates());
    setDefaultName(getDefaultTemplateName());
  };

  useEffect(() => {
    if (open) refresh();
  }, [open]);

  const onSaveCurrent = () => {
    if (!api) return;
    const input = window.prompt("模板名字（≤24 字符）：", "");
    if (input === null) return;
    const name = normalizeTemplateName(input);
    if (!name) {
      window.alert("模板名字为空或超过 24 字符");
      return;
    }
    if (getBoardTemplate(name) && !window.confirm(`已存在模板「${name}」，覆盖？`)) return;
    saveBoardTemplate(name, capturePayload(api));
    refresh();
  };

  const onApply = (name: string) => {
    if (!api) return;
    const payload = getBoardTemplate(name);
    if (!payload) return;
    if (!window.confirm(`应用模板「${name}」？当前布局会被覆盖（可先另存为模板）`)) return;
    if (applyPayload(api, payload)) saveLayout(api);
    close();
  };

  const onToggleDefault = (name: string) => {
    setDefaultBoardTemplate(defaultName === name ? null : name);
    refresh();
  };

  const onCopyShare = async (name: string) => {
    const payload = getBoardTemplate(name);
    if (!payload) return;
    const code = await encodeBoardShare(payload);
    // 第三十三轮修正：本机回环地址（127.x/localhost/[::1]）不带 origin——
    // 本机 IP 对别人无意义，只复制 `?layout=...` 参数串，对方拼到自己看板地址后即可用；
    // 非回环（已部署域名）才复制完整可点链接。
    const loopback = /^(localhost|127\.|\[::1\])/.test(location.hostname);
    const url = loopback ? `?layout=${code}` : `${location.origin}${location.pathname}?layout=${code}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedName(name);
      window.setTimeout(() => setCopiedName((v) => (v === name ? null : v)), 1500);
    } catch {
      window.prompt("复制失败，请手动复制分享内容：", url);
    }
  };

  const onDelete = (name: string) => {
    if (!window.confirm(`删除模板「${name}」？`)) return;
    deleteBoardTemplate(name);
    refresh();
  };

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        aria-label="模板"
        aria-expanded={open}
        title="布局模板 / 分享链接"
        onClick={() => setOpen((v) => !v)}
        className="ms-control flex h-9 items-center gap-1.5 px-2.5 text-[12px] font-semibold text-[var(--ms-text-secondary)] transition-colors hover:border-[var(--ms-brand)] hover:text-[var(--ms-brand)]"
      >
        <LayoutTemplate size={15} strokeWidth={1.5} />
        模板
      </button>

      {open && position
        ? createPortal(
        <div
          ref={popoverRef}
          role="menu"
          className="ms-popover fixed z-[10000] w-72 p-2"
          style={{ left: position.left, top: position.top }}
        >
          <button
            type="button"
            disabled={!api}
            onClick={onSaveCurrent}
            className="ms-control h-7 w-full px-2.5 text-[10px] text-[var(--ms-text-secondary)] transition-colors hover:border-[var(--ms-brand)] hover:text-[var(--ms-brand)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            保存当前为模板…
          </button>

          {items.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-1.5">
              {items.map((item) => (
                <li
                  key={item.name}
                  className="border border-[var(--ms-separator)] px-2 py-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[11px] text-[var(--ms-text-primary)]">
                      {defaultName === item.name ? "★ " : ""}
                      {item.name}
                    </span>
                    <button
                      type="button"
                      disabled={!api}
                      onClick={() => onApply(item.name)}
                      className="shrink-0 text-[10px] text-[var(--ms-brand)] hover:underline disabled:opacity-40"
                    >
                      应用
                    </button>
                  </div>
                  <div className="mt-1 flex gap-3 text-[10px] text-[var(--ms-text-secondary)]">
                    <button type="button" onClick={() => onToggleDefault(item.name)} className="hover:text-[var(--ms-brand)]">
                      {defaultName === item.name ? "取消默认" : "设为默认"}
                    </button>
                    <button type="button" onClick={() => void onCopyShare(item.name)} className="hover:text-[var(--ms-brand)]">
                      {copiedName === item.name ? "已复制 ✓" : "复制分享链接"}
                    </button>
                    <button type="button" onClick={() => onDelete(item.name)} className="hover:text-red-400">
                      删除
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[10px] text-[var(--ms-text-tertiary)]">暂无模板</p>
          )}

          <p className="mt-2 font-mono text-[8px] leading-4 text-[var(--ms-text-tertiary)]">
            布局自动保存；模板用于固化多套布局。本机复制得到的是 ?layout= 参数串，
            拼到任意看板地址后即可打开；部署域名下复制的才是完整链接
          </p>
        </div>,
            document.body,
          )
        : null}
    </>
  );
}
