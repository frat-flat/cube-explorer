// QA(P2 の別担当): 設定の「アカウント」。ログインなしの開発用の利用者では「local-dev」しか出ないので、
// ログイン中のメール(本物のログインを模した値)が出ること・ログアウトが POST のフォームであること・ログインしていなければ /login へ送ることを、画面を描いて確かめる。
// 認証の部品(@/lib/auth)と next の関数は差し替える。外へは何も通信しない。合成のメールアドレス(example.invalid)だけを使う。
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const email = vi.hoisted(() => ({ value: null as string | null }));
const redirected = vi.hoisted(() => ({ to: null as string | null }));

vi.mock("@/lib/auth", () => ({ currentUserEmail: async () => email.value }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    redirected.to = to;
    throw new Error("NEXT_REDIRECT");
  },
}));

import SettingsPage from "./page";

beforeEach(() => {
  email.value = null;
  redirected.to = null;
});

describe("設定: アカウント", () => {
  it("ログイン中は、そのメールアドレスと、POST で /auth/signout へ送るログアウトが出る。画面の見た目も残っている", async () => {
    email.value = "owner@example.invalid";
    const html = renderToStaticMarkup(await SettingsPage());
    expect(html).toContain("アカウント");
    expect(html).toContain('data-testid="account-email"');
    expect(html).toContain("owner@example.invalid");
    expect(html).toMatch(/<form[^>]*action="\/auth\/signout"[^>]*method="post"|<form[^>]*method="post"[^>]*action="\/auth\/signout"/);
    expect(html).toContain("ログアウト");
    expect(html).toContain("画面の見た目");
    expect(redirected.to).toBeNull();
  });

  it("メールアドレスの中の記号は、そのまま文字として出る(タグとして解釈されない)", async () => {
    email.value = 'a<b>"x"@example.invalid';
    const html = renderToStaticMarkup(await SettingsPage());
    expect(html).not.toContain("<b>\"x\"");
    expect(html).toContain("a&lt;b&gt;&quot;x&quot;@example.invalid");
  });

  it("ログインしていない(または見てよい人でない)ときは、画面を描かずに /login へ送る", async () => {
    email.value = null;
    await expect(SettingsPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirected.to).toBe("/login");
  });
});
