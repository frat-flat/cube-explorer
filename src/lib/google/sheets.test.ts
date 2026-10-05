import { describe, expect, it } from "vitest";
import { monthOf, plain, spreadsheetId, toBook, type Cell, type RawSpreadsheet } from "./sheets";

describe("spreadsheetId", () => {
  it("リンクから ID を取り出す", () => {
    expect(spreadsheetId("https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit#gid=0")).toBe("1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789");
  });
  it("スプシのリンクでなければ null", () => {
    expect(spreadsheetId("https://example.com/foo")).toBeNull();
  });
});

describe("plain", () => {
  it.each([["¥150,000", "150000"], ["1,234.5", "1234.5"], ["-2,000", "-2000"], ["8%", "8%"], ["S-01", "S-01"], ["2026-09", "2026-09"]])("%s → %s", (v, w) => {
    expect(plain(v)).toBe(w);
  });
});

describe("monthOf", () => {
  it.each([["auPAY_2026-09", "2026-09"], ["202607", "2026-07"], ["2026年8月", "2026-08"], ["集計", undefined], ["2026-13", undefined]])("%s → %s", (n, m) => {
    expect(monthOf(n)).toBe(m);
  });
});

const cell = (v: string, f?: string): Cell => ({ formattedValue: v, ...(f ? { userEnteredValue: { formulaValue: f } } : {}) });
const tab = (title: string, rows: Cell[][]) => ({ properties: { title, gridProperties: { rowCount: 1000, columnCount: 26 } }, data: [{ rowData: rows.map((values) => ({ values })) }] });

describe("toBook", () => {
  it("1行目を列名にし、関数・条件付き書式・入力規則を読み、同じ列の月別タブはまとめるのをすすめる", () => {
    const raw: RawSpreadsheet = {
      properties: { title: "auPAY月次" },
      sheets: [
        { ...tab("auPAY_2026-08", [[cell("店舗コード"), cell("売上金額"), cell("手数料")], [{ ...cell("S-01"), dataValidation: { condition: { type: "ONE_OF_LIST", values: [{ userEnteredValue: "S-01" }, { userEnteredValue: "S-02" }] } } }, cell("150,000"), cell("15,000", "=ROUND(B2*0.1,-1)")]]),
          conditionalFormats: [{ ranges: [{ startColumnIndex: 1 }], booleanRule: { condition: { type: "NUMBER_LESS", values: [{ userEnteredValue: "150000" }] } } }] },
        tab("auPAY_2026-09", [[cell("店舗コード"), cell("売上金額"), cell("手数料")], [cell("S-01"), cell("160,000"), cell("16,000")]]),
        tab("メモ", []),
      ],
    };
    const b = toBook("u", raw);
    expect(b.name).toBe("auPAY月次");
    expect(b.merge).toBe(true);
    const [t] = b.tabs;
    expect(t.cols).toEqual(["店舗コード", "売上金額", "手数料"]);
    expect(t.rows).toEqual([["S-01", "150000", "15000"]]);
    expect(t.month).toBe("2026-08");
    expect(t.formulas.C.f).toBe("=ROUND(B2*0.1,-1)");
    expect(t.dv[0].text).toBe("店舗コード は S-01 / S-02 から選ぶ");
    expect(t.cf[0].text).toBe("売上金額 が 150000 未満 なら色を付ける");
    expect(b.tabs[2]).toMatchObject({ kind: "misc", use: false });
  });
});
