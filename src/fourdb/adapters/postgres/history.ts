// 履歴(fourdb.history)の読み取り(つなぎ)。どの関数も withScope の中で呼ぶ。
// workspace は SQL のパラメータで絞り(scope.workspaceId)、行ごとの権限(RLS)が重ねて守る。新しい設定・権限・関数は作らない。
import type { Scope, Tx } from "./db";
import { clampLimit, isUuid } from "./guards";
import { ImportError } from "./import-store";

/** 1回に返す件数(指定がなければ)と上限。上限を超える指定は上限に丸める */
export const HISTORY_DEFAULT_LIMIT = 50;
export const HISTORY_MAX_LIMIT = 100;

export type HistoryItem = {
  /** 履歴の id(新しいほど大きい)。bigint なので文字で返す。続きを読むときの cursor に使う */
  id: string;
  at: string;
  /** 種類(import・definition …)。画面の日本語の名前は画面側で付ける */
  kind: string;
  title: string;
  /** kind = import: 取り込んだシート */
  sheetId: string | null;
  /** kind = definition: 保存した表の定義 */
  definitionId: string | null;
  /** kind = import: 反映の内訳(文)。定義の中身のように大きくなりうる detail は、そのまま返さない */
  lines: string[];
};

export type HistoryPage = { items: HistoryItem[]; nextCursor: string | null };

/** 続きの印(前のページの最後の id)の形: 数字だけ、bigint に収まる 18 桁まで */
export const HISTORY_CURSOR = /^[0-9]{1,18}$/;
/** 種類(kind)の形: 小文字で始まる、小文字・数字・下線の 32 文字まで */
export const HISTORY_KIND = /^[a-z][a-z0-9_]{0,31}$/;
const TIMEOUT = "10s";
const MAX_LINES = 10;
/** 題・内訳の 1 行の長さの上限(定義の名前・シートの名前などが長くても、そのまま返さない) */
const MAX_TEXT_LENGTH = 200;

function workspaceOf(scope: Scope): string {
  if (!scope.workspaceId) throw new Error("workspace がありません");
  return scope.workspaceId;
}

type Row = { id: string; at: Date; kind: string; title: string; sheet_id: string | null; definition_id: string | null; lines: unknown };

function toItem(r: Row): HistoryItem {
  return {
    id: r.id,
    at: r.at.toISOString(),
    kind: r.kind,
    title: r.title.slice(0, MAX_TEXT_LENGTH),
    sheetId: r.sheet_id && isUuid(r.sheet_id) ? r.sheet_id : null,
    definitionId: r.definition_id && isUuid(r.definition_id) ? r.definition_id : null,
    lines: Array.isArray(r.lines)
      ? r.lines.filter((x): x is string => typeof x === "string").slice(0, MAX_LINES).map((x) => x.slice(0, MAX_TEXT_LENGTH))
      : [],
  };
}

/**
 * 履歴を新しい順に返す。cursor = 前のページの最後の id(それより古いものを返す)。limit は 1〜HISTORY_MAX_LIMIT に丸める(数でないものは既定)。
 * kind を指定すると、その種類だけ。次のページがあれば nextCursor に、このページの最後の id を入れる。
 * cursor・kind の形が違えば ImportError(400)。
 */
export async function listHistory(tx: Tx, scope: Scope, options: { cursor?: string | null; limit?: number; kind?: string | null } = {}): Promise<HistoryPage> {
  const ws = workspaceOf(scope);
  const limit = clampLimit(options.limit, HISTORY_DEFAULT_LIMIT, HISTORY_MAX_LIMIT);
  const cursor = options.cursor ?? null;
  const kind = options.kind ?? null;
  if (cursor !== null && !HISTORY_CURSOR.test(cursor)) throw new ImportError("cursor の形が違います", 400);
  if (kind !== null && !HISTORY_KIND.test(kind)) throw new ImportError("kind の形が違います", 400);
  await tx`select set_config('statement_timeout', ${TIMEOUT}, true)`;
  const rows = await tx<Row[]>`
    select h.id::text as id, h.at, h.kind, h.title,
           case when jsonb_typeof(h.detail -> 'sheet_id') = 'string' then h.detail ->> 'sheet_id' end as sheet_id,
           case when jsonb_typeof(h.detail -> 'definition_id') = 'string' then h.detail ->> 'definition_id' end as definition_id,
           case when jsonb_typeof(h.detail -> 'lines') = 'array' then h.detail -> 'lines' end as lines
      from fourdb.history h
     where h.workspace_id = ${ws}
       ${cursor === null ? tx`` : tx`and h.id < ${cursor}`}
       ${kind === null ? tx`` : tx`and h.kind = ${kind}`}
     order by h.id desc
     limit ${limit + 1}`;
  const items = rows.slice(0, limit).map(toItem);
  return { items, nextCursor: rows.length > limit ? items[items.length - 1].id : null };
}
