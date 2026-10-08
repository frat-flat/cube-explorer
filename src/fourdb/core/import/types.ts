// 取り込みで扱う元のセル。v = 見た目のまま(書式つき)、n = 数値(数でなければ null)、f = 関数(なければ null)
export type SourceCell = { v: string; n: number | null; f: string | null };

/** 結合セル。行・列は 0 から、終わりは含まない */
export type Merge = { r0: number; r1: number; c0: number; c1: number };

export const EMPTY_CELL: SourceCell = { v: "", n: null, f: null };

export const cellAt = (rows: SourceCell[][], r: number, c: number): SourceCell => rows[r]?.[c] ?? EMPTY_CELL;
