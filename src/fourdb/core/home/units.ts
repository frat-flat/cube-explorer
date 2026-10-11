// ホームの単位(規則 R)。いちばん上の Box(親のない Box)を unit_type ごとにまとめ、1 単位 = 1 つの立体にする。
import { compareText, listed, type Listed } from "../listed";
import { HOME_LIMITS } from "./limits";
import type { UnitRef } from "./types";

/** 単位のない Box の名前(unit_type が null か '') */
export const NO_UNIT_LABEL = "(単位なし)";

/** unit_type を単位の種類にそろえる: '' も null("単位なし")にする。空白だけの文字は別の単位として残す */
export function normalizeUnitType(unitType: string | null | undefined): string | null {
  return typeof unitType === "string" && unitType !== "" ? unitType : null;
}

/** 単位の目印(HomeUnit.key)。"u:<unitType>" か "none" */
export function unitKey(unitType: string | null | undefined): string {
  const u = normalizeUnitType(unitType);
  return u === null ? "none" : `u:${u}`;
}

/** Box の単位の名前(単位のない Box は「(単位なし)」) */
export const unitLabel = (unitType: string | null): string => (unitType ? unitType : NO_UNIT_LABEL);

/** SQL の Q1 の 1 行。いちばん上の Box を nullif(unit_type, '') でまとめたもの。hasChildren = その単位に子を持つ Box がある */
export type UnitGroup = { unitType: string | null; count: number; hasChildren: boolean };

export type OrderedUnits = {
  /** 立体にする単位(6 つまで)。並べた順 */
  shown: UnitGroup[];
  /** 7 つ目から。30 件まで、残りは more */
  others: Listed<UnitRef>;
};

const countOf = (n: number): number => (Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0);

/** いちばん上の Box の総数(数が 0 以下の行は数えない) */
export function totalBoxes(groups: readonly { count: number }[]): number {
  return groups.reduce((a, g) => a + countOf(g.count), 0);
}

/** 単位の並べ方: 子のある単位 → 数の多い順 → 名前(UTF-16 の順。単位なしは最後) */
export function compareUnits(a: UnitGroup, b: UnitGroup): number {
  if (a.hasChildren !== b.hasChildren) return a.hasChildren ? -1 : 1;
  if (a.count !== b.count) return b.count - a.count;
  return compareUnitTypes(a.unitType, b.unitType);
}

/** 名前の順。単位なし(null)は最後 */
export function compareUnitTypes(a: string | null, b: string | null): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  return compareText(a, b);
}

/**
 * 規則 R: 単位を並べ、6 つまでを立体にして、残りを「ほかの単位」にする。
 * '' は null と同じ単位として足し合わせる(SQL が nullif していても、していなくても同じ結果)。数が 0 以下の行は捨てる。
 * 入力は並んでいなくてよい。入力は書き換えない。
 */
export function orderUnits(groups: readonly UnitGroup[]): OrderedUnits {
  const merged = new Map<string | null, UnitGroup>();
  for (const g of groups) {
    const count = countOf(g.count);
    if (count === 0) continue;
    const unitType = normalizeUnitType(g.unitType);
    const prev = merged.get(unitType);
    if (prev) {
      prev.count += count;
      prev.hasChildren = prev.hasChildren || g.hasChildren;
    } else merged.set(unitType, { unitType, count, hasChildren: g.hasChildren });
  }
  const sorted = [...merged.values()].sort(compareUnits);
  const shown = sorted.slice(0, HOME_LIMITS.units);
  const rest = sorted.slice(HOME_LIMITS.units).map((g): UnitRef => ({ unitType: g.unitType, count: g.count }));
  return { shown, others: listed(rest, HOME_LIMITS.others) };
}

/** 「中に」の並べ方(単位ごとの数): 多い順 → 名前(単位なしは最後)。'' は null にそろえて足し合わせる */
export function orderUnitRefs(refs: readonly UnitRef[]): UnitRef[] {
  const merged = new Map<string | null, UnitRef>();
  for (const r of refs) {
    const count = countOf(r.count);
    if (count === 0) continue;
    const unitType = normalizeUnitType(r.unitType);
    const prev = merged.get(unitType);
    if (prev) prev.count += count;
    else merged.set(unitType, { unitType, count });
  }
  return [...merged.values()].sort((a, b) => b.count - a.count || compareUnitTypes(a.unitType, b.unitType));
}
