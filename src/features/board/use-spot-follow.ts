"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 追踪标的价居中（TradingView 跟踪逻辑，05/08/09 共用）：
 * 开启后滚动容器始终滚动到最近的执行价行（面板标记的 [data-spot-row]）垂直居中；
 * 用户任何手动滚动（滚轮/拖拽/触摸/键盘，统一表现为 scroll 事件）立即关闭追踪。
 *
 * 滚动容器结构说明：05/08/09 均为"内容纵向滚动型面板"，滚动由外层 DockPanelBody
 * （overflow-auto）承载而非面板自身，面板 JSX 里拿不到该元素、无法用 React onScroll——
 * 故 hook 从 setRootEl 挂载的元素向上找最近的 overflow-y 可滚祖先作为实际滚动容器，
 * 并以其 addEventListener("scroll") 监听。
 *
 * 程序化滚动与用户滚动的区分（经典 flag 前置法）：
 * 程序化滚动前置 programmatic=true 再改 scrollTop；onScroll 命中 flag 即忽略，
 * 否则视为用户手动滚动 → setFollow(false)。flag 复位时机分两种：
 *  - 即时滚动（保持居中）：scroll 事件先于下一帧 rAF 派发，rAF 复位即可；
 *  - smooth 动画（仅开启瞬间）：跨多帧持续派发 scroll，flag 须保持到动画结束——
 *    由 scrollend（once）+ 超时兜底复位。
 *
 * 用法：面板把 setRootEl 挂到面板内任一元素（向上可达滚动容器即可），
 * 并在 effect 里对 [follow, spot, 行数据] 调 keepSpotCentered（行 DOM 重建后
 * 在下一帧 rAF 重新查询 [data-spot-row]，故查询不放在渲染期）。
 */
export function useSpotFollow<T extends HTMLElement>() {
  // 面板内挂载点（仅用于向上解析滚动容器，任意后代元素皆可）。
  // 用 state 而非 ref：空态→有数据的首次挂载 ref 才就位，effect 需随挂载点补挂监听；
  // setRootEl 为 useCallback 固定引用，每挂载/卸载仅各调一次，无连锁 setState 风险
  const [rootEl, setRootElState] = useState<T | null>(null);
  // 实际滚动容器（外层 DockPanelBody），挂载后解析
  const containerRef = useRef<HTMLElement | null>(null);
  const [follow, setFollow] = useState(false);
  // follow 的 ref 镜像：scroll 事件回调读取最新值，不受闭包过期影响
  const followRef = useRef(follow);
  followRef.current = follow;
  // 程序化滚动前置 flag（语义见文件头注释）
  const programmaticRef = useRef(false);
  // 开启瞬间的平滑滚动由 toggleFollow 负责，keepSpotCentered 跳过开启当次，
  // 避免同一帧内的即时滚动抢掉平滑动画
  const justEnabledRef = useRef(false);
  const smoothResetTimerRef = useRef<number | undefined>(undefined);

  /** 面板挂载点 ref 回调（挂在面板根或任一内部容器均可） */
  const setRootEl = useCallback((el: T | null) => {
    setRootElState(el);
  }, []);

  /** 滚动到最近的执行价行垂直居中；behavior=smooth 仅供开启瞬间使用，其余一律 instant */
  const scrollToSpot = useCallback((behavior: ScrollBehavior) => {
    const container = containerRef.current;
    if (!container) return;
    const row = container.querySelector<HTMLElement>("[data-spot-row]");
    if (!row) return;
    // 行元素可能是 svg <g>（08 的 barsOnly 档无 offsetTop/offsetHeight）——
    // 统一用 rect 差值换算容器内容坐标：top = 行 rect 顶 − 容器 rect 顶 + 已滚距离
    const rowRect = row.getBoundingClientRect();
    const rowTop = rowRect.top - container.getBoundingClientRect().top + container.scrollTop;
    programmaticRef.current = true;
    container.scrollTo({
      top: rowTop + rowRect.height / 2 - container.clientHeight / 2,
      behavior,
    });
    if (behavior === "smooth") {
      // smooth 动画跨多帧持续派发 scroll：flag 保持到 scrollend（不支持时用超时兜底复位）
      const reset = () => {
        programmaticRef.current = false;
      };
      container.addEventListener("scrollend", reset, { once: true });
      window.clearTimeout(smoothResetTimerRef.current);
      smoothResetTimerRef.current = window.setTimeout(reset, 800);
    } else {
      // 即时滚动：scroll 事件先于下一帧 rAF 派发，rAF 复位即不误判用户滚动
      requestAnimationFrame(() => {
        programmaticRef.current = false;
      });
    }
  }, []);

  /** 滚动事件入口：flag 命中（程序化）忽略；否则是用户手动滚动 → 关闭追踪 */
  const onContainerScroll = useCallback(() => {
    if (programmaticRef.current) return;
    if (followRef.current) setFollow(false);
  }, []);

  // 解析实际滚动容器（向上找最近 overflow-y 可滚祖先）并挂 scroll 监听；
  // 依赖 rootEl：空态→有数据首次挂载时才就位，须随挂载点补挂
  useEffect(() => {
    if (!rootEl) return;
    let node: HTMLElement | null = rootEl.parentElement;
    while (node) {
      const overflowY = getComputedStyle(node).overflowY;
      if (overflowY === "auto" || overflowY === "scroll") break;
      node = node.parentElement;
    }
    const container = node;
    containerRef.current = container;
    container?.addEventListener("scroll", onContainerScroll);
    return () => {
      containerRef.current = null;
      container?.removeEventListener("scroll", onContainerScroll);
    };
  }, [rootEl, onContainerScroll]);

  // 卸载兜底：清掉 smooth 复位的兜底定时器
  useEffect(
    () => () => {
      window.clearTimeout(smoothResetTimerRef.current);
    },
    [],
  );

  /** 开关：开启置 follow 并 rAF 后平滑滚一次；关闭仅置位 */
  const toggleFollow = useCallback(() => {
    if (followRef.current) {
      setFollow(false);
      return;
    }
    justEnabledRef.current = true;
    setFollow(true);
    // rAF 后查询行元素并平滑滚动（等本次渲染提交、行 DOM 就位）
    requestAnimationFrame(() => scrollToSpot("smooth"));
  }, [scrollToSpot]);

  /** 追踪中保持居中（即时滚动）：面板在 effect 里对 [follow, spot, 行数据] 调本方法 */
  const keepSpotCentered = useCallback(() => {
    if (!followRef.current) return;
    if (justEnabledRef.current) {
      // 开启当次由 toggleFollow 的平滑滚动负责，跳过避免即时滚动抢掉动画
      justEnabledRef.current = false;
      return;
    }
    scrollToSpot("instant");
  }, [scrollToSpot]);

  return { setRootEl, follow, toggleFollow, keepSpotCentered };
}
