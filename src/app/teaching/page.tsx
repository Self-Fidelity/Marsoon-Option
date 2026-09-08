import type { Metadata } from "next";
import { Suspense } from "react";

import { TeachingView } from "./TeachingView";

export const metadata: Metadata = { title: "教学看板" };

export default function TeachingPage() {
  return (
    <Suspense fallback={<div className="h-dvh bg-[var(--ms-app-bg)]" />}>
      <TeachingView />
    </Suspense>
  );
}
