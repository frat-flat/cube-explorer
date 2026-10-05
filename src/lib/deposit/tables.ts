// 取り込みできる表の定義(画面とサーバーで共通)。見出しは日本語で、決まった列以外は extra に入れる
export type TableKey = "applicants" | "contractors" | "companies" | "shops" | "deposits";

export type ColumnDef = {
  header: string; // CSV・Excel の見出し
  column: string; // DB の列名
  required?: boolean;
  kind?: "text" | "date" | "month" | "amount" | "tax";
};

export type TableDef = {
  key: TableKey;
  label: string;
  columns: ColumnDef[];
  conflict: string[]; // 同じなら上書きする列
  parent?: { column: string; table: TableKey; label: string };
  hasExtra: boolean;
  example: Record<string, string>;
};

export const TABLES: TableDef[] = [
  {
    key: "applicants",
    label: "申込者",
    columns: [
      { header: "コード", column: "code", required: true },
      { header: "名前", column: "name", required: true },
    ],
    conflict: ["code"],
    hasExtra: true,
    example: { コード: "A001", 名前: "瀬戸内ホールディングス", 申込日: "2024-04-01" },
  },
  {
    key: "contractors",
    label: "契約者",
    columns: [
      { header: "コード", column: "code", required: true },
      { header: "申込者コード", column: "applicant_code", required: true },
      { header: "名前", column: "name", required: true },
    ],
    conflict: ["code"],
    parent: { column: "applicant_code", table: "applicants", label: "申込者" },
    hasExtra: true,
    example: { コード: "C001", 申込者コード: "A001", 名前: "佐藤 健", 契約日: "2024-05-01" },
  },
  {
    key: "companies",
    label: "法人",
    columns: [
      { header: "コード", column: "code", required: true },
      { header: "契約者コード", column: "contractor_code", required: true },
      { header: "名前", column: "name", required: true },
      { header: "課税区分", column: "tax_category", required: true, kind: "tax" },
      { header: "郵便番号", column: "postal_code" },
      { header: "住所", column: "address" },
      { header: "代表者", column: "representative" },
      { header: "設立日", column: "founded_on", kind: "date" },
      { header: "インボイス登録番号", column: "invoice_no" },
    ],
    conflict: ["code"],
    parent: { column: "contractor_code", table: "contractors", label: "契約者" },
    hasExtra: true,
    example: {
      コード: "K001", 契約者コード: "C001", 名前: "株式会社みどり堂", 課税区分: "課税", 郵便番号: "730-0011",
      住所: "広島県広島市中区基町1-1", 代表者: "青木 一郎", 設立日: "2005-05-25", インボイス登録番号: "T1234567890123",
    },
  },
  {
    key: "shops",
    label: "ショップ",
    columns: [
      { header: "コード", column: "code", required: true },
      { header: "法人コード", column: "company_code", required: true },
      { header: "名前", column: "name", required: true },
      { header: "モール", column: "mall", required: true },
    ],
    conflict: ["code"],
    parent: { column: "company_code", table: "companies", label: "法人" },
    hasExtra: true,
    example: { コード: "S001", 法人コード: "K001", 名前: "みどり堂 楽天市場店", モール: "楽天", 店舗ID: "shop-123456" },
  },
  {
    key: "deposits",
    label: "入金明細",
    columns: [
      { header: "ショップコード", column: "shop_code", required: true },
      { header: "年月", column: "month", required: true, kind: "month" },
      { header: "内訳", column: "item", required: true },
      { header: "金額", column: "amount", required: true, kind: "amount" },
    ],
    conflict: ["shop_code", "month", "item"],
    parent: { column: "shop_code", table: "shops", label: "ショップ" },
    hasExtra: false,
    example: { ショップコード: "S001", 年月: "2025-10", 内訳: "売上", 金額: "1200000" },
  },
];

export const tableDef = (key: string) => TABLES.find((t) => t.key === key);

/** 1行を DB に入れる形に直す。だめなら理由を返す */
export function normalizeRow(def: TableDef, raw: Record<string, unknown>): { row?: Record<string, unknown>; error?: string } {
  const row: Record<string, unknown> = {};
  const known = new Set(def.columns.map((c) => c.header));
  for (const c of def.columns) {
    const v = String(raw[c.header] ?? "").trim();
    if (!v) {
      if (c.required) return { error: `「${c.header}」が空です` };
      row[c.column] = null;
      continue;
    }
    switch (c.kind) {
      case "tax": {
        const t = v.replace(/事業者$/, "");
        if (t !== "課税" && t !== "免税") return { error: `「課税区分」は「課税」か「免税」にしてください(${v})` };
        row[c.column] = t;
        break;
      }
      case "date": {
        const m = v.match(/^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?$/);
        if (!m) return { error: `「${c.header}」の日付が読めません(${v})` };
        row[c.column] = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
        break;
      }
      case "month": {
        const m = v.match(/^(\d{4})[-/年.](\d{1,2})(?:月|[-/](\d{1,2}))?/);
        if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return { error: `「${c.header}」の年月が読めません(${v})` };
        row[c.column] = `${m[1]}-${m[2].padStart(2, "0")}-01`;
        break;
      }
      case "amount": {
        const s = v.replace(/[¥￥,\s円]/g, "").replace(/^[−▲△]/, "-");
        if (!/^-?\d+(\.\d+)?$/.test(s)) return { error: `「${c.header}」が数字ではありません(${v})` };
        row[c.column] = Math.round(Number(s));
        break;
      }
      default:
        row[c.column] = v;
    }
  }
  if (def.hasExtra) {
    const extra: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      const s = String(v ?? "").trim();
      if (!known.has(k) && k.trim() && s) extra[k.trim()] = s;
    }
    row.extra = extra;
  }
  return { row };
}
