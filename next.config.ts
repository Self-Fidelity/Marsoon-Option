import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        // 教学页内容：基本不动，长缓存（7 天不发请求 + 之后 30 天先展示旧版后台刷新）；
        // 若紧急修订内容，需改文件名或等缓存过期（见 AGENTS.md changelog）
        source: "/teaching-content/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=2592000" }],
      },
    ];
  },
};

export default nextConfig;
