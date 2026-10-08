// 取り込み(移行の入口)の読み書き。スプシの登録 → 分割読み(Saving に置く)→ 候補 → 承認の確かめ → 分割して反映。
// どの関数も withScope の中(fourdb.workspace_id を設定したトランザクション)で呼ぶ。workspace は行ごとの権限で絞られる。
import { analyzeSheet, type SheetProposal } from "@/fourdb/core/import/analyze";
import { planRows, validateSpec, type ApprovalSpec, type PlanProblem } from "@/fourdb/core/import/plan";
import type { SourceCell } from "@/fourdb/core/import/types";
import { chunkRows, type SourceBook, type SourceReader } from "@/fourdb/core/ports";
import type { Scope, Tx } from "./db";
import { withScope } from "./db";

export class ImportError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export type SheetSummary = {
  id: string;
  title: string;
  rowCount: number | null;
  colCount: number | null;
  migrationStatus: "migrating" | "migrated";
  records: number;
  lastRun: { id: string; status: string; rowsRead: number; startedAt: string } | null;
  /** どのスプシのタブか(一覧をスプシごとにまとめる) */
  book: { id: string; title: string; url: string | null };
};

type RunCursor = { next: number; total: number; cols: number; done: boolean; apply?: { next: number; done: boolean } };
type RunRow = { id: string; sheet_id: string; status: string; rows_read: number; cursor: RunCursor; started_at: Date };

// ---------- セルを置き場(import_row)に入れる形 ----------
/** 空のキーは省いて小さくする */
const packCell = (c: SourceCell) => {
  const o: { v?: string; n?: number; f?: string } = {};
  if (c.v) o.v = c.v;
  if (c.n !== null) o.n = c.n;
  if (c.f !== null) o.f = c.f;
  return o;
};
const unpackCell = (o: { v?: string; n?: number; f?: string } | null): SourceCell => ({ v: o?.v ?? "", n: o?.n ?? null, f: o?.f ?? null });

// ---------- スプシの登録 ----------
/** スプシとタブを登録する(同じスプシ・同じタブは前のものを使う)。タブの一覧を返す */
export async function registerBook(tx: Tx, book: SourceBook): Promise<SheetSummary[]> {
  const [container] = await tx<{ id: string }[]>`
    insert into fourdb.source_container (workspace_id, provider, external_id, title, url)
    values (fourdb.current_workspace_id(), ${book.provider}, ${book.externalId}, ${book.title}, ${book.url})
    on conflict (workspace_id, provider, external_id) where external_id is not null and deleted_at is null
    do update set title = excluded.title, url = excluded.url
    returning id`;
  for (const t of book.tabs) {
    await tx`
      insert into fourdb.source_sheet (workspace_id, container_id, external_id, title, source_row_count, source_col_count, created_at)
      values (fourdb.current_workspace_id(), ${container.id}, ${t.externalId}, ${t.title}, ${t.rowCount}, ${t.colCount}, clock_timestamp())
      on conflict (container_id, external_id) where external_id is not null and deleted_at is null
      do update set title = excluded.title, source_row_count = excluded.source_row_count, source_col_count = excluded.source_col_count, updated_at = now()`;
  }
  return listSheets(tx, container.id);
}

export async function listSheets(tx: Tx, containerId?: string): Promise<SheetSummary[]> {
  const rows = await tx<{
    id: string; title: string; source_row_count: number | null; source_col_count: number | null; migration_status: "migrating" | "migrated";
    records: string; run_id: string | null; run_status: string | null; rows_read: number | null; started_at: Date | null; external_id: string | null; container_id: string;
    book_title: string; book_url: string | null;
  }[]>`
    select s.id, s.title, s.source_row_count, s.source_col_count, s.migration_status, s.external_id, s.container_id, sc.title as book_title, sc.url as book_url,
           (select count(*) from fourdb.record r where r.sheet_id = s.id and r.system_to is null) as records,
           lr.id as run_id, lr.status as run_status, lr.rows_read, lr.started_at
      from fourdb.source_sheet s
      join fourdb.source_container sc on sc.id = s.container_id
      left join lateral (select * from fourdb.import_run r where r.sheet_id = s.id order by r.started_at desc limit 1) lr on true
     where s.deleted_at is null and s.workspace_id = fourdb.current_workspace_id() ${containerId ? tx`and s.container_id = ${containerId}` : tx``}
     order by sc.created_at desc, s.created_at`;   // 新しく読んだスプシを上に
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    rowCount: r.source_row_count,
    colCount: r.source_col_count,
    migrationStatus: r.migration_status,
    records: Number(r.records),
    lastRun: r.run_id ? { id: r.run_id, status: r.run_status!, rowsRead: r.rows_read ?? 0, startedAt: r.started_at!.toISOString() } : null,
    book: { id: r.container_id, title: r.book_title, url: r.book_url },
  }));
}

