// アカウントに覚える設定の、画面側の覚え方と送り方(prefs-sync.ts)。通信・保存・クッキーは作り物を渡して、
// 突き合わせの決まり・まとめて送る・同時に 1 つ・失敗して残す・保存できないときを確かめる。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LOOK, DEFAULT_PATTERN_ID, defaultPrefs, PATTERNS, type Look, type PrefsPatch, type Theme } from "@/fourdb/core/prefs";
import {
  applyPatch,
  isEmptyPatch,
  LOOK_DEBOUNCE_MS,
  mergePatch,
  parseStoredPending,
  PrefsStore,
  reconcile,
  sameLook,
  subtractSent,
  type PutOutcome,
  type ServerPrefs,
  type StoreDeps,
  type StoreOptions,
} from "./prefs-sync";

// 「変えた見た目」に使う i 番目のパターン。既定のパターンは除く(既定と同じ見た目は、変えたことにならないので)
const CHANGED = PATTERNS.filter((p) => p.id !== DEFAULT_PATTERN_ID);
const lookOf = (i: number): Look => ({ ...CHANGED[i].look });
const server = (over: Partial<ServerPrefs> & { theme?: Theme | null } = {}): ServerPrefs => {
  const { theme, ...rest } = over;
  const prefs = defaultPrefs();
  if (theme !== undefined) prefs.theme = theme;
  return { available: true, saved: true, prefs, ...rest };
};

describe("変更(PrefsPatch)の扱い", () => {
  it("isEmptyPatch: 欄が 1 つもなければ空。theme: null は空ではない", () => {
    expect(isEmptyPatch({})).toBe(true);
    expect(isEmptyPatch({ theme: null })).toBe(false);
    expect(isEmptyPatch({ theme: "dark" })).toBe(false);
    expect(isEmptyPatch({ world: "plain" })).toBe(false);
    expect(isEmptyPatch({ look: lookOf(0) })).toBe(false);
  });

  it("mergePatch: 後の欄が勝つ。元を書き換えず、look は写しを持つ", () => {
    const a: PrefsPatch = { theme: "dark", look: lookOf(0) };
    const b: PrefsPatch = { theme: null, world: "plain" };
    const m = mergePatch(a, b);
    expect(m).toEqual({ theme: null, world: "plain", look: lookOf(0) });
    expect(a).toEqual({ theme: "dark", look: lookOf(0) });
    expect(m.look).not.toBe(a.look);
    expect(mergePatch({ theme: "light" }, { theme: undefined })).toEqual({ theme: "light" });
  });

  it("applyPatch: 重ねた欄だけ変わる。look は写し", () => {
    const base = defaultPrefs();
    const out = applyPatch(base, { theme: "light", look: lookOf(1) });
    expect(out).toEqual({ theme: "light", world: "plain", look: lookOf(1) });
    expect(base).toEqual(defaultPrefs());
    expect(applyPatch(base, {}).look).not.toBe(base.look);
  });

  it("subtractSent: 送れた分を外す。送っている間に変わった欄は残る", () => {
    const pending: PrefsPatch = { theme: "light", look: lookOf(2), world: "plain" };
    expect(subtractSent(pending, { theme: "light", look: lookOf(2), world: "plain" })).toEqual({});
    expect(subtractSent(pending, { theme: "dark", look: lookOf(2) })).toEqual({ theme: "light", world: "plain" });
    expect(subtractSent(pending, { look: lookOf(3) })).toEqual(pending);
    expect(subtractSent({ theme: null }, { theme: null })).toEqual({});
  });

  it("sameLook: 6 つの部品がすべて同じか", () => {
    expect(sameLook(lookOf(0), lookOf(0))).toBe(true);
    expect(sameLook(lookOf(0), lookOf(1))).toBe(false);
    expect(sameLook({ ...lookOf(0), layout: "arc" }, lookOf(0))).toBe(false);
  });

  it("parseStoredPending: 正しい形だけ読む。壊れた文字・知らない欄・空・__proto__ は {}", () => {
    expect(parseStoredPending(JSON.stringify({ theme: "dark", look: lookOf(0) }))).toEqual({ theme: "dark", look: lookOf(0) });
    expect(parseStoredPending(JSON.stringify({ theme: null }))).toEqual({ theme: null });
    for (const bad of [null, undefined, "", "not json", "[]", "null", "{}", '{"theme":"blue"}', '{"x":1}', '{"look":{"shape":"glass"}}', '{"__proto__":{"theme":"dark"}}', '{"world":"nowhere"}']) {
      expect(parseStoredPending(bad as string | null | undefined), String(bad)).toEqual({});
    }
  });
});

