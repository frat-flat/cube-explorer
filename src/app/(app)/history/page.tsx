import type { Metadata } from "next";
import { History } from "./History";

export const metadata: Metadata = { title: "履歴 | 4DB" };

// 履歴(取り込み・表の保存の記録)。ログインの確認は src/proxy.ts と枠(layout.tsx)、データの確認は API(/api/4db/history)で行う
export default function HistoryPage() {
  return <History />;
}
