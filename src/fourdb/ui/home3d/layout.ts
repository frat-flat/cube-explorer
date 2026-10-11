// 立体のホームの、決まった数値と純粋な計算(three・DOM を使わない)。数値は試作(js/home3d.js)のもの。
// 並べ方 × 単位の数で立体が重ならないこと、帯が Box に触れないこと、くぼみの台の高さを、試験(layout.test.ts)で確かめる。
// 単位は台座の足もとの中心を原点(0, 0, 0)とし、y が上。台の正面は +z。長さの単位は three の 1。
import type { Look } from "@/fourdb/core/prefs";

/** 単位が 4 つ以上のとき「多い」(Box・軌道・帯のすき間の大きさを変える。並べ方は formationRows の 2 列の隊形) */
export const isMany = (n: number): boolean => n > 3;

/**
 * 並べる場所。row = 列(0 = 前の列、1 = 後ろの列。1 列の隊形はすべて 0)、
 * tier = ひな壇の段(1 = 後ろの高い段、0 = 前の低い段。ひな壇以外は 0)
 */
export type Slot = { x: number; y: number; z: number; row: 0 | 1; tier: 0 | 1 };

/** ひな壇の後ろの段の高さ。前の段は床の上 */
export const STAGE_RISE = 0.5;
export const STAGE_STEP = 0;
/** ひな壇の後ろの段の箱: 後ろの段の中心 z = -0.85、奥の端 zBack と手前の端 zFront(奥行き 1.5)、両端の立体から横へ margin だけ広げる */
const RISER = { zCenter: -0.85, zBack: -1.6, zFront: -0.1, margin: 0.95 } as const;

/**
 * 単位の数ごとの隊形(後ろの列と前の列の数。単位は 6 つまで〔規則 R〕)。
 * 1 = 真ん中に 1 つ、2 = 横に 2 つ、3 = 1 列に 3 つ、4 = 後ろ 2・前 2、5 = 後ろ 2・前 3、6 = 後ろ 3・前 3。
 * 2 列の隊形は、前の列と後ろの列を半分ずつずらす(後ろの立体が、前の立体のあいだから見える)。
 */
export function formationRows(n: number): { back: number; front: number } {
  const count = Math.max(0, Math.floor(n));
  if (count <= 3) return { back: 0, front: count };
  return { back: Math.floor(count / 2), front: Math.ceil(count / 2) };
}

/** 1 列の隊形の、となりどうしの間隔(2 つも 3 つと同じ間隔。端まで広げない) */
export const ROW_GAP = 1.95;
/** 2 列の隊形の、前の立体と後ろの立体の横のずれ(同じ列のとなりどうしは、この 2 倍) */
export const STAGGER = 1.2;
/** 2 列の隊形の奥行き(1 列・弧: 後ろの列 z = -ROW_DEPTH / 2、前の列 z = ROW_DEPTH / 2) */
export const ROW_DEPTH = 1.8;
/** ひな壇の前の段の z(後ろの段の箱の手前の端 -0.1 より、立体の広さ + すき間だけ手前) */
export const STAGE_FRONT_Z = 0.85;
/** 弧の曲がり方: z = ARC_K × x²(左右の端ほど手前) */
export const ARC_K = 0.085;
/**
 * 2 列の隊形の遠近の直し: 前の列は手前にあるので画面では広がって見える。前の列の横の位置を (1 - PERSPECTIVE) 倍に詰め、後ろの列を (1 + PERSPECTIVE) 倍に広げて、
 * 画面の上で互い違いの間隔がそろうようにする(前と後ろの数が同じ隊形で、片側だけ詰まって見えないように)
 */
export const PERSPECTIVE = 0.055;

