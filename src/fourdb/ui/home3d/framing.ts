// カメラの収め方: 立体と札が、空いている所(右の欄・Visual の欄をよけた所)に収まり、札どうしが重ならない距離と位置を、計って決める。
// 試作の bounds・labelsClash・fitD・fitIn を、欄を「よける四角」の一般の形にしたもの。
import { MathUtils, Vector3, type PerspectiveCamera } from "three";
import type { Look } from "@/fourdb/core/prefs";
import type { SceneModel } from "./scene";
import type { Unit } from "./unit";

export type Rect = { x0: number; y0: number; x1: number; y1: number };
export type Fit = { d: number; r: Rect; clash: boolean };

/** 舞台の縁の余白(px)。上は舞台の見出しの分 */
export const MARGIN = { l: 30, r: 30, t: 66, b: 26 } as const;
/** よける四角とのすき間(横・縦) */
const GAP_X = 16;
const GAP_Y = 12;
/** 空いている所として使う最小の大きさ */
const MIN_W = 260;
const MIN_H = 220;
/** 札どうしのあいだに、少なくともこれだけあける(px) */
const LABEL_GAP = 6;
/** 大きくなりすぎない(台の足もとで 1 単位 = この px まで) */
const MAX_PX_PER_UNIT = 255;

export const rectW = (r: Rect) => r.x1 - r.x0;
export const rectH = (r: Rect) => r.y1 - r.y0;
const overlaps = (a: Rect, b: Rect) => a.x1 > b.x0 && b.x1 > a.x0 && a.y1 > b.y0 && b.y1 > a.y0;

/** area から、よける四角(occ)を避けて取れる四角の候補(どれも MIN_W × MIN_H 以上)。取れなければ area だけ */
export function freeRects(area: Rect, occ: readonly Rect[]): Rect[] {
  let rects: Rect[] = [area];
  for (const o of occ) {
    if (!overlaps(o, area)) continue;
    const next: Rect[] = [];
    for (const r of rects) {
      if (!overlaps(o, r)) {
        next.push(r);
        continue;
      }
      next.push(
        { ...r, x1: Math.min(r.x1, o.x0 - GAP_X) }, // 左
        { ...r, y1: Math.min(r.y1, o.y0 - GAP_Y) }, // 上
        { ...r, x0: Math.max(r.x0, o.x1 + GAP_X) }, // 右
        { ...r, y0: Math.max(r.y0, o.y1 + GAP_Y) }, // 下
      );
    }
    rects = next;
  }
  const ok = rects.filter((r) => rectW(r) >= MIN_W && rectH(r) >= MIN_H);
  return ok.length ? ok : [area];
}

export const largest = (rects: readonly Rect[]): Rect => rects.reduce((a, b) => (rectW(b) * rectH(b) > rectW(a) * rectH(a) ? b : a));

/** 札の置き方ごとの、札の基準の点: below = 札の上の中央、front = 札の中央、float = 札の下の中央 */
export type LabelPoint = { px: number; py: number; faceH: number };

export class Framer {
  W = 1;
  H = 1;
  fovDeg = 16;
  /** 見下ろす角度(rad)。場面の値(世界の中ではその世界の値) */
  elevation = 0.15;
  labelMode: Look["label"] = "below";
  /** 札のいちばん大きな幅・高さ(px)。書体が読み込まれたら計り直す */
  LW = 140;
  LH = 100;
  /** 札ごとの幅・高さ(px) */
  sizes: [number, number][] = [];
  private v3 = new Vector3();

  constructor(
    readonly camera: PerspectiveCamera,
    public model: SceneModel,
  ) {}

  /** 見る点から距離 d・横の向き yaw・見下ろす角度 el にカメラを置く */
  place(d: number, yaw: number, el: number): void {
    const t = this.model.target;
    this.camera.position.set(t.x + Math.sin(yaw) * Math.cos(el) * d, t.y + Math.sin(el) * d, t.z + Math.cos(yaw) * Math.cos(el) * d);
    this.camera.lookAt(t);
  }

  /** 世界の点を画面の px に(今のカメラで) */
  toPx(v: Vector3): [number, number] {
    v.project(this.camera);
    return [(v.x * 0.5 + 0.5) * this.W, (-v.y * 0.5 + 0.5) * this.H];
  }

  /** 単位の台の足もとからの位置(lx, ly, lz)を、画面の px に */
  proj(u: Unit, lx: number, ly: number, lz: number): [number, number] {
    this.v3.set(lx, ly, lz);
    u.g.localToWorld(this.v3);
    return this.toPx(this.v3);
  }

