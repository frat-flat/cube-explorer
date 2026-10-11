// ホーム(/)の画面に出す文字と、表示の決まり(React に依存しない。試験は view.test.ts)。
// 文言を決めるのはオーナー(D-015)。ここは作業指示 P2b の 11 章(設計の担当の付録 A)と試作の文の案。
import { LOOK_VALUE_LABELS, patternOf, PATTERN_LABELS, CUSTOM_PATTERN_LABEL, type Look } from "@/fourdb/core/prefs";
import type { LabelModeReason } from "@/fourdb/ui/home3d/types";
import type { SaveState } from "../prefs-sync";

/** 数の表し方(3 桁ごとの区切り) */
export const fmt = (n: number): string => n.toLocaleString("ja-JP");

/** 舞台の見出し(左上) */
export const STAGE_TITLE = "Box";
export const STAGE_SUB = "いちばん上の Box を単位ごとに";

/** 札の並びの読み上げの名前 */
export const LABELS_ARIA = "単位ごとの Box";

/** 「ほかの単位」の行の頭 */
export const OTHERS_PREFIX = "ほかの単位: ";

/** 一覧の残りの数の頭(「ほか 43」) */
export const MORE_PREFIX = "ほか";

/** 元のシートの欄の、最後に取り込んだ日の頭 */
export const LAST_READ_PREFIX = "最後に取り込んだ日";

/** 右の欄の終わりの説明(【P8】【P11】の札のあとに続く文) */
export const PHASE_NOTE = "は、その段階で使えるようになります。";

/** 3D を作れなかったときの、平らな一覧の説明 */
export const FLAT_NOTE = "3D を表示できなかったため、平らな一覧で表示しています。";

/** Box が 1 つもないとき */
export const EMPTY_TITLE = "まだ Box がありません";
export const EMPTY_TEXT = "ファイルを取り込み、行が表す実体を選んで反映すると、ここに Box が並びます。";
export const EMPTY_ACTION = "Import でファイルを取り込む";

/** Visual(見た目の欄)のボタンと見出し */
export const VISUAL_TITLE = "Visual";
export const VISUAL_BUTTON_NOTE = "見た目を変える";
export const VISUAL_SUB = "見た目";
export const THEME_GROUP_LABEL = "明暗";
export const PATTERN_GROUP_LABEL = "パターン";
export const RETRY_LABEL = "もう一度試す";
export const CLOSE_LABEL = "閉じる";

/** いまの見た目の呼び名。パターンに当たれば「パターン 3「ロゴの宇宙」」、当たらなければ「組み合わせ」 */
export function currentPatternText(look: Look): string {
  const p = patternOf(look);
  return p ? `パターン ${p.id}「${PATTERN_LABELS[p.id].name}」` : CUSTOM_PATTERN_LABEL;
}

/** 保存の状態の文(idle は出さない) */
export function saveMessage(state: SaveState): string {
  switch (state) {
    case "saving":
      return "保存しています…";
    case "saved":
      return "アカウントに保存しました";
    case "error":
      return "保存できませんでした。もう一度試してください";
    case "local":
      return "いまはこのパソコンにだけ覚えます(アカウントへの保存は準備中です)";
    default:
      return "";
  }
}

/** 札を指定と違う置き方にしたときの説明(指定どおりなら空) */
export function labelNoteText(reason: LabelModeReason, base: Look["base"]): string {
  if (reason === "no-face") return `${LOOK_VALUE_LABELS.base[base]}には正面がないため、札は台の下に出しています`;
  if (reason === "too-small") return "正面の文字が小さすぎるため、札は台の下に出しています";
  return "";
}

/** 文字を、数字の部分とそれ以外に分ける(数字は Montserrat で出すため)。例「A社 2026年度」→ ["A社 ", "2026", "年度"] の数字は n: true */
export function splitNumbers(text: string): { text: string; n: boolean }[] {
  const out: { text: string; n: boolean }[] = [];
  const re = /\d[\d,]*(?:-\d+)*/g;
  let at = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > at) out.push({ text: text.slice(at, m.index), n: false });
    out.push({ text: m[0], n: true });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at), n: false });
  return out;
}

/** Table の欄のリンク先(保存した表を開いた状態の /table) */
export const tableHref = (id: string): string => `/table?def=${encodeURIComponent(id)}`;