/**
 * n 個の単位を並べる場所(隊形は formationRows)。n が 0 なら空。
 * 添え字の順(規則 R の順)は左から右: 2 列の隊形は、前・後ろ・前… と互い違いに左から並ぶ(いちばん左は前の列)。
 * キーボードの順・札の順は、画面の左から右と同じになる。
 * 並べ方は隊形の中の見え方だけを変える: row = 床にまっすぐ、arc = 列を手前へゆるく曲げる、stage = 後ろの列を段に上げる。
 * ひな壇は、2 列の隊形と 3 つ(真ん中を後ろの段に上げる)で使う。1 つ・2 つは 1 列と同じ。
 */
export function unitSlots(n: number, layout: Look["layout"]): Slot[] {
  const count = Math.max(0, Math.floor(n));
  if (count === 0) return [];
  const mid = (count - 1) / 2;
  // ひな壇の 3 つは、真ん中だけを後ろの段に上げる(前・後ろ・前)。ほかの 1 列の隊形には段がない
  const podium = layout === "stage" && count === 3;
  if (formationRows(count).back === 0 && !podium) {
    return Array.from({ length: count }, (_, i): Slot => {
      const x = (i - mid) * ROW_GAP;
      return { x, y: 0, z: layout === "arc" ? ARC_K * x * x : 0, row: 0, tier: 0 };
    });
  }
  // 2 列: 左から 前・後ろ・前… の互い違い(前の列の数 ≥ 後ろの列の数なので、左の端はいつも前の列)。遠近の分だけ前の列を詰め、後ろの列を広げる
  const shift = podium ? ROW_GAP : STAGGER;
  const raw = Array.from({ length: count }, (_, i) => (i - mid) * shift * (i % 2 === 1 ? 1 + PERSPECTIVE : 1 - PERSPECTIVE));
  const mean = raw.reduce((a, b) => a + b, 0) / count;
  const xs = raw.map((x) => x - mean); // 全体の真ん中を x = 0 に(前と後ろの数が同じ隊形で、直しの分だけずれないように)
  // 弧は列ごとに、その列の真ん中から左右へ手前に曲げる(前と後ろの数が同じ隊形でも、列ごとに左右対称の弧になる)
  const rowMid = (back: boolean) => {
    const own = xs.filter((_, i) => i % 2 === (back ? 1 : 0));
    return own.reduce((a, b) => a + b, 0) / own.length;
  };
  const mids = [rowMid(false), rowMid(true)];
  return xs.map((x, i): Slot => {
    const back = i % 2 === 1;
    if (layout === "stage") return { x, y: back ? STAGE_RISE : STAGE_STEP, z: back ? RISER.zCenter : STAGE_FRONT_Z, row: back ? 1 : 0, tier: back ? 1 : 0 };
    const z0 = back ? -ROW_DEPTH / 2 : ROW_DEPTH / 2;
    const dx = x - mids[back ? 1 : 0];
    return { x, y: 0, z: layout === "arc" ? z0 + ARC_K * dx * dx : z0, row: back ? 1 : 0, tier: 0 };
  });
}

/**
 * カメラの枠に必ず入れる、横の半分の幅(並びの真ん中から)。単位が 2 つ以上なら、3 つの 1 列より狭く写さない
 * (2 つ・4 つが画面いっぱいに大きくならず、3 つと同じ大きさ・間隔で真ん中に寄る。5 つ・6 つは並びのほうが広い)。1 つなら 0
 */
export function frameHalfWidth(n: number): number {
  return Math.floor(n) >= 2 ? ROW_GAP + orbitRadius(3) : 0;
}

/** 見下ろす角度(rad)。ふつうは 0.15。ひな壇・くぼみの台は 0.27(後ろの段・くぼみが見えるよう)。2 列の隊形は TWO_ROW_ELEVATION 以上(後ろの列が前の列の上に見えるよう) */
export const TWO_ROW_ELEVATION = 0.32;
export function cameraElevation(look: Pick<Look, "layout" | "base">, n: number): number {
  const base = look.layout === "stage" || look.base === "dish" ? 0.27 : 0.15;
  return formationRows(n).back > 0 ? Math.max(base, TWO_ROW_ELEVATION) : base;
}

