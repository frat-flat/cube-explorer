import { describe, expect, it } from "vitest";
import { TASK_STATUS_LABELS } from "./labels";
import { buildTaskOverview, progressBucket, TASK_LIMITS, taskOf } from "./tasks";
import { RUN_STATUSES, TASK_RUN_STATUSES, type RunStatus, type TaskRow } from "./types";

const AT = (day: number, hour = 0) => `2026-10-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00.000Z`;

type RowOpts = Partial<Omit<TaskRow, "lastRun">> & { run?: RunStatus | null; runId?: string; startedAt?: string; finishedAt?: string | null };
/** 1 シートの行。run = 最後の取り込みの状態(null なら取り込みなし)。取り込みがあれば hasUncancelledRun は(cancelled 以外なら)true */
function row(o: RowOpts = {}): TaskRow {
  const run = o.run === undefined ? null : o.run;
  return {
    sheetId: o.sheetId ?? "s1",
    sheet: o.sheet ?? "シート",
    fileId: o.fileId ?? "f1",
    file: o.file ?? "ファイル",
    migrationStatus: o.migrationStatus ?? "migrating",
    lastReadAt: o.lastReadAt ?? null,
    hasUncancelledRun: o.hasUncancelledRun ?? (run !== null && run !== "cancelled"),
    lastRun: run === null ? null : { id: o.runId ?? `run-${o.sheetId ?? "s1"}`, status: run, startedAt: o.startedAt ?? AT(1), finishedAt: o.finishedAt ?? null },
  };
}

describe("TASK_RUN_STATUSES と taskOf", () => {
  it("Task になる状態は staged・reading・applying・failed(件数の SQL のパラメータ)", () => {
    expect([...TASK_RUN_STATUSES].sort()).toEqual(["applying", "failed", "reading", "staged"]);
    expect(RUN_STATUSES).toHaveLength(6);
  });
  it("staged → 承認待ち、reading・applying → 途中、failed → 失敗", () => {
    expect(taskOf("staged")).toBe("approval");
    expect(taskOf("reading")).toBe("in_progress");
    expect(taskOf("applying")).toBe("in_progress");
    expect(taskOf("failed")).toBe("failed");
  });
  it("applied・cancelled・知らない状態・値なしは Task にならない", () => {
    for (const s of ["applied", "cancelled", "", "STAGED", "done", " staged"]) expect(taskOf(s)).toBeNull();
    expect(taskOf(null)).toBeNull();
    expect(taskOf(undefined)).toBeNull();
  });
  it("TASK_RUN_STATUSES の状態はすべて Task になり、それ以外の状態はならない", () => {
    for (const s of RUN_STATUSES) expect(taskOf(s) !== null).toBe((TASK_RUN_STATUSES as readonly string[]).includes(s));
  });
  it("状態の名前がすべてにある", () => {
    expect(Object.keys(TASK_STATUS_LABELS).sort()).toEqual([...TASK_RUN_STATUSES].sort());
    expect(TASK_STATUS_LABELS).toEqual({ staged: "承認待ち", reading: "読み取りの途中", applying: "反映の途中", failed: "失敗" });
  });
});

