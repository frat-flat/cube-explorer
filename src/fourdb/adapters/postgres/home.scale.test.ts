// ホーム(GET /api/4db/home)と Task(GET /api/4db/tasks・/tasks/count)の SQL の試作と、規模での速さの測定(D-017・③ 4〜5 章)。
// ここの SQL は W3(adapters/postgres/home.ts・tasks.ts)の下書き。考え方・測った結果・実行計画は test/home.sql.md。
//
// 手元の使い捨てデータベースで、test/scale.sql → test/scale_home.sql(-v variant=V1 か V2)を流したあとに、
// 実行用の役割(fourdb_scale_app。superuser でも持ち主でもない)で、行ごとの権限(RLS)がかかった状態で測る。読むだけ(書き込まない)。
//   FOURDB_SCALE_APP_URL=postgres://fourdb_scale_app@localhost:55432/<db> npx vitest run src/fourdb/adapters/postgres/home.scale.test.ts
// FOURDB_SCALE_APP_URL がなければ飛ばす。手元(localhost・127.0.0.1・::1)でなければ止める(本番・リモートでは測らない)。
// FOURDB_SCALE_EXPLAIN=1 で、目安を超えたもの・1 本で 50ms を超えたものの EXPLAIN (ANALYZE, BUFFERS) を出す(=all ですべて)。
// 計算された値の索引(0007)のあり・なしは、データベースの今の状態のまま測る(切り替えは superuser で 0007 / 0007.down を流す)。
// 目安との比べ(home V1 300ms・V2 1,000ms、tasks 100ms、件数 50ms)は、0007 があるときだけ確かめる(ないときは出すだけ)。
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildHomeOverview,
  HOME_LIMITS,
  orderColumns,
  orderUnits,
  unitKey,
  type ColumnFact,
  type HomeFacts,
  type HomeOverview,
  type MeasureFact,
  type SheetFact,
  type TableCandidate,
  type UnitFacts,
  type UnitGroup,
  type UnitRef as UnitRefRow,
} from "@/fourdb/core/home";
import { buildTaskOverview, TASK_LIMITS, TASK_RUN_STATUSES, type RunStatus, type TaskOverview, type TaskRow } from "@/fourdb/core/tasks";
import { db, isLocalDatabase, withScope, type Scope, type Tx } from "./db";

const URL_ = process.env.FOURDB_SCALE_APP_URL;
const EXPLAIN = process.env.FOURDB_SCALE_EXPLAIN;
/** scale.sql の workspace(架空) */
const WS = "f0000000-0000-0000-0000-000000000001";
const SCOPE: Scope = { principal: "scale:owner", workspaceId: WS };
const TIMEOUT = "10s";
const RUNS = 5;
const TARGET = { homeV1: 300, homeV2: 1000, tasks: 100, count: 50 };

// =====================================================================================
// SQL の試作(W3 の下書き)。表名・列名は固定、値はすべてパラメータ。workspace はパラメータでも絞る(RLS は重ねの守り)。
// units は出す単位(orderUnits(groups).shown の unitType の並び。null = 単位なし)。ord はその並びの 1 始まりの番号。
// =====================================================================================

/** Q1: いちばん上の Box を単位(nullif(unit_type, ''))ごとに。子を持つ Box があるか・総数つき。並べ方と分け方は芯の orderUnits */
const q1 = (tx: Tx, ws: string) => tx<{ unit_type: string | null; n: number; has_children: boolean; top_boxes: number }[]>`
  select nullif(b.unit_type, '') as unit_type, count(*)::int as n, bool_or(p.parent_id is not null) as has_children,
         (sum(count(*)) over ())::int as top_boxes
    from fourdb.box b
    left join (select distinct c.parent_id from fourdb.box c where c.workspace_id = ${ws} and c.parent_id is not null) p on p.parent_id = b.id
   where b.workspace_id = ${ws} and b.parent_id is null
   group by 1
   order by bool_or(p.parent_id is not null) desc, count(*) desc, 1 nulls last
   limit ${HOME_LIMITS.unitTypes}`;

