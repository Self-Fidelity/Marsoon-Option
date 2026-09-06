import type { Metadata } from "next";

import { SectionPlaceholder } from "@/components/SectionPlaceholder";

export const metadata: Metadata = { title: "0DTE" };

export default function ZeroDtePage() {
  return (
    <SectionPlaceholder
      code="03"
      title="0DTE"
      description="该功能正在准备中，完成后可在这里查看当日到期的成交量与持仓分布。"
    />
  );
}
