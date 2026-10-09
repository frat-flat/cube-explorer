// 承認した内容を、分割して fourdb の表に書く。途中で止まっても続きから書ける(「反映を続ける」)。
// 1回の呼び出しは時間で区切る(APPLY_BUDGET_MS。超えそうなら、そこまでを確定して位置を残し、次の呼び出しが続きを書く)。
// 書き込みは行のまとまりごとに、表ごとに1文でまとめて送る(1行ずつの往復をしない。ネット越しのデータベースでも遅くならないように)。
// 最初の呼び出しで、鍵の重なりの確かめ・意味(カラム・軸)と列の準備をし、承認の内容を取り込みに保存する(あとの呼び出しはそれを使う)。
import { randomUUID } from "node:crypto";
import { columnHeaders } from "@/fourdb/core/import/layout";
import { MONTH_DIMENSION, planRows, validateSpec, type ApprovalSpec, type PlannedRow } from "@/fourdb/core/import/plan";
import type { Scope, Tx } from "./db";
import { withScope } from "./db";
import { duplicateKeys, ImportError, loadRows, stagedKeys } from "./import-store";

/** 1回の呼び出しで使ってよい時間の目安(ミリ秒)。Vercel の上限(60 秒)より十分短く、進み具合が数秒ごとに動くように */
export const APPLY_BUDGET_MS = 5000;
/** 1まとまりの時間の目安(ミリ秒)。これに合わせて、次に書く行の数を変える */
const STEP_MS = 1500;
/** 1まとまりのセルの数(最初・最小・最大) */
const START_CELLS = 10_000;
const MIN_CELLS = 1_000;
const MAX_CELLS = 40_000;
/** 置き場(import_row)を1文で消す行の範囲(既定) */
const CLEANUP_ROWS = 50_000;
const MONTH_LEVELS = ["年", "四半期", "月"];

export type ApplyOptions = {
  /** 1回の呼び出しで使ってよい時間(ミリ秒)。既定は APPLY_BUDGET_MS(試験で小さくする) */
  budgetMs?: number;
  /** 段階ごとにかかった時間(測るため) */
  trace?: (phase: string, ms: number) => void;
  /** 置き場を1文で消す行の範囲。既定は CLEANUP_ROWS(試験で小さくして、片付けの途中からの続きを確かめる) */
  cleanupRows?: number;
};
type Counts = { rows: number; values: number; totals: number; closedValues: number };
export type ApplyResult = { done: boolean; next: number; total: number; counts: Counts };

type ApplyState = {
  next: number;
  /** すべての行を書いた(このあと片付け) */
  done: boolean;
  spec: ApprovalSpec;
  /** 列の番号 → source_column.id */
  columns: Record<string, number>;
  /** この取り込みの前に、表に行があったか(読み直しのとき、なくなった行を閉じる)。閉じ終えたら false にする */
  hadRecords: boolean;
  counts: Counts;
  /** 軸の名前 → id(準備で作ったもの。前のつくりで始めた取り込みにはないので、なければ引く) */
  dimensions?: Record<string, string>;
  /** 1行を書くのにかかった時間(ミリ秒)。次のまとまりの行の数を決める */
  msPerRow?: number;
  /** 片付けの進み具合(closed: なくなった行を閉じた / cleanedTo: 置き場をこの行番号の手前まで消した / cleaned: 置き場をすべて消した) */
  finish?: { closed: boolean; closedRecords: number; cleanedTo: number; cleaned: boolean };
};
type RunRow = { id: string; sheet_id: string; status: string; started_at: Date; cursor: { next: number; total: number; cols: number; done: boolean; apply?: ApplyState } };
type Clock = { budget: number; cleanupRows: number; left: () => number; trace: (phase: string, since: number) => number };

const entityDimensionOf = (spec: ApprovalSpec): string | null =>
  spec.entityColumn === null ? null : (spec.columns.find((c) => c.index === spec.entityColumn) as { dimension?: string } | undefined)?.dimension ?? null;

// ---------- 意味(軸・カラム・軸の値)の準備 ----------
/** 軸をそろえる(なければ作る)。名前 → id */
async function ensureDimensions(tx: Tx, wanted: Map<string, "time" | "entity" | "category">): Promise<Map<string, string>> {
  if (!wanted.size) return new Map();
  const names = [...wanted.keys()];
  const rows = await tx<{ id: string; name: string }[]>`
    insert into fourdb.dimension (workspace_id, name, semantic_type, levels)
    select fourdb.current_workspace_id(), x.n, x.s, case when x.s = 'time' and x.n = ${MONTH_DIMENSION} then ${MONTH_LEVELS}::text[] else '{}'::text[] end
      from unnest(${names}::text[], ${names.map((n) => wanted.get(n)!)}::text[]) as x(n, s)
    on conflict (workspace_id, name) do update set updated_at = fourdb.dimension.updated_at
    returning id, name`;
  return new Map(rows.map((r) => [r.name, r.id]));
}

