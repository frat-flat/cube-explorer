import { describe, expect, it } from "vitest";
import { LOOK_OPTIONS, type Look } from "@/fourdb/core/prefs";
import {
  BAND_CLEARANCE,
  BASES,
  BOB_AMPLITUDE,
  bandDefs,
  bandExtent,
  bandGap,
  boxHalfHeight,
  boxSide,
  circumRadius,
  dishHeight,
  hasFace,
  isMany,
  layoutExtent,
  orbitRadius,
  overlappingPairs,
  stageRiser,
  STAGE_RISE,
  unitFootprintRadius,
  unitFootprints,
  unitMetrics,
  unitSlots,
} from "./layout";

const COUNTS = [1, 2, 3, 4, 5, 6] as const;
const LAYOUTS = LOOK_OPTIONS.layout;
const SHAPES = LOOK_OPTIONS.shape;
const TILTS = LOOK_OPTIONS.tilt;
const BASE_IDS = LOOK_OPTIONS.base;
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

describe("isMany と Box の大きさ", () => {
  it("単位が 4 つ以上のとき『多い』", () => {
    expect(COUNTS.map(isMany)).toEqual([false, false, false, true, true, true]);
  });
  it("Box の一辺(試作の数値): 面を下 0.58 / 多いとき 0.62、角を下 0.5 / 多いとき 0.54", () => {
    expect(boxSide("flat", 3)).toBe(0.58);
    expect(boxSide("flat", 4)).toBe(0.62);
    expect(boxSide("vertex", 3)).toBe(0.5);
    expect(boxSide("vertex", 4)).toBe(0.54);
  });
  it("外接球の半径 = 辺 × √3 / 2。角を下なら高さの半分もそれ、面を下なら辺の半分", () => {
    expect(near(circumRadius(0.5), (0.5 * Math.sqrt(3)) / 2)).toBe(true);
    expect(boxHalfHeight(0.5, "vertex")).toBe(circumRadius(0.5));
    expect(boxHalfHeight(0.5, "flat")).toBe(0.25);
  });
  it("点線の軌道の半径は、多いとき 0.65、そうでなければ 0.72", () => {
    expect(orbitRadius(3)).toBe(0.72);
    expect(orbitRadius(4)).toBe(0.65);
  });
});

