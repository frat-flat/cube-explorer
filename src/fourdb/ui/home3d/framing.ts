// カメラの収め方: 立体と札が、空いている所(右の欄・Visual の欄をよけた所)に収まり、札どうしが重ならない距離と位置を、計って決める。
// 試作の bounds・labelsClash・fitD・fitIn を、欄を「よける四角」の一般の形にしたもの。
import { MathUtils, Vector3, type PerspectiveCamera } from "three";
import type { Look } from "@/fourdb/core/prefs";
import { BOB_AMPLITUDE, HOVER_LIFT, circumRadius } from "./layout";
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
/**
 * 札が重なるときに試す、札の大きさの倍率(大きい順。stage.ts が札の --k に書く)。最後は読める大きさの下限(名前 10px・数 14px ほど):
 * 台の下の札(と台の正面から台の下にした札)は名前 14px・数 28〜34px なので 0.72(名前 約 10px)まで、Box の上の札は名前 12.5px・数 19〜21px なので 0.8(名前 10px)まで
 */
export const LABEL_SCALES = { below: [1, 0.8, 0.72], float: [1, 0.8] } as const;
/** Box が上下にゆれる・ポインターで持ち上がる分(立体がふさぐ四角に足す) */
const BOB = BOB_AMPLITUDE + HOVER_LIFT;

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

/** 単位の立体が画面でふさぐ所(px): ped = 台座の四角、Box と帯 = 横の位置 cx・縦 ya〜yb(ゆれの分)の線分のまわり半径 r の円(カプセル) */
export type Solid = { ped: Rect; cx: number; ya: number; yb: number; r: number };

/** 四角(札)が、立体(台座の四角か、Box と帯のカプセル)にかかるか。接するだけはかからない */
export function hitsSolid(a: Rect, s: Solid): boolean {
  if (overlaps(a, s.ped)) return true;
  const dx = Math.max(a.x0 - s.cx, 0, s.cx - a.x1);
  const dy = Math.max(a.y0 - s.yb, 0, s.ya - a.y1);
  return Math.hypot(dx, dy) < s.r;
}

/**
 * 横のずらし(px。正なら中身が左へ動く)。b = 立体と札の外側の四角、r = 空いている所。
 * 中身が空いている所に収まるなら、真ん中に置く。収まらなければ、focusPx(選んだ Box の札の横の位置。なければ null)を空いている所の真ん中へ寄せる。
 * ただし空いている所の左右の端に、何もない所を作らない(端の Box を選んでも、となりの Box をできるだけ多く見せる)
 */
