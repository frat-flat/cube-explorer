// Google スプレッドシートを読む(つなぎ)。システム用アカウント(閲覧のみ)で、タブを分割して全行読む。
// 鍵・認証・リンクの読み方・API の呼び出しは、src/lib/google/sheets.ts のものを使う。
import { accessToken, get, serviceAccount, SheetsError, spreadsheetId } from "@/lib/google/sheets";
import { a1Range } from "@/fourdb/core/import/a1";
import type { Merge, SourceCell } from "@/fourdb/core/import/types";
import { SourceError, type SourceBook, type SourceReader } from "@/fourdb/core/ports";

const API = "https://sheets.googleapis.com/v4/spreadsheets";
/** 日付・時刻のセルは、数(通し番号)ではなく見た目の文字として扱う */
const DATE_TYPES = new Set(["DATE", "TIME", "DATE_TIME"]);

type RawCell = {
  formattedValue?: string;
  effectiveValue?: { numberValue?: number };
  effectiveFormat?: { numberFormat?: { type?: string } };
  userEnteredValue?: { formulaValue?: string };
};
type RawRange = { startRowIndex?: number; endRowIndex?: number; startColumnIndex?: number; endColumnIndex?: number };
type RawRows = { sheets?: { merges?: RawRange[]; data?: { startRow?: number; rowData?: { values?: RawCell[] }[] }[] }[] };
type RawMeta = {
  properties?: { title?: string };
  sheets?: { properties?: { sheetId?: number; title?: string; gridProperties?: { rowCount?: number; columnCount?: number } } }[];
};

let cached: { email: string; token: string; until: number } | null = null;
async function token(): Promise<{ token: string; email: string }> {
  const sa = serviceAccount();
  if (!sa) throw new SourceError("スプシを読むためのシステム用アカウントがまだ設定されていません(GOOGLE_SERVICE_ACCOUNT_JSON)", 503, "not_configured");
  if (cached && cached.email === sa.client_email && cached.until > Date.now()) return { token: cached.token, email: sa.client_email };
  const t = await accessToken(sa);
  cached = { email: sa.client_email, token: t, until: Date.now() + 50 * 60 * 1000 };   // 1時間有効。少し早めに取り直す
  return { token: t, email: sa.client_email };
}

async function call<T>(url: string): Promise<T> {
  const { token: t, email } = await token();
  try {
    return (await get(t, url, email)) as T;
  } catch (e) {
    if (e instanceof SheetsError) throw new SourceError(e.message, e.status, e.code === "google" ? "upstream" : e.code);
    throw e;
  }
}

export function toCell(c: RawCell | undefined): SourceCell {
  if (!c) return { v: "", n: null, f: null };
  const isDate = DATE_TYPES.has(c.effectiveFormat?.numberFormat?.type ?? "");
  const n = c.effectiveValue?.numberValue;
  return { v: c.formattedValue ?? "", n: !isDate && typeof n === "number" && Number.isFinite(n) ? n : null, f: c.userEnteredValue?.formulaValue ?? null };
}

export const googleSheetsReader: SourceReader = {
  async book(urlOrId) {
    const id = spreadsheetId(urlOrId);
    if (!id) throw new SourceError("スプシのリンクの形ではありません(https://docs.google.com/spreadsheets/d/… の形で入れてください)", 400, "bad_url");
    const meta = await call<RawMeta>(`${API}/${id}?fields=${encodeURIComponent("properties.title,sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))")}`);
    const book: SourceBook = {
      provider: "google_sheets",
      externalId: id,
      title: meta.properties?.title ?? "スプレッドシート",
      url: `https://docs.google.com/spreadsheets/d/${id}/edit`,
      tabs: (meta.sheets ?? []).map((s) => ({
        externalId: String(s.properties?.sheetId ?? ""),
        title: s.properties?.title ?? "",
        rowCount: s.properties?.gridProperties?.rowCount ?? 0,
        colCount: s.properties?.gridProperties?.columnCount ?? 0,
      })),
    };
    return book;
  },

  async rows(book, tab, start, count) {
    if (count <= 0 || tab.colCount <= 0) return { rows: [], merges: [] };
    const range = a1Range(tab.title, { c0: 0, r0: start, c1: tab.colCount - 1, r1: start + count - 1 });
    const q = new URLSearchParams({
      includeGridData: "true",
      ranges: range,
      fields: "sheets(merges,data(startRow,rowData(values(formattedValue,effectiveValue(numberValue),effectiveFormat(numberFormat(type)),userEnteredValue(formulaValue)))))",
    });
    const raw = await call<RawRows>(`${API}/${book.externalId}?${q}`);
    const sheet = raw.sheets?.[0];
    const rows = (sheet?.data?.[0]?.rowData ?? []).map((r) => (r.values ?? []).map(toCell));
    const merges: Merge[] = (sheet?.merges ?? [])
      .map((m) => ({ r0: m.startRowIndex ?? 0, r1: m.endRowIndex ?? 0, c0: m.startColumnIndex ?? 0, c1: m.endColumnIndex ?? 0 }))
      .filter((m) => m.r1 > start && m.r0 < start + count);
    return { rows, merges };
  },
};
