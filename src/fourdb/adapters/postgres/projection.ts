// Projection Engine(② 21章)のデータベース側。行・列・絞り・段・集計のしかたから、表の形の結果を返す。
// 集計はデータベースの中で行い(② 29章)、明細・行の合計・列の合計・小計・総計を GROUPING SETS で1本の SQL で求める。
// 軸の値は「列 → 行 → 表全体」の順に探す(DATA_MODEL.md 3.2)。合計は軸の値にしない(② 30章-2)。
import { fromDefinition, toDefinition } from "@/fourdb/core/projection/definition";
import { shapeProjection } from "@/fourdb/core/projection/shape";
import { PROJECTION_LIMITS, type AggRow, type MemberInfo, type ProjectionRequest, type ProjectionResult } from "@/fourdb/core/projection/types";
import type { Tx } from "./db";
import { ImportError } from "./import-store";

/** JSON として保存する値(定義は JSON にできる形だけでできている) */
const asJson = (x: unknown) => x as Parameters<Tx["json"]>[0];

/**
 * 軸 D の軸の値を値ごとに引くための、3つの左結合(列 → 行 → 表全体)。alias は芯が決める固定の名前(利用者の入力ではない)。
 * 値ごとに小さな問い合わせをくり返すと大きい表で遅い(288 万個で 10 分以上)ので、表どうしを一度につなぐ(同じ量で 2 秒ほど)。
 */
const coordJoins = (tx: Tx, alias: string, dimensionId: string) => tx`
  left join fourdb.column_coord ${tx(alias + "_cc")} on ${tx(alias + "_cc")}.column_id = v.column_id and ${tx(alias + "_cc")}.dimension_id = ${dimensionId}
  left join fourdb.record_coord ${tx(alias + "_rc")} on ${tx(alias + "_rc")}.record_id = v.record_id and ${tx(alias + "_rc")}.dimension_id = ${dimensionId}
  left join fourdb.sheet_coord ${tx(alias + "_sc")} on ${tx(alias + "_sc")}.sheet_id = v.sheet_id and ${tx(alias + "_sc")}.dimension_id = ${dimensionId}`;
const coordValue = (tx: Tx, alias: string) => tx`coalesce(${tx(alias + "_cc")}.member_id, ${tx(alias + "_rc")}.member_id, ${tx(alias + "_sc")}.member_id)`;
/**
 * 軸の値(j.<from>)を、段 L の祖先につなぐ。祖先の一覧の (member_id, ancestor_level) の索引で引く(0004)。
 * 軸の値の id はどの軸でも重ならないので、軸の条件は要らない。alias は芯が決める固定の名前。
 */
const levelJoin = (tx: Tx, alias: string, from: "rm" | "cm", level: number) => tx`
  left join fourdb.member_ancestor ${tx(alias)} on ${tx(alias)}.member_id = ${from === "rm" ? tx`j.rm` : tx`j.cm`} and ${tx(alias)}.ancestor_level = ${level}`;

/** 段の名前。段の名前を決めていない軸(取り込みで作った1段の軸など)は、1段目を軸の名前で呼ぶ */
const levelLabel = (d: { name: string; levels: string[] }, level: number) =>
  d.levels[level] ?? (level === 0 && d.levels.length === 0 ? d.name : `${level + 1} 段目`);

/** データベースの中で集計・検索に使ってよい時間(API の上限 60 秒より短く。超えたら止めて知らせる) */
const PROJECTION_TIMEOUT = "50s";
const SEARCH_TIMEOUT = "10s";

export type ProjectionOutput = ProjectionResult & {
  measure: { id: string; name: string };
  rowAxis: { id: string; name: string; level: number | null; levelName: string | null; subtotalLevelName: string | null } | null;
  columnAxis: { id: string; name: string; level: number | null; levelName: string | null } | null;
  elapsedMs: number;
};

