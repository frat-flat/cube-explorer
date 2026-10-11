// 単位の数ごとの隊形を、本物のカメラの収め方(Framer)で写したときの試験。three の数の部品だけを使う(描かない・DOM なし)。
// 札の大きさは、本物の画面で測った大きさに近い代わりの値(札は画面が描くので、ここでは測れない)。
import { describe, expect, it } from "vitest";
import { Group, PerspectiveCamera } from "three";
import { LOOK_OPTIONS, type Look } from "@/fourdb/core/prefs";
import { Framer, LABEL_SCALES, MARGIN, focusShift, freeRects, largest, rectH, rectW, type Rect } from "./framing";
import { BASES, formationRows } from "./layout";
import { cameraFrame, type SceneModel } from "./scene";
import { placeUnit } from "./unit";

const COUNTS = [1, 2, 3, 4, 5, 6] as const;
/** 舞台(ホームの section)の大きさ: 画面の大きさから上の帯(52px)を除いたもの */
const STAGES = [
  { name: "1280×800", W: 1280, H: 748 },
  { name: "1024×700", W: 1024, H: 648 },
] as const;
/** 右の欄の幅(px。home3d.module.css の .bpanel) */
const PANEL_W = 392;

/**
 * 倍率 k のときの札の大きさの代わり(本物の画面で測った値に、長めの名前の分を足したもの)。4 つ以上は札が小さい(.many)。
 * 台の下の札: 元の大きさ(k = 1)では最小の幅(132px・多いとき 112px)、小さくするときは名前と数の幅だけ(5 文字の名前で 92px × k。CSS の min-width)
 */
function labelSize(mode: Look["label"], n: number, k = 1): [number, number] {
  const many = n > 3;
  if (mode === "float") return many ? [110 * k, 32 * k] : [116 * k, 35 * k];
  const content = 92 * k;
  const minWidth = k >= 1 ? (many ? 112 : 132) : 0;
  return [Math.max(minWidth, content), (many ? 64 : 69) * k];
}

/** 札が重なるときに試す倍率(stage.ts と同じ) */
const scalesOf = (look: Look) => (look.label === "float" ? LABEL_SCALES.float : LABEL_SCALES.below);

function framerFor(look: Look, n: number, W: number, H: number) {
  const fr = cameraFrame(look, n);
  const units = fr.slots.map((slot, i) => {
    const g = placeUnit(new Group(), slot);
    g.updateMatrixWorld();
    return { i, slot, g, m: fr.metrics };
  });
  const model = { target: fr.target, extraPoints: fr.extraPoints, framePoints: fr.framePoints, base: BASES[look.base], orbit: fr.orbit, units } as unknown as SceneModel;
  const framer = new Framer(new PerspectiveCamera(16, W / H, 0.1, 600), model);
  framer.W = W;
  framer.H = H;
  framer.elevation = fr.elevation;
  framer.labelMode = look.label;
  /** 札の大きさを倍率 k で入れ直す(画面が札を計り直すのの代わり) */
  const resize = (k: number) => {
    const [w, h] = labelSize(look.label, n, k);
    framer.sizes = units.map(() => [w, h]);
    framer.LW = w;
    framer.LH = h;
  };
  resize(1);
  return { framer, fr, resize };
}

/** QA が見た見た目(パターン 3・6・7)と、台の下の札のほかの形 */
const QA_LOOKS: Record<string, Look> = {
  p3: { shape: "ribbon", tilt: "flat", base: "ring", label: "float", bg: "logo", layout: "arc" },
  p6: { shape: "ribbon", tilt: "flat", base: "plinth", label: "below", bg: "logo", layout: "stage" },
  p7: { shape: "glass", tilt: "vertex", base: "dish", label: "below", bg: "logo", layout: "row" },
};

/** 舞台の余白を除いた所と、右の欄(開いていれば)をよけた候補 */
function areaOf(W: number, H: number, panel: boolean) {
  const area: Rect = { x0: MARGIN.l, y0: MARGIN.t, x1: W - MARGIN.r, y1: H - MARGIN.b };
  const occ: Rect[] = panel ? [{ x0: W - PANEL_W, y0: 0, x1: W, y1: H }] : [];
  return { area, rects: freeRects(area, occ) };
}

