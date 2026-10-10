// ホームの組み立て。SQL(adapters)が集めた事実(HomeFacts)から、API の返す形(HomeOverview)を作る。
// 並べ方・上限・分け方・照合はすべてここで決める(SQL は事実を集めるだけ)。
import { compareText, listed, timeOf } from "../listed";
import { HOME_LIMITS } from "./limits";
import { formatPeriod } from "./period";
import { matchTables, type TableCandidate } from "./tables";
import type { HomeOverview, HomeUnit, UnitRef } from "./types";
import { orderUnitRefs, orderUnits, totalBoxes, unitKey, type UnitGroup } from "./units";

/** 元のシート(S)の 1 つ。viaRows = そのシートの行がこの単位の Box に結ばれている(record.box_id) */
export type SheetFact = { sheetId: string; file: string; sheet: string; lastReadAt: string | null; viaRows: boolean };

/** 列(column_definition)ごとにまとめたもの。position = その列がいちばん左にある位置(col_index) */
export type ColumnFact = { name: string; position: number };

/** calculated = 今の値に計算された値(ƒ)がある。出す 12 個だけ調べればよい(orderColumns で並べた先頭 HOME_LIMITS.fields 個。残りは false でよい) */
export type MeasureFact = ColumnFact & { calculated: boolean };

/** 出す単位ひとつぶんの事実(SQL の Q2 以降) */
export type UnitFacts = {
  /** Q2a: (name, id) の順の先頭から。5 件より多ければ 5 件に切る */
  names: readonly string[];
  /** Q2b: 子孫(すべての段)を単位ごとに数えたもの。並んでいなくてよい */
  inside: readonly UnitRef[];
  /** Q2c: 元のシート(S)。消したシートとファイルは入れない。全部入れる(出すのは 3 件まで。残りの数は more になる) */
  sheets: readonly SheetFact[];
  /** Q2c: 単位の Box が軸の値になっている軸(D) */
  dimensionIds: readonly string[];
  /** Q3a: attribute の列(行で結ばれたシートのもの) */
  cardFields: readonly ColumnFact[];
  /** Q3a・Q3b: measure の列 */
  measures: readonly MeasureFact[];
  /** Q3c: 期間の始まり(含む)と終わり(含まない)。どちらも "YYYY-MM-DD"。なければ null */
  periodStart: string | null;
  periodEndExclusive: string | null;
};

export const EMPTY_UNIT_FACTS: UnitFacts = {
  names: [],
  inside: [],
  sheets: [],
  dimensionIds: [],
  cardFields: [],
  measures: [],
  periodStart: null,
  periodEndExclusive: null,
};

export type HomeFacts = {
  /** Q1: いちばん上の Box を単位ごとにまとめたもの(種類は HOME_LIMITS.unitTypes まで)。並んでいなくてよい */
  groups: readonly UnitGroup[];
  /** いちばん上の Box の総数。なければ groups の数の合計 */
  topBoxes?: number;
  /** 出す単位(orderUnits(groups).shown)ごとの事実。キーは unitKey。足りない単位は何も見つからなかったものとして扱う */
  units: ReadonlyMap<string, UnitFacts>;
  /** Q4: 表の定義(消していないもの。HOME_LIMITS.tableDefinitions まで) */
  tables: readonly TableCandidate[];
};

/** 列の並べ方: いちばん左の位置 → 名前。SQL の Q3b に渡す 12 個を決めるときにも使う */
export function orderColumns<T extends ColumnFact>(cols: readonly T[]): T[] {
  return [...cols].sort((a, b) => a.position - b.position || compareText(a.name, b.name));
}

/** 元のシートの並べ方: 行で結ばれたシート → 最後に取り込んだ日の新しい順(取り込みなしは後) → ファイル → シート → id */
export function orderSheets<T extends SheetFact>(sheets: readonly T[]): T[] {
  return [...sheets].sort(
    (a, b) =>
      Number(b.viaRows) - Number(a.viaRows) ||
      (timeOf(b.lastReadAt) ?? -Infinity) - (timeOf(a.lastReadAt) ?? -Infinity) ||
      compareText(a.file, b.file) ||
      compareText(a.sheet, b.sheet) ||
      compareText(a.sheetId, b.sheetId),
  );
}

/** 最後に取り込んだ日時(S 全体でいちばん新しいもの)。読めるものがなければ null */
function latestRead(sheets: readonly SheetFact[]): string | null {
  let best: { t: number; s: string } | null = null;
  for (const s of sheets) {
    const t = timeOf(s.lastReadAt);
    if (t !== null && s.lastReadAt !== null && (best === null || t > best.t)) best = { t, s: s.lastReadAt };
  }
  return best?.s ?? null;
}

function buildUnit(g: UnitGroup, f: UnitFacts, tables: readonly TableCandidate[]): HomeUnit {
  const names = f.names.slice(0, HOME_LIMITS.names);
  const inside = orderUnitRefs(f.inside);
  const cardFields = orderColumns(f.cardFields);
  const measures = orderColumns(f.measures);
  const sheets = orderSheets(f.sheets);
  const sheetList = listed(sheets, HOME_LIMITS.sheets);
  return {
    key: unitKey(g.unitType),
    unitType: g.unitType,
    count: g.count,
    names: { items: [...names], more: Math.max(0, g.count - names.length) },
    inside: inside.length ? listed(inside, HOME_LIMITS.fields) : null,
    cardFields: cardFields.length ? listed(cardFields.map((c) => c.name), HOME_LIMITS.fields) : null,
    measures: measures.length ? listed(measures.map((m) => ({ name: m.name, calculated: m.calculated })), HOME_LIMITS.fields) : null,
    period: formatPeriod(f.periodStart, f.periodEndExclusive),
    sheets: sheets.length
      ? {
          items: sheetList.items.map((s) => ({ sheetId: s.sheetId, file: s.file, sheet: s.sheet })),
          more: sheetList.more,
          lastReadAt: latestRead(sheets),
        }
      : null,
    tables: matchTables(tables, f.dimensionIds, sheets.map((s) => s.sheetId)),
  };
}

/** 事実から、ホームの API の返す形を作る。Box が 1 つもなければ units は空 */
export function buildHomeOverview(facts: HomeFacts): HomeOverview {
  const { shown, others } = orderUnits(facts.groups);
  return {
    units: shown.map((g) => buildUnit(g, facts.units.get(unitKey(g.unitType)) ?? EMPTY_UNIT_FACTS, facts.tables)),
    others,
    topBoxes: facts.topBoxes ?? totalBoxes(facts.groups),
  };
}