export async function project(tx: Tx, req: ProjectionRequest): Promise<ProjectionOutput> {
  const t0 = Date.now();
  const [measure] = await tx<{ id: string; name: string }[]>`
    select id, name from fourdb.column_definition where id = ${req.measureId} and kind = 'measure' and workspace_id = (select fourdb.current_workspace_id())`;
  if (!measure) throw new ImportError("数値のカラムが見つかりません", 404);
  const dims = new Map(
    (await tx<{ id: string; name: string; levels: string[] }[]>`
      select id, name, levels from fourdb.dimension
       where workspace_id = (select fourdb.current_workspace_id())
         and id = any(${[req.rows?.dimensionId, req.columns?.dimensionId, ...req.filters.map((f) => f.dimensionId)].filter(Boolean) as string[]}::uuid[])`).map((d) => [d.id, d]),
  );
  for (const a of [req.rows, req.columns, ...req.filters]) if (a && !dims.has(a.dimensionId)) throw new ImportError("軸が見つかりません", 404);

  // 3段で集める: ① 値ごとに元の軸の値(葉)を決めて確定させる(j)。② 葉を見たい段の祖先に付け替えて (s, r, c) ごとにまとめる(d)。
  // ③ その小さな結果から合計・小計を出す(GROUPING SETS は並列にできないため最後に回す)。
  // ① を確定させるのは、絞り込みで値が少ないのにデータベースが件数を見誤り、祖先の一覧を値ごとに全件なめるのを防ぐため。
  // 行か列の片方しかないときは、① で葉ごとにまとめておくと ② に渡る数が大きく減る(両方あるときは減らないので、まとめない)。
  const leafGroup = !req.rows || !req.columns;
  const fn = { SUM: tx`sum(d.su)`, COUNT: tx`sum(d.cn)`, AVG: tx`sum(d.su) / nullif(sum(d.cn), 0)`, MIN: tx`min(d.mi)`, MAX: tx`max(d.ma)` }[req.fn];
  const sheets = req.sheetIds ? tx`and v.sheet_id = any(${req.sheetIds}::uuid[])` : tx``;
  const hasSub = req.rows !== null && req.rows.subtotalLevel !== null;
  const empty = tx``;
  const joins = [
    req.rows ? coordJoins(tx, "r", req.rows.dimensionId) : empty,
    req.columns ? coordJoins(tx, "c", req.columns.dimensionId) : empty,
    ...req.filters.map((x, i) => coordJoins(tx, `f${i}`, x.dimensionId)),
  ].reduce((acc, x) => tx`${acc} ${x}`, empty);
  // 絞り込み: 選んだ軸の値(またはその子孫)を持つ値だけ
  const filters = req.filters.reduce(
    (acc, x, i) => tx`${acc} and ${coordValue(tx, `f${i}`)} in (select fa.member_id from fourdb.member_ancestor fa where fa.ancestor_id = any(${x.memberIds}::uuid[]))`,
    empty,
  );
  const rowLevel = req.rows && req.rows.level !== null ? req.rows.level : null;
  const colLevel = req.columns && req.columns.level !== null ? req.columns.level : null;
  const sets = hasSub
    ? tx`grouping sets ((d.s, d.r, d.c), (d.s, d.c), (d.c), (d.s, d.r), (d.s), ())`
    : tx`grouping sets ((d.r, d.c), (d.c), (d.r), ())`;
  // 絞り込みの先当て: 1つ目の絞り込みに合いうる値を、行・列・表全体の3つの道で索引から集める(正確な判定は j で行う)
  const first = req.filters[0];
  const prefilter = first
    ? tx`and v.id in (
        with fm as (select a.member_id from fourdb.member_ancestor a where a.ancestor_id = any(${first.memberIds}::uuid[]))
        select v2.id from fourdb.value v2 where v2.record_id in (select rc.record_id from fourdb.record_coord rc where rc.dimension_id = ${first.dimensionId} and rc.member_id in (select member_id from fm))
        union
        select v2.id from fourdb.value v2 where v2.column_id in (select cc.column_id from fourdb.column_coord cc where cc.dimension_id = ${first.dimensionId} and cc.member_id in (select member_id from fm))
        union
        select v2.id from fourdb.value v2 where v2.sheet_id in (select sc.sheet_id from fourdb.sheet_coord sc where sc.dimension_id = ${first.dimensionId} and sc.member_id in (select member_id from fm)))`
    : empty;

  await tx`select set_config('statement_timeout', ${PROJECTION_TIMEOUT}, true)`;
  const raw = await tx<{ r: string | null; c: string | null; s: string | null; gr: number; gc: number; gs: number; v: string | null; n: string; calc: string; nr: string; nc: string }[]>`
    with v as (
      select v.num, v.kind, v.record_id, v.column_id, v.sheet_id
        from fourdb.value v
        join fourdb.record rec on rec.id = v.record_id and rec.system_to is null and rec.kind = 'data'
        join fourdb.source_column col on col.id = v.column_id and col.system_to is null and col.role = 'measure'
        join fourdb.source_sheet sh on sh.id = v.sheet_id and sh.deleted_at is null
       where v.workspace_id = (select fourdb.current_workspace_id()) and v.system_to is null and v.num is not null
         and col.column_definition_id = ${req.measureId} ${sheets} ${prefilter}
    ),
    j as materialized (
      select x.rm, x.cm,
             ${leafGroup
               ? tx`sum(x.num) as su, count(x.num) as cn, min(x.num) as mi, max(x.num) as ma, count(*) filter (where x.kind = 'calculated') as calc`
               : tx`x.num as su, 1 as cn, x.num as mi, x.num as ma, (x.kind = 'calculated')::int as calc`}
        from (
          select v.num, v.kind,
                 ${req.rows ? coordValue(tx, "r") : tx`null::uuid`} as rm,
                 ${req.columns ? coordValue(tx, "c") : tx`null::uuid`} as cm
            from v ${joins}
           where true ${filters}
        ) x
       ${leafGroup ? tx`group by x.rm, x.cm` : empty}
    ),
    d as (
      select ${hasSub ? tx`sa.ancestor_id` : tx`null::uuid`} as s,
             ${rowLevel !== null ? tx`ra.ancestor_id` : tx`j.rm`} as r,
             ${colLevel !== null ? tx`ca.ancestor_id` : tx`j.cm`} as c,
             sum(j.su) as su, sum(j.cn) as cn, min(j.mi) as mi, max(j.ma) as ma, sum(j.calc) as calc
        from j
        ${rowLevel !== null ? levelJoin(tx, "ra", "rm", rowLevel) : empty}
        ${hasSub ? levelJoin(tx, "sa", "rm", req.rows!.subtotalLevel!) : empty}
        ${colLevel !== null ? levelJoin(tx, "ca", "cm", colLevel) : empty}
       group by 1, 2, 3
    ),
    -- 表の大きさ(行・列の数。軸の値がない「(なし)」も1つに数える)。大きすぎるときは中身を返さない
    lim as (
      select count(distinct d.r) + coalesce(max((d.r is null)::int), 0) as nr,
             count(distinct d.c) + coalesce(max((d.c is null)::int), 0) as nc
        from d
    )
    select d.r, d.c, ${hasSub ? tx`d.s` : tx`null::uuid`} as s,
           grouping(d.r) as gr, grouping(d.c) as gc, ${hasSub ? tx`grouping(d.s)` : tx`1`} as gs,
           ${fn} as v, sum(d.cn) as n, sum(d.calc) as calc,
           (select lim.nr from lim) as nr, (select lim.nc from lim) as nc
      from d
     where (select lim.nr <= ${PROJECTION_LIMITS.rows} and lim.nc <= ${PROJECTION_LIMITS.columns} and lim.nr * lim.nc <= ${PROJECTION_LIMITS.cells} from lim)
     group by ${sets}`.catch((e) => {
    if ((e as { code?: string }).code === "57014") throw new ImportError("集計に時間がかかりすぎたため止めました。段を上げるか、絞り込んでください", 422);
    throw e;
  });
  // 大きすぎる表は出さない(② 25章)。段を上げるか絞るよう知らせる
  const nRows = Number(raw[0]?.nr ?? 0);
  const nCols = Number(raw[0]?.nc ?? 0);
  if (nRows > PROJECTION_LIMITS.rows || nCols > PROJECTION_LIMITS.columns || nRows * nCols > PROJECTION_LIMITS.cells) {
    throw new ImportError(`表が大きすぎます(行 ${nRows}・列 ${nCols})。段を上げるか、絞り込んでください`, 422);
  }
  const agg: AggRow[] = raw.map((x) => ({ r: x.r, c: x.c, s: x.s, gr: Number(x.gr), gc: Number(x.gc), gs: Number(x.gs), v: x.v === null ? null : Number(x.v), n: Number(x.n), calc: Number(x.calc) }));

  const ids = [...new Set(agg.flatMap((a) => [a.r, a.c, a.s]).filter((x): x is string => x !== null))];
  const members = new Map<string, MemberInfo>(
    (await tx<{ id: string; name: string; sort_order: number | null; period_start: Date | null }[]>`
      select id, name, sort_order, period_start from fourdb.dimension_member
       where id = any(${ids}::uuid[]) and workspace_id = (select fourdb.current_workspace_id())`).map((m) => [
      m.id,
      { id: m.id, name: m.name, sortOrder: m.sort_order, periodStart: m.period_start ? m.period_start.toISOString().slice(0, 10) : null },
    ]),
  );
  const shaped = shapeProjection(req, agg, members);
  const levelName = (dimId: string, level: number | null) => (level === null ? null : levelLabel(dims.get(dimId)!, level));
  return {
    ...shaped,
    measure,
    rowAxis: req.rows && {
      id: req.rows.dimensionId,
      name: dims.get(req.rows.dimensionId)!.name,
      level: req.rows.level,
      levelName: levelName(req.rows.dimensionId, req.rows.level),
      subtotalLevelName: levelName(req.rows.dimensionId, req.rows.subtotalLevel),
    },
    columnAxis: req.columns && {
      id: req.columns.dimensionId,
      name: dims.get(req.columns.dimensionId)!.name,
      level: req.columns.level,
      levelName: levelName(req.columns.dimensionId, req.columns.level),
    },
    elapsedMs: Date.now() - t0,
  };
}

