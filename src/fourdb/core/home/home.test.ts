import { describe, expect, it } from "vitest";
import { listed } from "../listed";
import { HOME_LIMITS } from "./limits";
import { CALCULATED_LABEL, CALCULATED_MARK, NO_VALUE_MARK, PHASE_MARKS, SECTION_LABELS } from "./labels";
import { buildHomeOverview, EMPTY_UNIT_FACTS, orderColumns, orderSheets, type HomeFacts, type SheetFact, type UnitFacts } from "./overview";
import { formatPeriod } from "./period";
import { SECTION_IDS, sectionsOf } from "./sections";
import { matchTables, type TableCandidate } from "./tables";
import type { HomeUnit } from "./types";
import { compareUnits, NO_UNIT_LABEL, normalizeUnitType, orderUnitRefs, orderUnits, totalBoxes, unitKey, unitLabel, type UnitGroup } from "./units";

const G = (unitType: string | null, count: number, hasChildren = false): UnitGroup => ({ unitType, count, hasChildren });
const names = (gs: readonly UnitGroup[]) => gs.map((g) => g.unitType);

describe("上限の定数(D-017)", () => {
  it("単位 6・名前 5・ほかの単位 30・欄の並び 12・シート 3・Table 3・単位の種類 500・深さ 16・表の定義 500", () => {
    expect(HOME_LIMITS).toEqual({ units: 6, names: 5, others: 30, fields: 12, sheets: 3, tables: 3, unitTypes: 500, depth: 16, tableDefinitions: 500 });
  });
});

describe("単位の名前と目印", () => {
  it("unitLabel: 単位のない Box は「(単位なし)」('' も)", () => {
    expect(unitLabel("店舗")).toBe("店舗");
    expect(unitLabel(null)).toBe("(単位なし)");
    expect(unitLabel("")).toBe("(単位なし)");
    expect(NO_UNIT_LABEL).toBe("(単位なし)");
  });
  it("normalizeUnitType: '' と null と undefined は null。空白だけの文字は別の単位として残す", () => {
    expect(normalizeUnitType("")).toBeNull();
    expect(normalizeUnitType(null)).toBeNull();
    expect(normalizeUnitType(undefined)).toBeNull();
    expect(normalizeUnitType(" ")).toBe(" ");
    expect(normalizeUnitType("法人")).toBe("法人");
  });
  it("unitKey: u:<単位> か none。'' も none", () => {
    expect(unitKey("法人")).toBe("u:法人");
    expect(unitKey(null)).toBe("none");
    expect(unitKey("")).toBe("none");
    expect(unitKey("none")).toBe("u:none"); // 「none という名前の単位」と「単位なし」は別
    expect(unitKey("__proto__")).toBe("u:__proto__");
  });
});

