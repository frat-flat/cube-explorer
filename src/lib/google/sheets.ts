import { createSign } from "node:crypto";

// Google スプレッドシートを、システム用のアカウント(サービスアカウント)で読む。
// 鍵は環境変数 GOOGLE_SERVICE_ACCOUNT_JSON に、Google Cloud で作った JSON をそのまま入れる。
// 読めるのは、そのアカウントのメールアドレスに共有されたスプシだけ。権限は閲覧のみ(spreadsheets.readonly)。
// GAS(Apps Script)はこのアカウントからは読めないので、ここでは扱わない。

const SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://sheets.googleapis.com/v4/spreadsheets";
/** 1タブあたりに中身を持ってくる行数の上限(見出しを含む)。全体の大きさは別に返す */
export const MAX_ROWS = 300;
const MAX_COLS = 26;

export type ServiceAccount = { client_email: string; private_key: string };

export class SheetsError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: "not_configured" | "bad_url" | "not_shared" | "not_found" | "google",
  ) {
    super(message);
  }
}

export function serviceAccount(): ServiceAccount | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as Partial<ServiceAccount>;
    if (!j.client_email || !j.private_key) return null;
    return { client_email: j.client_email, private_key: j.private_key.replace(/\\n/g, "\n") };
  } catch {
    return null;
  }
}

