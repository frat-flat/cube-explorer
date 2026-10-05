// 設計書 7. クエリエンジン:CubeSpec → 安全なSQL
// 7.2 安全性:テーブル名・列名はメタデータの値からのみ組み立て、値はすべてパラメータ化する。
// ここで組み立てる文字列に、リクエストから来た文字列がそのまま入ることはない
// (軸・値・集約・粒度は validate.ts でメタデータや固定の一覧と照合済み)
import type { Axis, TimeGrain } from "@/lib/meta/axes";
import type { Fact } from "@/lib/meta/facts";
import type { Meta } from "@/lib/meta/load";
import type { AxisRef, FaceRequest, Filter } from "./types";
import { CubeError } from "./validate";

export type Query = { text: string; params: unknown[] };

export const TIME_ZONE = "Asia/Tokyo";

// 時間軸の目盛りのキー(文字列)の形
const TIME_KEY_FORMAT: Record<TimeGrain, string> = {
  day: "YYYY-MM-DD",
  week: "YYYY-MM-DD", // 週の始まり(月曜)の日付
  month: "YYYY-MM",
  year: "YYYY",
};

/** メタデータ由来の識別子を引用符で囲む。想定外の文字を含むものは使わない */
export function ident(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new CubeError(`メタデータの識別子「${name}」は使えない文字を含んでいます`);
  }
  return `"${name}"`;
}