/** 軸の名前 → id(準備で残したもの。なければ引いて残す) */
async function dimensionIds(tx: Tx, state: ApplyState, names: string[]): Promise<Map<string, string>> {
  const known = (state.dimensions ??= {});
  const missing = [...new Set(names)].filter((n) => !(n in known));
  if (missing.length) {
    const rows = await tx<{ id: string; name: string }[]>`
      select id, name from fourdb.dimension where workspace_id = fourdb.current_workspace_id() and name = any(${missing}::text[])`;
    for (const r of rows) known[r.name] = r.id;
    const lost = missing.filter((n) => !(n in known));
    if (lost.length) throw new ImportError(`軸「${lost.join("・")}」が見つかりません`);
  }
  return new Map(Object.entries(known));
}

/*
 * 軸の値を名前で引くところの書き方(取り込みの最中は表が急に育って統計が追いつかないため):
 * - 表から今回の名前の分だけを1回で引く(= any(配列))。表と直接結ぶと「その軸の値を全部なめて、名前ごとに比べる」手順になり、
 *   行が増えるほど遅くなった(3 万行で1まとまり 4 秒)
 * - 引いた分と今回の行の突き合わせは、結び(join)にせず、集合の引き算(except)か、名前 → id の対応表(jsonb)で引く。
 *   結びにすると、件数の見積もりが外れたときに「片方を何度もなめる」手順になる(3,000 行で1まとまり 0.4 秒余計にかかった)
 */

/** 段のない軸の値をそろえる(なければ作る)。すでにある値には触らない(段・祖先の一覧のトリガーも動かさない) */
function insertFlatMembers(tx: Tx, dims: string[], names: string[]) {
  return tx`
    insert into fourdb.dimension_member (workspace_id, dimension_id, name)
    select fourdb.current_workspace_id(), z.d, z.n
      from (select x.d, x.n from unnest(${dims}::uuid[], ${names}::text[]) as x(d, n)
            except
            select m.dimension_id, m.name from fourdb.dimension_member m
             where m.dimension_id = any(${[...new Set(dims)]}::uuid[]) and m.parent_id is null and m.name = any(${names}::text[])) z
     order by z.d, z.n   -- 同時に2つの取り込みが同じ値を作るとき、同じ順に押さえる(互いに待ち合わない)
    on conflict (dimension_id, parent_id, name) do nothing`;
}

