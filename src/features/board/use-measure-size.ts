"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface MeasuredSize {
  width: number;
  height: number;
}

/**
 * 面板真自适应共享 hook（06面板迭代文档 第十九轮；第二十二轮重写，根治
 * "Maximum update depth exceeded" 死循环）：
 * ResizeObserver 量容器 clientWidth/clientHeight，rAF 合并（拖拽 resize 每帧最多一次
 * state 更新），同尺寸不重复 setState；SSR 安全——初始 {0,0}，挂载后首帧实测。
 * 返回 [refCallback, size]：refCallback 挂到被测容器；size 为 0 表示尚未实测（首帧），
 * 消费侧做兜底。
 *
 * 第二十二轮死循环根因与对策：
 *  - 根因：旧实现用 useState 存被测 node，ref 回调在 React commit 阶段同步
 *    setNode，叠加 effect deps [node] 重订阅，dockview 拖拽 resize/分支切换
 *    （骨架↔内容换 div）时 commit 阶段连锁 setState，触发 Maximum update depth；
 *  - 修法：node/observer/rAF 全部降为 ref 管理，ref 回调内零同步 setState——
 *    首次实测也走 rAF（schedule），commit 阶段只挂 observer；唯一 setState
 *    路径是 rAF 回调（异步），同步更新深度从结构上不可能超限；
 *  - refCallback useCallback 空依赖固定引用，摘挂只在真挂载/卸载发生；
 *  - 塌 0 保持上一次有效尺寸：跳过 0×0 读数（窗口瞬隐/布局抖动不误伤），
 *    消费侧绝不在容器其实有尺寸时渲染空白。
 * 规范：chrome（字号/徽标/gutter）保持固定 px，弹性全部让给绘图区。
 * 输出尺寸恒为整数（Math.floor，第二十八轮像素对齐）：消费侧 svg 的 width/height 属性、
 * viewBox、CSS 尺寸统一用该整数，保证 1:1 无缩放（文字不发虚）；禁止 transform scale。
 */
export function useMeasureSize<T extends HTMLElement>(): [
  (node: T | null) => void,
  MeasuredSize,
] {
  const [size, setSize] = useState<MeasuredSize>({ width: 0, height: 0 });
  const observerRef = useRef<ResizeObserver | null>(null);
  const rafRef = useRef(0);

  const refCallback = useCallback((el: T | null) => {
    // 摘旧：断开旧 observer、取消挂起 rAF（挂载新节点或卸载（el=null）都先清理）
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (rafRef.current !== 0) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    if (!el) return;

    const update = () => {
      rafRef.current = 0;
      // 像素对齐（06 第二十八轮 1A）：实测尺寸取整（floor）——自适应后容器实际盒尺寸可为小数，
      // 小数 viewBox 与 CSS px 不 1:1 会让整张 svg 亚像素缩放、文字发虚。floor（非 round）保证
      // 整数尺寸 ≤ 容器，svg 以整数宽高渲染，右侧/下侧至多留 <1px 空隙，绝不溢出触发滚动条。
      const width = Math.floor(el.clientWidth);
      const height = Math.floor(el.clientHeight);
      // 塌 0 保持上一次有效尺寸（不更新），等恢复非零再跟进
      if (width === 0 || height === 0) return;
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    };
    const schedule = () => {
      if (rafRef.current === 0) rafRef.current = requestAnimationFrame(update);
    };
    // 首测也走 rAF：commit 阶段不做任何同步 setState（第二十二轮根因对策）
    schedule();
    const observer = new ResizeObserver(schedule);
    observer.observe(el);
    observerRef.current = observer;
  }, []);

  // 卸载兜底：React 卸载时会以 null 调 refCallback 已清理，此 effect 防异常路径残留
  useEffect(
    () => () => {
      observerRef.current?.disconnect();
      if (rafRef.current !== 0) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  return [refCallback, size];
}
