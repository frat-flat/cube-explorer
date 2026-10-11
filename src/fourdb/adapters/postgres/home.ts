// ホーム(GET /api/4db/home)に出す事実の読み取り(つなぎ)。withScope の中で呼ぶ。
// SQL は事実を集めるだけ。並べ方・上限・欄の組み立て・Table との照合は芯(core/home)が決める。
// workspace は SQL のパラメータで絞り(scope.workspaceId)、行ごとの権限(RLS)が重ねて守る。新しい設定・権限・関数は作らない。
// 表名・列名は固定で、値はすべてパラメータで渡す。
//
// 流れ(同じトランザクションで、順に送ってまとめて待つ。apply.ts と同じ):
//   1. Q1  いちばん上の Box を単位(nullif(unit_type, ''))でまとめる → orderUnits で出す単位(6 つまで)を決める
//   2. Q2a 名前 / Q2b 中に / Q2c 元のシート(S)/ Q2d 軸(D)/ Q4 表の定義
//   3. Q3a 列(Card の項目・数値)/ Q3c 期間(どちらも S の分だけ)
//   4. Q3b 計算された値(ƒ)があるか(出す数値 12 個だけ)
//
// 元のシート(S)= 単位の Box を指す軸の値(M)の、(a) 軸の列があるシート (b) シート全体の軸の値が M のシート
//   (c) 今の行(record)が単位の Box に結ばれたシート(= 行で結ばれた印)。消したシートとファイルは除く。
// 期間は、S の今の数値の列の column_coord と S の sheet_coord にある時間の軸の値から求める。
//   行ごとに月がある(record_coord)シートは数えない(制約: 行の数だけ値を読まないと分からないため)。
import {
  buildHomeOverview,
  HOME_LIMITS,
  orderColumns,
  orderUnits,
  unitKey,
  type ColumnFact,
  type HomeOverview,
  type MeasureFact,
  type SheetFact,
  type TableCandidate,
  type UnitFacts,
  type UnitGroup,
  type UnitRef,
} from "@/fourdb/core/home";
import type { Scope, Tx } from "./db";

const TIMEOUT = "10s";

function workspaceOf(scope: Scope): string {
  if (!scope.workspaceId) throw new Error("workspace がありません");
  return scope.workspaceId;
}

/** 出す単位ごとの事実(組み立て中。core の UnitFacts と同じ形で、配列に足していく) */
type Building = { -readonly [K in keyof UnitFacts]: UnitFacts[K] extends readonly (infer T)[] ? T[] : UnitFacts[K] };

const emptyBuilding = (): Building => ({
  names: [],
  inside: [],
  sheets: [],
  dimensionIds: [],
  cardFields: [],
  measures: [],
  periodStart: null,
  periodEndExclusive: null,
});

/**
 * 出す単位のいちばん上の Box(id, name, ord)。units の n 番目(1 から)= 出す単位の n 番目。null = 単位なし。
 * unit_type は nullif(…, '') で単位にそろえて、is not distinct from で結ぶ(単位なしの Box も結べる)。
 */
const topBoxesOf = (tx: Tx, ws: string, units: (string | null)[]) => tx`
  tb as (
    select b.id, b.name, u.ord::int as ord
      from unnest(${units}::text[]) with ordinality as u(unit_type, ord)
      join fourdb.box b on nullif(b.unit_type, '') is not distinct from u.unit_type
     where b.workspace_id = ${ws} and b.parent_id is null)`;

type Q1Row = { unit_type: string | null; n: string; has_children: boolean; total: string };
type NameRow = { ord: number; name: string };
type InsideRow = { ord: number; unit_type: string | null; n: string };
type SheetRow = { ord: number; sheet_id: string; file: string; sheet: string; last_read_at: Date | null; via_rows: boolean };
type DimensionRow = { ord: number; dimension_id: string };
type TableRow = { id: string; name: string; updated_at: Date; definition: unknown };
type ColumnRow = { ord: number; kind: "attribute" | "measure"; name: string; position: number; columns: string[] | null };
type PeriodRow = { ord: number; period_start: string; period_end: string };
type CalculatedRow = { k: number; calculated: boolean };

