import type { Metadata } from "next";
import { Migrate } from "./Migrate";

export const metadata: Metadata = { title: "スプシから移す | 4D Base" };

// スプシから 4D Base へ移す(取り込みと承認)。ログインの確認は src/proxy.ts、データの確認は各 API で行う
export default function MigratePage() {
  return <Migrate />;
}
