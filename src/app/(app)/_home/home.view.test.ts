// ホーム(/)の画面の部品: 文言・欄の並びと「—」・ƒ の読み上げ・Table のリンク・右の欄・平らなタイル・Visual の欄。
// 読み込み済みのデータを描くだけの部品なので、静的に描いて文字を確かめる(外へは何も通信しない。立体は作らない)。
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SECTION_IDS, type HomeUnit, type Listed, type UnitRef } from "@/fourdb/core/home";
import { DEFAULT_LOOK, PATTERNS, type Look } from "@/fourdb/core/prefs";
import { BoxPanel } from "./BoxPanel";
import { FlatTiles } from "./FlatTiles";
import { HomeStage } from "./HomeStage";
import { Sections } from "./Sections";
import { currentPatternText, labelNoteText, saveMessage, splitNumbers, tableHref } from "./view";
import { VisualPanel, type VisualPanelProps } from "./VisualPanel";

const empty = (over: Partial<HomeUnit> = {}): HomeUnit => ({
  key: "u:法人",
  unitType: "法人",
  count: 3,
  names: { items: ["A社", "B社", "C社"], more: 0 },
  inside: null,
  cardFields: null,
  measures: null,
  period: null,
  sheets: null,
  tables: null,
  ...over,
});
const full = empty({
  key: "u:店舗",
  unitType: "店舗",
  count: 48,
  names: { items: ["A社 楽天店舗", "A社 Yahoo店舗", "B社 楽天店舗", "B社 Yahoo店舗", "C社 楽天店舗"], more: 43 },
  inside: { items: [{ unitType: "担当者", count: 12 }, { unitType: null, count: 2 }], more: 0 },
  cardFields: { items: ["店舗名", "地域", "開店日"], more: 0 },
  measures: { items: [{ name: "売上", calculated: false }, { name: "粗利率", calculated: true }], more: 2 },
  period: { from: "2025-10", to: "2026-09" },
  // 2026-10-10 00:30 日本時間 = 2026-10-09 15:30 UTC(日付は日本時間で出す)
  sheets: { items: [{ sheetId: "s1", file: "店舗マスタ", sheet: "店舗" }], more: 2, lastReadAt: "2026-10-09T15:30:00Z" },
  tables: { items: [{ id: "0b6c1d2e-0000-4000-8000-000000000001", name: "店舗 × 月の売上合計" }], more: 0 },
});
const render = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el);
const sectionOrder = (html: string) => [...html.matchAll(/data-section="([a-zA-Z]+)"/g)].map((m) => m[1]);
const text = (html: string) => html.replace(/<[^>]+>/g, "");

describe("view: 文言と表示の決まり", () => {
  it("保存の状態の文(idle は出さない)", () => {
    expect(saveMessage("idle")).toBe("");
    expect(saveMessage("saving")).toBe("保存しています…");
    expect(saveMessage("saved")).toBe("アカウントに保存しました");
    expect(saveMessage("error")).toBe("保存できませんでした。もう一度試してください");
    expect(saveMessage("local")).toBe("いまはこのパソコンにだけ覚えます(アカウントへの保存は準備中です)");
  });

  it("札を台の下に出したときの説明(正面がない台座の名前を入れる・小さすぎる・指定どおりは空)", () => {
    expect(labelNoteText("no-face", "ring")).toBe("光の輪には正面がないため、札は台の下に出しています");
    expect(labelNoteText("no-face", "disc")).toBe("床の円盤には正面がないため、札は台の下に出しています");
    expect(labelNoteText("too-small", "dish")).toBe("正面の文字が小さすぎるため、札は台の下に出しています");
    expect(labelNoteText("", "stone")).toBe("");
  });

  it("いまのパターンの呼び名。当たらなければ「組み合わせ」", () => {
    expect(currentPatternText({ ...DEFAULT_LOOK })).toBe("パターン 3「ロゴの宇宙」");
    expect(currentPatternText({ ...PATTERNS[6].look })).toBe("パターン 7「くぼみの台」");
    expect(currentPatternText({ ...PATTERNS[7].look })).toBe("パターン 8「くぼみの台 + 帯」");
    expect(currentPatternText({ ...DEFAULT_LOOK, layout: "row" })).toBe("組み合わせ");
  });

  it("数字の部分を分ける(Montserrat で出す所)", () => {
    expect(splitNumbers("A社 2026年度")).toEqual([
      { text: "A社 ", n: false },
      { text: "2026", n: true },
      { text: "年度", n: false },
    ]);
    expect(splitNumbers("A-001")).toEqual([
      { text: "A-", n: false },
      { text: "001", n: true },
    ]);
    expect(splitNumbers("1,200")).toEqual([{ text: "1,200", n: true }]);
    expect(splitNumbers("")).toEqual([]);
  });

  it("Table のリンク先は /table?def=<id>(id は URL の形にして入れる)", () => {
    expect(tableHref("0b6c1d2e-0000-4000-8000-000000000001")).toBe("/table?def=0b6c1d2e-0000-4000-8000-000000000001");
    expect(tableHref("a&b")).toBe("/table?def=a%26b");
  });
});

