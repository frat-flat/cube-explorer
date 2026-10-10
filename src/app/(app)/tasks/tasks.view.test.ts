// Task の画面の中身(TasksView): 一覧・種類の名前・移行の進み具合の 2 行・空のとき・読み込み中・エラー・日時の形・記号の扱い。
// 読み込み済みのデータを描くだけの部品なので、静的に描いて文字を確かめる(外へは何も通信しない)。
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildTaskOverview, type FileProgress, type TaskItem, type TaskOverview } from "@/fourdb/core/tasks";
import { notStartedText, progressCounts, TasksView } from "./TasksView";

const item = (over: Partial<TaskItem> = {}): TaskItem => ({
  kind: "approval",
  runStatus: "staged",
  runId: "r1",
  sheetId: "s1",
  sheet: "売上",
  fileId: "f1",
  file: "月次レポート",
  startedAt: "2026-10-10T05:05:00Z",
  finishedAt: null,
  ...over,
});
const file = (over: Partial<FileProgress> = {}): FileProgress => ({ fileId: "f1", file: "月次レポート", started: 6, migrated: 3, inProgress: 1, imported: 2, failed: 0, notStarted: 4, ...over });
const overview = (items: TaskItem[], files: FileProgress[], more = { items: 0, files: 0 }): TaskOverview => ({
  count: items.length,
  items: { items, more: more.items },
  files: { items: files, more: more.files },
});
const render = (o: TaskOverview | null, error = "") => renderToStaticMarkup(createElement(TasksView, { overview: o, error }));

describe("TasksView: 見出し", () => {
  it("見出しは「Task」に添え書き「やること」", () => {
    const html = render(overview([], []));
    expect(html).toMatch(/<h1[^>]*>Task<small>やること<\/small><\/h1>/);
  });
});

describe("TasksView: やることの一覧", () => {
  it("種類の名前(承認待ち・読み取りの途中・反映の途中・失敗)・ファイル › シート・始めた日時(日本時間・年つき)・Import で開く(/migrate)", () => {
    const items = [
      item({ runId: "a", kind: "approval", runStatus: "staged", sheet: "売上" }),
      item({ runId: "b", kind: "failed", runStatus: "failed", sheet: "原価", startedAt: "2026-10-09T15:00:00Z" }),
      item({ runId: "c", kind: "in_progress", runStatus: "reading", sheet: "在庫" }),
      item({ runId: "d", kind: "in_progress", runStatus: "applying", sheet: "人件費" }),
    ];
    const html = render(overview(items, []));
    for (const label of ["承認待ち", "失敗", "読み取りの途中", "反映の途中"]) expect(html).toContain(label);
    expect(html).toContain("月次レポート › 売上");
    expect(html).toContain("月次レポート › 原価");
    expect(html).toContain("2026-10-10 14:05");
    expect(html).toContain("2026-10-10 00:00"); // 2026-10-09T15:00Z は日本では 10-10 0 時
    expect(html).toContain('dateTime="2026-10-10T05:05:00Z"');
    expect((html.match(/data-testid="task-item"/g) ?? []).length).toBe(4);
    expect((html.match(/href="\/migrate"/g) ?? []).length).toBe(4);
    expect((html.match(/Import で開く/g) ?? []).length).toBe(4);
    expect(html).toContain('data-kind="approval"');
    expect(html).toContain('data-kind="failed"');
    expect(html).toContain('data-kind="in_progress"');
  });

  it("やることがなければ「やることはありません。」", () => {
    const html = render(overview([], []));
    expect(html).toContain("やることはありません。");
    expect(html).not.toContain('data-testid="task-list"');
  });

  it("上限で切れた分は「ほか N 件」", () => {
    const html = render(overview([item()], [], { items: 12, files: 0 }));
    expect(html).toContain("ほか 12 件");
    expect(render(overview([item()], []))).not.toContain("ほか");
  });

  it("ファイル名・シート名の記号は、タグではなく文字として出る", () => {
    const html = render(overview([item({ file: "<img src=x onerror=alert(1)>", sheet: '"><script>x</script>' })], []));
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>x");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
});

describe("TasksView: 移行の進み具合", () => {
  it("見出し「移行の進み具合」と注記。ファイルごとに 1 行目に内訳(移行完了・途中・取り込み済み・失敗)、2 行目に「まだ取り込みを始めていないシート N 枚」", () => {
    const html = render(overview([], [file()]));
    expect(html).toContain("移行の進み具合");
    expect(html).toContain("取り込みを始めたシートで数えます。");
    expect(html).toContain("月次レポート");
    expect(html).toMatch(/移行完了 <b>3<\/b>/);
    expect(html).toMatch(/途中 <b>1<\/b>/);
    expect(html).toMatch(/取り込み済み <b>2<\/b>/);
    expect(html).toMatch(/失敗 <b>0<\/b>/);
    expect(html).toContain("まだ取り込みを始めていないシート 4 枚");
    // 内訳の並び
    const order = ["移行完了", "途中", "取り込み済み", "失敗"].map((w) => html.indexOf(`${w} <b>`));
    expect(order.every((n) => n >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("まだ始めていないシートが 0 枚でも 2 行目は出す。ファイルが複数ならその数だけ", () => {
    const html = render(overview([], [file({ notStarted: 0 }), file({ fileId: "f2", file: "別ファイル" })]));
    expect((html.match(/data-testid="file-progress-item"/g) ?? []).length).toBe(2);
    expect(html).toContain("まだ取り込みを始めていないシート 0 枚");
    expect(html).toContain("別ファイル");
  });

  it("ファイルがなければ、進み具合の欄は出さない。ほかのファイルがあれば「ほか N ファイル」", () => {
    expect(render(overview([], []))).not.toContain("移行の進み具合");
    expect(render(overview([], [file()], { items: 0, files: 5 }))).toContain("ほか 5 ファイル");
  });

  it("progressCounts / notStartedText", () => {
    expect(progressCounts(file()).map((c) => [c.label, c.n])).toEqual([
      ["移行完了", 3],
      ["途中", 1],
      ["取り込み済み", 2],
      ["失敗", 0],
    ]);
    expect(notStartedText(7)).toBe("まだ取り込みを始めていないシート 7 枚");
  });

  it("芯の buildTaskOverview の出力をそのまま描ける", () => {
    const o = buildTaskOverview([
      { sheetId: "s1", sheet: "A", fileId: "f1", file: "F", migrationStatus: "migrating", lastReadAt: null, hasUncancelledRun: true, lastRun: { id: "r1", status: "staged", startedAt: "2026-10-10T05:05:00Z", finishedAt: null } },
      { sheetId: "s2", sheet: "B", fileId: "f1", file: "F", migrationStatus: "migrating", lastReadAt: null, hasUncancelledRun: false, lastRun: null },
    ]);
    const html = render(o);
    expect(html).toContain("承認待ち");
    expect(html).toContain("F › A");
    expect(html).toContain("まだ取り込みを始めていないシート 1 枚");
    expect(html).toMatch(/途中 <b>1<\/b>/);
  });
});

describe("TasksView: 読み込み中・エラー", () => {
  it("読み込み中は、一覧もやることなしも出さない", () => {
    const html = render(null);
    expect(html).toContain("読み込んでいます…");
    expect(html).not.toContain("やることはありません。");
  });

  it("エラーは role=alert で出し、読み込み中の表示は出さない", () => {
    const html = render(null, "うまくいきませんでした(500)");
    expect(html).toContain('role="alert"');
    expect(html).toContain("うまくいきませんでした(500)");
    expect(html).not.toContain("読み込んでいます…");
  });
});
