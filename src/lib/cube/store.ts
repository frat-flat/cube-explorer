"use client";

// 画面の状態(設計書 3. 状態管理:Zustand)。すべての操作は CubeSpec / FaceRequest の変換として行う(設計書 6)
import { create } from "zustand";
import type { Axis } from "@/lib/meta/axes";
import type { Agg, Fact } from "@/lib/meta/facts";
import type { AxisIndex, CubeSpec, FaceRequest, FaceResponse } from "./types";

export type Slot = "rows" | "cols" | "depth";

type State = {
  axes: Axis[];
  facts: Fact[];
  request: FaceRequest | null;
  face: FaceResponse | null;
  loading: boolean;
  error: string | null;
  init: () => Promise<void>;
  setFact: (key: string) => void;
  setSlotAxis: (slot: Slot, axisKey: string) => void;
  swapRowsCols: () => void;
  swapColsDepth: () => void;
  setMeasure: (key: string, agg: Agg) => void;
  setDepthMode: (mode: "aggregate" | "slice") => void;
  setSliceMember: (member: string) => void;
};

export const depthIndexOf = (view: FaceRequest["view"]): AxisIndex =>
  ([0, 1, 2] as const).find((i) => i !== view.rows && i !== view.cols)!;

export const slotIndex = (req: FaceRequest, slot: Slot): AxisIndex =>
  slot === "rows" ? req.view.rows : slot === "cols" ? req.view.cols : depthIndexOf(req.view);

/** 事実テーブルの既定の立体:店舗 × 月(奥行き:残りの最初の軸) */
export function defaultRequest(fact: Fact, axes: Axis[]): FaceRequest {
  const usable = axes.filter((a) => a.key in fact.axisColumns && a.kind !== "columns").map((a) => a.key);
  const prefer = ["store", "month", "product_category"].filter((k) => usable.includes(k));
  const keys = [...new Set([...prefer, ...usable])].slice(0, 3);
  const measure = fact.measures.find((m) => m.type === "number") ?? fact.measures[0];
  const agg = measure.aggs.includes("sum") ? "sum" : "count";
  return {
    spec: {
      fact: fact.key,
      axes: keys.map((key) => ({ key })) as CubeSpec["axes"],
      measure: { key: measure.key, agg },
      filters: [],
    },
    view: { rows: 0, cols: 1 },
    depth: { mode: "aggregate" },
  };
}

let seq = 0;

export const useCubeStore = create<State>((set, get) => {
  /** リクエストを差し替えて面を取り直す。古い応答が後から届いても無視する */
  const apply = async (request: FaceRequest) => {
    const id = ++seq;
    set({ request, loading: true, error: null });
    try {
      const res = await fetch("/api/cube/face", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
      const body = await res.json();
      if (id !== seq) return;
      if (!res.ok) set({ loading: false, error: body.error ?? "面を取得できませんでした" });
      else set({ loading: false, face: body as FaceResponse });
    } catch {
      if (id === seq) set({ loading: false, error: "サーバーに接続できませんでした" });
    }
  };
  const update = (fn: (req: FaceRequest) => FaceRequest) => {
    const req = get().request;
    if (req) void apply(fn(structuredClone(req)));
  };

  return {
    axes: [],
    facts: [],
    request: null,
    face: null,
    loading: false,
    error: null,

    init: async () => {
      try {
        const [a, f] = await Promise.all([
          fetch("/api/meta/axes").then((r) => r.json()),
          fetch("/api/meta/facts").then((r) => r.json()),
        ]);
        set({ axes: a.axes, facts: f.facts });
        const sales = (f.facts as Fact[]).find((x) => x.key === "sales") ?? f.facts[0];
        if (sales) await apply(defaultRequest(sales, a.axes));
      } catch {
        set({ error: "メタデータを読み込めませんでした" });
      }
    },

    setFact: (key) => {
      const fact = get().facts.find((f) => f.key === key);
      if (fact) void apply(defaultRequest(fact, get().axes));
    },

    // 軸の入れ替え:axes のいずれかを別の軸に置き換える。既に別の場所にある軸なら、その場所と入れ替える
    setSlotAxis: (slot, axisKey) =>
      update((req) => {
        const i = slotIndex(req, slot);
        const j = req.spec.axes.findIndex((a) => a.key === axisKey);
        if (j >= 0) [req.spec.axes[i], req.spec.axes[j]] = [req.spec.axes[j], req.spec.axes[i]];
        else req.spec.axes[i] = { key: axisKey };
        if (req.depth.mode === "slice" && (slot === "depth" || j === depthIndexOf(req.view))) {
          req.depth = { mode: "aggregate" };
        }
        return req;
      }),

    // 回転:view.rows / view.cols を入れ替える。CubeSpec は変えない
    swapRowsCols: () =>
      update((req) => ({ ...req, view: { rows: req.view.cols, cols: req.view.rows } })),

    // 回転:列と奥行きを入れ替える
    swapColsDepth: () =>
      update((req) => ({
        ...req,
        view: { rows: req.view.rows, cols: depthIndexOf(req.view) },
        depth: { mode: "aggregate" },
      })),

    setMeasure: (key, agg) => update((req) => ({ ...req, spec: { ...req.spec, measure: { key, agg } } })),

    setDepthMode: (mode) =>
      update((req) => {
        if (mode === "aggregate") return { ...req, depth: { mode } };
        const first = get().face?.meta.depthMembers[0]?.key;
        return first === undefined ? req : { ...req, depth: { mode, member: first } };
      }),

    setSliceMember: (member) => update((req) => ({ ...req, depth: { mode: "slice", member } })),
  };
});
