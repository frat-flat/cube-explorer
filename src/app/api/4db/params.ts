// 読み取り API(summary・history・boxes)の問い合わせの読み方。形の違うものはデータベースに渡さず、400 で断る。
// { value } = 使える値 / { error } = 利用者に見せてよい文。
import { hasNul, isUuid } from "@/fourdb/adapters/postgres/guards";
import { HISTORY_CURSOR, HISTORY_KIND } from "@/fourdb/adapters/postgres/history";

export type Parsed<T> = { value: T } | { error: string };
export const bad = (error: string) => Response.json({ error }, { status: 400 });

/** limit: なければ def。1 以上の整数でなければ断る。max を超えるときは max に丸める */
export function parseLimit(raw: string | null, def: number, max: number): Parsed<number> {
  if (raw === null || raw === "") return { value: def };
  if (!/^\d{1,9}$/.test(raw) || Number(raw) < 1) return { error: "limit は 1 以上の整数で指定してください" };
  return { value: Math.min(Number(raw), max) };
}

/** 履歴の cursor(前のページの最後の id)。なければ null。数字だけ(bigint に収まる 18 桁まで) */
export function parseHistoryCursor(raw: string | null): Parsed<string | null> {
  if (raw === null || raw === "") return { value: null };
  return HISTORY_CURSOR.test(raw) ? { value: raw } : { error: "cursor の形が違います" };
}

/** 履歴の種類(kind)。なければ null。小文字・数字・下線だけ(32 文字まで) */
export function parseKind(raw: string | null): Parsed<string | null> {
  if (raw === null || raw === "") return { value: null };
  return HISTORY_KIND.test(raw) ? { value: raw } : { error: "kind の形が違います" };
}

/** Box の親。root(または指定なし)= いちばん上 → null、それ以外は id(uuid) */
export function parseParent(raw: string | null): Parsed<string | null> {
  if (raw === null || raw === "" || raw === "root") return { value: null };
  return isUuid(raw) ? { value: raw } : { error: "parent は root か Box の id で指定してください" };
}

/** Box の cursor(前のページの最後の Box の id)。なければ null。uuid だけ */
export function parseBoxCursor(raw: string | null): Parsed<string | null> {
  if (raw === null || raw === "") return { value: null };
  return isUuid(raw) ? { value: raw } : { error: "cursor の形が違います" };
}

/**
 * 検索語・単位の名前。なければ空。max 文字までに切り詰め、前後の空白は外す。
 * NUL(\u0000)が入っていれば断る(データベースが受け付けず 500 になるため)。name = 利用者に見せる問い合わせの名前
 */
export function parseText(raw: string | null, max: number, name: string): Parsed<string> {
  if (raw !== null && hasNul(raw)) return { error: `${name} に使えない文字が入っています` };
  return { value: (raw ?? "").slice(0, max).trim() };
}
