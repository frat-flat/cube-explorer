// 設計書 7. クエリエンジン:検証 → SQL実行 → Face 形式に整形
import { sql } from "@/lib/db";
import type { Axis, TimeGrain } from "@/lib/meta/axes";
import { loadMeta, type Meta } from "@/lib/meta/load";
import { buildDepthMembersQuery, buildFaceQuery, buildLabelsQuery } from "./sql";
import { MAX_PER_AXIS, type CellValue, type FaceRequest, type FaceResponse, type Member } from "./types";
import { validateFaceRequest } from "./validate";

const STATEMENT_TIMEOUT = "10s"; // 設計書 7.2
const DEPTH_MEMBERS_SCAN_LIMIT = 10000;
const NULL_KEY = "";

type FaceRow = { r: string | null; c: string | null; v: unknown };

export async function getFace(input: unknown): Promise<FaceResponse> {
  const meta = await loadMeta();
  const req = validateFaceRequest(input, meta);
  return runFace(req, meta);
}

export async function runFace(req: FaceRequest, meta: Meta): Promise<FaceResponse> {
  const perAxis = req.spec.limits?.perAxis ?? MAX_PER_AXIS;
  const face = buildFaceQuery(req, meta);
  const depthQ = buildDepthMembersQuery(req, meta, DEPTH_MEMBERS_SCAN_LIMIT);
  const depthIndex = ([0, 1, 2] as const).find((i) => i !== req.view.rows && i !== req.view.cols)!;
  const axisOf = (i: 0 | 1 | 2) => meta.axes.get(req.spec.axes[i].key)!;
  const grainOf = (i: 0 | 1 | 2) => req.spec.axes[i].grain ?? axisOf(i).timeGrain;

  return sql.begin(async (tx) => {
    // 読み取り専用で、10秒を超えたら打ち切る
    await tx.unsafe("set transaction read only");
    await tx.unsafe(`set local statement_timeout = '${STATEMENT_TIMEOUT}'`);
    const rows = (await tx.unsafe(face.text, face.params as never[])) as unknown as FaceRow[];
    const depthRows = (await tx.unsafe(depthQ.text, depthQ.params as never[])) as unknown as { k: string | null }[];

    const keysOf = (pick: (r: FaceRow) => string | null) => sortKeys([...new Set(rows.map((r) => pick(r) ?? NULL_KEY))]);
    const rowKeys = keysOf((r) => r.r);
    const colKeys = keysOf((r) => r.c);
    const depthKeys = sortKeys(depthRows.map((r) => r.k ?? NULL_KEY));

    const shownRows = rowKeys.slice(0, perAxis);
    const shownCols = colKeys.slice(0, perAxis);
    const shownDepth = depthKeys.slice(0, perAxis);

    const label = async (i: 0 | 1 | 2, keys: string[]): Promise<Member[]> => {
      const axis = axisOf(i);
      const names = new Map<string, string>();
      const q = buildLabelsQuery(axis, keys.filter((k) => k !== NULL_KEY));
      if (q && keys.length) {
        const found = (await tx.unsafe(q.text, q.params as never[])) as unknown as { k: string; l: string }[];
        for (const f of found) names.set(f.k, f.l);
      }
      return keys.map((key) => ({ key, label: memberLabel(axis, grainOf(i), key, names) }));
    };

    const index = new Map<string, unknown>();
    for (const r of rows) index.set(`${r.r ?? NULL_KEY}\u0000${r.c ?? NULL_KEY}`, r.v);
    const cells = shownRows.map((rk) =>
      shownCols.map((ck) => {
        const k = `${rk}\u0000${ck}`;
        return index.has(k) ? toCell(index.get(k)) : null;
      }),
    );

    return {
      rows: await label(req.view.rows, shownRows),
      cols: await label(req.view.cols, shownCols),
      cells,
      meta: {
        truncated: rowKeys.length > perAxis || colKeys.length > perAxis || depthKeys.length > perAxis,
        totalMembers: {
          [req.spec.axes[req.view.rows].key]: rowKeys.length,
          [req.spec.axes[req.view.cols].key]: colKeys.length,
          [req.spec.axes[depthIndex].key]: depthKeys.length,
        },
        depthMembers: await label(depthIndex, shownDepth),
      },
    };
  });
}

/** 目盛りの並び順:キーの昇順。値の無い目盛り(NULL)は最後 */
export function sortKeys(keys: string[]): string[] {
  return [...keys].sort((a, b) => {
    if (a === NULL_KEY) return 1;
    if (b === NULL_KEY) return -1;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

export function memberLabel(axis: Axis, grain: TimeGrain | null, key: string, names: Map<string, string>): string {
  if (key === NULL_KEY) return "(なし)";
  if (axis.kind === "time") {
    switch (grain) {
      case "year":
        return `${key}年`;
      case "month": {
        const [y, m] = key.split("-");
        return `${y}年${Number(m)}月`;
      }
      case "week":
        return `${key}の週`;
      default:
        return key;
    }
  }
  return names.get(key) ?? key;
}

export function toCell(v: unknown): CellValue | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return { type: "text", value: v.toISOString(), count: 1 };
  const n = typeof v === "number" ? v : Number(v);
  if (Number.isFinite(n)) return { type: "number", value: n };
  return { type: "text", value: String(v), count: 1 };
}
