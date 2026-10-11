// 立体のホーム(three)の公開の形。画面(src/app/(app)/_home/HomeStage.tsx)は、これだけを通して立体を動かす。
// ここには three・DOM の実装を入れない(型だけ)。立体の実装は index.ts(`await import("@/fourdb/ui/home3d")` で読む)。
import type { Look, WorldId } from "@/fourdb/core/prefs";

/**
 * 画面(React)が描いた要素。立体のモジュールが触ってよいのは次だけ:
 * 自分で作った `<canvas>`(canvasHost の中)・backdrop の SVG(数値だけで組み立てる)・札の `style.transform` と `--k`・
 * others の `style.top`・root の `data-label`。利用者の文字を innerHTML に入れない。
 */
export type StageElements = {
  root: HTMLElement;
  canvasHost: HTMLElement;
  backdrop: HTMLElement;
  /** 単位ごとの札(unitCount 個)。順番は単位の順 */
  labels: HTMLElement[];
  /** 「ほかの単位」の 1 行(なければ null) */
  others: HTMLElement | null;
};

/** onLabelMode の理由: "" = 指定どおり / "no-face" = 正面のない台座で「台の正面」を選んだ / "too-small" = 正面の文字が小さすぎる */
export type LabelModeReason = "" | "no-face" | "too-small";

export type StageCallbacks = {
  onPick(i: number): void;
  onHover(i: number): void;
  /** 札の置き方が、指定した形から変わった(または戻った)とき */
  onLabelMode(mode: Look["label"], reason: LabelModeReason): void;
  /** WebGL の文脈を失った → 平らなタイルへ */
  onLost(): void;
  /** 開いている右の欄と Visual の欄(立体が避ける四角) */
  occluders(): DOMRect[];
};

export interface Stage {
  setLook(l: Look): void;
  setSelected(i: number): void;
  setHot(i: number): void;
  setView(i: number): void;
  reframe(): void;
  /** 何度呼ばれても大丈夫 */
  dispose(): void;
}

/** 作れなければ throw する(呼ぶ側が平らなタイルに切り替える) */
export type MountStage = (els: StageElements, unitCount: number, look: Look, world: WorldId, cb: StageCallbacks) => Stage;

/** `await import("@/fourdb/ui/home3d")` で得られるモジュールの形 */
export type Home3dModule = {
  canUseWebGL(): boolean;
  mountStage: MountStage;
};
