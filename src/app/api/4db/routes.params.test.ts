import { beforeEach, describe, expect, it, vi } from "vitest";
import { ImportError } from "@/fourdb/adapters/postgres/import-store";
import { PrefsUnavailable } from "@/fourdb/adapters/postgres/prefs";
import { DEFAULT_LOOK, defaultPrefs } from "@/fourdb/core/prefs";

// 読み取りの API(home・tasks・tasks/count・prefs・history・boxes)の、問い合わせの読み方と、結果・失敗の返し方。
// prefs の PUT は、本文の読み方(形の違うもの・4KB を超えるもの)も確かめる。
// ログインとデータベースは差し替える(ログインの入口は routes.auth.test.ts、データベースの中は overview.integration.test.ts・prefs.integration.test.ts で確かめる)。
// 形の違う問い合わせ・本文は、つなぎ(adapter)を呼ぶ前に 400 で断ることを確かめる。
const scope = vi.hoisted(() => ({ principal: "test:owner", workspaceId: "11111111-2222-4333-8444-555555555555" }));
const spies = vi.hoisted(() => ({
  loadHome: vi.fn(),
  loadTasks: vi.fn(),
  countTasks: vi.fn(),
  getPrefs: vi.fn(),
  putPrefs: vi.fn(),
  listHistory: vi.fn(),
  listBoxes: vi.fn(),
  requireScope: vi.fn(),
}));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/auth", () => ({ auth: null, authBypassed: false, isAllowedEmail: () => true }));
vi.mock("@/lib/fourdb", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/fourdb")>()),
  requireScope: spies.requireScope,
}));
vi.mock("@/fourdb/adapters/postgres/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/fourdb/adapters/postgres/db")>()),
  withScope: async (_scope: unknown, fn: (tx: unknown) => unknown) => fn({}),
}));
vi.mock("@/fourdb/adapters/postgres/home", () => ({ loadHome: spies.loadHome }));
vi.mock("@/fourdb/adapters/postgres/tasks", () => ({ loadTasks: spies.loadTasks, countTasks: spies.countTasks }));
vi.mock("@/fourdb/adapters/postgres/prefs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/fourdb/adapters/postgres/prefs")>()),
  getPrefs: spies.getPrefs,
  putPrefs: spies.putPrefs,
}));
vi.mock("@/fourdb/adapters/postgres/history", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/fourdb/adapters/postgres/history")>()),
  listHistory: spies.listHistory,
}));
vi.mock("@/fourdb/adapters/postgres/boxes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/fourdb/adapters/postgres/boxes")>()),
  listBoxes: spies.listBoxes,
}));

const home = (await import("./home/route")).GET;
const tasks = (await import("./tasks/route")).GET;
const tasksCount = (await import("./tasks/count/route")).GET;
const prefs = await import("./prefs/route");
const history = (await import("./history/route")).GET;
const boxes = (await import("./boxes/route")).GET;
const get = (path: string, query = "") => new Request(`http://localhost/api/4db/${path}${query}`);
const ID = "11111111-2222-4333-8444-555555555555";

beforeEach(() => {
  for (const s of Object.values(spies)) s.mockReset();
  spies.requireScope.mockImplementation(async () => scope);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/4db/home", () => {
  it("つなぎの返したものを、そのまま 200 で返す(中身はつなぎと芯が決める)", async () => {
    const overview = { units: [], others: { items: [], more: 0 }, topBoxes: 0 };
    spies.loadHome.mockResolvedValue(overview);
    const res = await home();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(overview);
    expect(spies.loadHome).toHaveBeenCalledWith(expect.anything(), scope);
  });
  it("つなぎが失敗したら、決まった文の 500(中身は見せない)", async () => {
    spies.loadHome.mockRejectedValue(new Error("secret detail"));
    const res = await home();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
  });
  it("入口(requireScope)が返した Response(401・503 など)は、そのまま返してつなぎを呼ばない", async () => {
    spies.requireScope.mockResolvedValue(Response.json({ error: "ログインが必要です" }, { status: 401 }));
    expect((await home()).status).toBe(401);
    expect(spies.loadHome).not.toHaveBeenCalled();
  });
});

