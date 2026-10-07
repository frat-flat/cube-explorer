// 表の読み方: 何行目を列名にするか(header)、その上のグループ名の行(group。口座情報・2026年 など)。
// 今の画面(public/sheets/axes.html の mkLayout・groupsOf・shapeGrid)と同じ考え方を、芯へ移したもの。
import { colLetter } from "./a1";
import type { Merge } from "./types";

export type Layout = { headerRow: number; groupRow: number | null };
export type ColumnHeader = { index: number; letter: string; label: string; group: string | null };

const isNumText = (v: string) => /^[¥￥$]?-?[\d,.]+%?$/.test(v.trim());
/** A・C・AJ・H列 のような、列の記号だけを並べた目印の行 */
const isLetterRow = (r: string[]) => {
  const vs = r.filter(Boolean);
  return vs.length >= 2 && vs.filter((v) => /^[A-Z]{1,3}列?$/.test(v)).length >= vs.length * 0.6;
};

/** 上の 10 行のうち、文字(数字でない)のマスがいちばん多い行を列名の行とみなす(同じなら上の行) */
export function detectLayout(grid: string[][], merges: Merge[] = []): Layout {
  const rows = grid.map((r) => r.map((v) => (v ?? "").trim()));
  let headerRow = 0;
  let best = -1;
  rows.slice(0, 10).forEach((r, i) => {
    const n = isLetterRow(r) ? 0 : r.filter((v) => v && !isNumText(v)).length;
    if (n > best) {
      best = n;
      headerRow = i;
    }
  });
  // すぐ上の行が結合セルか、A 列以外に値があり、列名の行より少なければグループ名の行(A1 だけの表題は除く)
  const up = headerRow > 0 ? rows[headerRow - 1] : [];
  const upN = up.filter(Boolean).length;
  const merged = merges.some((m) => m.r0 <= headerRow - 1 && headerRow - 1 < m.r1);
  const groupRow = headerRow > 0 && upN > 0 && upN < best && (merged || up.some((v, i) => v && i > 0)) ? headerRow - 1 : null;
  return { headerRow, groupRow };
}

/** 列ごとのグループ名。結合セルがあればその範囲、なければ空のマスを左のグループの続きとみなす */
function groupsOf(grid: string[][], layout: Layout, width: number, merges: Merge[]): (string | null)[] {
  const g: (string | null)[] = Array(width).fill(null);
  if (layout.groupRow === null) return g;
  const row = (grid[layout.groupRow] ?? []).map((v) => (v ?? "").trim());
  const ms = merges.filter((m) => m.r0 <= layout.groupRow! && layout.groupRow! < m.r1);
  if (ms.length) {
    for (const m of ms) for (let c = m.c0; c < m.c1 && c < width; c++) g[c] = row[m.c0] || null;
    row.forEach((v, c) => {
      if (c < width && !g[c] && v) g[c] = v;
    });
    return g;
  }
  let cur: string | null = null;
  for (let c = 0; c < width; c++) {
    if (row[c]) cur = row[c];
    g[c] = cur;
  }
  return g;
}

/** 列名(空なら「B列」)と、グループ名 */
export function columnHeaders(grid: string[][], layout: Layout, width: number, merges: Merge[] = []): ColumnHeader[] {
  const head = (grid[layout.headerRow] ?? []).map((v) => (v ?? "").trim());
  const groups = groupsOf(grid, layout, width, merges);
  return Array.from({ length: width }, (_, i) => ({
    index: i,
    letter: colLetter(i),
    label: head[i] || `${colLetter(i)}列`,
    group: groups[i] && groups[i] !== head[i] ? groups[i] : null,
  }));
}
