import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // キューブ組み立ての試作(public/builder/index.html)を /builder、シートの器の試作を /sheets で開く
  async rewrites() {
    return [
      { source: "/builder", destination: "/builder/index.html" },
      { source: "/sheets", destination: "/sheets/index.html" },
    ];
  },
};

export default nextConfig;