/** ひな壇の後ろの段の箱(x0〜x1 の幅、奥 zBack〜手前 zFront、高さ height)。ひな壇でない・後ろの段がなければ null */
export function stageRiser(slots: readonly Slot[]): { x0: number; x1: number; zBack: number; zFront: number; height: number } | null {
  const back = slots.filter((s) => s.tier === 1);
  const front = slots.filter((s) => s.tier === 0);
  if (!back.length || !front.length) return null;
  const xs = slots.map((s) => s.x);
  return {
    x0: Math.min(...xs) - RISER.margin,
    x1: Math.max(...xs) + RISER.margin,
    zBack: RISER.zBack,
    zFront: RISER.zFront,
    height: STAGE_RISE,
  };
}

/** 背景の飾りの大きさ: 並びの奥行きの真ん中 cz、半分の幅 halfX、大きな点線の楕円の半径 bigR */
export function layoutExtent(slots: readonly Slot[]): { cz: number; halfX: number; bigR: number } {
  if (!slots.length) return { cz: 0, halfX: 0, bigR: 1.45 };
  const xs = slots.map((s) => s.x);
  const zs = slots.map((s) => s.z);
  const halfX = (Math.max(...xs) - Math.min(...xs)) / 2;
  return { cz: (Math.min(...zs) + Math.max(...zs)) / 2, halfX, bigR: halfX + 1.45 };
}

// ---------- Box ----------

/** Box の一辺。角を下にすると背が 1.73 倍、幅も少し広くなるので、辺を少し短くする */
export function boxSide(tilt: Look["tilt"], n: number): number {
  const many = isMany(n);
  return tilt === "vertex" ? (many ? 0.54 : 0.5) : many ? 0.62 : 0.58;
}

/** Box に外接する球の半径(向きによらない) */
export const circumRadius = (side: number): number => (side * Math.sqrt(3)) / 2;

/** Box の高さの半分(角を下なら対角線の半分) */
export const boxHalfHeight = (side: number, tilt: Look["tilt"]): number => (tilt === "vertex" ? circumRadius(side) : side / 2);

/** 台座のまわりの点線の軌道の半径 */
export const orbitRadius = (n: number): number => (isMany(n) ? 0.65 : 0.72);

// ---------- 帯(ロゴの青と金。Box の外を回る) ----------

/** 帯 1 本。R = 輪の半径、w = 幅、tw = 幅の向きのねじれ(rad)、ph = ねじれと幅の位相、tilt = 水平からの傾き(rad)、yaw = 向き(rad)、spd = 自分の軸まわりの速さ(回/秒) */
export type BandDef = { id: "a" | "b" | "a2"; R: number; w: number; tw: number; ph: number; tilt: number; yaw: number; spd: number };

/** 帯の輪と、Box に外接する球とのすき間(最小) */
export const bandGap = (n: number): number => (isMany(n) ? 0.05 : 0.07);

export function bandDefs(side: number, n: number): BandDef[] {
  const rc = circumRadius(side);
  const k = side / 0.5;
  const gap = bandGap(n);
  return [
    { id: "a", R: rc + gap + 0.015, w: 0.17 * k, tw: 0.42, ph: 0.0, tilt: 1.0, yaw: 0.35, spd: 1 / 52 },
    { id: "b", R: rc + gap + 0.035, w: 0.15 * k, tw: 0.48, ph: 1.9, tilt: -0.86, yaw: 1.85, spd: -1 / 64 },
    { id: "a2", R: rc + gap, w: 0.08 * k, tw: 0.3, ph: 3.6, tilt: 0.42, yaw: -0.95, spd: 1 / 80 },
  ];
}

/** 帯の形の分け方(試作の ribbonGeo と同じ) */
export const BAND_SEGMENTS = 180;

