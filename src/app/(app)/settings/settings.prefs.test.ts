// 設定の「画面の見た目」と「World」: 文言・選択肢・Provider を通した状態の出方。
// 決まった状態の入れ物(PrefsStore)を渡して静的に描き、文字を確かめる(外へは何も通信しない)。
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PrefsContext, PrefsProvider } from "../PrefsProvider";
import type { Theme } from "@/fourdb/core/prefs";
import { PrefsStore, type StoreDeps } from "../prefs-sync";
import { ThemeSetting } from "./ThemeSetting";
import { WorldSetting } from "./WorldSetting";

const deps: StoreDeps = {
  load: () => Promise.reject(new Error("not used")),
  put: () => Promise.resolve("ok"),
  readStored: () => ({}),
  writeStored: () => {},
  readCookieTheme: () => null,
  applyTheme: () => {},
};
// PrefsProvider は children が必須の型なので、createElement の第 3 引数ではなく props で渡す(.ts の試験で JSX を使わないため)
// eslint-disable-next-line react/no-children-prop
const provided = (initialTheme: Theme | null, children: ReactElement) => createElement(PrefsProvider, { initialTheme, enabled: true, children });
const withStore = (store: PrefsStore, child: ReactElement) => createElement(PrefsContext.Provider, { value: store }, child);

describe("画面の見た目(ThemeSetting)", () => {
  it("3 つの選択(暗い・明るい・パソコンの設定に合わせる)と、アカウントに覚える説明", () => {
    const html = renderToStaticMarkup(provided(null, createElement(ThemeSetting)));
    expect(html).toContain("画面の見た目");
    expect(html).toContain('role="radiogroup"');
    expect(html.match(/type="radio"/g)?.length).toBe(3);
    for (const label of ["暗い", "明るい", "パソコンの設定に合わせる"]) expect(html).toContain(label);
    expect(html).toContain("選んだものは、アカウントに覚えます(どのパソコンでも同じになります)。");
    expect(html).not.toContain("このブラウザに覚えます。");
  });

  it("最初に選ばれているのは、サーバーが渡した明暗(クッキー)。なければ「合わせる」", () => {
    const checkedValue = (html: string) => /<input[^>]*value="(dark|light|auto)"[^>]*checked=""|<input[^>]*checked=""[^>]*value="(dark|light|auto)"/.exec(html)?.slice(1).find(Boolean);
    const render = (initialTheme: "dark" | "light" | null) =>
      renderToStaticMarkup(provided(initialTheme, createElement(ThemeSetting)));
    expect(checkedValue(render("dark"))).toBe("dark");
    expect(checkedValue(render("light"))).toBe("light");
    expect(checkedValue(render(null))).toBe("auto");
  });

  it("DB があって異常がなければ、保存の注意は出さない", () => {
    const html = renderToStaticMarkup(provided("dark", createElement(ThemeSetting)));
    expect(html).not.toContain("アカウントに保存できませんでした");
    expect(html).not.toContain("いまはこのパソコンにだけ");
  });

  it("保存に失敗したとき(error): 「アカウントに保存できませんでした。このブラウザには覚えています。」を role=alert で出す", async () => {
    const store = new PrefsStore({ ...deps, put: () => Promise.resolve("error") }, { enabled: true, initialTheme: null });
    store.start();
    await new Promise((r) => setTimeout(r, 0));
    // 突き合わせは読めなかった扱いで進む(load が reject)。そのあと変えて、送れなかった状態にする
    store.setTheme("dark");
    await new Promise((r) => setTimeout(r, 0));
    expect(store.getSnapshot().saveState).toBe("error");
    // 静的に描くとき React は getServerSnapshot を使う(最初の状態)。いまの状態で描くために、いまの状態を返させる
    store.getServerSnapshot = () => store.getSnapshot();
    const html = renderToStaticMarkup(withStore(store, createElement(ThemeSetting)));
    expect(html).toMatch(/<p class="error" role="alert">アカウントに保存できませんでした。このブラウザには覚えています。<\/p>/);
  });

  it("保存できない(DB がない・表がまだない)ときは、このパソコンにだけ覚える旨を出す", () => {
    const store = new PrefsStore(deps, { enabled: false, initialTheme: null });
    const html = renderToStaticMarkup(withStore(store, createElement(ThemeSetting)));
    expect(html).toContain("いまはこのパソコンにだけ覚えます(アカウントへの保存は準備中です)");
  });

  it("Provider がなくても描ける(クッキーだけの動き)", () => {
    const html = renderToStaticMarkup(createElement(ThemeSetting));
    expect(html).toContain("画面の見た目");
  });
});

describe("World(WorldSetting)", () => {
  it("見出し「World」に添え書き「まわりの世界」。ラジオのグループに「無地」だけ(選ばれている)。あとで増える旨の説明", () => {
    const html = renderToStaticMarkup(provided(null, createElement(WorldSetting)));
    expect(html).toMatch(/<h2[^>]*>World <span class="muted">まわりの世界<\/span><\/h2>/);
    expect(html).toContain('role="radiogroup"');
    expect(html.match(/type="radio"/g)?.length).toBe(1);
    expect(html).toContain("無地");
    expect(html).toMatch(/<input[^>]*checked=""/);
    expect(html).toContain('value="plain"');
    expect(html).toContain("ほかの世界は、あとで選べるようになります。");
  });

  it("グループの名前は見出しから付く(aria-labelledby)", () => {
    const html = renderToStaticMarkup(createElement(WorldSetting));
    expect(html).toMatch(/id="world-heading"/);
    expect(html).toMatch(/role="radiogroup" aria-labelledby="world-heading"|aria-labelledby="world-heading" role="radiogroup"/);
  });
});
