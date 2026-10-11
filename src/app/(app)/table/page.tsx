import type { Metadata } from "next";
import { isUuid } from "@/app/api/4db/ids";
import { ProjectedSheet } from "./ProjectedSheet";

export const metadata: Metadata = { title: "Table | 4DB" };

// 取り込んだデータを、行と列を選んだ表で見る(画面の名前は Table。中の名前は Projected Sheet のまま)。
// 以前の URL /sheet は next.config.ts で /table へ転送する。ログインの確認は src/proxy.ts と枠(layout.tsx)、データの確認は各 API で行う。
// /table?def=<id> は、保存した表(履歴からの移動など)を開いた状態で出す。id の形でないものは、ないものとして扱う
export default async function TablePage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const def = (await searchParams).def;
  return <ProjectedSheet initialDefinitionId={typeof def === "string" && isUuid(def) ? def : null} />;
}
