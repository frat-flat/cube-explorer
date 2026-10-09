import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 以前の表の画面 /sheet は、画面の名前を Table にしたので /table へ移した(D-015)。永続の転送(308)で、?def=… などの問い合わせも引き継ぐ。
  // 転送はログインの確認(src/proxy.ts)より前に動くが、行き先の /table が改めて確かめる
  async redirects() {
    return [{ source: "/sheet", destination: "/table", permanent: true }];
  },
  // 入口(/)は 4D Base のダッシュボード(public/sheets/axes.html)。ログインは src/proxy.ts で確かめる
  async rewrites() {
    return {
      beforeFiles: [{ source: "/", destination: "/sheets/axes.html" }],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
