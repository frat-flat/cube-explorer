import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 入れ物とつなぐ部品(src/lib/fourdb.ts)の確かめ。
// - fourdbUsable(画面の枠が「アカウント向けの API が使えるか」を決める)は、requireScope が通すときと同じ条件か
// - readJson は、本文がすでに読まれていても 500 にせず null を返すか
// ログインの部品(Neon Auth)と next の関数は、Next の外では動かないので差し替える。データベースにはつながない(personalWorkspace は作り物)。
const state = vi.hoisted(() => ({
  bypassed: false,
  authed: true,
  session: null as null | { user: { id: string; email: string } },
}));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/auth", () => ({
  get auth() {
    return state.authed ? { getSession: async () => ({ data: state.session }) } : null;
  },
  get authBypassed() {
    return state.bypassed;
  },
  isAllowedEmail: (email: string | null | undefined) => email === "owner@example.invalid",
}));
vi.mock("@/fourdb/adapters/postgres/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/fourdb/adapters/postgres/db")>()),
  personalWorkspace: async () => "00000000-0000-4000-8000-000000000001",
}));

const { fourdbUsable, readJson, requireScope } = await import("./fourdb");

const LOCAL_URL = "postgres://fourdb_app_local@localhost:55432/fourdb_dev";
const REMOTE_URL = "postgres://app@db.example.invalid:5432/fourdb";

beforeEach(() => {
  state.bypassed = false;
  state.authed = true;
  state.session = null;
});
afterEach(() => vi.unstubAllEnvs());

/** fourdbUsable と requireScope が同じ答えか(requireScope が Scope を返すなら使える、401・403・503 なら使えない) */
async function both() {
  const usable = await fourdbUsable();
  const scope = await requireScope();
  expect(usable, `fourdbUsable=${usable}, requireScope=${scope instanceof Response ? scope.status : "scope"}`).toBe(!(scope instanceof Response));
  return { usable, scope };
}

describe("fourdbUsable(画面の枠が、アカウント向けの API を使うか決める。requireScope と同じ条件)", () => {
  it("ログインなしの開発サーバー(ログインの設定なし)で、データベースは設定されているが FOURDB_LOCAL_DEV がない: 使えない(API は 401)", async () => {
    state.bypassed = true;
    state.authed = false;
    vi.stubEnv("FOURDB_DATABASE_URL", LOCAL_URL);
    vi.stubEnv("FOURDB_LOCAL_DEV", "");
    const { usable, scope } = await both();
    expect(usable).toBe(false);
    expect((scope as Response).status).toBe(401);
  });

  it("ログインなしの開発サーバーで、FOURDB_LOCAL_DEV=1 と手元のデータベース: 使える(local-dev)", async () => {
    state.bypassed = true;
    state.authed = false;
    vi.stubEnv("FOURDB_DATABASE_URL", LOCAL_URL);
    vi.stubEnv("FOURDB_LOCAL_DEV", "1");
    const { usable, scope } = await both();
    expect(usable).toBe(true);
    expect(scope).toMatchObject({ principal: "local-dev" });
  });

  it("ログインなしの開発用の利用者が、手元でないデータベース: 使えない(API は 403)", async () => {
    state.bypassed = true;
    state.authed = false;
    vi.stubEnv("FOURDB_DATABASE_URL", REMOTE_URL);
    vi.stubEnv("FOURDB_LOCAL_DEV", "1");
    const { usable, scope } = await both();
    expect(usable).toBe(false);
    expect((scope as Response).status).toBe(403);
  });

  it("データベースが設定されていない: 使えない(API は 503)。ログインなしの開発用でも、ログイン済みでも", async () => {
    vi.stubEnv("FOURDB_DATABASE_URL", "");
    state.bypassed = true;
    state.authed = false;
    vi.stubEnv("FOURDB_LOCAL_DEV", "1");
    let r = await both();
    expect(r.usable).toBe(false);
    expect((r.scope as Response).status).toBe(503);
    state.bypassed = false;
    state.authed = true;
    state.session = { user: { id: "u-owner", email: "owner@example.invalid" } };
    r = await both();
    expect(r.usable).toBe(false);
    expect((r.scope as Response).status).toBe(503);
  });

  it("ログインする設定で、ログインしていない・見てよい人でない: 使えない(API は 401)", async () => {
    vi.stubEnv("FOURDB_DATABASE_URL", REMOTE_URL);
    state.session = null;
    let r = await both();
    expect(r.usable).toBe(false);
    expect((r.scope as Response).status).toBe(401);
    state.session = { user: { id: "u-other", email: "other@example.invalid" } };
    r = await both();
    expect(r.usable).toBe(false);
    expect((r.scope as Response).status).toBe(401);
  });

  it("ログインする設定で、見てよい人とデータベースの設定がある: 使える(手元でないデータベースでもよい)", async () => {
    vi.stubEnv("FOURDB_DATABASE_URL", REMOTE_URL);
    state.session = { user: { id: "u-owner", email: "owner@example.invalid" } };
    const { usable, scope } = await both();
    expect(usable).toBe(true);
    expect(scope).toMatchObject({ principal: "neon:u-owner" });
  });

  it("ログインの設定がなく本番ビルド(開発用の利用者もなし): 使えない", async () => {
    state.bypassed = false;
    state.authed = false;
    vi.stubEnv("FOURDB_DATABASE_URL", LOCAL_URL);
    vi.stubEnv("FOURDB_LOCAL_DEV", "1");
    const { usable, scope } = await both();
    expect(usable).toBe(false);
    expect((scope as Response).status).toBe(401);
  });
});

describe("readJson", () => {
  const req = (body: BodyInit | null, headers: Record<string, string> = {}) =>
    new Request("http://localhost/api/4db/prefs", { method: "PUT", body, headers });

  it("{ … } の形の JSON を読む", async () => {
    expect(await readJson(req('{"theme":"dark"}'))).toEqual({ theme: "dark" });
  });

  it("本文がない・JSON でない・{ … } の形でない(配列・文字・数・null)は null", async () => {
    for (const body of [null, "", "not json", "[1]", '"x"', "12", "null"]) {
      expect(await readJson(req(body)), String(body)).toBeNull();
    }
  });

  it("上限を超える本文は null(content-length があるとき・ないとき)", async () => {
    expect(await readJson(req('{"a":"' + "x".repeat(100) + '"}'), 50)).toBeNull();
    expect(await readJson(req("{}", { "content-length": "9999" }), 50)).toBeNull();
    expect(await readJson(req('{"a":1}'), 50)).toEqual({ a: 1 });
  });

  it("本文がすでに読まれている(使用済み)なら、throw せず null(呼び手は 400 を返す)", async () => {
    const r = req('{"theme":"dark"}');
    await r.text();
    expect(r.bodyUsed).toBe(true);
    await expect(readJson(r)).resolves.toBeNull();
  });

  it("本文の読み取り(getReader)が throw しても null", async () => {
    const r = req('{"theme":"dark"}');
    r.body!.getReader(); // 先に読み手を取ってロックする
    await expect(readJson(r)).resolves.toBeNull();
  });
});
