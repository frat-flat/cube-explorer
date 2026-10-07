// 芯が外に求めるもの(つなぎが実装する)。芯はこの形だけを知り、Google や データベースの細部は知らない。
import type { Merge, SourceCell } from "./import/types";

export type SourceTab = { externalId: string; title: string; rowCount: number; colCount: number };
export type SourceBook = { provider: "google_sheets"; externalId: string; title: string; url: string; tabs: SourceTab[] };

/** 取り込み元(スプシなど)を読む */
export interface SourceReader {
  /** リンクから、ファイルの名前とタブの一覧(大きさ)を読む */
  book(urlOrId: string): Promise<SourceBook>;
  /** タブの start 行目(0 始まり)から count 行を読む。返す rows[i] は start + i 行目。結合セルは読んだ範囲のもの */
  rows(book: { externalId: string }, tab: { title: string; colCount: number }, start: number, count: number): Promise<{ rows: SourceCell[][]; merges: Merge[] }>;
}

/** 読み取りの失敗(利用者に見せてよい文で) */
export class SourceError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: "not_configured" | "bad_url" | "not_shared" | "not_found" | "upstream" | "not_allowed",
  ) {
    super(message);
  }
}

/** 1回に読む行の数(セルの数がおよそ max 個になるように。少なくとも 100 行) */
export function chunkRows(colCount: number, max = 20000): number {
  return Math.max(100, Math.floor(max / Math.max(1, colCount)));
}