/** 出す単位(u)と、その単位のいちばん上の Box(tb)。CTE の先頭(with の後ろ)に置く */
const unitsCte = (tx: Tx, ws: string, units: (string | null)[]) => tx`
  u as (select t.unit, t.ord::int as ord from unnest(${units}::text[]) with ordinality as t(unit, ord)),
  tb as (select b.id, b.name, u.ord from fourdb.box b join u on nullif(b.unit_type, '') is not distinct from u.unit
          where b.workspace_id = ${ws} and b.parent_id is null)`;

/** 単位の Box を軸の値にしている軸の値(m) */
const membersCte = (tx: Tx, ws: string) => tx`
  m as (select dm.id, dm.dimension_id, tb.ord from tb join fourdb.dimension_member dm on dm.workspace_id = ${ws} and dm.box_id = tb.id)`;

/**
 * 元のシート(S)。(a) 軸 D の分類の列(今の列)があるシート、(b) シート全体の軸の値が M のシート、(c) 今の行が単位の Box に結ばれたシート(via_rows)。
 * 消したシート・消したファイルのシートは除く。
 */
const sourcesCte = (tx: Tx, ws: string, units: (string | null)[]) => tx`
  ${unitsCte(tx, ws, units)},
  ${membersCte(tx, ws)},
  d as (select distinct m.ord, m.dimension_id from m),
  s as (
    select x.ord, x.sheet_id, bool_or(x.via_rows) as via_rows
      from (select d.ord, c.sheet_id, false as via_rows
              from d join fourdb.column_definition cd on cd.workspace_id = ${ws} and cd.kind = 'dimension' and cd.dimension_id = d.dimension_id
                     join fourdb.source_column c on c.workspace_id = ${ws} and c.column_definition_id = cd.id and c.role = 'dimension' and c.system_to is null
            union all
            select m.ord, sc.sheet_id, false from m join fourdb.sheet_coord sc on sc.workspace_id = ${ws} and sc.member_id = m.id
            union all
            select distinct tb.ord, r.sheet_id, true
              from tb join fourdb.record r on r.workspace_id = ${ws} and r.box_id = tb.id and r.system_to is null) x
      join fourdb.source_sheet sh on sh.workspace_id = ${ws} and sh.id = x.sheet_id and sh.deleted_at is null
      join fourdb.source_container f on f.workspace_id = ${ws} and f.id = sh.container_id and f.deleted_at is null
     group by x.ord, x.sheet_id)`;

/** Q2a: 名前を (name, id) の順で 5 件 */
const q2a = (tx: Tx, ws: string, units: (string | null)[]) => tx<{ ord: number; name: string }[]>`
  with ${unitsCte(tx, ws, units)}
  select x.ord, x.name
    from (select tb.ord, tb.name, row_number() over (partition by tb.ord order by tb.name, tb.id) as rn from tb) x
   where x.rn <= ${HOME_LIMITS.names}
   order by x.ord, x.rn`;

/** Q2b: 中に(子孫をすべての段で、単位ごとに数える。深さ 16 まで) */
const q2b = (tx: Tx, ws: string, units: (string | null)[]) => tx<{ ord: number; unit_type: string | null; n: number }[]>`
  with recursive ${unitsCte(tx, ws, units)},
  down as (
    select c.id, c.unit_type, tb.ord, 1 as depth from tb join fourdb.box c on c.workspace_id = ${ws} and c.parent_id = tb.id
    union all
    select c.id, c.unit_type, w.ord, w.depth + 1 from down w join fourdb.box c on c.workspace_id = ${ws} and c.parent_id = w.id
     where w.depth < ${HOME_LIMITS.depth})
  select down.ord, nullif(down.unit_type, '') as unit_type, count(*)::int as n from down group by 1, 2`;

/** Q2c(軸): 単位の Box を軸の値にしている軸(D)。Table との照合に使う */
const q2cDims = (tx: Tx, ws: string, units: (string | null)[]) => tx<{ ord: number; dimension_id: string }[]>`
  with ${unitsCte(tx, ws, units)}, ${membersCte(tx, ws)}
  select distinct m.ord, m.dimension_id from m`;