const looks = (label: Look["label"]): Look[] => {
  const out: Look[] = [];
  for (const layout of LOOK_OPTIONS.layout)
    for (const shape of LOOK_OPTIONS.shape) for (const tilt of LOOK_OPTIONS.tilt) for (const base of LOOK_OPTIONS.base) out.push({ shape, tilt, base, label, bg: "logo", layout });
  return out;
};

describe("隊形を写したとき(欄を開いていない舞台。stage.ts と同じ Framer.plan)", () => {
  for (const st of STAGES)
    for (const label of ["float", "below"] as const) {
      it(`${st.name}・札が ${label}: N = 1〜6 × 並べ方 × 形 × 向き × 台座で、札どうしが重ならず、後ろの列の札が前の列の立体にかからず、全部が舞台に収まる`, () => {
        const { area, rects } = areaOf(st.W, st.H, false);
        const bad: string[] = [];
        let tight = 0;
        for (const look of looks(label))
          for (const n of COUNTS) {
            const { framer, resize } = framerFor(look, n, st.W, st.H);
            framer.floor(area);
            const { fit, focus, k, loose } = framer.plan(area, rects, false, -1, resize, scalesOf(look));
            const b = framer.bounds(fit.d);
            if (fit.clash || loose || focus >= 0 || rectW(b) > rectW(area) + 0.5 || rectH(b) > rectH(area) + 0.5) bad.push(`${look.layout}/${look.shape}/${look.tilt}/${look.base} N=${n}`);
            if (k < 1) tight++;
          }
        expect(bad).toEqual([]);
        // 札を小さめにするのは、一部の組み合わせだけ(多くは札の大きさのまま)
        expect(tight).toBeLessThan(looks(label).length * COUNTS.length * 0.25);
      });
    }
});

describe("右の欄を開いたとき(空いている所に収める。stage.ts と同じ Framer.plan)", () => {
  for (const st of STAGES)
    for (const label of ["float", "below"] as const) {
      it(`${st.name}・札が ${label}: 帯つきの 3 つの並べ方 × N = 1〜6 × 選んだ Box で、全部が欄の左に収まるか、収まらなければ選んだ Box ととなりが欄に隠れない`, () => {
        const { area, rects } = areaOf(st.W, st.H, true);
        const free = largest(rects);
        // 欄に隠れない = 舞台の左の端と、欄の左の端のあいだ
        const inside = (r: Rect) => r.x0 >= 0 && r.x1 <= st.W - PANEL_W;
        const bad: string[] = [];
        for (const layout of LOOK_OPTIONS.layout)
          for (const n of COUNTS)
            for (let sel = 0; sel < n; sel++) {
              const look: Look = { shape: "ribbon", tilt: "flat", base: "ring", label, bg: "logo", layout };
              const { framer, resize } = framerFor(look, n, st.W, st.H);
              framer.floor(area);
              const { fit, focus, loose } = framer.plan(area, rects, true, sel, resize, scalesOf(look));
              const b = framer.bounds(fit.d);
              if (fit.clash && !loose) bad.push(`${layout} N=${n} 選んだ ${sel}: 札が重なる`);
              if (framer.labelsClash(fit.d, false)) bad.push(`${layout} N=${n} 選んだ ${sel}: 札どうしが重なる`);
              if (rectH(b) > rectH(free) + 0.5) bad.push(`${layout} N=${n} 選んだ ${sel}: 上下にはみ出す`);
              if (focus < 0) {
                if (rectW(b) > rectW(free) + 0.5) bad.push(`${layout} N=${n} 選んだ ${sel}: 横にはみ出す`);
                continue;
              }
              // 寄せたとき: 選んだ Box ととなり(札・台座・Box と帯)が、欄に隠れない
              const units = framer.model.units;
              const ox = focusShift(b, fit.r, framer.labelAt(units[sel]).px);
              for (const j of [sel - 1, sel, sel + 1].filter((j) => j >= 0 && j < n)) {
                const L = framer.labelAt(units[j]);
                const [w] = framer.sizes[j];
                const s = framer.solid(units[j]);
                const shifted = (r: Rect): Rect => ({ ...r, x0: r.x0 - ox, x1: r.x1 - ox });
                const parts = [{ x0: L.px - w / 2, y0: 0, x1: L.px + w / 2, y1: 0 }, s.ped, { x0: s.cx - s.r, y0: s.ya - s.r, x1: s.cx + s.r, y1: s.yb + s.r }];
                if (!parts.every((p) => inside(shifted(p)))) bad.push(`${layout} N=${n} 選んだ ${sel}: ${j} が欄に隠れる`);
              }
            }
        expect(bad).toEqual([]);
      });
    }
});