async function sheetSource(tx: Tx, sheetId: string) {
  const [s] = await tx<{ id: string; title: string; migration_status: string; source_row_count: number | null; source_col_count: number | null; external_id: string; book_id: string; deleted_at: Date | null }[]>`
    select s.id, s.title, s.migration_status, s.source_row_count, s.source_col_count, c.external_id, c.external_id as book_id, s.deleted_at
      from fourdb.source_sheet s join fourdb.source_container c on c.id = s.container_id
     where s.id = ${sheetId} and s.workspace_id = fourdb.current_workspace_id()`;
  if (!s || s.deleted_at) throw new ImportError("表が見つかりません", 404);
  return s;
}

// ---------- 読み取り(分割して Saving に置く) ----------
/** 取り込みを始める(同じ表の途中のものがあれば、それを続ける) */
export async function startRun(tx: Tx, sheetId: string, by: string): Promise<RunRow> {
  const s = await sheetSource(tx, sheetId);
  if (s.migration_status === "migrated") throw new ImportError("移行完了した表には、スプシから取り込みません(D-002)", 409);
  const [active] = await tx<RunRow[]>`select * from fourdb.import_run where sheet_id = ${sheetId} and workspace_id = fourdb.current_workspace_id() and status in ('reading', 'staged', 'applying')`;
  if (active) return active;
  const cursor: RunCursor = { next: 0, total: s.source_row_count ?? 0, cols: s.source_col_count ?? 0, done: false };
  const [run] = await tx<RunRow[]>`
    insert into fourdb.import_run (workspace_id, sheet_id, status, started_by, cursor)
    values (fourdb.current_workspace_id(), ${sheetId}, 'reading', ${by}, ${tx.json(cursor)})
    returning *`;
  return run;
}

async function getRun(tx: Tx, runId: string): Promise<RunRow> {
  const [run] = await tx<RunRow[]>`select * from fourdb.import_run where id = ${runId} and workspace_id = fourdb.current_workspace_id()`;
  if (!run) throw new ImportError("取り込みが見つかりません", 404);
  return run;
}

/**
 * 次の分を読んで置き場に入れる。スプシを読む間はトランザクションを開かない(長く握らないように)。
 * 途中で止まっても、次に呼べば続きから読む。
 */
export async function readNext(scope: Scope, runId: string, reader: SourceReader): Promise<{ rowsRead: number; total: number; done: boolean }> {
  const before = await withScope(scope, async (tx) => {
    const run = await getRun(tx, runId);
    if (run.status !== "reading") return { run, s: null };
    return { run, s: await sheetSource(tx, run.sheet_id) };
  });
  const { run, s } = before;
  if (!s) return { rowsRead: run.rows_read, total: run.cursor.total, done: true };
  const c = run.cursor;
  const count = chunkRows(c.cols);
  const { rows } = c.next < c.total ? await reader.rows({ externalId: s.book_id }, { title: s.title, colCount: c.cols }, c.next, count) : { rows: [] };
  return withScope(scope, async (tx) => {
    const now = await getRun(tx, runId);
    if (now.status !== "reading" || now.cursor.next !== c.next) return { rowsRead: now.rows_read, total: now.cursor.total, done: now.status !== "reading" };   // ほかの呼び出しが先に進めた
    const idx: number[] = [];
    const cells: string[] = [];
    rows.forEach((r, i) => {
      if (!r.some((x) => x.v !== "" || x.f !== null)) return;   // 空の行は置かない
      idx.push(c.next + i);
      cells.push(JSON.stringify(r.map(packCell)));
    });
    if (idx.length) {
      await tx`
        insert into fourdb.import_row (workspace_id, run_id, row_index, cells)
        select fourdb.current_workspace_id(), ${runId}, x.i, x.c::jsonb from unnest(${idx}::int[], ${cells}::text[]) as x(i, c)
        on conflict (run_id, row_index) do update set cells = excluded.cells`;
    }
    const next = Math.min(c.next + count, c.total);
    const done = next >= c.total;
    const cursor: RunCursor = { ...c, next, done };
    await tx`
      update fourdb.import_run set cursor = ${tx.json(cursor)}, rows_read = rows_read + ${idx.length}, status = ${done ? "staged" : "reading"}
       where id = ${runId}`;
    return { rowsRead: now.rows_read + idx.length, total: c.total, done };
  });
}

