// Task(やること)と、ファイルごとの移行の進み具合の形。GET /api/4db/tasks が返す。
import type { Listed } from "../listed";

/** 取り込み(import_run)の状態。DB の check と同じ */
export const RUN_STATUSES = ["reading", "staged", "applying", "applied", "failed", "cancelled"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** Task になる取り込みの状態。件数の SQL にもパラメータで渡す(途中も数える) */
export const TASK_RUN_STATUSES = ["staged", "reading", "applying", "failed"] as const;
export type TaskRunStatus = (typeof TASK_RUN_STATUSES)[number];

/** approval = 承認待ち(staged) / in_progress = 途中(reading・applying) / failed = 失敗。照合の食い違いは P3 から */
export type TaskKind = "approval" | "in_progress" | "failed";

export type TaskItem = {
  kind: TaskKind;
  runStatus: TaskRunStatus;
  runId: string;
  sheetId: string;
  sheet: string;
  fileId: string;
  file: string;
  startedAt: string;
  finishedAt: string | null;
};

export type FileProgress = {
  fileId: string;
  file: string;
  /** 取り込みを始めたシートの数(migrated + inProgress + imported + failed) */
  started: number;
  migrated: number;
  inProgress: number;
  imported: number;
  failed: number;
  /** まだ取り込みを始めていないシートの数(started には入れない) */
  notStarted: number;
};

/** 進み具合の分け方。シートはどれか 1 つに入る */
export type ProgressBucket = "migrated" | "inProgress" | "imported" | "failed" | "notStarted";

export type TaskOverview = { count: number; items: Listed<TaskItem>; files: Listed<FileProgress> };

/**
 * SQL の 1 行 = 消していないシート 1 枚(と、消していないファイル)。
 * lastRun = そのシートの最後の取り込み(started_at, id の新しい順の先頭)。なければ null。
 * hasUncancelledRun = 取り消していない(status が cancelled でない)取り込みが 1 つでもあるか。
 * error の文は入れない(返さない)。
 */
export type TaskRow = {
  sheetId: string;
  sheet: string;
  fileId: string;
  file: string;
  migrationStatus: "migrating" | "migrated";
  lastReadAt: string | null;
  hasUncancelledRun: boolean;
  lastRun: { id: string; status: RunStatus; startedAt: string; finishedAt: string | null } | null;
};
