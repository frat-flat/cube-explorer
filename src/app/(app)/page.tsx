import type { Metadata } from "next";
import { HomeStage } from "./_home/HomeStage";

export const metadata: Metadata = { title: "ホーム | 4DB" };

// 入口(/)。いちばん上の Box を単位ごとに立体にして並べる World の舞台(D-017)。
// ログインの確認は src/proxy.ts と枠(layout.tsx)、データの確認は API(/api/4db/home)で行う
export default function HomePage() {
  return <HomeStage />;
}
