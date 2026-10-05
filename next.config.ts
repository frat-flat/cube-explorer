import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // キューブ組み立ての試作(public/builder/index.html)を /builder で開く
  async rewrites() {
    return [{ source: "/builder", destination: "/builder/index.html" }];
  },
};

export default nextConfig;
