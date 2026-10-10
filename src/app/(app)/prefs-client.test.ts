// アカウントに覚える設定の、ブラウザ側の実物(prefs-client.ts): 通信の結果の読み分け・localStorage・クッキー。
// fetch・window・document は作り物に差し替える(外へは何も通信しない)。
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LOOK, PATTERNS } from "@/fourdb/core/prefs";
import { applyTheme, clearStoredPending, loadServerPrefs, putServerPrefs, readCookieTheme, readStoredPending, writeStoredPending } from "./prefs-client";
import { PENDING_KEY } from "./prefs-sync";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("loadServerPrefs(GET /api/4db/prefs)", () => {
  it("答えを読む。同じサイトの資格情報つきで、signal を渡す", async () => {
    const fetchMock = vi.fn(async () => json({ available: true, saved: true, prefs: { theme: "light", world: "plain", look: PATTERNS[1].look } }));
    vi.stubGlobal("fetch", fetchMock);
    const ctrl = new AbortController();
    const r = await loadServerPrefs(ctrl.signal);
    expect(r).toEqual({ available: true, saved: true, prefs: { theme: "light", world: "plain", look: PATTERNS[1].look } });
    expect(fetchMock).toHaveBeenCalledWith("/api/4db/prefs", { credentials: "same-origin", signal: ctrl.signal });
  });

  it("知らない値・足りない部品は既定の値でゆるく読む。available / saved は true のときだけ true", async () => {
    vi.stubGlobal("fetch", async () => json({ available: "yes", saved: 1, prefs: { theme: "blue", world: "mars", look: { shape: "wire" } } }));
    const r = await loadServerPrefs(new AbortController().signal);
    expect(r.available).toBe(false);
    expect(r.saved).toBe(false);
    expect(r.prefs.theme).toBeNull();
    expect(r.prefs.world).toBe("plain");
    expect(r.prefs.look).toEqual({ ...DEFAULT_LOOK, shape: "wire" });
  });

  it("状態が 200 でない・形が違うときは throw(呼び手が読めなかったものとして扱う)", async () => {
    vi.stubGlobal("fetch", async () => json({ error: "x" }, 500));
    await expect(loadServerPrefs(new AbortController().signal)).rejects.toThrow();
    vi.stubGlobal("fetch", async () => json([1, 2]));
    await expect(loadServerPrefs(new AbortController().signal)).rejects.toThrow();
    vi.stubGlobal("fetch", async () => json(null));
    await expect(loadServerPrefs(new AbortController().signal)).rejects.toThrow();
  });
});

describe("putServerPrefs(PUT /api/4db/prefs)", () => {
  it("JSON の本文を PUT で送る。keepalive はそのまま渡す", async () => {
    const fetchMock = vi.fn(async () => json({ available: true, saved: true, prefs: {} }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await putServerPrefs({ theme: "dark" }, false)).toBe("ok");
    expect(await putServerPrefs({ look: PATTERNS[0].look }, true)).toBe("ok");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/4db/prefs");
    expect(init).toMatchObject({ method: "PUT", credentials: "same-origin", keepalive: false, body: '{"theme":"dark"}' });
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].keepalive).toBe(true);
  });

  it("503 で code が prefs_unavailable なら unavailable。ほかの 503 や 400・401・403・500 は error", async () => {
    vi.stubGlobal("fetch", async () => json({ error: "x", code: "prefs_unavailable" }, 503));
    expect(await putServerPrefs({ theme: "dark" }, false)).toBe("unavailable");
    for (const [body, status] of [
      [{ error: "x", code: "not_configured" }, 503],
      [{ error: "x" }, 503],
      [{ error: "x" }, 400],
      [{ error: "x" }, 401],
      [{ error: "x" }, 403],
      [{ error: "x" }, 500],
    ] as const) {
      vi.stubGlobal("fetch", async () => json(body, status));
      expect(await putServerPrefs({ theme: "dark" }, false), `${status} ${JSON.stringify(body)}`).toBe("error");
    }
    vi.stubGlobal("fetch", async () => new Response("<html>", { status: 503 }));
    expect(await putServerPrefs({ theme: "dark" }, false)).toBe("error");
  });

  it("通信そのものの失敗は throw のまま(PrefsStore が error として扱う)", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(putServerPrefs({ theme: "dark" }, false)).rejects.toThrow();
  });
});

