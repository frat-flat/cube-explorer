import { describe, expect, it } from "vitest";
import { LOOK_OPTIONS, type Look } from "@/fourdb/core/prefs";
import {
  ARC_K,
  BAND_CLEARANCE,
  BASES,
  BOB_AMPLITUDE,
  bandDefs,
  bandExtent,
  bandGap,
  boxHalfHeight,
  boxSide,
  cameraElevation,
  circumRadius,
  dishHeight,
  formationRows,
  frameHalfWidth,
  hasFace,
  isMany,
  layoutExtent,
  orbitRadius,
  overlappingPairs,
  PERSPECTIVE,
  ROW_DEPTH,
  ROW_GAP,
  stageRiser,
  STAGE_FRONT_Z,
  STAGE_RISE,
  STAGGER,
  TWO_ROW_ELEVATION,
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
    for (const l of LAYOUTS) expect(unitSlots(1, l)).toEqual([{ x: 0, y: 0, z: 0, row: 0, tier: 0 }]);
  });
  it("隊形(formationRows): 1・2・3 は 1 列、4 = 後ろ 2・前 2、5 = 後ろ 2・前 3、6 = 後ろ 3・前 3", () => {
    expect(COUNTS.map(formationRows)).toEqual([
      { back: 0, front: 1 },
      { back: 0, front: 2 },
      { back: 0, front: 3 },
      { back: 2, front: 2 },
      { back: 2, front: 3 },
      { back: 3, front: 3 },
    ]);
    expect(formationRows(0)).toEqual({ back: 0, front: 0 });
    // どの並べ方でも、列の数は隊形のとおり(ひな壇の 3 つだけは、真ん中を後ろの段に上げる)
    for (const l of LAYOUTS)
      for (const n of COUNTS) {
        const s = unitSlots(n, l);
        const { back, front } = l === "stage" && n === 3 ? { back: 1, front: 2 } : formationRows(n);
        expect(s.filter((p) => p.row === 1), `${l} N=${n}`).toHaveLength(back);
        expect(s.filter((p) => p.row === 0), `${l} N=${n}`).toHaveLength(front);
      }
  });
  it("1 列(2 つ・3 つ): となりどうしの間隔は 2 つも 3 つも 1.95(2 つを端まで広げない)。左右対称で、まっすぐ", () => {
    expect(ROW_GAP).toBe(1.95);
    for (const n of [2, 3]) {
      const s = unitSlots(n, "row");
      expect(s).toHaveLength(n);
      for (let i = 0; i < n; i++) {
        expect(near(s[i].x, (i - (n - 1) / 2) * ROW_GAP)).toBe(true);
        expect(s[i]).toMatchObject({ y: 0, z: 0, row: 0, tier: 0 });
      }
    }
  });
  it("2 列(4〜6 つ): 左から 前・後ろ・前… の互い違い(いちばん左は前の列)。前と後ろは横に約 STAGGER ずれる(遠近の直しつき)。床の上でまっすぐ", () => {
    for (const n of [4, 5, 6]) {
      const s = unitSlots(n, "row");
      expect(s.map((p) => p.row)).toEqual(Array.from({ length: n }, (_, i) => i % 2));
      for (const p of s) {
        expect(p.y).toBe(0);
        expect(p.tier).toBe(0);
        expect(p.z).toBe(p.row === 1 ? -ROW_DEPTH / 2 : ROW_DEPTH / 2);
      }
      // 横の位置: (i - 真ん中) × STAGGER を、前の列は (1 - 直し) 倍・後ろの列は (1 + 直し) 倍にして、全体の真ん中を 0 に
      const raw = s.map((_, i) => (i - (n - 1) / 2) * STAGGER * (i % 2 === 1 ? 1 + PERSPECTIVE : 1 - PERSPECTIVE));
      const mean = raw.reduce((a, b) => a + b, 0) / n;
      s.forEach((p, i) => expect(near(p.x, raw[i] - mean)).toBe(true));
      // となりどうし(前と後ろ)の横のずれは、STAGGER の 0.75〜1.25 倍
      for (let i = 1; i < n; i++) {
        const dx = s[i].x - s[i - 1].x;
        expect(dx).toBeGreaterThan(STAGGER * 0.75);
        expect(dx).toBeLessThan(STAGGER * 1.25);
      }
      // 後ろの立体は、左右の前の立体のあいだ(前の列のすきまから見える)
      s.forEach((p, i) => {
        if (p.row === 1) expect(p.x > s[i - 1].x && (i + 1 >= n || p.x < s[i + 1].x)).toBe(true);
      });
    }
    // 遠近の直し: 前の列は詰め、後ろの列は広げる(5 つは左右対称)
    const five = unitSlots(5, "row");
    expect(near(five[0].x, -2 * STAGGER * (1 - PERSPECTIVE))).toBe(true);
    expect(near(five[1].x, -STAGGER * (1 + PERSPECTIVE))).toBe(true);
    expect(near(five[2].x, 0)).toBe(true);
    expect(near(five[0].x, -five[4].x)).toBe(true);
    expect(near(five[1].x, -five[3].x)).toBe(true);
  });
  it("弧: 1 列は z = ARC_K × x²。2 列は列ごとに、その列の真ん中から左右へ手前に曲がる(列ごとに左右対称)。横の位置は 1 列と同じ", () => {
    for (const n of COUNTS) expect(unitSlots(n, "arc").map((s) => s.x)).toEqual(unitSlots(n, "row").map((s) => s.x));
    for (const p of unitSlots(3, "arc")) expect(near(p.z, ARC_K * p.x * p.x)).toBe(true);
    const three = unitSlots(3, "arc");
    expect(three[0].z).toBeGreaterThan(three[1].z); // 左右の端ほど手前
    expect(near(three[0].z, three[2].z)).toBe(true);
    for (const n of [4, 5, 6]) {
      const s = unitSlots(n, "arc");
      for (const row of [0, 1] as const) {
        const own = s.filter((p) => p.row === row);
        const mid = own.reduce((a, p) => a + p.x, 0) / own.length;
        const z0 = row === 1 ? -ROW_DEPTH / 2 : ROW_DEPTH / 2;
        for (const p of own) expect(near(p.z, z0 + ARC_K * (p.x - mid) ** 2)).toBe(true);
        // 列の両端は同じ奥行き(左右対称の弧)
        expect(near(own[0].z, own[own.length - 1].z)).toBe(true);
      }
    }
  });
  it("ひな壇: 1 つ・2 つは 1 列と同じ(段なし)。3 つは真ん中だけを後ろの段に上げる。4〜6 つは後ろの列を段(y 0.5、z -0.85)、前の列を床(z 0.85)に", () => {
    for (const n of [1, 2]) expect(unitSlots(n, "stage")).toEqual(unitSlots(n, "row"));
    const three = unitSlots(3, "stage");
    expect(three.map((p) => p.tier)).toEqual([0, 1, 0]);
    expect(three[1]).toMatchObject({ y: STAGE_RISE, z: -0.85, row: 1 });
    expect(near(three[1].x, 0)).toBe(true);
    for (const p of [three[0], three[2]]) expect(p).toMatchObject({ y: 0, z: STAGE_FRONT_Z, row: 0 });
    for (const n of [4, 5, 6]) {
      const s = unitSlots(n, "stage");
      expect(s.map((p) => p.x)).toEqual(unitSlots(n, "row").map((p) => p.x));
      s.forEach((p, i) => {
        const back = i % 2 === 1;
        expect(p).toMatchObject({ y: back ? STAGE_RISE : 0, z: back ? -0.85 : STAGE_FRONT_Z, row: back ? 1 : 0, tier: back ? 1 : 0 });
      });
    }
  });
  it("どの並べ方・数でも、左から右へ並び(札の順・キーボードの順は画面の左から右)、全体の真ん中が x = 0", () => {
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
  it("2 列の隊形(4〜6 つ)は、同じ列のとなりどうしも、前と後ろも、円が 0.1 以上離れる(3 つの形・すべての向きと台座で)", () => {
    for (const look of looks)
      for (const n of [4, 5, 6]) {
        const slots = unitSlots(n, look.layout);
        const fps = unitFootprints(look, n);
        for (let i = 0; i < n; i++)
          for (let j = i + 1; j < n; j++) {
            const gap = Math.hypot(fps[i].x - fps[j].x, fps[i].z - fps[j].z) - fps[i].r - fps[j].r;
            expect(gap, `${look.layout}/${look.shape}/${look.tilt}/${look.base} N=${n} ${i}(${slots[i].row})-${j}(${slots[j].row})`).toBeGreaterThanOrEqual(0.1);
          }
      }
  });
  it("ひな壇: 後ろの段の立体は後ろの箱の上に収まり、前の段の立体は箱の手前にある(3 つ〜6 つ)", () => {
    for (const shape of SHAPES)
      for (const tilt of TILTS)
        for (const base of BASE_IDS)
          for (const n of [3, 4, 5, 6]) {
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
  it("stageRiser: ひな壇でないか、後ろの段がない(単位が 1 つ・2 つ)なら null。幅は両端の立体のまわり 0.95、高さは STAGE_RISE", () => {
    expect(stageRiser(unitSlots(4, "row"))).toBeNull();
    expect(stageRiser(unitSlots(4, "arc"))).toBeNull();
    expect(stageRiser(unitSlots(1, "stage"))).toBeNull();
    expect(stageRiser(unitSlots(2, "stage"))).toBeNull();
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
    const stage = layoutExtent(unitSlots(4, "stage"));
    expect(near(stage.cz, (-0.85 + STAGE_FRONT_Z) / 2)).toBe(true);
    const two = layoutExtent(unitSlots(6, "row"));
    expect(near(two.cz, 0)).toBe(true);
  });
  it("frameHalfWidth: 2 つ以上は 3 つの 1 列(間隔 1.95 + 軌道 0.72)より狭く写さない。1 つは 0。5 つ・6 つは並びのほうが広い", () => {
    expect(frameHalfWidth(0)).toBe(0);
    expect(frameHalfWidth(1)).toBe(0);
    for (const n of [2, 3, 4, 5, 6]) expect(frameHalfWidth(n)).toBe(ROW_GAP + orbitRadius(3));
    const own = (n: number) => Math.max(...unitSlots(n, "row").map((s) => Math.abs(s.x))) + orbitRadius(n);
    expect(own(2)).toBeLessThan(frameHalfWidth(2));
    expect(own(4)).toBeLessThan(frameHalfWidth(4));
    expect(near(own(3), frameHalfWidth(3))).toBe(true);
    expect(own(5)).toBeGreaterThan(frameHalfWidth(5));
    expect(own(6)).toBeGreaterThan(frameHalfWidth(6));
  });
  it("cameraElevation: 1 列はふつう 0.15、ひな壇・くぼみの台は 0.27。2 列の隊形は 0.32 以上(後ろの列が前の列の上に見える)", () => {
    const l = (layout: Look["layout"], base: Look["base"]) => ({ layout, base });
    for (const n of [1, 2, 3]) {
      expect(cameraElevation(l("row", "ring"), n)).toBe(0.15);
      expect(cameraElevation(l("arc", "plinth"), n)).toBe(0.15);
      expect(cameraElevation(l("stage", "ring"), n)).toBe(0.27);
      expect(cameraElevation(l("row", "dish"), n)).toBe(0.27);
    }
    for (const n of [4, 5, 6])
      for (const layout of LAYOUTS) for (const base of BASE_IDS) expect(cameraElevation(l(layout, base), n)).toBe(TWO_ROW_ELEVATION);
    expect(TWO_ROW_ELEVATION).toBeGreaterThanOrEqual(0.27);
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