/** Q2c(シート): 元のシート(S)の全部。題・ファイルの題・最後に取り込んだ日・行で結ばれた印 */
const q2cSheets = (tx: Tx, ws: string, units: (string | null)[]) =>
  tx<{ ord: number; sheet_id: string; sheet: string; file: string; last_read_at: Date | null; via_rows: boolean }[]>`
  with ${sourcesCte(tx, ws, units)}
  select s.ord, s.sheet_id, sh.title as sheet, f.title as file, sh.last_read_at, s.via_rows
    from s join fourdb.source_sheet sh on sh.workspace_id = ${ws} and sh.id = s.sheet_id
           join fourdb.source_container f on f.workspace_id = ${ws} and f.id = sh.container_id`;

/** Q3a: S の今の列のうち、measure と(行で結ばれたシートの)attribute を、カラムごとに。いちばん左の位置と、列の id(Q3b 用) */
const q3a = (tx: Tx, ws: string, units: (string | null)[]) =>
  tx<{ ord: number; role: "measure" | "attribute"; definition_id: string; name: string; position: number; column_ids: string[] }[]>`
  with ${sourcesCte(tx, ws, units)}
  select s.ord, c.role, cd.id as definition_id, cd.name, min(c.col_index)::int as position, array_agg(c.id) as column_ids
    from s join fourdb.source_column c on c.workspace_id = ${ws} and c.sheet_id = s.sheet_id and c.system_to is null
           join fourdb.column_definition cd on cd.workspace_id = ${ws} and cd.id = c.column_definition_id
   where c.role = 'measure' or (c.role = 'attribute' and s.via_rows)
   group by s.ord, c.role, cd.id, cd.name`;

/**
 * S を Q2c の結果からパラメータで渡す形(S を 1 回だけ求める組み立て B 用)。ord・sheet_id・via_rows の 3 つの配列。
 * postgres.js は真偽の配列を bool[] でなく bool(oid 16)として送り、::bool[] で止まる(42846)ので、via_rows は 't'・'f' の文字の配列で渡す。
 */
type SRow = { ord: number; sheet_id: string; via_rows: boolean };
const sParamCte = (tx: Tx, s: readonly SRow[]) => tx`
  s as (select t.ord, t.sheet_id, t.via = 't' as via_rows
          from unnest(${s.map((x) => x.ord)}::int[], ${s.map((x) => x.sheet_id)}::uuid[], ${s.map((x) => (x.via_rows ? "t" : "f"))}::text[]) as t(ord, sheet_id, via))`;

/** Q3a(B): S をパラメータで受け取る形。中身は q3a と同じ */
const q3aFromS = (tx: Tx, ws: string, s: readonly SRow[]) =>
  tx<{ ord: number; role: "measure" | "attribute"; definition_id: string; name: string; position: number; column_ids: string[] }[]>`
  with ${sParamCte(tx, s)}
  select s.ord, c.role, cd.id as definition_id, cd.name, min(c.col_index)::int as position, array_agg(c.id) as column_ids
    from s join fourdb.source_column c on c.workspace_id = ${ws} and c.sheet_id = s.sheet_id and c.system_to is null
           join fourdb.column_definition cd on cd.workspace_id = ${ws} and cd.id = c.column_definition_id
   where c.role = 'measure' or (c.role = 'attribute' and s.via_rows)
   group by s.ord, c.role, cd.id, cd.name`;

/** Q3c(B): S をパラメータで受け取る形。中身は q3c と同じ */
const q3cFromS = (tx: Tx, ws: string, s: readonly SRow[]) => tx<{ ord: number; period_start: string | null; period_end: string | null }[]>`
  with ${sParamCte(tx, s)}
  select p.ord, min(p.ps)::text as period_start, max(p.pe)::text as period_end
    from (select s.ord, dm.period_start as ps, dm.period_end as pe
            from s join fourdb.source_column c on c.workspace_id = ${ws} and c.sheet_id = s.sheet_id and c.system_to is null and c.role = 'measure'
                   join fourdb.column_coord cc on cc.workspace_id = ${ws} and cc.column_id = c.id
                   join fourdb.dimension_member dm on dm.workspace_id = ${ws} and dm.id = cc.member_id and dm.period_start is not null
          union all
          select s.ord, dm.period_start, dm.period_end
            from s join fourdb.sheet_coord sc on sc.workspace_id = ${ws} and sc.sheet_id = s.sheet_id
                   join fourdb.dimension_member dm on dm.workspace_id = ${ws} and dm.id = sc.member_id and dm.period_start is not null) p
   group by p.ord`;