/** 帯の中心線の点 k の、輪の面の中での位置と、幅の向き。ww = そこでの幅(太く細く変わる) */
function bandPoint(d: BandDef, k: number) {
  const t = (k / BAND_SEGMENTS) * Math.PI * 2;
  const phi = d.tw * Math.sin(t + d.ph);
  return { t, phi, ww: d.w * (0.55 + 0.45 * Math.sin(t + d.ph * 1.7)) };
}

/**
 * 帯の形を数値で作って測る(Box の中心から)。
 * inner = いちばん近い所(Box に外接する球より大きければ、帯は Box に触れない)、
 * reach = 水平方向にいちばん張り出す所(自分の軸まわりに回っても)、vertical = 上下にいちばん張り出す所(中心からの高さの絶対値)。
 */
export function bandExtent(d: BandDef, spinSteps = 24): { inner: number; reach: number; vertical: number } {
  let inner = Infinity;
  let reach = 0;
  let vertical = 0;
  const cosT = Math.cos(d.tilt);
  const sinT = Math.sin(d.tilt);
  for (let k = 0; k <= BAND_SEGMENTS; k++) {
    const { t, phi, ww } = bandPoint(d, k);
    const sinP = Math.sin(phi);
    const cosP = Math.cos(phi);
    // 幅の方向 u(-ww/2〜ww/2)で、中心からの距離の二乗は R² + 2R·u·sinφ + u²(輪の面の中の外向きと、輪の軸の向きの成分)
    const u = Math.max(-ww / 2, Math.min(ww / 2, -d.R * sinP));
    inner = Math.min(inner, Math.sqrt(Math.max(0, d.R * d.R + 2 * d.R * u * sinP + u * u)));
    for (const s of [-ww / 2, ww / 2]) {
      // 輪の面(y = 0)の中の点 (px, py, pz): 外向き (cos t, 0, sin t) に R + s·sinφ、軸 (0, 1, 0) に s·cosφ
      const px0 = Math.cos(t) * (d.R + s * sinP);
      const pz0 = Math.sin(t) * (d.R + s * sinP);
      const py0 = s * cosP;
      for (let j = 0; j < spinSteps; j++) {
        // 輪の軸のまわりに a だけ回し、水平からの傾きだけ傾ける(向き yaw は水平方向の張り出しを変えないので使わない)
        const a = (j / spinSteps) * Math.PI * 2;
        const px = px0 * Math.cos(a) + pz0 * Math.sin(a);
        const pz = -px0 * Math.sin(a) + pz0 * Math.cos(a);
        const y = py0 * cosT - pz * sinT;
        const z = py0 * sinT + pz * cosT;
        reach = Math.max(reach, Math.hypot(px, z));
        vertical = Math.max(vertical, Math.abs(y));
      }
    }
  }
  return { inner, reach, vertical };
}

// ---------- 台座 ----------

export type BaseSpec = {
  /** Box の下の面を置く基準の高さ(台の上の面の縁の高さ) */
  top: number;
  /** そこから Box の下までのすき間 */
  gap: number;
  /** 正面(札を刻む面)。なければ null */
  face: { y: number; h: number; z: number } | null;
  /** 床の影の一辺 */
  shadow: number;
  /** 台そのものの外側の半径(光だまり・影は含めない) */
  footprint: number;
  /** くぼみの台だけ: R = くぼみの半径、depth = 真ん中の深さ */
  R?: number;
  depth?: number;
};

export const BASES = {
  plinth: { top: 0.18, gap: 0.27, face: { y: 0.1075, h: 0.13, z: 0.49 }, shadow: 2.3, footprint: 0.55 },
  // くぼみの台: 2 段の台の上の面を、浅い皿の形にくぼませる。gap は縁の高さから Box の下まで
  dish: { top: 0.18, gap: 0.13, face: { y: 0.1075, h: 0.13, z: 0.49 }, shadow: 2.3, footprint: 0.55, R: 0.42, depth: 0.065 },
  ring: { top: 0.34, gap: 0.17, face: null, shadow: 1.7, footprint: 0.41 },
  stone: { top: 0.95, gap: 0.18, face: { y: 0.5, h: 0.62, z: 0.305 }, shadow: 2.0, footprint: 0.41 },
  disc: { top: 0.016, gap: 0.44, face: null, shadow: 2.1, footprint: 0.62 },
} as const satisfies Record<Look["base"], BaseSpec>;

