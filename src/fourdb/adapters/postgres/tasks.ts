// Task(やること)と、ファイルごとの移行の進み具合の読み取り(つなぎ)。withScope の中で呼ぶ。
// SQL は事実(消していないシートとファイルごとの、移行の状態・最後に取り込んだ日・最後の取り込み)を集めるだけ。
// Task の分け方・進み具合の数え方・並べ方は芯(core/tasks)が決める。
// workspace は SQL のパラメータで絞り(scope.workspaceId)、行ごとの権限(RLS)が重ねて守る。新しい設定・権限・関数は作らない。
// 取り込みの error の文は読まない(セルの中身が入りうるため)。
import { buildTaskOverview, RUN_STATUSES, TASK_LIMITS, TASK_RUN_STATUSES, type RunStatus, type TaskOverview, type TaskRow } from "@/fourdb/core/tasks";
import type { Scope, Tx } from "./db";

const TIMEOUT = "10s";

function workspaceOf(scope: Scope): string {
  if (!scope.workspaceId) throw new Error("workspace がありません");
  return scope.workspaceId;
}

type Row = {
  sheet_id: string;
  sheet: string;
  file_id: string;
  file: string;
  migration_status: string;
  last_read_at: Date | null;
  has_uncancelled: boolean;
  run_id: string | null;
  run_status: string | null;
  run_started_at: Date | null;
  run_finished_at: Date | null;
};

const isRunStatus = (s: string): s is RunStatus => (RUN_STATUSES as readonly string[]).includes(s);

function toRow(r: Row): TaskRow {
  return {
    sheetId: r.sheet_id,
    sheet: r.sheet,
    fileId: r.file_id,
    file: r.file,
    migrationStatus: r.migration_status === "migrated" ? "migrated" : "migrating",
    lastReadAt: r.last_read_at ? r.last_read_at.toISOString() : null,
    hasUncancelledRun: r.has_uncancelled,
    lastRun:
      r.run_id !== null && r.run_status !== null && isRunStatus(r.run_status) && r.run_started_at !== null
        ? { id: r.run_id, status: r.run_status, startedAt: r.run_started_at.toISOString(), finishedAt: r.run_finished_at ? r.run_finished_at.toISOString() : null }
        : null,
  };
}

/**
 * やることの一覧と、ファイルごとの進み具合。消していないシート(と消していないファイル)を TASK_LIMITS.rows 件まで読む
 * (ファイルの題・ファイルの id・シートの題・シートの id の順。上限で切れても、ファイルの途中までで終わる)。
 * 最後の取り込み = そのシートの import_run を (started_at, id) の新しい順の先頭。取り消した取り込みしかなければ「始めていない」。
 */
export async function loadTasks(tx: Tx, scope: Scope): Promise<TaskOverview> {
  const ws = workspaceOf(scope);
  const [, rows] = await Promise.all([
    tx`select set_config('statement_timeout', ${TIMEOUT}, true)`,
    tx<Row[]>`
      select s.id as sheet_id, s.title as sheet, c.id as file_id, c.title as file, s.migration_status, s.last_read_at,
             exists (select 1 from fourdb.import_run u where u.workspace_id = ${ws} and u.sheet_id = s.id and u.status <> 'cancelled') as has_uncancelled,
             lr.id as run_id, lr.status as run_status, lr.started_at as run_started_at, lr.finished_at as run_finished_at
        from fourdb.source_sheet s
        join fourdb.source_container c on c.id = s.container_id and c.workspace_id = ${ws}
        left join lateral (
          select r.id, r.status, r.started_at, r.finished_at
            from fourdb.import_run r
           where r.workspace_id = ${ws} and r.sheet_id = s.id
           order by r.started_at desc, r.id desc
           limit 1) lr on true
       where s.workspace_id = ${ws} and s.deleted_at is null and c.deleted_at is null
       order by c.title, c.id, s.title, s.id
       limit ${TASK_LIMITS.rows}`,
  ]);
  return buildTaskOverview(rows.map(toRow));
}

/**
 * メニューに出す件数: 最後の取り込みの状態が TASK_RUN_STATUSES(承認待ち・読み取りの途中・反映の途中・失敗)のシートの数。
 * loadTasks の count と同じ数え方(消したシート・消したファイルは除く)。
 */
export async function countTasks(tx: Tx, scope: Scope): Promise<number> {
  const ws = workspaceOf(scope);
  const [, rows] = await Promise.all([
    tx`select set_config('statement_timeout', ${TIMEOUT}, true)`,
    tx<{ n: string }[]>`
      select count(*) as n
        from fourdb.source_sheet s
        join fourdb.source_container c on c.id = s.container_id and c.workspace_id = ${ws} and c.deleted_at is null
        join lateral (
          select r.status
            from fourdb.import_run r
           where r.workspace_id = ${ws} and r.sheet_id = s.id
           order by r.started_at desc, r.id desc
           limit 1) lr on true
       where s.workspace_id = ${ws} and s.deleted_at is null and lr.status = any(${[...TASK_RUN_STATUSES]}::text[])`,
  ]);
  return Number(rows[0]?.n ?? 0);
}
