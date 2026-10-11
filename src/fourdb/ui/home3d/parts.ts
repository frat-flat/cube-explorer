// 立体の部品の作り方(形と材質)。試作(js/home3d.js)の関数を three r128 の ES モジュールに移したもの。
import {
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  FrontSide,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  Points,
  PointsMaterial,
  ShaderMaterial,
  TorusGeometry,
  Vector3,
  type Side,
  type Texture,
} from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { BAND_SEGMENTS, type BandDef } from "./layout";
import { lin, mix, type Palette } from "./palette";
import { GLASS_FS, MATTE_FS, RIBBON_FS, RIBBON_VS, SOLID_VS } from "./shaders";

export const blendingFor = (dark: boolean) => (dark ? AdditiveBlending : NormalBlending);

/** 透けて、奥行きを書かない材質の共通の設定 */
const see = { transparent: true, depthWrite: false } as const;

/** 大きさが画面で変わらない点(位置の並び arr = [x, y, z, …]) */
export function points(arr: number[], size: number, dot: Texture, vertexColors = false): Points<BufferGeometry, PointsMaterial> {
  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(arr, 3));
  return new Points(geo, new PointsMaterial({ ...see, size, sizeAttenuation: false, map: dot, vertexColors }));
}

/** 床に寝かせた板(影・光だまり) */
export function flat(geo: BufferGeometry, map?: Texture): Mesh<BufferGeometry, MeshBasicMaterial> {
  const m = new Mesh(geo, new MeshBasicMaterial({ ...see, map: map ?? null }));
  m.rotation.x = -Math.PI / 2;
  return m;
}

/** 水平な細い輪(縁の光) */
export function ring(r: number, tube: number): Mesh<TorusGeometry, MeshBasicMaterial> {
  const m = new Mesh(new TorusGeometry(r, tube, 8, 220), new MeshBasicMaterial({ transparent: true }));
  m.rotation.x = Math.PI / 2;
  return m;
}

/** 水平な円(楕円)の上に並べた n 個の点 */
export function circlePts(r: number, n: number, y = 0.003, zr = r): number[] {
  const a: number[] = [];
  for (let k = 0; k < n; k++) {
    const t = (k / n) * Math.PI * 2;
    a.push(Math.cos(t) * r, y, Math.sin(t) * zr);
  }
  return a;
}

// ---------- ガラス・つや消し ----------

export type GlassUniforms = {
  uSize: { value: number };
  uA: { value: Color };
  uB: { value: Color };
  uTint: { value: Color };
  uAlpha: { value: number };
  uRim: { value: number };
  uEdge: { value: number };
  uGlow: { value: number };
  uWarm: { value: number };
  uSky: { value: Color };
  uHor: { value: Color };
  uL: { value: Vector3 };
  uSpec: { value: number };
  uEnv: { value: number };
  uCol: { value: number };
  uGrad: { value: Vector3 };
};
export type GlassMaterial = ShaderMaterial & { uniforms: GlassUniforms };

/** ガラスの面。side = 奥の面(BackSide)か手前の面(FrontSide)。grad = 青から金への向き(立体の中の座標) */
export function glassMaterial(side: Side, size: number, grad: Vector3): GlassMaterial {
  const uniforms: GlassUniforms = {
    uSize: { value: size },
    uA: { value: new Color() },
    uB: { value: new Color() },
    uTint: { value: new Color() },
    uAlpha: { value: 0.1 },
    uRim: { value: 0.3 },
    uEdge: { value: 0.1 },
    uGlow: { value: 0 },
    uWarm: { value: 1 },
    uSky: { value: new Color() },
    uHor: { value: new Color() },
    uL: { value: new Vector3(-0.45, 0.75, 0.5) },
    uSpec: { value: 0.5 },
    uEnv: { value: 0.5 },
    uCol: { value: 0.3 },
    uGrad: { value: grad.clone() },
  };
  return new ShaderMaterial({ vertexShader: SOLID_VS, fragmentShader: GLASS_FS, uniforms, side, ...see }) as GlassMaterial;
}

/** ガラスの奥の面と手前の面を、見た目(明るい・暗い)に合わせて塗る */
export function paintGlass(back: GlassMaterial, front: GlassMaterial, K: Palette): void {
  const dk = K.dark;
  for (const m of [back, front]) {
    const u = m.uniforms;
    u.uA.value.copy(lin(dk ? K.accent : K.word1));
    u.uB.value.copy(lin(dk ? K.hl : K.word3));
    u.uTint.value.copy(lin(dk ? mix(K.accent, K.bg, 0.55) : mix(K.surface, K.accentSoft, 0.6)));
    u.uSky.value.copy(lin(dk ? mix(K.accent, K.accentSoft, 0.35) : "#ffffff"));
    u.uHor.value.copy(lin(dk ? K.bg : mix(K.accentSoft, K.accent, 0.18)));
  }
  const b = back.uniforms;
  b.uCol.value = dk ? 0.3 : 0.55;
  b.uAlpha.value = dk ? 0.07 : 0.06;
  b.uRim.value = dk ? 0.18 : 0.1;
  b.uEdge.value = dk ? 0.06 : 0.05;
  b.uSpec.value = 0;
  b.uEnv.value = dk ? 0.2 : 0.3;
  const f = front.uniforms;
  f.uCol.value = dk ? 0.3 : 0.5;
  f.uAlpha.value = dk ? 0.07 : 0.1;
  f.uRim.value = dk ? 0.42 : 0.32;
  f.uEdge.value = dk ? 0.12 : 0.1;
  f.uSpec.value = dk ? 0.45 : 0.6;
  f.uEnv.value = 0.45;
}