describe("reconcile(タブの読み込みごとの最初の突き合わせ)", () => {
  it("アカウントに保存がなく、クッキーが暗い: 暗いを使い、アカウントへ移す(送る)", () => {
    const plan = reconcile(server({ saved: false }), "dark", {});
    expect(plan.prefs.theme).toBe("dark");
    expect(plan.send).toEqual({ theme: "dark" });
  });

  it("アカウントに保存がなく、クッキーもなし(合わせる): 送るものはない", () => {
    const plan = reconcile(server({ saved: false }), null, {});
    expect(plan.prefs.theme).toBeNull();
    expect(plan.send).toEqual({});
  });

  it("アカウントの表が使えない: クッキーの明暗を使うが、移すために送ることはしない", () => {
    const plan = reconcile(server({ saved: false, available: false }), "light", {});
    expect(plan.prefs.theme).toBe("light");
    expect(plan.send).toEqual({});
  });

  it("保存してあれば、明暗はアカウントの値(クッキーと違っても。「合わせる」も)。送るものはない", () => {
    expect(reconcile(server({ theme: "light" }), "dark", {})).toEqual({ prefs: { ...defaultPrefs(), theme: "light" }, send: {} });
    expect(reconcile(server({ theme: null }), "dark", {}).prefs.theme).toBeNull();
    expect(reconcile(server({ theme: "dark" }), "dark", {}).send).toEqual({});
  });

  it("この端末の送っていない変更が勝つ(アカウントの値より、クッキーより)。先に送る", () => {
    const plan = reconcile(server({ theme: "light" }), "light", { theme: "dark", look: lookOf(3) });
    expect(plan.prefs.theme).toBe("dark");
    expect(plan.prefs.look).toEqual(lookOf(3));
    expect(plan.send).toEqual({ theme: "dark", look: lookOf(3) });
  });

  it("送っていない変更が「合わせる」(theme: null)でも、クッキーを移さずにそれを送る", () => {
    const plan = reconcile(server({ saved: false }), "dark", { theme: null });
    expect(plan.prefs.theme).toBeNull();
    expect(plan.send).toEqual({ theme: null });
  });

  it("保存がなく、送っていない変更が見た目だけ: 見た目と、クッキーの明暗を一緒に送る", () => {
    const plan = reconcile(server({ saved: false }), "light", { look: lookOf(1) });
    expect(plan.send).toEqual({ look: lookOf(1), theme: "light" });
  });

  it("GET が読めなかった(null): クッキーの明暗と、この端末の変更で出す。送るのは端末の変更だけ", () => {
    expect(reconcile(null, "dark", {})).toEqual({ prefs: { ...defaultPrefs(), theme: "dark" }, send: {} });
    expect(reconcile(null, null, { world: "plain" }).send).toEqual({ world: "plain" });
  });

  it("引数を書き換えない", () => {
    const pending: PrefsPatch = { look: lookOf(1) };
    const s = server({ saved: false });
    reconcile(s, "dark", pending);
    expect(pending).toEqual({ look: lookOf(1) });
    expect(s.prefs).toEqual(defaultPrefs());
  });
});

// ---------- PrefsStore ----------

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}

