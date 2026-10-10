"use client";

// 取り込んだデータを表で見る画面(Projected Sheet。画面の名前は Table)。数値・集計のしかた・行・列・段・小計・絞り込みを選ぶと、サーバーがその場で元の値から計算する。
// 合計・小計は Σ 付きの行・列として出し、軸の値としては扱わない。計算された値には ƒ の印を付ける(色だけにしない)。
import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Catalog, ProjectionOutput } from "@/fourdb/adapters/postgres/projection";
import type { SheetSummary } from "@/fourdb/adapters/postgres/import-store";
import type { ProjCell, ProjectionFn, ProjectionRequest } from "@/fourdb/core/projection/types";
import { measureGoneMessage, measureLabel, measureMissingMessage, measuresIn } from "./measures";
import s from "./sheet.module.css";

const FNS: [ProjectionFn, string][] = [
  ["SUM", "合計"],
  ["COUNT", "件数"],
  ["AVG", "平均"],
  ["MIN", "最小"],
  ["MAX", "最大"],
];
const fnName = (f: ProjectionFn) => FNS.find(([k]) => k === f)?.[1] ?? f;
const fmt = (n: number) => n.toLocaleString("ja-JP", { maximumFractionDigits: 2 });

async function api<T>(path: string, init?: { method?: string; body?: unknown; signal?: AbortSignal }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? "GET",
    headers: init?.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: "same-origin",
    signal: init?.signal,
  });
  const j = await res.json().catch(() => null);
  if (!res.ok) throw new Error((j as { error?: string } | null)?.error ?? `うまくいきませんでした(${res.status})`);
  return j as T;
}

type Dim = Catalog["dimensions"][number];
type Axis = { dimensionId: string; level: number | null };
type Member = { id: string; name: string };
type Filter = { dimensionId: string; members: Member[] };
type Saved = { id: string; name: string; version: number; updated_at: string };
type Opened = { id: string; name: string; version: number };
type Shown = { r: ProjectionOutput; fn: ProjectionFn };

/** 軸を選んだときの段: いちばん細かい段 */
const finest = (d: Dim | undefined) => (d && d.levels.length ? d.levels[d.levels.length - 1].level : null);

