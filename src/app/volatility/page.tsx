import type { Metadata } from "next";

import { SectionPlaceholder } from "@/components/SectionPlaceholder";

export const metadata: Metadata = { title: "波动率" };

export default function VolatilityPage() {
  return (
    <SectionPlaceholder
      code="05"
      title="波动率"
      description="该功能正在准备中，完成后可在这里查看波动率微笑与期限结构。"
    />
  );
}
