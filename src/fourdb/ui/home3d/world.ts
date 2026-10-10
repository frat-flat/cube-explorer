// World(まわりの世界)のつなぎ目。P2 は「無地」(plain)だけで、何もしない(null)。
// P5 で世界を足すときは、ここで WorldId ごとに WorldHandle を作る(読み込みは非同期でよい。舞台は attach を待たずに無地で描き始める)。
import type { Scene } from "three";
import type { WorldId } from "@/fourdb/core/prefs";

/** 世界の中で見るときのカメラ(なければ無地と同じ) */
export type WorldView = { fovDeg?: number; elevation?: number };

export interface WorldHandle {
  readonly view: WorldView;
  /** 場面に世界を入れる(見た目を変えて場面を作り直すたびに呼ぶ) */
  attach(scene: Scene): void;
  detach(scene: Scene): void;
  dispose(): void;
}

export function createWorld(id: WorldId): WorldHandle | null {
  switch (id) {
    case "plain":
      return null;
  }
}