describe("progressBucket: 移行完了 > 途中 > 取り込み済み > 失敗、始めていなければ notStarted", () => {
  it("取り込みを始めていないシート(取り込みなし・取り消しだけ)は notStarted", () => {
    expect(progressBucket(row())).toBe("notStarted");
    expect(progressBucket(row({ run: "cancelled" }))).toBe("notStarted");
    // 取り消していない取り込みがなければ、last_read_at があっても「始めていない」(取り込みを始めたシートで数える決まり)
    expect(progressBucket(row({ run: "cancelled", lastReadAt: AT(2) }))).toBe("notStarted");
  });
  it("migrated は、ほかの状態によらず移行完了", () => {
    for (const run of [null, ...RUN_STATUSES] as const) expect(progressBucket(row({ migrationStatus: "migrated", run, lastReadAt: AT(1) }))).toBe("migrated");
    expect(progressBucket(row({ migrationStatus: "migrated" }))).toBe("migrated");
  });
  it("最後の取り込みが staged・reading・applying なら途中(承認待ちも途中。取り込み済みの日があっても途中が先)", () => {
    for (const run of ["staged", "reading", "applying"] as const) {
      expect(progressBucket(row({ run }))).toBe("inProgress");
      expect(progressBucket(row({ run, lastReadAt: AT(1) }))).toBe("inProgress");
    }
  });
  it("last_read_at があれば取り込み済み(あとの取り込みが失敗・取り消しでも、失敗より先)", () => {
    expect(progressBucket(row({ run: "applied", lastReadAt: AT(1) }))).toBe("imported");
    expect(progressBucket(row({ run: "failed", lastReadAt: AT(1) }))).toBe("imported");
    expect(progressBucket(row({ run: "cancelled", lastReadAt: AT(1), hasUncancelledRun: true }))).toBe("imported");
  });
  it("最後の取り込みが applied なら、last_read_at がなくても取り込み済み", () => {
    expect(progressBucket(row({ run: "applied" }))).toBe("imported");
  });
  it("取り込みを始めたが、反映したことがなければ失敗", () => {
    expect(progressBucket(row({ run: "failed" }))).toBe("failed");
    // 失敗のあとに取り消した(取り消していない取り込みは失敗の 1 つ)
    expect(progressBucket(row({ run: "cancelled", hasUncancelledRun: true }))).toBe("failed");
    // 食い違った入力(取り込みの行がないのに取り消していない取り込みがある)も、見落とさないよう失敗に入れる
    expect(progressBucket(row({ run: null, hasUncancelledRun: true }))).toBe("failed");
  });
  it("優先の順: 移行完了 > 途中 > 取り込み済み > 失敗", () => {
    const base = { hasUncancelledRun: true, lastReadAt: AT(1) as string | null };
    expect(progressBucket({ ...base, migrationStatus: "migrated", lastRun: { id: "r", status: "reading", startedAt: AT(1), finishedAt: null } })).toBe("migrated");
    expect(progressBucket({ ...base, migrationStatus: "migrating", lastRun: { id: "r", status: "reading", startedAt: AT(1), finishedAt: null } })).toBe("inProgress");
    expect(progressBucket({ ...base, migrationStatus: "migrating", lastRun: { id: "r", status: "failed", startedAt: AT(1), finishedAt: null } })).toBe("imported");
    expect(progressBucket({ ...base, lastReadAt: null, migrationStatus: "migrating", lastRun: { id: "r", status: "failed", startedAt: AT(1), finishedAt: null } })).toBe("failed");
  });
  it("状態 × last_read_at × 取り消していない取り込み × 移行完了のすべての組み合わせで、どれか 1 つに入る", () => {
    const valid = new Set(["migrated", "inProgress", "imported", "failed", "notStarted"]);
    for (const run of [null, ...RUN_STATUSES] as const)
      for (const lastReadAt of [null, AT(1)])
        for (const hasUncancelledRun of [false, true])
          for (const migrationStatus of ["migrating", "migrated"] as const)
            expect(valid.has(progressBucket(row({ run, lastReadAt, hasUncancelledRun, migrationStatus })))).toBe(true);
  });
});

