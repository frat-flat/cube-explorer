// 枠のメニュー(AppShell): Task の件数の印と、メニューの並び。next/navigation は差し替える。外へは何も通信しない(tasksEnabled = false)。
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const path = vi.hoisted(() => ({ value: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => path.value }));

import { AppNav, CountBadge } from "./AppShell";

describe("CountBadge(Task の件数の印)", () => {
  it("1 件以上で出す。読み上げは「N 件」(aria-label)", () => {
    const html = renderToStaticMarkup(createElement(CountBadge, { count: 3 }));
    expect(html).toContain('aria-label="3 件"');
    expect(html).toContain('role="img"');
    expect(html).toMatch(/>3<\/span>/);
    expect(html).toContain('class="nvbadge"');
  });

  it("0 のときは出さない", () => {
    expect(renderToStaticMarkup(createElement(CountBadge, { count: 0 }))).toBe("");
  });

  it("100 件以上は見た目だけ 99+。読み上げは本当の数", () => {
    const html = renderToStaticMarkup(createElement(CountBadge, { count: 120 }));
    expect(html).toContain('aria-label="120 件"');
    expect(html).toMatch(/>99\+<\/span>/);
  });
});

describe("AppNav(左のメニュー)", () => {
  const render = (tasksEnabled: boolean) => renderToStaticMarkup(createElement(AppNav, { tasksEnabled }));

  it("並び: ホーム / Task / 取り込む › Import / 見る › Table / 履歴 / 設定", () => {
    const html = render(false);
    const at = ["ホーム", "Task", "取り込む", "Import", "見る", "Table", "履歴", "設定"].map((w) => html.indexOf(w));
    expect(at.every((n) => n >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(html).toContain('href="/tasks"');
  });

  it("読み込み前(件数 0)は、印を出さない。DB がない(tasksEnabled = false)ときも出さない", () => {
    expect(render(false)).not.toContain("nvbadge");
    expect(render(true)).not.toContain("nvbadge");
  });

  it("いまの画面 /tasks には aria-current=page が付く", () => {
    path.value = "/tasks";
    const html = render(false);
    expect(html).toMatch(/<a[^>]*href="\/tasks"[^>]*aria-current="page"|<a[^>]*aria-current="page"[^>]*href="\/tasks"/);
    expect(html.match(/aria-current="page"/g)?.length).toBe(1);
    path.value = "/";
  });
});
