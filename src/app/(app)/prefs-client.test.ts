// アカウントに覚える設定の、ブラウザ側の実物(prefs-client.ts): 通信の結果の読み分け・localStorage・クッキー。
// fetch・window・document は作り物に差し替える(外へは何も通信しない)。
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LOOK, PATTERNS, type PrefsPatch } from "@/fourdb/core/prefs";
import { applyTheme, clearStoredPending, loadServerPrefs, putServerPrefs, readCookieTheme, readStoredPending, writeStoredPending } from "./prefs-client";
import { PENDING_KEY } from "./prefs-sync";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// 画面のアカウントの指紋(形だけ正しい作り物。計算は src/lib/owner-fingerprint.test.ts)。別のアカウントの指紋は OWNER_B
const OWNER = "AAAAAAAAAAAAAAAAAAAAAA";
const OWNER_B = "BBBBBBBBBBBBBBBBBBBBBB";
/** localStorage に入っている文字(どのアカウントのものかと一緒) */
const stored = (patch: PrefsPatch, owner: string | null = OWNER) => JSON.stringify({ owner, patch });

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
  it("JSON の本文を PUT で送る。keepalive はそのまま渡す。本文は変えず、アカウントの指紋を x-4db-owner のヘッダーに付ける", async () => {
    const fetchMock = vi.fn(async () => json({ available: true, saved: true, prefs: {} }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await putServerPrefs({ theme: "dark" }, false, OWNER)).toBe("ok");
    expect(await putServerPrefs({ look: PATTERNS[0].look }, true, OWNER_B)).toBe("ok");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/4db/prefs");
    expect(init).toMatchObject({ method: "PUT", credentials: "same-origin", keepalive: false, body: '{"theme":"dark"}' });
    expect(init.headers).toEqual({ "content-type": "application/json", "x-4db-owner": OWNER });
    const second = (fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1];
    expect(second.keepalive).toBe(true);
    expect((second.headers as Record<string, string>)["x-4db-owner"]).toBe(OWNER_B); // 毎回、渡された指紋
  });

  it("503 で code が prefs_unavailable なら unavailable。ほかの 503 や 400・500 は error", async () => {
    vi.stubGlobal("fetch", async () => json({ error: "x", code: "prefs_unavailable" }, 503));
    expect(await putServerPrefs({ theme: "dark" }, false, OWNER)).toBe("unavailable");
    for (const [body, status] of [
      [{ error: "x", code: "not_configured" }, 503],
      [{ error: "x" }, 503],
      [{ error: "x" }, 400],
      [{ error: "x" }, 500],
    ] as const) {
      vi.stubGlobal("fetch", async () => json(body, status));
      expect(await putServerPrefs({ theme: "dark" }, false, OWNER), `${status} ${JSON.stringify(body)}`).toBe("error");
    }
    vi.stubGlobal("fetch", async () => new Response("<html>", { status: 503 }));
    expect(await putServerPrefs({ theme: "dark" }, false, OWNER)).toBe("error");
  });

  it("401(ログインが切れた)と 403(断られた)は denied(残さず、もう送らない)。本文が読めなくても同じ", async () => {
    for (const status of [401, 403]) {
      vi.stubGlobal("fetch", async () => json({ error: "x" }, status));
      expect(await putServerPrefs({ theme: "dark" }, false, OWNER), String(status)).toBe("denied");
    }
    vi.stubGlobal("fetch", async () => new Response("<html>", { status: 401 }));
    expect(await putServerPrefs({ theme: "dark" }, false, OWNER)).toBe("denied");
  });

  it("409 で code が owner_mismatch なら owner_mismatch。code のない 409(データの決まり)・ほかの code・読めない本文は error(残して送り直せる)", async () => {
    vi.stubGlobal("fetch", async () => json({ error: "x", code: "owner_mismatch" }, 409));
    expect(await putServerPrefs({ theme: "dark" }, false, OWNER)).toBe("owner_mismatch");
    for (const body of [{ error: "データの決まりに合わないため止めました" }, { error: "x", code: "other" }]) {
      vi.stubGlobal("fetch", async () => json(body, 409));
      expect(await putServerPrefs({ theme: "dark" }, false, OWNER), JSON.stringify(body)).toBe("error");
    }
    vi.stubGlobal("fetch", async () => new Response("<html>", { status: 409 }));
    expect(await putServerPrefs({ theme: "dark" }, false, OWNER)).toBe("error");
    // code が owner_mismatch でも、409 以外では見ない
    vi.stubGlobal("fetch", async () => json({ error: "x", code: "owner_mismatch" }, 500));
    expect(await putServerPrefs({ theme: "dark" }, false, OWNER)).toBe("error");
  });

  it("通信そのものの失敗は throw のまま(PrefsStore が error として扱う)", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(putServerPrefs({ theme: "dark" }, false, OWNER)).rejects.toThrow();
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

  it("書いて読める(どのアカウントのものかと一緒に)。null か空なら消す", () => {
    const ls = fakeStorage();
    vi.stubGlobal("window", { localStorage: ls });
    writeStoredPending({ owner: OWNER, patch: { theme: "dark", look: PATTERNS[3].look } });
    expect(PENDING_KEY).toBe("fourdb.prefs.pending");
    expect(ls.data.has("fourdb.prefs.pending")).toBe(true);
    expect(JSON.parse(ls.data.get("fourdb.prefs.pending")!)).toEqual({ owner: OWNER, patch: { theme: "dark", look: PATTERNS[3].look } });
    expect(readStoredPending()).toEqual({ owner: OWNER, patch: { theme: "dark", look: PATTERNS[3].look } });
    writeStoredPending({ owner: OWNER, patch: {} });
    expect(ls.data.has("fourdb.prefs.pending")).toBe(false);
    writeStoredPending({ owner: null, patch: { theme: null } });
    expect(readStoredPending()).toEqual({ owner: null, patch: { theme: null } }); // アカウントを特定できなかった画面が残したもの
    writeStoredPending(null);
    expect(readStoredPending()).toBeNull();
  });

  it("読むときは、アカウントの違いを見ない(返すだけ。使うかどうかは PrefsStore)。違うアカウントのものも、ここでは消さない", () => {
    const ls = fakeStorage({ "fourdb.prefs.pending": stored({ theme: "light" }, OWNER_B) });
    vi.stubGlobal("window", { localStorage: ls });
    expect(readStoredPending()).toEqual({ owner: OWNER_B, patch: { theme: "light" } });
    expect(ls.data.has("fourdb.prefs.pending")).toBe(true);
  });

  it("書き換えられた・壊れた値・owner のない古い形は読まない(null)。読んだ上で消す(次の読み込みでも読み直し続けない)", () => {
    const bads = [
      '{"theme":"<script>"}',
      "{broken",
      "not json",
      "[]",
      "null",
      "{}",
      "",
      '{"__proto__":{"theme":"dark"}}',
      '{"look":{"shape":"glass"}}',
      '{"x":1}',
      '{"theme":"dark"}', // owner のない古い形(変更だけ)
      JSON.stringify({ theme: "dark", look: PATTERNS[1].look }),
      stored({ theme: "dark" }, "short"), // 指紋の形でない
      stored({ theme: "dark" }, "!".repeat(22)),
      JSON.stringify({ owner: 1, patch: { theme: "dark" } }),
      JSON.stringify({ owner: OWNER }), // patch がない
      JSON.stringify({ patch: { theme: "dark" } }), // owner がない
      JSON.stringify({ owner: OWNER, patch: {} }),
      JSON.stringify({ owner: OWNER, patch: { theme: "evil" } }),
      JSON.stringify({ owner: OWNER, patch: { theme: "dark" }, extra: 1 }),
      `{"owner":"${OWNER}","patch":{"theme":"dark"},"__proto__":{}}`,
      JSON.stringify([OWNER, { theme: "dark" }]),
      "x".repeat(50_000),
    ];
    for (const bad of bads) {
      const ls = fakeStorage({ "fourdb.prefs.pending": bad });
      vi.stubGlobal("window", { localStorage: ls });
      expect(readStoredPending(), bad.slice(0, 40)).toBeNull();
      expect(ls.data.has("fourdb.prefs.pending"), `消す: ${bad.slice(0, 40)}`).toBe(false);
      expect(readStoredPending(), bad.slice(0, 40)).toBeNull(); // 2 回目は、もう何もない
    }
  });

  it("正しい値は読んでも消さない。ほかのキーには触らない。何もなければ何もしない", () => {
    const ls = fakeStorage({ "fourdb.prefs.pending": stored({ theme: "dark" }), other: "x" });
    vi.stubGlobal("window", { localStorage: ls });
    expect(readStoredPending()).toEqual({ owner: OWNER, patch: { theme: "dark" } });
    expect(readStoredPending()).toEqual({ owner: OWNER, patch: { theme: "dark" } });
    expect(ls.data.get("fourdb.prefs.pending")).toBe(`{"owner":"${OWNER}","patch":{"theme":"dark"}}`);
    const empty = fakeStorage({ other: "x" });
    const removeSpy = vi.spyOn(empty, "removeItem");
    vi.stubGlobal("window", { localStorage: empty });
    expect(readStoredPending()).toBeNull();
    expect(removeSpy).not.toHaveBeenCalled(); // キーがないときは消す操作もしない
    expect(empty.data.get("other")).toBe("x");
  });

  it("壊れた値を消そうとして localStorage が throw しても落ちない(null)", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => "{broken",
        removeItem: () => {
          throw new Error("denied");
        },
      },
    });
    expect(readStoredPending()).toBeNull();
  });

  it("clearStoredPending(ログアウトのとき): 送っていない変更を消す。ほかのキーと明暗のクッキーは残す。何もなくても・localStorage が使えなくても落ちない", () => {
    const ls = fakeStorage({ "fourdb.prefs.pending": stored({ theme: "dark", look: PATTERNS[3].look }), other: "x" });
    const doc = { cookie: "fourdb_theme=dark" };
    vi.stubGlobal("window", { localStorage: ls });
    vi.stubGlobal("document", doc);
    clearStoredPending();
    expect(ls.data.has("fourdb.prefs.pending")).toBe(false);
    expect(ls.data.get("other")).toBe("x");
    expect(doc.cookie).toBe("fourdb_theme=dark"); // 明暗のクッキーは触らない
    expect(readStoredPending()).toBeNull();
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
    expect(readStoredPending()).toBeNull();
    expect(() => writeStoredPending({ owner: OWNER, patch: { theme: "dark" } })).not.toThrow();
    expect(() => writeStoredPending(null)).not.toThrow();
    // window.localStorage を引くだけで throw する場合(ブラウザの設定で保存が禁止)
    vi.stubGlobal("window", {
      get localStorage(): never {
        throw new Error("SecurityError");
      },
    });
    expect(readStoredPending()).toBeNull();
    expect(() => writeStoredPending({ owner: OWNER, patch: { theme: "dark" } })).not.toThrow();
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
