// 立体の収め方のうち、純粋な計算(よける四角から空いている所を求める)の試験。three の描画・DOM は使わない。
import { describe, expect, it } from "vitest";
import { freeRects, largest, rectH, rectW, type Rect } from "./framing";

const AREA: Rect = { x0: 30, y0: 66, x1: 1042, y1: 722 }; // 1072 × 748 の舞台から余白を除いた所

describe("freeRects", () => {
  it("よける四角がなければ、そのまま", () => {
    expect(freeRects(AREA, [])).toEqual([AREA]);
  });

  it("舞台の外の四角は無視する", () => {
    expect(freeRects(AREA, [{ x0: 2000, y0: 0, x1: 2400, y1: 800 }])).toEqual([AREA]);
  });

  it("右の欄(右端いっぱい)をよけると、欄の左だけが残る(すき間 16px)", () => {
    const panel: Rect = { x0: 680, y0: 0, x1: 1072, y1: 748 };
    const rects = freeRects(AREA, [panel]);
    expect(rects).toEqual([{ ...AREA, x1: 664 }]);
  });

  it("右下の Visual の欄をよけると、欄の左と欄の上の 2 つが候補になる", () => {
    const visual: Rect = { x0: 670, y0: 400, x1: 1054, y1: 730 };
    const rects = freeRects(AREA, [visual]);
    expect(rects).toContainEqual({ ...AREA, x1: 654 });
    expect(rects).toContainEqual({ ...AREA, y1: 388 });
    for (const r of rects) {
      expect(rectW(r)).toBeGreaterThanOrEqual(260);
      expect(rectH(r)).toBeGreaterThanOrEqual(220);
      // どの候補も欄に重ならない
      expect(r.x1 <= visual.x0 || r.y1 <= visual.y0 || r.x0 >= visual.x1 || r.y0 >= visual.y1).toBe(true);
    }
  });

  it("右の欄と Visual の欄を両方よける", () => {
    const panel: Rect = { x0: 680, y0: 0, x1: 1072, y1: 748 };
    const visual: Rect = { x0: 670, y0: 400, x1: 1054, y1: 730 };
    const rects = freeRects(AREA, [panel, visual]);
    for (const o of [panel, visual])
      for (const r of rects) expect(r.x1 <= o.x0 || r.y1 <= o.y0 || r.x0 >= o.x1 || r.y0 >= o.y1).toBe(true);
    // 右の欄の左(x1 = 680 - 16)は、Visual の欄(x0 = 670)にも重ならないので、そのまま残る
    expect(largest(rects)).toEqual({ ...AREA, x1: 664 });
  });

  it("小さすぎる所しか残らなければ、元の所を返す(立体を消さない)", () => {
    const huge: Rect = { x0: 100, y0: 100, x1: 1000, y1: 700 };
    expect(freeRects(AREA, [huge])).toEqual([AREA]);
  });
});
