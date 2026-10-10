// 一覧の見せ方。ホーム(core/home)と Task(core/tasks)で同じ形を使う。

/** 先頭から上限までの項目と、見せきれなかった数(more)。more が 0 なら全部出している */
export type Listed<T> = { items: T[]; more: number };

/** 並べ終えた全体から、先頭の limit 件を出し、残りの数を more にする(items は新しい配列) */
export function listed<T>(all: readonly T[], limit: number): Listed<T> {
  const n = Math.max(0, Math.trunc(limit));
  return { items: all.slice(0, n), more: Math.max(0, all.length - n) };
}

/** 文字の並べ方(UTF-16 の順)。ロケールや実行環境で変わらない。名前が同じ・順序が決まらないときの最後の決め手に使う */
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 日時の文字列(ISO 8601)を時刻の数にする。読めなければ null */
export function timeOf(iso: string | null | undefined): number | null {
  if (typeof iso !== "string") return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}
