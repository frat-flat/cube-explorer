// Task の画面に出す文字(種類の名前)。決めるのはオーナー(D-015)。ここは作業指示 11 章の案。
import type { TaskRunStatus } from "./types";

export const TASK_STATUS_LABELS: Record<TaskRunStatus, string> = {
  staged: "承認待ち",
  reading: "読み取りの途中",
  applying: "反映の途中",
  failed: "失敗",
};