describe("右の欄を開いたとき、札を読める大きさまで小さくして全部を収める(QA の M-1)", () => {
  /** QA の 3 つと、札が台の下のほかの形(帯つき・角を下・くぼみの台 / つや消しなし・面を下・2 段の台 / 線と点・床の円盤・床の格子) */
  const looksAll: Record<string, Look> = {
    ...QA_LOOKS,
    p8: { shape: "ribbon", tilt: "vertex", base: "dish", label: "below", bg: "logo", layout: "row" },
    p1: { shape: "glass", tilt: "flat", base: "plinth", label: "below", bg: "logo", layout: "row" },
    p4: { shape: "wire", tilt: "flat", base: "disc", label: "below", bg: "grid", layout: "row" },
  };
  for (const st of STAGES)
    it(`${st.name}: パターン 1・3・4・6・7・8 は N = 1〜6 のいちばん左・右の Box を選んでも、全部の札と立体が欄の左に収まり、札どうしが重ならない(選んだ Box へ寄せない)`, () => {
      const { area, rects } = areaOf(st.W, st.H, true);
      const free = largest(rects);
      const bad: string[] = [];
      const used: string[] = [];
      for (const [key, look] of Object.entries(looksAll))
        for (const n of COUNTS)
          for (const sel of n === 1 ? [0] : [0, n - 1]) {
            const { framer, resize } = framerFor(look, n, st.W, st.H);
            framer.floor(area);
            const { fit, focus, k, loose } = framer.plan(area, rects, true, sel, resize, scalesOf(look));
            const b = framer.bounds(fit.d);
            const id = `${key}-${st.name}-N${n}`;
            if (k < 1 || loose) used.push(`${id}:${loose ? "立体にかかる・" : ""}${k}`);
            if (focus >= 0) {
              bad.push(`${id} 選んだ ${sel}: 全部は収まらず寄せた`);
              continue;
            }
            if (rectW(b) > rectW(free) + 0.5 || rectH(b) > rectH(free) + 0.5) bad.push(`${id} 選んだ ${sel}: 空いている所からはみ出す`);
            if (framer.labelsClash(fit.d, false)) bad.push(`${id} 選んだ ${sel}: 札どうしが重なる`);
            // 札が立体にかかるのを許すのは、ひな壇(後ろの段の札が前の列の帯の高さに来る)だけ
            if (loose && look.layout !== "stage") bad.push(`${id} 選んだ ${sel}: 札が立体にかかる`);
            // 札は読める大きさより小さくしない
            expect(k).toBeGreaterThanOrEqual(scalesOf(look)[scalesOf(look).length - 1]);
          }
      expect(bad).toEqual([]);
      // 札を小さくする・立体にかかるのを許すのは、2 列の隊形(4〜6 つ)だけ。1〜3 つは札の大きさのまま
      expect(used.filter((u) => /-N[123]:/.test(u))).toEqual([]);
    });
  it("札の大きさの下限: 台の下の札は 0.72(名前 14px → 約 10px)、Box の上の札は 0.8(名前 12.5px → 10px)", () => {
    expect(LABEL_SCALES.below).toEqual([1, 0.8, 0.72]);
    expect(LABEL_SCALES.float).toEqual([1, 0.8]);
    expect(14 * LABEL_SCALES.below[2]).toBeGreaterThanOrEqual(10);
    expect(28 * LABEL_SCALES.below[2]).toBeGreaterThanOrEqual(14);
    expect(12.5 * LABEL_SCALES.float[1]).toBeGreaterThanOrEqual(10);
    expect(19 * LABEL_SCALES.float[1]).toBeGreaterThanOrEqual(14);
  });
  it("plan: 札の倍率は大きい順に試し、重ならないいちばん大きな倍率で止まる(元の大きさで収まれば小さくしない)", () => {
    const { framer, resize } = framerFor(QA_LOOKS.p7, 6, 1024, 648);
    const { area, rects } = areaOf(1024, 648, true);
    framer.floor(area);
    const tried: number[] = [];
    const r = framer.plan(area, rects, true, 0, (k) => {
      tried.push(k);
      resize(k);
    }, LABEL_SCALES.below);
    expect(r.focus).toBe(-1);
    // 元の大きさでは重なるので小さくし、重ならなくなったところで止まる(それより小さくは試さない)
    expect(r.k).toBeLessThan(1);
    expect(tried).toEqual(LABEL_SCALES.below.slice(1, LABEL_SCALES.below.indexOf(r.k as 0.8 | 0.72) + 1));
    const closed = framerFor(QA_LOOKS.p7, 6, 1280, 748);
    const a2 = areaOf(1280, 748, false);
    closed.framer.floor(a2.area);
    const none: number[] = [];
    expect(closed.framer.plan(a2.area, a2.rects, false, -1, (k) => none.push(k), LABEL_SCALES.below).k).toBe(1);
    expect(none).toEqual([]);
  });
});

