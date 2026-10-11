// Task の画面の中身(読み込み済みのデータを描くだけ。データの取得は Tasks.tsx)。
// 文字はすべて React が描く(ファイル名・シート名はテキストとして出る)。日時は日本時間で、サーバーでもブラウザでも同じ文字になる。
import Link from "next/link";
import { TASK_STATUS_LABELS, type FileProgress, type TaskItem, type TaskOverview } from "@/fourdb/core/tasks";
import { formatDateTimeTokyo } from "../format";
import s from "./tasks.module.css";

/** 進み具合の 1 行目に出す、取り込みを始めたシートの内訳(この順) */
export function progressCounts(f: FileProgress): { key: "migrated" | "inProgress" | "imported" | "failed"; label: string; n: number }[] {
  return [
    { key: "migrated", label: "移行完了", n: f.migrated },
    { key: "inProgress", label: "途中", n: f.inProgress },
    { key: "imported", label: "取り込み済み", n: f.imported },
    { key: "failed", label: "失敗", n: f.failed },
  ];
}

/** 進み具合の 2 行目 */
export const notStartedText = (n: number): string => `まだ取り込みを始めていないシート ${n} 枚`;

function TaskRow({ t }: { t: TaskItem }) {
  return (
    <li className={s.item} data-kind={t.kind} data-testid="task-item">
      <span className={`pill ${s.kind}`}>{TASK_STATUS_LABELS[t.runStatus]}</span>
      <span className={s.what}>{t.file} › {t.sheet}</span>
      <span className={s.at}>
        開始 <time dateTime={t.startedAt}>{formatDateTimeTokyo(t.startedAt)}</time>
      </span>
      <Link href="/migrate">Import で開く</Link>
    </li>
  );
}

function FileRow({ f }: { f: FileProgress }) {
  return (
    <li className={s.file} data-testid="file-progress-item">
      <b className={s.fileName}>{f.file}</b>
      <p className={s.counts}>
        {progressCounts(f).map((c) => (
          <span key={c.key} className={c.n === 0 ? s.zero : c.key === "failed" ? s.failedCount : undefined} data-bucket={c.key}>
            {c.label} <b>{c.n}</b>
          </span>
        ))}
      </p>
      <p className="muted">{notStartedText(f.notStarted)}</p>
    </li>
  );
}

export function TasksView({ overview, error }: { overview: TaskOverview | null; error: string }) {
  return (
    <div className="view">
      <header className="vhead">
        <div className="vtitle">
          <h1 id="tasks-heading">
            Task<small>やること</small>
          </h1>
        </div>
      </header>
      {error && <p className="error" role="alert">{error}</p>}
      {!overview && !error && (
        <p className="muted" aria-live="polite">
          <span className="spin" aria-hidden="true" />読み込んでいます…
        </p>
      )}
      {overview && (
        <>
          {overview.items.items.length === 0 ? (
            <p className="card" data-testid="tasks-empty">やることはありません。</p>
          ) : (
            <section className="card" aria-labelledby="tasks-heading">
              <ul className={s.list} data-testid="task-list">
                {overview.items.items.map((t) => (
                  <TaskRow key={t.runId} t={t} />
                ))}
              </ul>
              {overview.items.more > 0 && <p className="muted">ほか {overview.items.more} 件</p>}
            </section>
          )}
          {overview.files.items.length > 0 && (
            <section className="card" aria-labelledby="progress-heading">
              <h2 id="progress-heading">
                移行の進み具合<span className="muted">取り込みを始めたシートで数えます。</span>
              </h2>
              <ul className={s.files} data-testid="file-progress">
                {overview.files.items.map((f) => (
                  <FileRow key={f.fileId} f={f} />
                ))}
              </ul>
              {overview.files.more > 0 && <p className="muted">ほか {overview.files.more} ファイル</p>}
            </section>
          )}
        </>
      )}
    </div>
  );
}
