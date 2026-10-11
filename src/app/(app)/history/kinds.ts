// 履歴の表示の決まり(ホームの「最近の履歴」と /history で同じにする。画面の外で試せるように切り出してある)
import type { HistoryItem } from "@/fourdb/adapters/postgres/history";

/** 履歴の種類(fourdb.history.kind)の、画面に出す日本語の名前。ここにない種類は「その他」 */
const KIND_NAMES = new Map([
  ["import", "取り込み"],
  ["definition", "表の保存"],
]);
export const kindName = (kind: string): string => KIND_NAMES.get(kind) ?? "その他";

export type HistoryLink = { href: string; label: string };

/**
 * 履歴から移れる画面。取り込み(import)は Import、表の保存(definition)は、保存した表を開いた Table。
 * 移れる先のない種類・保存した表の id がない記録は null
 */
export function historyLink(item: Pick<HistoryItem, "kind" | "definitionId">): HistoryLink | null {
  if (item.kind === "import") return { href: "/migrate", label: "Import を開く" };
  if (item.kind === "definition" && item.definitionId) return { href: `/table?def=${encodeURIComponent(item.definitionId)}`, label: "Table で開く" };
  return null;
}

/** 日時を「2026-10-08 14:05」の形に(見ている人の時刻で) */
export function formatAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