describe("隊形の枠(Framer.floor): 欄のない舞台で、2 つ・4 つを 3 つより大きく写さない", () => {
  const look: Look = { shape: "ribbon", tilt: "flat", base: "ring", label: "float", bg: "logo", layout: "arc" };
  /** 収めたときの、いちばん左の立体の大きさ(px / 1)と、左の 2 つの札の横の間隔(px) */
  function measure(n: number, W: number, H: number, panel = false) {
    const { framer, resize } = framerFor(look, n, W, H);
    const { area, rects } = areaOf(W, H, panel);
    framer.floor(area);
    const { fit } = framer.plan(area, rects, panel, panel ? 0 : -1, resize, scalesOf(look));
    framer.bounds(fit.d);
    const u = framer.model.units[0];
    const scale = Math.abs(framer.proj(u, 1, u.m.yC, 0)[0] - framer.proj(u, 0, u.m.yC, 0)[0]);
    const gap = n > 1 ? framer.labelAt(framer.model.units[1]).px - framer.labelAt(u).px : 0;
    return { scale, gap };
  }
  for (const st of STAGES)
    it(`${st.name}: 2 つは 3 つと同じ大きさ・間隔(端まで広げない)。4 つの前の列は 3 つより大きくない。1 つは枠なし`, () => {
      const three = measure(3, st.W, st.H);
      const two = measure(2, st.W, st.H);
      const four = measure(4, st.W, st.H);
      expect(Math.abs(two.scale / three.scale - 1)).toBeLessThan(0.03);
      expect(Math.abs(two.gap / three.gap - 1)).toBeLessThan(0.05);
      expect(four.scale).toBeLessThanOrEqual(three.scale * 1.01);
      // 1 つには枠がない(いちばん近くまで寄る)
      expect(measure(1, st.W, st.H).scale).toBeGreaterThan(three.scale);
    });
  it("右の欄を開いて空いている所が狭いときは、枠は効かない(2 つは 3 つより大きく写る)", () => {
    expect(measure(2, 1280, 748, true).scale).toBeGreaterThan(measure(3, 1280, 748, true).scale);
  });
});

