// 読み取りのつなぎ(summary・history・boxes)の、入力の守り。API(src/app/api/4db/params.ts)でも確かめているが、
// つなぎだけが呼ばれたとき(別の入れ物から・API の検証をすり抜けたとき)も、データベースの 500 にならず、決まった形で断る。
import { ImportError } from "./import-store";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string): boolean => UUID.test(s);

/** NUL(\u0000)。PostgreSQL の text に入れられず、渡すと 22021 で止まる。どの名前・検索語にもなりえない */
export const hasNul = (s: string): boolean => s.includes("\u0000");

/** NUL を含む値は 400 で断る(label は利用者に見せる名前) */
export function rejectNul(value: string, label: string): void {
  if (hasNul(value)) throw new ImportError(`${label} に使えない文字が入っています`, 400);
}

/** 件数の指定。数でない・有限でないものは既定、整数にして 1〜max に丸める */
export function clampLimit(raw: number | undefined, def: number, max: number): number {
  if (raw === undefined || !Number.isFinite(raw)) return def;
  return Math.min(Math.max(Math.trunc(raw), 1), max);
}
