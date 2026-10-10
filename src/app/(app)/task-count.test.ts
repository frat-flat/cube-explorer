// メニューの Task の件数: 読むタイミングの決まり(10 秒に 1 回まで・イベントはすぐ)・件数の読み方・印の文字。
import { describe, expect, it, vi } from "vitest";
import { badgeText, COUNT_MIN_GAP_MS, countFromEvent, parseCount, TASKS_CHANGED_EVENT, TaskCountWatcher } from "./task-count";

describe("parseCount / countFromEvent / badgeText", () => {
  it("{ count } の 0 以上の整数だけを件数とみなす", () => {
    expect(parseCount({ count: 0 })).toBe(0);
    expect(parseCount({ count: 12 })).toBe(12);
    for (const bad of [null, undefined, 3, "3", {}, { count: -1 }, { count: 1.5 }, { count: "2" }, { count: null }, { count: Number.NaN }, { count: Infinity }]) {
      expect(parseCount(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("イベントの detail.count。なければ null(読み直す)", () => {
    expect(TASKS_CHANGED_EVENT).toBe("fourdb:tasks-changed");
    expect(countFromEvent(new CustomEvent(TASKS_CHANGED_EVENT, { detail: { count: 4 } }))).toBe(4);
    expect(countFromEvent(new CustomEvent(TASKS_CHANGED_EVENT, { detail: { count: 0 } }))).toBe(0);
    expect(countFromEvent(new Event(TASKS_CHANGED_EVENT))).toBeNull();
    expect(countFromEvent(new CustomEvent(TASKS_CHANGED_EVENT, { detail: "x" }))).toBeNull();
  });

  it("印の文字: 99 まではそのまま、100 から 99+", () => {
    expect(badgeText(1)).toBe("1");
    expect(badgeText(99)).toBe("99");
    expect(badgeText(100)).toBe("99+");
  });
});

describe("TaskCountWatcher(いつ読むか)", () => {
  function setup(load: (signal: AbortSignal) => Promise<number | null> = async () => 3) {
    const clock = { t: 1_000_000 };
    const counts: number[] = [];
    const loads: AbortSignal[] = [];
    const watcher = new TaskCountWatcher({
      load: (signal) => {
        loads.push(signal);
        return load(signal);
      },
      onCount: (n) => counts.push(n),
      now: () => clock.t,
    });
    return { watcher, clock, counts, loads };
  }
  const settle = () => new Promise<void>((r) => setTimeout(r, 0));

  it("最初の request は読む。10 秒たつまでの request は読まない。たてばまた読む", async () => {
    const { watcher, clock, loads, counts } = setup();
    watcher.request();
    await settle();
    expect(loads).toHaveLength(1);
    expect(counts).toEqual([3]);
    clock.t += COUNT_MIN_GAP_MS - 1;
    watcher.request();
    expect(loads).toHaveLength(1);
    clock.t += 1;
    watcher.request();
    expect(loads).toHaveLength(2);
  });

  it("force(count なし): 10 秒の間隔に関係なく、すぐ読む", async () => {
    const { watcher, loads } = setup();
    watcher.request();
    watcher.force(null);
    watcher.force(null);
    expect(loads).toHaveLength(3);
    await settle();
  });

  it("force(count あり): 読まずに、その数を使う", () => {
    const { watcher, loads, counts } = setup();
    watcher.force(7);
    watcher.force(0);
    expect(loads).toHaveLength(0);
    expect(counts).toEqual([7, 0]);
  });

  it("force のあとの request は、間隔の中なら読まない", async () => {
    const { watcher, loads, clock } = setup();
    watcher.force(null);
    clock.t += 5_000;
    watcher.request();
    expect(loads).toHaveLength(1);
    await settle();
  });

  it("読み込みは同時に 1 つ: 新しく読み始めたら、前のものはやめ、前の答えは使わない", async () => {
    const answers: ((n: number) => void)[] = [];
    const { watcher, loads, counts } = setup(() => new Promise<number>((r) => answers.push(r)));
    watcher.force(null);
    watcher.force(null);
    expect(loads[0].aborted).toBe(true);
    expect(loads[1].aborted).toBe(false);
    answers[0](99);
    answers[1](2);
    await settle();
    expect(counts).toEqual([2]);
  });

  it("読めなかった(throw・null)ときは、前の件数のまま。落ちない", async () => {
    const failing = setup(async () => {
      throw new Error("offline");
    });
    failing.watcher.request();
    await settle();
    expect(failing.counts).toEqual([]);
    const nulls = setup(async () => null);
    nulls.watcher.request();
    await settle();
    expect(nulls.counts).toEqual([]);
  });

  it("stop: 読み込み中のものをやめ、答えは使わない。やめた読み込みは「読んだ」に数えない(すぐまた読める。StrictMode)", async () => {
    const answers: ((n: number) => void)[] = [];
    const { watcher, loads, counts } = setup(() => new Promise<number>((r) => answers.push(r)));
    watcher.request();
    watcher.stop();
    expect(loads[0].aborted).toBe(true);
    watcher.request();
    expect(loads).toHaveLength(2);
    answers[0](50);
    answers[1](5);
    await settle();
    expect(counts).toEqual([5]);
  });

  it("stop: 読み終えたあとなら、間隔はそのまま", async () => {
    const { watcher, loads } = setup();
    watcher.request();
    await settle();
    watcher.stop();
    watcher.request();
    expect(loads).toHaveLength(1);
  });

  it("onCount が呼ばれる前にやめたら、何も呼ばない", async () => {
    const onCount = vi.fn();
    const watcher = new TaskCountWatcher({ load: async () => 1, onCount });
    watcher.request();
    watcher.stop();
    await settle();
    expect(onCount).not.toHaveBeenCalled();
  });
});