describe("formationRows と並べる場所の順(札の順・キーボードの順)", () => {
  it("2 列の隊形は、いちばん左が前の列で、前・後ろ・前… と互い違いに左から並ぶ", () => {
    for (const n of [4, 5, 6]) {
      const { fr } = framerFor({ shape: "ribbon", tilt: "flat", base: "ring", label: "float", bg: "logo", layout: "arc" }, n, 1280, 748);
      expect(fr.slots.map((s) => s.row)).toEqual(Array.from({ length: n }, (_, i) => i % 2));
      const { back, front } = formationRows(n);
      expect(fr.slots.filter((s) => s.row === 1)).toHaveLength(back);
      expect(fr.slots.filter((s) => s.row === 0)).toHaveLength(front);
    }
  });
});

describe("focusShift(欄を開いて全部は収まらないとき、選んだ Box へ寄せる)", () => {
  const r: Rect = { x0: 30, y0: 66, x1: 600, y1: 700 }; // 空いている所(真ん中 315)
  it("中身が空いている所に収まるなら、選んだ Box によらず真ん中に置く", () => {
    const b: Rect = { x0: 100, y0: 100, x1: 400, y1: 600 };
    expect(focusShift(b, r, 120)).toBe(250 - 315);
    expect(focusShift(b, r, null)).toBe(250 - 315);
  });
  it("選んだ Box がなければ、中身の真ん中を空いている所の真ん中に", () => {
    const b: Rect = { x0: 0, y0: 100, x1: 1200, y1: 600 };
    expect(focusShift(b, r, null)).toBe(600 - 315);
  });
  it("収まらないとき: 選んだ Box を真ん中へ寄せる", () => {
    const b: Rect = { x0: 0, y0: 100, x1: 1200, y1: 600 };
    expect(focusShift(b, r, 600)).toBe(600 - 315);
  });
  it("左の端の Box を選んでも、左に何もない所を作らない(中身の左の端を空いている所の左の端に)", () => {
    const b: Rect = { x0: 0, y0: 100, x1: 1200, y1: 600 };
    const ox = focusShift(b, r, 60);
    expect(ox).toBe(b.x0 - r.x0);
    expect(b.x0 - ox).toBe(r.x0);
    expect(60 - ox).toBeGreaterThanOrEqual(r.x0); // 選んだ Box は空いている所の中
  });
  it("右の端の Box を選んでも、右に何もない所を作らない", () => {
    const b: Rect = { x0: 0, y0: 100, x1: 1200, y1: 600 };
    const ox = focusShift(b, r, 1150);
    expect(ox).toBe(b.x1 - r.x1);
    expect(b.x1 - ox).toBe(r.x1);
    expect(1150 - ox).toBeLessThanOrEqual(r.x1);
  });
});

describe("Framer.labelsClash: 後ろの列の札と前の列の立体", () => {
  it("後ろの列の札が前の列の立体にかかれば重なりとみなし、かからなければみなさない(札どうしは離れている場合)", () => {
    const look: Look = { shape: "glass", tilt: "flat", base: "plinth", label: "below", bg: "logo", layout: "row" };
    const { framer } = framerFor(look, 4, 1280, 748);
    const d = framer.choose([{ x0: 30, y0: 66, x1: 1250, y1: 722 }]).d;
    expect(framer.labelsClash(d)).toBe(false);
    // 後ろの列の札だけを、とても広くする(前の列の立体にかかる)。札どうしは上下にずれていて重ならない高さ
    framer.sizes = framer.model.units.map((u) => (u.slot.row === 1 ? [900, 10] : [10, 10]));
    expect(framer.labelsClash(d)).toBe(true);
  });
  it("1 列の隊形では、立体と札の重なりは見ない(札どうしだけ)", () => {
    const look: Look = { shape: "glass", tilt: "flat", base: "plinth", label: "below", bg: "logo", layout: "arc" };
    const { framer } = framerFor(look, 3, 1280, 748);
    const d = framer.choose([{ x0: 30, y0: 66, x1: 1250, y1: 722 }]).d;
    framer.sizes = [[10, 10], [10, 10], [10, 10]];
    expect(framer.labelsClash(d)).toBe(false);
  });
});