describe("localStorage(fourdb.prefs.pending)", () => {
  function fakeStorage(init: Record<string, string> = {}) {
    const data = new Map(Object.entries(init));
    return {
      data,
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    };
  }

  it("書いて読める。null か空なら消す", () => {
    const ls = fakeStorage();
    vi.stubGlobal("window", { localStorage: ls });
    writeStoredPending({ theme: "dark", look: PATTERNS[3].look });
    expect(PENDING_KEY).toBe("fourdb.prefs.pending");
    expect(ls.data.has("fourdb.prefs.pending")).toBe(true);
    expect(readStoredPending()).toEqual({ theme: "dark", look: PATTERNS[3].look });
    writeStoredPending({});
    expect(ls.data.has("fourdb.prefs.pending")).toBe(false);
    writeStoredPending({ theme: null });
    expect(readStoredPending()).toEqual({ theme: null });
    writeStoredPending(null);
    expect(readStoredPending()).toEqual({});
  });

  it("書き換えられた・壊れた値は読まない({})。読んだ上で消す(次の読み込みでも読み直し続けない)", () => {
    for (const bad of ['{"theme":"<script>"}', "{broken", "not json", "[]", "null", "{}", "", '{"__proto__":{"theme":"dark"}}', '{"look":{"shape":"glass"}}', '{"x":1}']) {
      const ls = fakeStorage({ "fourdb.prefs.pending": bad });
      vi.stubGlobal("window", { localStorage: ls });
      expect(readStoredPending(), bad).toEqual({});
      expect(ls.data.has("fourdb.prefs.pending"), `消す: ${bad}`).toBe(false);
      expect(readStoredPending(), bad).toEqual({}); // 2 回目は、もう何もない
    }
  });

  it("正しい値は読んでも消さない。ほかのキーには触らない。何もなければ何もしない", () => {
    const ls = fakeStorage({ "fourdb.prefs.pending": JSON.stringify({ theme: "dark" }), other: "x" });
    vi.stubGlobal("window", { localStorage: ls });
    expect(readStoredPending()).toEqual({ theme: "dark" });
    expect(readStoredPending()).toEqual({ theme: "dark" });
    expect(ls.data.get("fourdb.prefs.pending")).toBe('{"theme":"dark"}');
    const empty = fakeStorage({ other: "x" });
    const removeSpy = vi.spyOn(empty, "removeItem");
    vi.stubGlobal("window", { localStorage: empty });
    expect(readStoredPending()).toEqual({});
    expect(removeSpy).not.toHaveBeenCalled(); // キーがないときは消す操作もしない
    expect(empty.data.get("other")).toBe("x");
  });

  it("壊れた値を消そうとして localStorage が throw しても落ちない({})", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => "{broken",
        removeItem: () => {
          throw new Error("denied");
        },
      },
    });
    expect(readStoredPending()).toEqual({});
  });

  it("clearStoredPending(ログアウトのとき): 送っていない変更を消す。ほかのキーと明暗のクッキーは残す。何もなくても・localStorage が使えなくても落ちない", () => {
    const ls = fakeStorage({ "fourdb.prefs.pending": JSON.stringify({ theme: "dark", look: PATTERNS[3].look }), other: "x" });
    const doc = { cookie: "fourdb_theme=dark" };
    vi.stubGlobal("window", { localStorage: ls });
    vi.stubGlobal("document", doc);
    clearStoredPending();
    expect(ls.data.has("fourdb.prefs.pending")).toBe(false);
    expect(ls.data.get("other")).toBe("x");
    expect(doc.cookie).toBe("fourdb_theme=dark"); // 明暗のクッキーは触らない
    expect(readStoredPending()).toEqual({});
    expect(() => clearStoredPending()).not.toThrow();
    const boom = () => {
      throw new Error("denied");
    };
    vi.stubGlobal("window", { localStorage: { getItem: boom, setItem: boom, removeItem: boom } });
    expect(() => clearStoredPending()).not.toThrow();
  });

  it("localStorage が使えない(読むのも書くのも throw)ときも落ちない", () => {
    const boom = () => {
      throw new Error("denied");
    };
    vi.stubGlobal("window", { localStorage: { getItem: boom, setItem: boom, removeItem: boom } });
    expect(readStoredPending()).toEqual({});
    expect(() => writeStoredPending({ theme: "dark" })).not.toThrow();
    expect(() => writeStoredPending(null)).not.toThrow();
    // window.localStorage を引くだけで throw する場合(ブラウザの設定で保存が禁止)
    vi.stubGlobal("window", {
      get localStorage(): never {
        throw new Error("SecurityError");
      },
    });
    expect(readStoredPending()).toEqual({});
    expect(() => writeStoredPending({ theme: "dark" })).not.toThrow();
  });
});

describe("クッキーと <html data-theme>", () => {
  function fakeDocument(cookie = "") {
    const attrs = new Map<string, string>();
    const doc = {
      cookie,
      documentElement: {
        setAttribute: (k: string, v: string) => void attrs.set(k, v),
        removeAttribute: (k: string) => void attrs.delete(k),
      },
    };
    return { doc, attrs };
  }

  it("readCookieTheme: dark / light だけ。ほかの値・なしは null", () => {
    for (const [c, expected] of [
      ["fourdb_theme=dark", "dark"],
      ["a=1; fourdb_theme=light; b=2", "light"],
      ["fourdb_theme=blue", null],
      ["xfourdb_theme=dark", null],
      ["", null],
    ] as const) {
      vi.stubGlobal("document", fakeDocument(c).doc);
      expect(readCookieTheme(), c).toBe(expected);
    }
  });

  it("applyTheme: 暗い・明るいは、クッキーを書いて data-theme を付ける。null はクッキーを消して印を外す", () => {
    const { doc, attrs } = fakeDocument();
    vi.stubGlobal("document", doc);
    applyTheme("dark");
    expect(doc.cookie).toMatch(/^fourdb_theme=dark; path=\/; max-age=\d+; samesite=lax$/);
    expect(attrs.get("data-theme")).toBe("dark");
    applyTheme("light");
    expect(attrs.get("data-theme")).toBe("light");
    applyTheme(null);
    expect(doc.cookie).toMatch(/^fourdb_theme=; path=\/; max-age=0; samesite=lax$/);
    expect(attrs.has("data-theme")).toBe(false);
  });

  it("クッキーが書けなくても(throw)、画面の印は変える", () => {
    const attrs = new Map<string, string>();
    vi.stubGlobal("document", {
      set cookie(_v: string) {
        throw new Error("blocked");
      },
      get cookie(): string {
        throw new Error("blocked");
      },
      documentElement: { setAttribute: (k: string, v: string) => void attrs.set(k, v), removeAttribute: (k: string) => void attrs.delete(k) },
    });
    expect(() => applyTheme("dark")).not.toThrow();
    expect(attrs.get("data-theme")).toBe("dark");
    expect(readCookieTheme()).toBeNull();
  });
});
