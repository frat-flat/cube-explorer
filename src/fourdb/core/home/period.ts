// 期間の表し方。period_end は含まない(半開区間 [period_start, period_end))ので、1 日戻した日の月を終わりにする。

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

type Ymd = { y: number; m: number; d: number };

function parseDate(s: string | null | undefined): Ymd | null {
  if (typeof s !== "string") return null;
  const g = DATE.exec(s);
  if (!g) return null;
  const y = Number(g[1]);
  const m = Number(g[2]);
  const d = Number(g[3]);
  if (y < 1 || m < 1 || m > 12 || d < 1 || d > daysIn(y, m)) return null;
  return { y, m, d };
}

function daysIn(y: number, m: number): number {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(m) ? 30 : 31;
}

const ym = (y: number, m: number): string => `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`;

/** 日付を 1 日戻したときの年月(月の 1 日なら前の月) */
function monthOfDayBefore({ y, m, d }: Ymd): { y: number; m: number } {
  if (d > 1) return { y, m };
  return m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
}

/**
 * 期間を "YYYY-MM" の範囲にする。start = 期間の始まり(含む)、endExclusive = 期間の終わり(含まない)。どちらも "YYYY-MM-DD"。
 * 例: 2025-10-01 〜 2026-10-01(含まない)→ 2025-10 〜 2026-09
 * endExclusive が null なら、始まりの月だけ(from = to)。始まりが読めない・終わりが始まりより前か同じなら null。
 */
export function formatPeriod(start: string | null | undefined, endExclusive: string | null | undefined): { from: string; to: string } | null {
  const s = parseDate(start);
  if (!s) return null;
  const from = ym(s.y, s.m);
  if (endExclusive === null || endExclusive === undefined) return { from, to: from };
  const e = parseDate(endExclusive);
  if (!e) return null;
  // 年・月・日の順に比べる(文字列にしてから比べても同じ)
  if (e.y * 10000 + e.m * 100 + e.d <= s.y * 10000 + s.m * 100 + s.d) return null;
  const last = monthOfDayBefore(e);
  return { from, to: ym(last.y, last.m) };
}