/** 流れを見るための作り物。put は、既定ではすぐ ok。outcomes に積むと、その結果を順に返す */
function harness(opts: Partial<StoreOptions> = {}, over: Partial<StoreDeps> = {}, init: { server?: ServerPrefs | Error; stored?: PrefsPatch; cookie?: Theme | null } = {}) {
  const puts: { patch: PrefsPatch; keepalive: boolean }[] = [];
  const applied: (Theme | null)[] = [];
  const writes: (PrefsPatch | null)[] = [];
  const state = { stored: init.stored ?? {}, cookie: init.cookie ?? null, loads: 0 };
  const outcomes: (PutOutcome | Deferred<PutOutcome> | Error)[] = [];
  const deps: StoreDeps = {
    load: async () => {
      state.loads += 1;
      const s = init.server ?? server();
      if (s instanceof Error) throw s;
      return s;
    },
    put: async (patch, keepalive) => {
      puts.push({ patch, keepalive });
      const o = outcomes.shift() ?? "ok";
      if (o instanceof Error) throw o;
      return typeof o === "string" ? o : o.promise;
    },
    readStored: () => state.stored,
    writeStored: (p) => {
      writes.push(p);
      state.stored = p ?? {};
    },
    readCookieTheme: () => state.cookie,
    applyTheme: (t) => {
      state.cookie = t;
      applied.push(t);
    },
    ...over,
  };
  const store = new PrefsStore(deps, { enabled: true, initialTheme: init.cookie ?? null, ...opts });
  return { store, puts, applied, writes, state, outcomes, snap: () => store.getSnapshot() };
}

const tick = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("PrefsStore: 最初の状態", () => {
  it("DB があれば: クッキーの明暗・既定の見た目と World・保存できる・idle・まだ読み込んでいない。サーバーの描きと同じ", () => {
    const { store } = harness({ initialTheme: "dark" });
    expect(store.getSnapshot()).toEqual({ theme: "dark", look: DEFAULT_LOOK, world: "plain", available: true, saveState: "idle", loaded: false });
    expect(store.getServerSnapshot()).toBe(store.getSnapshot());
    expect(store.getSnapshot().look).not.toBe(DEFAULT_LOOK);
  });

  it("DB がなければ: 保存できない・local", () => {
    const { store } = harness({ enabled: false });
    expect(store.getSnapshot()).toMatchObject({ available: false, saveState: "local", loaded: false });
  });
});

