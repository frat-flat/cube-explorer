import type { Metadata } from "next";
import { Migrate } from "./Migrate";

export const metadata: Metadata = { title: "Import | 4DB" };

// ファイル(Google スプレッドシート)から 4DB へ移す(取り込みと承認)。ログインの確認は src/proxy.ts と枠(layout.tsx)、データの確認は各 API で行う
export default function MigratePage() {
  return <Migrate />;
}
