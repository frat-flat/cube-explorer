// 試験用の読み取り元(画面の試験・結合の試験で使う)。本番では使えない。
// FOURDB_SHEETS_FIXTURE_DIR のフォルダの <ID>.json を、スプシの代わりに読む。読めなければ失敗にする(例のデータに切り替えない)。
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Merge, SourceCell } from "@/fourdb/core/import/types";
import { SourceError, type SourceReader } from "@/fourdb/core/ports";

type FixtureCell = string | number | { v: string; n?: number | null; f?: string | null };
type Fixture = { title: string; tabs: { externalId: string; title: string; rows: FixtureCell[][]; merges?: Merge[] }[] };

const cell = (c: FixtureCell): SourceCell =>
  typeof c === "number" ? { v: String(c), n: c, f: null } : typeof c === "string" ? { v: c, n: null, f: null } : { v: c.v, n: c.n ?? null, f: c.f ?? null };

function idOf(urlOrId: string): string | null {
  const m = urlOrId.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/) ?? urlOrId.match(/^fixture:([a-zA-Z0-9_-]+)$/);
  return m ? m[1] : null;
}

async function load(dir: string, id: string): Promise<Fixture> {
  try {
    return JSON.parse(await readFile(join(dir, `${id}.json`), "utf8")) as Fixture;
  } catch {
    throw new SourceError("スプシが見つかりません。リンクを確かめてください", 404, "not_found");
  }
}

export function fixtureReader(dir: string): SourceReader {
  if (process.env.NODE_ENV === "production") throw new SourceError("試験用の読み取り元は本番では使えません", 500, "not_allowed");
  return {
    async book(urlOrId) {
      const id = idOf(urlOrId.trim());
      if (!id) throw new SourceError("スプシのリンクの形ではありません", 400, "bad_url");
      const f = await load(dir, id);
      return {
        provider: "google_sheets",
        externalId: id,
        title: f.title,
        url: `https://docs.google.com/spreadsheets/d/${id}/edit`,
        tabs: f.tabs.map((t) => ({ externalId: t.externalId, title: t.title, rowCount: t.rows.length, colCount: Math.max(0, ...t.rows.map((r) => r.length)) })),
      };
    },
    async rows(book, tab, start, count) {
      const f = await load(dir, book.externalId);
      const t = f.tabs.find((x) => x.title === tab.title);
      if (!t) throw new SourceError("元のタブが見つかりません(タブの名前が変わったか、消えた可能性があります)", 404, "not_found");
      return {
        rows: t.rows.slice(start, start + count).map((r) => r.map(cell)),
        merges: (t.merges ?? []).filter((m) => m.r1 > start && m.r0 < start + count),
      };
    },
  };
}