/** 月(YYYY-MM)の軸の値を、年 › 四半期 › 月 の段でそろえる(段ごとに1文)。月 → 月の軸の値の id */
async function ensureMonths(tx: Tx, dimensionId: string, months: string[]): Promise<Map<string, string>> {
  const uniq = [...new Set(months)].sort();
  if (!uniq.length) return new Map();
  const iso = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, "0")}-01`;
  const years = new Map<string, [string, string]>();
  const quarters = new Map<string, [string, string, string]>();   // 四半期 → [年, 始まり, 終わり]
  const ms = { ym: [] as string[], q: [] as string[], y: [] as string[], s: [] as string[], e: [] as string[] };
  for (const ym of uniq) {
    const [y, m] = ym.split("-").map(Number);
    const q = Math.floor((m - 1) / 3) + 1;
    years.set(String(y), [iso(y, 1), iso(y + 1, 1)]);
    quarters.set(`${y}-Q${q}`, [String(y), iso(y, q * 3 - 2), q === 4 ? iso(y + 1, 1) : iso(y, q * 3 + 1)]);
    ms.ym.push(ym); ms.q.push(`${y}-Q${q}`); ms.y.push(String(y)); ms.s.push(iso(y, m)); ms.e.push(m === 12 ? iso(y + 1, 1) : iso(y, m + 1));
  }
  const yn = [...years.keys()];
  const qn = [...quarters.keys()];
  // 親を先に作る(年 → 四半期 → 月。同じ文の中で子を先に入れるとトリガーが止める)
  await tx`
    insert into fourdb.dimension_member (workspace_id, dimension_id, parent_id, name, period_start, period_end)
    select fourdb.current_workspace_id(), ${dimensionId}, null, x.n, x.s::date, x.e::date
      from unnest(${yn}::text[], ${yn.map((n) => years.get(n)![0])}::text[], ${yn.map((n) => years.get(n)![1])}::text[]) as x(n, s, e)
    on conflict (dimension_id, parent_id, name) do nothing`;
  await tx`
    insert into fourdb.dimension_member (workspace_id, dimension_id, parent_id, name, period_start, period_end)
    select fourdb.current_workspace_id(), ${dimensionId}, y.id, x.n, x.s::date, x.e::date
      from unnest(${qn}::text[], ${qn.map((n) => quarters.get(n)![0])}::text[], ${qn.map((n) => quarters.get(n)![1])}::text[], ${qn.map((n) => quarters.get(n)![2])}::text[]) as x(n, y, s, e)
      join fourdb.dimension_member y on y.dimension_id = ${dimensionId} and y.parent_id is null and y.name = x.y
    on conflict (dimension_id, parent_id, name) do nothing`;
  await tx`
    insert into fourdb.dimension_member (workspace_id, dimension_id, parent_id, name, period_start, period_end)
    select fourdb.current_workspace_id(), ${dimensionId}, q.id, x.n, x.s::date, x.e::date
      from unnest(${ms.ym}::text[], ${ms.q}::text[], ${ms.y}::text[], ${ms.s}::text[], ${ms.e}::text[]) as x(n, q, y, s, e)
      join fourdb.dimension_member y on y.dimension_id = ${dimensionId} and y.parent_id is null and y.name = x.y
      join fourdb.dimension_member q on q.dimension_id = ${dimensionId} and q.parent_id = y.id and q.name = x.q
    on conflict (dimension_id, parent_id, name) do nothing`;
  const rows = await tx<{ id: string; name: string }[]>`
    select m.id, m.name
      from unnest(${ms.ym}::text[], ${ms.q}::text[], ${ms.y}::text[]) as x(n, q, y)
      join fourdb.dimension_member y on y.dimension_id = ${dimensionId} and y.parent_id is null and y.name = x.y
      join fourdb.dimension_member q on q.dimension_id = ${dimensionId} and q.parent_id = y.id and q.name = x.q
      join fourdb.dimension_member m on m.dimension_id = ${dimensionId} and m.parent_id = q.id and m.name = x.n`;
  return new Map(rows.map((r) => [r.name, r.id]));
}

// ---------- 最初の呼び出し: 列の準備 ----------
async function setup(tx: Tx, run: RunRow, spec: ApprovalSpec): Promise<ApplyState> {
  const sheetId = run.sheet_id;
  const entityDimension = entityDimensionOf(spec);
  const semantic = (name: string) => (name === MONTH_DIMENSION ? "time" : name === entityDimension ? "entity" : "category");

  // 使う軸をまとめてそろえる(表全体・分類の列・横に並んだ月)
  const wanted = new Map<string, "time" | "entity" | "category">();
  for (const s of spec.sheetCoords) wanted.set(s.dimension, semantic(s.dimension));
  for (const c of spec.columns) if (c.role === "dimension") wanted.set(c.dimension, semantic(c.dimension));
  const hasMonths = spec.columns.some((c) => c.role === "measure" && c.month);
  if (hasMonths) wanted.set(MONTH_DIMENSION, "time");
  const dims = await ensureDimensions(tx, wanted);

  // 表全体の軸の値(同じ軸が2回あれば後ろのもの)
  if (spec.sheetCoords.length) {
    const last = new Map(spec.sheetCoords.map((s) => [s.dimension, s.member]));
    const d = [...last.keys()].map((n) => dims.get(n)!);
    const m = [...last.values()];
    await insertFlatMembers(tx, d, m);
    await tx`
      insert into fourdb.sheet_coord (workspace_id, sheet_id, dimension_id, member_id)
      select fourdb.current_workspace_id(), ${sheetId}, x.d, m.id
        from unnest(${d}::uuid[], ${m}::text[]) as x(d, n)
        join fourdb.dimension_member m on m.dimension_id = x.d and m.parent_id is null and m.name = x.n
      on conflict (sheet_id, dimension_id) do update set member_id = excluded.member_id`;
  }

  // 列名(列名の行とグループ名の行から)
  const head = await loadRows(tx, run.id, 0, spec.headerRow + 1);
  const grid: string[][] = [];
  head.forEach((r) => (grid[r.index] = r.cells.map((c) => c.v)));
  for (let i = 0; i <= spec.headerRow; i++) grid[i] ??= [];
  const headers = columnHeaders(grid, { headerRow: spec.headerRow, groupRow: spec.groupRow }, spec.columns.length);

  // カラム(Column Registry): 名前で引き、なければ作る。別の種類・別の軸に結びついていれば止める
  type Def = { id: string | null; kind: string; dimension_id: string | null };
  const wantDef = (c: ApprovalSpec["columns"][number]): { name: string; kind: "dimension" | "measure" | "attribute"; dimensionId: string | null } | null =>
    c.role === "dimension" ? { name: c.definition, kind: "dimension", dimensionId: dims.get(c.dimension)! }
    : c.role === "measure" ? { name: c.definition, kind: "measure", dimensionId: null }
    : c.role === "attribute" ? { name: c.definition, kind: "attribute", dimensionId: null }
    : c.role === "aggregate" && c.definition ? { name: c.definition, kind: "measure", dimensionId: null }
    : null;
  const wants = spec.columns.map(wantDef);
  const defNames = [...new Set(wants.filter((w) => w !== null).map((w) => w.name))];
  const defs = new Map<string, Def>();
  if (defNames.length) {
    const found = await tx<{ id: string; name: string; kind: string; dimension_id: string | null }[]>`
      select id, name, kind, dimension_id from fourdb.column_definition
       where workspace_id = fourdb.current_workspace_id() and name = any(${defNames}::text[]) and subtitle is null`;
    for (const f of found) defs.set(f.name, f);
  }
  const newDefs: { name: string; kind: string; dimensionId: string | null }[] = [];
  for (const w of wants) {
    if (!w) continue;
    const f = defs.get(w.name);
    if (f) {
      if (f.kind !== w.kind) throw new ImportError(`カラム「${w.name}」はすでに ${f.kind} として登録されています(${w.kind} としては使えません)`);
      if (w.kind === "dimension" && f.dimension_id !== w.dimensionId) throw new ImportError(`カラム「${w.name}」は別の軸に結びついています`);
      continue;
    }
    defs.set(w.name, { id: null, kind: w.kind, dimension_id: w.dimensionId });
    newDefs.push(w);
  }
  if (newDefs.length) {
    const made = await tx<{ id: string; name: string }[]>`
      insert into fourdb.column_definition (workspace_id, name, kind, dimension_id)
      select fourdb.current_workspace_id(), x.n, x.k, x.d
        from unnest(${newDefs.map((d) => d.name)}::text[], ${newDefs.map((d) => d.kind)}::text[], ${newDefs.map((d) => d.dimensionId)}::uuid[]) with ordinality as x(n, k, d, o)
       order by x.o
      returning id, name`;
    for (const m of made) defs.get(m.name)!.id = m.id;
  }

  // 列: 同じ位置・同じ見出し・同じ意味なら前の列を使い、変わっていれば前の列を閉じて新しく作る
  const current = await tx<{ id: string; col_index: number; header: string; role: string; column_definition_id: string | null; aggregate_function: string | null; detail: Record<string, unknown> }[]>`
    select id, col_index, header, role, column_definition_id, aggregate_function, detail from fourdb.source_column where sheet_id = ${sheetId} and system_to is null`;
  const columns: Record<string, number> = {};
  const close: string[] = [];
  const add = { index: [] as number[], header: [] as string[], group: [] as (string | null)[], role: [] as string[], def: [] as (string | null)[], fn: [] as (string | null)[], detail: [] as string[], month: [] as (string | null)[] };
  spec.columns.forEach((c, i) => {
    const h = headers[c.index];
    const defId = wants[i] ? defs.get(wants[i]!.name)!.id : null;
    const detail = { month: c.role === "measure" ? c.month : null, sums: c.role === "aggregate" ? c.sums : null };
    const fn = c.role === "aggregate" ? c.fn : null;
    const old = current.find((x) => x.col_index === c.index);
    const same = old && old.header === h.label && old.role === c.role && old.column_definition_id === defId && old.aggregate_function === fn
      && JSON.stringify(old.detail?.month ?? null) === JSON.stringify(detail.month) && JSON.stringify(old.detail?.sums ?? null) === JSON.stringify(detail.sums);
    if (same) {
      columns[c.index] = Number(old!.id);
      return;
    }
    if (old) close.push(old.id);
    add.index.push(c.index); add.header.push(h.label); add.group.push(h.group); add.role.push(c.role); add.def.push(defId); add.fn.push(fn);
    add.detail.push(JSON.stringify(detail)); add.month.push(c.role === "measure" && c.month ? c.month : null);
  });
  if (close.length) await tx`update fourdb.source_column set system_to = clock_timestamp() where id = any(${close}::bigint[])`;
  if (add.index.length) {
    const made = await tx<{ id: string; col_index: number }[]>`
      insert into fourdb.source_column (workspace_id, sheet_id, col_index, header, group_label, role, column_definition_id, aggregate_function, detail, approved_at, approved_by)
      select fourdb.current_workspace_id(), ${sheetId}, x.i, x.h, x.g, x.r, x.d, x.f, x.j::jsonb, now(), current_setting('fourdb.principal', true)
        from unnest(${add.index}::int[], ${add.header}::text[], ${add.group}::text[], ${add.role}::text[], ${add.def}::uuid[], ${add.fn}::text[], ${add.detail}::text[])
             with ordinality as x(i, h, g, r, d, f, j, o)
       order by x.o
      returning id, col_index`;
    const idOf = new Map(made.map((m) => [m.col_index, Number(m.id)]));
    add.index.forEach((ci) => (columns[ci] = idOf.get(ci)!));
    // 新しく作った月の列に、月の軸の値を付ける
    const monthCols = add.index.map((ci, k) => [ci, add.month[k]] as const).filter((x): x is readonly [number, string] => x[1] !== null);
    if (monthCols.length && hasMonths) {
      const monthDim = dims.get(MONTH_DIMENSION)!;
      const member = await ensureMonths(tx, monthDim, monthCols.map((x) => x[1]));
      await tx`
        insert into fourdb.column_coord (workspace_id, column_id, dimension_id, member_id)
        select fourdb.current_workspace_id(), x.c, ${monthDim}, x.m
          from unnest(${monthCols.map((x) => idOf.get(x[0])!)}::bigint[], ${monthCols.map((x) => member.get(x[1])!)}::uuid[]) as x(c, m)`;
    }
  }
  await tx`update fourdb.source_sheet set header_row = ${spec.headerRow}, group_row = ${spec.groupRow}, updated_at = now() where id = ${sheetId}`;
  const [{ had }] = await tx<{ had: boolean }[]>`select exists (select 1 from fourdb.record where sheet_id = ${sheetId} and system_to is null) as had`;
  return { next: 0, done: false, spec, columns, hadRecords: had, counts: { rows: 0, values: 0, totals: 0, closedValues: 0 }, dimensions: Object.fromEntries(dims) };
}

// ---------- 行の書き込み(1まとまり) ----------
const sameNum = (a: string | null, b: number | null) => (a === null ? b === null : b !== null && Number(a) === b);

/**
 * 1まとまりの行を書く。往復は2回:
 *  1. 軸の値 → 実体(Box)→ 行と行の軸の値 → 今の値・今のスプシの合計を読む(順に送り、まとめて待つ)
 *  2. 変わった値を閉じて新しい版を足す・スプシの合計も同じ(順に送り、まとめて待つ)
 */
async function writeRows(tx: Tx, sheetId: string, state: ApplyState, planned: PlannedRow[], clock: Clock) {
  const spec = state.spec;
  const entityDim = entityDimensionOf(spec);
  const dimNames = new Set<string>();
  for (const r of planned) for (const c of r.coords) dimNames.add(c.dimension);
  if (entityDim) dimNames.add(entityDim);
  const dimIds = await dimensionIds(tx, state, [...dimNames]);

  // 行の軸の値(重ねない)と、行ごとの軸の値
  const md: string[] = [], mn: string[] = [];
  const seen = new Map<string, Set<string>>();
  const ck: string[] = [], cd: string[] = [], cn: string[] = [];
  for (const r of planned) {
    for (const c of r.coords) {
      const d = dimIds.get(c.dimension)!;
      const s = seen.get(d) ?? seen.set(d, new Set()).get(d)!;
      if (!s.has(c.member)) {
        s.add(c.member);
        md.push(d);
        mn.push(c.member);
      }
      ck.push(r.rowKey); cd.push(d); cn.push(c.member);
    }
  }
  const entityId = entityDim ? dimIds.get(entityDim)! : null;
  const entities = entityId ? [...new Set(planned.map((r) => r.entity).filter((e): e is string => !!e))] : [];
  const keys = planned.map((r) => r.rowKey);
  // Box の id は先に決めて渡す(実体の名前 → id)。結ぶときに表どうしを突き合わせない(統計しだいで遅くなるため)
  const boxIds = Object.fromEntries(entities.map((e) => [e, randomUUID()]));

  let t = performance.now();
  const [, , recs, vnow, tnow] = await Promise.all([
    md.length ? insertFlatMembers(tx, md, mn) : null,
    // 行が表す実体(Box): 軸の値に Box がなければ作って結ぶ。
    // 同時に2つの取り込みが同じ値に作らないよう、その行を押さえる(id の順に押さえ、互いに待ち合わないように)。
    // 結ぶのは押さえた行と同じ条件の行(同じ時点の見え方。ほかの取り込みが先に結んだ行は、押さえるときも結ぶときも外れる)
    entities.length
      ? tx`
        with bx as (select ${tx.json(boxIds)}::jsonb as o),
        need as (
          select m.id, m.name from fourdb.dimension_member m
           where m.dimension_id = ${entityId} and m.parent_id is null and m.name = any(${entities}::text[]) and m.box_id is null
           order by m.id
             for no key update of m
        ), made as (
          insert into fourdb.box (id, workspace_id, type, unit_type, name)
          select (bx.o ->> need.name)::uuid, fourdb.current_workspace_id(), 'entity', ${entityDim}, need.name from need cross join bx
        )
        update fourdb.dimension_member m set box_id = ((select bx.o from bx) ->> m.name)::uuid
         where m.dimension_id = ${entityId} and m.parent_id is null and m.name = any(${entities}::text[]) and m.box_id is null
           and (select count(*) from need) > 0   -- 先に need を最後まで読んで押さえてから結ぶ`
      : null,
    // 行(同じ鍵の今の行があれば、それを使う)と、行の軸の値
    tx<{ id: string; row_key: string }[]>`
      with ent as materialized (   -- 実体の名前 → Box
        select coalesce(jsonb_object_agg(m.name, m.box_id), '{}'::jsonb) as o from fourdb.dimension_member m
         where m.dimension_id = ${entityId}::uuid and m.parent_id is null and m.name = any(${entities}::text[])
      ), rec as (
        insert into fourdb.record (workspace_id, sheet_id, row_key, row_index, kind, box_id)
        select fourdb.current_workspace_id(), ${sheetId}, x.k, x.i, x.kind, (ent.o ->> x.en)::uuid
          from unnest(${keys}::text[], ${planned.map((r) => r.rowIndex)}::int[], ${planned.map((r) => r.kind)}::text[], ${planned.map((r) => r.entity)}::text[]) as x(k, i, kind, en)
          cross join ent
        on conflict (sheet_id, row_key) where system_to is null
        do update set row_index = excluded.row_index, kind = excluded.kind, box_id = excluded.box_id
        returning id, row_key
      ), mem as materialized (   -- 軸の id と値の名前 → 軸の値の id(uuid は 36 文字なので、つないでも取り違えない)
        select coalesce(jsonb_object_agg(m.dimension_id::text || m.name, m.id), '{}'::jsonb) as o from fourdb.dimension_member m
         where m.dimension_id = any(${[...seen.keys()]}::uuid[]) and m.parent_id is null and m.name = any(${mn}::text[])
      ), ids as (   -- 行の鍵 → 行の id
        select coalesce(jsonb_object_agg(rec.row_key, rec.id), '{}'::jsonb) as o from rec
      ), rc as (
        insert into fourdb.record_coord (workspace_id, record_id, dimension_id, member_id)
        select fourdb.current_workspace_id(), (ids.o ->> c.k)::bigint, c.d, (mem.o ->> (c.d::text || c.n))::uuid
          from unnest(${ck}::text[], ${cd}::uuid[], ${cn}::text[]) as c(k, d, n)
          cross join ids cross join mem   -- 行・軸の値が見つからなければ null になり、not null の決まりで止まる(黙って飛ばさない)
        on conflict (record_id, dimension_id) do update set member_id = excluded.member_id
      )
      select id, row_key from rec`,
    // 今の値・今のスプシの合計(この行の分。行は鍵で引く)
    tx<{ id: string; record_id: string; column_id: string; kind: string; num: string | null; txt: string | null; formula: string | null }[]>`
      select id, record_id, column_id, kind, num, txt, formula from fourdb.value
       where record_id = any (array(select r.id from fourdb.record r where r.sheet_id = ${sheetId} and r.row_key = any(${keys}::text[]) and r.system_to is null))
         and system_to is null`,
    tx<{ id: string; record_id: string; column_id: string; num: string | null; txt: string | null; formula: string | null }[]>`
      select id, record_id, column_id, num, txt, formula from fourdb.source_total
       where record_id = any (array(select r.id from fourdb.record r where r.sheet_id = ${sheetId} and r.row_key = any(${keys}::text[]) and r.system_to is null))
         and system_to is null`,
  ]);
  t = clock.trace("write.rows", t);
  const recId = new Map(recs!.map((r) => [r.row_key, Number(r.id)]));

  // 値: 今の値と同じなら何もしない。変わっていれば前の版を閉じて新しい版を足す。空になったセルは閉じる
  const cur = new Map(vnow!.map((v) => [`${v.record_id}:${v.column_id}`, v]));
  const close: number[] = [];
  const ins = { r: [] as number[], c: [] as number[], kind: [] as string[], num: [] as (string | null)[], txt: [] as (string | null)[], f: [] as (string | null)[] };
  const vseen = new Set<string>();
  for (const r of planned) {
    const rid = recId.get(r.rowKey)!;
    for (const v of r.values) {
      const cid = state.columns[v.col];
      const key = `${rid}:${cid}`;
      vseen.add(key);
      const old = cur.get(key);
      if (old && old.kind === v.kind && sameNum(old.num, v.num) && old.txt === v.txt && old.formula === v.formula) continue;
      if (old) close.push(Number(old.id));
      ins.r.push(rid); ins.c.push(cid); ins.kind.push(v.kind); ins.num.push(v.num === null ? null : String(v.num)); ins.txt.push(v.txt); ins.f.push(v.formula);
    }
  }
  for (const [key, v] of cur) if (!vseen.has(key)) close.push(Number(v.id));

  // スプシの合計(同じなら何もしない)
  const tcur = new Map(tnow!.map((x) => [`${x.record_id}:${x.column_id}`, x]));
  const tclose: number[] = [];
  const tins = { r: [] as number[], c: [] as number[], num: [] as (string | null)[], txt: [] as (string | null)[], f: [] as (string | null)[] };
  const tseen = new Set<string>();
  for (const r of planned) {
    const rid = recId.get(r.rowKey)!;
    for (const x of r.totals) {
      const cid = state.columns[x.col];
      const key = `${rid}:${cid}`;
      tseen.add(key);
      const old = tcur.get(key);
      if (old && sameNum(old.num, x.num) && old.txt === x.txt && old.formula === x.formula) continue;
      if (old) tclose.push(Number(old.id));
      tins.r.push(rid); tins.c.push(cid); tins.num.push(x.num === null ? null : String(x.num)); tins.txt.push(x.txt); tins.f.push(x.formula);
    }
  }
  for (const [key, x] of tcur) if (!tseen.has(key)) tclose.push(Number(x.id));

  // 閉じてから足す(今の版は1つだけ。順に送るので、この順に動く)
  await Promise.all([
    close.length ? tx`update fourdb.value set system_to = clock_timestamp() where id = any(${close}::bigint[])` : null,
    ins.r.length
      ? tx`
        insert into fourdb.value (workspace_id, sheet_id, record_id, column_id, kind, num, txt, formula, origin, recorded_by)
        select fourdb.current_workspace_id(), ${sheetId}, x.r, x.c, x.k, x.n, x.t, x.f, 'import', current_setting('fourdb.principal', true)
          from unnest(${ins.r}::bigint[], ${ins.c}::bigint[], ${ins.kind}::text[], ${ins.num}::numeric[], ${ins.txt}::text[], ${ins.f}::text[]) as x(r, c, k, n, t, f)`
      : null,
    tclose.length ? tx`update fourdb.source_total set system_to = clock_timestamp() where id = any(${tclose}::bigint[])` : null,
    tins.r.length
      ? tx`
        insert into fourdb.source_total (workspace_id, sheet_id, record_id, column_id, num, txt, formula)
        select fourdb.current_workspace_id(), ${sheetId}, x.r, x.c, x.n, x.t, x.f
          from unnest(${tins.r}::bigint[], ${tins.c}::bigint[], ${tins.num}::numeric[], ${tins.txt}::text[], ${tins.f}::text[]) as x(r, c, n, t, f)`
      : null,
  ]);
  clock.trace("write.values", t);
  state.counts.rows += planned.length;
  state.counts.values += ins.r.length;
  state.counts.totals += tins.r.length;
  state.counts.closedValues += close.length;
}

// ---------- 最後: 読み直しでなくなった行を閉じ、置き場を片付ける(時間で区切り、続きは次の呼び出しで) ----------
/** 終わったら true。区切ったら false(次の呼び出しで続ける) */
async function finish(tx: Tx, run: RunRow, state: ApplyState, worked: boolean, clock: Clock): Promise<boolean> {
  const f = (state.finish ??= { closed: !state.hadRecords, closedRecords: 0, cleanedTo: 0, cleaned: false });
  let t = performance.now();
  if (!f.closed) {
    // 今回の行の鍵: データの行は鍵の列の値、鍵が空の行と合計の行は行番号(#n)。全行を JS に持ってこず SQL で作る
    if (worked && clock.left() < clock.budget / 2) return false;
    await tx`create temp table seen_key (k text primary key) on commit drop`;
    await tx`
      insert into seen_key
      select key from (${stagedKeys(tx, run.id, state.spec)}) x where not is_agg and key !~ ${String.raw`^\|*$`}
      union
      select '#' || (row_index + 1) from fourdb.import_row where run_id = ${run.id}
      on conflict do nothing`;
    await tx`analyze seen_key`;   // 件数を知らせて、鍵と行の突き合わせを1回で済ませる
    const gone = await tx<{ id: string }[]>`
      update fourdb.record r set system_to = clock_timestamp()
       where r.sheet_id = ${run.sheet_id} and r.system_to is null and not exists (select 1 from seen_key s where s.k = r.row_key)
       returning r.id`;
    if (gone.length) {
      const g = gone.map((x) => Number(x.id));
      await Promise.all([
        tx`update fourdb.value set system_to = clock_timestamp() where record_id = any(${g}::bigint[]) and system_to is null`,
        tx`update fourdb.source_total set system_to = clock_timestamp() where record_id = any(${g}::bigint[]) and system_to is null`,
      ]);
    }
    await tx`drop table seen_key`;
    f.closed = true;
    f.closedRecords = gone.length;
    // 閉じ終えたので、もう閉じる必要はない。前のつくりに戻して続きを書いても、置き場の一部が消えたあとで閉じ直さないように false にする
    state.hadRecords = false;
    worked = true;
    t = clock.trace("finish.close", t);
  }
  // 元のセルの中身(個人情報を含みうる)は残さない。多ければ区切って消す
  while (!f.cleaned) {
    if (worked && clock.left() <= 0) return false;
    const to = f.cleanedTo + clock.cleanupRows;
    if (to >= state.next) {
      await tx`delete from fourdb.import_row where run_id = ${run.id}`;
      f.cleaned = true;
    } else {
      await tx`delete from fourdb.import_row where run_id = ${run.id} and row_index < ${to}`;
      f.cleanedTo = to;
    }
    worked = true;
    t = clock.trace("finish.cleanup", t);
  }
  const c = state.counts;
  const lines = [`行 ${c.rows} 行`, `新しく入れた値 ${c.values} 個`, `スプシの合計 ${c.totals} 個`,
    ...(c.closedValues ? [`変わった・消えた値 ${c.closedValues} 個は前の版として残した`] : []),
    ...(f.closedRecords ? [`スプシからなくなった行 ${f.closedRecords} 行を閉じた`] : [])];
  await Promise.all([
    tx`update fourdb.import_run set status = 'applied', finished_at = now(), cursor = ${tx.json({ ...run.cursor, apply: state })} where id = ${run.id}`,
    tx`update fourdb.source_sheet set last_read_at = now(), updated_at = now() where id = ${run.sheet_id}`,
    tx`
      insert into fourdb.history (workspace_id, actor, kind, title, detail)
      select fourdb.current_workspace_id(), current_setting('fourdb.principal', true), 'import', '「' || s.title || '」を取り込んだ',
             ${tx.json({ sheet_id: run.sheet_id, run_id: run.id, lines })}
        from fourdb.source_sheet s where s.id = ${run.sheet_id}`,
  ]);
  clock.trace("finish.end", t);
  return true;
}

/**
 * 次の分を書く。spec は最初の呼び出しのときだけ使い、あとは保存したものを使う。
 * 1回の呼び出しは時間で区切る(書けたところまでを確定して返す)。done になるまで呼び続ける。
 */
export async function applyNext(scope: Scope, runId: string, spec: ApprovalSpec | null, options: ApplyOptions = {}): Promise<ApplyResult> {
  const started = performance.now();
  const budget = options.budgetMs ?? APPLY_BUDGET_MS;
  const clock: Clock = {
    budget,
    cleanupRows: Math.max(1, options.cleanupRows ?? CLEANUP_ROWS),
    left: () => budget - (performance.now() - started),
    trace: (phase, since) => {
      const now = performance.now();
      options.trace?.(phase, now - since);
      return now;
    },
  };
  return withScope(scope, async (tx) => {
    let t = performance.now();
    const [run] = await tx<RunRow[]>`select id, sheet_id, status, started_at, cursor from fourdb.import_run where id = ${runId} for update`;
    if (!run) throw new ImportError("取り込みが見つかりません", 404);
    const [sheet] = await tx<{ migration_status: string }[]>`select migration_status from fourdb.source_sheet where id = ${run.sheet_id}`;
    if (sheet?.migration_status === "migrated") throw new ImportError("移行完了した表には、スプシから取り込みません(D-002)", 409);
    let state = run.cursor.apply;
    if (run.status === "applied") return { done: true, next: run.cursor.total, total: run.cursor.total, counts: state?.counts ?? { rows: 0, values: 0, totals: 0, closedValues: 0 } };
    t = clock.trace("start", t);
    let worked = false;
    if (run.status === "staged") {
      if (!spec) throw new ImportError("承認の内容がありません");
      // 全行の組み立ては画面の「全行で確かめる」で済ませている。ここでは内容の矛盾と、鍵の重なり(SQL)だけを確かめる
      const errors = validateSpec(spec, spec.columns.length);
      if (!errors.length && (await duplicateKeys(tx, runId, spec)).length) errors.push("行を見分ける列に、同じ値の行があります");
      if (errors.length) throw new ImportError(errors.join("\n"));
      t = clock.trace("keys", t);
      state = await setup(tx, run, spec);
      await tx`update fourdb.import_run set status = 'applying' where id = ${runId}`;
      t = clock.trace("setup", t);
      worked = true;
    } else if (run.status !== "applying" || !state) {
      throw new ImportError(`この取り込みは ${run.status} です`, 409);
    }

    // 行: まとまりごとに書き、時間が来たら区切る(まとまりの大きさは、かかった時間に合わせて変える)
    const cols = Math.max(1, state.spec.columns.length);
    const minRows = Math.max(20, Math.ceil(MIN_CELLS / cols));
    const maxRows = Math.max(minRows, Math.floor(MAX_CELLS / cols));
    const clamp = (n: number) => Math.min(maxRows, Math.max(minRows, Math.floor(n)));
    while (!state.done) {
      const left = clock.left();
      const perRow = state.msPerRow;
      if (worked && left < (perRow ?? 1) * minRows) break;
      // 残りの時間に収まる行の数(速さがまだ分からなければ、セルの数から決める)。少なくとも minRows 行は書くので、必ず進む
      const room = Math.max(0, Math.min(STEP_MS, left));
      const size = perRow ? clamp(room / perRow) : clamp((START_CELLS / cols) * (room / STEP_MS));
      const step = performance.now();
      const rows = await loadRows(tx, runId, state.next, size);
      t = clock.trace("load", step);
      if (rows.length) {
        const p = planRows(state.spec, rows);
        t = clock.trace("plan", t);
        if (p.rows.length) await writeRows(tx, run.sheet_id, state, p.rows, clock);
        state.next = rows[rows.length - 1].index + 1;
        const ms = (performance.now() - step) / rows.length;
        state.msPerRow = perRow ? (perRow + ms) / 2 : ms;
      }
      if (rows.length < size) state.done = true;   // 置き場の行はこれで終わり
      worked = true;
    }

    // 最後: なくなった行を閉じ、置き場を片付ける(時間が残っていなければ次の呼び出しで)
    t = performance.now();
    if (state.done && (await finish(tx, run, state, worked, clock))) {
      return { done: true, next: state.next, total: run.cursor.total, counts: state.counts };
    }
    await tx`update fourdb.import_run set cursor = ${tx.json({ ...run.cursor, apply: state })} where id = ${runId}`;
    clock.trace("cursor", t);
    return { done: false, next: state.next, total: run.cursor.total, counts: state.counts };
  });
}
