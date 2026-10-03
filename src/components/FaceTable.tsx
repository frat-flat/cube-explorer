"use client";

import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { CellValue } from "@/lib/cube/types";
import { useCubeStore, depthIndexOf } from "@/lib/cube/store";
import styles from "./explorer.module.css";

const ROW_HEIGHT = 33;

function format(c: CellValue | null): string {
  if (!c) return "—";
  switch (c.type) {
    case "number":
      return c.value.toLocaleString("ja-JP", { maximumFractionDigits: 1 });
    case "text":
      return c.value;
    case "list":
      return c.items.join("、") + (c.more ? ` 他${c.more}件` : "");
  }
}

/** 面ビュー:選択中の面を2D表で表示する。行は仮想スクロール(TanStack Virtual) */
export function FaceTable() {
  const { face, request, axes, loading, error } = useCubeStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const rows = face?.rows ?? [];
  // TanStack Virtual は React Compiler の自動メモ化の対象外(このコンポーネントはメモ化されない)
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  if (!face || !request) {
    return <section className={styles.panel}>{error ? <p className={styles.error}>{error}</p> : <p className={styles.note}>読み込み中…</p>}</section>;
  }

  const label = (key: string) => axes.find((a) => a.key === key)?.label ?? key;
  const rowAxis = label(request.spec.axes[request.view.rows].key);
  const colAxis = label(request.spec.axes[request.view.cols].key);
  const depthKey = request.spec.axes[depthIndexOf(request.view)].key;
  const depthText =
    request.depth.mode === "aggregate"
      ? `${label(depthKey)}を集約`
      : `${label(depthKey)}「${face.meta.depthMembers.find((m) => m.key === (request.depth as { member: string }).member)?.label ?? ""}」で断面`;

  let max = 0;
  for (const row of face.cells) for (const c of row) if (c?.type === "number") max = Math.max(max, Math.abs(c.value));
  const heat = (c: CellValue | null) =>
    c?.type === "number" && max > 0
      ? { background: `rgba(var(--heat), calc(var(--heat-max) * ${(Math.abs(c.value) / max).toFixed(3)}))` }
      : undefined;

  const items = virtualizer.getVirtualItems();
  const padTop = items.length ? items[0].start : 0;
  const padBottom = items.length ? virtualizer.getTotalSize() - items[items.length - 1].end : 0;

  return (
    <section className={styles.panel} aria-label="面" aria-busy={loading}>
      <div className={styles.faceHead}>
        <span className={styles.label}>
          {rowAxis} × {colAxis} ／ 奥行き:{depthText}
        </span>
        {loading && <span className={styles.note}>更新中…</span>}
      </div>
      {error && <p className={styles.error}>{error}</p>}
      {face.meta.truncated && (
        <p className={styles.note}>
          目盛りが多いため、各軸の先頭{request.spec.limits?.perAxis ?? 50}件だけを表示しています(
          {Object.entries(face.meta.totalMembers)
            .map(([k, n]) => `${label(k)} ${n}件`)
            .join("、")}
          )
        </p>
      )}
      <div ref={scrollRef} className={styles.tableBox} data-testid="face">
        <table className={styles.face}>
          <thead>
            <tr>
              <th scope="col">
                {rowAxis} \ {colAxis}
              </th>
              {face.cols.map((c) => (
                <th key={c.key} scope="col">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {padTop > 0 && (
              <tr aria-hidden="true">
                <td style={{ height: padTop, padding: 0, border: 0 }} colSpan={face.cols.length + 1} />
              </tr>
            )}
            {items.map((v) => {
              const r = rows[v.index];
              return (
                <tr key={r.key} style={{ height: ROW_HEIGHT }}>
                  <th scope="row">{r.label}</th>
                  {face.cells[v.index].map((c, j) => (
                    <td key={face.cols[j].key} className={c ? undefined : styles.empty} style={heat(c)}>
                      {format(c)}
                    </td>
                  ))}
                </tr>
              );
            })}
            {padBottom > 0 && (
              <tr aria-hidden="true">
                <td style={{ height: padBottom, padding: 0, border: 0 }} colSpan={face.cols.length + 1} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
