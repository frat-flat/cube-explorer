import { describe, expect, it } from "vitest";
import { toAxis } from "./axes";

describe("toAxis", () => {
  it("cube_meta.axes の行を Axis に変換する", () => {
    expect(
      toAxis({
        key: "month",
        label: "月",
        kind: "time",
        source_table: null,
        source_column: null,
        label_column: null,
        key_column: null,
        time_grain: "month",
        master_key: "calendar_month",
      }),
    ).toEqual({
      key: "month",
      label: "月",
      kind: "time",
      sourceTable: null,
      sourceColumn: null,
      labelColumn: null,
      keyColumn: null,
      timeGrain: "month",
      masterKey: "calendar_month",
    });
  });
});