describe("orderUnits: 規則 R の並べ方", () => {
  it("Box が 0 なら何もない", () => {
    expect(orderUnits([])).toEqual({ shown: [], others: { items: [], more: 0 } });
  });
  it("子のある単位 → 数の多い順 → 名前。単位なし(null)は名前の順の最後", () => {
    const o = orderUnits([G("商品", 860), G("店舗", 48), G("法人", 12, true), G(null, 3), G("地域", 9), G("代理店", 32), G("a", 9)]);
    // 法人(子あり) → 商品 860 → 店舗 48 → 代理店 32 → (地域 9 と a 9 は同数: 名前の順で a が先) → 単位なし 3
    expect(names(o.shown)).toEqual(["法人", "商品", "店舗", "代理店", "a", "地域"]);
    expect(o.others).toEqual({ items: [{ unitType: null, count: 3 }], more: 0 });
  });
  it("同じ数のとき、名前の順(UTF-16 の順。大文字が小文字より先)で、null は最後", () => {
    const o = orderUnits([G(null, 5), G("b", 5), G("B", 5), G("あ", 5), G("A", 5)]);
    expect(names(o.shown)).toEqual(["A", "B", "b", "あ", null]);
  });
  it("子のある単位は、数が少なくても、子のない単位より前(null も同じ)", () => {
    expect(names(orderUnits([G("店舗", 8000), G("法人", 500, true), G(null, 1, true)]).shown)).toEqual(["法人", null, "店舗"]);
  });
  it("'' は null と同じ単位。数を足し、子の有無はどちらかにあれば有り", () => {
    const o = orderUnits([G("", 2), G(null, 3, false), G("", 1, true), G("店舗", 4)]);
    expect(o.shown).toEqual([G(null, 6, true), G("店舗", 4)]);
  });
  it("同じ単位が何度来ても足し合わせる", () => {
    expect(orderUnits([G("店舗", 2), G("店舗", 3)]).shown).toEqual([G("店舗", 5)]);
  });
  it("数が 0 以下・数でない行は捨てる。小数は切り捨てる", () => {
    const o = orderUnits([G("a", 0), G("b", -3), G("c", Number.NaN), G("d", Number.POSITIVE_INFINITY), G("e", 2.9)]);
    expect(o.shown).toEqual([G("e", 2)]);
  });
  it("6 つまでを立体に、7 つ目からは「ほかの単位」(同じ並び)", () => {
    const six = Array.from({ length: 6 }, (_, i) => G(`u${i}`, 100 - i));
    expect(orderUnits(six).others).toEqual({ items: [], more: 0 });
    const seven = [...six, G("last", 1)];
    const o = orderUnits(seven);
    expect(o.shown).toHaveLength(6);
    expect(o.others).toEqual({ items: [{ unitType: "last", count: 1 }], more: 0 });
    expect(names(o.shown)).toEqual(["u0", "u1", "u2", "u3", "u4", "u5"]);
  });
  it("ほかの単位は 30 件まで、残りは more(単位の数)", () => {
    const many = Array.from({ length: 6 + 30 + 4 }, (_, i) => G(`u${String(i).padStart(3, "0")}`, 1000 - i));
    const o = orderUnits(many);
    expect(o.shown).toHaveLength(6);
    expect(o.others.items).toHaveLength(30);
    expect(o.others.more).toBe(4);
    expect(o.others.items[0]).toEqual({ unitType: "u006", count: 994 });
    // ちょうど 36 なら more は 0
    expect(orderUnits(many.slice(0, 36)).others.more).toBe(0);
    expect(orderUnits(many.slice(0, 37)).others.more).toBe(1);
  });
  it("ほかの単位の項目は unitType と count だけ(hasChildren は出さない)", () => {
    const o = orderUnits([...Array.from({ length: 6 }, (_, i) => G(`u${i}`, 50 - i)), G("x", 2, true)]);
    // 子のある x は並びの先頭になるので、6 つ目の u4 がほかへ回る
    expect(o.others.items).toEqual([{ unitType: "u5", count: 45 }]);
    expect(Object.keys(o.others.items[0]).sort()).toEqual(["count", "unitType"]);
  });
  it("入力の並びによらず同じ結果で、入力を書き換えない", () => {
    const base = [G("法人", 12, true), G("店舗", 48), G(null, 3), G("", 2), G("商品", 860), G("地域", 9), G("代理店", 32), G("部署", 12), G("担当者", 5)];
    const copy = JSON.parse(JSON.stringify(base)) as UnitGroup[];
    const expected = orderUnits(base);
    expect(base).toEqual(copy);
    const rotated = [...base.slice(3), ...base.slice(0, 3)];
    expect(orderUnits(rotated)).toEqual(expected);
    expect(orderUnits([...base].reverse())).toEqual(expected);
  });
  it("compareUnits は全順序(同じ単位との比べは 0)", () => {
    expect(compareUnits(G("a", 1), G("a", 1))).toBe(0);
    expect(compareUnits(G(null, 1), G(null, 1))).toBe(0);
    expect(compareUnits(G("a", 1), G(null, 1))).toBeLessThan(0);
    expect(compareUnits(G(null, 1), G("a", 1))).toBeGreaterThan(0);
  });
  it("totalBoxes: 数が 0 以下の行は数えない", () => {
    expect(totalBoxes([G("a", 3), G("b", 0), G("c", -2), G(null, 4)])).toBe(7);
    expect(totalBoxes([])).toBe(0);
  });
});

