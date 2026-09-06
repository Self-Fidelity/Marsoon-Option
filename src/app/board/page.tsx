import type { Metadata } from "next";
import { Suspense } from "react";

import { BoardView } from "@/features/board/BoardView";

export const metadata: Metadata = { title: "拼装看板" };

function BoardFallback() {
  return (
    <div className="dashboard-grid min-h-screen p-3 sm:p-4">
      <div className="h-16 animate-pulse rounded-[10px] border border-[var(--ms-separator)] bg-[var(--ms-panel-bg)]" />
      <div className="mx-auto mt-3 h-[470px] w-full max-w-5xl animate-pulse rounded-[10px] border border-[var(--ms-separator)] bg-[var(--ms-card-bg)]" />
    </div>
  );
}

export default function BoardPage() {
  return (
    <Suspense fallback={<BoardFallback />}>
      <BoardView />
    </Suspense>
  );
}
