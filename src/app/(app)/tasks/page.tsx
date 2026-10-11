import type { Metadata } from "next";
import { Tasks } from "./Tasks";

export const metadata: Metadata = { title: "Task | 4DB" };

// Task(やること): 承認待ち・読み取りや反映の途中・失敗した取り込みと、ファイルごとの移行の進み具合。
// ログインの確認は src/proxy.ts と枠(layout.tsx)、データの確認は API(/api/4db/tasks)で行う
export default function TasksPage() {
  return <Tasks />;
}