describe("orderUnitRefs: 「中に」の並べ方", () => {
  it("多い順 → 名前(単位なしは最後)。'' は null と足す。0 は捨てる", () => {
    const r = orderUnitRefs([
      { unitType: "店舗", count: 3 },
      { unitType: "", count: 2 },
      { unitType: null, count: 1 },
      { unitType: "部署", count: 3 },
      { unitType: "x", count: 0 },
    ]);
    expect(r).toEqual([
      { unitType: "店舗", count: 3 },
      { unitType: "部署", count: 3 },
      { unitType: null, count: 3 },
    ]);
  });
});

describe("formatPeriod: 期間の表し方(終わりは含まない → 1 日戻す)", () => {
  it("12 か月: 2025-10-01〜2026-10-01(含まない)→ 2025-10〜2026-09", () => {
    expect(formatPeriod("2025-10-01", "2026-10-01")).toEqual({ from: "2025-10", to: "2026-09" });
  });
  it("1 か月は from = to", () => {
    expect(formatPeriod("2025-04-01", "2025-05-01")).toEqual({ from: "2025-04", to: "2025-04" });
  });
  it("四半期・年", () => {
    expect(formatPeriod("2025-04-01", "2025-07-01")).toEqual({ from: "2025-04", to: "2025-06" });
    expect(formatPeriod("2025-01-01", "2026-01-01")).toEqual({ from: "2025-01", to: "2025-12" });
  });
  it("終わりが 1 月 1 日なら前の年の 12 月。3 月 1 日なら 2 月(うるう年も)", () => {
    expect(formatPeriod("2024-12-01", "2025-01-01")).toEqual({ from: "2024-12", to: "2024-12" });
    expect(formatPeriod("2024-02-01", "2024-03-01")).toEqual({ from: "2024-02", to: "2024-02" });
    expect(formatPeriod("2023-02-01", "2023-03-01")).toEqual({ from: "2023-02", to: "2023-02" });
  });
  it("終わりが月の途中なら、その月(1 日戻しても月は変わらない)", () => {
    expect(formatPeriod("2025-10-01", "2025-12-15")).toEqual({ from: "2025-10", to: "2025-12" });
    expect(formatPeriod("2025-10-01", "2025-10-02")).toEqual({ from: "2025-10", to: "2025-10" });
  });
  it("始まりが月の途中でも、始まりの月", () => {
    expect(formatPeriod("2025-10-20", "2025-12-01")).toEqual({ from: "2025-10", to: "2025-11" });
  });
  it("終わりがなければ、始まりの月だけ", () => {
    expect(formatPeriod("2025-10-01", null)).toEqual({ from: "2025-10", to: "2025-10" });
    expect(formatPeriod("2025-10-01", undefined)).toEqual({ from: "2025-10", to: "2025-10" });
  });
  it("始まりがない・読めない日付・終わりが始まり以前なら null", () => {
    expect(formatPeriod(null, "2025-10-01")).toBeNull();
    expect(formatPeriod(undefined, undefined)).toBeNull();
    expect(formatPeriod("", "2025-10-01")).toBeNull();
    expect(formatPeriod("2025-13-01", "2026-01-01")).toBeNull();
    expect(formatPeriod("2025-02-30", "2026-01-01")).toBeNull();
    expect(formatPeriod("2025-10-01", "2025-02-29")).toBeNull(); // 2025 年に 2/29 はない
    expect(formatPeriod("2025-10-01", "2025-02-28")).toBeNull(); // 終わりが始まりより前
    expect(formatPeriod("2024-02-29", "2024-03-01")).toEqual({ from: "2024-02", to: "2024-02" }); // うるう日は正しい日付
    expect(formatPeriod("2025-1-1", "2026-01-01")).toBeNull();
    expect(formatPeriod("2025-10-01T00:00:00Z", "2026-01-01")).toBeNull();
    expect(formatPeriod("2025-10-01", "2025-10-01")).toBeNull();
    expect(formatPeriod("2025-10-02", "2025-10-01")).toBeNull();
    expect(formatPeriod("2025-10-01", "x")).toBeNull();
  });
  it("年は 4 桁にそろえる", () => {
    expect(formatPeriod("0999-01-01", "1000-01-01")).toEqual({ from: "0999-01", to: "0999-12" });
  });
});

