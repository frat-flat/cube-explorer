// ホームの API(GET /api/4db/home)の形。画面・API・SQL のつなぎ(adapters)で同じものを使う。
import type { Listed } from "../listed";

export type { Listed };

export type UnitRef = { unitType: string | null; count: number };

export type HomeUnit = {
  /** "u:<unitType>" | "none"(unitType が null) */
  key: string;
  /** null →「(単位なし)」('' も null) */
  unitType: string | null;
  count: number;
  /** (name, id) の順で 5 件。more = 数 - 件数 */
  names: Listed<string>;
  /** 子孫(すべての段)を単位ごとに。多い順 */
  inside: Listed<UnitRef> | null;
  /** 列の順(いちばん左の位置 → 名前) */
  cardFields: Listed<string> | null;
  measures: Listed<{ name: string; calculated: boolean }> | null;
  /** "YYYY-MM"(to を含む。period_end は含まないので 1 日戻したもの) */
  period: { from: string; to: string } | null;
  sheets: (Listed<{ sheetId: string; file: string; sheet: string }> & { lastReadAt: string | null }) | null;
  /** updated_at の新しい順 */
  tables: Listed<{ id: string; name: string }> | null;
};

export type HomeOverview = { units: HomeUnit[]; others: Listed<UnitRef>; topBoxes: number };