/** initialDefinitionId = /table?def=<id> で指された保存した表。選べるもの(カタログ)を読んだあと、その表を開く */
export function ProjectedSheet({ initialDefinitionId }: { initialDefinitionId: string | null }) {
  const [cat, setCat] = useState<Catalog | null>(null);
  const [measureId, setMeasureId] = useState("");
  const [fn, setFn] = useState<ProjectionFn>("SUM");
  const [rows, setRows] = useState<Axis | null>(null);
  const [subtotal, setSubtotal] = useState<number | null>(null);
  const [cols, setCols] = useState<Axis | null>(null);
  const [filters, setFilters] = useState<Filter[]>([]);
  const [sheetIds, setSheetIds] = useState<string[] | null>(null);
  const [tabs, setTabs] = useState<SheetSummary[]>([]);
  const [picking, setPicking] = useState<string | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<Saved[]>([]);
  const [opened, setOpened] = useState<Opened | null>(null);
  /** 保存した表を開いたときの数値(id と、分かれば名前)。その数値が今のデータになくなっていたら知らせるため */
  const [savedMeasure, setSavedMeasure] = useState<{ id: string; name: string | null } | null>(null);
  const [name, setName] = useState("");
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [setupOpen, setSetupOpen] = useState(true);

  const dimOf = useCallback((id: string | undefined) => cat?.dimensions.find((d) => d.id === id), [cat]);
  const loadSaved = useCallback(async () => {
    setSaved((await api<{ definitions: Saved[] }>("/api/4db/sheet-definitions")).definitions);
  }, []);

  useEffect(() => {
    // 選べるもの(数値のカラム・軸と段)と保存した表を、画面を開いたときに一度だけ読む。初めの組み方: 行 = 時間でない軸、列 = 時間の軸
    void (async () => {
      try {
        const c = await api<Catalog>("/api/4db/catalog");
        setCat(c);
        const time = c.dimensions.find((d) => d.semanticType === "time");
        const other = c.dimensions.find((d) => d !== time);
        const r = other ?? time;
        const k = other ? time : undefined;
        setMeasureId(c.measures[0]?.id ?? "");
        setRows(r ? { dimensionId: r.id, level: finest(r) } : null);
        setCols(k ? { dimensionId: k.id, level: finest(k) } : null);
        setTabs((await api<{ sheets: SheetSummary[] }>("/api/4db/sheets")).sheets.filter((x) => x.records > 0));
        await loadSaved();
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [loadSaved]);

  // 数値の一覧は、選んだシートにあるものだけ。選んでいる数値がそのシートにないときは、別の数値に切り替えず、知らせて選び直してもらう
  const available = useMemo(() => (cat ? measuresIn(cat.measures, sheetIds) : []), [cat, sheetIds]);
  const current = cat?.measures.find((m) => m.id === measureId);
  const missing = current !== undefined && !available.some((m) => m.id === measureId);
  // 保存した表の数値が、今のデータにそもそもない(取り込みを読み直して数値の列がなくなった・シートが消えた など)。別の数値に切り替えず、知らせて選び直してもらう
  const gone = measureId !== "" && cat !== null && current === undefined;
  const goneName = gone && savedMeasure?.id === measureId ? savedMeasure.name : null;

  const request = useMemo<ProjectionRequest | null>(() => {
    if (!measureId || missing || gone) return null;
    return {
      measureId,
      fn,
      rows: rows && { ...rows, subtotalLevel: subtotal },
      columns: cols && { ...cols, subtotalLevel: null },
      filters: filters.filter((f) => f.members.length > 0).map((f) => ({ dimensionId: f.dimensionId, memberIds: f.members.map((m) => m.id) })),
      sheetIds,
    };
  }, [measureId, missing, gone, fn, rows, subtotal, cols, filters, sheetIds]);
  const requestKey = request ? JSON.stringify(request) : "";

  useEffect(() => {
    // 組み方が変わったら出し直す(続けて変えたときは最後の分だけ。前の要求は取りやめる)
    if (!requestKey) return;
    const ctrl = new AbortController();
    const req = JSON.parse(requestKey) as ProjectionRequest;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await api<ProjectionOutput>("/api/4db/projection", { method: "POST", body: { request: req }, signal: ctrl.signal });
        setShown({ r, fn: req.fn });
        setError("");
      } catch (e) {
        if (ctrl.signal.aborted) return;
        setShown(null);
        setError((e as Error).message);
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [requestKey]);

  // ---------- 組み方を変える ----------
  const setRowDim = (id: string) => {
    setRows(id ? { dimensionId: id, level: finest(dimOf(id)) } : null);
    setSubtotal(null);
  };
  const setRowLevel = (level: number) => {
    setRows((r) => r && { ...r, level });
    setSubtotal((x) => (x !== null && x < level ? x : null));
  };
  const setColDim = (id: string) => setCols(id ? { dimensionId: id, level: finest(dimOf(id)) } : null);
  const setColLevel = (level: number) => setCols((c) => c && { ...c, level });
  // 小計は行にだけ入れられるので、入れ替えたら外す
  const swap = () => {
    setRows(cols);
    setCols(rows);
    setSubtotal(null);
  };
  const addFilter = (dimensionId: string) => {
    if (!dimensionId) return;
    setFilters((fs) => [...fs, { dimensionId, members: [] }]);
    setPicking(dimensionId);
  };
  const toggleMember = (dimensionId: string, m: Member) =>
    setFilters((fs) =>
      fs.map((f) =>
        f.dimensionId !== dimensionId ? f : { ...f, members: f.members.some((x) => x.id === m.id) ? f.members.filter((x) => x.id !== m.id) : [...f.members, m] },
      ),
    );
  // 対象のシート: 何も選ばなければすべて
  const toggleTab = (id: string) =>
    setSheetIds((ids) => {
      const next = ids?.includes(id) ? ids.filter((x) => x !== id) : [...(ids ?? []), id];
      return next.length ? next : null;
    });
  const removeFilter = (dimensionId: string) => {
    setFilters((fs) => fs.filter((f) => f.dimensionId !== dimensionId));
    if (picking === dimensionId) setPicking(null);
  };

  // ---------- 表の定義(保存・開く) ----------
  const guard = async (f: () => Promise<void>) => {
    setBusy(true);
    setSaveMsg(null);
    try {
      await f();
    } catch (e) {
      setSaveMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const open = (id: string) =>
    guard(async () => {
      const d = await api<Opened & { request: ProjectionRequest; filterMembers: Member[]; measureName: string | null }>(`/api/4db/sheet-definitions/${id}`);
      const names = new Map(d.filterMembers.map((m) => [m.id, m.name]));
      setError("");
      setSavedMeasure({ id: d.request.measureId, name: d.measureName });
      setMeasureId(d.request.measureId);
      setFn(d.request.fn);
      setRows(d.request.rows && { dimensionId: d.request.rows.dimensionId, level: d.request.rows.level });
      setSubtotal(d.request.rows?.subtotalLevel ?? null);
      setCols(d.request.columns && { dimensionId: d.request.columns.dimensionId, level: d.request.columns.level });
      setFilters(d.request.filters.map((f) => ({ dimensionId: f.dimensionId, members: f.memberIds.map((x) => ({ id: x, name: names.get(x) ?? "(見つかりません)" })) })));
      setSheetIds(d.request.sheetIds);
      setPicking(null);
      setOpened({ id: d.id, name: d.name, version: d.version });
      setName(d.name);
      setSaveMsg({ ok: true, text: `「${d.name}」を開きました(版 ${d.version})` });
    });
  const save = (overwrite: boolean) =>
    request &&
    guard(async () => {
      const n = name.trim();
      const r = await api<{ id: string; version: number }>("/api/4db/sheet-definitions", { method: "POST", body: { id: overwrite ? opened?.id : undefined, name: n, request } });
      setOpened({ id: r.id, name: n, version: r.version });
      setSaveMsg({ ok: true, text: `「${n}」を保存しました(版 ${r.version})` });
      await loadSaved();
    });

  // /table?def=<id>: 選べるもの(カタログ)を読み終えてから、その表を一度だけ開く(先に開くと、初めの組み方に上書きされる)
  const initialOpened = useRef(false);
  useEffect(() => {
    if (!initialDefinitionId || !cat || initialOpened.current) return;
    initialOpened.current = true;
    void open(initialDefinitionId);
  });

  const rowDim = dimOf(rows?.dimensionId);
  const colDim = dimOf(cols?.dimensionId);

  return (
    <div className={`view ${s.fill}`}>
      <header className="vhead">
        <div className="vtitle">
          <h1>
            Table<small>表で見る</small>
          </h1>
          <Link href="/migrate">ファイルから移す</Link>
          <button type="button" className={`small ${s.foldBtn}`} onClick={() => setSetupOpen(!setupOpen)} aria-expanded={setupOpen} aria-controls="table-setup">
            {setupOpen ? "組み方の欄を畳む" : "組み方の欄を開く"}
          </button>
        </div>
        <p className="lead">
          取り込んだ元の値から、選んだ行・列・段で、その場で計算した表を出します。
          合計・小計は Σ を付けて出し、軸の値としては扱いません。スプシの関数で計算された値には ƒ を付けます。
        </p>
      </header>
      {cat && cat.measures.length === 0 && (
        <p className="card">
          まだ表にできるデータがありません。<Link href="/migrate">ファイルから移す</Link>で取り込んでください。
        </p>
      )}

      <div className={s.workspace} data-setup={setupOpen ? "open" : "closed"}>
      <div className={s.setup} id="table-setup">
      <section className="card">
        <h2>表の定義</h2>
        <div className="row">
          <select value="" onChange={(e) => e.target.value && void open(e.target.value)} aria-label="保存した表を開く" disabled={busy || saved.length === 0}>
            <option value="">{saved.length ? "保存した表を開く…" : "保存した表はまだありません"}</option>
            {saved.map((d) => (
              <option key={d.id} value={d.id}>{d.name}(版 {d.version})</option>
            ))}
          </select>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="表の名前" aria-label="表の名前" maxLength={100} />
          {opened && <button onClick={() => void save(true)} disabled={busy || !name.trim() || !request}>上書き保存</button>}
          <button className="primary" onClick={() => void save(false)} disabled={busy || !name.trim() || !request}>新しく保存</button>
        </div>
        {opened && <p className="muted">開いている表: 「{opened.name}」(版 {opened.version})。上書き保存すると版が上がり、前の定義は履歴に残ります。</p>}
        {saveMsg && <p className={saveMsg.ok ? "ok" : "error"} role="status">{saveMsg.text}</p>}
      </section>

      {cat && cat.measures.length > 0 && (
        <section className="card">
          <h2>表の組み方</h2>
          <div className="controls">
            <label className="field">
              <span>数値</span>
              <select value={measureId} onChange={(e) => setMeasureId(e.target.value)} aria-invalid={missing || gone || undefined}>
                {/* 選んでいる数値が選んだシートにないとき・今のデータにないときも、選択肢に残す(勝手に別の数値に切り替えない) */}
                {missing && current && <option value={current.id}>{current.name}</option>}
                {gone && <option value={measureId}>{goneName ?? "(見つからない数値)"}</option>}
                {available.map((m) => (
                  <option key={m.id} value={m.id}>{measureLabel(m)}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>集計のしかた</span>
              <select value={fn} onChange={(e) => setFn(e.target.value as ProjectionFn)}>
                {FNS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
              </select>
            </label>
            <div className="field">
              <span>行</span>
              <div className="row">
                <select value={rows?.dimensionId ?? ""} onChange={(e) => setRowDim(e.target.value)} aria-label="行の軸">
                  <option value="">なし</option>
                  {cat.dimensions.map((d) => <option key={d.id} value={d.id} disabled={d.id === cols?.dimensionId}>{d.name}{d.id === cols?.dimensionId ? "(列で使用中)" : ""}</option>)}
                </select>
                {rowDim && <LevelSelect dim={rowDim} value={rows!.level} onChange={setRowLevel} label="行の段" />}
              </div>
            </div>
            <div className="field">
              <span>小計(行を上の段でまとめる)</span>
              <select value={subtotal ?? ""} onChange={(e) => setSubtotal(e.target.value === "" ? null : Number(e.target.value))} disabled={!rowDim || rows?.level === null} aria-label="小計の段">
                <option value="">なし</option>
                {rowDim?.levels.filter((l) => rows?.level !== null && rows?.level !== undefined && l.level < rows.level).map((l) => <option key={l.level} value={l.level}>{l.name}ごと</option>)}
              </select>
            </div>
            <div className="field">
              <span>列</span>
              <div className="row">
                <select value={cols?.dimensionId ?? ""} onChange={(e) => setColDim(e.target.value)} aria-label="列の軸">
                  <option value="">なし</option>
                  {cat.dimensions.map((d) => <option key={d.id} value={d.id} disabled={d.id === rows?.dimensionId}>{d.name}{d.id === rows?.dimensionId ? "(行で使用中)" : ""}</option>)}
                </select>
                {colDim && <LevelSelect dim={colDim} value={cols!.level} onChange={setColLevel} label="列の段" />}
              </div>
            </div>
            <div className="field">
              <span>&nbsp;</span>
              <button onClick={swap} disabled={!rows && !cols}>行と列を入れ替える</button>
            </div>
          </div>

          <h3>絞り込み</h3>
          {filters.length === 0 && <p className="muted">絞り込んでいません(すべての値)。</p>}
          {filters.map((f) => {
            const d = dimOf(f.dimensionId);
            return (
              <div key={f.dimensionId} className={s.filter}>
                <div className="row">
                  <b>{d?.name ?? "(見つからない軸)"}</b>
                  {f.members.length === 0 && <span className="muted">(まだ選んでいません)</span>}
                  {f.members.map((m) => (
                    <span key={m.id} className="chip">
                      {m.name}
                      <button onClick={() => toggleMember(f.dimensionId, m)} aria-label={`${m.name} を外す`}>×</button>
                    </span>
                  ))}
                  {d && <button onClick={() => setPicking(picking === f.dimensionId ? null : f.dimensionId)}>{picking === f.dimensionId ? "選ぶのを閉じる" : "選ぶ"}</button>}
                  <button onClick={() => removeFilter(f.dimensionId)}>この絞り込みをやめる</button>
                </div>
                {d && picking === f.dimensionId && <MemberPicker dim={d} selected={new Set(f.members.map((m) => m.id))} onToggle={(m) => toggleMember(f.dimensionId, m)} />}
              </div>
            );
          })}
          <select value="" onChange={(e) => addFilter(e.target.value)} aria-label="絞り込む軸を足す">
            <option value="">絞り込む軸を足す…</option>
            {cat.dimensions.filter((d) => !filters.some((f) => f.dimensionId === d.id)).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>

          <h3>対象のシート</h3>
          {/* 開く前でも目に入るよう、折りたたみの外に出す */}
          {sheetIds?.some((id) => !tabs.some((x) => x.id === id)) && <p className="muted" role="status">保存した表の指定に、今は見つからないシートがあります。</p>}
          <details className={s.sources}>
            <summary>{sheetIds ? `選んだシート ${sheetIds.length} 個` : `すべてのシート(${tabs.length} 個)`}</summary>
            {sheetIds && <button onClick={() => setSheetIds(null)}>すべてのシートにする</button>}
            {byBook(tabs).map(({ book, items }) => (
              <div key={book.id} className={s.book}>
                <div className="muted">ファイル「{book.title}」</div>
                {items.map((x) => (
                  <label key={x.id} className={s.tab}>
                    <input type="checkbox" checked={sheetIds?.includes(x.id) ?? false} onChange={() => toggleTab(x.id)} aria-label={`${book.title} の ${x.title}`} /> {x.title}
                    <span className="muted">({x.records} 行)</span>
                  </label>
                ))}
              </div>
            ))}
          </details>
        </section>
      )}
      </div>

      <div className={s.result}>
        {missing && current && <p className="error" role="alert">{measureMissingMessage(current.name)}</p>}
        {/* 表にできるデータがそもそもないとき(保存した表のシートがすべてなくなった)は、選びようがないので、この文は出さず、上の「まだ表にできるデータがありません」に任せる */}
        {gone && cat && cat.measures.length > 0 && <p className="error" role="alert">{measureGoneMessage(goneName)}</p>}
        {error && <p className="error" role="alert">{error}</p>}
        {loading && <p className="muted" aria-live="polite"><span className="spin" aria-hidden="true" />集計しています…</p>}
        {request && shown && <Result shown={shown} />}
      </div>
      </div>
    </div>
  );
}

/** シートの一覧をファイルごとにまとめる(並びは保つ) */
function byBook(tabs: SheetSummary[]): { book: SheetSummary["book"]; items: SheetSummary[] }[] {
  const out: { book: SheetSummary["book"]; items: SheetSummary[] }[] = [];
  for (const x of tabs) {
    const g = out.find((o) => o.book.id === x.book.id);
    if (g) g.items.push(x);
    else out.push({ book: x.book, items: [x] });
  }
  return out;
}

function LevelSelect(props: { dim: Dim; value: number | null; onChange: (level: number) => void; label: string }) {
  return (
    <select value={props.value ?? ""} onChange={(e) => props.onChange(Number(e.target.value))} aria-label={props.label}>
      {props.value === null && <option value="">元のまま</option>}
      {props.dim.levels.map((l) => <option key={l.level} value={l.level}>{l.name}({fmt(l.count)})</option>)}
    </select>
  );
}

/** 絞り込みで軸の値を選ぶ(名前で探す。200 件まで) */
function MemberPicker({ dim, selected, onToggle }: { dim: Dim; selected: Set<string>; onToggle: (m: Member) => void }) {
  const [q, setQ] = useState("");
  const [level, setLevel] = useState("");
  const [list, setList] = useState<(Member & { level: number })[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const p = new URLSearchParams({ q });
        if (level !== "") p.set("level", level);
        const r = await api<{ members: (Member & { level: number })[] }>(`/api/4db/dimensions/${dim.id}/members?${p}`, { signal: ctrl.signal });
        setList(r.members);
        setErr("");
      } catch (e) {
        if (!ctrl.signal.aborted) setErr((e as Error).message);
      }
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [dim.id, q, level]);
  const levelName = (lv: number) => dim.levels.find((l) => l.level === lv)?.name ?? "";
  return (
    <div className={s.picker}>
      <div className="row">
        <select value={level} onChange={(e) => setLevel(e.target.value)} aria-label={`${dim.name}の段`}>
          <option value="">すべての段</option>
          {dim.levels.map((l) => <option key={l.level} value={l.level}>{l.name}</option>)}
        </select>
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="名前で探す" aria-label={`${dim.name}を名前で探す`} />
      </div>
      {err && <p className="error">{err}</p>}
      {list && list.length === 0 && <p className="muted">見つかりません。</p>}
      {list && list.length > 0 && (
        <ul className={s.pickList}>
          {list.map((m) => (
            <li key={m.id}>
              <label>
                <input type="checkbox" checked={selected.has(m.id)} onChange={() => onToggle({ id: m.id, name: m.name })} /> {m.name}
                {dim.levels.length > 1 && <span className="muted">({levelName(m.level)})</span>}
              </label>
            </li>
          ))}
        </ul>
      )}
      {list && list.length >= 200 && <p className="muted">200 件まで出しています。名前で絞ってください。</p>}
    </div>
  );
}

// ---------- 表 ----------
function Result({ shown: { r, fn } }: { shown: Shown }) {
  const subByKey = new Map(r.subtotals.map((x) => [x.key, x]));
  const axisLabel = (a: { name: string; levelName: string | null } | null) =>
    a ? (a.levelName === a.name ? a.name : `${a.name}(${a.levelName ?? "元のまま"})`) : null;
  const rowLabel = axisLabel(r.rowAxis);
  const colLabel = axisLabel(r.columnAxis);
  return (
    <section className={`card ${s.resultCard}`}>
      <h2>
        {r.measure.name} の{fnName(fn)}
        {r.rowAxis?.subtotalLevelName && <span className="muted">(小計: {r.rowAxis.subtotalLevelName}ごと)</span>}
      </h2>
      <p className="muted">
        行: {rowLabel ?? "なし"} ・ 列: {colLabel ?? "なし"} ・ 集計した値 {fmt(r.valueCount)} 個 ・ {(r.elapsedMs / 1000).toFixed(2)} 秒
      </p>
      <ul className="legend">
        <li><b><span className="sig">Σ</span></b> 合計・小計・総計(元の値からその場で計算。軸の値ではありません)</li>
        <li><span className="mark">ƒ</span> スプシの関数で計算された値の集計 ・ <span className="mark">ƒ+</span> 元の値と計算された値の両方を含む集計</li>
        <li>(なし) その軸の値を持たない値</li>
      </ul>
      {r.valueCount === 0 ? (
        <p className="muted">値がありません。絞り込みを見直してください。</p>
      ) : (
        <div className={`tableWrap ${s.tableArea}`}>
          <table className="table withMarks">
            <thead>
              <tr>
                <th className="corner" scope="col">{[rowLabel, colLabel].filter(Boolean).join(" × ")}</th>
                {r.columns.map((c, j) => <th key={c.key ?? `none${j}`} className="num" scope="col">{c.name}</th>)}
                {r.rowTotals && <th className="num totalCol" scope="col"><span className="sig">Σ</span> 合計</th>}
              </tr>
            </thead>
            <tbody>
              {r.rows.map((row, i) => {
                const end = r.subtotals.length > 0 && (i === r.rows.length - 1 || r.rows[i + 1].group !== row.group);
                const sub = end ? subByKey.get(row.group) : undefined;
                return (
                  <Fragment key={row.key ?? `none${i}`}>
                    <tr>
                      <th className="rowHead" scope="row">{row.name}</th>
                      {r.cells[i].map((c, j) => <Cell key={j} c={c} />)}
                      {r.rowTotals && <Cell c={r.rowTotals[i]} total edge />}
                    </tr>
                    {sub && (
                      <tr className="subtotal">
                        <th className="rowHead" scope="row"><span className="sig">Σ</span> 小計 {sub.name}</th>
                        {sub.cells.map((c, j) => <Cell key={j} c={c} total />)}
                        {sub.total && <Cell c={sub.total} total edge />}
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
            {r.columnTotals && (
              <tfoot>
                <tr className="grand">
                  <th className="rowHead" scope="row"><span className="sig">Σ</span> 総計</th>
                  {r.columnTotals.map((c, j) => <Cell key={j} c={c} total />)}
                  {r.rowTotals && <Cell c={r.grand} total edge />}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </section>
  );
}

/** 1つのセル。total = 合計・小計・総計、edge = 右端の「Σ 合計」の列 */
function Cell({ c, total, edge }: { c: ProjCell; total?: boolean; edge?: boolean }) {
  const cls = ["num", total ? "totalCell" : "", edge ? "totalCol" : "", c.kind === "calculated" ? "calc" : ""].filter(Boolean).join(" ");
  if (c.n === 0 || c.v === null) return <td className={cls} />;
  const mark = c.kind === "calculated" ? "ƒ" : c.kind === "mixed" ? "ƒ+" : "";
  const what = c.kind === "calculated" ? "すべてスプシの関数で計算された値" : c.kind === "mixed" ? "元の値と、スプシの関数で計算された値を含む" : "元の値";
  return (
    <td className={cls} title={`値 ${fmt(c.n)} 個から(${what})`}>
      {fmt(c.v)}
      {mark && <span className="mark">{mark}</span>}
    </td>
  );
}