describe("unitSlots: 並べる場所", () => {
  it("単位が 0 なら空。小数・負の数は切り捨てて 0 以上にする", () => {
    for (const l of LAYOUTS) {
      expect(unitSlots(0, l)).toEqual([]);
      expect(unitSlots(-3, l)).toEqual([]);
      expect(unitSlots(2.9, l)).toHaveLength(2);
    }
  });
  it("単位が 1 つなら、どの並べ方でも真ん中の床の上", () => {
    for (const l of LAYOUTS) expect(unitSlots(1, l)).toEqual([{ x: 0, y: 0, z: 0, tier: 0 }]);
  });
  it("1 列: 間隔は 2 つまで 2.15、3 つで 1.95、4 つ以上で 1.48。左右対称で、まっすぐ", () => {
    for (const [n, step] of [[2, 2.15], [3, 1.95], [4, 1.48], [5, 1.48], [6, 1.48]] as const) {
      const s = unitSlots(n, "row");
      expect(s).toHaveLength(n);
      for (let i = 0; i < n; i++) {
        expect(near(s[i].x, (i - (n - 1) / 2) * step)).toBe(true);
        expect(s[i].y).toBe(0);
        expect(s[i].z).toBe(0);
        expect(s[i].tier).toBe(0);
      }
    }
  });
  it("弧: 間隔は 4 つ以上で 1.42(それ以外は 1 列と同じ)。z = 0.085 × x²", () => {
    for (const n of [2, 3]) expect(unitSlots(n, "arc").map((s) => s.x)).toEqual(unitSlots(n, "row").map((s) => s.x));
    const s = unitSlots(5, "arc");
    expect(near(s[1].x - s[0].x, 1.42)).toBe(true);
    for (const p of s) expect(near(p.z, 0.085 * p.x * p.x)).toBe(true);
    // 左右の端ほど手前
    expect(s[0].z).toBeGreaterThan(s[2].z);
    expect(near(s[0].z, s[4].z)).toBe(true);
  });
  it("ひな壇: 偶数番目が後ろの高い段(y 0.5、z -0.85)、奇数番目が前の低い段(y 0、z 0.75 / 多いとき 1.15)で、互い違い", () => {
    for (const n of [2, 3, 4, 5, 6]) {
      const s = unitSlots(n, "stage");
      expect(s).toHaveLength(n);
      s.forEach((p, i) => {
        const back = i % 2 === 0;
        expect(p.tier).toBe(back ? 1 : 0);
        expect(p.y).toBe(back ? STAGE_RISE : 0);
        expect(p.z).toBe(back ? -0.85 : n > 3 ? 1.15 : 0.75);
      });
    }
    // 横の間隔は 段の間隔の半分
    expect(near(unitSlots(2, "stage")[1].x - unitSlots(2, "stage")[0].x, 1.2)).toBe(true);
    expect(near(unitSlots(4, "stage")[1].x - unitSlots(4, "stage")[0].x, 1.15)).toBe(true);
    expect(near(unitSlots(6, "stage")[1].x - unitSlots(6, "stage")[0].x, 1.025)).toBe(true);
  });
  it("どの並べ方・数でも、左から右へ並び、全体の真ん中が x = 0", () => {
    for (const l of LAYOUTS)
      for (const n of COUNTS) {
        const xs = unitSlots(n, l).map((s) => s.x);
        for (let i = 1; i < n; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1]);
        expect(near(xs.reduce((a, b) => a + b, 0), 0)).toBe(true);
      }
  });
});