describe("buildTaskOverview", () => {
  it("シートがなければ、やることも進み具合も空", () => {
    expect(buildTaskOverview([])).toEqual({ count: 0, items: { items: [], more: 0 }, files: { items: [], more: 0 } });
  });

  // ファイルA: 6 枚(承認待ち・読み取り中・反映中・失敗・取り込み済み・移行完了)、ファイルB: 3 枚(取り消しだけ・取り込みなし・失敗のあとに取り消し)
  const rows: TaskRow[] = [
    row({ sheetId: "a1", sheet: "承認待ち", fileId: "A", file: "台帳", run: "staged", runId: "r-a1", startedAt: AT(5) }),
    row({ sheetId: "a2", sheet: "読み取り", fileId: "A", file: "台帳", run: "reading", runId: "r-a2", startedAt: AT(9) }),
    row({ sheetId: "a3", sheet: "反映", fileId: "A", file: "台帳", run: "applying", runId: "r-a3", startedAt: AT(7) }),
    row({ sheetId: "a4", sheet: "失敗", fileId: "A", file: "台帳", run: "failed", runId: "r-a4", startedAt: AT(3), finishedAt: AT(3, 1) }),
    row({ sheetId: "a5", sheet: "済み", fileId: "A", file: "台帳", run: "applied", runId: "r-a5", startedAt: AT(2), lastReadAt: AT(2, 1) }),
    row({ sheetId: "a6", sheet: "完了", fileId: "A", file: "台帳", run: "applied", runId: "r-a6", startedAt: AT(1), lastReadAt: AT(1, 1), migrationStatus: "migrated" }),
    row({ sheetId: "b1", sheet: "取り消しだけ", fileId: "B", file: "マスタ", run: "cancelled", runId: "r-b1", startedAt: AT(8) }),
    row({ sheetId: "b2", sheet: "未", fileId: "B", file: "マスタ" }),
    row({ sheetId: "b3", sheet: "失敗後に取り消し", fileId: "B", file: "マスタ", run: "cancelled", runId: "r-b3", startedAt: AT(6), hasUncancelledRun: true }),
  ];

  it("やることは staged・reading・applying・failed のシートだけ。件数は一覧の数と同じ", () => {
    const o = buildTaskOverview(rows);
    expect(o.count).toBe(4);
    expect(o.items.items.map((t) => t.sheetId)).toEqual(["a1", "a4", "a2", "a3"]);
    expect(o.items.more).toBe(0);
  });
  it("並べ方: 承認待ち → 失敗 → 途中、同じ種類は始めた日時の新しい順", () => {
    const more = [
      ...rows,
      row({ sheetId: "c1", fileId: "C", file: "c", run: "staged", runId: "r-c1", startedAt: AT(10) }),
      row({ sheetId: "c2", fileId: "C", file: "c", run: "failed", runId: "r-c2", startedAt: AT(10) }),
      row({ sheetId: "c3", fileId: "C", file: "c", run: "reading", runId: "r-c3", startedAt: AT(12) }),
    ];
    const t = buildTaskOverview(more).items.items;
    expect(t.map((x) => [x.kind, x.sheetId])).toEqual([
      ["approval", "c1"],
      ["approval", "a1"],
      ["failed", "c2"],
      ["failed", "a4"],
      ["in_progress", "c3"],
      ["in_progress", "a2"],
      ["in_progress", "a3"],
    ]);
  });
  it("種類・状態・シート・ファイル・日時が入る。取り込みの error の文は入らない", () => {
    const withError = { ...rows[3], lastRun: { ...rows[3].lastRun!, error: "秘密のかもしれない文" } } as unknown as TaskRow;
    const item = buildTaskOverview([withError]).items.items[0];
    expect(item).toEqual({ kind: "failed", runStatus: "failed", runId: "r-a4", sheetId: "a4", sheet: "失敗", fileId: "A", file: "台帳", startedAt: AT(3), finishedAt: AT(3, 1) });
    expect(JSON.stringify(buildTaskOverview([withError]))).not.toContain("秘密");
  });
  it("ファイルごとの進み具合: 取り込みを始めたシートで数え、まだのシートは別", () => {
    const o = buildTaskOverview(rows);
    // ファイル名の順は UTF-16 の順(カナ「マ」U+30DE は漢字「台」U+53F0 より前)
    expect(o.files.items).toEqual([
      // b1 取り消しだけ・b2 取り込みなし = まだ、b3 失敗後に取り消し = 失敗
      { fileId: "B", file: "マスタ", started: 1, migrated: 0, inProgress: 0, imported: 0, failed: 1, notStarted: 2 },
      // a1 staged・a2 reading・a3 applying = 途中 3、a4 失敗 1、a5 取り込み済み 1、a6 移行完了 1
      { fileId: "A", file: "台帳", started: 6, migrated: 1, inProgress: 3, imported: 1, failed: 1, notStarted: 0 },
    ]);
  });
  it("ファイルの並び: ファイル名の順。同じ名前のファイルは別々に出す", () => {
    const o = buildTaskOverview([
      row({ sheetId: "1", fileId: "z", file: "B" }),
      row({ sheetId: "2", fileId: "y", file: "A" }),
      row({ sheetId: "3", fileId: "x", file: "A" }),
    ]);
    expect(o.files.items.map((f) => `${f.file}:${f.fileId}`)).toEqual(["A:x", "A:y", "B:z"]);
  });
  it("まだ取り込みを始めていないシートだけのファイルも出る(started = 0)", () => {
    const o = buildTaskOverview([row({ sheetId: "1", fileId: "f", file: "F" }), row({ sheetId: "2", fileId: "f", file: "F" })]);
    expect(o.files.items).toEqual([{ fileId: "f", file: "F", started: 0, migrated: 0, inProgress: 0, imported: 0, failed: 0, notStarted: 2 }]);
    expect(o.count).toBe(0);
  });
  it("どのファイルでも started = 移行完了 + 途中 + 取り込み済み + 失敗、シートの数 = started + notStarted", () => {
    const o = buildTaskOverview(rows);
    const perFile = new Map<string, number>();
    for (const r of rows) perFile.set(r.fileId, (perFile.get(r.fileId) ?? 0) + 1);
    for (const f of o.files.items) {
      expect(f.started).toBe(f.migrated + f.inProgress + f.imported + f.failed);
      expect(f.started + f.notStarted).toBe(perFile.get(f.fileId));
    }
  });
  it("移行完了のシートの最後の取り込みが失敗なら、状態どおり Task になる(件数の SQL と同じ決まり)", () => {
    const o = buildTaskOverview([row({ migrationStatus: "migrated", run: "failed" })]);
    expect(o.count).toBe(1);
    expect(o.files.items[0].migrated).toBe(1);
  });
  it("件数は、状態が TASK_RUN_STATUSES に当たるシートの数(上限で切る前)", () => {
    const many: TaskRow[] = [];
    for (let i = 0; i < 230; i++) {
      many.push(row({ sheetId: `s${i}`, fileId: `f${i}`, file: `f${String(i).padStart(3, "0")}`, run: RUN_STATUSES[i % RUN_STATUSES.length], runId: `r${String(i).padStart(3, "0")}`, startedAt: AT(1 + (i % 28)) }));
    }
    const expected = many.filter((r) => r.lastRun && (TASK_RUN_STATUSES as readonly string[]).includes(r.lastRun.status)).length;
    const o = buildTaskOverview(many);
    expect(o.count).toBe(expected);
    expect(o.items.items).toHaveLength(Math.min(expected, TASK_LIMITS.items));
    expect(o.items.items.length + o.items.more).toBe(expected);
    expect(o.files.items).toHaveLength(TASK_LIMITS.files);
    expect(o.files.items.length + o.files.more).toBe(230);
  });
  it("上限の定数", () => {
    expect(TASK_LIMITS).toEqual({ rows: 5000, items: 100, files: 100 });
  });
  it("入力の並びによらず同じ結果で、入力を書き換えず、JSON にできる", () => {
    const copy = JSON.parse(JSON.stringify(rows)) as TaskRow[];
    const a = buildTaskOverview(rows);
    expect(rows).toEqual(copy);
    expect(buildTaskOverview([...rows].reverse())).toEqual(a);
    expect(buildTaskOverview([...rows.slice(4), ...rows.slice(0, 4)])).toEqual(a);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
  });
});
