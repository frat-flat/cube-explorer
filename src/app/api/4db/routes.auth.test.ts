import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 読み取りの 6 つの API(home・tasks・tasks/count・prefs の GET・history・boxes)と、prefs の PUT の入口:
// ログインしていなければ 401、データベースが未設定なら 503、PUT は別のサイトからなら 403。
// 本物の requireScope(src/lib/fourdb.ts)を通す。ログインの部品(Neon Auth)と next の関数は、Next の外では動かないので差し替える。
// データベースには、つながない(withScope が呼ばれたら、その場で失敗させる)。合成のメールアドレス(example.invalid)だけを使う。
const session = vi.hoisted(() => ({ data: null as null | { user: { id: string; email: string } } }));
const withScopeSpy = vi.hoisted(() => vi.fn());
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/auth", () => ({
  auth: { getSession: async () => ({ data: session.data }) },
  authBypassed: false,
  isAllowedEmail: (email: string | null | undefined) => email === "owner@example.invalid",
}));
vi.mock("@/fourdb/adapters/postgres/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/fourdb/adapters/postgres/db")>()),
  withScope: withScopeSpy,
}));

const routes = {
  home: (await import("./home/route")).GET as (r?: Request) => Promise<Response>,
  tasks: (await import("./tasks/route")).GET as (r?: Request) => Promise<Response>,
  "tasks/count": (await import("./tasks/count/route")).GET as (r?: Request) => Promise<Response>,
  prefs: (await import("./prefs/route")).GET as (r?: Request) => Promise<Response>,
  history: (await import("./history/route")).GET as (r: Request) => Promise<Response>,
  boxes: (await import("./boxes/route")).GET as (r: Request) => Promise<Response>,
};
const putPrefs = (await import("./prefs/route")).PUT as (r: Request) => Promise<Response>;
const urls = {
  home: "http://localhost/api/4db/home",
  tasks: "http://localhost/api/4db/tasks",
  "tasks/count": "http://localhost/api/4db/tasks/count",
  prefs: "http://localhost/api/4db/prefs",
  history: "http://localhost/api/4db/history",
  boxes: "http://localhost/api/4db/boxes",
};
const call = (name: keyof typeof routes, query = "") => routes[name](new Request(`${urls[name]}${query}`));
/** prefs の PUT。headers で sec-fetch-site などを足せる */
const put = (body: string, headers: Record<string, string> = {}) =>
  putPrefs(new Request(urls.prefs, { method: "PUT", body, headers: { "content-type": "application/json", ...headers } }));

beforeEach(() => {
  session.data = null;
  withScopeSpy.mockReset();
  withScopeSpy.mockImplementation(() => {
    throw new Error("データベースに触れてはいけない");
  });
});
afterEach(() => vi.unstubAllEnvs());

describe.each(["home", "tasks", "tasks/count", "prefs", "history", "boxes"] as const)("GET /api/4db/%s の入口", (name) => {
  it("ログインしていなければ 401(データベースには触れない)", async () => {
    vi.stubEnv("FOURDB_DATABASE_URL", "postgres://fourdb_app_local@localhost:55432/fourdb_dev");
    session.data = null;
    const res = await call(name);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "ログインが必要です" });
    expect(withScopeSpy).not.toHaveBeenCalled();
  });

  it("ログインしていても、見てよい人(ALLOWED_EMAILS)でなければ 401", async () => {
    vi.stubEnv("FOURDB_DATABASE_URL", "postgres://fourdb_app_local@localhost:55432/fourdb_dev");
    session.data = { user: { id: "u-other", email: "other@example.invalid" } };
    const res = await call(name);
    expect(res.status).toBe(401);
    expect(withScopeSpy).not.toHaveBeenCalled();
  });

  it("ログインしていて見てよい人でも、4DB のデータベースが未設定(FOURDB_DATABASE_URL なし)なら 503 と code: not_configured", async () => {
    vi.stubEnv("FOURDB_DATABASE_URL", "");
    session.data = { user: { id: "u-owner", email: "owner@example.invalid" } };
    const res = await call(name);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "not_configured" });
    expect(withScopeSpy).not.toHaveBeenCalled();
  });

  it("問い合わせの形の確かめより先に、ログイン・未設定を見る(未ログインに、形の違いで内部の事情を教えない)", async () => {
    vi.stubEnv("FOURDB_DATABASE_URL", "postgres://fourdb_app_local@localhost:55432/fourdb_dev");
    expect((await call(name, "?limit=abc&cursor=zz&kind=A&parent=x&q=%00")).status).toBe(401);
    vi.stubEnv("FOURDB_DATABASE_URL", "");
    session.data = { user: { id: "u-owner", email: "owner@example.invalid" } };
    expect((await call(name, "?limit=abc&cursor=zz&kind=A&parent=x&q=%00")).status).toBe(503);
    expect(withScopeSpy).not.toHaveBeenCalled();
  });
});

describe("PUT /api/4db/prefs の入口", () => {
  const BODY = JSON.stringify({ theme: "dark" });

  it("別のサイトからの要求は 403(ログインの確認より先。データベースには触れない)", async () => {
    vi.stubEnv("FOURDB_DATABASE_URL", "postgres://fourdb_app_local@localhost:55432/fourdb_dev");
    session.data = { user: { id: "u-owner", email: "owner@example.invalid" } };
    for (const headers of [{ "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" }, { origin: "http://evil.example.invalid" }] as Record<string, string>[]) {
      const res = await put(BODY, headers);
      expect(res.status, JSON.stringify(headers)).toBe(403);
      expect(await res.json()).toEqual({ error: "この画面からの操作だけを受け付けます" });
    }
    session.data = null;
    expect((await put(BODY, { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect(withScopeSpy).not.toHaveBeenCalled();
  });

  it("ログインしていなければ 401、見てよい人でなければ 401(データベースには触れない)", async () => {
    vi.stubEnv("FOURDB_DATABASE_URL", "postgres://fourdb_app_local@localhost:55432/fourdb_dev");
    session.data = null;
    const res = await put(BODY, { "sec-fetch-site": "same-origin" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "ログインが必要です" });
    session.data = { user: { id: "u-other", email: "other@example.invalid" } };
    expect((await put(BODY)).status).toBe(401);
    expect(withScopeSpy).not.toHaveBeenCalled();
  });

  it("4DB のデータベースが未設定なら 503 と code: not_configured", async () => {
    vi.stubEnv("FOURDB_DATABASE_URL", "");
    session.data = { user: { id: "u-owner", email: "owner@example.invalid" } };
    const res = await put(BODY, { "sec-fetch-site": "same-origin" });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "not_configured" });
    expect(withScopeSpy).not.toHaveBeenCalled();
  });

  it("本文の確かめより先に、ログイン・未設定を見る(未ログインに、本文の形の違いで内部の事情を教えない)", async () => {
    vi.stubEnv("FOURDB_DATABASE_URL", "postgres://fourdb_app_local@localhost:55432/fourdb_dev");
    session.data = null;
    expect((await put("not json")).status).toBe(401);
    expect((await put("x".repeat(10_000))).status).toBe(401);
    vi.stubEnv("FOURDB_DATABASE_URL", "");
    session.data = { user: { id: "u-owner", email: "owner@example.invalid" } };
    expect((await put("not json")).status).toBe(503);
    expect(withScopeSpy).not.toHaveBeenCalled();
  });
});