describe("立体が重ならない(並べ方 × 単位の数 × 形 × 向き × 台座)", () => {
  const looks: Look[] = [];
  for (const layout of LAYOUTS)
    for (const shape of SHAPES)
      for (const tilt of TILTS)
        for (const base of BASE_IDS) looks.push({ shape, tilt, base, label: "below", bg: "logo", layout });

  it("N = 1〜6 × row / arc / stage × 4 つの形 × 2 つの向き × 5 つの台座の、すべての組み合わせで、床の上の円が重ならない", () => {
    expect(looks).toHaveLength(3 * 4 * 2 * 5);
    for (const look of looks)
      for (const n of COUNTS) {
        const pairs = overlappingPairs(unitFootprints(look, n));
        expect(pairs, `${look.layout}/${look.shape}/${look.tilt}/${look.base} N=${n}`).toEqual([]);
      }
  });
  it("すき間は 0.1 以上ある(いちばん狭い組み合わせでも、円と円のあいだが 0.1 空く)", () => {
    let min = Infinity;
    for (const look of looks)
      for (const n of COUNTS) {
        const fps = unitFootprints(look, n);
        for (let i = 0; i < fps.length; i++) for (let j = i + 1; j < fps.length; j++) min = Math.min(min, Math.hypot(fps[i].x - fps[j].x, fps[i].z - fps[j].z) - fps[i].r - fps[j].r);
      }
    expect(min).toBeGreaterThanOrEqual(0.1);
  });
  it("円の半径は、台・軌道・帯のうちいちばん広いもの。帯がなければ台か軌道", () => {
    for (const base of BASE_IDS) {
      const r = unitFootprintRadius({ shape: "glass", tilt: "flat", base }, 3);
      expect(r).toBe(Math.max(BASES[base].footprint, orbitRadius(3)));
    }
    const withBands = unitFootprintRadius({ shape: "ribbon", tilt: "flat", base: "disc" }, 5);
    expect(withBands).toBeGreaterThan(unitFootprintRadius({ shape: "glass", tilt: "flat", base: "disc" }, 5));
  });
  it("overlappingPairs は、重なる円を見つけ、接するだけの円と離れた円は重なりに数えない", () => {
    expect(overlappingPairs([{ x: 0, z: 0, r: 1 }, { x: 1.5, z: 0, r: 1 }])).toEqual([[0, 1]]);
    expect(overlappingPairs([{ x: 0, z: 0, r: 1 }, { x: 2, z: 0, r: 1 }])).toEqual([]);
    expect(overlappingPairs([{ x: 0, z: 0, r: 1 }, { x: 0, z: 3, r: 1 }])).toEqual([]);
    expect(overlappingPairs([{ x: 0, z: 0, r: 1 }, { x: 1, z: 1, r: 1 }, { x: 5, z: 5, r: 1 }])).toEqual([[0, 1]]);
    expect(overlappingPairs([])).toEqual([]);
  });
  it("ひな壇: 後ろの段の立体は後ろの箱の上に収まり、前の段の立体は箱の手前にある", () => {
    for (const shape of SHAPES)
      for (const tilt of TILTS)
        for (const base of BASE_IDS)
          for (const n of [2, 3, 4, 5, 6]) {
            const look: Look = { shape, tilt, base, label: "below", bg: "logo", layout: "stage" };
            const slots = unitSlots(n, "stage");
            const fps = unitFootprints(look, n);
            const riser = stageRiser(slots);
            expect(riser).not.toBeNull();
            if (!riser) continue;
            slots.forEach((s, i) => {
              const f = fps[i];
              if (s.tier === 1) {
                expect(f.z - f.r).toBeGreaterThanOrEqual(riser.zBack);
                expect(f.z + f.r).toBeLessThanOrEqual(riser.zFront);
                expect(f.x - f.r).toBeGreaterThanOrEqual(riser.x0);
                expect(f.x + f.r).toBeLessThanOrEqual(riser.x1);
              } else {
                expect(f.z - f.r).toBeGreaterThanOrEqual(riser.zFront);
              }
            });
          }
  });
  it("stageRiser: ひな壇でないか、単位が 1 つなら null。幅は両端の立体のまわり 0.95、高さは STAGE_RISE", () => {
    expect(stageRiser(unitSlots(4, "row"))).toBeNull();
    expect(stageRiser(unitSlots(4, "arc"))).toBeNull();
    expect(stageRiser(unitSlots(1, "stage"))).toBeNull();
    expect(stageRiser([])).toBeNull();
    const slots = unitSlots(4, "stage");
    const r = stageRiser(slots);
    expect(r).toEqual({ x0: slots[0].x - 0.95, x1: slots[3].x + 0.95, zBack: -1.6, zFront: -0.1, height: STAGE_RISE });
  });
  it("layoutExtent: 並びの奥行きの真ん中と、半分の幅、大きな楕円の半径(半分の幅 + 1.45)", () => {
    expect(layoutExtent([])).toEqual({ cz: 0, halfX: 0, bigR: 1.45 });
    const row = layoutExtent(unitSlots(3, "row"));
    expect(row.cz).toBe(0);
    expect(near(row.halfX, 1.95)).toBe(true);
    expect(near(row.bigR, 1.95 + 1.45)).toBe(true);
    const stage = layoutExtent(unitSlots(2, "stage"));
    expect(near(stage.cz, (-0.85 + 0.75) / 2)).toBe(true);
  });
});

