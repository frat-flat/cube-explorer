// 列名から年月を読む(横に並んだ月の列)。年が書かれていない「4月」は、タブ名・グループ名の年から決める。
// 年度のように 4月 … 12月 → 1月 と戻ったら、そこから翌年とみなす。

const EN = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export type MonthLabel = { year: number | null; month: number };

/** 列名 1つを読む。年が書かれていなければ year = null */
export function parseMonthLabel(label: string): MonthLabel | null {
  const s = label.trim().replace(/\s+/g, "");
  let m = s.match(/^(20\d{2})[-/.年](\d{1,2})月?(分)?$/);
  if (m) return valid(Number(m[1]), Number(m[2]));
  m = s.match(/^(20\d{2})(\d{2})$/);
  if (m) return valid(Number(m[1]), Number(m[2]));
  m = s.match(/^(\d{1,2})月(分)?$/);
  if (m) return valid(null, Number(m[1]));
  m = s.match(/^([A-Za-z]{3})[a-z]*\.?$/);
  if (m) {
    const i = EN.indexOf(m[1].toLowerCase());
    if (i >= 0) return { year: null, month: i + 1 };
  }
  return null;
}

function valid(year: number | null, month: number): MonthLabel | null {
  return month >= 1 && month <= 12 ? { year, month } : null;
}

/** 文字列の中の年(2026・2026年・FY2026) */
export function yearIn(text: string | null | undefined): number | null {
  const m = (text ?? "").match(/(?:^|[^\d])(20\d{2})(?!\d)/);
  return m ? Number(m[1]) : null;
}

export const ym = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;

/**
 * 列ごとの年月(YYYY-MM)。月でない列は null。
 * 年は 列名 → グループ名 → タブ名 の順に探し、見つからなければ年なし(要確認)とする。
 */
export function monthColumns(
  headers: { label: string; group: string | null }[],
  tabTitle: string,
): { months: (string | null)[]; missingYear: number[] } {
  const months: (string | null)[] = headers.map(() => null);
  const missingYear: number[] = [];
  const tabYear = yearIn(tabTitle);
  let prev: { year: number; month: number } | null = null;
  headers.forEach((h, i) => {
    const p = parseMonthLabel(h.label);
    if (!p) return;
    let year = p.year ?? yearIn(h.group);
    if (year === null && prev) year = p.month < prev.month ? prev.year + 1 : prev.year;   // 年度で 12月 → 1月 と戻ったら翌年
    if (year === null) year = tabYear;
    if (year === null) {
      missingYear.push(i);
      return;
    }
    months[i] = ym(year, p.month);
    prev = { year, month: p.month };
  });
  return { months, missingYear };
}