/** スプシの URL(または ID そのもの)から ID を取り出す */
export function spreadsheetId(urlOrId: string): string | null {
  const s = urlOrId.trim();
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/);
  if (m) return m[1];
  return /^[a-zA-Z0-9_-]{20,}$/.test(s) ? s : null;
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export async function accessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }));
  const sig = createSign("RSA-SHA256").update(`${head}.${claim}`).sign(sa.private_key).toString("base64url");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claim}.${sig}` }),
  });
  if (!res.ok) throw new SheetsError("システム用アカウントの鍵で Google にログインできませんでした。鍵を作り直して入れ直してください", 502, "google");
  return ((await res.json()) as { access_token: string }).access_token;
}

export async function get(token: string, url: string, email: string) {
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (res.status === 403) throw new SheetsError(`このスプシは共有されていません。スプシの「共有」で ${email} を閲覧者として追加してください`, 403, "not_shared");
  if (res.status === 404) throw new SheetsError("スプシが見つかりません。リンクを確かめてください", 404, "not_found");
  if (!res.ok) throw new SheetsError(`Google から読めませんでした(${res.status})`, 502, "google");
  return res.json();
}

// ---------- Google の返事を、試作の画面が使う形(book)に直す ----------
export type Cell = {
  formattedValue?: string;
  userEnteredValue?: { formulaValue?: string };
  dataValidation?: { condition?: Condition; strict?: boolean };
};
type Condition = { type?: string; values?: { userEnteredValue?: string }[] };
type GridRange = { startRowIndex?: number; endRowIndex?: number; startColumnIndex?: number; endColumnIndex?: number };
type RawSheet = {
  properties?: { title?: string; gridProperties?: { rowCount?: number; columnCount?: number } };
  conditionalFormats?: { ranges?: GridRange[]; booleanRule?: { condition?: Condition }; gradientRule?: unknown }[];
  data?: { rowData?: { values?: Cell[] }[] }[];
  merges?: GridRange[];
};
export type RawSpreadsheet = { properties?: { title?: string }; sheets?: RawSheet[] };

export type BookTab = {
  name: string;
  kind: "data" | "misc";
  use: boolean;
  month?: string;
  cols: string[];
  rows: string[][];
  /** 1行目からそのままの表(空の行も含む)。何行目を列名にするかは画面で選ぶ */
  grid: string[][];
  /** 上のほうの行の結合セル(グループ名の行を読むため)。行・列は 0 から、終わりは含まない */
  merges: { r0: number; r1: number; c0: number; c1: number }[];
  size: { rows: number; cols: number };
  truncated: boolean;
  formulas: Record<string, { f: string; text: string }>;
  cf: { col: number; text: string }[];
  dv: { col: number; text: string }[];
};
export type Book = { real: true; url: string; name: string; tabs: BookTab[]; gas: []; merge: boolean };

const letter = (i: number) => String.fromCharCode(65 + i);
const vals = (c?: Condition) => (c?.values ?? []).map((v) => v.userEnteredValue ?? "").filter(Boolean);
const COND: Record<string, (v: string[]) => string> = {
  NUMBER_GREATER: (v) => `${v[0]} より大きい`,
  NUMBER_GREATER_THAN_EQ: (v) => `${v[0]} 以上`,
  NUMBER_LESS: (v) => `${v[0]} 未満`,
  NUMBER_LESS_THAN_EQ: (v) => `${v[0]} 以下`,
  NUMBER_EQ: (v) => `${v[0]} と同じ`,
  NUMBER_NOT_EQ: (v) => `${v[0]} 以外`,
  NUMBER_BETWEEN: (v) => `${v[0]}〜${v[1]}`,
  TEXT_CONTAINS: (v) => `「${v[0]}」を含む`,
  TEXT_EQ: (v) => `「${v[0]}」と同じ`,
  BLANK: () => "空欄",
  NOT_BLANK: () => "空欄でない",
  CUSTOM_FORMULA: (v) => `式 ${v[0]} が成り立つ`,
  ONE_OF_LIST: (v) => `${v.join(" / ")} から選ぶ`,
  ONE_OF_RANGE: (v) => `${v[0]} の中から選ぶ`,
  DATE_IS_VALID: () => "日付",
  BOOLEAN: () => "チェックボックス",
};
const condText = (c?: Condition) => (c?.type ? (COND[c.type]?.(vals(c)) ?? c.type) : "");

/** 「¥150,000」のような見た目の数字は、桁区切りと通貨記号を外して数字だけにする(集計できるように) */
export const plain = (v: string) => {
  const t = v.trim();
  return /^[¥￥$]?\s?-?[\d,]+(\.\d+)?$/.test(t) && /\d/.test(t) ? t.replace(/[¥￥$,\s]/g, "") : t;
};

/** タブ名から年月(2026-09 / 202609 / 2026年9月)を拾う */
export function monthOf(name: string): string | undefined {
  const m = name.match(/(20\d{2})[-_/年.]?(\d{1,2})(?:月)?(?!\d)/);
  if (!m) return undefined;
  const mm = Number(m[2]);
  return mm >= 1 && mm <= 12 ? `${m[1]}-${String(mm).padStart(2, "0")}` : undefined;
}

export function toBook(url: string, raw: RawSpreadsheet): Book {
  const tabs: BookTab[] = (raw.sheets ?? []).map((sh) => {
    const name = sh.properties?.title ?? "";
    const grid = (sh.data?.[0]?.rowData ?? []).map((r) => r.values ?? []);
    const width = Math.max(0, ...grid.map((r) => r.length));
    const text = grid.map((r) => Array.from({ length: width }, (_, i) => plain(r[i]?.formattedValue ?? "")));
    // 1行目を列名とみなす。中身のない列は右端から落とす
    let w = width;
    while (w > 0 && text.every((r) => !r[w - 1])) w--;
    const cols = (text[0] ?? []).slice(0, w).map((c, i) => c || `${letter(i)}列`);
    const rows = text.slice(1).map((r) => r.slice(0, w)).filter((r) => r.some(Boolean));
    const formulas: BookTab["formulas"] = {};
    grid.slice(1).forEach((r, ri) =>
      r.slice(0, w).forEach((c, ci) => {
        const f = c.userEnteredValue?.formulaValue;
        if (f && !formulas[letter(ci)]) formulas[letter(ci)] = { f, text: `${cols[ci]} は関数で計算(${ri + 2}行目の例)` };
      }),
    );
    const dv: BookTab["dv"] = [];
    grid.forEach((r) =>
      r.slice(0, w).forEach((c, ci) => {
        if (c.dataValidation && !dv.some((d) => d.col === ci)) dv.push({ col: ci, text: `${cols[ci]} は ${condText(c.dataValidation.condition)}` });
      }),
    );
    const cf = (sh.conditionalFormats ?? []).map((r) => {
      const col = r.ranges?.[0]?.startColumnIndex ?? 0;
      const what = r.booleanRule ? `${condText(r.booleanRule.condition)} なら色を付ける` : "値の大きさで色の濃さを変える";
      return { col, text: `${cols[col] ?? letter(col) + "列"} が ${what}` };
    });
    const gp = sh.properties?.gridProperties ?? {};
    const data = cols.length > 0 && rows.length > 0;
    return {
      name,
      kind: data ? "data" : "misc",
      use: data,
      month: monthOf(name),
      cols,
      rows,
      grid: text.map((r) => r.slice(0, w)),
      merges: (sh.merges ?? [])
        .map((m) => ({ r0: m.startRowIndex ?? 0, r1: m.endRowIndex ?? 0, c0: m.startColumnIndex ?? 0, c1: Math.min(m.endColumnIndex ?? 0, w) }))
        .filter((m) => m.r0 < 20 && m.c1 > m.c0),
      size: { rows: gp.rowCount ?? rows.length + 1, cols: gp.columnCount ?? cols.length },
      truncated: (gp.rowCount ?? 0) > MAX_ROWS && grid.length >= MAX_ROWS,
      formulas,
      cf,
      dv,
    };
  });
  // 列が同じデータのタブが2枚以上あり、どれも年月がタブ名にあるなら、1枚にまとめるのをすすめる
  const data = tabs.filter((t) => t.kind === "data");
  const same = data.length > 1 && data.every((t) => t.month && t.cols.join("\u0001") === data[0].cols.join("\u0001"));
  return { real: true, url, name: raw.properties?.title ?? "スプレッドシート", tabs, gas: [], merge: same };
}

/** スプシを読んで book の形で返す */
export async function readSpreadsheet(urlOrId: string): Promise<Book> {
  const sa = serviceAccount();
  if (!sa) throw new SheetsError("スプシを読むためのシステム用アカウントがまだ設定されていません(GOOGLE_SERVICE_ACCOUNT_JSON)", 503, "not_configured");
  const id = spreadsheetId(urlOrId);
  if (!id) throw new SheetsError("スプシのリンクの形ではありません(https://docs.google.com/spreadsheets/d/… の形で入れてください)", 400, "bad_url");
  const token = await accessToken(sa);
  const meta = (await get(token, `${API}/${id}?fields=sheets.properties.title`, sa.client_email)) as RawSpreadsheet;
  const titles = (meta.sheets ?? []).map((s) => s.properties?.title ?? "").filter(Boolean);
  const q = new URLSearchParams({
    includeGridData: "true",
    fields:
      "properties.title,sheets(properties(title,gridProperties(rowCount,columnCount)),conditionalFormats(ranges(startColumnIndex),booleanRule(condition),gradientRule),merges,data(rowData(values(formattedValue,userEnteredValue.formulaValue,dataValidation))))",
  });
  titles.forEach((t) => q.append("ranges", `'${t.replace(/'/g, "''")}'!A1:${letter(MAX_COLS - 1)}${MAX_ROWS}`));
  const raw = (await get(token, `${API}/${id}?${q}`, sa.client_email)) as RawSpreadsheet;
  return toBook(urlOrId, raw);
}
