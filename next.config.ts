import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 入口(/)は「軸の辞書と箱」のダッシュボード(public/sheets/axes.html)。ログインは src/proxy.ts で確かめる
  async rewrites() {
    return {
      beforeFiles: [{ source: "/", destination: "/sheets/axes.html" }],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
