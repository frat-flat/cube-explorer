"use client";

// 履歴の画面(/history)。取り込み・表の保存の記録を、新しい順に 50 件ずつ出し、「続きを読む」で古いものを足す。
// 取り込みは Import へ、表の保存は、その表を開いた Table へ移れる。
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { HistoryPage } from "@/fourdb/adapters/postgres/history";
import { api } from "../api";
import { formatAt, historyLink, kindName } from "./kinds";
import s from "./history.module.css";

/** 1回に読む件数(API の上限は 100) */
const PAGE = 50;

export function History() {
  const [items, setItems] = useState<HistoryPage["items"]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);

  const read = useCallback(async (cursor: string | null, signal?: AbortSignal) => {
    const q = new URLSearchParams({ limit: String(PAGE) });
    if (cursor) q.set("cursor", cursor);
    const page = await api<HistoryPage>(`/api/4db/history?${q}`, { signal });
    setItems((prev) => (cursor ? [...prev, ...page.items] : page.items));
    setNextCursor(page.nextCursor);
  }, []);

  useEffect(() => {
    // 画面を開いたときに、最初の 50 件を一度だけ、外(サーバー)から読む
    const ctrl = new AbortController();
    void (async () => {
      try {
        await read(null, ctrl.signal);
        setLoaded(true);
      } catch (e) {
        if (!ctrl.signal.aborted) setError((e as Error).message);
      }
    })();
    return () => ctrl.abort();
  }, [read]);

  async function more() {
    if (!nextCursor || busy.current) return;
    busy.current = true;
    setLoadingMore(true);
    setError("");
    try {
      await read(nextCursor);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      busy.current = false;
      setLoadingMore(false);
    }
  }

  return (
    <div className="view">
      <header className="vhead">
        <div className="vtitle">
          <h1>履歴</h1>
        </div>
        <p className="lead">取り込みや表の保存の記録を、新しい順に {PAGE} 件ずつ表示します。</p>
      </header>
      {error && <p className="error" role="alert">{error}</p>}
      {!loaded && !error && (
        <p className="muted" aria-live="polite">
          <span className="spin" aria-hidden="true" />読み込んでいます…
        </p>
      )}
      {loaded && items.length === 0 && (
        <p className="card">まだ履歴はありません。取り込みや表の保存をすると、ここに記録されます。</p>
      )}
      {items.length > 0 && (
        <section className="card" aria-label="履歴の一覧">
          <div className="tableWrap">
            <table className="table" data-testid="history-table">
              <thead>
                <tr>
                  <th scope="col">日時</th>
                  <th scope="col">種類</th>
                  <th scope="col">内容</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {items.map((h) => {
                  const link = historyLink(h);
                  return (
                    <tr key={h.id}>
                      <td className={s.at}><time dateTime={h.at}>{formatAt(h.at)}</time></td>
                      <td><span className="pill">{kindName(h.kind)}</span></td>
                      <td className={s.what}>
                        {h.title}
                        {h.lines.length > 0 && <div className={s.lines}>{h.lines.join(" ・ ")}</div>}
                      </td>
                      <td>{link && <Link href={link.href}>{link.label}</Link>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {nextCursor && (
            <div className={s.more}>
              <button type="button" onClick={more} disabled={loadingMore}>{loadingMore ? "読み込んでいます…" : "続きを読む"}</button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