describe("GET /api/4db/tasks と /api/4db/tasks/count", () => {
  it("一覧: つなぎの返したものをそのまま 200 で返す", async () => {
    const overview = { count: 1, items: { items: [], more: 0 }, files: { items: [], more: 0 } };
    spies.loadTasks.mockResolvedValue(overview);
    const res = await tasks();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(overview);
    expect(spies.loadTasks).toHaveBeenCalledWith(expect.anything(), scope);
  });
  it("件数: { count } の形で返す(0 も)", async () => {
    spies.countTasks.mockResolvedValueOnce(3).mockResolvedValueOnce(0);
    expect(await (await tasksCount()).json()).toEqual({ count: 3 });
    const zero = await tasksCount();
    expect(zero.status).toBe(200);
    expect(await zero.json()).toEqual({ count: 0 });
    expect(spies.countTasks).toHaveBeenCalledWith(expect.anything(), scope);
  });
  it("入口が返した Response は、そのまま返してつなぎを呼ばない", async () => {
    spies.requireScope.mockResolvedValue(Response.json({ error: "ログインが必要です" }, { status: 401 }));
    expect((await tasks()).status).toBe(401);
    expect((await tasksCount()).status).toBe(401);
    expect(spies.loadTasks).not.toHaveBeenCalled();
    expect(spies.countTasks).not.toHaveBeenCalled();
  });
  it("つなぎが失敗したら、どちらも決まった文の 500(中身は見せない)", async () => {
    spies.loadTasks.mockRejectedValue(new Error("secret detail"));
    spies.countTasks.mockRejectedValue(new Error("secret detail"));
    for (const res of [await tasks(), await tasksCount()]) {
      expect(res.status).toBe(500);
      expect(JSON.stringify(await res.json())).not.toContain("secret");
    }
  });
});

describe("GET /api/4db/prefs", () => {
  it("つなぎの返した { available, saved, prefs } をそのまま 200 で返す", async () => {
    const state = { available: true, saved: false, prefs: defaultPrefs() };
    spies.getPrefs.mockResolvedValue(state);
    const res = await prefs.GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(state);
    expect(spies.getPrefs).toHaveBeenCalledWith(scope);
  });
  it("つなぎが失敗したら、決まった文の 500(中身は見せない)", async () => {
    spies.getPrefs.mockRejectedValue(new Error("secret detail"));
    const res = await prefs.GET();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
  });
});

