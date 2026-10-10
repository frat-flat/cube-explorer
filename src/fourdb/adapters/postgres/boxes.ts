// Box の一覧(つなぎ)。ある Box の子を、子の数つきで返す(Library などの木を、開いたところから読むため)。withScope の中で呼ぶ。
// workspace は SQL のパラメータで絞り(scope.workspaceId)、行ごとの権限(RLS)が重ねて守る。新しい設定・権限・関数は作らない。
// 並びは (名前, id)。続きは、前のページの最後の Box の id(cursor)。その Box の (名前, id) をデータベースで引いて、それより後ろを返す
// (キーでの続き読み。件数が多くても、後ろのページが遅くならない。名前が長くても、続きの印は uuid 1 つで済む)。
import type { Scope, Tx } from "./db";
import { clampLimit, isUuid, rejectNul } from "./guards";
import { ImportError } from "./import-store";

export const BOXES_DEFAULT_LIMIT = 100;
export const BOXES_MAX_LIMIT = 200;
const TIMEOUT = "10s";
/** 名前・単位の検索語の長さの上限(members の検索と同じ) */
export const BOXES_TEXT_MAX = 100;

export type BoxItem = {
  id: string;
  parentId: string | null;
  type: "entity" | "group";
  unitType: string | null;
  name: string;
  /** 直下の子の数 */
  childCount: number;
};

export type BoxList = {
  /** 子を読んだ Box(いちばん上 = root のときは null) */
  parent: Omit<BoxItem, "childCount"> | null;
  boxes: BoxItem[];
  /** 続きがあるとき、このページの最後の Box の id。次の cursor に渡す */
  nextCursor: string | null;
};

function workspaceOf(scope: Scope): string {
  if (!scope.workspaceId) throw new Error("workspace がありません");
  return scope.workspaceId;
}

type Row = { id: string; parent_id: string | null; type: "entity" | "group"; unit_type: string | null; name: string; child_count: string };

/**
 * parentId の子を返す(null = いちばん上)。parentId がこの workspace の Box でなければ(uuid の形でないものも)null。別の workspace の id も同じ。
 * unitType = その単位の Box だけ(完全に同じ名前)、q = 名前に含む語(大文字小文字を区別しない)、cursor = 前のページの nextCursor(Box の id)。
 * cursor の Box がこの workspace になければ(消えた・別の workspace のもの・形が違う)、どれも同じ ImportError(400)。存在を知らせない。
 * unitType・q に NUL が入っていれば ImportError(400)。limit は 1〜BOXES_MAX_LIMIT に丸める(数でないものは既定)。
 */
export async function listBoxes(
  tx: Tx,
  scope: Scope,
  options: { parentId?: string | null; unitType?: string | null; q?: string; cursor?: string | null; limit?: number } = {},
): Promise<BoxList | null> {
  const ws = workspaceOf(scope);
  const parentId = options.parentId ?? null;
  const unitType = (options.unitType ?? "").slice(0, BOXES_TEXT_MAX) || null;
  const q = (options.q ?? "").slice(0, BOXES_TEXT_MAX);
  const cursorId = options.cursor ?? null;
  const limit = clampLimit(options.limit, BOXES_DEFAULT_LIMIT, BOXES_MAX_LIMIT);
  if (unitType !== null) rejectNul(unitType, "unitType");
  rejectNul(q, "q");
  if (parentId !== null && !isUuid(parentId)) return null;
  await tx`select set_config('statement_timeout', ${TIMEOUT}, true)`;

  let parent: BoxList["parent"] = null;
  if (parentId !== null) {
    const [p] = await tx<{ id: string; parent_id: string | null; type: "entity" | "group"; unit_type: string | null; name: string }[]>`
      select id, parent_id, type, unit_type, name from fourdb.box where id = ${parentId} and workspace_id = ${ws}`;
    if (!p) return null;
    parent = { id: p.id, parentId: p.parent_id, type: p.type, unitType: p.unit_type, name: p.name };
  }

  // 続きの印: 前のページの最後の Box の (名前, id)。この workspace の Box でなければ、理由によらず同じ断り方
  let after: { name: string; id: string } | null = null;
  if (cursorId !== null) {
    const refused = new ImportError("cursor が見つかりません。最初から読み直してください", 400);
    if (!isUuid(cursorId)) throw refused;
    const [c] = await tx<{ name: string; id: string }[]>`select name, id from fourdb.box where id = ${cursorId} and workspace_id = ${ws}`;
    if (!c) throw refused;
    after = c;
  }

  const rows = await tx<Row[]>`
    select b.id, b.parent_id, b.type, b.unit_type, b.name,
           (select count(*) from fourdb.box c where c.workspace_id = ${ws} and c.parent_id = b.id) as child_count
      from fourdb.box b
     where b.workspace_id = ${ws}
       and ${parentId === null ? tx`b.parent_id is null` : tx`b.parent_id = ${parentId}`}
       ${unitType === null ? tx`` : tx`and b.unit_type = ${unitType}`}
       ${q === "" ? tx`` : tx`and strpos(lower(b.name), lower(${q})) > 0`}
       ${after === null ? tx`` : tx`and (b.name, b.id) > (${after.name}, ${after.id})`}
     order by b.name, b.id
     limit ${limit + 1}`;
  const boxes = rows.slice(0, limit).map((r) => ({
    id: r.id,
    parentId: r.parent_id,
    type: r.type,
    unitType: r.unit_type,
    name: r.name,
    childCount: Number(r.child_count),
  }));
  const last = boxes[boxes.length - 1];
  return { parent, boxes, nextCursor: rows.length > limit && last ? last.id : null };
}
