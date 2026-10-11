// Task の分け方と、ファイルごとの移行の進み具合の数え方(D-017)。
import { compareText, listed, timeOf } from "../listed";
import {
  TASK_RUN_STATUSES,
  type FileProgress,
  type ProgressBucket,
  type TaskItem,
  type TaskKind,
  type TaskOverview,
  type TaskRow,
  type TaskRunStatus,
} from "./types";

/** SQL が一度に読むシートの数(消していないシートの上限) */
export const TASK_LIMITS = { rows: 5000, items: 100, files: 100 } as const;

const isTaskRunStatus = (s: unknown): s is TaskRunStatus => (TASK_RUN_STATUSES as readonly unknown[]).includes(s);

/** 取り込みの状態から Task の種類を決める。staged → 承認待ち、reading・applying → 途中、failed → 失敗。それ以外(applied・cancelled など)は Task にならない(null) */
export function taskOf(status: string | null | undefined): TaskKind | null {
  switch (status) {
    case "staged":
      return "approval";
    case "reading":
    case "applying":
      return "in_progress";
    case "failed":
      return "failed";
    default:
      return null;
  }
}

/**
 * シートを進み具合のどれか 1 つに入れる。優先は 移行完了 > 途中 > 取り込み済み > 失敗。
 * - migrated: migration_status が migrated
 * - notStarted: 取り消していない取り込みがない(取り込みを始めていない)
 * - inProgress: 最後の取り込みが staged・reading・applying(承認待ちも途中に入れる)
 * - imported: last_read_at がある(反映したことがある)か、最後の取り込みが applied
 * - failed: それ以外(取り込みを始めたが、反映したことがない)
 */
export function progressBucket(row: Pick<TaskRow, "migrationStatus" | "lastReadAt" | "hasUncancelledRun" | "lastRun">): ProgressBucket {
  if (row.migrationStatus === "migrated") return "migrated";
  if (!row.hasUncancelledRun) return "notStarted";
  const s = row.lastRun?.status;
  if (s === "staged" || s === "reading" || s === "applying") return "inProgress";
  if (row.lastReadAt !== null || s === "applied") return "imported";
  return "failed";
}

const KIND_ORDER: Record<TaskKind, number> = { approval: 0, failed: 1, in_progress: 2 };

/** Task の並べ方: 承認待ち → 失敗 → 途中、同じ種類の中では始めた日時の新しい順(同じなら取り込みの id) */
function compareItems(a: TaskItem, b: TaskItem): number {
  return (
    KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
    (timeOf(b.startedAt) ?? -Infinity) - (timeOf(a.startedAt) ?? -Infinity) ||
    compareText(a.runId, b.runId)
  );
}

/** SQL の行から、やることの一覧とファイルごとの進み具合を作る。count は上限で切る前の Task の数 */
export function buildTaskOverview(rows: readonly TaskRow[]): TaskOverview {
  const items: TaskItem[] = [];
  const files = new Map<string, FileProgress>();
  for (const r of rows) {
    const run = r.lastRun;
    const kind = taskOf(run?.status);
    if (run && kind && isTaskRunStatus(run.status)) {
      items.push({
        kind,
        runStatus: run.status,
        runId: run.id,
        sheetId: r.sheetId,
        sheet: r.sheet,
        fileId: r.fileId,
        file: r.file,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
      });
    }
    let f = files.get(r.fileId);
    if (!f) {
      f = { fileId: r.fileId, file: r.file, started: 0, migrated: 0, inProgress: 0, imported: 0, failed: 0, notStarted: 0 };
      files.set(r.fileId, f);
    }
    const b = progressBucket(r);
    f[b] += 1;
    if (b !== "notStarted") f.started += 1;
  }
  items.sort(compareItems);
  const fileList = [...files.values()].sort((a, b) => compareText(a.file, b.file) || compareText(a.fileId, b.fileId));
  return { count: items.length, items: listed(items, TASK_LIMITS.items), files: listed(fileList, TASK_LIMITS.files) };
}