export async function loadHome(tx: Tx, scope: Scope): Promise<HomeOverview> {
  const ws = workspaceOf(scope);

  // ---- Q1: いちばん上の Box を単位ごとに ----
  // 子のある単位かどうかは「親になっている id」と左結合で求める(box_parent)。種類は HOME_LIMITS.unitTypes まで。
  // total = いちばん上の Box の総数(種類の上限で切る前)
  const [, q1] = await Promise.all([
    tx`select set_config('statement_timeout', ${TIMEOUT}, true)`,
    tx<Q1Row[]>`
      with parents as (
        select distinct c.parent_id as id from fourdb.box c where c.workspace_id = ${ws} and c.parent_id is not null)
      select nullif(b.unit_type, '') as unit_type, count(*) as n, bool_or(p.id is not null) as has_children,
             sum(count(*)) over () as total
        from fourdb.box b
        left join parents p on p.id = b.id
       where b.workspace_id = ${ws} and b.parent_id is null
       group by nullif(b.unit_type, '')
       order by bool_or(p.id is not null) desc, count(*) desc, nullif(b.unit_type, '') asc nulls last
       limit ${HOME_LIMITS.unitTypes}`,
  ]);
  const groups: UnitGroup[] = q1.map((r) => ({ unitType: r.unit_type, count: Number(r.n), hasChildren: r.has_children }));
  const topBoxes = q1.length ? Number(q1[0].total) : 0;
  const { shown } = orderUnits(groups);
  const building = shown.map(emptyBuilding);
  const facts = new Map(shown.map((g, i) => [unitKey(g.unitType), building[i]]));
  let tables: TableCandidate[] = [];
  if (shown.length === 0) return buildHomeOverview({ groups, topBoxes, units: facts, tables });

  const units = shown.map((g) => g.unitType);
  const at = (ord: number): Building | undefined => building[ord - 1];

  // ---- Q2: 単位ごとの事実(名前・中に・元のシート・軸)と、表の定義 ----
  const [names, inside, sheetRows, dimensionRows, tableRows] = await Promise.all([
    // Q2a 名前: (name, id) の順で先頭から。それより多い分は、芯が数から求める(more)
    tx<NameRow[]>`
      with ${topBoxesOf(tx, ws, units)}
      select n.ord, n.name
        from (select tb.ord, tb.name, row_number() over (partition by tb.ord order by tb.name, tb.id) as rn from tb) n
       where n.rn <= ${HOME_LIMITS.names}
       order by n.ord, n.rn`,
    // Q2b 中に: 子孫(すべての段)を単位ごとに数える。深さは HOME_LIMITS.depth まで、単位の種類は HOME_LIMITS.unitTypes まで(各単位)
    tx<InsideRow[]>`
      with recursive ${topBoxesOf(tx, ws, units)},
      walk as (
        select tb.ord, c.id, c.unit_type, 1 as depth
          from tb join fourdb.box c on c.parent_id = tb.id and c.workspace_id = ${ws}
        union all
        select w.ord, c.id, c.unit_type, w.depth + 1
          from walk w join fourdb.box c on c.parent_id = w.id and c.workspace_id = ${ws}
         where w.depth < ${HOME_LIMITS.depth}),
      grouped as (
        select ord, nullif(unit_type, '') as unit_type, count(*) as n from walk group by ord, nullif(unit_type, '')),
      ranked as (
        select g.*, row_number() over (partition by g.ord order by g.n desc, g.unit_type asc nulls last) as rn from grouped g)
      select ord, unit_type, n from ranked where rn <= ${HOME_LIMITS.unitTypes} order by ord, rn`,
    // Q2c 元のシート(S): (a) 軸の列があるシート (b) シート全体の軸の値が M のシート (c) 今の行が単位の Box に結ばれたシート(= 行で結ばれた印)
    tx<SheetRow[]>`
      with ${topBoxesOf(tx, ws, units)},
      m as (
        select tb.ord, dm.id as member_id, dm.dimension_id
          from tb join fourdb.dimension_member dm on dm.box_id = tb.id
         where dm.workspace_id = ${ws}),
      d as (select distinct ord, dimension_id from m),
      hit as (
        select d.ord, sc.sheet_id, false as via_rows
          from d
          join fourdb.column_definition cd on cd.dimension_id = d.dimension_id and cd.kind = 'dimension' and cd.workspace_id = ${ws}
          join fourdb.source_column sc on sc.column_definition_id = cd.id and sc.role = 'dimension' and sc.system_to is null and sc.workspace_id = ${ws}
        union all
        select m.ord, sco.sheet_id, false
          from m join fourdb.sheet_coord sco on sco.member_id = m.member_id and sco.workspace_id = ${ws}
        union all
        select tb.ord, r.sheet_id, true
          from tb join fourdb.record r on r.box_id = tb.id and r.system_to is null and r.workspace_id = ${ws}),
      s as (select ord, sheet_id, bool_or(via_rows) as via_rows from hit group by ord, sheet_id)
      select s.ord, s.sheet_id, c.title as file, ss.title as sheet, ss.last_read_at, s.via_rows
        from s
        join fourdb.source_sheet ss on ss.id = s.sheet_id and ss.workspace_id = ${ws} and ss.deleted_at is null
        join fourdb.source_container c on c.id = ss.container_id and c.workspace_id = ${ws} and c.deleted_at is null`,
    // Q2d 軸(D): 単位の Box が軸の値になっている軸。Table との照合に使う
    tx<DimensionRow[]>`
      with ${topBoxesOf(tx, ws, units)}
      select distinct tb.ord, dm.dimension_id
        from tb join fourdb.dimension_member dm on dm.box_id = tb.id
       where dm.workspace_id = ${ws}`,
    // Q4 表の定義(消していないもの。新しい順に HOME_LIMITS.tableDefinitions まで)。照合に使う rows・columns・filters・sources だけ読む
    tx<TableRow[]>`
      select sd.id, sd.name, sd.updated_at,
             jsonb_build_object('rows', sd.definition -> 'rows', 'columns', sd.definition -> 'columns',
                                'filters', sd.definition -> 'filters', 'sources', sd.definition -> 'sources') as definition
        from fourdb.sheet_definition sd
       where sd.workspace_id = ${ws} and sd.deleted_at is null
       order by sd.updated_at desc, sd.id
       limit ${HOME_LIMITS.tableDefinitions}`,
  ]);
  for (const r of names) at(r.ord)?.names.push(r.name);
  for (const r of inside) at(r.ord)?.inside.push({ unitType: r.unit_type, count: Number(r.n) } satisfies UnitRef);
  for (const r of sheetRows) {
    at(r.ord)?.sheets.push({
      sheetId: r.sheet_id,
      file: r.file,
      sheet: r.sheet,
      lastReadAt: r.last_read_at ? r.last_read_at.toISOString() : null,
      viaRows: r.via_rows,
    } satisfies SheetFact);
  }
  for (const r of dimensionRows) at(r.ord)?.dimensionIds.push(r.dimension_id);
  tables = tableRows.map((r) => ({ id: r.id, name: r.name, updatedAt: r.updated_at.toISOString(), definition: r.definition }));

  // ---- Q3: S の列(Card の項目・数値)と期間 ----
  // S は Q2c の結果をそのまま渡す(単位の番号・シートの id・行で結ばれた印)
  const sOrd = sheetRows.map((r) => r.ord);
  const sSheet = sheetRows.map((r) => r.sheet_id);
  // 真偽の配列は postgres.js が bool[] でなく bool として送り、::bool[] で止まる(42846)ので、't'・'f' の文字の配列で渡す
  const sVia = sheetRows.map((r) => (r.via_rows ? "t" : "f"));
  const measureColumns = new Map<MeasureFact, string[]>();
  if (sheetRows.length > 0) {
    const [columnRows, periodRows] = await Promise.all([
      // Q3a 列: S の今の列を column_definition ごとにまとめる(いちばん左の位置つき)。
      //   attribute は行で結ばれたシートだけ(Box の属性)、measure は S のすべて。使わなくした(deprecated)カラムは入れない。
      //   measure は ƒ を調べるために、列(source_column)の id も返す
      tx<ColumnRow[]>`
        with s as (select x.ord, x.sheet_id, x.via = 't' as via_rows from unnest(${sOrd}::int[], ${sSheet}::uuid[], ${sVia}::text[]) as x(ord, sheet_id, via))
        select s.ord, cd.kind, cd.name, min(sc.col_index)::int as position,
               array_agg(sc.id::text) filter (where sc.role = 'measure') as columns
          from s
          join fourdb.source_column sc on sc.sheet_id = s.sheet_id and sc.system_to is null and sc.workspace_id = ${ws}
          join fourdb.column_definition cd on cd.id = sc.column_definition_id and cd.workspace_id = ${ws} and cd.status = 'active'
         where (sc.role = 'measure' and cd.kind = 'measure') or (sc.role = 'attribute' and cd.kind = 'attribute' and s.via_rows)
         group by s.ord, cd.id, cd.kind, cd.name`,
      // Q3c 期間: S の今の数値の列の column_coord と、S の sheet_coord にある時間の軸の値(period_start がある値)の最小と最大。
      //   使わなくした(deprecated)カラムの列は数えない。終わりが入っていない値は、始まりの翌日までとして数える(月の終わりが始まりより前にならないように)。日付は文字で返す(時差で日がずれない)
      tx<PeriodRow[]>`
        with s as (select * from unnest(${sOrd}::int[], ${sSheet}::uuid[]) as x(ord, sheet_id)),
        hit as (
          select s.ord, m.period_start, coalesce(m.period_end, m.period_start + 1) as period_end
            from s
            join fourdb.source_column sc on sc.sheet_id = s.sheet_id and sc.role = 'measure' and sc.system_to is null and sc.workspace_id = ${ws}
            join fourdb.column_definition cd on cd.id = sc.column_definition_id and cd.workspace_id = ${ws} and cd.status = 'active'
            join fourdb.column_coord cc on cc.column_id = sc.id and cc.workspace_id = ${ws}
            join fourdb.dimension_member m on m.id = cc.member_id and m.workspace_id = ${ws} and m.period_start is not null
          union all
          select s.ord, m.period_start, coalesce(m.period_end, m.period_start + 1)
            from s
            join fourdb.sheet_coord sco on sco.sheet_id = s.sheet_id and sco.workspace_id = ${ws}
            join fourdb.dimension_member m on m.id = sco.member_id and m.workspace_id = ${ws} and m.period_start is not null)
        select ord, min(period_start)::text as period_start, max(period_end)::text as period_end from hit group by ord`,
    ]);
    for (const r of periodRows) {
      const b = at(r.ord);
      if (b) {
        b.periodStart = r.period_start;
        b.periodEndExclusive = r.period_end;
      }
    }
    for (const r of columnRows) {
      const b = at(r.ord);
      if (!b) continue;
      if (r.kind === "attribute") b.cardFields.push({ name: r.name, position: r.position } satisfies ColumnFact);
      else {
        const m: MeasureFact = { name: r.name, position: r.position, calculated: false };
        b.measures.push(m);
        measureColumns.set(m, r.columns ?? []);
      }
    }
  }

  // ---- Q3b: 計算された値(ƒ)があるか。出す数値(並べた先頭 HOME_LIMITS.fields 個)だけ調べる。0007 の部分索引で引く ----
  const probes: MeasureFact[] = [];
  for (const b of building) probes.push(...orderColumns(b.measures).slice(0, HOME_LIMITS.fields));
  if (probes.length > 0) {
    const hits = await tx<CalculatedRow[]>`
      select t.k, exists (select 1 from fourdb.value v
                           where v.column_id = any(t.cols) and v.workspace_id = ${ws} and v.kind = 'calculated' and v.system_to is null) as calculated
        from jsonb_to_recordset(${tx.json(probes.map((m, k) => ({ k, cols: measureColumns.get(m) ?? [] })))}::jsonb) as t(k int, cols bigint[])`;
    for (const r of hits) if (r.calculated) probes[r.k].calculated = true;
  }

  return buildHomeOverview({ groups, topBoxes, units: facts, tables });
}
