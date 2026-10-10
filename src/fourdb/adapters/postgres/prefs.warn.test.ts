// アカウントの設定(prefs.ts)が「表がない・権限がない」を見つけたときの記録(console.warn)の確かめ。データベースにはつながない。
// 決まり: 出すのは番号(SQLSTATE)だけ(エラーのメッセージ・SQL・値は出さない)。同じ番号はプロセスで 1 度だけ(要求のたびに確かめ直しても増やさない)。
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

const fake = vi.hoisted(() => ({
  probe: { present: true, allowed: true },
  readError: null as unknown,
}));
vi.mock("./db", () => ({
  /** 本物の withScope の代わり。tx は、SQL の文の中身で答えを返す作り物 */
  withScope: async (_scope: unknown, fn: (tx: unknown) => Promise<unknown>) => {
    const tx = async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      if (sql.includes("set_config")) return [{ set_config: "5s" }];
      if (sql.includes("pg_namespace")) return [fake.probe];
      if (sql.includes("fourdb.principal_pref p")) {
        if (fake.readError) throw fake.readError;
        return [];
      }
      throw new Error("この試験で想定していない SQL");
    };
    return fn(tx);
  },
}));

const { forgetPrefsAvailability, getPrefs, putPrefs, PrefsUnavailable, resetPrefsWarnings } = await import("./prefs");

const scope = { principal: "test:alice", workspaceId: null };
let warn: MockInstance<typeof console.warn>;

beforeEach(() => {
  fake.probe = { present: true, allowed: true };
  fake.readError = null;
  forgetPrefsAvailability();
  resetPrefsWarnings();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

/** 実際に出した引数を、文字にして返す(メッセージ・SQL・値が混じっていないことを見る) */
const printed = () => JSON.stringify(warn.mock.calls);

describe("設定の表が使えないときの記録(I-9)", () => {
  it("使える: 何も残さない", async () => {
    expect(await getPrefs(scope)).toMatchObject({ available: true, saved: false });
    expect(warn).not.toHaveBeenCalled();
  });

  it("確かめで表がない: 番号 42P01 だけを 1 度残す。そのあと何度 GET・PUT しても増えない", async () => {
    fake.probe = { present: false, allowed: false };
    for (let i = 0; i < 3; i++) expect(await getPrefs(scope)).toMatchObject({ available: false });
    await expect(putPrefs(scope, { theme: "dark" })).rejects.toBeInstanceOf(PrefsUnavailable);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][1]).toEqual({ code: "42P01" });
  });

  it("確かめで権限がない: 番号 42501 だけを 1 度残す", async () => {
    fake.probe = { present: true, allowed: false };
    for (let i = 0; i < 3; i++) expect(await getPrefs(scope)).toMatchObject({ available: false });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][1]).toEqual({ code: "42501" });
  });

  it("読み書きが 42P01・42501・3F000 で止まった: その番号だけを残す。エラーのメッセージ・SQL・値は出さない", async () => {
    for (const code of ["42P01", "42501", "3F000"]) {
      resetPrefsWarnings();
      warn.mockClear();
      forgetPrefsAvailability();
      fake.readError = Object.assign(new Error(`relation "fourdb.principal_pref" does not exist; select p.theme from fourdb.principal_pref where principal = 'test:alice'`), { code });
      expect(await getPrefs(scope), code).toMatchObject({ available: false, saved: false });
      expect(warn, code).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][1]).toEqual({ code });
      expect(printed()).not.toMatch(/select|does not exist|test:alice|principal_pref/i);
    }
  });

  it("同じ番号は、止まるたびには残さない(プロセスで 1 度)。別の番号は残す", async () => {
    fake.readError = Object.assign(new Error("x"), { code: "42501" });
    await getPrefs(scope);
    forgetPrefsAvailability();
    await getPrefs(scope);
    forgetPrefsAvailability();
    await getPrefs(scope);
    expect(warn).toHaveBeenCalledTimes(1);
    fake.readError = Object.assign(new Error("x"), { code: "42P01" });
    forgetPrefsAvailability();
    await getPrefs(scope);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls.map((c) => (c[1] as { code: string }).code)).toEqual(["42501", "42P01"]);
  });

  it("「使えない」以外の故障(例: 57014 時間切れ)は、そのまま投げ、この記録は残さない", async () => {
    fake.readError = Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" });
    await expect(getPrefs(scope)).rejects.toMatchObject({ code: "57014" });
    expect(warn).not.toHaveBeenCalled();
  });
});
