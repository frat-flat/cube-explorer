"use client";

// スプシから 4D Base へ移す画面。リンクを読む → タブを選んで全行を読む(Saving)→ 候補を直して承認 → 反映 → 照合
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type { SheetProposal } from "@/fourdb/core/import/analyze";
import type { ApprovalSpec, ColumnApproval } from "@/fourdb/core/import/plan";
import type { SourceCell } from "@/fourdb/core/import/types";
import type { ApplyCheck, SheetSummary } from "@/fourdb/adapters/postgres/import-store";
import type { ReconcileResult } from "@/fourdb/adapters/postgres/reconcile";
import { colLetter } from "@/fourdb/core/import/a1";
import s from "./migrate.module.css";

type Role = ColumnApproval["role"];
const ROLES: [Role, string][] = [
  ["dimension", "分類(軸)"],
  ["measure", "数値"],
  ["attribute", "属性(Card)"],
  ["aggregate", "合計"],
  ["ignore", "使わない"],
];
const roleName = (r: Role) => ROLES.find(([k]) => k === r)?.[1] ?? r;
const fmt = (n: number) => n.toLocaleString("ja-JP");

/** タブの一覧をスプシごとにまとめる(並びは保つ。新しく読んだスプシが上) */
function byBook(sheets: SheetSummary[]): { book: SheetSummary["book"]; tabs: SheetSummary[] }[] {
  const out: { book: SheetSummary["book"]; tabs: SheetSummary[] }[] = [];
  for (const x of sheets) {
    const g = out.find((o) => o.book.id === x.book.id);
    if (g) g.tabs.push(x);
    else out.push({ book: x.book, tabs: [x] });
  }
  return out;
}

async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? "GET",
    headers: init?.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: "same-origin",
  });
  const j = await res.json().catch(() => null);
  if (!res.ok) throw new Error((j as { error?: string } | null)?.error ?? `うまくいきませんでした(${res.status})`);
  return j as T;
}

type ProposalResponse = {
  sheet: { id: string; title: string };
  run: { status: string; rowsRead: number };
  proposal: SheetProposal;
  preview: { index: number; cells: SourceCell[] }[];
  spec: ApprovalSpec;
};
type Progress = { done: number; total: number; label: string } | null;