/** Q3b: 出す数値(単位ごとに orderColumns の先頭 12)ごとに、今の値に計算された値(ƒ)があるか。0007 の部分索引で引く */
const q3b = (tx: Tx, ws: string, picks: { k: number; cols: string[] }[]) => tx<{ k: number; calculated: boolean }[]>`
  select t.k, exists (select 1 from fourdb.value v
                       where v.column_id = any (t.cols) and v.kind = 'calculated' and v.system_to is null and v.workspace_id = ${ws}) as calculated
    from jsonb_to_recordset(${tx.json(picks)}) as t(k int, cols bigint[])`;

/** Q3c: 期間。S の今の measure の列の column_coord と、S のシート全体の軸の値(sheet_coord)のうち、期間のある軸の値の最小と最大。行に月があるシートは数えない */
const q3c = (tx: Tx, ws: string, units: (string | null)[]) => tx<{ ord: number; period_start: string | null; period_end: string | null }[]>`
  with ${sourcesCte(tx, ws, units)}
  select p.ord, min(p.ps)::text as period_start, max(p.pe)::text as period_end
    from (select s.ord, dm.period_start as ps, dm.period_end as pe
            from s join fourdb.source_column c on c.workspace_id = ${ws} and c.sheet_id = s.sheet_id and c.system_to is null and c.role = 'measure'
                   join fourdb.column_coord cc on cc.workspace_id = ${ws} and cc.column_id = c.id
                   join fourdb.dimension_member dm on dm.workspace_id = ${ws} and dm.id = cc.member_id and dm.period_start is not null
          union all
          select s.ord, dm.period_start, dm.period_end
            from s join fourdb.sheet_coord sc on sc.workspace_id = ${ws} and sc.sheet_id = s.sheet_id
                   join fourdb.dimension_member dm on dm.workspace_id = ${ws} and dm.id = sc.member_id and dm.period_start is not null) p
   group by p.ord`;

/** Q4: 表の定義(消していないもの)。updated_at の新しい順に 500 件まで。照合は芯の matchTables */
const q4 = (tx: Tx, ws: string) => tx<{ id: string; name: string; updated_at: Date; definition: unknown }[]>`
  select d.id, d.name, d.updated_at, d.definition from fourdb.sheet_definition d
   where d.workspace_id = ${ws} and d.deleted_at is null
   order by d.updated_at desc, d.id
   limit ${HOME_LIMITS.tableDefinitions}`;

/** Task: 消していないシート(と、消していないファイル)ごとに、移行の状態・最後の取り込み・取り消していない取り込みがあるか。5,000 行まで */
const qTasks = (tx: Tx, ws: string) =>
  tx<{
    sheet_id: string; sheet: string; file_id: string; file: string; migration_status: "migrating" | "migrated"; last_read_at: Date | null;
    has_uncancelled: boolean; run_id: string | null; run_status: string | null; started_at: Date | null; finished_at: Date | null;
  }[]>`
  select s.id as sheet_id, s.title as sheet, f.id as file_id, f.title as file, s.migration_status, s.last_read_at,
         exists (select 1 from fourdb.import_run x where x.workspace_id = ${ws} and x.sheet_id = s.id and x.status <> 'cancelled') as has_uncancelled,
         r.id as run_id, r.status as run_status, r.started_at, r.finished_at
    from fourdb.source_sheet s
    join fourdb.source_container f on f.workspace_id = ${ws} and f.id = s.container_id and f.deleted_at is null
    left join lateral (
      select ir.id, ir.status, ir.started_at, ir.finished_at from fourdb.import_run ir
       where ir.workspace_id = ${ws} and ir.sheet_id = s.id
       order by ir.started_at desc, ir.id desc
       limit 1) r on true
   where s.workspace_id = ${ws} and s.deleted_at is null
   order by f.title, f.id, s.title, s.id
   limit ${TASK_LIMITS.rows}`;

