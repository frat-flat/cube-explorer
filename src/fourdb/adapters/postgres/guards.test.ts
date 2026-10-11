import { describe, expect, it } from "vitest";
import { ImportError } from "./import-store";
import { clampLimit, hasNul, isUuid, rejectNul } from "./guards";

describe("clampLimit(件数の指定)", () => {
  it("なければ既定。整数にして 1〜上限に丸める", () => {
    expect(clampLimit(undefined, 50, 100)).toBe(50);
    expect(clampLimit(10, 50, 100)).toBe(10);
    expect(clampLimit(10.9, 50, 100)).toBe(10);
    expect(clampLimit(100000, 50, 100)).toBe(100);
    expect(clampLimit(0, 50, 100)).toBe(1);
    expect(clampLimit(-5, 50, 100)).toBe(1);
    expect(clampLimit(0.5, 50, 100)).toBe(1);
  });
  it("数でない・有限でないもの(NaN・Infinity)は既定(SQL の limit に NaN・無限大を渡さない)", () => {
    expect(clampLimit(Number.NaN, 50, 100)).toBe(50);
    expect(clampLimit(Number.POSITIVE_INFINITY, 50, 100)).toBe(50);
    expect(clampLimit(Number.NEGATIVE_INFINITY, 50, 100)).toBe(50);
    expect(clampLimit("5" as unknown as number, 50, 100)).toBe(50);
  });
});

describe("NUL の守り", () => {
  it("hasNul: どこにあっても見つける", () => {
    expect(hasNul("a\u0000b")).toBe(true);
    expect(hasNul("\u0000")).toBe(true);
    expect(hasNul("法人")).toBe(false);
    expect(hasNul("")).toBe(false);
  });
  it("rejectNul: NUL があれば 400 の ImportError。なければ何もしない", () => {
    expect(() => rejectNul("法人", "q")).not.toThrow();
    try {
      rejectNul("a\u0000", "q");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ImportError);
      expect((e as ImportError).status).toBe(400);
      expect((e as ImportError).message).toBe("q に使えない文字が入っています");
    }
  });
});

describe("isUuid", () => {
  it("uuid の形だけ", () => {
    expect(isUuid("11111111-2222-4333-8444-555555555555")).toBe(true);
    expect(isUuid("ABCDEF01-2222-4333-8444-555555555555")).toBe(true);
    for (const bad of ["", "abc", "11111111-2222-4333-8444-55555555555", "11111111-2222-4333-8444-555555555555x", "11111111-2222-4333-8444-555555555555\u0000"]) expect(isUuid(bad), bad).toBe(false);
  });
});
