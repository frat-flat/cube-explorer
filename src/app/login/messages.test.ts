import { describe, expect, it } from "vitest";
import { sendFailureMessage, signInFailureMessage } from "./messages";

// L-1: 失敗の状態ごとに、原因に合う文を出す(サーバー側の失敗なのに「メールアドレスを確かめて」「コードが違う」と出さない)
describe("sendFailureMessage(コードの送信の失敗)", () => {
  it("通信できなかった(状態なし = 0)", () => {
    expect(sendFailureMessage(0)).toContain("通信できなかったようです");
  });
  it("429 は、しばらく待つ", () => {
    expect(sendFailureMessage(429)).toBe("コードを送れませんでした。しばらく待ってから、もう一度送ってください。");
  });
  it("500・502・503 など 500 以上は、サーバー側の問題。メールアドレスのせいにしない", () => {
    for (const status of [500, 502, 503, 504, 599]) {
      expect(sendFailureMessage(status), String(status)).toContain("サーバー側で問題が起きているようです");
      expect(sendFailureMessage(status), String(status)).not.toContain("メールアドレス");
    }
  });
  it("400・422 など(断られた)は、メールアドレスを確かめる", () => {
    for (const status of [400, 401, 403, 422]) expect(sendFailureMessage(status), String(status)).toContain("メールアドレスを確かめて");
  });
});

describe("signInFailureMessage(コードの確認の失敗)", () => {
  it("通信できなかった(状態なし = 0)", () => {
    expect(signInFailureMessage(0)).toContain("通信できなかったようです");
  });
  it("429 は、確認が多すぎる。コードが違うとは言わない", () => {
    expect(signInFailureMessage(429)).toContain("確認の回数が多すぎます");
    expect(signInFailureMessage(429)).not.toContain("コードが違う");
  });
  it("500・503 など 500 以上は、サーバー側の問題。コードが違うとは言わない", () => {
    for (const status of [500, 502, 503, 504]) {
      expect(signInFailureMessage(status), String(status)).toContain("サーバー側で問題が起きているようです");
      expect(signInFailureMessage(status), String(status)).not.toContain("コードが違う");
    }
  });
  it("400・401・403・422 など(断られた)は、コードが違うか期限切れ", () => {
    for (const status of [400, 401, 403, 422]) expect(signInFailureMessage(status), String(status)).toContain("コードが違うか、期限が切れています");
  });
});
