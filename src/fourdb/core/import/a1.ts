// スプシの列記号(A, B, …, Z, AA, AB, …)と、セルの番地(B4・$B$4・B4:M4)。行・列は 0 始まりで扱う。

/** 0 → A、25 → Z、26 → AA */
export function colLetter(index: number): string {
  if (!Number.isInteger(index) || index < 0) throw new RangeError(`列の番号が正しくありません: ${index}`);
  let s = "";
  let n = index + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** A → 0、Z → 25、AA → 26 */
export function colIndex(letters: string): number {
  if (!/^[A-Za-z]+$/.test(letters)) throw new RangeError(`列記号が正しくありません: ${letters}`);
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export type CellRef = { col: number; row: number };
export type RangeRef = { c0: number; r0: number; c1: number; r1: number };

/** B4・$B$4 → { col: 1, row: 3 } */
export function parseCellRef(ref: string): CellRef | null {
  const m = ref.match(/^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/);
  if (!m) return null;
  const row = Number(m[2]) - 1;
  return row < 0 ? null : { col: colIndex(m[1]), row };
}

/** B4:M4 または B4 → 範囲(向きはそろえる) */
export function parseRangeRef(ref: string): RangeRef | null {
  const [a, b] = ref.split(":");
  const p = parseCellRef(a);
  if (!p) return null;
  const q = b === undefined ? p : parseCellRef(b);
  if (!q) return null;
  return { c0: Math.min(p.col, q.col), r0: Math.min(p.row, q.row), c1: Math.max(p.col, q.col), r1: Math.max(p.row, q.row) };
}

/** 範囲 → 'タブ名'!A1:C10 の形(タブ名の ' は '' にする) */
export function a1Range(tab: string, range: RangeRef): string {
  return `'${tab.replace(/'/g, "''")}'!${colLetter(range.c0)}${range.r0 + 1}:${colLetter(range.c1)}${range.r1 + 1}`;
}