describe("帯(ロゴの青と金。Box の外を回る)", () => {
  it("帯は 3 本(a・b・a2)", () => {
    expect(bandDefs(0.5, 3).map((b) => b.id)).toEqual(["a", "b", "a2"]);
  });
  it("帯の輪の半径は、Box に外接する球の半径 + すき間以上(N = 1〜6 × 向き)", () => {
    for (const n of COUNTS)
      for (const tilt of TILTS) {
        const s = boxSide(tilt, n);
        const rc = circumRadius(s);
        for (const b of bandDefs(s, n)) {
          expect(b.R, `${tilt} N=${n} ${b.id}`).toBeGreaterThanOrEqual(rc + bandGap(n) - 1e-12);
          expect(b.w).toBeGreaterThan(0);
        }
      }
    expect(bandGap(3)).toBe(0.07);
    expect(bandGap(4)).toBe(0.05);
  });
  it("帯をねじった形で測っても、Box の外接球より内側へ入らない(いちばん近い所が外接球の外に 0.025 以上)", () => {
    for (const n of COUNTS)
      for (const tilt of TILTS) {
        const s = boxSide(tilt, n);
        const rc = circumRadius(s);
        for (const b of bandDefs(s, n)) expect(bandExtent(b).inner - rc, `${tilt} N=${n} ${b.id}`).toBeGreaterThanOrEqual(0.025);
      }
  });
  it("輪の半径のほうが、ねじれと幅を足した最小の距離より大きい(inner は R 以下)", () => {
    for (const b of bandDefs(0.5, 3)) {
      const e = bandExtent(b);
      expect(e.inner).toBeLessThanOrEqual(b.R + 1e-9);
      expect(e.inner).toBeGreaterThan(0);
    }
  });
  it("余裕を見た値(down・wide)は、帯の形を測った値(上下・水平の張り出し)以上", () => {
    for (const n of COUNTS)
      for (const tilt of TILTS) {
        const m = unitMetrics({ shape: "ribbon", tilt, base: "dish" }, n);
        for (const b of m.bands) {
          const e = bandExtent(b);
          expect(e.vertical).toBeLessThanOrEqual(m.down + 1e-9);
          expect(e.reach).toBeLessThanOrEqual(m.wide + 1e-9);
          expect(e.reach).toBeGreaterThan(b.R - 1e-9); // 輪の半径より張り出す(幅の分)
        }
      }
  });
  it("帯は ribbon のときだけ。ほかの形では帯なし(down は Box の高さの半分、wide は 0)", () => {
    for (const shape of ["glass", "solid", "wire"] as const) {
      const m = unitMetrics({ shape, tilt: "vertex", base: "dish" }, 3);
      expect(m.bands).toEqual([]);
      expect(m.down).toBe(m.hh);
      expect(m.wide).toBe(0);
    }
    expect(unitMetrics({ shape: "ribbon", tilt: "vertex", base: "dish" }, 3).bands).toHaveLength(3);
  });
  it("bandExtent はぶれない(回す刻みを細かくしても、ほぼ同じ)", () => {
    const b = bandDefs(0.62, 5)[0];
    const a = bandExtent(b, 24);
    const f = bandExtent(b, 96);
    expect(Math.abs(a.reach - f.reach)).toBeLessThan(0.01);
    expect(Math.abs(a.vertical - f.vertical)).toBeLessThan(0.01);
    expect(a.inner).toBe(f.inner); // 回しても形は変わらない
  });
});