/** Task の件数: 最後の取り込みの状態が statuses(芯の TASK_RUN_STATUSES)に当たるシートの数 */
const qCount = (tx: Tx, ws: string, statuses: readonly string[]) => tx<{ n: number }[]>`
  select count(*)::int as n
    from fourdb.source_sheet s
    join fourdb.source_container f on f.workspace_id = ${ws} and f.id = s.container_id and f.deleted_at is null
    cross join lateral (
      select ir.status from fourdb.import_run ir
       where ir.workspace_id = ${ws} and ir.sheet_id = s.id
       order by ir.started_at desc, ir.id desc
       limit 1) r
   where s.workspace_id = ${ws} and s.deleted_at is null and r.status = any (${statuses as string[]}::text[])`;

// =====================================================================================
// 組み立て(W3 の下書き): Q1 → [Q2a・Q2b・Q2c・Q3a・Q3c・Q4 を同じ取引で順に送ってまとめて待つ] → Q3b → 芯の buildHomeOverview
// =====================================================================================

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/**
 * mode A: Q2c・Q3a・Q3c がそれぞれ S を求める(1 回の往復にまとめて送れるが、S を 3 回求める)。
 * mode B: Q2c で S を 1 回求め、Q3a・Q3c には S をパラメータで渡す(往復が 1 回増えるが、S は 1 回)。
 */
async function homeOverview(tx: Tx, ws: string, mode: "A" | "B" = "B"): Promise<HomeOverview> {
  await tx`select set_config('statement_timeout', ${TIMEOUT}, true)`;
  const g = await q1(tx, ws);
  const groups: UnitGroup[] = g.map((r) => ({ unitType: r.unit_type, count: r.n, hasChildren: r.has_children }));
  const topBoxes = g[0]?.top_boxes ?? 0;
  const shown = orderUnits(groups).shown;
  if (shown.length === 0) return buildHomeOverview({ groups, topBoxes, units: new Map(), tables: [] });
  const units = shown.map((u) => u.unitType);
  let names, inside, dims, sheets, cols, periods, defs;
  if (mode === "A") {
    [names, inside, dims, sheets, cols, periods, defs] = await Promise.all([
      q2a(tx, ws, units), q2b(tx, ws, units), q2cDims(tx, ws, units), q2cSheets(tx, ws, units), q3a(tx, ws, units), q3c(tx, ws, units), q4(tx, ws),
    ]);
  } else {
    [names, inside, dims, sheets, defs] = await Promise.all([q2a(tx, ws, units), q2b(tx, ws, units), q2cDims(tx, ws, units), q2cSheets(tx, ws, units), q4(tx, ws)]);
    [cols, periods] = sheets.length ? await Promise.all([q3aFromS(tx, ws, sheets), q3cFromS(tx, ws, sheets)]) : [[], []];
  }
  type Building = { names: string[]; inside: UnitRefRow[]; sheets: SheetFact[]; dimensionIds: string[]; cardFields: ColumnFact[]; measures: MeasureFact[]; periodStart: string | null; periodEndExclusive: string | null };
  const facts: Building[] = units.map(() => ({ names: [], inside: [], sheets: [], dimensionIds: [], cardFields: [], measures: [], periodStart: null, periodEndExclusive: null }));
  const f = (ord: number) => facts[ord - 1];
  const columnIds = new Map<MeasureFact, string[]>();
  for (const r of names) f(r.ord).names.push(r.name);
  for (const r of inside) f(r.ord).inside.push({ unitType: r.unit_type, count: r.n });
  for (const r of dims) f(r.ord).dimensionIds.push(r.dimension_id);
  for (const r of sheets) f(r.ord).sheets.push({ sheetId: r.sheet_id, file: r.file, sheet: r.sheet, lastReadAt: iso(r.last_read_at), viaRows: r.via_rows });
  for (const r of cols) {
    if (r.role === "attribute") f(r.ord).cardFields.push({ name: r.name, position: r.position });
    else {
      const m: MeasureFact = { name: r.name, position: r.position, calculated: false };
      f(r.ord).measures.push(m);
      columnIds.set(m, r.column_ids);
    }
  }
  for (const r of periods) Object.assign(f(r.ord), { periodStart: r.period_start, periodEndExclusive: r.period_end });
  // Q3b: 単位ごとに、芯の並べ方で先頭 12 の数値だけ
  const picked = facts.flatMap((x) => orderColumns(x.measures).slice(0, HOME_LIMITS.fields));
  if (picked.length) {
    const flags = await q3b(tx, ws, picked.map((m, k) => ({ k, cols: columnIds.get(m)! })));
    for (const r of flags) picked[r.k].calculated = r.calculated;
  }
  const byKey = new Map<string, UnitFacts>();
  units.forEach((u, i) => byKey.set(unitKey(u), facts[i]));
  const tables: TableCandidate[] = defs.map((d) => ({ id: d.id, name: d.name, updatedAt: d.updated_at.toISOString(), definition: d.definition }));
  const homeFacts: HomeFacts = { groups, topBoxes, units: byKey, tables };
  return buildHomeOverview(homeFacts);
}

