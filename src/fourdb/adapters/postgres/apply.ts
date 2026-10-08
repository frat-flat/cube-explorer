// 承認した内容を、分割して fourdb の表に書く。1回の呼び出しで applyChunk 行ずつ(列の数による)。途中で止まっても続きから書ける。
// 最初の呼び出しで、全行の確かめ・意味(カラム・軸)と列の準備をし、承認の内容を取り込みに保存する(あとの呼び出しはそれを使う)。
import { columnHeaders } from "@/fourdb/core/import/layout";
import { MONTH_DIMENSION, planRows, validateSpec, type ApprovalSpec, type PlannedRow } from "@/fourdb/core/import/plan";
import type { Scope, Tx } from "./db";
import { withScope } from "./db";
import { ImportError, keyFacts, loadRows, stagedKeys } from "./import-store";

/** 1回に書く行の数。セルがおよそ 4 万個になるように、列の数に合わせる(20〜2000 行) */
const applyChunk = (cols: number) => Math.min(2000, Math.max(20, Math.floor(40000 / Math.max(1, cols))));

type ApplyState = {
  next: number;
  done: boolean;
  spec: ApprovalSpec;
  /** 列の番号 → source_column.id */
  columns: Record<string, number>;
  /** この取り込みの前に、表に行があったか(読み直しのとき、なくなった行を閉じる) */
  hadRecords: boolean;
  counts: { rows: number; values: number; totals: number; closedValues: number };
};
type RunRow = { id: string; sheet_id: string; status: string; started_at: Date; cursor: { next: number; total: number; cols: number; done: boolean; apply?: ApplyState } };

// ---------- 意味(軸・カラム・軸の値)の準備 ----------
async function ensureDimension(tx: Tx, name: string, semantic: "time" | "entity" | "category"): Promise<string> {
  const levels = semantic === "time" && name === MONTH_DIMENSION ? ["年", "四半期", "月"] : [];
  const [d] = await tx<{ id: string }[]>`
    insert into fourdb.dimension (workspace_id, name, semantic_type, levels)
    values (fourdb.current_workspace_id(), ${name}, ${semantic}, ${levels}::text[])
    on conflict (workspace_id, name) do update set updated_at = fourdb.dimension.updated_at
    returning id`;
  return d.id;
}

async function ensureDefinition(tx: Tx, name: string, kind: "dimension" | "measure" | "attribute", dimensionId: string | null): Promise<string> {
  const [found] = await tx<{ id: string; kind: string; dimension_id: string | null }[]>`
    select id, kind, dimension_id from fourdb.column_definition where name = ${name} and subtitle is null`;
  if (found) {
    if (found.kind !== kind) throw new ImportError(`カラム「${name}」はすでに ${found.kind} として登録されています(${kind} としては使えません)`);
    if (kind === "dimension" && found.dimension_id !== dimensionId) throw new ImportError(`カラム「${name}」は別の軸に結びついています`);
    return found.id;
  }
  const [d] = await tx<{ id: string }[]>`
    insert into fourdb.column_definition (workspace_id, name, kind, dimension_id)
    values (fourdb.current_workspace_id(), ${name}, ${kind}, ${dimensionId}) returning id`;
  return d.id;
}

/** 段のない軸の値を名前でそろえる(なければ作る)。名前 → id */
async function ensureMembers(tx: Tx, dimensionId: string, names: string[]): Promise<Map<string, string>> {
  const uniq = [...new Set(names)];
  if (!uniq.length) return new Map();
  await tx`
    insert into fourdb.dimension_member (workspace_id, dimension_id, name)
    select fourdb.current_workspace_id(), ${dimensionId}, n from unnest(${uniq}::text[]) as n
    on conflict (dimension_id, parent_id, name) do nothing`;
  const rows = await tx<{ id: string; name: string }[]>`
    select id, name from fourdb.dimension_member where dimension_id = ${dimensionId} and parent_id is null and name = any(${uniq}::text[])`;
  return new Map(rows.map((r) => [r.name, r.id]));
}

