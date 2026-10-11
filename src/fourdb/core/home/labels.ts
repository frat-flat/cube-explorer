// ホームの画面に出す文字(見出し)。並びや中身の決まりとは分けてある(組み込み先で差し替えられるように)。
// 文言を決めるのはオーナー(D-015)。ここは試作・D-017 の欄の名前をそのまま置いた案。
import type { SectionId } from "./sections";

export const SECTION_LABELS: Record<SectionId, string> = {
  names: "名前",
  inside: "中に",
  cardFields: "Card の項目",
  measures: "数値",
  period: "期間",
  sheets: "元のシート",
  tables: "Table",
  cube: "Cube",
  bands: "数字の帯",
};

/** 値がない欄に出す印 */
export const NO_VALUE_MARK = "—";

/** 計算された値(ƒ)の印と、読み上げの文 */
export const CALCULATED_MARK = "ƒ";
export const CALCULATED_LABEL = "計算された値";

/** まだ作っていない欄に出す印(作る段階) */
export const PHASE_MARKS: Record<"P8" | "P11", string> = { P8: "【P8】", P11: "【P11】" };