describe("matchTables: 単位と Table の照合", () => {
  const D1 = "dim-shop";
  const D2 = "dim-month";
  const S1 = "sheet-1";
  const T = (id: string, name: string, updatedAt: string, definition: unknown): TableCandidate => ({ id, name, updatedAt, definition });
  const def = (o: Record<string, unknown>) => ({ sources: null, rows: null, columns: null, measures: [], filters: [], ...o });

  it("rows・columns・filters のどれかの軸が D と重なれば合う(sources が null なら軸だけで)", () => {
    const tables = [
      T("r", "行", "2026-10-01T00:00:00Z", def({ rows: { dimensionId: D1, level: null } })),
      T("c", "列", "2026-10-02T00:00:00Z", def({ columns: { dimensionId: D1, level: 1 } })),
      T("f", "絞り込み", "2026-10-03T00:00:00Z", def({ rows: { dimensionId: "other", level: null }, filters: [{ dimensionId: D1, memberIds: ["m"] }] })),
      T("x", "別の軸", "2026-10-04T00:00:00Z", def({ rows: { dimensionId: "other", level: null } })),
    ];
    const m = matchTables(tables, [D1], []);
    expect(m?.items.map((t) => t.id)).toEqual(["f", "c", "r"]);
    expect(m?.more).toBe(0);
  });
  it("sources があれば、S と重なるときだけ合う(軸も必要)", () => {
    const tables = [
      T("hit", "S と重なる", "2026-10-01T00:00:00Z", def({ sources: [S1, "z"], rows: { dimensionId: D1, level: null } })),
      T("miss", "S と重ならない", "2026-10-02T00:00:00Z", def({ sources: ["z"], rows: { dimensionId: D1, level: null } })),
      T("empty", "sources が空の配列", "2026-10-03T00:00:00Z", def({ sources: [], rows: { dimensionId: D1, level: null } })),
      T("noaxis", "S と重なるが軸が違う", "2026-10-04T00:00:00Z", def({ sources: [S1], rows: { dimensionId: "other", level: null } })),
    ];
    expect(matchTables(tables, [D1], [S1])?.items.map((t) => t.id)).toEqual(["hit"]);
    // S が空(元のシートが見つからない単位)なら、sources のある表は合わない
    expect(matchTables(tables, [D1], [])).toBeNull();
  });
  it("D が空か、1 つも合わなければ null", () => {
    const t = T("a", "a", "2026-10-01T00:00:00Z", def({ rows: { dimensionId: D1, level: null } }));
    expect(matchTables([t], [], [S1])).toBeNull();
    expect(matchTables([t], [D2], [S1])).toBeNull();
    expect(matchTables([], [D1], [S1])).toBeNull();
  });
  it("updated_at の新しい順(同じなら名前 → id)で 3 件まで、残りは more", () => {
    const mk = (id: string, name: string, at: string) => T(id, name, at, def({ rows: { dimensionId: D1, level: null } }));
    const tables = [
      mk("1", "古い", "2026-01-01T00:00:00Z"),
      mk("2", "b", "2026-10-09T00:00:00Z"),
      mk("3", "a", "2026-10-09T00:00:00Z"),
      mk("5", "同じ名前", "2026-10-09T00:00:00Z"),
      mk("4", "同じ名前", "2026-10-09T00:00:00Z"),
      mk("6", "新しい", "2026-10-10T00:00:00Z"),
    ];
    const m = matchTables(tables, [D1], []);
    expect(m?.items.map((t) => t.id)).toEqual(["6", "3", "2"]);
    expect(m?.more).toBe(3);
    expect(Object.keys(m?.items[0] ?? {}).sort()).toEqual(["id", "name"]);
  });
  it("updated_at が読めない表は最後。同じ時刻の別の書き方(+09:00)も時刻で比べる", () => {
    const mk = (id: string, at: string) => T(id, id, at, def({ rows: { dimensionId: D1, level: null } }));
    const m = matchTables([mk("bad", "not a date"), mk("jst", "2026-10-10T09:00:00+09:00"), mk("utc-old", "2026-10-09T23:59:59Z"), mk("utc", "2026-10-10T00:00:00Z")], [D1], []);
    expect(m?.items.map((t) => t.id)).toEqual(["jst", "utc", "utc-old"]);
    expect(m?.more).toBe(1);
  });
  it("定義の形が違っても落ちない(合わないものとして扱う)", () => {
    const tables = [
      T("null", "n", "2026-10-01T00:00:00Z", null),
      T("str", "s", "2026-10-01T00:00:00Z", "rows"),
      T("arr", "a", "2026-10-01T00:00:00Z", [{ rows: { dimensionId: D1 } }]),
      T("bad-rows", "br", "2026-10-01T00:00:00Z", { rows: "x", columns: 3, filters: "y" }),
      T("bad-id", "bi", "2026-10-01T00:00:00Z", { rows: { dimensionId: 1 }, filters: [null, 5, { dimensionId: {} }] }),
      T("bad-src", "bs", "2026-10-01T00:00:00Z", { sources: "abc", rows: { dimensionId: D1 } }),
      T("bad-src2", "bs2", "2026-10-01T00:00:00Z", { sources: [1, 2], rows: { dimensionId: D1 } }),
      T("ok", "ok", "2026-10-01T00:00:00Z", { rows: { dimensionId: D1 } }),
    ];
    expect(matchTables(tables, [D1], [S1])?.items.map((t) => t.id)).toEqual(["ok"]);
  });
  it("入力を書き換えない", () => {
    const tables = [T("b", "b", "2026-10-01T00:00:00Z", def({ rows: { dimensionId: D1 } })), T("a", "a", "2026-10-02T00:00:00Z", def({ rows: { dimensionId: D1 } }))];
    const copy = JSON.parse(JSON.stringify(tables)) as TableCandidate[];
    matchTables(tables, [D1], [S1]);
    expect(tables).toEqual(copy);
  });
});

