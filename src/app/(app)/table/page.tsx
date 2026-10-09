import type { Metadata } from "next";
import { ProjectedSheet } from "./ProjectedSheet";

export const metadata: Metadata = { title: "Table | 4DB" };

// 取り込んだデータを、行と列を選んだ表で見る(画面の名前は Table。中の名前は Projected Sheet のまま)。
// 以前の URL /sheet は next.config.ts で /table へ転送する。ログインの確認は src/proxy.ts と枠(layout.tsx)、データの確認は各 API で行う
export default function TablePage() {
  return <ProjectedSheet />;
}
