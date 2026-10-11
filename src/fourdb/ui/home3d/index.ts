// 立体のホームのモジュール(three・DOM・WebGL)。画面(src/app/(app)/_home/HomeStage.tsx)が `await import("@/fourdb/ui/home3d")` で読む。
// three はホームでしか読まない(この入口を静的に import しないこと)。
//
// 使い方:
//   const m = await import("@/fourdb/ui/home3d");
//   if (!m.canUseWebGL()) → 平らなタイル
//   const stage = m.mountStage(els, unitCount, look, world, callbacks);  // 作れなければ throw → 平らなタイル
//   stage.setLook(look) / setSelected(i) / setHot(i) / setView(i) / reframe() / dispose()
// 決まり(DOM に触ってよい所・札の基準の点・--k)は stage.ts の先頭を見る。
import type { Home3dModule } from "./types";
import { canUseWebGL, mountStage } from "./stage";

export { canUseWebGL, mountStage };
export type { LabelModeReason, MountStage, Stage, StageCallbacks, StageElements, Home3dModule } from "./types";

// 入口の形が types.ts の Home3dModule と合っていることを、型で確かめる
const _check: Home3dModule = { canUseWebGL, mountStage };
void _check;