describe("並べ方(列・シート)", () => {
  it("orderColumns: いちばん左の位置 → 名前", () => {
    const cols = [
      { name: "b", position: 2 },
      { name: "z", position: 0 },
      { name: "a", position: 2 },
      { name: "m", position: 1 },
    ];
    expect(orderColumns(cols).map((c) => c.name)).toEqual(["z", "m", "a", "b"]);
    expect(cols[0].name).toBe("b"); // 入力は書き換えない
  });
  it("orderSheets: 行で結ばれたシート → 取り込みの新しい順(なしは後) → ファイル → シート → id", () => {
    const S = (sheetId: string, file: string, sheet: string, lastReadAt: string | null, viaRows: boolean): SheetFact => ({ sheetId, file, sheet, lastReadAt, viaRows });
    const sheets = [
      S("5", "B", "x", null, false),
      S("4", "A", "x", "2026-10-01T00:00:00Z", false),
      S("3", "A", "y", "2026-10-09T00:00:00Z", false),
      S("2", "Z", "z", "2026-01-01T00:00:00Z", true),
      S("1", "A", "x", null, false),
    ];
    expect(orderSheets(sheets).map((s) => s.sheetId)).toEqual(["2", "3", "4", "1", "5"]);
  });
});

describe("buildHomeOverview", () => {
  const sheet = (sheetId: string, file: string, sheet: string, lastReadAt: string | null, viaRows = true): SheetFact => ({ sheetId, file, sheet, lastReadAt, viaRows });
  const facts = (groups: UnitGroup[], per: Record<string, Partial<UnitFacts>> = {}, tables: TableCandidate[] = [], topBoxes?: number): HomeFacts => ({
    groups,
    topBoxes,
    units: new Map(Object.entries(per).map(([k, v]) => [k, { ...EMPTY_UNIT_FACTS, ...v }])),
    tables,
  });

  it("Box が 0 なら units は空", () => {
    expect(buildHomeOverview(facts([]))).toEqual({ units: [], others: { items: [], more: 0 }, topBoxes: 0 });
  });
  it("単位の並び・key・数・topBoxes(ほかの単位の分も入る)", () => {
    const groups = [G("店舗", 48), G("法人", 1200, true), ...Array.from({ length: 40 }, (_, i) => G(`x${String(i).padStart(2, "0")}`, 1)), G(null, 7)];
    const o = buildHomeOverview(facts(groups));
    expect(o.units.map((u) => u.key)).toEqual(["u:法人", "u:店舗", "none", "u:x00", "u:x01", "u:x02"]);
    expect(o.units.map((u) => u.unitType)).toEqual(["法人", "店舗", null, "x00", "x01", "x02"]);
    expect(o.units.map((u) => u.count)).toEqual([1200, 48, 7, 1, 1, 1]);
    expect(o.others.items).toHaveLength(30);
    expect(o.others.more).toBe(40 - 3 - 30);
    expect(o.topBoxes).toBe(1200 + 48 + 7 + 40);
  });
  it("topBoxes を渡せば、それを使う", () => {
    expect(buildHomeOverview(facts([G("a", 3)], {}, [], 99)).topBoxes).toBe(99);
  });
  it("事実がない単位は、何も見つからなかったものとして出す(名前の more は Box の数)", () => {
    const u = buildHomeOverview(facts([G("法人", 12)])).units[0];
    expect(u).toEqual({
      key: "u:法人",
      unitType: "法人",
      count: 12,
      names: { items: [], more: 12 },
      inside: null,
      cardFields: null,
      measures: null,
      period: null,
      sheets: null,
      tables: null,
    });
  });
  it("名前: (name, id) の順の先頭 5 件。more = 数 - 件数(DB の順は並べ替えない)", () => {
    const u = buildHomeOverview(facts([G("法人", 1200)], { "u:法人": { names: ["z", "y", "A社", "B社", "C社", "D社", "E社"] } })).units[0];
    expect(u.names).toEqual({ items: ["z", "y", "A社", "B社", "C社"], more: 1195 });
    const few = buildHomeOverview(facts([G("法人", 2)], { "u:法人": { names: ["B", "A"] } })).units[0];
    expect(few.names).toEqual({ items: ["B", "A"], more: 0 });
  });
  it("中に: 多い順・12 件まで・'' は単位なしに足す。なければ null", () => {
    const inside = Array.from({ length: 14 }, (_, i) => ({ unitType: `u${String(i).padStart(2, "0")}`, count: 100 - i }));
    const u = buildHomeOverview(facts([G("法人", 1, true)], { "u:法人": { inside: [...inside].reverse() } })).units[0];
    expect(u.inside?.items).toHaveLength(12);
    expect(u.inside?.items[0]).toEqual({ unitType: "u00", count: 100 });
    expect(u.inside?.more).toBe(2);
    const merged = buildHomeOverview(facts([G("法人", 1, true)], { "u:法人": { inside: [{ unitType: "", count: 2 }, { unitType: null, count: 3 }] } })).units[0];
    expect(merged.inside).toEqual({ items: [{ unitType: null, count: 5 }], more: 0 });
    expect(buildHomeOverview(facts([G("店舗", 1)])).units[0].inside).toBeNull();
  });
  it("Card の項目: いちばん左の位置 → 名前、12 件まで", () => {
    const cols = Array.from({ length: 13 }, (_, i) => ({ name: `c${String(i).padStart(2, "0")}`, position: 12 - i }));
    const u = buildHomeOverview(facts([G("法人", 1)], { "u:法人": { cardFields: cols } })).units[0];
    expect(u.cardFields?.items).toHaveLength(12);
    expect(u.cardFields?.items[0]).toBe("c12");
    expect(u.cardFields?.more).toBe(1);
    expect(u.cardFields?.items).not.toContain("c00");
  });
  it("数値: 名前と calculated(ƒ)。列の順、12 件まで", () => {
    const u = buildHomeOverview(
      facts([G("店舗", 48)], { "u:店舗": { measures: [{ name: "粗利率", position: 5, calculated: true }, { name: "売上", position: 3, calculated: false }, { name: "経費", position: 4, calculated: false }] } }),
    ).units[0];
    expect(u.measures).toEqual({
      items: [
        { name: "売上", calculated: false },
        { name: "経費", calculated: false },
        { name: "粗利率", calculated: true },
      ],
      more: 0,
    });
  });
  it("期間: YYYY-MM(終わりを含む)。なければ null", () => {
    const u = buildHomeOverview(facts([G("店舗", 48)], { "u:店舗": { periodStart: "2025-10-01", periodEndExclusive: "2026-10-01" } })).units[0];
    expect(u.period).toEqual({ from: "2025-10", to: "2026-09" });
    expect(buildHomeOverview(facts([G("店舗", 48)])).units[0].period).toBeNull();
  });
  it("元のシート: 行で結ばれたものが先、3 件まで、残りは more。lastReadAt は全部のうちでいちばん新しい日時", () => {
    const sheets = [
      sheet("s4", "代理店", "A", "2026-10-09T00:00:00Z", false),
      sheet("s1", "店舗マスタ", "店舗", "2026-10-10T01:00:00Z"),
      sheet("s2", "店舗マスタ", "2025", "2026-10-01T00:00:00Z"),
      sheet("s3", "店舗マスタ", "2024", null),
      sheet("s5", "メモ", "1", "2026-10-10T09:00:00Z", false),
    ];
    const u = buildHomeOverview(facts([G("店舗", 48)], { "u:店舗": { sheets } })).units[0];
    expect(u.sheets?.items.map((s) => s.sheetId)).toEqual(["s1", "s2", "s3"]);
    expect(u.sheets?.more).toBe(2);
    expect(u.sheets?.lastReadAt).toBe("2026-10-10T09:00:00Z"); // 出さない 4 枚目・5 枚目のうちの新しい日時も含む
    expect(u.sheets?.items[0]).toEqual({ sheetId: "s1", file: "店舗マスタ", sheet: "店舗" });
  });
  it("元のシートがあっても、取り込んだ日がなければ lastReadAt は null", () => {
    const u = buildHomeOverview(facts([G("店舗", 48)], { "u:店舗": { sheets: [sheet("s1", "f", "s", null)] } })).units[0];
    expect(u.sheets).toEqual({ items: [{ sheetId: "s1", file: "f", sheet: "s" }], more: 0, lastReadAt: null });
  });
  it("Table: 単位の軸(D)と元のシート(S)で照合する", () => {
    const tables: TableCandidate[] = [
      { id: "t-shop", name: "店舗 × 月", updatedAt: "2026-10-05T00:00:00Z", definition: { sources: null, rows: { dimensionId: "d-shop" }, columns: { dimensionId: "d-month" } } },
      { id: "t-other-sheet", name: "別のシートの店舗", updatedAt: "2026-10-06T00:00:00Z", definition: { sources: ["zzz"], rows: { dimensionId: "d-shop" } } },
      { id: "t-corp", name: "法人", updatedAt: "2026-10-07T00:00:00Z", definition: { sources: null, rows: { dimensionId: "d-corp" } } },
    ];
    const o = buildHomeOverview(
      facts(
        [G("店舗", 48), G("法人", 1200, true)],
        { "u:店舗": { dimensionIds: ["d-shop"], sheets: [sheet("s1", "f", "s", null)] }, "u:法人": { dimensionIds: ["d-corp"], sheets: [sheet("s9", "f", "s9", null)] } },
        tables,
      ),
    );
    const by = Object.fromEntries(o.units.map((u) => [u.key, u]));
    expect(by["u:店舗"].tables).toEqual({ items: [{ id: "t-shop", name: "店舗 × 月" }], more: 0 });
    expect(by["u:法人"].tables).toEqual({ items: [{ id: "t-corp", name: "法人" }], more: 0 });
  });
  it("同じ入力なら同じ結果で、JSON にできる", () => {
    const f = facts([G("店舗", 48), G("法人", 12, true)], { "u:店舗": { names: ["a"], periodStart: "2025-10-01", periodEndExclusive: "2025-11-01", sheets: [sheet("s", "f", "x", "2026-10-10T00:00:00Z")] } });
    const a = buildHomeOverview(f);
    expect(buildHomeOverview(f)).toEqual(a);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
  });
});

