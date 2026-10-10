// 日時の表示(日本時間 Asia/Tokyo を明示する)。サーバーで描いても、見ている人のブラウザで描いても同じ文字になる
// (見ている人の時刻帯に左右されないので、ハイドレーションの食い違いが起きない)。年つきの 2026-10-10 / 2026-10-10 14:05 の形。

const TOKYO = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function tokyoParts(iso: string): { y: string; mo: string; d: string; h: string; mi: string } | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const p: Record<string, string> = {};
  for (const part of TOKYO.formatToParts(date)) p[part.type] = part.value;
  return { y: p.year, mo: p.month, d: p.day, h: p.hour, mi: p.minute };
}

/** 「2026-10-10 14:05」(日本時間)。読めない日時は空 */
export function formatDateTimeTokyo(iso: string): string {
  const t = tokyoParts(iso);
  return t ? `${t.y}-${t.mo}-${t.d} ${t.h}:${t.mi}` : "";
}

/** 「2026-10-10」(日本時間の日付)。読めない日時は空 */
export function formatDateTokyo(iso: string): string {
  const t = tokyoParts(iso);
  return t ? `${t.y}-${t.mo}-${t.d}` : "";
}