/** 月(YYYY-MM)の軸の値を、年 › 四半期 › 月 の段でそろえる。月の id を返す */
async function ensureMonth(tx: Tx, dimensionId: string, ym: string): Promise<string> {
  const [y, m] = ym.split("-").map(Number);
  const q = Math.floor((m - 1) / 3) + 1;
  const iso = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, "0")}-01`;
  const one = async (parent: string | null, name: string, start: string, end: string) => {
    await tx`
      insert into fourdb.dimension_member (workspace_id, dimension_id, parent_id, name, period_start, period_end)
      values (fourdb.current_workspace_id(), ${dimensionId}, ${parent}, ${name}, ${start}::date, ${end}::date)
      on conflict (dimension_id, parent_id, name) do nothing`;
    const [r] = await tx<{ id: string }[]>`
      select id from fourdb.dimension_member where dimension_id = ${dimensionId} and parent_id is not distinct from ${parent} and name = ${name}`;
    return r.id;
  };
  const year = await one(null, String(y), iso(y, 1), iso(y + 1, 1));
  const quarter = await one(year, `${y}-Q${q}`, iso(y, q * 3 - 2), q === 4 ? iso(y + 1, 1) : iso(y, q * 3 + 1));
  return one(quarter, ym, iso(y, m), m === 12 ? iso(y + 1, 1) : iso(y, m + 1));
}

// ---------- 最初の呼び出し: 列の準備 ----------
async function setup(tx: Tx, run: RunRow, spec: ApprovalSpec): Promise<ApplyState> {
  const sheetId = run.sheet_id;
  const dimensionIds = new Map<string, string>();
  const entityDimension = spec.entityColumn === null ? null : (spec.columns.find((c) => c.index === spec.entityColumn) as { dimension?: string } | undefined)?.dimension ?? null;
  const dim = async (name: string) => {
    if (!dimensionIds.has(name)) dimensionIds.set(name, await ensureDimension(tx, name, name === MONTH_DIMENSION ? "time" : name === entityDimension ? "entity" : "category"));
    return dimensionIds.get(name)!;
  };

  // 表全体の軸の値
  for (const s of spec.sheetCoords) {
    const d = await dim(s.dimension);
    const member = (await ensureMembers(tx, d, [s.member])).get(s.member)!;
    await tx`
      insert into fourdb.sheet_coord (workspace_id, sheet_id, dimension_id, member_id)
      values (fourdb.current_workspace_id(), ${sheetId}, ${d}, ${member})
      on conflict (sheet_id, dimension_id) do update set member_id = excluded.member_id`;
  }

  // 列名(列名の行とグループ名の行から)
  const head = await loadRows(tx, run.id, 0, spec.headerRow + 1);
  const grid: string[][] = [];
  head.forEach((r) => (grid[r.index] = r.cells.map((c) => c.v)));
  for (let i = 0; i <= spec.headerRow; i++) grid[i] ??= [];
  const headers = columnHeaders(grid, { headerRow: spec.headerRow, groupRow: spec.groupRow }, spec.columns.length);

  // 列: 同じ位置・同じ見出し・同じ意味なら前の列を使い、変わっていれば前の列を閉じて新しく作る
  const current = await tx<{ id: string; col_index: number; header: string; role: string; column_definition_id: string | null; aggregate_function: string | null; detail: Record<string, unknown> }[]>`
    select id, col_index, header, role, column_definition_id, aggregate_function, detail from fourdb.source_column where sheet_id = ${sheetId} and system_to is null`;
  const columns: Record<string, number> = {};
  const monthDim = spec.columns.some((c) => c.role === "measure" && c.month) ? await dim(MONTH_DIMENSION) : null;
  for (const c of spec.columns) {
    const h = headers[c.index];
    let defId: string | null = null;
    if (c.role === "dimension") defId = await ensureDefinition(tx, c.definition, "dimension", await dim(c.dimension));
    else if (c.role === "measure") defId = await ensureDefinition(tx, c.definition, "measure", null);
    else if (c.role === "attribute") defId = await ensureDefinition(tx, c.definition, "attribute", null);
    else if (c.role === "aggregate" && c.definition) defId = await ensureDefinition(tx, c.definition, "measure", null);
    const detail = { month: c.role === "measure" ? c.month : null, sums: c.role === "aggregate" ? c.sums : null };
    const fn = c.role === "aggregate" ? c.fn : null;
    const old = current.find((x) => x.col_index === c.index);
    const same = old && old.header === h.label && old.role === c.role && old.column_definition_id === defId && old.aggregate_function === fn
      && JSON.stringify(old.detail?.month ?? null) === JSON.stringify(detail.month) && JSON.stringify(old.detail?.sums ?? null) === JSON.stringify(detail.sums);
    if (same) {
      columns[c.index] = Number(old!.id);
      continue;
    }
    if (old) await tx`update fourdb.source_column set system_to = clock_timestamp() where id = ${old.id}`;
    const [col] = await tx<{ id: string }[]>`
      insert into fourdb.source_column (workspace_id, sheet_id, col_index, header, group_label, role, column_definition_id, aggregate_function, detail, approved_at, approved_by)
      values (fourdb.current_workspace_id(), ${sheetId}, ${c.index}, ${h.label}, ${h.group}, ${c.role}, ${defId}, ${fn}, ${tx.json(detail)}, now(), current_setting('fourdb.principal', true))
      returning id`;
    columns[c.index] = Number(col.id);
    if (c.role === "measure" && c.month && monthDim) {
      const member = await ensureMonth(tx, monthDim, c.month);
      await tx`
        insert into fourdb.column_coord (workspace_id, column_id, dimension_id, member_id)
        values (fourdb.current_workspace_id(), ${col.id}, ${monthDim}, ${member})`;
    }
  }
  await tx`update fourdb.source_sheet set header_row = ${spec.headerRow}, group_row = ${spec.groupRow}, updated_at = now() where id = ${sheetId}`;
  const [{ n }] = await tx<{ n: string }[]>`select count(*) as n from fourdb.record where sheet_id = ${sheetId} and system_to is null`;
  return { next: 0, done: false, spec, columns, hadRecords: Number(n) > 0, counts: { rows: 0, values: 0, totals: 0, closedValues: 0 } };
}

// ---------- 行の書き込み ----------
const sameNum = (a: string | null, b: number | null) => (a === null ? b === null : b !== null && Number(a) === b);

async function writeRows(tx: Tx, sheetId: string, state: ApplyState, planned: PlannedRow[]) {
  const spec = state.spec;
  // 行の軸の値と、行が表す実体(Box)
  const byDim = new Map<string, Set<string>>();
  for (const r of planned) for (const c of r.coords) (byDim.get(c.dimension) ?? byDim.set(c.dimension, new Set()).get(c.dimension)!).add(c.member);
  const memberIds = new Map<string, Map<string, string>>();
  const dimIds = new Map<string, string>();
  for (const [d, names] of byDim) {
    const [row] = await tx<{ id: string }[]>`select id from fourdb.dimension where name = ${d}`;
    dimIds.set(d, row.id);
    memberIds.set(d, await ensureMembers(tx, row.id, [...names]));
  }
  const entityDim = spec.entityColumn === null ? null : (spec.columns.find((c) => c.index === spec.entityColumn) as { dimension?: string }).dimension!;
  const boxOf = new Map<string, string>();
  if (entityDim) {
    const names = [...new Set(planned.map((r) => r.entity).filter((e): e is string => !!e))];
    const ids = memberIds.get(entityDim) ?? new Map();
    const members = names.length
      ? await tx<{ id: string; name: string; box_id: string | null }[]>`select id, name, box_id from fourdb.dimension_member where id = any(${[...names.map((n) => ids.get(n)).filter(Boolean)] as string[]}::uuid[])`
      : [];
    for (const m of members) {
      let box = m.box_id;
      if (!box) {
        const [b] = await tx<{ id: string }[]>`
          insert into fourdb.box (workspace_id, type, unit_type, name) values (fourdb.current_workspace_id(), 'entity', ${entityDim}, ${m.name}) returning id`;
        box = b.id;
        await tx`update fourdb.dimension_member set box_id = ${box} where id = ${m.id}`;
      }
      boxOf.set(m.name, box);
    }
  }

  // 行(同じ鍵の今の行があれば、それを使う)
  const recs = await tx<{ id: string; row_key: string }[]>`
    insert into fourdb.record (workspace_id, sheet_id, row_key, row_index, kind, box_id)
    select fourdb.current_workspace_id(), ${sheetId}, x.k, x.i, x.kind, x.box
      from unnest(${planned.map((r) => r.rowKey)}::text[], ${planned.map((r) => r.rowIndex)}::int[], ${planned.map((r) => r.kind)}::text[],
                  ${planned.map((r) => (r.entity ? boxOf.get(r.entity) ?? null : null))}::uuid[]) as x(k, i, kind, box)
    on conflict (sheet_id, row_key) where system_to is null
    do update set row_index = excluded.row_index, kind = excluded.kind, box_id = excluded.box_id
    returning id, row_key`;
  const recId = new Map(recs.map((r) => [r.row_key, Number(r.id)]));

  // 行の軸の値
  const rc: [number, string, string][] = [];
  for (const r of planned) for (const c of r.coords) rc.push([recId.get(r.rowKey)!, dimIds.get(c.dimension)!, memberIds.get(c.dimension)!.get(c.member)!]);
  if (rc.length) {
    await tx`
      insert into fourdb.record_coord (workspace_id, record_id, dimension_id, member_id)
      select fourdb.current_workspace_id(), x.r, x.d, x.m from unnest(${rc.map((x) => x[0])}::bigint[], ${rc.map((x) => x[1])}::uuid[], ${rc.map((x) => x[2])}::uuid[]) as x(r, d, m)
      on conflict (record_id, dimension_id) do update set member_id = excluded.member_id`;
  }

  // 値: 今の値と同じなら何もしない。変わっていれば前の版を閉じて新しい版を足す。空になったセルは閉じる
  const ids = [...recId.values()];
  const now = await tx<{ id: string; record_id: string; column_id: string; kind: string; num: string | null; txt: string | null; formula: string | null }[]>`
    select id, record_id, column_id, kind, num, txt, formula from fourdb.value where record_id = any(${ids}::bigint[]) and system_to is null`;
  const cur = new Map(now.map((v) => [`${v.record_id}:${v.column_id}`, v]));
  const close: number[] = [];
  const ins = { r: [] as number[], c: [] as number[], kind: [] as string[], num: [] as (string | null)[], txt: [] as (string | null)[], f: [] as (string | null)[] };
  const seen = new Set<string>();
  for (const r of planned) {
    const rid = recId.get(r.rowKey)!;
    for (const v of r.values) {
      const cid = state.columns[v.col];
      const key = `${rid}:${cid}`;
      seen.add(key);
      const old = cur.get(key);
      if (old && old.kind === v.kind && sameNum(old.num, v.num) && old.txt === v.txt && old.formula === v.formula) continue;
      if (old) close.push(Number(old.id));
      ins.r.push(rid); ins.c.push(cid); ins.kind.push(v.kind); ins.num.push(v.num === null ? null : String(v.num)); ins.txt.push(v.txt); ins.f.push(v.formula);
    }
  }
  for (const [key, v] of cur) if (!seen.has(key)) close.push(Number(v.id));
  if (close.length) await tx`update fourdb.value set system_to = clock_timestamp() where id = any(${close}::bigint[])`;
  if (ins.r.length) {
    await tx`
      insert into fourdb.value (workspace_id, sheet_id, record_id, column_id, kind, num, txt, formula, origin, recorded_by)
      select fourdb.current_workspace_id(), ${sheetId}, x.r, x.c, x.k, x.n, x.t, x.f, 'import', current_setting('fourdb.principal', true)
        from unnest(${ins.r}::bigint[], ${ins.c}::bigint[], ${ins.kind}::text[], ${ins.num}::numeric[], ${ins.txt}::text[], ${ins.f}::text[]) as x(r, c, k, n, t, f)`;
  }

  // スプシの合計(同じなら何もしない)
  const tnow = await tx<{ id: string; record_id: string; column_id: string; num: string | null; txt: string | null; formula: string | null }[]>`
    select id, record_id, column_id, num, txt, formula from fourdb.source_total where record_id = any(${ids}::bigint[]) and system_to is null`;
  const tcur = new Map(tnow.map((t) => [`${t.record_id}:${t.column_id}`, t]));
  const tclose: number[] = [];
  const tins = { r: [] as number[], c: [] as number[], num: [] as (string | null)[], txt: [] as (string | null)[], f: [] as (string | null)[] };
  const tseen = new Set<string>();
  for (const r of planned) {
    const rid = recId.get(r.rowKey)!;
    for (const t of r.totals) {
      const cid = state.columns[t.col];
      const key = `${rid}:${cid}`;
      tseen.add(key);
      const old = tcur.get(key);
      if (old && sameNum(old.num, t.num) && old.txt === t.txt && old.formula === t.formula) continue;
      if (old) tclose.push(Number(old.id));
      tins.r.push(rid); tins.c.push(cid); tins.num.push(t.num === null ? null : String(t.num)); tins.txt.push(t.txt); tins.f.push(t.formula);
    }
  }
  for (const [key, t] of tcur) if (!tseen.has(key)) tclose.push(Number(t.id));
  if (tclose.length) await tx`update fourdb.source_total set system_to = clock_timestamp() where id = any(${tclose}::bigint[])`;
  if (tins.r.length) {
    await tx`
      insert into fourdb.source_total (workspace_id, sheet_id, record_id, column_id, num, txt, formula)
      select fourdb.current_workspace_id(), ${sheetId}, x.r, x.c, x.n, x.t, x.f
        from unnest(${tins.r}::bigint[], ${tins.c}::bigint[], ${tins.num}::numeric[], ${tins.txt}::text[], ${tins.f}::text[]) as x(r, c, n, t, f)`;
  }
  state.counts.rows += planned.length;
  state.counts.values += ins.r.length;
  state.counts.totals += tins.r.length;
  state.counts.closedValues += close.length;
}

// ---------- 最後: 読み直しでなくなった行を閉じ、置き場を片付ける ----------
async function finish(tx: Tx, run: RunRow, state: ApplyState) {
  let closedRecords = 0;
  if (state.hadRecords) {
    // 今回の行の鍵: データの行は鍵の列の値、鍵が空の行と合計の行は行番号(#n)。全行を JS に持ってこず SQL で作る
    await tx`create temp table seen_key (k text primary key) on commit drop`;
    await tx`
      insert into seen_key
      select key from (${stagedKeys(tx, run.id, state.spec)}) x where not is_agg and key !~ ${String.raw`^\|*$`}
      union
      select '#' || (row_index + 1) from fourdb.import_row where run_id = ${run.id}
      on conflict do nothing`;
    const gone = await tx<{ id: string }[]>`
      update fourdb.record set system_to = clock_timestamp()
       where sheet_id = ${run.sheet_id} and system_to is null and row_key not in (select k from seen_key)
       returning id`;
    closedRecords = gone.length;
    if (gone.length) {
      const g = gone.map((x) => Number(x.id));
      await tx`update fourdb.value set system_to = clock_timestamp() where record_id = any(${g}::bigint[]) and system_to is null`;
      await tx`update fourdb.source_total set system_to = clock_timestamp() where record_id = any(${g}::bigint[]) and system_to is null`;
    }
  }
  await tx`delete from fourdb.import_row where run_id = ${run.id}`;   // 元のセルの中身(個人情報を含みうる)は残さない
  await tx`update fourdb.import_run set status = 'applied', finished_at = now() where id = ${run.id}`;
  const [s] = await tx<{ title: string }[]>`update fourdb.source_sheet set last_read_at = now(), updated_at = now() where id = ${run.sheet_id} returning title`;
  const c = state.counts;
  await tx`
    insert into fourdb.history (workspace_id, actor, kind, title, detail)
    values (fourdb.current_workspace_id(), current_setting('fourdb.principal', true), 'import', ${`「${s.title}」を取り込んだ`},
            ${tx.json({ sheet_id: run.sheet_id, run_id: run.id, lines: [`行 ${c.rows} 行`, `新しく入れた値 ${c.values} 個`, `スプシの合計 ${c.totals} 個`, ...(c.closedValues ? [`変わった・消えた値 ${c.closedValues} 個は前の版として残した`] : []), ...(closedRecords ? [`スプシからなくなった行 ${closedRecords} 行を閉じた`] : [])] })})`;
}

/** 次の分を書く。spec は最初の呼び出しのときだけ使い、あとは保存したものを使う */
export async function applyNext(scope: Scope, runId: string, spec: ApprovalSpec | null): Promise<{ done: boolean; next: number; total: number; counts: ApplyState["counts"] }> {
  return withScope(scope, async (tx) => {
    const [run] = await tx<RunRow[]>`select id, sheet_id, status, started_at, cursor from fourdb.import_run where id = ${runId} for update`;
    if (!run) throw new ImportError("取り込みが見つかりません", 404);
    const [sheet] = await tx<{ migration_status: string }[]>`select migration_status from fourdb.source_sheet where id = ${run.sheet_id}`;
    if (sheet?.migration_status === "migrated") throw new ImportError("移行完了した表には、スプシから取り込みません(D-002)", 409);
    let state = run.cursor.apply;
    if (run.status === "applied") return { done: true, next: run.cursor.total, total: run.cursor.total, counts: state?.counts ?? { rows: 0, values: 0, totals: 0, closedValues: 0 } };
    if (run.status === "staged") {
      if (!spec) throw new ImportError("承認の内容がありません");
      // 全行の組み立ては画面の「全行で確かめる」で済ませている。ここでは内容の矛盾と、鍵の重なり(SQL)だけを確かめる
      const errors = validateSpec(spec, spec.columns.length);
      if (!errors.length && (await keyFacts(tx, runId, spec)).duplicateKeys.length) errors.push("行を見分ける列に、同じ値の行があります");
      if (errors.length) throw new ImportError(errors.join("\n"));
      state = await setup(tx, run, spec);
      await tx`update fourdb.import_run set status = 'applying' where id = ${runId}`;
    } else if (run.status !== "applying" || !state) {
      throw new ImportError(`この取り込みは ${run.status} です`, 409);
    }
    const rows = await loadRows(tx, runId, state.next, applyChunk(state.spec.columns.length));
    if (rows.length) {
      const p = planRows(state.spec, rows);
      if (p.rows.length) await writeRows(tx, run.sheet_id, state, p.rows);
      state.next = rows[rows.length - 1].index + 1;
    } else {
      state.done = true;
    }
    await tx`update fourdb.import_run set cursor = ${tx.json({ ...run.cursor, apply: state })} where id = ${runId}`;
    if (state.done) await finish(tx, run, state);
    return { done: state.done, next: state.next, total: run.cursor.total, counts: state.counts };
  });
}
