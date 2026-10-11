"use client";

// Task の画面(/tasks)。開いたときに 1 回、やることの一覧とファイルごとの移行の進み具合を読む。
// 読めたら、メニューの印の件数も同じ数に合わせる(window の fourdb:tasks-changed に件数を付けて知らせる。読み直しはさせない)。
import { useEffect, useState } from "react";
import type { TaskOverview } from "@/fourdb/core/tasks";
import { api } from "../api";
import { TASKS_CHANGED_EVENT } from "../task-count";
import { TasksView } from "./TasksView";

export function Tasks() {
  const [overview, setOverview] = useState<TaskOverview | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    // 画面を開いたときに、一度だけ外(サーバー)から読む
    const ctrl = new AbortController();
    void (async () => {
      try {
        const o = await api<TaskOverview>("/api/4db/tasks", { signal: ctrl.signal });
        if (ctrl.signal.aborted) return;
        setOverview(o);
        window.dispatchEvent(new CustomEvent(TASKS_CHANGED_EVENT, { detail: { count: o.count } }));
      } catch (e) {
        if (!ctrl.signal.aborted) setError((e as Error).message);
      }
    })();
    return () => ctrl.abort();
  }, []);

  return <TasksView overview={overview} error={error} />;
}
