import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        // 教学页内容：仅发版时变化，长缓存 + 过期后台刷新，避免每次整页 iframe 重下 1.7MB HTML
        source: "/teaching-content/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=3600, stale-while-revalidate=86400" }],
      },
    ];
  },
};

export default nextConfig;
