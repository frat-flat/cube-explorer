// 「数値」の選択肢を、「対象のシート」で絞る(Table の画面の部品。画面の外で試せるように切り出してある)
import type { Catalog } from "@/fourdb/adapters/postgres/projection";

type Measure = Catalog["measures"][number];

/**
 * 選んだシートにある数値だけを返す。sheetIds が null(何も選んでいない = すべてのシート)なら、すべて。
 * 返す sheets は、選んだシートのうち、その数値を持つ数
 */
export function measuresIn(measures: Measure[], sheetIds: string[] | null): Measure[] {
  if (!sheetIds) return measures;
  const chosen = new Set(sheetIds);
  return measures.flatMap((m) => {
    const sheetIdsHere = m.sheetIds.filter((id) => chosen.has(id));
    return sheetIdsHere.length > 0 ? [{ ...m, sheets: sheetIdsHere.length, sheetIds: sheetIdsHere }] : [];
  });
}

/** 数値の選択肢の添え書き(例「売上(シート 3 個)」) */
export const measureLabel = (m: Pick<Measure, "name" | "sheets">) => `${m.name}(シート ${m.sheets} 個)`;

/** 選んでいる数値が、選んだシートにないときの知らせ。勝手に別の数値に切り替えず、選び直してもらう */
export const measureMissingMessage = (name: string) => `選んだシートには『${name}』がありません。数値かシートを選び直してください。`;

/** 保存した表の数値が、今のデータにないときの知らせ(名前が分からなければ名前なし)。別の数値に切り替えず、選び直してもらう */
export const measureGoneMessage = (name: string | null) =>
  name ? `保存した表の数値『${name}』が見つかりません。数値を選び直してください。` : "保存した表の数値が見つかりません。数値を選び直してください。";
