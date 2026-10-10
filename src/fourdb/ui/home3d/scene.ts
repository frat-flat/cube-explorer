// 見た目 1 つぶんの場面(光・単位の立体・床の飾り・ひな壇の段)。見た目を変えるときは dispose() してから作り直す(描く部品は舞台が使い回す)。
import {
  BoxGeometry,
  BufferGeometry,
  DirectionalLight,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineLoop,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  Quaternion,
  Scene,
  ShaderMaterial,
  Color,
  Vector3,
  type Material,
  type Object3D,
  type Texture,
} from "three";
import type { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import type { Look } from "@/fourdb/core/prefs";
import { BASES, hasFace, layoutExtent, orbitRadius, stageRiser, unitMetrics, unitSlots, type BaseSpec } from "./layout";
import { lin, mix, type Palette } from "./palette";
import { blendingFor, circlePts, flat, matteMaterial, points } from "./parts";
import { gridFS, gridVS } from "./shaders";
import type { Textures } from "./textures";
import { buildUnit, updateUnit, type Unit } from "./unit";

/** 1 回転の秒数 */
export const TURN_SECONDS = 26;

export type SceneModel = {
  look: Look;
  scene: Scene;
  units: Unit[];
  /** 選ぶための見えない筒(単位の順) */
  hits: Mesh[];
  base: BaseSpec;
  orbit: number;
  /** 見下ろす角度(rad) */
  elevation: number;
  /** カメラが見る点 */
  target: Vector3;
  /** 枠に収めるときに入れる点(ひな壇の段の角) */
  extraPoints: Vector3[];
  /** 縁の線の材質(描く大きさを合わせる) */
  lines: LineMaterial[];
  /** 正面のある台座か(札を台の正面に出せる) */
  hasFace: boolean;
  paint(K: Palette): void;
  update(dt: number, clock: number, still: boolean, want: (i: number) => number): void;
  dispose(): void;
};

export type SceneContext = {
  tex: Textures;
  pixelRatio: number;
  palette(): Palette;
};

export function buildScene(look: Look, n: number, ctx: SceneContext): SceneModel {
  const scene = new Scene();
  const count = Math.max(0, Math.floor(n));
  const base = BASES[look.base];
  const orbit = orbitRadius(count);
  const vertex = look.tilt === "vertex";
  // 角を下: 立方体の対角線(1,1,1)を真上に向ける(平らな向きから約 54.7° 傾ける)。下の角が台の真ん中を指す
  const orient = vertex ? new Quaternion().setFromUnitVectors(new Vector3(1, 1, 1).normalize(), new Vector3(0, 1, 0)) : new Quaternion();
  // 青から金への向き(立体の中の座標)。角を下: 下の角が青、上の角が金になるよう、真上の向きを立方体の中の向きに直す
  const grad = vertex ? new Vector3(0.3, 0.9, 0.12).applyQuaternion(orient.clone().conjugate()) : new Vector3(0.55, 0.85, -0.3);

  // ---- 光 ----
  const hemi = new HemisphereLight(0xffffff, 0x888888, 0.9);
  const key = new DirectionalLight(0xffffff, 0.7);
  key.position.set(-3, 6, 5);
  scene.add(hemi, key);

  // ---- 単位 ----
  const slots = unitSlots(count, look.layout);
  const metrics = unitMetrics(look, count);
  const lines: LineMaterial[] = [];
  const units = slots.map((slot, i) => {
    const u = buildUnit(i, slot, metrics, {
      look,
      base,
      orbit,
      vertex,
      orient,
      grad,
      tex: ctx.tex,
      lines,
      floatLabel: look.label === "float",
      palette: ctx.palette,
    });
    scene.add(u.g);
    return u;
  });

  // ---- 床の飾り(背景) ----
  const { cz, bigR } = layoutExtent(slots);
  const deco = new Group();
  deco.position.z = cz;
  scene.add(deco);
  const decoPaint: ((K: Palette) => void)[] = [];
  if (look.bg === "logo") {
    // 大きな点線の楕円と、左右の端の金の点(ロゴの軌道)
    const big = points(circlePts(bigR, Math.round(bigR * 120), 0.001, bigR * 0.62), 1.5, ctx.tex.dot);
    const ends = points([bigR, 0.001, 0, -bigR, 0.001, 0], 5, ctx.tex.dot);
    deco.add(big, ends);
    decoPaint.push((K) => {
      big.material.color.copy(lin(K.lineStrong));
      big.material.opacity = K.dark ? 0.55 : 0.45;
      ends.material.color.copy(lin(K.hl));
    });
  } else if (look.bg === "quiet") {
    // やわらかな床の楕円(明るい光だまり)と、細い楕円の線 1 本だけ
    const glow = flat(new PlaneGeometry(1, 1), ctx.tex.soft);
    glow.scale.set(bigR * 2.3, bigR * 1.5, 1);
    glow.position.y = 0.0008;
    const loopGeo = new BufferGeometry();
    loopGeo.setAttribute("position", new Float32BufferAttribute(circlePts(bigR, 240, 0.001, bigR * 0.58), 3));
    const loop = new LineLoop(loopGeo, new LineBasicMaterial({ transparent: true, depthWrite: false }));
    deco.add(glow, loop);
    decoPaint.push((K) => {
      glow.material.color.copy(lin(K.dark ? K.accent : "#ffffff"));
      glow.material.opacity = K.dark ? 0.1 : 0.85;
      glow.material.blending = blendingFor(K.dark);
      glow.material.needsUpdate = true;
      loop.material.color.copy(lin(K.lineStrong));
      loop.material.opacity = K.dark ? 0.4 : 0.3;
    });
  } else {
    // 遠近の付いた薄い床の格子と、交わる所の点。真ん中から外へ消える
    const step = 0.5;
    const gx = Math.ceil((bigR + 2.5) / step) * step;
    const gz0 = -4;
    const gz1 = 3.5;
    const lp: number[] = [];
    const dp: number[] = [];
    for (let xg = -gx; xg <= gx + 1e-6; xg += step) lp.push(xg, 0.001, gz0, xg, 0.001, gz1);
    for (let zg = gz0; zg <= gz1 + 1e-6; zg += step) lp.push(-gx, 0.001, zg, gx, 0.001, zg);
    for (let xg = -gx; xg <= gx + 1e-6; xg += step) for (let zg = gz0; zg <= gz1 + 1e-6; zg += step) dp.push(xg, 0.0015, zg);
    const fade = (pt: boolean) =>
      new ShaderMaterial({
        vertexShader: gridVS(bigR + 1.2),
        fragmentShader: gridFS(pt),
        uniforms: { uC: { value: new Color() }, uA: { value: 0.3 }, uSize: { value: 3 * ctx.pixelRatio } },
        transparent: true,
        depthWrite: false,
      });
    const lg = new BufferGeometry();
    lg.setAttribute("position", new Float32BufferAttribute(lp, 3));
    const dg = new BufferGeometry();
    dg.setAttribute("position", new Float32BufferAttribute(dp, 3));
    const gridLines = new LineSegments(lg, fade(false));
    const gridDots = new Points(dg, fade(true));
    deco.add(gridLines, gridDots);
    decoPaint.push((K) => {
      gridLines.material.uniforms.uC.value.copy(lin(K.lineStrong));
      gridLines.material.uniforms.uA.value = K.dark ? 0.26 : 0.17;
      gridDots.material.uniforms.uC.value.copy(lin(K.accent));
      gridDots.material.uniforms.uA.value = K.dark ? 0.7 : 0.5;
    });
  }

  // ---- ひな壇の後ろの高い段(前の列は床の上)。背景に近い色で控えめに、前の縁に青の細い線 ----
  const extraPoints: Vector3[] = [];
  const riserPaint: ((K: Palette) => void)[] = [];
  const rs = stageRiser(slots);
  if (rs) {
    const w = rs.x1 - rs.x0;
    const xc = (rs.x0 + rs.x1) / 2;
    const depth = rs.zFront - rs.zBack;
    const mat = matteMaterial(rs.height * 2.2);
    const riser = new Mesh(new BoxGeometry(w, rs.height, depth), mat);
    riser.position.set(xc, rs.height / 2, (rs.zBack + rs.zFront) / 2);
    const edge = new Mesh(new BoxGeometry(w, 0.004, 0.004), new MeshBasicMaterial({ transparent: true }));
    edge.position.set(xc, rs.height, rs.zFront);
    const shade = flat(new PlaneGeometry(w + 1, 1.2), ctx.tex.soft);
    shade.position.set(xc, 0.001, 0.05);
    shade.scale.set(1, 0.5, 1);
    scene.add(riser, edge, shade);
    extraPoints.push(new Vector3(rs.x0, rs.height, rs.zBack), new Vector3(rs.x1, rs.height, rs.zBack), new Vector3(rs.x0, 0, 1.5), new Vector3(rs.x1, 0, 1.5));
    riserPaint.push((K) => {
      mat.uniforms.uLit.value.copy(lin(K.dark ? mix(K.raised, K.line, 0.5) : mix(K.surface, K.bg, 0.25)));
      mat.uniforms.uShade.value.copy(lin(K.dark ? mix(K.bg, K.raised, 0.7) : mix(K.bg, K.line, 0.45)));
      mat.uniforms.uRimC.value.copy(lin(K.dark ? K.accentSoft : K.surface));
      edge.material.color.copy(lin(K.dark ? K.accentHover : K.accent));
      edge.material.opacity = 0.55;
      shade.material.color.copy(lin(K.dark ? "#000000" : K.ink));
      shade.material.opacity = K.dark ? 0.5 : 0.08;
    });
  }

  // ---- カメラ: 少し上から(ひな壇は後ろの段が、くぼみの台はくぼみが見えるよう高めに) ----
  const elevation = look.layout === "stage" || look.base === "dish" ? 0.27 : 0.15;
  const yMid = (slots.reduce((a, s) => a + s.y, 0) / Math.max(1, count)) + metrics.yC * 0.8;
  const target = new Vector3(0, yMid, cz);

  return {
    look,
    scene,
    units,
    hits: units.map((u) => u.hit),
    base,
    orbit,
    elevation,
    target,
    extraPoints,
    lines,
    hasFace: hasFace(look.base),
    paint(K) {
      hemi.color.copy(lin(K.dark ? K.accentSoft : "#ffffff"));
      hemi.groundColor.copy(lin(K.dark ? K.bg : K.line));
      hemi.intensity = K.dark ? 1.2 : 0.95;
      key.intensity = K.dark ? 0.55 : 0.75;
      for (const u of units) for (const f of u.paint) f(K);
      for (const f of decoPaint) f(K);
      for (const f of riserPaint) f(K);
    },
    update(dt, clock, still, want) {
      for (const u of units) updateUnit(u, want(u.i), dt, clock, still, TURN_SECONDS);
    },
    dispose() {
      disposeTree(scene, ctx.tex);
    },
  };
}

/** 場面の形・材質を捨てる(使い回す小さな画像 shared は捨てない。舞台を外すときに舞台が捨てる) */
function disposeTree(root: Object3D, shared: Textures): void {
  const keep = new Set<Texture>([shared.soft, shared.dot, shared.vfade]);
  const geos = new Set<BufferGeometry>();
  const mats = new Set<Material>();
  root.traverse((o) => {
    const obj = o as Object3D & { geometry?: BufferGeometry; material?: Material | Material[] };
    if (obj.geometry) geos.add(obj.geometry);
    for (const m of ([] as Material[]).concat(obj.material ?? [])) mats.add(m);
  });
  for (const g of geos) g.dispose();
  for (const m of mats) {
    for (const v of Object.values(m)) if (v && (v as Texture).isTexture && !keep.has(v as Texture)) (v as Texture).dispose();
    m.dispose();
  }
}
