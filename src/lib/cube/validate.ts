// 設計書 7.1-1:CubeSpec をメタデータで検証する。存在しない軸・列・集約は拒否する
import type { Meta } from "@/lib/meta/load";
import type { TimeGrain } from "@/lib/meta/axes";
import {
  MAX_PER_AXIS,
  type AxisIndex,
  type AxisRef,
  type CubeSpec,
  type FaceRequest,
  type Filter,
} from "./types";

export class CubeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CubeError";
  }
}

const GRAINS: readonly TimeGrain[] = ["day", "week", "month", "year"];
// latest / list(文字データ)はスプリント2で対応する
const SUPPORTED_AGGS = ["sum", "avg", "count", "min", "max"] as const;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isIndex = (v: unknown): v is AxisIndex => v === 0 || v === 1 || v === 2;

export function validateSpec(input: unknown, meta: Meta): CubeSpec {
  if (!isObj(input)) throw new CubeError("spec がありません");

  const fact = isStr(input.fact) ? meta.facts.get(input.fact) : undefined;
  if (!fact) throw new CubeError(`事実テーブル「${String(input.fact)}」は定義されていません`);

  const usableAxis = (key: unknown, where: string) => {
    if (!isStr(key) || !meta.axes.has(key) || !(key in fact.axisColumns)) {
      throw new CubeError(`${where}:軸「${String(key)}」は「${fact.label}」では使えません`);
    }
    const axis = meta.axes.get(key)!;
    if (axis.kind === "columns") {
      throw new CubeError(`${where}:「${axis.label}」のような列名の軸はまだ使えません(スプリント2で対応)`);
    }
    return axis;
  };

  if (!Array.isArray(input.axes) || input.axes.length !== 3) {
    throw new CubeError("軸はちょうど3本指定してください");
  }
  const axes = input.axes.map((ref, i): AxisRef => {
    if (!isObj(ref)) throw new CubeError(`${i + 1}本目の軸の指定が不正です`);
    const axis = usableAxis(ref.key, `${i + 1}本目の軸`);
    if (ref.grain === undefined) return { key: axis.key };
    if (axis.kind !== "time" || !GRAINS.includes(ref.grain as TimeGrain)) {
      throw new CubeError(`「${axis.label}」に粒度「${String(ref.grain)}」は指定できません`);
    }
    return { key: axis.key, grain: ref.grain as TimeGrain };
  }) as CubeSpec["axes"];
  if (new Set(axes.map((a) => a.key)).size !== 3) {
    throw new CubeError("同じ軸を2か所以上に指定することはできません");
  }

  if (!isObj(input.measure)) throw new CubeError("値(measure)の指定がありません");
  const measureKey = input.measure.key;
  const measure = fact.measures.find((m) => m.key === measureKey);
  if (!measure) {
    throw new CubeError(`値「${String(input.measure.key)}」は「${fact.label}」にありません`);
  }
  const agg = input.measure.agg;
  if (!measure.aggs.includes(agg as never)) {
    throw new CubeError(`「${measure.label}」に集約「${String(agg)}」は使えません`);
  }
  if (!SUPPORTED_AGGS.includes(agg as never)) {
    throw new CubeError(`集約「${String(agg)}」はまだ使えません(スプリント2で対応)`);
  }

  const rawFilters = input.filters ?? [];
  if (!Array.isArray(rawFilters)) throw new CubeError("filters は配列で指定してください");
  const filters = rawFilters.map((f, i): Filter => {
    if (!isObj(f)) throw new CubeError(`${i + 1}番目の条件の指定が不正です`);
    const axis = usableAxis(f.axis, `${i + 1}番目の条件`);
    if (f.op === "eq" && isStr(f.value)) return { axis: axis.key, op: "eq", value: f.value };
    if (f.op === "in" && Array.isArray(f.value) && f.value.length > 0 && f.value.every(isStr)) {
      return { axis: axis.key, op: "in", value: f.value };
    }
    if (f.op === "between" && Array.isArray(f.value) && f.value.length === 2 && f.value.every(isStr)) {
      return { axis: axis.key, op: "between", value: [f.value[0], f.value[1]] };
    }
    throw new CubeError(`${i + 1}番目の条件(${axis.label})の op または value が不正です`);
  });

  let perAxis = MAX_PER_AXIS;
  if (input.limits !== undefined) {
    const p = isObj(input.limits) ? input.limits.perAxis : undefined;
    if (p !== undefined) {
      if (!Number.isInteger(p) || (p as number) < 1 || (p as number) > MAX_PER_AXIS) {
        throw new CubeError(`limits.perAxis は 1〜${MAX_PER_AXIS} の整数で指定してください`);
      }
      perAxis = p as number;
    }
  }

  return {
    fact: fact.key,
    axes,
    measure: { key: measure.key, agg: agg as CubeSpec["measure"]["agg"] },
    filters,
    limits: { perAxis },
  };
}

export function validateFaceRequest(input: unknown, meta: Meta): FaceRequest {
  if (!isObj(input)) throw new CubeError("リクエストの形式が不正です");
  const spec = validateSpec(input.spec, meta);

  const view = input.view;
  if (!isObj(view) || !isIndex(view.rows) || !isIndex(view.cols) || view.rows === view.cols) {
    throw new CubeError("view.rows と view.cols には 0〜2 の異なる番号を指定してください");
  }

  const depth = input.depth;
  if (!isObj(depth)) throw new CubeError("depth の指定がありません");
  if (depth.mode === "aggregate") {
    return { spec, view: { rows: view.rows, cols: view.cols }, depth: { mode: "aggregate" } };
  }
  if (depth.mode === "slice" && isStr(depth.member)) {
    return {
      spec,
      view: { rows: view.rows, cols: view.cols },
      depth: { mode: "slice", member: depth.member },
    };
  }
  throw new CubeError("depth.mode は aggregate か slice(member 付き)で指定してください");
}
