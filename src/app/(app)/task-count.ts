// メニューの Task の横に出す、やることの件数。メニューの中だけに出す(閉じた ☰ には出さない)。
// 読むのは DB があるとき(enabled)だけ。読み込みは画面の描きをじゃましない(読めるまで 0 =印なし。読めなかったら、前の件数のまま)。
// いつ読むか: 出たとき・道筋が変わったとき(10 秒に 1 回まで)・見えるようになったとき(10 秒に 1 回まで)・
// window の `fourdb:tasks-changed` を受けたとき(すぐ。detail.count があれば、読まずにその数を使う)。
import { useEffect, useState } from "react";

export const TASKS_CHANGED_EVENT = "fourdb:tasks-changed";
/** 出たとき・道筋が変わったとき・見えるようになったときの、読み込みの間隔の下限(ミリ秒) */
export const COUNT_MIN_GAP_MS = 10_000;
const COUNT_URL = "/api/4db/tasks/count";

/** { count } の形から件数を取り出す(0 以上の整数でなければ null) */
export function parseCount(j: unknown): number | null {
  if (typeof j !== "object" || j === null) return null;
  const n = (j as { count?: unknown }).count;
  return typeof n === "number" && Number.isInteger(n) && n >= 0 ? n : null;
}

/** `fourdb:tasks-changed` に件数(detail.count)が付いていればその数、なければ null(読み直す) */
export function countFromEvent(e: Event): number | null {
  return parseCount((e as CustomEvent<unknown>).detail);
}

/** 印に出す文字。多いときは 99+ */
export function badgeText(count: number): string {
  return count > 99 ? "99+" : String(count);
}

export async function loadTaskCount(signal: AbortSignal): Promise<number | null> {
  const res = await fetch(COUNT_URL, { credentials: "same-origin", signal });
  if (!res.ok) return null;
  return parseCount(await res.json());
}

export type WatcherDeps = {
  load(signal: AbortSignal): Promise<number | null>;
  onCount(n: number): void;
  now?: () => number;
  minGapMs?: number;
};

/** 件数を読むタイミングの決まり。最後に読み始めてから minGapMs たつまで、request() は読まない。force() はいつでもすぐ読む。読み込みは同時に 1 つ(新しい方が勝つ) */
export class TaskCountWatcher {
  private readonly deps: WatcherDeps;
  private last = -Infinity;
  private ctrl: AbortController | null = null;

  constructor(deps: WatcherDeps) {
    this.deps = deps;
  }

  /** 出たとき・道筋が変わったとき・見えるようになったとき */
  request = (): void => {
    const now = (this.deps.now ?? Date.now)();
    if (now - this.last < (this.deps.minGapMs ?? COUNT_MIN_GAP_MS)) return;
    this.last = now;
    this.fetchNow();
  };

  /** window の `fourdb:tasks-changed`。count があればそれを使い、なければすぐ読む */
  force = (count: number | null): void => {
    if (count !== null) {
      this.deps.onCount(count);
      return;
    }
    this.last = (this.deps.now ?? Date.now)();
    this.fetchNow();
  };

  /** 読み込み中のものをやめる(やめた読み込みは「読んだ」に数えない。開発の StrictMode の始める・やめる・始めるでも読み込みが落ちない) */
  stop = (): void => {
    if (this.ctrl) {
      this.ctrl.abort();
      this.ctrl = null;
      this.last = -Infinity;
    }
  };

  private fetchNow(): void {
    this.ctrl?.abort();
    const ctrl = new AbortController();
    this.ctrl = ctrl;
    this.deps
      .load(ctrl.signal)
      .then((n) => {
        if (!ctrl.signal.aborted && n !== null) this.deps.onCount(n);
      })
      .catch(() => {
        // 読めなかったら、前の件数のまま(画面にエラーは出さない)
      })
      .finally(() => {
        if (this.ctrl === ctrl) this.ctrl = null;
      });
  }
}

/** メニューの Task の件数。enabled が false(DB がない)なら読まず、いつも 0 */
export function useTaskCount(enabled: boolean, pathname: string): number {
  const [count, setCount] = useState(0);
  const [watcher] = useState(() => new TaskCountWatcher({ load: loadTaskCount, onCount: setCount }));
  useEffect(() => {
    if (!enabled) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") watcher.request();
    };
    const onChanged = (e: Event) => watcher.force(countFromEvent(e));
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(TASKS_CHANGED_EVENT, onChanged);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(TASKS_CHANGED_EVENT, onChanged);
      watcher.stop();
    };
  }, [enabled, watcher]);
  // 出たとき(最初の描き)と、道筋が変わったとき
  useEffect(() => {
    if (enabled) watcher.request();
  }, [enabled, pathname, watcher]);
  return enabled ? count : 0;
}
