import type { Metadata } from "next";

import { SectionPlaceholder } from "@/components/SectionPlaceholder";

export const metadata: Metadata = { title: "资金流" };

export default function FlowPage() {
  return (
    <SectionPlaceholder
      code="04"
      title="资金流"
      description="该功能正在准备中，完成后可在这里查看资金流与市场结构。"
    />
  );
}