  labelAt(u: Unit, liftY = u.m.yC): LabelPoint {
    const B = this.model.base;
    if (this.labelMode === "front" && B.face) {
      const F = B.face;
      const [px, py] = this.proj(u, 0, F.y, F.z + 0.004);
      const top = this.proj(u, 0, F.y + F.h / 2, F.z)[1];
      const bot = this.proj(u, 0, F.y - F.h / 2, F.z)[1];
      return { px, py, faceH: Math.abs(bot - top) };
    }
    if (this.labelMode === "float") {
      const [px, py] = this.proj(u, 0, liftY + u.m.down + 0.25, 0);
      return { px, py, faceH: 0 };
    }
    const px = this.proj(u, 0, 0, 0)[0];
    const py = this.proj(u, 0, 0, this.model.orbit + 0.04)[1] + 10;
    return { px, py, faceH: 0 };
  }

  /** 距離 d のとき(ずらしなし)の、立体と札の外側の四角(px) */
  bounds(d: number): Rect {
    const cam = this.camera;
    cam.clearViewOffset();
    this.place(d, 0, this.elevation);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    const b: Rect = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    const add = ([X, Y]: [number, number]) => {
      b.x0 = Math.min(b.x0, X);
      b.x1 = Math.max(b.x1, X);
      b.y0 = Math.min(b.y0, Y);
      b.y1 = Math.max(b.y1, Y);
    };
    const { orbit } = this.model;
    for (const u of this.model.units) {
      add(this.proj(u, -orbit, 0, 0));
      add(this.proj(u, orbit, 0, 0));
      add(this.proj(u, 0, 0, orbit));
      add(this.proj(u, 0, u.m.yC + u.m.down + 0.26, 0));
      if (u.m.wide) {
        add(this.proj(u, -u.m.wide, u.m.yC, 0));
        add(this.proj(u, u.m.wide, u.m.yC, 0));
      }
      const L = this.labelAt(u);
      if (this.labelMode === "below") {
        add([L.px - this.LW / 2, L.py + this.LH]);
        add([L.px + this.LW / 2, L.py]);
      } else if (this.labelMode === "float") {
        add([L.px - this.LW / 2, L.py - this.LH]);
        add([L.px + this.LW / 2, L.py]);
      }
    }
    for (const p of this.model.extraPoints) add(this.toPx(this.v3.copy(p)));
    return b;
  }

  /** 距離 d のとき、札どうしが重なるか(札の実際の大きさで。台の正面のときは見ない) */
  labelsClash(d: number): boolean {
    if (this.labelMode === "front") return false;
    this.bounds(d);
    const R = this.model.units.map((u) => {
      const L = this.labelAt(u);
      const [w, h] = this.sizes[u.i] ?? [this.LW, this.LH];
      return this.labelMode === "float" ? [L.px - w / 2, L.py - h, L.px + w / 2, L.py] : [L.px - w / 2, L.py, L.px + w / 2, L.py + h];
    });
    const G = LABEL_GAP;
    return R.some((a, i) => R.some((b, j) => j > i && a[2] + G > b[0] && b[2] + G > a[0] && a[3] + G > b[1] && b[3] + G > a[1]));
  }

  /** 幅 availW・高さ availH に収まる、いちばん近い距離 */
  fitD(availW: number, availH: number): number {
    const tanH = Math.tan(MathUtils.degToRad(this.fovDeg / 2));
    const dMin = this.H / (MAX_PX_PER_UNIT * 2 * tanH);
    const fits = (d: number) => {
      const b = this.bounds(d);
      return rectW(b) <= availW && rectH(b) <= availH;
    };
    if (fits(dMin)) return dMin;
    let lo = dMin;
    let hi = dMin * 40;
    for (let k = 0; k < 28; k++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    return hi;
  }

  /** 候補の四角のうち、札が重ならないものを先に、同じなら大きく見えるもの(距離が近いもの)を選ぶ */
  choose(rects: readonly Rect[]): Fit {
    let best: Fit | null = null;
    for (const r of rects) {
      const d = this.fitD(rectW(r), rectH(r));
      const clash = this.labelsClash(d);
      if (!best || (best.clash && !clash) || (best.clash === clash && d < best.d - 1e-6)) best = { d, r, clash };
    }
    return best ?? { d: 8, r: rects[0], clash: false };
  }
}