describe("PrefsStore.start(タブの読み込みごとの突き合わせ)", () => {
  it("保存があり、クッキーと同じ: 送らない。loaded になり idle のまま", async () => {
    const h = harness({}, {}, { server: server({ theme: "dark" }), cookie: "dark" });
    h.store.start();
    await tick();
    expect(h.puts).toEqual([]);
    expect(h.applied).toEqual(["dark"]); // クッキーと同じでも、<html data-theme> を合わせるために書く(同じ値を書いても何も変わらない)
    expect(h.snap()).toMatchObject({ loaded: true, theme: "dark", saveState: "idle", available: true });
  });

  it("クッキーは突き合わせた明暗と同じでも、<html data-theme> が違えば(古い印)、印とクッキーを突き合わせた明暗に合わせる", async () => {
    // 最初の画面の印が古い(別のタブがクッキーを変えた・古いクッキーで描かれた): クッキーは dark で合っているが、印は light のまま
    const dom: { cookie: Theme | null; attr: Theme | null } = { cookie: "dark", attr: "light" };
    const h = harness(
      {},
      {
        readCookieTheme: () => dom.cookie,
        applyTheme: (t) => {
          dom.cookie = t;
          dom.attr = t;
        },
      },
      { server: server({ theme: "dark" }), cookie: "dark" },
    );
    h.store.start();
    await tick();
    expect(dom).toEqual({ cookie: "dark", attr: "dark" });
    expect(h.puts).toEqual([]); // 合わせるだけで、送らない
    expect(h.snap().theme).toBe("dark");
  });

  it("突き合わせた明暗が「合わせる」(null)で、クッキーも印も古い値のときは、両方を消す。GET が読めなかったときも、クッキーの明暗を印に合わせる", async () => {
    const dom: { cookie: Theme | null; attr: Theme | null } = { cookie: "dark", attr: "dark" };
    const deps = {
      readCookieTheme: () => dom.cookie,
      applyTheme: (t: Theme | null) => {
        dom.cookie = t;
        dom.attr = t;
      },
    };
    const a = harness({}, deps, { server: server({ theme: null }), cookie: "dark" });
    a.store.start();
    await tick();
    expect(dom).toEqual({ cookie: null, attr: null });
    // GET が読めなかった: クッキーの明暗(light)を印にも書く(印は dark のまま残さない)
    dom.cookie = "light";
    dom.attr = "dark";
    const b = harness({}, deps, { server: new Error("network"), cookie: "light" });
    b.store.start();
    await tick();
    expect(dom).toEqual({ cookie: "light", attr: "light" });
  });

  it("DB がない(enabled = false)でも、クッキーの明暗を印に合わせる", async () => {
    const dom: { cookie: Theme | null; attr: Theme | null } = { cookie: "light", attr: "dark" };
    const h = harness(
      { enabled: false },
      {
        readCookieTheme: () => dom.cookie,
        applyTheme: (t) => {
          dom.cookie = t;
          dom.attr = t;
        },
      },
    );
    h.store.start();
    await tick();
    expect(dom).toEqual({ cookie: "light", attr: "light" });
    expect(h.state.loads).toBe(0);
  });

  it("保存があり、クッキーと違う: クッキーと印をアカウントに合わせる(送らない)", async () => {
    const h = harness({}, {}, { server: server({ theme: "light" }), cookie: "dark" });
    h.store.start();
    await tick();
    expect(h.applied).toEqual(["light"]);
    expect(h.state.cookie).toBe("light");
    expect(h.puts).toEqual([]);
    expect(h.snap().theme).toBe("light");
  });

  it("保存があり「合わせる」(null): クッキーを消す", async () => {
    const h = harness({}, {}, { server: server({ theme: null }), cookie: "dark" });
    h.store.start();
    await tick();
    expect(h.applied).toEqual([null]);
    expect(h.snap().theme).toBeNull();
  });

  it("見た目と World は、アカウントの値が画面に出る", async () => {
    const s = server();
    s.prefs.look = lookOf(2);
    const h = harness({}, {}, { server: s });
    h.store.start();
    await tick();
    expect(h.snap().look).toEqual(lookOf(2));
  });

  it("アカウントに保存がなく、クッキーが暗い: クッキーの明暗を PUT して移す。送れたら saved", async () => {
    const h = harness({}, {}, { server: server({ saved: false }), cookie: "dark" });
    h.store.start();
    await tick();
    expect(h.puts).toEqual([{ patch: { theme: "dark" }, keepalive: false }]);
    expect(h.snap()).toMatchObject({ theme: "dark", saveState: "saved" });
  });

  it("アカウントに保存がなく、クッキーもなし: 何も送らない", async () => {
    const h = harness({}, {}, { server: server({ saved: false }), cookie: null });
    h.store.start();
    await tick();
    expect(h.puts).toEqual([]);
  });

  it("localStorage に送っていない変更があれば、先に PUT する(この端末が勝つ)。アカウントの値は上書きされ、画面は端末の値", async () => {
    const h = harness({}, {}, { server: server({ theme: "light" }), cookie: "light", stored: { theme: "dark", look: lookOf(4) } });
    h.store.start();
    expect(h.snap().loaded).toBe(false);
    await tick();
    expect(h.puts).toEqual([{ patch: { theme: "dark", look: lookOf(4) }, keepalive: false }]);
    expect(h.snap()).toMatchObject({ theme: "dark", look: lookOf(4), saveState: "saved" });
    expect(h.applied).toEqual(["dark"]); // クッキーも端末の値に
    expect(h.state.stored).toEqual({}); // 送れたので、残さない
  });

  it("送っている途中(送れるまで)は、localStorage の送っていない変更を消さない", async () => {
    const d = deferred<PutOutcome>();
    const h = harness({}, {}, { stored: { look: lookOf(1) } });
    h.outcomes.push(d);
    h.store.start();
    await tick();
    expect(h.puts).toHaveLength(1);
    expect(h.writes).toEqual([]);
    expect(h.snap().saveState).toBe("saving");
    d.resolve("ok");
    await tick();
    expect(h.writes).toEqual([null]);
    expect(h.snap().saveState).toBe("saved");
  });

  it("壊れた localStorage の値は読まれない({})。落ちない", async () => {
    const h = harness({}, { readStored: () => parseStoredPending("{broken") }, { server: server({ theme: "dark" }), cookie: "dark" });
    h.store.start();
    await tick();
    expect(h.puts).toEqual([]);
    expect(h.snap().loaded).toBe(true);
  });

  it("GET が読めなかったとき: 落ちずに loaded になり、クッキーの明暗で出す。送っていない変更は送ってみる", async () => {
    const h = harness({}, {}, { server: new Error("network"), cookie: "dark", stored: { world: "plain" } });
    h.store.start();
    await tick();
    expect(h.snap()).toMatchObject({ loaded: true, theme: "dark", available: true });
    expect(h.puts).toEqual([{ patch: { world: "plain" }, keepalive: false }]);
  });

  it("GET の途中で変えた分は、アカウントの値より勝つ", async () => {
    const d = deferred<ServerPrefs>();
    const h = harness({}, { load: () => d.promise }, { cookie: null });
    h.store.start();
    h.store.setTheme("dark");
    h.store.setLook(lookOf(5));
    expect(h.puts).toEqual([]); // 突き合わせが終わるまで送らない
    expect(h.snap().saveState).toBe("saving");
    const s = server({ theme: "light" });
    s.prefs.look = lookOf(2);
    d.resolve(s);
    await tick();
    expect(h.puts).toEqual([{ patch: { theme: "dark", look: lookOf(5) }, keepalive: false }]);
    expect(h.snap()).toMatchObject({ theme: "dark", look: lookOf(5) });
    expect(h.state.cookie).toBe("dark");
  });

  it("始める・やめる・始める(開発の StrictMode)でも、読み込み 2 回・送るのは 1 回", async () => {
    const h = harness({}, {}, { server: server({ saved: false }), cookie: "dark" });
    const stop = h.store.start();
    stop();
    h.store.start();
    await tick();
    expect(h.state.loads).toBe(2);
    expect(h.puts).toHaveLength(1);
    expect(h.snap().loaded).toBe(true);
  });
});