class Params {
  readonly values: unknown[] = [];
  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

/** 1本の軸の、目盛りのキーを返す列式(text 型)と、必要な結合 */
export type AxisExpr = { axis: Axis; grain: TimeGrain | null; expr: string; join: string | null };

export function axisExpr(meta: Meta, fact: Fact, ref: AxisRef): AxisExpr {
  const axis = meta.axes.get(ref.key);
  const column = fact.axisColumns[ref.key];
  if (!axis || !column) throw new CubeError(`軸「${ref.key}」は「${fact.label}」では使えません`);
  const col = `f.${ident(column)}`;

  switch (axis.kind) {
    case "time": {
      const grain = ref.grain ?? axis.timeGrain;
      if (!grain) throw new CubeError(`時間軸「${axis.label}」に粒度が設定されていません`);
      const expr = `to_char(date_trunc('${grain}', ${col} at time zone '${TIME_ZONE}'), '${TIME_KEY_FORMAT[grain]}')`;
      return { axis, grain, expr, join: null };
    }
    case "entity":
      return { axis, grain: null, expr: `${col}::text`, join: null };
    case "attribute": {
      // source_table が事実テーブル自身なら、その列をそのまま使う
      if (!axis.sourceTable || axis.sourceTable === fact.sourceTable) {
        return { axis, grain: null, expr: `${col}::text`, join: null };
      }
      // 別テーブルなら key_column で結合して source_column を使う(設計書 5.2)
      if (!axis.keyColumn || !axis.sourceColumn) {
        throw new CubeError(`軸「${axis.label}」に結合用の key_column / source_column が設定されていません`);
      }
      const alias = `j_${axis.key}`;
      return {
        axis,
        grain: null,
        expr: `${ident(alias)}.${ident(axis.sourceColumn)}::text`,
        join: `left join ${ident(axis.sourceTable)} ${ident(alias)} on ${ident(alias)}.${ident(axis.keyColumn)} = ${col}`,
      };
    }
    case "columns":
      throw new CubeError(`「${axis.label}」のような列名の軸はまだ使えません(スプリント2で対応)`);
  }
}

function filterCondition(e: AxisExpr, f: Filter, params: Params): string {
  switch (f.op) {
    case "eq":
      return `${e.expr} = ${params.add(f.value)}`;
    case "in":
      return `${e.expr} = any(${params.add(f.value)}::text[])`;
    case "between":
      return `${e.expr} between ${params.add(f.value[0])} and ${params.add(f.value[1])}`;
  }
}

function measureExpr(fact: Fact, key: string, agg: string): string {
  const measure = fact.measures.find((m) => m.key === key);
  if (!measure) throw new CubeError(`値「${key}」は「${fact.label}」にありません`);
  const col = `f.${ident(measure.column)}`;
  switch (agg) {
    case "sum":
    case "avg":
    case "min":
    case "max":
    case "count":
      return `${agg}(${col})`;
    default:
      throw new CubeError(`集約「${agg}」はまだ使えません`);
  }
}

/** 行・列・奥行きの列式と、条件(filters と断面)を組み立てる共通部分 */
function prepare(req: FaceRequest, meta: Meta) {
  const { spec, view } = req;
  const fact = meta.facts.get(spec.fact);
  if (!fact) throw new CubeError(`事実テーブル「${spec.fact}」は定義されていません`);
  const depthIndex = ([0, 1, 2] as const).find((i) => i !== view.rows && i !== view.cols)!;

  const rows = axisExpr(meta, fact, spec.axes[view.rows]);
  const cols = axisExpr(meta, fact, spec.axes[view.cols]);
  const depth = axisExpr(meta, fact, spec.axes[depthIndex]);

  const params = new Params();
  const used: AxisExpr[] = [];
  const conditions: string[] = [];
  for (const f of spec.filters) {
    const ref = spec.axes.find((a) => a.key === f.axis) ?? { key: f.axis };
    const e = axisExpr(meta, fact, ref);
    used.push(e);
    conditions.push(filterCondition(e, f, params));
  }
  return { fact, rows, cols, depth, params, used, conditions };
}

function fromClause(fact: Fact, exprs: AxisExpr[]): string {
  const joins = [...new Set(exprs.map((e) => e.join).filter((j): j is string => j !== null))];
  return [`from ${ident(fact.sourceTable)} f`, ...joins].join("\n");
}

function whereClause(conditions: string[]): string {
  return conditions.length ? `where ${conditions.join("\n  and ")}` : "";
}

/**
 * 面のSQL。行・列の2軸で group by する。
 * 奥行きは、集約なら group by に含めずSQLで潰し、断面ならその値を条件に加える(設計書 7.1-3)
 */
export function buildFaceQuery(req: FaceRequest, meta: Meta): Query {
  const { fact, rows, cols, depth, params, used, conditions } = prepare(req, meta);
  const exprs = [rows, cols, ...used];
  if (req.depth.mode === "slice") {
    exprs.push(depth);
    conditions.push(`${depth.expr} = ${params.add(req.depth.member)}`);
  }
  const text = [
    `select ${rows.expr} as r, ${cols.expr} as c, ${measureExpr(fact, req.spec.measure.key, req.spec.measure.agg)} as v`,
    fromClause(fact, exprs),
    whereClause(conditions),
    "group by 1, 2",
  ]
    .filter(Boolean)
    .join("\n");
  return { text, params: params.values };
}

/** 奥行きの軸の目盛り一覧(断面の値を選ぶため)。filters は効かせ、断面の条件は外す */
export function buildDepthMembersQuery(req: FaceRequest, meta: Meta, limit: number): Query {
  const { fact, depth, params, used, conditions } = prepare(req, meta);
  const text = [
    `select distinct ${depth.expr} as k`,
    fromClause(fact, [depth, ...used]),
    whereClause(conditions),
    `order by 1 limit ${params.add(limit)}`,
  ]
    .filter(Boolean)
    .join("\n");
  return { text, params: params.values };
}

/** entity 軸の表示名を label_column から引く(設計書 7.1-4) */
export function buildLabelsQuery(axis: Axis, keys: string[]): Query | null {
  if (axis.kind !== "entity" || !axis.sourceTable || !axis.sourceColumn || !axis.labelColumn) return null;
  const col = ident(axis.sourceColumn);
  return {
    text: `select ${col}::text as k, ${ident(axis.labelColumn)}::text as l from ${ident(axis.sourceTable)} where ${col}::text = any($1::text[])`,
    params: [keys],
  };
}