describe("くぼみの台", () => {
  const { top, depth, R } = BASES.dish;
  it("台の数値(試作): 縁の高さ 0.18、くぼみの半径 0.42、真ん中の深さ 0.065", () => {
    expect({ top, depth, R }).toEqual({ top: 0.18, depth: 0.065, R: 0.42 });
  });
  it("真ん中がいちばん低く(縁の高さ - 深さ)、くぼみの縁で縁の高さに戻る", () => {
    expect(near(dishHeight(0), 0.18 - 0.065)).toBe(true);
    expect(near(dishHeight(R), top)).toBe(true);
    expect(near(dishHeight(R / 2), top - depth / 2)).toBe(true);
  });
  it("縁より外は平ら(縁の高さ)。負の距離は同じ高さ", () => {
    for (const r of [R, R + 0.001, 0.47, 1, 100]) expect(dishHeight(r)).toBe(top);
    expect(dishHeight(-0.2)).toBe(dishHeight(0.2));
  });
  it("真ん中から縁へ、なめらかに上がるだけで、下がらない。縁の高さを超えない", () => {
    let prev = dishHeight(0);
    for (let i = 1; i <= 100; i++) {
      const h = dishHeight((i / 100) * R);
      expect(h).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(h).toBeLessThanOrEqual(top + 1e-12);
      prev = h;
    }
  });
  it("真ん中と縁でなだらか(傾きが 0。縁で角が立たない)", () => {
    const e = 1e-4;
    expect((dishHeight(e) - dishHeight(0)) / e).toBeLessThan(1e-3);
    expect((dishHeight(R) - dishHeight(R - e)) / e).toBeLessThan(1e-3);
  });
  it("角を下にした Box の下の角は、くぼみの真ん中より上に浮く", () => {
    for (const n of COUNTS)
      for (const shape of ["glass", "ribbon"] as const) {
        const m = unitMetrics({ shape, tilt: "vertex", base: "dish" }, n);
        const lowest = m.yC - m.hh; // 下の角の高さ(ゆれる前)
        expect(lowest).toBeGreaterThan(dishHeight(0));
        expect(lowest - BOB_AMPLITUDE).toBeGreaterThan(dishHeight(0)); // いちばん下がったときも
      }
  });
  it("正面のある台座は、くぼみの台・2 段の台・石の台。札を台の正面に出せる", () => {
    expect(BASE_IDS.filter(hasFace)).toEqual(["dish", "plinth", "stone"]);
    for (const b of BASE_IDS) expect(hasFace(b)).toBe(BASES[b].face !== null);
  });
});

describe("浮く高さ(yC)", () => {
  it("Box の下は、台の縁の高さ + すき間より上(帯のない形)", () => {
    for (const base of BASE_IDS)
      for (const tilt of TILTS)
        for (const n of COUNTS) {
          const m = unitMetrics({ shape: "glass", tilt, base }, n);
          expect(near(m.yC - m.hh, BASES[base].top + BASES[base].gap)).toBe(true);
        }
  });
  it("帯があるときは、ゆれても帯が台の上の面に 0.07 - ゆれ幅 より近づかない高さまで上げる", () => {
    for (const base of BASE_IDS)
      for (const tilt of TILTS)
        for (const n of COUNTS) {
          const m = unitMetrics({ shape: "ribbon", tilt, base }, n);
          const lowestBand = m.yC - BOB_AMPLITUDE - m.down;
          expect(lowestBand).toBeGreaterThanOrEqual(BASES[base].top + BAND_CLEARANCE - BOB_AMPLITUDE - 1e-9);
          expect(lowestBand).toBeGreaterThan(BASES[base].top); // 台にめり込まない
          // 帯を測った下の張り出しでも、台に届かない
          for (const b of m.bands) expect(m.yC - BOB_AMPLITUDE - bandExtent(b).vertical).toBeGreaterThan(BASES[base].top);
        }
  });
  it("帯のある Box のほうが、帯のない Box より低くはならない", () => {
    for (const base of BASE_IDS)
      for (const tilt of TILTS)
        for (const n of COUNTS) expect(unitMetrics({ shape: "ribbon", tilt, base }, n).yC).toBeGreaterThanOrEqual(unitMetrics({ shape: "glass", tilt, base }, n).yC - 1e-12);
  });
  it("くぼみの台 + 角を下 + ガラスの浮く高さ(パターン 7)は、約 0.18 + 0.13 + 0.433(= 0.743)", () => {
    const m = unitMetrics({ shape: "glass", tilt: "vertex", base: "dish" }, 3);
    expect(near(m.yC, 0.18 + 0.13 + circumRadius(0.5))).toBe(true);
    expect(m.yC).toBeCloseTo(0.743, 3);
  });
});