// ---------- 選べるもの(数値のカラム・軸と段) ----------
export type Catalog = {
  measures: { id: string; name: string; sheets: number }[];
  dimensions: { id: string; name: string; semanticType: string; levels: { level: number; name: string; count: number }[] }[];
};

export async function catalog(tx: Tx): Promise<Catalog> {
  const measures = await tx<{ id: string; name: string; sheets: string }[]>`
    select d.id, d.name, count(distinct c.sheet_id) as sheets
      from fourdb.column_definition d
      join fourdb.source_column c on c.column_definition_id = d.id and c.system_to is null and c.role = 'measure'
      join fourdb.source_sheet s on s.id = c.sheet_id and s.deleted_at is null
     where d.kind = 'measure' and d.workspace_id = (select fourdb.current_workspace_id())
     group by d.id, d.name order by d.name`;
  const dims = await tx<{ id: string; name: string; semantic_type: string; levels: string[]; present: { level: number; count: number }[] }[]>`
    select d.id, d.name, d.semantic_type, d.levels,
           coalesce((select json_agg(json_build_object('level', x.level, 'count', x.n) order by x.level)
                       from (select m.level, count(*) as n from fourdb.dimension_member m where m.dimension_id = d.id group by m.level) x), '[]') as present
      from fourdb.dimension d
     where d.workspace_id = (select fourdb.current_workspace_id())
     order by d.name`;
  return {
    measures: measures.map((m) => ({ id: m.id, name: m.name, sheets: Number(m.sheets) })),
    dimensions: dims
      .filter((d) => d.present.length > 0)
      .map((d) => ({
        id: d.id,
        name: d.name,
        semanticType: d.semantic_type,
        levels: d.present.map((p) => ({ level: p.level, name: levelLabel(d, p.level), count: Number(p.count) })),
      })),
  };
}