describe("PUT /api/4db/prefs", () => {
  const put = (body: string, headers: Record<string, string> = {}) =>
    prefs.PUT(new Request("http://localhost/api/4db/prefs", { method: "PUT", body, headers: { "content-type": "application/json", ...headers } }));
  const saved = { available: true, saved: true, prefs: { ...defaultPrefs(), theme: "dark" as const } };

  it("入口(requireScope)には request を渡す(別のサイトからの書き込みを断るため)", async () => {
    spies.putPrefs.mockResolvedValue(saved);
    const request = new Request("http://localhost/api/4db/prefs", { method: "PUT", body: JSON.stringify({ theme: "dark" }) });
    await prefs.PUT(request);
    expect(spies.requireScope).toHaveBeenCalledWith(request);
  });
  it("入口が返した Response(403・401・503)は、そのまま返して、つなぎを呼ばない", async () => {
    spies.requireScope.mockResolvedValue(Response.json({ error: "この画面からの操作だけを受け付けます" }, { status: 403 }));
    expect((await put(JSON.stringify({ theme: "dark" }))).status).toBe(403);
    expect(spies.putPrefs).not.toHaveBeenCalled();
  });
  it("送った欄だけをつなぎに渡し(新しいオブジェクト)、保存後の設定を 200 で返す", async () => {
    spies.putPrefs.mockResolvedValue(saved);
    const res = await put(JSON.stringify({ theme: "dark", look: { ...DEFAULT_LOOK, shape: "wire" } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(saved);
    expect(spies.putPrefs.mock.calls[0][0]).toBe(scope);
    const patch = spies.putPrefs.mock.calls[0][1];
    expect(patch).toEqual({ theme: "dark", look: { ...DEFAULT_LOOK, shape: "wire" } });
    expect(Object.keys(patch).sort()).toEqual(["look", "theme"]);
    // theme: null は「パソコンの設定に合わせる」に戻す指定
    await put(JSON.stringify({ theme: null }));
    expect(spies.putPrefs.mock.calls[1][1]).toEqual({ theme: null });
    await put(JSON.stringify({ world: "plain" }));
    expect(spies.putPrefs.mock.calls[2][1]).toEqual({ world: "plain" });
  });
  it("形の違う本文は、つなぎを呼ばずに 400(JSON でない・{ … } でない・空・知らない欄・知らない値・__proto__・constructor)", async () => {
    const bodies = [
      "",
      "not json",
      "null",
      "[]",
      "[1]",
      "42",
      '"x"',
      "{}",
      JSON.stringify({ other: 1 }),
      JSON.stringify({ theme: "dark", other: 1 }),
      JSON.stringify({ theme: "red" }),
      JSON.stringify({ theme: 1 }),
      JSON.stringify({ world: "other" }),
      JSON.stringify({ world: null }),
      JSON.stringify({ world: "Plain" }),
      JSON.stringify({ look: null }),
      JSON.stringify({ look: {} }),
      JSON.stringify({ look: [] }),
      JSON.stringify({ look: { ...DEFAULT_LOOK, shape: "nope" } }),
      JSON.stringify({ look: { ...DEFAULT_LOOK, extra: 1 } }),
      '{"__proto__":{"theme":"dark"}}',
      '{"theme":"dark","__proto__":{}}',
      '{"constructor":{"prototype":{}}}',
      '{"look":{"__proto__":{}}}',
    ];
    for (const b of bodies) {
      const res = await put(b);
      expect(res.status, b).toBe(400);
      expect(await res.json(), b).toHaveProperty("error");
    }
    expect(spies.putPrefs).not.toHaveBeenCalled();
  });
  it("本文は 4KB(4,096 バイト)まで: ちょうどなら通り、1 バイトでも超えれば 400(つなぎを呼ばない)。長さの申告がなくても、中身が超えれば 400", async () => {
    spies.putPrefs.mockResolvedValue(saved);
    const fit = JSON.stringify({ theme: "dark" }).padEnd(4096, " ");
    expect(new TextEncoder().encode(fit).byteLength).toBe(4096);
    expect((await put(fit)).status).toBe(200);
    expect(spies.putPrefs).toHaveBeenCalledTimes(1);
    const over = JSON.stringify({ theme: "dark" }).padEnd(4097, " ");
    expect((await put(over)).status).toBe(400);
    expect((await put(over, { "content-length": "4097" })).status).toBe(400);
    // 長さの申告が大きければ、読む前に断る
    expect((await put(JSON.stringify({ theme: "dark" }), { "content-length": "999999" })).status).toBe(400);
    expect((await put(JSON.stringify({ look: { ...DEFAULT_LOOK }, pad: "x".repeat(10_000) }))).status).toBe(400);
    // 文字数ではなくバイト数: 日本語 1,400 文字(UTF-8 で 4,200 バイト)が続く本文は 4KB を超える
    expect((await put(JSON.stringify({ theme: "dark" }) + "あ".repeat(1400))).status).toBe(400);
    expect(spies.putPrefs).toHaveBeenCalledTimes(1);
  });
  it("保存する表が使えなければ 503 と code: prefs_unavailable。つなぎが 400 の ImportError を投げれば、その文で 400。それ以外の失敗は決まった文の 500", async () => {
    spies.putPrefs.mockRejectedValueOnce(new PrefsUnavailable());
    const un = await put(JSON.stringify({ theme: "dark" }));
    expect(un.status).toBe(503);
    expect(await un.json()).toEqual({ error: "アカウントの設定を保存する表が、まだ使えません", code: "prefs_unavailable" });
    spies.putPrefs.mockRejectedValueOnce(new ImportError("設定の値が正しくありません", 400));
    const badValue = await put(JSON.stringify({ theme: "dark" }));
    expect(badValue.status).toBe(400);
    expect(await badValue.json()).toEqual({ error: "設定の値が正しくありません" });
    spies.putPrefs.mockRejectedValueOnce(new Error("secret detail"));
    const boom = await put(JSON.stringify({ theme: "dark" }));
    expect(boom.status).toBe(500);
    expect(JSON.stringify(await boom.json())).not.toContain("secret");
  });
});

describe("GET /api/4db/history", () => {
  it("既定は limit 50・cursor なし・kind なし。上限を超える limit は 100 に丸める", async () => {
    spies.listHistory.mockResolvedValue({ items: [], nextCursor: null });
    expect((await history(get("history"))).status).toBe(200);
    expect(spies.listHistory).toHaveBeenLastCalledWith(expect.anything(), scope, { cursor: null, limit: 50, kind: null });
    await history(get("history", "?limit=100000&cursor=12345&kind=import"));
    expect(spies.listHistory).toHaveBeenLastCalledWith(expect.anything(), scope, { cursor: "12345", limit: 100, kind: "import" });
  });
  it("形の違う limit・cursor・kind は、つなぎを呼ばずに 400", async () => {
    for (const q of ["?limit=0", "?limit=-1", "?limit=abc", "?cursor=abc", "?cursor=1%00", "?cursor=1234567890123456789", "?kind=Import", "?kind=a%00", "?kind=a-b"]) {
      const res = await history(get("history", q));
      expect(res.status, q).toBe(400);
      expect(await res.json()).toHaveProperty("error");
    }
    expect(spies.listHistory).not.toHaveBeenCalled();
  });
  it("つなぎが 400 の ImportError を投げれば、その文で 400。それ以外の失敗は決まった文の 500", async () => {
    spies.listHistory.mockRejectedValueOnce(new ImportError("cursor の形が違います", 400));
    const res = await history(get("history"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "cursor の形が違います" });
    spies.listHistory.mockRejectedValueOnce(new Error("boom"));
    expect((await history(get("history"))).status).toBe(500);
  });
});

describe("GET /api/4db/boxes", () => {
  it("既定は parent なし(いちばん上)・limit 100。root は parent なしと同じ。上限を超える limit は 200 に丸める。検索語・単位は前後の空白を外す", async () => {
    spies.listBoxes.mockResolvedValue({ parent: null, boxes: [], nextCursor: null });
    expect((await boxes(get("boxes"))).status).toBe(200);
    expect(spies.listBoxes).toHaveBeenLastCalledWith(expect.anything(), scope, { parentId: null, unitType: "", q: "", cursor: null, limit: 100 });
    await boxes(get("boxes", `?parent=root&limit=100000&q=%20%E6%B3%95%E4%BA%BA%20&unitType=%E5%BA%97%E8%88%97&cursor=${ID}`));
    expect(spies.listBoxes).toHaveBeenLastCalledWith(expect.anything(), scope, { parentId: null, unitType: "店舗", q: "法人", cursor: ID, limit: 200 });
    await boxes(get("boxes", `?parent=${ID}`));
    expect(spies.listBoxes).toHaveBeenLastCalledWith(expect.anything(), scope, expect.objectContaining({ parentId: ID }));
  });
  it("形の違う parent・cursor・limit と、NUL の入った q・unitType は、つなぎを呼ばずに 400(データベースの 500 にしない)", async () => {
    for (const q of ["?parent=abc", "?parent=ROOT", "?cursor=abc", "?cursor=bm90LWpzb24", `?cursor=${ID}%00`, "?limit=0", "?limit=x", "?q=%00", "?q=a%00b", "?unitType=%00", "?unitType=%E6%B3%95%E4%BA%BA%00"]) {
      const res = await boxes(get("boxes", q));
      expect(res.status, q).toBe(400);
      expect(await res.json()).toHaveProperty("error");
    }
    expect(spies.listBoxes).not.toHaveBeenCalled();
  });
  it("NUL の入った q の文は、どの入力かが分かる", async () => {
    expect(await (await boxes(get("boxes", "?q=%00"))).json()).toEqual({ error: "q に使えない文字が入っています" });
    expect(await (await boxes(get("boxes", "?unitType=%00"))).json()).toEqual({ error: "unitType に使えない文字が入っています" });
  });
  it("親が見つからなければ 404。cursor の Box が見つからなければ、つなぎの 400 の文を返す。それ以外の失敗は決まった文の 500", async () => {
    spies.listBoxes.mockResolvedValueOnce(null);
    const nf = await boxes(get("boxes", `?parent=${ID}`));
    expect(nf.status).toBe(404);
    expect(await nf.json()).toEqual({ error: "見つかりません" });
    spies.listBoxes.mockRejectedValueOnce(new ImportError("cursor が見つかりません。最初から読み直してください", 400));
    const c = await boxes(get("boxes", `?cursor=${ID}`));
    expect(c.status).toBe(400);
    expect(await c.json()).toEqual({ error: "cursor が見つかりません。最初から読み直してください" });
    spies.listBoxes.mockRejectedValueOnce(new Error("boom"));
    expect((await boxes(get("boxes"))).status).toBe(500);
  });
});
