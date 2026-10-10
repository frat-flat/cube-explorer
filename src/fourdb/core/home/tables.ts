// 単位と Table(保存した表の定義)の照合。単位の「Table」の欄に出す表を選ぶ。
import { compareText, listed, timeOf, type Listed } from "../listed";
import { HOME_LIMITS } from "./limits";

/** SQL の Q4 の 1 行。definition は sheet_definition.definition(jsonb)。形が違っても落とさない */
export type TableCandidate = { id: string; name: string; updatedAt: string; definition: unknown };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** 定義が使っている軸(rows・columns・filters の dimensionId)。形が違うところは数えない */
export function dimensionsOf(definition: unknown): string[] {
  if (!isRecord(definition)) return [];
  const out: string[] = [];
  for (const k of ["rows", "columns"] as const) {
    const a = definition[k];
    if (isRecord(a) && typeof a.dimensionId === "string") out.push(a.dimensionId);
  }
  if (Array.isArray(definition.filters)) {
    for (const f of definition.filters) if (isRecord(f) && typeof f.dimensionId === "string") out.push(f.dimensionId);
  }
  return out;
}

/** 定義が対象にしているシート(sources)。null / なし = すべてのシート。形が違えば "invalid" */
export function sourcesOf(definition: unknown): string[] | null | "invalid" {
  if (!isRecord(definition)) return "invalid";
  const s = definition.sources;
  if (s === null || s === undefined) return null;
  if (!Array.isArray(s) || !s.every((x) => typeof x === "string")) return "invalid";
  return s;
}

/**
 * 単位に合う表を選ぶ。dimensionIds = 単位の Box が軸の値になっている軸(D)、sheetIds = 単位の元のシート(S)。
 * 合う = 定義の rows・columns・filters のどれかの軸が D と重なる、かつ
 *   sources が null(すべてのシート)なら軸だけで合う / sources があれば S と重なるときだけ合う。
 * updated_at の新しい順(同じなら名前 → id)で 3 件まで、残りは more。1 つも合わなければ null。
 */
export function matchTables(tables: readonly TableCandidate[], dimensionIds: readonly string[], sheetIds: readonly string[]): Listed<{ id: string; name: string }> | null {
  if (dimensionIds.length === 0) return null;
  const D = new Set(dimensionIds);
  const S = new Set(sheetIds);
  const hit = tables.filter((t) => {
    if (!dimensionsOf(t.definition).some((d) => D.has(d))) return false;
    const src = sourcesOf(t.definition);
    if (src === "invalid") return false;
    return src === null || src.some((s) => S.has(s));
  });
  if (hit.length === 0) return null;
  hit.sort((a, b) => (timeOf(b.updatedAt) ?? -Infinity) - (timeOf(a.updatedAt) ?? -Infinity) || compareText(a.name, b.name) || compareText(a.id, b.id));
  const l = listed(hit, HOME_LIMITS.tables);
  return { items: l.items.map((t) => ({ id: t.id, name: t.name })), more: l.more };
}