export function Migrate() {
  const [url, setUrl] = useState("");
  const [book, setBook] = useState<{ title: string; url: string } | null>(null);
  const [sheets, setSheets] = useState<SheetSummary[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [current, setCurrent] = useState<ProposalResponse | null>(null);
  const [spec, setSpec] = useState<ApprovalSpec | null>(null);
  const [check, setCheck] = useState<ApplyCheck | null>(null);
  const [result, setResult] = useState<ReconcileResult | null>(null);
  const [applied, setApplied] = useState<{ rows: number; values: number; totals: number; closedValues: number } | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSheets((await api<{ sheets: SheetSummary[] }>("/api/4db/sheets")).sheets);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    // 前に登録した表の一覧を最初に出す(画面を開いたときに一度だけ外から読む)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const guard = async (f: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await f();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const readBook = () =>
    guard(async () => {
      const j = await api<{ book: { title: string; url: string }; sheets: SheetSummary[] }>("/api/4db/books", { method: "POST", body: { url } });
      setBook(j.book);
      setSheets(j.sheets);
    });

  const loadProposal = async (id: string, layout?: { headerRow: number; groupRow: number | null }) => {
    const q = layout ? `?headerRow=${layout.headerRow}&groupRow=${layout.groupRow ?? ""}` : "";
    const p = await api<ProposalResponse>(`/api/4db/runs/${id}/proposal${q}`);
    setCurrent(p);
    setSpec(p.spec);
    setCheck(null);
  };

  const startImport = (sheet: SheetSummary) =>
    guard(async () => {
      setCurrent(null);
      setSpec(null);
      setCheck(null);
      setResult(null);
      setApplied(null);
      const { run } = await api<{ run: { id: string; status: string; rowsRead: number; total: number } }>(`/api/4db/sheets/${sheet.id}/runs`, { method: "POST" });
      setRunId(run.id);
      if (run.status === "applying") throw new Error("前の反映が途中で止まっています。下の「反映を続ける」で続きから書けます");
      let r = { rowsRead: run.rowsRead, total: run.total, done: run.status !== "reading" };
      while (!r.done) {
        setProgress({ done: r.rowsRead, total: r.total, label: `「${sheet.title}」を読み取っています` });
        r = await api(`/api/4db/runs/${run.id}/read`, { method: "POST" });
      }
      await loadProposal(run.id);
    });

  const relayout = (headerRow: number, groupRow: number | null) => runId && guard(() => loadProposal(runId, { headerRow, groupRow }));

  // 全行の確かめは分割して進める(大きい表でも 1 回の要求が長くならないように)。結果を足し合わせる
  const runCheck = () =>
    runId && spec &&
    guard(async () => {
      let acc: ApplyCheck | null = null;
      for (let from = 0; ; ) {
        const r: ApplyCheck = await api<ApplyCheck>(`/api/4db/runs/${runId}/check`, { method: "POST", body: { spec, from } });
        acc = acc === null ? r : mergeCheck(acc, r);
        if (r.done) break;
        setProgress({ done: r.next, total: current?.run.rowsRead ?? r.next, label: "全行を確かめています(行番号)" });
        from = r.next;
      }
      setCheck(acc);
    });

  const apply = (resume = false) =>
    runId &&
    guard(async () => {
      let r = await api<{ done: boolean; next: number; total: number; counts: { rows: number; values: number; totals: number; closedValues: number } }>(
        `/api/4db/runs/${runId}/apply`, { method: "POST", body: { spec: resume ? null : spec } });
      while (!r.done) {
        setProgress({ done: r.next, total: r.total, label: "4DB に書いています" });
        r = await api(`/api/4db/runs/${runId}/apply`, { method: "POST", body: {} });
      }
      setApplied(r.counts);
      const sheetId = current?.sheet.id ?? sheets.find((x) => x.lastRun?.id === runId)?.id;
      if (sheetId) setResult(await api<ReconcileResult>(`/api/4db/sheets/${sheetId}/reconcile`));
      setCurrent(null);
      setSpec(null);
      setCheck(null);
      await refresh();
    });

  const showReconcile = (sheet: SheetSummary) =>
    guard(async () => {
      setResult(await api<ReconcileResult>(`/api/4db/sheets/${sheet.id}/reconcile`));
    });

  return (
    <main className={s.page}>
      <div className={s.top}>
        <h1>スプシから 4DB へ移す</h1>
        <a href="/sheet">取り込んだデータを表で見る</a>
        <a href="/">ダッシュボードへ戻る</a>
      </div>
      <p className={s.lead}>
        スプシのタブを全行読み、合計の行・列と、関数で計算された値を見分けます。候補を確かめて直してから反映します。
        反映したあと、スプシの合計と、4DB が元の値から計算した合計が合っているかを照合します。元のスプシは書き換えません。
      </p>
      {error && <p className={s.error} role="alert">{error}</p>}
      {progress && (
        <div className={s.card} aria-live="polite">
          <div>{progress.label}… {fmt(progress.done)} / {fmt(progress.total)} 行</div>
          <div className={s.progress}><div style={{ width: `${progress.total ? Math.min(100, (progress.done / progress.total) * 100) : 0}%` }} /></div>
        </div>
      )}

      <section className={s.card}>
        <h2>1. スプシのリンク</h2>
        <div className={s.row}>
          <input className={s.input} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" aria-label="スプシのリンク" />
          <button className={`${s.button} ${s.primary}`} onClick={readBook} disabled={busy || !url.trim()}>読み取る</button>
        </div>
        {book && <p className={s.muted}>「{book.title}」を読み取りました。下の一覧から、移すタブを選んでください。</p>}
      </section>

      <section className={s.card}>
        <h2>移す表(タブ)</h2>
        {sheets.length === 0 ? (
          <p className={s.muted}>まだありません。上でスプシのリンクを読み取ると、タブがここに並びます。</p>
        ) : (
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead><tr><th>タブ</th><th className={s.num}>大きさ</th><th>状態</th><th className={s.num}>4DB の行</th><th /></tr></thead>
              <tbody>
                {byBook(sheets).map(({ book, tabs }) => (
                  <Fragment key={book.id}>
                    <tr className={s.bookRow}>
                      <th colSpan={5}>
                        スプシ「{book.title}」{book.url && <> <a href={book.url} target="_blank" rel="noopener noreferrer">元のスプシを開く</a></>}
                      </th>
                    </tr>
                {tabs.map((x) => (
                  <tr key={x.id}>
                    <td className={s.tabCell}>{x.title}</td>
                    <td className={s.num}>{x.rowCount === null ? "—" : `${fmt(x.rowCount)} 行 × ${fmt(x.colCount ?? 0)} 列`}</td>
                    <td>{x.migrationStatus === "migrated" ? "移行完了" : x.lastRun ? ({ reading: "読み取り中", staged: "承認待ち", applying: "反映の途中", applied: "取り込み済み(移行中)", failed: "失敗", cancelled: "取りやめ" } as Record<string, string>)[x.lastRun.status] ?? x.lastRun.status : "まだ"}</td>
                    <td className={s.num}>{fmt(x.records)}</td>
                    <td>
                      <div className={s.row}>
                        {x.migrationStatus !== "migrated" && <button className={s.button} disabled={busy} onClick={() => startImport(x)}>{x.lastRun?.status === "applied" ? "読み直す" : "取り込む"}</button>}
                        {x.lastRun?.status === "applying" && <button className={s.button} disabled={busy} onClick={() => { setRunId(x.lastRun!.id); void apply(true); }}>反映を続ける</button>}
                        {x.records > 0 && <button className={s.button} disabled={busy} onClick={() => showReconcile(x)}>照合</button>}
                      </div>
                    </td>
                  </tr>
                ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {current && spec && <Approval p={current} spec={spec} setSpec={(x) => { setSpec(x); setCheck(null); }} busy={busy} relayout={relayout} onCheck={runCheck} check={check} onApply={() => apply(false)} />}

      {applied && (
        <section className={s.card}>
          <h2>反映しました</h2>
          <div className={s.stats}>
            <div><span className={s.muted}>行</span><b>{fmt(applied.rows)}</b></div>
            <div><span className={s.muted}>新しく入れた値</span><b>{fmt(applied.values)}</b></div>
            <div><span className={s.muted}>スプシの合計</span><b>{fmt(applied.totals)}</b></div>
            {applied.closedValues > 0 && <div><span className={s.muted}>前の版として残した値</span><b>{fmt(applied.closedValues)}</b></div>}
          </div>
        </section>
      )}
      {result && <Reconcile r={result} />}
    </main>
  );
}

/** 分割して確かめた結果を足し合わせる(鍵の重なりと実体の数は最初の分にだけある) */
function mergeCheck(a: ApplyCheck, r: ApplyCheck): ApplyCheck {
  return {
    ...a,
    errors: [...new Set([...a.errors, ...r.errors])],
    dataRows: a.dataRows + r.dataRows,
    aggregateRows: a.aggregateRows + r.aggregateRows,
    values: a.values + r.values,
    calculatedValues: a.calculatedValues + r.calculatedValues,
    totals: a.totals + r.totals,
    problemCount: a.problemCount + r.problemCount,
    problems: [...a.problems, ...r.problems].slice(0, 20),
    next: r.next,
    done: r.done,
  };
}

// ---------- 承認(Saving) ----------
function Approval(props: {
  p: ProposalResponse;
  spec: ApprovalSpec;
  setSpec: (s: ApprovalSpec) => void;
  busy: boolean;
  relayout: (headerRow: number, groupRow: number | null) => void;
  onCheck: () => void;
  check: ApplyCheck | null;
  onApply: () => void;
}) {
  const { p, spec, setSpec, busy, check } = props;
  const pr = p.proposal;
  const byIndex = useMemo(() => new Map(pr.columns.map((c) => [c.index, c])), [pr.columns]);
  const aggSet = new Set([...pr.aggregateRows.map((r) => r.index).filter((i) => !spec.aggregateRows.exclude.includes(i)), ...spec.aggregateRows.include]);
  const [extraRows, setExtraRows] = useState("");

  const setColumn = (index: number, role: Role) => {
    const c = byIndex.get(index)!;
    const next: ColumnApproval =
      role === "dimension" ? { index, role, dimension: c.label, definition: c.label }
      : role === "measure" ? { index, role, definition: c.month ? (c.group ?? "値") : c.label, month: c.month }
      : role === "attribute" ? { index, role, definition: c.label }
      : role === "aggregate" ? { index, role, fn: c.aggregate?.fn ?? "SUM", definition: null, sums: c.aggregate?.sums ?? [] }
      : { index, role: "ignore" };
    const columns = spec.columns.map((x) => (x.index === index ? next : x));
    const hasAttr = columns.some((x) => x.role === "attribute");
    const entity = hasAttr ? (spec.entityColumn !== null && columns.find((x) => x.index === spec.entityColumn)?.role === "dimension" ? spec.entityColumn : columns.find((x) => x.role === "dimension")?.index ?? null) : null;
    setSpec({ ...spec, columns, entityColumn: entity, rowKeyColumns: spec.rowKeyColumns.filter((k) => ["dimension", "attribute"].includes(columns.find((x) => x.index === k)?.role ?? "")) });
  };
  const patch = (index: number, f: Partial<Record<string, unknown>>) =>
    setSpec({ ...spec, columns: spec.columns.map((x) => (x.index === index ? ({ ...x, ...f } as ColumnApproval) : x)) });
  const toggleKey = (index: number) =>
    setSpec({ ...spec, rowKeyColumns: spec.rowKeyColumns.includes(index) ? spec.rowKeyColumns.filter((k) => k !== index) : [...spec.rowKeyColumns, index].sort((a, b) => a - b) });
  const toggleAgg = (index: number) => {
    const detected = pr.aggregateRows.some((r) => r.index === index);
    const a = spec.aggregateRows;
    setSpec({
      ...spec,
      aggregateRows: detected
        ? { ...a, exclude: a.exclude.includes(index) ? a.exclude.filter((x) => x !== index) : [...a.exclude, index] }
        : { ...a, include: a.include.filter((x) => x !== index) },
    });
  };
  const addAggRows = () => {
    const nums = extraRows.split(/[,\s、]+/).map(Number).filter((n) => Number.isInteger(n) && n > spec.headerRow + 1).map((n) => n - 1);
    setSpec({ ...spec, aggregateRows: { ...spec.aggregateRows, include: [...new Set([...spec.aggregateRows.include, ...nums])].sort((a, b) => a - b) } });
    setExtraRows("");
  };
  const hasAttr = spec.columns.some((c) => c.role === "attribute");
  const options = Array.from({ length: Math.min(10, Math.max(1, p.preview.length)) }, (_, i) => i);

  return (
    <section className={s.card}>
      <h2>2. 「{p.sheet.title}」の承認(Saving)</h2>
      <p className={s.muted}>読み取った行 {fmt(p.run.rowsRead)} 行。先頭の行から候補を出しています。役割と名前を確かめ、違うところは直してください。</p>

      <h3>表の読み方</h3>
      <div className={s.row}>
        <label>列名の行{" "}
          <select value={spec.headerRow} onChange={(e) => props.relayout(Number(e.target.value), spec.groupRow !== null && spec.groupRow < Number(e.target.value) ? spec.groupRow : null)} disabled={busy}>
            {options.map((i) => <option key={i} value={i}>{i + 1} 行目</option>)}
          </select>
        </label>
        <label>グループ名の行{" "}
          <select value={spec.groupRow ?? ""} onChange={(e) => props.relayout(spec.headerRow, e.target.value === "" ? null : Number(e.target.value))} disabled={busy}>
            <option value="">なし</option>
            {options.filter((i) => i < spec.headerRow).map((i) => <option key={i} value={i}>{i + 1} 行目</option>)}
          </select>
        </label>
      </div>

      <h3>先頭の行(Σ = 合計の行)</h3>
      <div className={s.tableWrap} style={{ maxHeight: 320 }}>
        <table className={s.table}>
          <thead>
            <tr><th>行</th>{spec.columns.map((c) => <th key={c.index}>{colLetter(c.index)} <span className={`${s.tag} ${s["role_" + c.role]}`}>{roleName(c.role)}</span></th>)}</tr>
          </thead>
          <tbody>
            {p.preview.slice(0, 20).map((r) => (
              <tr key={r.index} className={r.index === spec.headerRow ? s.headerRow : aggSet.has(r.index) ? s.aggRow : undefined}>
                <td>{r.index + 1}{aggSet.has(r.index) ? " Σ" : ""}</td>
                {spec.columns.map((c) => {
                  const cell = r.cells[c.index];
                  return <td key={c.index} className={cell?.n !== null && cell?.n !== undefined ? s.num : undefined} title={cell?.f ?? undefined}>{cell?.v ?? ""}{cell?.f ? " ƒ" : ""}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>列の役割</h3>
      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead>
            <tr><th>列</th><th>見出し</th><th>役割</th><th>名前</th><th>月 / 足している列</th><th>行を見分ける</th>{hasAttr && <th>行が表す実体</th>}<th>理由</th></tr>
          </thead>
          <tbody>
            {spec.columns.map((c) => {
              const pc = byIndex.get(c.index)!;
              return (
                <tr key={c.index}>
                  <td>{colLetter(c.index)}</td>
                  <td>{pc.group ? <span className={s.muted}>{pc.group} › </span> : null}{pc.label}<div className={s.muted}>{pc.samples.join(" / ")}</div></td>
                  <td>
                    <select value={c.role} onChange={(e) => setColumn(c.index, e.target.value as Role)} aria-label={`${colLetter(c.index)} 列の役割`}>
                      {ROLES.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                    </select>
                  </td>
                  <td>
                    {c.role === "dimension" && (
                      <>
                        <input className={s.small} value={c.dimension} onChange={(e) => patch(c.index, { dimension: e.target.value, definition: e.target.value })} aria-label={`${colLetter(c.index)} 列の軸の名前`} />
                      </>
                    )}
                    {(c.role === "measure" || c.role === "attribute") && <input className={s.small} value={c.definition} onChange={(e) => patch(c.index, { definition: e.target.value })} aria-label={`${colLetter(c.index)} 列のカラムの名前`} />}
                    {c.role === "aggregate" && <span className={s.muted}>{c.fn}</span>}
                  </td>
                  <td>
                    {c.role === "measure" && <input className={s.small} value={c.month ?? ""} placeholder="(月の列でない)" onChange={(e) => patch(c.index, { month: e.target.value.trim() || null })} aria-label={`${colLetter(c.index)} 列の月`} />}
                    {c.role === "aggregate" && (
                      <input className={s.small} value={c.sums.map(colLetter).join(",")} onChange={(e) => {
                        const sums = e.target.value.toUpperCase().split(/[,\s、]+/).filter((x) => /^[A-Z]{1,3}$/.test(x)).map((x) => [...x].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1);
                        patch(c.index, { sums });
                      }} aria-label={`${colLetter(c.index)} 列が足している列`} />
                    )}
                  </td>
                  <td>{["dimension", "attribute"].includes(c.role) && <input type="checkbox" checked={spec.rowKeyColumns.includes(c.index)} onChange={() => toggleKey(c.index)} aria-label={`${colLetter(c.index)} 列で行を見分ける`} />}</td>
                  {hasAttr && <td>{c.role === "dimension" && <input type="radio" name="entity" checked={spec.entityColumn === c.index} onChange={() => setSpec({ ...spec, entityColumn: c.index })} aria-label={`${colLetter(c.index)} 列の値ごとに Box を作る`} />}</td>}
                  <td className={s.wrap}>{pc.reasons.join("。")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className={s.muted}>
        「行を見分ける」列がなければ、行番号で見分けます(読み直しで行がずれると、別の行として扱います)。
        {hasAttr && "属性(Card)の列があるときは、「行が表す実体」の列の値ごとに Box を作り、属性をその Box の Card にします。"}
      </p>

      <h3>合計の行</h3>
      {pr.aggregateRows.length === 0 && spec.aggregateRows.include.length === 0 ? <p className={s.muted}>見つかりませんでした。</p> : (
        <ul className={s.list}>
          {pr.aggregateRows.map((r) => (
            <li key={r.index}><label><input type="checkbox" checked={!spec.aggregateRows.exclude.includes(r.index)} onChange={() => toggleAgg(r.index)} /> {r.index + 1} 行目を合計の行にする({r.reasons.join("。")})</label></li>
          ))}
          {spec.aggregateRows.include.map((i) => (
            <li key={`i${i}`}><label><input type="checkbox" checked onChange={() => toggleAgg(i)} /> {i + 1} 行目を合計の行にする(人が足した)</label></li>
          ))}
        </ul>
      )}
      <div className={s.row}>
        <input className={s.small} value={extraRows} onChange={(e) => setExtraRows(e.target.value)} placeholder="例: 12, 25" aria-label="合計の行として足す行番号" />
        <button className={s.button} onClick={addAggRows} disabled={!extraRows.trim()}>合計の行を足す</button>
      </div>

      {(pr.warnings.length > 0 || pr.calculatedCellCount > 0) && (
        <>
          <h3>知らせ</h3>
          <ul className={s.list}>
            {pr.warnings.map((w) => <li key={w}>{w}</li>)}
            {pr.calculatedCellCount > 0 && <li>関数で計算された値が {fmt(pr.calculatedCellCount)} 個あります(先頭の行の分)。元の値とは区別して入れ、4DB では直せません。例: {pr.calculatedCells.slice(0, 3).map((c) => `${colLetter(c.col)}${c.row + 1} ${c.formula}`).join("、")}</li>}
          </ul>
        </>
      )}

      <h3>3. 確かめて反映する</h3>
      <div className={s.row}>
        <button className={s.button} onClick={props.onCheck} disabled={busy}>全行で確かめる</button>
        <button className={`${s.button} ${s.primary}`} onClick={props.onApply} disabled={busy || !check || check.errors.length > 0}>この内容で反映する</button>
      </div>
      {check && (
        <div>
          {check.errors.length > 0 && <p className={s.error}>{check.errors.join("\n")}</p>}
          <div className={s.stats}>
            <div><span className={s.muted}>データの行</span><b>{fmt(check.dataRows)}</b></div>
            <div><span className={s.muted}>合計の行</span><b>{fmt(check.aggregateRows)}</b></div>
            <div><span className={s.muted}>入れる値</span><b>{fmt(check.values)}</b></div>
            <div><span className={s.muted}>うち計算された値</span><b>{fmt(check.calculatedValues)}</b></div>
            <div><span className={s.muted}>スプシの合計</span><b>{fmt(check.totals)}</b></div>
            {check.entities > 0 && <div><span className={s.muted}>Box(実体)</span><b>{fmt(check.entities)}</b></div>}
          </div>
          {check.duplicateKeys.length > 0 && <ul className={s.list}>{check.duplicateKeys.map((d) => <li key={d.key}>「{d.key}」が {d.rows.join("・")} 行目にあります</li>)}</ul>}
          {check.problemCount > 0 && (
            <>
              <p>入れずに知らせるセルが {fmt(check.problemCount)} 個あります:</p>
              <ul className={s.list}>{check.problems.map((x) => <li key={`${x.row}:${x.col}`}>{colLetter(x.col)}{x.row + 1}: {x.message}</li>)}</ul>
            </>
          )}
          {check.errors.length === 0 && <p className={s.ok}>問題はありません。「この内容で反映する」で 4DB に書きます。</p>}
        </div>
      )}
    </section>
  );
}

// ---------- 照合 ----------
function Reconcile({ r }: { r: ReconcileResult }) {
  const all = [...r.columns, ...r.rows];
  const ok = r.summary.checked === r.summary.matched;
  return (
    <section className={s.card}>
      <h2>照合: 「{r.sheet.title}」</h2>
      <p className={ok ? s.ok : s.error}>
        スプシの合計 {fmt(r.summary.checked)} 個のうち {fmt(r.summary.matched)} 個が、4DB が元の値から計算した合計と一致しました。
        {!ok && " 合わないものは下のとおりです(スプシの関数の範囲がずれている、値で上書きされている、などが考えられます)。"}
      </p>
      {all.length === 0 ? <p className={s.muted}>合計の行・列がない表です。</p> : (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead><tr><th>合計</th><th className={s.num}>照合した数</th><th className={s.num}>一致</th><th>合わないもの(スプシ / 4DB)</th></tr></thead>
            <tbody>
              {all.map((g) => (
                <tr key={g.label}>
                  <td>{g.label}</td>
                  <td className={s.num}>{fmt(g.checked)}</td>
                  <td className={s.num}>{fmt(g.matched)}</td>
                  <td className={s.wrap}>{g.mismatches.length === 0 ? "—" : g.mismatches.slice(0, 10).map((m) => `${m.where}: ${fmt(m.sheet)} / ${fmt(m.computed)}`).join("、")}{g.mismatches.length > 10 ? " ほか" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
