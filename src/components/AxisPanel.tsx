"use client";

import { useCubeStore, slotIndex, type Slot } from "@/lib/cube/store";
import type { Agg } from "@/lib/meta/facts";
import styles from "./explorer.module.css";

const AGG_LABEL: Record<Agg, string> = {
  sum: "合計",
  avg: "平均",
  count: "件数",
  min: "最小",
  max: "最大",
  latest: "最新",
  list: "一覧",
};
// latest / list はスプリント2で対応する
const USABLE_AGGS: Agg[] = ["sum", "avg", "count", "min", "max"];

const SLOTS: { slot: Slot; label: string }[] = [
  { slot: "rows", label: "行" },
  { slot: "cols", label: "列" },
  { slot: "depth", label: "奥行き" },
];

export function AxisPanel() {
  const { axes, facts, request, face } = useCubeStore();
  const store = useCubeStore.getState();
  if (!request) return null;

  const fact = facts.find((f) => f.key === request.spec.fact);
  if (!fact) return null;
  const usableAxes = axes.filter((a) => a.key in fact.axisColumns && a.kind !== "columns");
  const measureOptions = fact.measures.flatMap((m) =>
    m.aggs.filter((g) => USABLE_AGGS.includes(g)).map((g) => ({ value: `${m.key}:${g}`, label: `${m.label} / ${AGG_LABEL[g]}` })),
  );
  const depthMembers = face?.meta.depthMembers ?? [];

  return (
    <section className={styles.panel} aria-label="軸設定">
      <div className={styles.controls}>
        <div className={styles.ctl}>
          <label htmlFor="fact">データ</label>
          <select id="fact" value={fact.key} onChange={(e) => store.setFact(e.target.value)}>
            {facts.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
        </div>

        {SLOTS.map(({ slot, label }, n) => (
          <div key={slot} className={styles.slotGroup}>
            {n > 0 && (
              <button
                type="button"
                onClick={n === 1 ? store.swapRowsCols : store.swapColsDepth}
                title={n === 1 ? "行と列を入れ替える(回転)" : "列と奥行きを入れ替える(回転)"}
                aria-label={n === 1 ? "行と列を入れ替える" : "列と奥行きを入れ替える"}
              >
                ⇄
              </button>
            )}
            <div className={styles.ctl}>
              <label htmlFor={`axis-${slot}`}>{label}</label>
              <select
                id={`axis-${slot}`}
                value={request.spec.axes[slotIndex(request, slot)].key}
                onChange={(e) => store.setSlotAxis(slot, e.target.value)}
              >
                {usableAxes.map((a) => (
                  <option key={a.key} value={a.key}>
                    {a.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ))}

        <div className={styles.ctl}>
          <span className={styles.label}>奥行きの扱い</span>
          <div className={styles.seg} role="group" aria-label="奥行きの扱い">
            <button
              type="button"
              aria-pressed={request.depth.mode === "aggregate"}
              onClick={() => store.setDepthMode("aggregate")}
            >
              集約
            </button>
            <button
              type="button"
              aria-pressed={request.depth.mode === "slice"}
              onClick={() => store.setDepthMode("slice")}
              disabled={depthMembers.length === 0}
            >
              断面
            </button>
          </div>
        </div>

        {request.depth.mode === "slice" && (
          <div className={styles.ctl}>
            <label htmlFor="slice-member">断面の値</label>
            <select id="slice-member" value={request.depth.member} onChange={(e) => store.setSliceMember(e.target.value)}>
              {depthMembers.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className={styles.ctl}>
          <label htmlFor="measure">値</label>
          <select
            id="measure"
            value={`${request.spec.measure.key}:${request.spec.measure.agg}`}
            onChange={(e) => {
              const [key, agg] = e.target.value.split(":");
              store.setMeasure(key, agg as Agg);
            }}
          >
            {measureOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </section>
  );
}
