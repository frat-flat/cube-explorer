// ログアウトのフォーム(LogoutForm)。枠の帯と設定の画面が同じものを使う。
// 決まり: POST で /auth/signout へ送る / 送る直前に、この端末に残した「送っていない設定の変更」(localStorage)を消す / 明暗のクッキーは残す。
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PATTERNS } from "@/fourdb/core/prefs";
import { LogoutForm } from "./LogoutForm";
import { PENDING_KEY } from "./prefs-sync";

afterEach(() => vi.unstubAllGlobals());

function fakeStorage(init: Record<string, string> = {}) {
  const data = new Map(Object.entries(init));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

describe("LogoutForm", () => {
  it("POST で /auth/signout へ送るフォームと「ログアウト」のボタン。クラスは渡したものがそのまま付く", () => {
    const html = renderToStaticMarkup(createElement(LogoutForm, { className: "signout", buttonClassName: "out" }));
    expect(html).toMatch(/^<form [^>]*class="signout"[^>]*>/);
    expect(html).toContain('action="/auth/signout"');
    expect(html).toContain('method="post"');
    expect(html).toContain('<button type="submit" class="out">ログアウト</button>');
    // 設定の画面のように、ボタンにクラスを付けないとき
    const plain = renderToStaticMarkup(createElement(LogoutForm, { className: "logout" }));
    expect(plain).toMatch(/^<form [^>]*class="logout"[^>]*>/);
    expect(plain).toContain('<button type="submit">ログアウト</button>');
  });

  it("送る前(submit)に、送っていない設定の変更を消す。送るのは止めない(preventDefault しない)。ほかのキーと明暗のクッキーは残す", () => {
    const ls = fakeStorage({ [PENDING_KEY]: JSON.stringify({ theme: "dark", look: PATTERNS[1].look }), other: "x" });
    const doc = { cookie: "fourdb_theme=dark" };
    vi.stubGlobal("window", { localStorage: ls });
    vi.stubGlobal("document", doc);
    const form = LogoutForm({ className: "signout" }) as ReactElement<{ onSubmit: (e: unknown) => void; action: string; method: string }>;
    expect(form.type).toBe("form");
    expect(form.props).toMatchObject({ action: "/auth/signout", method: "post" });
    const event = { preventDefault: vi.fn() };
    expect(ls.data.has(PENDING_KEY)).toBe(true); // 送る前は残っている
    form.props.onSubmit(event);
    expect(ls.data.has(PENDING_KEY)).toBe(false);
    expect(ls.data.get("other")).toBe("x");
    expect(doc.cookie).toBe("fourdb_theme=dark");
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("localStorage が使えなくても、送る操作は落ちない", () => {
    const boom = () => {
      throw new Error("denied");
    };
    vi.stubGlobal("window", { localStorage: { getItem: boom, setItem: boom, removeItem: boom } });
    const form = LogoutForm({}) as ReactElement<{ onSubmit: (e: unknown) => void }>;
    expect(() => form.props.onSubmit({ preventDefault: vi.fn() })).not.toThrow();
  });
});