describe("PrefsStore: 変えたとき", () => {
  async function started(opts: Partial<StoreOptions> = {}, init: Parameters<typeof harness>[2] = {}) {
    const h = harness(opts, {}, init);
    h.store.start();
    await tick();
    h.applied.length = 0; // 起動の突き合わせで書いた分(いつも書く)は数えない。以降は、変えたときに書いた分だけを見る
    return h;
  }

  it("明暗: すぐクッキーと印を変え、すぐ PUT する", async () => {
    const h = await started();
    h.store.setTheme("dark");
    expect(h.applied).toEqual(["dark"]);
    expect(h.snap().theme).toBe("dark");
    expect(h.puts).toEqual([{ patch: { theme: "dark" }, keepalive: false }]);
    await tick();
    expect(h.snap().saveState).toBe("saved");
  });

  it("「合わせる」(null): クッキーと印を消し、theme: null を送る", async () => {
    const h = await started({}, { server: server({ theme: "dark" }), cookie: "dark" });
    h.store.setTheme(null);
    expect(h.applied).toEqual([null]);
    expect(h.puts).toEqual([{ patch: { theme: null }, keepalive: false }]);
  });

  it("World: 同じ値(無地)・選べない値は送らない(P2 の World は無地だけ)", async () => {
    const h = await started();
    h.store.setWorld("plain");
    expect(h.puts).toEqual([]);
    h.store.setWorld("nowhere" as never);
    expect(h.puts).toEqual([]);
    expect(h.snap().world).toBe("plain");
  });

  it("World: 読み込み前に選んだ値は、突き合わせのあとも勝って送る(読み込み前は同じ値でも取りこぼさない)", async () => {
    const h = harness();
    h.store.start();
    h.store.setWorld("plain");
    await tick();
    expect(h.puts).toEqual([{ patch: { world: "plain" }, keepalive: false }]);
  });

  it("見た目: 画面にはすぐ出し、PUT は 800ms まとめる。5 回変えても 1 回(最新だけ)", async () => {
    const h = await started();
    for (let i = 1; i <= 5; i++) {
      h.store.setLook(lookOf(i));
      expect(h.snap().look).toEqual(lookOf(i));
      await vi.advanceTimersByTimeAsync(LOOK_DEBOUNCE_MS - 1);
      expect(h.puts).toEqual([]);
    }
    expect(h.snap().saveState).toBe("saving");
    await vi.advanceTimersByTimeAsync(1);
    expect(h.puts).toEqual([{ patch: { look: lookOf(5) }, keepalive: false }]);
    expect(h.snap().saveState).toBe("saved");
  });

  it("見た目を待っている間に明暗を変えると、見た目も一緒にすぐ送り、待ちは消える", async () => {
    const h = await started();
    h.store.setLook(lookOf(1));
    h.store.setTheme("light");
    expect(h.puts).toEqual([{ patch: { look: lookOf(1), theme: "light" }, keepalive: false }]);
    await vi.advanceTimersByTimeAsync(LOOK_DEBOUNCE_MS * 2);
    expect(h.puts).toHaveLength(1);
  });

  it("見た目が同じ(読み込み後)・選べない値は、何もしない", async () => {
    const h = await started();
    h.store.setLook({ ...DEFAULT_LOOK });
    h.store.setLook({ ...DEFAULT_LOOK, shape: "nope" } as unknown as Look);
    h.store.setTheme("blue" as never);
    await vi.advanceTimersByTimeAsync(LOOK_DEBOUNCE_MS * 2);
    expect(h.puts).toEqual([]);
    expect(h.snap().saveState).toBe("idle");
  });

  it("要求は同時に 1 つ。飛んでいる間に何度変えても、終わったら最新を 1 回送る", async () => {
    const h = await started();
    const first = deferred<PutOutcome>();
    h.outcomes.push(first);
    h.store.setTheme("dark");
    expect(h.puts).toHaveLength(1);
    h.store.setTheme("light");
    h.store.setTheme(null);
    h.store.setTheme("light");
    expect(h.puts).toHaveLength(1);
    expect(h.snap().saveState).toBe("saving");
    first.resolve("ok");
    await tick();
    expect(h.puts).toHaveLength(2);
    expect(h.puts[1]).toEqual({ patch: { theme: "light" }, keepalive: false });
    expect(h.snap().saveState).toBe("saved");
  });

  it("飛んでいる間に、送った値と同じ値へ変えなおしたら、送り直さない", async () => {
    const h = await started();
    const first = deferred<PutOutcome>();
    h.outcomes.push(first);
    h.store.setTheme("dark");
    h.store.setTheme("light");
    h.store.setTheme("dark");
    first.resolve("ok");
    await tick();
    expect(h.puts).toHaveLength(1);
  });

  it("飛んでいる間に見た目を変えたら、終わったあと 800ms まとめてから送る", async () => {
    const h = await started();
    const first = deferred<PutOutcome>();
    h.outcomes.push(first);
    h.store.setTheme("dark");
    h.store.setLook(lookOf(2));
    first.resolve("ok");
    await tick();
    expect(h.puts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(LOOK_DEBOUNCE_MS);
    expect(h.puts).toEqual([
      { patch: { theme: "dark" }, keepalive: false },
      { patch: { look: lookOf(2) }, keepalive: false },
    ]);
  });
});

describe("PrefsStore: 送れなかったとき", () => {
  it("失敗: error にし、送っていない分を localStorage に残す。見た目は戻さない", async () => {
    const h = harness();
    h.store.start();
    await tick();
    h.outcomes.push("error");
    h.store.setTheme("dark");
    await tick();
    expect(h.snap()).toMatchObject({ saveState: "error", theme: "dark" });
    expect(h.state.stored).toEqual({ theme: "dark" });
    expect(h.state.cookie).toBe("dark");
  });

  it("通信そのものの失敗(put が throw)も error。自動では送り直さない", async () => {
    const h = harness();
    h.store.start();
    await tick();
    h.outcomes.push(new Error("offline"));
    h.store.setTheme("light");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.puts).toHaveLength(1);
    expect(h.snap().saveState).toBe("error");
  });

  it("retry: 残っている分を送り直す。送れたら saved で、localStorage から消える", async () => {
    const h = harness();
    h.store.start();
    await tick();
    h.outcomes.push("error");
    h.store.setLook(lookOf(3));
    await vi.advanceTimersByTimeAsync(LOOK_DEBOUNCE_MS);
    expect(h.snap().saveState).toBe("error");
    expect(h.state.stored).toEqual({ look: lookOf(3) });
    h.store.retry();
    expect(h.snap().saveState).toBe("saving");
    await tick();
    expect(h.puts[1]).toEqual({ patch: { look: lookOf(3) }, keepalive: false });
    expect(h.snap().saveState).toBe("saved");
    expect(h.state.stored).toEqual({});
  });

  it("失敗したあとの次の変更は、失敗して残っている分も一緒に送る", async () => {
    const h = harness();
    h.store.start();
    await tick();
    h.outcomes.push("error");
    h.store.setLook(lookOf(1));
    await vi.advanceTimersByTimeAsync(LOOK_DEBOUNCE_MS);
    h.store.setTheme("dark");
    await tick();
    expect(h.puts[1].patch).toEqual({ look: lookOf(1), theme: "dark" });
    expect(h.snap().saveState).toBe("saved");
    expect(h.state.stored).toEqual({});
  });

  it("失敗の状態で変えたら、一緒に localStorage へ残す(閉じても消えない)", async () => {
    const h = harness();
    h.store.start();
    await tick();
    h.outcomes.push("error");
    h.store.setTheme("dark");
    await tick();
    h.store.setLook(lookOf(2));
    expect(h.state.stored).toEqual({ theme: "dark", look: lookOf(2) });
  });

  it("表がまだ使えない(503 prefs_unavailable): 保存できないに切り替え、local。残して、もう送らない", async () => {
    const h = harness();
    h.store.start();
    await tick();
    h.outcomes.push("unavailable");
    h.store.setTheme("dark");
    await tick();
    expect(h.snap()).toMatchObject({ available: false, saveState: "local", theme: "dark" });
    expect(h.state.stored).toEqual({ theme: "dark" });
    h.store.setTheme("light");
    h.store.retry();
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.puts).toHaveLength(1);
  });
});

