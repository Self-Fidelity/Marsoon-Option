"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";

import { persistQueryCache, restoreQueryCache } from "@/features/options/query-persistence";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            // 新鲜度由 version 轮询 + 调度器失效驱动（data-freshness.ts）；
            // 窗口聚焦重拉会让 900KB 级大快照反复触发 Go 25~60s 重聚合，全站关闭。
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  // 先把 IndexedDB 里的本地快照灌回缓存，再挂载业务树：
  // EOD/K线首屏直接命中本地缓存秒开，是否后台重拉由调度器比对 version unix 决定。
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    let alive = true;
    void restoreQueryCache(queryClient).finally(() => {
      if (alive) setRestored(true);
    });
    return () => {
      alive = false;
    };
  }, [queryClient]);
  useEffect(() => persistQueryCache(queryClient), [queryClient]);

  return <QueryClientProvider client={queryClient}>{restored ? children : null}</QueryClientProvider>;
}