describe("Sections: 欄の並びと中身", () => {
  it("9 つの欄を固定の順で出す。値がない欄は「—」(欄そのものは省かない)", () => {
    const html = render(createElement(Sections, { unit: empty() }));
    expect(sectionOrder(html)).toEqual([...SECTION_IDS]);
    for (const label of ["名前", "中に", "Card の項目", "数値", "期間", "元のシート", "Table", "Cube", "数字の帯"]) expect(html).toContain(`>${label}</dt>`);
    // 名前のほかの 6 つ(中に・Card の項目・数値・期間・元のシート・Table)が「—」
    expect(html.match(/>—</g)?.length).toBe(6);
    expect(html).toContain("【P8】");
    expect(html).toContain("【P11】");
  });

  it("名前は 5 つと「ほか N」。中に・Card の項目は「・」で区切る", () => {
    const t = text(render(createElement(Sections, { unit: full })));
    expect(t).toContain("A社 楽天店舗・A社 Yahoo店舗・B社 楽天店舗・B社 Yahoo店舗・C社 楽天店舗 ほか 43");
    expect(t).toContain("担当者 12・(単位なし) 2");
    expect(t).toContain("店舗名・地域・開店日");
  });

  it("計算された値には ƒ を付け、「計算された値」と読み上げる", () => {
    const html = render(createElement(Sections, { unit: full }));
    expect(html).toContain('role="img" aria-label="計算された値">ƒ</span>');
    expect(html.match(/ƒ/g)?.length).toBe(1);
    expect(text(html)).toContain("売上・粗利率ƒ ほか 2");
  });

  it("期間は 2025-10〜2026-09。元のシートは ファイル › シート と、最後に取り込んだ日(年つき・日本時間)", () => {
    const t = text(render(createElement(Sections, { unit: full })));
    expect(t).toContain("2025-10〜2026-09");
    expect(t).toContain("店舗マスタ › 店舗 ほか 2");
    expect(t).toContain("最後に取り込んだ日 2026-10-10");
  });

  it("最後に取り込んだ日がなければ「—」", () => {
    const unit = empty({ sheets: { items: [{ sheetId: "s1", file: "法人台帳", sheet: "2025" }], more: 0, lastReadAt: null } });
    expect(text(render(createElement(Sections, { unit })))).toContain("最後に取り込んだ日 —");
  });

  it("Table は /table?def=<id> へのリンク", () => {
    const html = render(createElement(Sections, { unit: full }));
    expect(html).toContain('href="/table?def=0b6c1d2e-0000-4000-8000-000000000001"');
    expect(text(html)).toContain("店舗 × 月の売上合計 ›");
  });

  it("利用者の文字は文字として出す(HTML として読まない)", () => {
    const html = render(createElement(Sections, { unit: empty({ names: { items: ['<img src=x onerror="alert(1)">'], more: 0 } }) }));
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});

describe("BoxPanel: 右の欄", () => {
  it("閉じている間は inert。開くと見出し(名前と数)にフォーカスできる(tabindex=-1)", () => {
    const closed = render(createElement(BoxPanel, { unit: full, open: false, onClose: () => {} }));
    expect(closed).toMatch(/<aside id="box-panel"[^>]*aria-labelledby="box-panel-h"[^>]*inert=""/);
    const open = render(createElement(BoxPanel, { unit: full, open: true, onClose: () => {} }));
    expect(open).not.toContain('inert=""');
    expect(open).toMatch(/<h2 id="box-panel-h" tabindex="-1">/);
    expect(text(open)).toContain("店舗 48");
    expect(open).toContain('aria-label="閉じる"');
  });

  it("終わりに【P8】【P11】の説明。欄の並びは Sections と同じ", () => {
    const html = render(createElement(BoxPanel, { unit: full, open: true, onClose: () => {} }));
    expect(text(html)).toContain("【P8】【P11】は、その段階で使えるようになります。");
    expect(sectionOrder(html)).toEqual([...SECTION_IDS]);
  });
});

describe("FlatTiles: 3D を作れなかったとき", () => {
  const others: Listed<UnitRef> = { items: [{ unitType: "部署", count: 12 }, { unitType: null, count: 1 }], more: 3 };

  it("説明と、単位ごとのタイル(欄は全部)と、ほかの単位の行", () => {
    const html = render(createElement(FlatTiles, { units: [full, empty()], others }));
    expect(text(html)).toContain("3D を表示できなかったため、平らな一覧で表示しています。");
    expect(html.match(/<article/g)?.length).toBe(2);
    expect(sectionOrder(html)).toEqual([...SECTION_IDS, ...SECTION_IDS]);
    expect(text(html)).toContain("ほかの単位: 部署 12・(単位なし) 1 ほか 3");
  });

  it("ほかの単位がなければ、その行は出さない", () => {
    expect(text(render(createElement(FlatTiles, { units: [full], others: { items: [], more: 0 } })))).not.toContain("ほかの単位");
  });
});

describe("VisualPanel: 見た目の欄", () => {
  const props = (over: Partial<VisualPanelProps> = {}): VisualPanelProps => ({
    open: false,
    onToggle: () => {},
    onClose: () => {},
    look: { ...DEFAULT_LOOK },
    onLook: () => {},
    theme: "light",
    onTheme: () => {},
    saveState: "idle",
    onRetry: () => {},
    labelNote: "",
    ...over,
  });

  it("「Visual」ボタン(添え書き「見た目を変える」)。読み込んだときは閉じている", () => {
    const html = render(createElement(VisualPanel, props()));
    expect(html).toMatch(/<button type="button"[^>]*aria-expanded="false" aria-controls="visual-panel"/);
    expect(text(html)).toContain("Visual見た目を変える");
    expect(html).toMatch(/<section id="visual-panel"[^>]*hidden=""/);
  });

  it("開くと、見出し「Visual」+「見た目」、いまのパターン、閉じる", () => {
    const html = render(createElement(VisualPanel, props({ open: true })));
    expect(html).toMatch(/aria-expanded="true"/);
    expect(html).not.toMatch(/<section id="visual-panel"[^>]*hidden/);
    expect(html).toContain('<h2 id="visual-panel-h">Visual<small>見た目</small></h2>');
    expect(text(html)).toContain("パターン 3「ロゴの宇宙」");
    expect(html).toContain('aria-label="閉じる"');
  });

  it("パターン 8 つ(名前は仮)。いまのものだけ aria-pressed。どれにも当たらなければ「組み合わせ」", () => {
    const html = render(createElement(VisualPanel, props({ open: true })));
    expect(html.match(/<button[^>]*class="[^"]*"[^>]*aria-pressed="(true|false)" title=/g)?.length).toBe(8);
    expect(html).toMatch(/aria-pressed="true" title="ロゴの帯がまわりを回る Box を光の輪の上に浮かべ、弧に並べる"/);
    const custom: Look = { ...DEFAULT_LOOK, base: "dish" };
    const html2 = render(createElement(VisualPanel, props({ open: true, look: custom })));
    expect(html2).not.toMatch(/aria-pressed="true" title=/);
    expect(text(html2)).toContain("組み合わせ");
  });

  it("部品の切り替え(Box の形・向き・台座・札・背景・並べ方・明暗)。選んでいるものが aria-pressed", () => {
    const html = render(createElement(VisualPanel, props({ open: true, theme: "dark" })));
    for (const label of ["Box の形", "向き", "台座", "札", "背景", "並べ方", "明暗"]) expect(html).toContain(`>${label}</span>`);
    for (const pressed of ["帯つき", "面を下", "光の輪", "Box の上", "ロゴの線", "弧", "暗い"]) expect(html).toContain(`aria-pressed="true">${pressed}</button>`);
    for (const other of ["ガラス", "つや消し", "線と点", "角を下", "くぼみの台", "2 段の台", "石の台", "床の円盤", "台の下", "台の正面", "静か", "床の格子", "1 列", "ひな壇", "明るい"]) {
      expect(html).toContain(`aria-pressed="false">${other}</button>`);
    }
  });

  it("保存の状態を読み上げる。失敗したら「もう一度試す」", () => {
    const err = render(createElement(VisualPanel, props({ open: true, saveState: "error" })));
    expect(err).toContain("保存できませんでした。もう一度試してください");
    expect(err).toContain(">もう一度試す</button>");
    const local = render(createElement(VisualPanel, props({ open: true, saveState: "local" })));
    expect(local).toContain("いまはこのパソコンにだけ覚えます(アカウントへの保存は準備中です)");
    expect(local).not.toContain("もう一度試す");
    expect(local).toMatch(/<span role="status"[^>]*>いまはこのパソコンにだけ覚えます/);
  });

  it("札を台の下に出したときの説明を出す", () => {
    const html = render(createElement(VisualPanel, props({ open: true, labelNote: "光の輪には正面がないため、札は台の下に出しています" })));
    expect(html).toContain("光の輪には正面がないため、札は台の下に出しています");
  });
});

describe("HomeStage: 最初の描き(サーバー)", () => {
  it("読み上げの見出し「ホーム」と舞台の見出し、読み込み中(data-mode=loading)。立体はまだ作らない", () => {
    const html = render(createElement(HomeStage));
    expect(html).toContain(">ホーム</h1>");
    expect(html).toContain('data-mode="loading"');
    expect(text(html)).toContain("Boxいちばん上の Box を単位ごとに");
    expect(html).toContain("読み込んでいます…");
    expect(html).not.toContain("<canvas");
    expect(html).not.toContain("data-ready");
  });
});
