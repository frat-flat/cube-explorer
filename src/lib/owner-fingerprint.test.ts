import { afterEach, describe, expect, it, vi } from "vitest";
import { isOwnerFingerprint } from "@/fourdb/core/prefs";
import { ownerFingerprint, ownerMatches } from "./owner-fingerprint";

// 設定の送り先のアカウントを取り違えないための指紋(L-4)。合成の principal と合成の秘密だけを使う(本物のユーザー ID・秘密は使わない)。
const SECRET_A = "test-secret-a-0123456789abcdef0123456789abcdef";
const SECRET_B = "test-secret-b-0123456789abcdef0123456789abcdef";
const USER_1 = "neon:11111111-1111-4111-8111-111111111111";
const USER_2 = "neon:22222222-2222-4222-8222-222222222222";

afterEach(() => vi.unstubAllEnvs());

describe("ownerFingerprint", () => {
  it("22 文字の base64url(芯の isOwnerFingerprint を通る)。同じ秘密・同じ principal なら、いつも同じ", () => {
    vi.stubEnv("NEON_AUTH_COOKIE_SECRET", SECRET_A);
    const fp = ownerFingerprint(USER_1);
    expect(isOwnerFingerprint(fp)).toBe(true);
    expect(ownerFingerprint(USER_1)).toBe(fp);
  });

  it("principal が違えば違う指紋。秘密が違えば、同じ principal でも違う指紋", () => {
    vi.stubEnv("NEON_AUTH_COOKIE_SECRET", SECRET_A);
    const a1 = ownerFingerprint(USER_1);
    const a2 = ownerFingerprint(USER_2);
    expect(a1).not.toBe(a2);
    vi.stubEnv("NEON_AUTH_COOKIE_SECRET", SECRET_B);
    expect(ownerFingerprint(USER_1)).not.toBe(a1);
  });

  it("指紋に principal・ユーザー ID・秘密は含まれない(一方向の値)", () => {
    vi.stubEnv("NEON_AUTH_COOKIE_SECRET", SECRET_A);
    const fp = ownerFingerprint(USER_1);
    const uuid = USER_1.slice("neon:".length);
    for (const leak of [USER_1, uuid, uuid.replaceAll("-", ""), Buffer.from(USER_1).toString("base64url"), SECRET_A, "neon", "local-dev"]) expect(fp).not.toContain(leak);
    // 鍵つきなので、秘密を知らない人が principal を当てはめて作った素の SHA-256 とも一致しない
    expect(fp).not.toBe(Buffer.from(USER_1).toString("base64url").slice(0, 22));
  });

  it("似た principal(前後の空白・大文字小文字・先頭の違い)は、それぞれ別の指紋", () => {
    vi.stubEnv("NEON_AUTH_COOKIE_SECRET", SECRET_A);
    const set = new Set([USER_1, `${USER_1} `, ` ${USER_1}`, USER_1.toUpperCase(), USER_1.slice(5), `x${USER_1}`, "local-dev", ""].map(ownerFingerprint));
    expect(set.size).toBe(8);
  });

  it("秘密がないとき(ログインの設定のない手元の開発): 決まった鍵で計算できる(local-dev が使う)。本番ビルドでは止まる", () => {
    vi.stubEnv("NEON_AUTH_COOKIE_SECRET", "");
    vi.stubEnv("NODE_ENV", "development");
    const fp = ownerFingerprint("local-dev");
    expect(isOwnerFingerprint(fp)).toBe(true);
    expect(ownerFingerprint("local-dev")).toBe(fp);
    vi.stubEnv("NODE_ENV", "production");
    expect(() => ownerFingerprint("local-dev")).toThrow(/NEON_AUTH_COOKIE_SECRET/);
    // 秘密があれば、本番でも計算できる(決まった鍵とは別の値)
    vi.stubEnv("NEON_AUTH_COOKIE_SECRET", SECRET_A);
    expect(ownerFingerprint("local-dev")).not.toBe(fp);
  });
});

describe("ownerMatches(PUT で届いた指紋が、いまのログインのアカウントのものか)", () => {
  it("同じアカウントの指紋なら true、別のアカウントの指紋なら false", () => {
    vi.stubEnv("NEON_AUTH_COOKIE_SECRET", SECRET_A);
    expect(ownerMatches(USER_1, ownerFingerprint(USER_1))).toBe(true);
    expect(ownerMatches(USER_1, ownerFingerprint(USER_2))).toBe(false);
    expect(ownerMatches(USER_2, ownerFingerprint(USER_1))).toBe(false);
  });

  it("秘密を替えたあとは、替える前の指紋は通らない(開いたままの画面は 409 で断られ、読み込み直す)", () => {
    vi.stubEnv("NEON_AUTH_COOKIE_SECRET", SECRET_A);
    const before = ownerFingerprint(USER_1);
    vi.stubEnv("NEON_AUTH_COOKIE_SECRET", SECRET_B);
    expect(ownerMatches(USER_1, before)).toBe(false);
    expect(ownerMatches(USER_1, ownerFingerprint(USER_1))).toBe(true);
  });

  it("指紋がない・空・形の違うもの・長さの違うもの・前後に余計な文字がついたものは false(指紋のない要求は通さない)", () => {
    vi.stubEnv("NEON_AUTH_COOKIE_SECRET", SECRET_A);
    const fp = ownerFingerprint(USER_1);
    for (const bad of [null, "", "short", `${fp}x`, fp.slice(1), ` ${fp}`, `${fp} `, `${fp}\n`, fp.toLowerCase() === fp ? fp.toUpperCase() : fp.toLowerCase(), "A".repeat(22), "!".repeat(22)]) {
      expect(ownerMatches(USER_1, bad), String(bad)).toBe(false);
    }
  });
});