describe("PrefsStore: 隠れたとき・ページを離れるとき", () => {
  it("まとめ待ちの見た目を、keepalive ですぐ送る。待ちの時間が来ても二重には送らない", async () => {
    const h = harness();
    h.store.start();
    await tick();
    h.store.setLook(lookOf(4));
    h.store.flush(true);
    expect(h.puts).toEqual([{ patch: { look: lookOf(4) }, keepalive: true }]);
    await vi.advanceTimersByTimeAsync(LOOK_DEBOUNCE_MS * 2);
    expect(h.puts).toHaveLength(1);
  });

  it("送っていない分がなければ送らない", async () => {
    const h = harness();
    h.store.start();
    await tick();
    h.store.flush(true);
    expect(h.puts).toEqual([]);
    h.store.setTheme("dark");
    await tick();
    h.store.flush(true);
    expect(h.puts).toHaveLength(1);
  });

  it("失敗して残っている分は、離れるときにもう一度 keepalive で試す", async () => {
    const h = harness();
    h.store.start();
    await tick();
    h.outcomes.push("error");
    h.store.setTheme("dark");
    await tick();
    h.store.flush(true);
    expect(h.puts[1]).toEqual({ patch: { theme: "dark" }, keepalive: true });
  });

  it("突き合わせの前や、保存できないときは何も送らない", async () => {
    const h = harness({ enabled: false });
    h.store.start();
    await tick();
    h.store.setLook(lookOf(1));
    h.store.flush(true);
    const before = harness();
    before.store.setLook(lookOf(1));
    before.store.flush(true);
    expect(h.puts).toEqual([]);
    expect(before.puts).toEqual([]);
  });

  it("start の返す関数(やめる)で、送っていない分を送る", async () => {
    const h = harness();
    const stop = h.store.start();
    await tick();
    h.store.setLook(lookOf(5));
    stop();
    expect(h.puts).toEqual([{ patch: { look: lookOf(5) }, keepalive: true }]);
  });
});

