import type { Metadata } from "next";
import { ProjectedSheet } from "./ProjectedSheet";

export const metadata: Metadata = { title: "表で見る | 4DB" };

// 取り込んだデータを、行と列を選んだ表で見る(Projected Sheet)。ログインの確認は src/proxy.ts、データの確認は各 API で行う
export default function SheetPage() {
  return <ProjectedSheet />;
}