async function taskOverview(tx: Tx, ws: string): Promise<TaskOverview> {
  await tx`select set_config('statement_timeout', ${TIMEOUT}, true)`;
  const rows = await qTasks(tx, ws);
  return buildTaskOverview(
    rows.map((r): TaskRow => ({
      sheetId: r.sheet_id, sheet: r.sheet, fileId: r.file_id, file: r.file, migrationStatus: r.migration_status, lastReadAt: iso(r.last_read_at),
      hasUncancelledRun: r.has_uncancelled,
      lastRun: r.run_id ? { id: r.run_id, status: r.run_status as RunStatus, startedAt: iso(r.started_at)!, finishedAt: iso(r.finished_at) } : null,
    })),
  );
}

async function taskCount(tx: Tx, ws: string): Promise<number> {
  await tx`select set_config('statement_timeout', ${TIMEOUT}, true)`;
  return (await qCount(tx, ws, TASK_RUN_STATUSES))[0].n;
}

// =====================================================================================
// 測り方: 1 回目は捨て(計画・キャッシュの温め)、続けて 5 回の真ん中の値。withScope(begin・設定・commit)を含めた時間
// =====================================================================================

type Measured = { label: string; ms: number[]; median: number };
const results: Measured[] = [];

async function measure<T>(label: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  let out!: T;
  await withScope(SCOPE, fn);
  const ms: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t = performance.now();
    out = await withScope(SCOPE, fn);
    ms.push(performance.now() - t);
  }
  const sorted = [...ms].sort((a, b) => a - b);
  results.push({ label, ms, median: sorted[Math.floor(RUNS / 2)] });
  return out;
}

async function explain<T extends readonly (object | undefined)[]>(label: string, build: (tx: Tx) => postgres.PendingQuery<T>): Promise<void> {
  const plan = await withScope(SCOPE, async (tx) => {
    await tx`select set_config('statement_timeout', '60s', true)`;
    return tx<{ "QUERY PLAN": string }[]>`explain (analyze, buffers) ${build(tx)}`;
  });
  console.log(`\n----- EXPLAIN (ANALYZE, BUFFERS): ${label} -----\n${plan.map((r) => r["QUERY PLAN"]).join("\n")}`);
}