export function focusShift(b: Rect, r: Rect, focusPx: number | null): number {
  const cx = (r.x0 + r.x1) / 2;
  const centred = (b.x0 + b.x1) / 2 - cx;
  if (focusPx === null || rectW(b) <= rectW(r)) return centred;
  const lo = b.x0 - r.x0; // これより小さいと、左の端に何もない所ができる
  const hi = b.x1 - r.x1; // これより大きいと、右の端に何もない所ができる
  return Math.min(hi, Math.max(lo, focusPx - cx));
}

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
  /** これより近くへは寄らない距離(floor が決める。隊形の枠) */
  minD = 0;
  /** bounds に隊形の枠の端(model.framePoints)を入れるか(floor の計算の間だけ) */
  private withFrame = false;
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
    if (this.withFrame) for (const p of this.model.framePoints) add(this.toPx(this.v3.copy(p)));
    return b;
  }

  /**
   * 隊形の枠(model.framePoints)を、欄のない舞台(area)に収める距離を、これより近くへは寄らない距離(minD)にする。
   * 2 つ・4 つが 3 つの 1 列より大きく写らない。欄が開いて空いている所が狭いときは、もともとこれより遠いので効かない
   */
  floor(area: Rect): void {
    this.minD = 0;
    if (!this.model.framePoints.length) return;
    this.withFrame = true;
    try {
      this.minD = this.fitD(rectW(area), rectH(area));
    } finally {
      this.withFrame = false;
    }
  }

  /** 単位の立体が画面でふさぐ所(px。今のカメラで): 台座(足もとから台の上の面まで)の四角と、Box と帯の円。床の点線の軌道は含めない */
  solid(u: Unit): Solid {
    const B = this.model.base;
    const ped: Rect = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    const f = B.footprint;
    for (const [lx, ly, lz] of [[-f, 0, 0], [f, 0, 0], [0, 0, f], [-f, B.top, 0], [f, B.top, 0]] as const) {
      const [X, Y] = this.proj(u, lx, ly, lz);
      ped.x0 = Math.min(ped.x0, X);
      ped.x1 = Math.max(ped.x1, X);
      ped.y0 = Math.min(ped.y0, Y);
      ped.y1 = Math.max(ped.y1, Y);
    }
    // Box と帯は、Box の中心のまわりの球(帯の外側の半径か、Box に外接する球の半径)に収まる。ゆれ・持ち上げの分だけ上下にのびた円(カプセル)
    const R = Math.max(u.m.wide, circumRadius(u.m.side));
    const [cx, cy] = this.proj(u, 0, u.m.yC, 0);
    const r = Math.abs(this.proj(u, R, u.m.yC, 0)[0] - cx);
    const ya = this.proj(u, 0, u.m.yC + BOB, 0)[1];
    const yb = this.proj(u, 0, u.m.yC - BOB, 0)[1];
    return { ped, cx, ya: Math.min(ya, yb, cy), yb: Math.max(ya, yb, cy), r };
  }

  /**
   * 距離 d のとき、札が重なるか(札の実際の大きさ〔折り返したあとの大きさ〕で。台の正面のときは見ない)。
   * 札どうしが重なるとき。solids なら、札がほかの単位の立体(台座・Box・帯)にかかるときも
   * (札が台の下: ほかのすべての単位。札が Box の上: 後ろの列の札と前の列の立体だけ。Box の上の札は立体の上の空いた所に出るため)
   */
  labelsClash(d: number, solids = true): boolean {
    if (this.labelMode === "front") return false;
    this.bounds(d);
    const units = this.model.units;
    const R: Rect[] = units.map((u) => {
      const L = this.labelAt(u);
      const [w, h] = this.sizes[u.i] ?? [this.LW, this.LH];
      return this.labelMode === "float" ? { x0: L.px - w / 2, y0: L.py - h, x1: L.px + w / 2, y1: L.py } : { x0: L.px - w / 2, y0: L.py, x1: L.px + w / 2, y1: L.py + h };
    });
    const G = LABEL_GAP;
    const near = (a: Rect, b: Rect, g: number) => a.x1 + g > b.x0 && b.x1 + g > a.x0 && a.y1 + g > b.y0 && b.y1 + g > a.y0;
    if (R.some((a, i) => R.some((b, j) => j > i && near(a, b, G)))) return true;
    if (!solids) return false;
    const below = this.labelMode === "below";
    if (!below && !units.some((u) => u.slot.row === 1)) return false;
    const S = units.map((u) => this.solid(u));
    return units.some((u, i) => units.some((v, j) => j !== i && (below || (u.slot.row === 1 && v.slot.row === 0)) && hitsSolid(R[i], S[j])));
  }

  /** near(近い・大きい)〜 far(遠い・小さい)のうち、札が重ならないいちばん遠い距離。near でも重なれば near */
  widestClear(near: number, far: number, solids = true): number {
    if (far <= near || this.labelsClash(near, solids)) return near;
    if (!this.labelsClash(far, solids)) return far;
    let lo = near;
    let hi = far;
    for (let k = 0; k < 16; k++) {
      const mid = (lo + hi) / 2;
      if (this.labelsClash(mid, solids)) hi = mid;
      else lo = mid;
    }
    return lo;
  }

  /** 幅 availW・高さ availH に収まる、いちばん近い距離 */
  fitD(availW: number, availH: number): number {
    const tanH = Math.tan(MathUtils.degToRad(this.fovDeg / 2));
    const dMin = Math.max(this.H / (MAX_PX_PER_UNIT * 2 * tanH), this.minD);
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

  /** 候補の四角のうち、札が重ならないものを先に、同じなら大きく見えるもの(距離が近いもの)を選ぶ(solids は labelsClash と同じ) */
  choose(rects: readonly Rect[], solids = true): Fit {
    let best: Fit | null = null;
    for (const r of rects) {
      const d = this.fitD(rectW(r), rectH(r));
      const clash = this.labelsClash(d, solids);
      if (!best || (best.clash && !clash) || (best.clash === clash && d < best.d - 1e-6)) best = { d, r, clash };
    }
    return best ?? { d: 8, r: rects[0], clash: false };
  }

  /**
   * 収め方を決める(area = 舞台から余白を除いた所、rects = そこから欄をよけた候補、occluded = 欄が開いているか、focusIndex = 選んだ Box〔なければ -1〕)。
   * ks = 札の大きさの倍率の候補(大きい順。先頭は元の大きさ 1、最後は読める大きさの下限)。
   * 1) 札を ks の順に小さくしながら、全部を空いている所に収める(札が重ならず、立体にもかからない、いちばん大きな札で)。
   * 2) どの倍率でも立体にかかるなら、いちばん小さな札で、札どうしが重ならなければ全部を空いている所に収める(遠い単位を欄の下に隠すより、全部が見えるほうを選ぶ)。
   * 3) それでも札どうしが重なり、欄が開いていて選んだ Box があれば: 空いている所の高さに収まる範囲で寄り、札が重ならないいちばん広い見え方にして、
   *    選んだ Box へ寄せる(focus。横のずらしは focusShift)。札は、寄っても重ならないいちばん大きな倍率に。
   * resize(k) は札の大きさの倍率を変えて計り直す(sizes・LW・LH を入れ直す)。呼ぶ前は ks[0] で計ってあること。
   * 返す k は最後に計った倍率、loose は 2) の収め方(札が立体に少しかかる)か
   */
  plan(
    area: Rect,
    rects: readonly Rect[],
    occluded: boolean,
    focusIndex: number,
    resize: (k: number) => void,
    ks: readonly number[] = [1],
  ): { fit: Fit; focus: number; k: number; loose: boolean } {
    const scales = ks.length ? ks : [1];
    let k = scales[0];
    const setK = (next: number) => {
      if (next === k) return;
      resize(next);
      k = next;
    };
    /** 大きい倍率から順に、全部が収まるものを探す */
    const all = (solids: boolean): Fit | null => {
      for (const next of scales) {
        setK(next);
        const fit = this.choose(rects, solids);
        if (!fit.clash) return fit;
      }
      return null;
    };
    const strict = all(true);
    if (strict) return { fit: strict, focus: -1, k, loose: false };
    // 立体にかかるのは避けられない: いちばん小さな札で(立体にかかる所がいちばん少ない)、札どうしが重ならなければ全部を見せる
    setK(scales[scales.length - 1]);
    const loose = this.choose(rects, false);
    if (!loose.clash) return { fit: { ...loose, clash: true }, focus: -1, k, loose: true };
    if (focusIndex < 0 || !occluded) return { fit: this.choose(rects), focus: -1, k, loose: false };
    const r = largest(rects);
    let near = 0;
    let solids = true;
    search: for (const s of [true, false])
      for (const next of scales) {
        setK(next);
        near = this.fitD(Infinity, rectH(r)); // 高さだけで決まる、いちばん近い距離
        if (!this.labelsClash(near, s)) {
          solids = s;
          break search;
        }
      }
    const far = this.fitD(rectW(r), rectH(r)); // 全部が入る距離
    const d = this.widestClear(near, far, solids);
    return { fit: { d, r, clash: this.labelsClash(d) }, focus: focusIndex, k, loose: !solids };
  }
}
