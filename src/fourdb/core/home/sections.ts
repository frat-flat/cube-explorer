// 右の欄(と、3D が使えないときの平らなタイル)の欄の並び。どの利用者でも同じ並びで、値がない欄は「—」(D-017)。
// ここは並びと中身だけを決める。「—」や見出しの文字は labels.ts(画面側で使う)。
import type { HomeUnit, Listed, UnitRef } from "./types";

/** 欄の並び(固定) */
export const SECTION_IDS = ["names", "inside", "cardFields", "measures", "period", "sheets", "tables", "cube", "bands"] as const;
export type SectionId = (typeof SECTION_IDS)[number];

/**
 * 欄ひとつ。value が null の欄は「値がない」(画面は「—」を出す)。
 * cube・bands は、まだ作っていない欄(phase = 作る段階)。value はいつも null。
 */
export type Section =
  | { id: "names"; value: Listed<string> | null }
  | { id: "inside"; value: Listed<UnitRef> | null }
  | { id: "cardFields"; value: Listed<string> | null }
  | { id: "measures"; value: Listed<{ name: string; calculated: boolean }> | null }
  | { id: "period"; value: { from: string; to: string } | null }
  | { id: "sheets"; value: HomeUnit["sheets"] }
  | { id: "tables"; value: Listed<{ id: string; name: string }> | null }
  | { id: "cube"; value: null; phase: "P8" }
  | { id: "bands"; value: null; phase: "P11" };

/** 単位の欄を、固定の順で全部返す。値がなければ value は null(欄そのものは省かない) */
export function sectionsOf(unit: HomeUnit): Section[] {
  return [
    { id: "names", value: unit.names.items.length ? unit.names : null },
    { id: "inside", value: unit.inside?.items.length ? unit.inside : null },
    { id: "cardFields", value: unit.cardFields?.items.length ? unit.cardFields : null },
    { id: "measures", value: unit.measures?.items.length ? unit.measures : null },
    { id: "period", value: unit.period },
    { id: "sheets", value: unit.sheets?.items.length ? unit.sheets : null },
    { id: "tables", value: unit.tables?.items.length ? unit.tables : null },
    { id: "cube", value: null, phase: "P8" },
    { id: "bands", value: null, phase: "P11" },
  ];
}