describe("sectionsOf: 欄の並びは固定、値がない欄は null(「—」は画面側)", () => {
  const empty: HomeUnit = { key: "u:法人", unitType: "法人", count: 3, names: { items: [], more: 0 }, inside: null, cardFields: null, measures: null, period: null, sheets: null, tables: null };
  const full: HomeUnit = {
    key: "u:店舗",
    unitType: "店舗",
    count: 48,
    names: { items: ["a", "b"], more: 46 },
    inside: { items: [{ unitType: "部署", count: 2 }], more: 0 },
    cardFields: { items: ["店舗名"], more: 0 },
    measures: { items: [{ name: "粗利率", calculated: true }], more: 0 },
    period: { from: "2025-10", to: "2026-09" },
    sheets: { items: [{ sheetId: "s", file: "f", sheet: "t" }], more: 1, lastReadAt: "2026-10-10T00:00:00Z" },
    tables: { items: [{ id: "t", name: "T" }], more: 0 },
  };

  it("欄の並び: 名前・中に・Card の項目・数値・期間・元のシート・Table・Cube・数字の帯", () => {
    expect(SECTION_IDS).toEqual(["names", "inside", "cardFields", "measures", "period", "sheets", "tables", "cube", "bands"]);
    expect(sectionsOf(full).map((s) => s.id)).toEqual([...SECTION_IDS]);
    expect(sectionsOf(empty).map((s) => s.id)).toEqual([...SECTION_IDS]);
  });
  it("値がなければ、欄は省かずに value = null", () => {
    expect(sectionsOf(empty).map((s) => s.value)).toEqual([null, null, null, null, null, null, null, null, null]);
  });
  it("値があればそのまま渡す", () => {
    const s = sectionsOf(full);
    expect(s[0]).toEqual({ id: "names", value: full.names });
    expect(s[1].value).toBe(full.inside);
    expect(s[2].value).toBe(full.cardFields);
    expect(s[3].value).toBe(full.measures);
    expect(s[4].value).toBe(full.period);
    expect(s[5].value).toBe(full.sheets);
    expect(s[6].value).toBe(full.tables);
  });
  it("項目が空の一覧も「値なし」(「—」)にする", () => {
    const u: HomeUnit = { ...full, inside: { items: [], more: 0 }, cardFields: { items: [], more: 0 }, measures: { items: [], more: 0 }, sheets: { items: [], more: 0, lastReadAt: null }, tables: { items: [], more: 0 } };
    expect(sectionsOf(u).slice(0, 7).map((s) => s.value !== null)).toEqual([true, false, false, false, true, false, false]);
  });
  it("Cube は P8、数字の帯は P11(いつも値なし)", () => {
    const s = sectionsOf(full);
    expect(s[7]).toEqual({ id: "cube", value: null, phase: "P8" });
    expect(s[8]).toEqual({ id: "bands", value: null, phase: "P11" });
  });
  it("見出しなどの文字は、すべての欄に用意してある", () => {
    expect(Object.keys(SECTION_LABELS).sort()).toEqual([...SECTION_IDS].sort());
    for (const id of SECTION_IDS) expect(SECTION_LABELS[id]).not.toBe("");
    expect(NO_VALUE_MARK).toBe("—");
    expect(CALCULATED_MARK).toBe("ƒ");
    expect(CALCULATED_LABEL).not.toBe("");
    expect(PHASE_MARKS).toEqual({ P8: "【P8】", P11: "【P11】" });
  });
  it("buildHomeOverview の結果をそのまま渡せる", () => {
    const o = buildHomeOverview({ groups: [G("店舗", 3)], units: new Map(), tables: [] });
    const s = sectionsOf(o.units[0]);
    expect(s).toHaveLength(9);
    expect(s[0].value).toBeNull(); // 名前がなければ「—」
  });
});

describe("listed(共通)", () => {
  it("先頭から limit 件と、残りの数", () => {
    expect(listed([1, 2, 3, 4], 3)).toEqual({ items: [1, 2, 3], more: 1 });
    expect(listed([1, 2], 3)).toEqual({ items: [1, 2], more: 0 });
    expect(listed([], 3)).toEqual({ items: [], more: 0 });
    expect(listed([1, 2], 0)).toEqual({ items: [], more: 2 });
    expect(listed([1, 2], -1)).toEqual({ items: [], more: 2 });
  });
  it("元の配列を書き換えず、新しい配列を返す", () => {
    const src = [1, 2];
    const l = listed(src, 5);
    expect(l.items).not.toBe(src);
  });
});