/** 軸の値を名前で探す(絞り込みで選ぶため。200 件まで) */
export async function searchMembers(tx: Tx, dimensionId: string, level: number | null, q: string) {
  await tx`select set_config('statement_timeout', ${SEARCH_TIMEOUT}, true)`;
  return tx<{ id: string; name: string; level: number }[]>`
    select m.id, m.name, m.level
      from fourdb.dimension_member m
     where m.dimension_id = ${dimensionId} and m.workspace_id = (select fourdb.current_workspace_id())
       ${level === null ? tx`` : tx`and m.level = ${level}`}
       and (${q} = '' or strpos(lower(m.name), lower(${q})) > 0)
     order by m.level, m.sort_order nulls last, m.period_start nulls last, m.name
     limit 200`;
}

// ---------- 表の定義(② 14章) ----------
export async function listDefinitions(tx: Tx) {
  return tx<{ id: string; name: string; version: number; updated_at: Date }[]>`
    select id, name, version, updated_at from fourdb.sheet_definition
     where deleted_at is null and workspace_id = (select fourdb.current_workspace_id()) order by updated_at desc`;
}

export async function getDefinition(
  tx: Tx,
  id: string,
): Promise<{ id: string; name: string; version: number; request: ProjectionRequest; filterMembers: { id: string; name: string }[] }> {
  const [d] = await tx<{ id: string; name: string; version: number; definition: unknown }[]>`
    select id, name, version, definition from fourdb.sheet_definition
     where id = ${id} and deleted_at is null and workspace_id = (select fourdb.current_workspace_id())`;
  if (!d) throw new ImportError("表の定義が見つかりません", 404);
  const request = fromDefinition(d.definition);
  if (typeof request === "string") throw new ImportError(`保存した表の定義を読めません(${request})`, 409);
  // 絞り込みで選んだ軸の値の名前(画面に出すため)
  const filterMembers = await tx<{ id: string; name: string }[]>`
    select id, name from fourdb.dimension_member
     where id = any(${request.filters.flatMap((x) => x.memberIds)}::uuid[]) and workspace_id = (select fourdb.current_workspace_id())`;
  return { id: d.id, name: d.name, version: d.version, request, filterMembers: [...filterMembers] };
}