export async function loadRows(tx: Tx, runId: string, from: number, limit: number): Promise<{ index: number; cells: SourceCell[] }[]> {
  const rows = await tx<{ row_index: number; cells: ({ v?: string; n?: number; f?: string } | null)[] }[]>`
    select row_index, cells from fourdb.import_row where run_id = ${runId} and row_index >= ${from} order by row_index limit ${limit}`;
  return rows.map((r) => ({ index: r.row_index, cells: r.cells.map(unpackCell) }));
}

// ---------- 候補 ----------
const PROPOSAL_ROWS = 500;

/** 先頭の行から候補を作る(承認の画面に出す) */
export async function proposal(tx: Tx, runId: string, layout?: { headerRow: number; groupRow: number | null }): Promise<{ sheet: { id: string; title: string }; run: { status: string; rowsRead: number }; proposal: SheetProposal; preview: { index: number; cells: SourceCell[] }[] }> {
  const run = await getRun(tx, runId);
  if (run.status === "reading") throw new ImportError("まだ読み取りの途中です", 409);
  const s = await sheetSource(tx, run.sheet_id);
  const rows = (await loadRows(tx, runId, 0, PROPOSAL_ROWS)).filter((r) => r.index < PROPOSAL_ROWS);
  const width = Math.max(0, ...rows.map((r) => r.cells.length));
  const dense: SourceCell[][] = [];
  rows.forEach((r) => (dense[r.index] = r.cells));
  for (let i = 0; i < dense.length; i++) dense[i] ??= Array.from({ length: width }, () => ({ v: "", n: null, f: null }));
  return {
    sheet: { id: s.id, title: s.title },
    run: { status: run.status, rowsRead: run.rows_read },
    proposal: analyzeSheet({ title: s.title, rows: dense, layout }),
    preview: rows.slice(0, 40),
  };
}

// ---------- 承認の確かめ(全行。分割して呼ぶ) ----------
export type ApplyCheck = {
  errors: string[];
  dataRows: number;
  aggregateRows: number;
  values: number;
  calculatedValues: number;
  totals: number;
  entities: number;
  problems: PlanProblem[];
  problemCount: number;
  duplicateKeys: { key: string; rows: number[] }[];
  /** 次に確かめる行(from に渡す)。done なら終わり */
  next: number;
  done: boolean;
};

const CHECK_CHUNK = 5000;
/** 1回の呼び出しで確かめる行の数(画面がくり返し呼ぶ) */
const CHECK_ROWS_PER_CALL = 20000;
/** 合計・小計の見出し(analyze.ts の TOTAL_LABEL と同じ) */
const TOTAL_LABEL_SQL = String.raw`(合計|小計|総計|累計|年計|月計|^計$|^total$|^subtotal$|grand\s*total)`;
const NUM_TEXT_SQL = String.raw`^[¥￥$]?\s?-?[\d,]+(\.\d+)?%?$`;

/**
 * 置き場の行の「行を見分ける鍵」と「合計の行か(おおよそ)」を SQL で作る(全行を JS に持ってこない)。
 * 合計の行は見出しの文字で見分ける(関数だけで見分ける合計の行は、鍵が空なら数えないので影響しない)。
 */
