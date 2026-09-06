"use client";

import { create } from "zustand";

/**
 * 跨面板下钻联动 focus store（05 第一轮 / 看板级第三十四轮）。
 * 瞬态：不持久化、不进布局存档（独立于 board-window-store，变更不触发布局自动保存）。
 * 生产者：05 到期热力图（点行/格子 → strike，点列头 → expiry）。
 * 消费者：09 期权链（expiry → 切到期 tab）、08 GEX 拆分（strike → 最近档高亮）。
 * 过期：消费侧忽略 at + FOCUS_TTL_MS 之前的 focus（防陈旧跳转）。
 */
export interface BoardFocus {
  strike?: number;
  /** 到期日 unix（秒），与 heatmap/chain 契约一致 */
  expiry?: number;
  /** Date.now() 时间戳 */
  at: number;
}

export const FOCUS_TTL_MS = 30_000;

interface BoardFocusState {
  focus: BoardFocus | null;
  setFocus: (focus: { strike?: number; expiry?: number }) => void;
  clearFocus: () => void;
}

export const useBoardFocusStore = create<BoardFocusState>((set) => ({
  focus: null,
  setFocus: (focus) => set({ focus: { ...focus, at: Date.now() } }),
  clearFocus: () => set({ focus: null }),
}));

/** 消费侧统一过期判断：无 focus 或超 TTL 返回 null */
export function liveFocus(focus: BoardFocus | null): BoardFocus | null {
  if (!focus) return null;
  return Date.now() - focus.at <= FOCUS_TTL_MS ? focus : null;
}
