import type { Metadata } from "next";

import { SectionPlaceholder } from "@/components/SectionPlaceholder";

export const metadata: Metadata = { title: "Gamma 地图" };

export default function GammaPage() {
  return (
    <SectionPlaceholder
      code="02"
      title="Gamma 地图"
      description="该功能正在准备中，完成后可在这里查看多到期日结构与执行价分布。"
    />
  );
}