export function stagedKeys(tx: Tx, runId: string, spec: ApprovalSpec) {
  const key = spec.rowKeyColumns.length
    ? tx`array_to_string(array(select coalesce(btrim(r.cells -> u.k ->> 'v'), '') from unnest(${spec.rowKeyColumns}::int[]) with ordinality as u(k, o) order by u.o), '|')`
    : tx`''`;
  return tx`
    select r.row_index, ${key} as key,
           ((${spec.aggregateRows.auto} and not r.row_index = any(${spec.aggregateRows.exclude}::int[])
             and exists (select 1 from jsonb_array_elements(r.cells) c where coalesce(c ->> 'v', '') ~* ${TOTAL_LABEL_SQL} and coalesce(c ->> 'v', '') !~ ${NUM_TEXT_SQL}))
            or r.row_index = any(${spec.aggregateRows.include}::int[])) as is_agg,
           ${spec.entityColumn === null ? tx`null::text` : tx`nullif(btrim(r.cells -> ${spec.entityColumn}::int ->> 'v'), '')`} as entity
      from fourdb.import_row r
     where r.run_id = ${runId} and r.row_index > ${spec.headerRow}`;
}

/** 鍵の重なり(データの行で同じ鍵)と、実体(Box)の数 */
export async function keyFacts(tx: Tx, runId: string, spec: ApprovalSpec): Promise<{ duplicateKeys: { key: string; rows: number[] }[]; entities: number }> {
  const dup = await tx<{ key: string; rows: number[] }[]>`
    select key, (array_agg(row_index + 1 order by row_index))[1:5] as rows
      from (${stagedKeys(tx, runId, spec)}) x
     where not is_agg and key !~ ${String.raw`^\|*$`}
     group by key having count(*) > 1
     order by min(row_index) limit 10`;
  const [{ n }] = await tx<{ n: string }[]>`select count(distinct entity) as n from (${stagedKeys(tx, runId, spec)}) x where not is_agg and entity is not null`;
  return { duplicateKeys: dup, entities: Number(n) };
}

/** 承認の内容で、from 行目から一定の数の行を組み立ててみて、件数と問題を返す(書き込みはしない)。from = 0 のときだけ鍵の重なりも見る */
export async function checkApply(tx: Tx, runId: string, spec: ApprovalSpec, from = 0): Promise<ApplyCheck> {
  const run = await getRun(tx, runId);
  const out: ApplyCheck = { errors: validateSpec(spec, spec.columns.length), dataRows: 0, aggregateRows: 0, values: 0, calculatedValues: 0, totals: 0, entities: 0, problems: [], problemCount: 0, duplicateKeys: [], next: from, done: true };
  if (run.status !== "staged") out.errors.push(run.status === "reading" ? "まだ読み取りの途中です" : `この取り込みは ${run.status} です`);
  if (out.errors.length) return out;
  if (from === 0) {
    const f = await keyFacts(tx, runId, spec);
    out.duplicateKeys = f.duplicateKeys;
    out.entities = f.entities;
    if (f.duplicateKeys.length) out.errors.push("行を見分ける列に、同じ値の行があります。列を足すか、行番号で見分ける形にしてください");
  }
  let cursor = from;
  let seen = 0;
  out.done = false;
  while (seen < CHECK_ROWS_PER_CALL) {
    const rows = await loadRows(tx, runId, cursor, CHECK_CHUNK);
    if (!rows.length) {
      out.done = true;
      break;
    }
    const p = planRows(spec, rows);
    for (const r of p.rows) {
      if (r.kind === "aggregate") out.aggregateRows++;
      else out.dataRows++;
      out.values += r.values.length;
      out.calculatedValues += r.values.filter((v) => v.kind === "calculated").length;
      out.totals += r.totals.length;
    }
    out.problemCount += p.problems.length;
    for (const x of p.problems) if (out.problems.length < 20) out.problems.push(x);
    seen += rows.length;
    cursor = rows[rows.length - 1].index + 1;
  }
  out.next = cursor;
  return out;
}