/** 保存する(id があれば上書きして版を上げる)。前の定義は履歴に残す */
export async function saveDefinition(tx: Tx, input: { id: string | null; name: string; request: ProjectionRequest }): Promise<{ id: string; version: number }> {
  const def = toDefinition(input.request);
  try {
    if (input.id) {
      const [d] = await tx<{ id: string; version: number }[]>`
        update fourdb.sheet_definition
           set name = ${input.name}, definition = ${tx.json(asJson(def))}, version = version + 1, updated_at = now(), updated_by = current_setting('fourdb.principal', true)
         where id = ${input.id} and deleted_at is null and workspace_id = (select fourdb.current_workspace_id())
         returning id, version`;
      if (!d) throw new ImportError("表の定義が見つかりません", 404);
      await history(tx, input.name, d.id, d.version, def);
      return d;
    }
    const [d] = await tx<{ id: string; version: number }[]>`
      insert into fourdb.sheet_definition (workspace_id, name, definition, created_by, updated_by)
      values (fourdb.current_workspace_id(), ${input.name}, ${tx.json(asJson(def))}, current_setting('fourdb.principal', true), current_setting('fourdb.principal', true))
      returning id, version`;
    await history(tx, input.name, d.id, d.version, def);
    return d;
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw new ImportError(`同じ名前の表「${input.name}」があります。別の名前にするか、開いて上書きしてください`, 409);
    throw e;
  }
}

async function history(tx: Tx, name: string, id: string, version: number, def: unknown) {
  await tx`
    insert into fourdb.history (workspace_id, actor, kind, title, detail)
    values (fourdb.current_workspace_id(), current_setting('fourdb.principal', true), 'definition', ${`表「${name}」を保存した(版 ${version})`},
            ${tx.json(asJson({ definition_id: id, version, definition: def }))})`;
}
