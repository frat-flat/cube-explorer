"use client";

import { useCallback, useEffect, useState } from "react";
import Papa from "papaparse";
import { readSheet } from "read-excel-file/browser";
import { TABLES, type TableDef, type TableKey } from "@/lib/deposit/tables";
import styles from "./import.module.css";

type Raw = Record<string, string>;
type Result = { kind: "ok" | "error"; text: string; details?: string[] };
const CHUNK = 2000;

// Excel の日付セルは Date で来るので、文字に直す(年月の列は「2025-10」の形)
const cellText = (v: unknown, monthOnly: boolean) => {
  if (v instanceof Date) {
    const y = v.getFullYear(), m = String(v.getMonth() + 1).padStart(2, "0"), d = String(v.getDate()).padStart(2, "0");
    return monthOnly ? `${y}-${m}` : `${y}-${m}-${d}`;
  }
  return v === null || v === undefined ? "" : String(v);
};

async function readFile(file: File, def: TableDef): Promise<Raw[]> {
  const monthHeaders = new Set(def.columns.filter((c) => c.kind === "month").map((c) => c.header));
  if (/\.xlsx$/i.test(file.name)) {
    const data = await readSheet(file);
    const [head, ...rest] = data;
    const headers = (head ?? []).map((h) => cellText(h, false).trim());
    return rest
      .filter((r) => r.some((c) => c !== null && String(c).trim() !== ""))
      .map((r) => Object.fromEntries(headers.map((h, i) => [h, cellText(r[i], monthHeaders.has(h))])));
  }
  // CSV:UTF-8 で読めなければ Shift_JIS(Excel で保存した CSV)として読む
  const buf = await file.arrayBuffer();
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    text = new TextDecoder("shift_jis").decode(buf);
  }
  const parsed = Papa.parse<Raw>(text.replace(/^﻿/, ""), { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim() });
  return parsed.data;
}

function downloadTemplate(def: TableDef) {
  const headers = [...def.columns.map((c) => c.header), ...Object.keys(def.example).filter((k) => !def.columns.some((c) => c.header === k))];
  const line = (vals: string[]) => vals.map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(",");
  const csv = "﻿" + line(headers) + "\r\n" + line(headers.map((h) => def.example[h] ?? "")) + "\r\n";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `${def.label}_ひな形.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function ImportClient() {
  const [tableKey, setTableKey] = useState<TableKey>("applicants");
  const [rows, setRows] = useState<Raw[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const def = TABLES.find((t) => t.key === tableKey)!;

  const loadCounts = useCallback(async () => {
    const res = await fetch("/api/deposit/counts", { cache: "no-store" });
    if (res.ok) setCounts(await res.json());
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 最初の件数を読み込むだけ
    void loadCounts();
  }, [loadCounts]);

  async function pick(file: File | undefined) {
    setResult(null);
    setRows(null);
    if (!file) return;
    setFileName(file.name);
    try {
      setRows(await readFile(file, def));
    } catch (e) {
      setResult({ kind: "error", text: `ファイルを読めませんでした:${(e as Error).message}` });
    }
  }

  async function upload() {
    if (!rows?.length) return;
    setBusy(true);
    setResult(null);
    let done = 0;
    try {
      for (let i = 0; i < rows.length; i += CHUNK) {
        setProgress(`${Math.min(i + CHUNK, rows.length).toLocaleString()} / ${rows.length.toLocaleString()} 行を送っています…`);
        const res = await fetch("/api/deposit/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ table: def.key, rows: rows.slice(i, i + CHUNK), offset: i }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          const more = body.errorCount > (body.details?.length ?? 0) ? [`ほか ${body.errorCount - body.details.length} 件`] : [];
          setResult({
            kind: "error",
            text: `${body.error ?? "取り込みに失敗しました"}${done ? `(それより前の ${done.toLocaleString()} 行は取り込み済みです)` : ""}`,
            details: [...(body.details ?? []), ...more],
          });
          return;
        }
        done += body.count;
      }
      setResult({ kind: "ok", text: `${def.label}を ${done.toLocaleString()} 件取り込みました(同じコードのものは上書きしました)。` });
      setRows(null);
      setFileName("");
      void loadCounts();
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  const headers = rows?.length ? Object.keys(rows[0]) : [];
  const missing = def.columns.filter((c) => c.required && rows && !headers.includes(c.header)).map((c) => c.header);

  return (
    <main className={styles.wrap}>
      <header className={styles.top}>
        <h1>データの取り込み</h1>
        {/* 入金キューブは読み込み時にスクリプトを動かすので、ページごと読み直す */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <nav><a href="/">入金キューブへ</a><a href="/auth/signout">ログアウト</a></nav>
      </header>
      <p className={styles.note}>
        CSV(UTF-8 か Shift_JIS)か Excel(.xlsx)を取り込めます。上の階層から順に入れてください:申込者 → 契約者 → 法人 → ショップ → 入金明細。
        同じコード(入金明細はショップ・年月・内訳)の行は上書きします。決まった列以外の列は、情報カードの項目としてそのまま入ります。
      </p>

      <div className={styles.tabs} role="tablist" aria-label="取り込む表">
        {TABLES.map((t, i) => (
          <button key={t.key} role="tab" aria-selected={t.key === tableKey} onClick={() => { setTableKey(t.key); setRows(null); setResult(null); setFileName(""); }}>
            {i + 1}. {t.label}
            {counts && <span className={styles.count}>{(counts[t.key] ?? 0).toLocaleString()}件</span>}
          </button>
        ))}
      </div>

      <section className={styles.panel}>
        <h2>{def.label}</h2>
        <p className={styles.note}>
          必須の列:{def.columns.filter((c) => c.required).map((c) => c.header).join("・")}
          {def.columns.some((c) => !c.required) && <> ／ あれば使う列:{def.columns.filter((c) => !c.required).map((c) => c.header).join("・")}</>}
          {def.key === "deposits" && <> ／ 金額は売上を正、費用を負の数で入れてください。年月は「2025-10」「2025/10」「2025年10月」のどれでも読めます。</>}
        </p>
        <div className={styles.row}>
          <button type="button" onClick={() => downloadTemplate(def)}>ひな形(CSV)をダウンロード</button>
          <label className={styles.file}>
            ファイルを選ぶ
            <input type="file" accept=".csv,.xlsx,text/csv" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} disabled={busy} />
          </label>
          {fileName && <span className={styles.note}>{fileName}</span>}
        </div>

        {rows && (
          <>
            <p className={styles.note}>{rows.length.toLocaleString()} 行を読みました。先頭の5行:</p>
            <div className={styles.preview}>
              <table>
                <thead><tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
                <tbody>{rows.slice(0, 5).map((r, i) => <tr key={i}>{headers.map((h) => <td key={h}>{r[h]}</td>)}</tr>)}</tbody>
              </table>
            </div>
            {missing.length > 0 ? (
              <p className={styles.error}>必須の列が見つかりません:{missing.join("・")}(見出しの名前をひな形に合わせてください)</p>
            ) : (
              <button type="button" className={styles.primary} onClick={upload} disabled={busy || !rows.length}>
                {busy ? "取り込み中…" : `${rows.length.toLocaleString()} 行を取り込む`}
              </button>
            )}
          </>
        )}
        {progress && <p className={styles.note}>{progress}</p>}
        {result && (
          <div className={result.kind === "ok" ? styles.ok : styles.error}>
            <p>{result.text}</p>
            {result.details && <ul>{result.details.map((d) => <li key={d}>{d}</li>)}</ul>}
          </div>
        )}
      </section>
    </main>
  );
}