/** 札を台の正面に出せる台座(正面のある台座) */
export const hasFace = (base: Look["base"]): boolean => BASES[base].face !== null;

/** くぼみの台の上の面の高さ(r = 台の真ん中からの距離)。真ん中がいちばん低く、縁へなめらかに上がり、縁の近くは平ら */
export function dishHeight(r: number): number {
  const { top, depth, R } = BASES.dish;
  const d = Math.abs(r);
  return d >= R ? top : top - depth * 0.5 * (1 + Math.cos((Math.PI * d) / R));
}

// ---------- 浮く高さ・重ならない広さ ----------

/** 上下のゆれの大きさと、ポインターが乗ったときの持ち上げ */
export const BOB_AMPLITUDE = 0.032;
export const HOVER_LIFT = 0.05;
/** 帯があるとき、ゆれても台にこれ以上近づかないようにする高さ */
export const BAND_CLEARANCE = 0.07;

export type UnitMetrics = {
  side: number;
  /** Box の高さの半分 */
  hh: number;
  bands: BandDef[];
  /** 中心から下(上)へいちばん遠い所(Box か帯。余裕を見た大きめの値) */
  down: number;
  /** 中心から横へいちばん遠い所(帯。なければ 0。余裕を見た大きめの値) */
  wide: number;
  /** Box の中心の高さ(台の足もとから)。帯があれば、ゆれても台に BAND_CLEARANCE 以上近づかない高さまで上げる */
  yC: number;
};

/** 単位 1 つぶんの大きさと浮く高さ。n = 並べる単位の数 */
export function unitMetrics(look: Pick<Look, "shape" | "tilt" | "base">, n: number): UnitMetrics {
  const side = boxSide(look.tilt, n);
  const hh = boxHalfHeight(side, look.tilt);
  const bands = look.shape === "ribbon" ? bandDefs(side, n) : [];
  const base = BASES[look.base];
  const down = Math.max(hh, ...bands.map((b) => b.R * Math.sin(Math.abs(b.tilt)) + b.w / 2));
  const wide = Math.max(0, ...bands.map((b) => b.R + b.w / 2));
  const yC = Math.max(base.top + base.gap + hh, base.top + BAND_CLEARANCE + down);
  return { side, hh, bands, down, wide, yC };
}

/** 単位 1 つが床の上でふさぐ円(中心 x・z と半径 r)。台・軌道・帯のうち、いちばん広いもの */
export type Footprint = { x: number; z: number; r: number };

export function unitFootprintRadius(look: Pick<Look, "shape" | "tilt" | "base">, n: number): number {
  const m = unitMetrics(look, n);
  const reach = Math.max(0, ...m.bands.map((b) => bandExtent(b).reach));
  return Math.max(BASES[look.base].footprint, orbitRadius(n), reach);
}

export function unitFootprints(look: Look, n: number): Footprint[] {
  const r = unitFootprintRadius(look, n);
  return unitSlots(n, look.layout).map((s) => ({ x: s.x, z: s.z, r }));
}

/** 重なっている円の組(添え字 i < j)。接するだけ(距離 = 半径の和)は重ならない */
export function overlappingPairs(fps: readonly Footprint[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < fps.length; i++)
    for (let j = i + 1; j < fps.length; j++) if (Math.hypot(fps[i].x - fps[j].x, fps[i].z - fps[j].z) < fps[i].r + fps[j].r - 1e-9) out.push([i, j]);
  return out;
}
