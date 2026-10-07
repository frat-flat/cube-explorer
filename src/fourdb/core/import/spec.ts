// 候補(SheetProposal)から、承認の画面に最初に出す内容(ApprovalSpec の初期値)を作る。人が直してから承認する。
import type { SheetProposal } from "./analyze";
import type { ApprovalSpec, ColumnApproval } from "./plan";

/** 月の列の数値のカラム名(グループ名がなければ仮の名前。画面で直してもらう) */
export const DEFAULT_MEASURE = "値";

export function defaultSpec(p: SheetProposal): ApprovalSpec {
  const columns: ColumnApproval[] = p.columns.map((c) => {
    switch (c.role) {
      case "dimension":
        return { index: c.index, role: "dimension", dimension: c.label, definition: c.label };
      case "attribute":
        return { index: c.index, role: "attribute", definition: c.label };
      case "measure":
        return { index: c.index, role: "measure", definition: c.month ? (c.group ?? DEFAULT_MEASURE) : c.label, month: c.month };
      case "aggregate":
        return { index: c.index, role: "aggregate", fn: c.aggregate?.fn ?? "SUM", definition: null, sums: c.aggregate?.sums ?? [] };
      default:
        return { index: c.index, role: "ignore" };
    }
  });
  const hasAttribute = columns.some((c) => c.role === "attribute");
  const firstDimension = columns.find((c) => c.role === "dimension")?.index ?? null;
  return {
    headerRow: p.layout.headerRow,
    groupRow: p.layout.groupRow,
    rowKeyColumns: p.rowKeyColumns,
    entityColumn: hasAttribute ? (p.rowKeyColumns[0] ?? firstDimension) : null,
    columns,
    aggregateRows: { auto: true, include: [], exclude: [] },
    sheetCoords: [],
  };
}