describe("PrefsStore: アカウントへ保存できないとき(DB がない・表がまだない)", () => {
  it("DB がない(enabled = false): 読み込みも送りもしない。クッキーと画面だけ変わり、見た目は localStorage に残す", async () => {
    const h = harness({ enabled: false });
    h.store.start();
    await tick();
    expect(h.state.loads).toBe(0);
    expect(h.snap()).toMatchObject({ loaded: true, available: false, saveState: "local" });
    h.applied.length = 0; // 起動の突き合わせで書いた分は数えない
    h.store.setTheme("dark");
    h.store.setLook(lookOf(2));
    await vi.advanceTimersByTimeAsync(LOOK_DEBOUNCE_MS * 2);
    expect(h.puts).toEqual([]);
    expect(h.applied).toEqual(["dark"]);
    expect(h.snap()).toMatchObject({ theme: "dark", look: lookOf(2), saveState: "local" });
    expect(h.state.stored).toEqual({ theme: "dark", look: lookOf(2) });
  });

  it("DB がなくても、前に残した見た目は次のタブで出る", async () => {
    const h = harness({ enabled: false }, {}, { stored: { look: lookOf(3) }, cookie: "light" });
    h.store.start();
    await tick();
    expect(h.snap()).toMatchObject({ look: lookOf(3), theme: "light", saveState: "local" });
    expect(h.puts).toEqual([]);
  });

  it("表がまだない(GET が available: false): 送らない。local。クッキーの明暗で出す。変えた見た目は残す", async () => {
    const h = harness({}, {}, { server: server({ available: false, saved: false }), cookie: "dark" });
    h.store.start();
    await tick();
    expect(h.snap()).toMatchObject({ available: false, saveState: "local", theme: "dark", loaded: true });
    h.store.setLook(lookOf(1));
    await vi.advanceTimersByTimeAsync(LOOK_DEBOUNCE_MS * 2);
    expect(h.puts).toEqual([]);
    expect(h.state.stored).toEqual({ look: lookOf(1) });
  });

  it("表がまだないとき、前に残した見た目を出す。残したものは消さない", async () => {
    const h = harness({}, {}, { server: server({ available: false, saved: false }), stored: { look: lookOf(6) } });
    h.store.start();
    await tick();
    expect(h.snap().look).toEqual(lookOf(6));
    expect(h.writes).toEqual([{ look: lookOf(6) }]);
    expect(h.state.stored).toEqual({ look: lookOf(6) });
  });
});
