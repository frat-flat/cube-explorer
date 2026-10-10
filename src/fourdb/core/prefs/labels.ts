// 見た目・明暗・World の名前(日本語)。id(look.ts・prefs.ts)とは分けてある。
// 文言を決めるのはオーナー(D-015)。ここは作業指示 11 章(設計の担当の付録 A)の案。パターンの名前は仮(D-017)。
import type { Look, LookKey, PatternId } from "./look";
import type { Theme, WorldId } from "./prefs";

/** 部品の見出し(Visual の欄) */
export const LOOK_KEY_LABELS: Record<LookKey, string> = {
  shape: "Box の形",
  tilt: "向き",
  base: "台座",
  label: "札",
  bg: "背景",
  layout: "並べ方",
};

/** 部品ごとの選択肢の名前 */
export const LOOK_VALUE_LABELS: { [K in LookKey]: Record<Look[K], string> } = {
  shape: { glass: "ガラス", solid: "つや消し", ribbon: "帯つき", wire: "線と点" },
  tilt: { vertex: "角を下", flat: "面を下" },
  base: { dish: "くぼみの台", plinth: "2 段の台", ring: "光の輪", stone: "石の台", disc: "床の円盤" },
  label: { below: "台の下", front: "台の正面", float: "Box の上" },
  bg: { logo: "ロゴの線", quiet: "静か", grid: "床の格子" },
  layout: { row: "1 列", arc: "弧", stage: "ひな壇" },
};

/** パターンの名前(仮)と、ひとことの説明(仮) */
export const PATTERN_LABELS: Record<PatternId, { name: string; mood: string }> = {
  1: { name: "今の形", mood: "ガラスの Box が 2 段の台の上に浮かぶ、今の試作の形" },
  2: { name: "美術館", mood: "つや消しの Box を石の展示台に。名前と数は台の正面に刻む" },
  3: { name: "ロゴの宇宙", mood: "ロゴの帯がまわりを回る Box を光の輪の上に浮かべ、弧に並べる" },
  4: { name: "設計図", mood: "光る線と点だけの Box を、格子を引いた床の円盤に置く" },
  5: { name: "光の床", mood: "ガラスの Box を床の光だまりの上に浮かべ、弧に並べる" },
  6: { name: "ひな壇", mood: "帯つきの Box を 2 段のひな壇に並べる" },
  7: { name: "くぼみの台", mood: "角を下にしたガラスの Box が、上の面のくぼんだ台の上に浮かぶ" },
  8: { name: "くぼみの台 + 帯", mood: "パターン 7 の Box のまわりを、ロゴの青と金の帯がゆっくり回る" },
};

/** どのパターンにも当たらないとき(部品を 1 つずつ変えたあと)の呼び名 */
export const CUSTOM_PATTERN_LABEL = "組み合わせ";

/** 明暗(Visual の欄の 2 択) */
export const THEME_LABELS: Record<Theme, string> = { light: "明るい", dark: "暗い" };

/** World(設定の画面) */
export const WORLD_LABELS: Record<WorldId, string> = { plain: "無地" };