export { BackSide, FrontSide };

export type MatteUniforms = {
  uSize: { value: number };
  uLit: { value: Color };
  uShade: { value: Color };
  uRimC: { value: Color };
  uGlow: { value: number };
};
export type MatteMaterial = ShaderMaterial & { uniforms: MatteUniforms };

/** つや消しの面(石の台・ひな壇・つや消しの Box)。polygonOffset = 縁の線を手前に見せるため、面を少し奥へずらす */
export function matteMaterial(size: number, polygonOffset = false): MatteMaterial {
  const uniforms: MatteUniforms = {
    uSize: { value: size },
    uLit: { value: new Color() },
    uShade: { value: new Color() },
    uRimC: { value: new Color() },
    uGlow: { value: 0 },
  };
  return new ShaderMaterial({
    vertexShader: SOLID_VS,
    fragmentShader: MATTE_FS,
    uniforms,
    ...(polygonOffset ? { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 } : {}),
  }) as MatteMaterial;
}

// ---------- 帯 ----------

/** 帯 1 本の形(輪の面は水平。幅は太く細く変わり、幅の向きがねじれる)。試作の ribbonGeo と同じ */
export function ribbonGeometry(d: BandDef): BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const c = new Vector3();
  const rad = new Vector3();
  const dir = new Vector3();
  const a = new Vector3();
  const b = new Vector3();
  for (let k = 0; k <= BAND_SEGMENTS; k++) {
    const t = (k / BAND_SEGMENTS) * Math.PI * 2;
    c.set(Math.cos(t) * d.R, 0, Math.sin(t) * d.R);
    rad.set(Math.cos(t), 0, Math.sin(t));
    const phi = d.tw * Math.sin(t + d.ph);
    dir.set(0, Math.cos(phi), 0).addScaledVector(rad, Math.sin(phi));
    const ww = d.w * (0.55 + 0.45 * Math.sin(t + d.ph * 1.7));
    a.copy(c).addScaledVector(dir, -ww / 2);
    b.copy(c).addScaledVector(dir, ww / 2);
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
    uv.push(k / BAND_SEGMENTS, 0, k / BAND_SEGMENTS, 1);
    if (k < BAND_SEGMENTS) idx.push(k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 1, k * 2 + 3, k * 2 + 2);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export type RibbonUniforms = {
  uC: { value: Color };
  uA: { value: number };
  uGlow: { value: number };
  uSide: { value: number };
  uCenter: { value: Vector3 };
};
export type RibbonMaterial = ShaderMaterial & { uniforms: RibbonUniforms };

/** side: 奥の半分 = -1、手前の半分 = +1。center = Box の中心(毎回の描画の前に書き換える。1 本の帯の 2 つの材質で共有) */
export function ribbonMaterial(side: -1 | 1, center: Vector3): RibbonMaterial {
  const uniforms: RibbonUniforms = { uC: { value: new Color() }, uA: { value: 0.6 }, uGlow: { value: 0 }, uSide: { value: side }, uCenter: { value: center } };
  return new ShaderMaterial({ vertexShader: RIBBON_VS, fragmentShader: RIBBON_FS, uniforms, side: DoubleSide, ...see }) as RibbonMaterial;
}

// ---------- 縁(立方体の 12 本) ----------

/** 一辺 s の立方体の 12 本の縁(線の両端の並び)と、8 つの角 */
export function cubeEdges(s: number): { pos: number[]; corners: number[] } {
  const pos: number[] = [];
  const cs: number[][] = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) cs.push([x, y, z]);
  for (let a = 0; a < 8; a++)
    for (let b = a + 1; b < 8; b++) {
      const d = cs[a].reduce((sum, v, k) => sum + Math.abs(v - cs[b][k]), 0);
      if (d === 2) pos.push(...cs[a].map((v) => (v * s) / 2), ...cs[b].map((v) => (v * s) / 2));
    }
  return { pos, corners: cs.flatMap((c) => c.map((v) => (v * s) / 2)) };
}

/** 立体の中の位置(一辺 s で割る)から、青から金への色の並び(位置の並びと同じ長さ)。暗い見た目では少し白に寄せる */
export function gradColors(pos: readonly number[], s: number, grad: Vector3, K: Palette, lift = 0): number[] {
  const A = lin(K.accent);
  const B = lin(K.hl);
  const white = new Color(1, 1, 1);
  const out: number[] = [];
  const c = new Color();
  for (let k = 0; k < pos.length; k += 3) {
    const w = MathUtils.smoothstep(0.5 + (pos[k] / s) * grad.x + (pos[k + 1] / s) * grad.y + (pos[k + 2] / s) * grad.z, 0.55, 1.05);
    c.copy(A).lerp(B, w);
    if (K.dark) c.lerp(white, 0.08 + lift);
    out.push(c.r, c.g, c.b);
  }
  return out;
}

/** 縁の線の材質(頂点の色)。描く大きさ(resolution)は舞台が合わせる */
export function lineMaterial(linewidth: number, opacity: number): LineMaterial {
  const m = new LineMaterial({ linewidth, opacity, transparent: true, depthWrite: false });
  m.vertexColors = true;
  return m;
}