describe.skipIf(!URL_)("ホームと Task の SQL の規模(手元の使い捨てデータベース・実行用の役割)", () => {
  let variant: "V1" | "V2" = "V1";
  let index0007 = false;
  let units: (string | null)[] = [];

  beforeAll(async () => {
    if (!isLocalDatabase(URL_!)) throw new Error("FOURDB_SCALE_APP_URL は手元のデータベース(localhost)だけにしてください");
    process.env.FOURDB_DATABASE_URL = URL_;
    const [r] = await withScope(SCOPE, (tx) => tx<{ top: number; idx: boolean }[]>`
      select (select count(*)::int from fourdb.box where workspace_id = ${WS} and parent_id is null) as top,
             pg_catalog.to_regclass('fourdb.value_calculated') is not null as idx`);
    if (r.top === 0) throw new Error("先に test/scale.sql と test/scale_home.sql を流してください");
    variant = r.top > 1000 ? "V2" : "V1";
    index0007 = r.idx;
    units = orderUnits((await withScope(SCOPE, (tx) => q1(tx, WS))).map((x) => ({ unitType: x.unit_type, count: x.n, hasChildren: x.has_children }))).shown.map((u) => u.unitType);
  });

  afterAll(async () => {
    const homeTarget = variant === "V1" ? TARGET.homeV1 : TARGET.homeV2;
    const rows = results.map((r) => `| ${r.label} | ${r.median.toFixed(1)} | ${r.ms.map((x) => x.toFixed(1)).join(" / ")} |`);
    console.log(
      [`\n### ${variant}・0007 の索引 ${index0007 ? "あり" : "なし"}(目安: home ${homeTarget}ms・tasks ${TARGET.tasks}ms・件数 ${TARGET.count}ms)`,
        "| 測ったもの | 真ん中(ms) | 5 回(ms) |", "|---|---:|---|", ...rows].join("\n"),
    );
    await db().end();
  });

  it("1 本ずつ: Q1・Q2a・Q2b・Q2c(軸・シート)・Q3a・Q3b・Q3c・Q4・Task・件数", async () => {
    await measure("Q1 単位", (tx) => q1(tx, WS));
    await measure("Q2a 名前", (tx) => q2a(tx, WS, units));
    await measure("Q2b 中に", (tx) => q2b(tx, WS, units));
    await measure("Q2c 軸(D)", (tx) => q2cDims(tx, WS, units));
    const sheets = await measure("Q2c 元のシート(S)", (tx) => q2cSheets(tx, WS, units));
    const cols = await measure("Q3a 列", (tx) => q3a(tx, WS, units));
    // Q3b は、単位ごとに芯の並べ方で先頭 12 の数値
    const picks: { k: number; cols: string[] }[] = [];
    for (let ord = 1; ord <= units.length; ord++) {
      const ms = orderColumns(cols.filter((c) => c.ord === ord && c.role === "measure").map((c) => ({ name: c.name, position: c.position, ids: c.column_ids })));
      for (const m of ms.slice(0, HOME_LIMITS.fields)) picks.push({ k: picks.length, cols: m.ids });
    }
    const flags = await measure(`Q3b ƒ(数値 ${picks.length} 個・列 ${picks.reduce((a, p) => a + p.cols.length, 0)} 本)`, (tx) => q3b(tx, WS, picks));
    await measure("Q3c 期間", (tx) => q3c(tx, WS, units));
    await measure("Q3a 列(B: S を渡す)", (tx) => q3aFromS(tx, WS, sheets));
    await measure("Q3c 期間(B: S を渡す)", (tx) => q3cFromS(tx, WS, sheets));
    await measure("Q4 表の定義", (tx) => q4(tx, WS));
    await measure("Task(一覧の SQL)", (tx) => qTasks(tx, WS));
    await measure("件数の SQL", (tx) => qCount(tx, WS, TASK_RUN_STATUSES));
    expect(sheets.length).toBeGreaterThan(0);
    expect(flags.some((x) => x.calculated)).toBe(true);
    expect(flags.some((x) => !x.calculated)).toBe(true);

    if (EXPLAIN) {
      const all = EXPLAIN === "all";
      const slow = (label: string) => all || (results.find((r) => r.label.startsWith(label))?.median ?? 0) > 50;
      if (slow("Q1")) await explain("Q1", (tx) => q1(tx, WS));
      if (slow("Q2a")) await explain("Q2a", (tx) => q2a(tx, WS, units));
      if (slow("Q2b")) await explain("Q2b", (tx) => q2b(tx, WS, units));
      if (slow("Q2c 軸")) await explain("Q2c 軸", (tx) => q2cDims(tx, WS, units));
      if (slow("Q2c 元")) await explain("Q2c 元のシート", (tx) => q2cSheets(tx, WS, units));
      if (slow("Q3a")) await explain("Q3a", (tx) => q3a(tx, WS, units));
      if (slow("Q3b")) await explain("Q3b", (tx) => q3b(tx, WS, picks));
      if (slow("Q3c")) await explain("Q3c", (tx) => q3c(tx, WS, units));
      if (slow("Q4")) await explain("Q4", (tx) => q4(tx, WS));
      if (all || (results.find((r) => r.label.startsWith("Task"))?.median ?? 0) > TARGET.tasks) await explain("Task", (tx) => qTasks(tx, WS));
      if (all || (results.find((r) => r.label.startsWith("件数"))?.median ?? 0) > TARGET.count) await explain("件数", (tx) => qCount(tx, WS, TASK_RUN_STATUSES));
    }
  }, 600_000);

  it("通し: ホーム(Q1 → まとめて送る Q2・Q3a・Q3c・Q4 → Q3b → 芯の組み立て)・Task・件数。中身も確かめる", async () => {
    const homeA = await measure("ホーム(通し A: S を 3 回)", (tx) => homeOverview(tx, WS, "A"));
    const home = await measure("ホーム(通し)", (tx) => homeOverview(tx, WS, "B"));
    expect(home).toEqual(homeA); // 組み立て A と B は同じ結果
    const tasks = await measure("Task(通し)", (tx) => taskOverview(tx, WS));
    const count = await measure("件数(通し)", (tx) => taskCount(tx, WS));

    // 中身(scale.sql・scale_home.sql の形から決まるもの)
    const byUnit = new Map(home.units.map((u) => [u.unitType, u]));
    const corp = byUnit.get("法人")!;
    expect(corp.count).toBe(500);
    expect(corp.measures!.items.find((m) => m.name === "項目11")!.calculated).toBe(true);
    expect(corp.measures!.items.find((m) => m.name === "項目01")!.calculated).toBe(false);
    expect(corp.period).toEqual({ from: "2026-01", to: "2026-12" }); // 予算の列の月(column_coord)と、シート全体の 2026 年(sheet_coord)
    expect(corp.sheets!.items.length).toBe(3);
    expect(corp.sheets!.more).toBe(990 - 3);
    expect(corp.tables!.items.length).toBe(3);
    if (variant === "V1") {
      expect(home.topBoxes).toBe(500);
      expect(home.units.map((u) => u.unitType)).toEqual(["法人"]);
      expect(corp.inside!.items).toEqual([{ unitType: "店舗", count: 8000 }]);
      expect(corp.cardFields).toBeNull(); // 法人の Box に結ばれた行がないので、属性(Card の項目)は出ない
    } else {
      expect(home.topBoxes).toBe(8500);
      expect(home.units.map((u) => u.unitType)).toEqual(["店舗", "法人"]);
      const shop = byUnit.get("店舗")!;
      expect(shop.count).toBe(8000);
      expect(shop.inside).toBeNull();
      expect(shop.cardFields!.items).toEqual(["課税区分"]); // 行で結ばれたシートの属性
      expect(shop.period).toEqual({ from: "2026-01", to: "2026-12" });
    }
    // Task: 一覧と件数が同じ数(件数の SQL は、一覧の SQL と同じ「最後の取り込み」で数える)
    expect(tasks.count).toBe(count);
    expect(count).toBeGreaterThan(0);

    if (index0007) {
      const homeTarget = variant === "V1" ? TARGET.homeV1 : TARGET.homeV2;
      const med = (l: string) => results.find((r) => r.label === l)!.median;
      expect.soft(med("ホーム(通し)"), `ホーム ${variant} の目安 ${homeTarget}ms`).toBeLessThanOrEqual(homeTarget);
      expect.soft(med("Task(通し)"), `Task の目安 ${TARGET.tasks}ms`).toBeLessThanOrEqual(TARGET.tasks);
      expect.soft(med("件数(通し)"), `件数の目安 ${TARGET.count}ms`).toBeLessThanOrEqual(TARGET.count);
    }
  }, 600_000);
});
