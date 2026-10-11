import { describe, expect, it } from "vitest";
import { isOwnerFingerprint, OWNER_HEADER, OWNER_MISMATCH_CODE } from "./owner";

describe("アカウントの指紋(owner)の形と運び方", () => {
  it("ヘッダー名と、409 の code は決めたとおり(画面とサーバーが同じ値を使う)", () => {
    expect(OWNER_HEADER).toBe("x-4db-owner");
    expect(OWNER_MISMATCH_CODE).toBe("owner_mismatch");
  });

  it("指紋は base64url の 22 文字だけ", () => {
    for (const ok of ["AAAAAAAAAAAAAAAAAAAAAA", "abcdefghijklmnopqrstuv", "0123456789_-ABCDEFGHIJ", "-_-_-_-_-_-_-_-_-_-_-_"]) expect(isOwnerFingerprint(ok), ok).toBe(true);
  });

  it("長さの違うもの・使えない文字・文字でないものは指紋ではない", () => {
    for (const bad of [
      "",
      "short",
      "A".repeat(21),
      "A".repeat(23),
      `${"A".repeat(21)}=`, // padding は付けない形
      `${"A".repeat(21)}+`,
      `${"A".repeat(21)}/`,
      `${"A".repeat(21)} `,
      ` ${"A".repeat(21)}`,
      `${"A".repeat(21)}\n`,
      `${"A".repeat(21)}あ`,
      null,
      undefined,
      22,
      {},
      ["AAAAAAAAAAAAAAAAAAAAAA"],
    ]) {
      expect(isOwnerFingerprint(bad), String(bad)).toBe(false);
    }
  });
});
