// 単位 1 つぶんの立体(床の影・点線の軌道・縦の細い線・台座・Box・帯・選ぶための見えない筒)。試作の buildCommon・buildBase・buildBox。
import {
  BoxGeometry,
  CircleGeometry,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RingGeometry,
  Shape,
  Vector2,
  Vector3,
  type BufferGeometry,
  type Quaternion,
} from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import type { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import type { Look } from "@/fourdb/core/prefs";
import { BASES, BOB_AMPLITUDE, HOVER_LIFT, dishHeight, type BaseSpec, type Slot, type UnitMetrics } from "./layout";
import { lin, mix, type Palette } from "./palette";
import {
  BackSide,
  FrontSide,
  blendingFor,
  circlePts,
  cubeEdges,
  flat,
  glassMaterial,
  gradColors,
  lineMaterial,
  matteMaterial,
  paintGlass,
  points,
  ribbonGeometry,
  ribbonMaterial,
  ring,
} from "./parts";
import type { Textures } from "./textures";

/** 毎回の描画で単位に渡すもの。near = Box が台に近いほど 1 に近い(影と光を濃く小さく) */
export type TickState = { clock: number; still: boolean; near: number };

export type Unit = {
  i: number;
  slot: Slot;
  /** 台の足もと(正面をカメラへ向けてある) */
  g: Group;
  /** 浮く部分(上下にゆれる) */
  lift: Group;
  /** 真上の軸のまわりに回る部分 */
  spin: Group;
  /** Box の向き(角を下) */
  orient: Group;
  /** 選ぶための見えない筒 */
  hit: Mesh;
  m: UnitMetrics;
  /** ポインターが乗った・選ばれた度合い(0〜1) */
  h: number;
  phase: number;
  ang: number;
  paint: ((K: Palette) => void)[];
  tick: ((st: TickState) => void)[];
};

export type UnitContext = {
  look: Look;
  base: BaseSpec;
  orbit: number;
  vertex: boolean;
  orient: Quaternion;
  /** 青から金への向き(立体の中の座標) */
  grad: Vector3;
  tex: Textures;
  /** 縁の線の材質(描く大きさを舞台が合わせる) */
  lines: LineMaterial[];
  /** 札が Box の上(縦の線の先の点を出さない) */
  floatLabel: boolean;
  /** 今の明るい・暗い(毎回の描画で読む) */
  palette(): Palette;
};

export function buildUnit(i: number, slot: Slot, m: UnitMetrics, c: UnitContext): Unit {
  const g = new Group();
  g.position.set(slot.x, slot.y, slot.z);
  g.rotation.y = Math.atan2(-slot.x, 9 - slot.z); // 台の正面をこちらへ向ける(弧・ひな壇で効く)
  const u: Unit = {
    i,
    slot,
    g,
    lift: new Group(),
    spin: new Group(),
    orient: new Group(),
    hit: new Mesh(),
    m,
    h: 0,
    phase: i * 1.7,
    ang: 0.55 + i * 0.83,
    paint: [],
    tick: [],
  };
  buildCommon(u, c);
  buildBase(u, c);
  buildBox(u, c);
  return u;
}

// ---------- 共通: 床の影・点線の軌道と進む点・浮く部分・縦の細い線・選ぶための見えない筒 ----------

function buildCommon(u: Unit, c: UnitContext): void {
  const { tex, orbit, base, look } = c;
  const shadow = flat(new PlaneGeometry(base.shadow, base.shadow), tex.soft);
  shadow.position.y = 0.002;
  const orb = points(circlePts(orbit, 150), 1.7, tex.dot);
  const orbDot = points([0, 0, 0], 5, tex.dot);
  u.g.add(shadow, orb, orbDot);
  u.orient.quaternion.copy(c.orient);
  u.spin.add(u.orient);
  u.lift.add(u.spin);
  u.g.add(u.lift);
  // 縦の細い線(ロゴの十字の縦の線)と、上の端の小さな点。回らない
  const axh = 2 * u.m.hh + 0.62;
  const axis = new Mesh(new PlaneGeometry(0.0042, axh), new MeshBasicMaterial({ transparent: true, depthWrite: false, map: tex.vfade }));
  axis.renderOrder = 2;
  const axisTop = points([0, axh / 2 - 0.06, 0], 4.2, tex.dot);
  axisTop.visible = !c.floatLabel; // Box の上の札のときは、線の先に札が下がる
  u.lift.add(axis, axisTop);
  const hh = u.m.yC + u.m.down + 0.15;
  const r = Math.max(0.7, u.m.wide); // 帯も選べる範囲に入れる
  u.hit = new Mesh(new CylinderGeometry(r, r, hh, 24), new MeshBasicMaterial({ visible: false }));
  u.hit.position.y = hh / 2;
  u.hit.userData.i = u.i;
  u.g.add(u.hit);
  u.paint.push((K) => {
    shadow.material.color.copy(lin(K.dark ? "#000000" : K.ink));
    shadow.material.opacity = (K.dark ? 0.75 : 0.13) * (look.base === "ring" ? 0.6 : look.base === "disc" ? 0.55 : 1);
    orb.material.color.copy(lin(K.accent));
    orbDot.material.color.copy(lin(K.hl));
    axis.material.color.copy(lin(K.lineStrong));
    axis.material.opacity = K.dark ? 0.75 : 0.55;
    axisTop.material.color.copy(lin(K.hl));
  });
  const p = orbDot.geometry.getAttribute("position") as Float32BufferAttribute;
  u.tick.push((st) => {
    const a = st.still ? 2.2 : -st.clock / 70 + u.phase;
    p.setXYZ(0, Math.cos(a) * orbit, 0.004, Math.sin(a) * orbit);
    p.needsUpdate = true;
    orb.material.opacity = (c.palette().dark ? 0.5 : 0.42) + u.h * 0.3;
  });
}

/** 台の上の影と光(浮いた Box の下。Box が下がるほど濃く小さく) */
function contactOn(u: Unit, c: UnitContext, y: number, poolR: number): void {
  const pool = flat(new CircleGeometry(poolR, 96), c.tex.soft);
  pool.position.y = y + 0.0015;
  const contact = flat(new PlaneGeometry(1, 1), c.tex.soft);
  contact.position.y = y + 0.002;
  u.g.add(pool, contact);
  u.paint.push((K) => {
    pool.material.color.copy(lin(K.accent));
    pool.material.blending = blendingFor(K.dark);
    contact.material.color.copy(lin(K.dark ? K.accent : K.ink));
    contact.material.blending = blendingFor(K.dark);
    pool.material.needsUpdate = contact.material.needsUpdate = true;
  });
  u.tick.push((st) => {
    const dk = c.palette().dark;
    contact.scale.setScalar(u.m.side * (c.vertex ? 0.95 : 1.5) * (1 - st.near * 0.17)); // 角を下なら、真下の 1 点の小さな影
    contact.material.opacity = (dk ? 0.32 : 0.13) * (0.75 + st.near * 0.35) * (1 + u.h * 0.5);
    pool.material.opacity = (dk ? 0.2 : 0.07) * (1 + u.h * 1.2);
  });
}

/** くぼみに沿う円盤(影・光だまり用)。平面の UV なので、やわらかい丸の画像がそのまま使える */
function dishDisc(radius: number, lift: number, c: UnitContext): Mesh<BufferGeometry, MeshBasicMaterial> {
  const geo = new RingGeometry(0.0005, radius, 96, 24);
  geo.rotateX(-Math.PI / 2);
  const p = geo.getAttribute("position") as Float32BufferAttribute;
  for (let k = 0; k < p.count; k++) p.setY(k, dishHeight(Math.hypot(p.getX(k), p.getZ(k))) + lift);
  geo.computeVertexNormals();
  return new Mesh(geo, new MeshBasicMaterial({ transparent: true, depthWrite: false, map: c.tex.soft }));
}

// ---------- 台座 ----------

function buildBase(u: Unit, c: UnitContext): void {
  const g = u.g;
  const B = c.base;
  const kind = c.look.base;
  if (kind === "dish" || kind === "plinth") {
    // 低い円柱 2 段。上の縁に青の細い光、下の縁に金の細い光。くぼみの台は、上の面を浅い皿の形にくぼませる(影と光だまりはくぼみの中)
    const dish = kind === "dish";
    const mat = new MeshStandardMaterial({ roughness: 0.62, metalness: 0.04, side: dish ? DoubleSide : FrontSide });
    const foot = new Mesh(new CylinderGeometry(0.535, 0.55, 0.035, 128), mat);
    foot.position.y = 0.0175;
    const body = new Mesh(new CylinderGeometry(0.47, 0.49, B.top - 0.035, 128, 1, dish), mat); // くぼみの台は上のふたなし
    body.position.y = 0.035 + (B.top - 0.035) / 2;
    const rimTop = ring(0.47, 0.0038);
    rimTop.position.y = B.top;
    const rimFoot = ring(0.54, 0.0028);
    rimFoot.position.y = 0.035;
    g.add(foot, body, rimTop, rimFoot);
    u.paint.push((K) => {
      mat.color.copy(lin(K.dark ? mix(K.raised, K.line, 0.7) : K.raised));
      mat.emissive.copy(lin(K.dark ? K.bg : "#000000"));
      rimTop.material.color.copy(lin(K.dark ? K.accentHover : K.accent));
      rimFoot.material.color.copy(lin(K.hl));
      rimFoot.material.opacity = K.dark ? 0.7 : 0.55;
    });
    if (!dish) {
      contactOn(u, c, B.top, 0.5);
      u.tick.push(() => (rimTop.material.opacity = (c.palette().dark ? 0.75 : 0.65) + u.h * 0.3));
      return;
    }
    const R = BASES.dish.R;
    const depth = BASES.dish.depth;
    const prof: Vector2[] = [];
    for (let k = 0; k <= 48; k++) {
      const r = (k / 48) * R;
      prof.push(new Vector2(Math.max(r, 0.0001), dishHeight(r)));
    }
    prof.push(new Vector2(0.47, B.top));
    // くぼみの面(回転体)。陰影がくぼみらしく出るよう、面の向き(法線)は上向きにそろえる
    let top = new LatheGeometry(prof, 160);
    top.computeVertexNormals();
    if (top.getAttribute("normal").getY(1) < 0) {
      top.dispose();
      top = new LatheGeometry(prof.slice().reverse(), 160);
      top.computeVertexNormals();
    }
    // くぼみの陰影を焼きこむ(台は回らず、正面をカメラに向けているので、台の中の +z が手前)。
    // 手前の内側の斜面を暗く、奥の斜面を明るく、深い所をわずかに暗く。少しだけ青みを帯びさせる(ロゴの青)
    const cols: number[] = [];
    const tp = top.getAttribute("position");
    const tn = top.getAttribute("normal");
    const Lf = new Vector3(0, 0.55, 0.85).normalize();
    for (let k = 0; k < tp.count; k++) {
      const dpt = Math.min(1, Math.max(0, (B.top - tp.getY(k)) / depth)); // 0 = 縁、1 = 真ん中
      const tilt = tn.getY(k) * Lf.y + tn.getZ(k) * Lf.z - Lf.y; // 平らな面と比べた光の当たり方の差
      if (Math.hypot(tp.getX(k), tp.getZ(k)) >= R - 1e-4) {
        cols.push(1, 1, 1); // 縁の平らな所は台と同じ
        continue;
      }
      const v = Math.min(1, Math.max(0.78, 0.95 + 1.2 * tilt - 0.12 * dpt));
      const cool = 0.5 + 0.5 * dpt;
      cols.push(v * (1 - 0.045 * cool), v * (1 - 0.025 * cool), v);
    }
    top.setAttribute("color", new Float32BufferAttribute(cols, 3));
    const topMat = new MeshStandardMaterial({ roughness: 0.55, metalness: 0.04, vertexColors: true, side: DoubleSide });
    const surface = new Mesh(top, topMat);
    const rimIn = ring(R, 0.0018); // くぼみの始まりの細い線(金)
    rimIn.position.y = B.top + 0.0005;
    const pool = dishDisc(0.36, 0.0015, c);
    const contact = dishDisc(0.2, 0.0025, c);
    g.add(surface, rimIn, pool, contact);
    u.paint.push((K) => {
      topMat.color.copy(lin(K.dark ? mix(K.raised, K.line, 0.55) : K.raised));
      topMat.emissive.copy(lin(K.dark ? K.bg : "#000000"));
      rimIn.material.color.copy(lin(K.hl));
      pool.material.color.copy(lin(K.accent));
      pool.material.blending = blendingFor(K.dark);
      contact.material.color.copy(lin(K.dark ? K.accent : K.ink));
      contact.material.blending = blendingFor(K.dark);
      pool.material.needsUpdate = contact.material.needsUpdate = true;
    });
    u.tick.push((st) => {
      const dk = c.palette().dark;
      rimTop.material.opacity = (dk ? 0.75 : 0.65) + u.h * 0.3;
      rimIn.material.opacity = (dk ? 0.5 : 0.4) + u.h * 0.25;
      pool.material.opacity = (dk ? 0.32 : 0.12) * (1 + u.h * 1.0);
      contact.material.opacity = (dk ? 0.4 : 0.16) * (0.75 + st.near * 0.35) * (1 + u.h * 0.5);
    });
  } else if (kind === "ring") {
    // 台はなく、Box の下に光る細い輪が浮かぶ(外に金の細い輪、輪の上を進む小さな点)
    const main = ring(0.34, 0.0032);
    const outer = ring(0.41, 0.0022);
    main.position.y = B.top;
    outer.position.y = B.top - 0.012;
    const halo = flat(new CircleGeometry(0.62, 96), c.tex.soft);
    halo.position.y = B.top - 0.004;
    const dots = points([0, 0, 0, 0, 0, 0], 4.6, c.tex.dot, true);
    dots.geometry.setAttribute("color", new Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
    g.add(halo, outer, main, dots);
    u.paint.push((K) => {
      main.material.color.copy(lin(K.dark ? K.accentHover : mix(K.accent, K.word1, 0.35)));
      outer.material.color.copy(lin(K.hl));
      halo.material.color.copy(lin(K.accent));
      halo.material.blending = blendingFor(K.dark);
      halo.material.needsUpdate = true;
      const A = lin(K.accent);
      const Bc = lin(K.hl);
      dots.geometry.setAttribute("color", new Float32BufferAttribute([Bc.r, Bc.g, Bc.b, A.r, A.g, A.b], 3));
    });
    const pos = dots.geometry.getAttribute("position") as Float32BufferAttribute;
    u.tick.push((st) => {
      const dk = c.palette().dark;
      main.material.opacity = (dk ? 0.85 : 0.8) + u.h * 0.2;
      outer.material.opacity = dk ? 0.6 : 0.5;
      halo.material.opacity = (dk ? 0.34 : 0.2) * (0.85 + st.near * 0.3) * (1 + u.h * 0.9);
      const a = st.still ? 0.9 : st.clock / 30 + u.phase;
      pos.setXYZ(0, Math.cos(a) * 0.34, B.top, Math.sin(a) * 0.34);
      pos.setXYZ(1, Math.cos(-a * 0.7 + 2) * 0.41, B.top - 0.012, Math.sin(-a * 0.7 + 2) * 0.41);
      pos.needsUpdate = true;
    });
  } else if (kind === "stone") {
    // 背の高い角柱。角を少し丸め、つや消し。足もとに影の目地(美術館の展示台)
    const w = 0.54;
    const r = 0.04;
    const bev = 0.018;
    const h = w / 2;
    const shape = new Shape();
    shape.moveTo(-h + r, -h);
    shape.lineTo(h - r, -h);
    shape.quadraticCurveTo(h, -h, h, -h + r);
    shape.lineTo(h, h - r);
    shape.quadraticCurveTo(h, h, h - r, h);
    shape.lineTo(-h + r, h);
    shape.quadraticCurveTo(-h, h, -h, h - r);
    shape.lineTo(-h, -h + r);
    shape.quadraticCurveTo(-h, -h, -h + r, -h);
    const height = B.top - 0.035;
    const geo = new ExtrudeGeometry(shape, { depth: height - 2 * bev, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 4, curveSegments: 10 });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0.035 + bev, 0);
    const mat = matteMaterial(B.top * 1.4);
    const gapMat = new MeshStandardMaterial({ roughness: 1, metalness: 0 });
    const gapBlock = new Mesh(new BoxGeometry(w - 0.03, 0.035, w - 0.03), gapMat);
    gapBlock.position.y = 0.0175;
    g.add(new Mesh(geo, mat), gapBlock);
    contactOn(u, c, B.top, 0.29);
    u.paint.push((K) => {
      mat.uniforms.uLit.value.copy(lin(K.dark ? mix(K.raised, K.lineStrong, 0.22) : mix(K.raised, K.hlSoft, 0.3)));
      mat.uniforms.uShade.value.copy(lin(K.dark ? mix(K.bg, K.raised, 0.6) : mix(K.hlSoft, K.line, 0.85)));
      mat.uniforms.uRimC.value.copy(lin(K.dark ? K.accentSoft : K.surface));
      gapMat.color.copy(lin(K.dark ? K.bg : mix(K.line, K.lineStrong, 0.35)));
    });
  } else {
    // 床と同じ高さの薄い円盤。Box の下に光だまり、縁に青の細い線、内側に金の点線
    const mat = new MeshStandardMaterial({ roughness: 0.5, metalness: 0.05 });
    const disc = new Mesh(new CylinderGeometry(0.62, 0.62, B.top, 128), mat);
    disc.position.y = B.top / 2;
    const edge = ring(0.62, 0.003);
    edge.position.y = B.top;
    const pool = flat(new CircleGeometry(0.56, 96), c.tex.soft);
    pool.position.y = B.top + 0.001;
    const inner = points(circlePts(0.44, 110, B.top + 0.002), 1.6, c.tex.dot);
    g.add(disc, edge, pool, inner);
    u.paint.push((K) => {
      mat.color.copy(lin(K.dark ? mix(K.raised, K.line, 0.6) : K.raised));
      mat.emissive.copy(lin(K.dark ? K.bg : "#000000"));
      edge.material.color.copy(lin(K.dark ? K.accentHover : K.accent));
      pool.material.color.copy(lin(K.accent));
      pool.material.blending = blendingFor(K.dark);
      pool.material.needsUpdate = true;
      inner.material.color.copy(lin(K.hl));
    });
    u.tick.push((st) => {
      const dk = c.palette().dark;
      edge.material.opacity = (dk ? 0.8 : 0.7) + u.h * 0.2;
      pool.material.opacity = (dk ? 0.42 : 0.2) * (0.8 + st.near * 0.35) * (1 + u.h * 0.7);
      inner.material.opacity = (dk ? 0.6 : 0.5) + u.h * 0.3;
    });
  }
}

// ---------- Box ----------

function buildBox(u: Unit, c: UnitContext): void {
  const s = u.m.side;
  const geo = new BoxGeometry(s, s, s);
  const E = cubeEdges(s);
  const eGeo = new LineSegmentsGeometry().setPositions(E.pos);
  const add = <T extends Mesh | LineSegments2 | ReturnType<typeof points>>(o: T, order: number): T => {
    o.renderOrder = order;
    u.orient.add(o);
    return o;
  };
  const line = (w: number, op: number) => {
    const m = lineMaterial(w, op);
    c.lines.push(m);
    return m;
  };
  // 奥の縁を薄くする仕掛け: 全部の縁を薄く描き、立方体の深さだけを書き、手前の縁を濃く重ねる
  const depthOnly = () => {
    const m = new Mesh(geo, new MeshBasicMaterial({ colorWrite: false, transparent: true, depthWrite: true }));
    m.scale.setScalar(0.985);
    return m;
  };
  const shape = c.look.shape;

  if (shape === "glass" || shape === "ribbon") {
    const back = add(new Mesh(geo, glassMaterial(BackSide, s, c.grad)), 1);
    const front = add(new Mesh(geo, glassMaterial(FrontSide, s, c.grad)), 6);
    const dim = add(new LineSegments2(eGeo, line(1.2, 0.3)), 3);
    add(depthOnly(), 4);
    const edges = add(new LineSegments2(eGeo, line(1.6, 1)), 5);
    const core = add(points([0, 0, 0], 5, c.tex.dot), 2);
    u.paint.push((K) => {
      paintGlass(back.material, front.material, K);
      eGeo.setColors(gradColors(E.pos, s, c.grad, K));
      core.material.color.copy(lin(K.dark ? K.hlStrong : K.hl));
    });
    u.tick.push(() => {
      back.material.uniforms.uGlow.value = front.material.uniforms.uGlow.value = u.h;
      edges.material.linewidth = 1.6 + u.h * 0.7;
      dim.material.opacity = 0.3 + u.h * 0.15;
    });
    if (shape === "ribbon") buildBands(u);
  } else if (shape === "solid") {
    // つや消しの立方体(明るい見た目は暖かい白、暗い見た目は深い紺)。縁に細い青と金
    const mat = matteMaterial(s, true);
    u.orient.add(new Mesh(geo, mat));
    const edges = add(new LineSegments2(eGeo, line(1.25, 0.95)), 5);
    u.paint.push((K) => {
      mat.uniforms.uLit.value.copy(lin(K.dark ? mix(K.accent, K.bg, 0.68) : mix(K.raised, K.hlSoft, 0.35)));
      mat.uniforms.uShade.value.copy(lin(K.dark ? mix(K.accent, K.bg, 0.88) : mix(K.hlSoft, K.line, 0.75)));
      mat.uniforms.uRimC.value.copy(lin(K.dark ? K.accent : K.accentSoft));
      eGeo.setColors(gradColors(E.pos, s, c.grad, K, 0.1));
    });
    u.tick.push(() => {
      mat.uniforms.uGlow.value = u.h;
      edges.material.linewidth = 1.25 + u.h * 0.6;
    });
  } else {
    // 光る縁だけの立方体。面は点の並び、角に点
    const halo = add(new LineSegments2(eGeo, line(6, 0.1)), 3);
    const dim = add(new LineSegments2(eGeo, line(1.2, 0.32)), 3);
    add(depthOnly(), 4);
    const edges = add(new LineSegments2(eGeo, line(1.9, 1)), 5);
    const n = 6;
    const fp: number[] = [];
    for (let f = 0; f < 6; f++) {
      const ax = f >> 1;
      const sg = f % 2 ? 1 : -1;
      for (let a = 1; a < n; a++)
        for (let b = 1; b < n; b++) {
          const v = [0, 0, 0];
          v[ax] = (sg * s) / 2;
          v[(ax + 1) % 3] = (a / n - 0.5) * s;
          v[(ax + 2) % 3] = (b / n - 0.5) * s;
          fp.push(...v);
        }
    }
    const faceDots = add(points(fp, 1.7, c.tex.dot, true), 2);
    const cornerDots = add(points(E.corners, 6, c.tex.dot, true), 2);
    const core = add(points([0, 0, 0], 5, c.tex.dot), 2);
    u.paint.push((K) => {
      eGeo.setColors(gradColors(E.pos, s, c.grad, K));
      faceDots.geometry.setAttribute("color", new Float32BufferAttribute(gradColors(fp, s, c.grad, K), 3));
      cornerDots.geometry.setAttribute("color", new Float32BufferAttribute(gradColors(E.corners, s, c.grad, K, 0.1), 3));
      faceDots.material.opacity = K.dark ? 0.55 : 0.5;
      halo.material.blending = blendingFor(K.dark);
      halo.material.needsUpdate = true;
      core.material.color.copy(lin(K.dark ? K.hlStrong : K.hl));
    });
    u.tick.push(() => {
      edges.material.linewidth = 1.9 + u.h * 0.6;
      halo.material.opacity = (c.palette().dark ? 0.16 : 0.08) * (1 + u.h * 1.2);
      dim.material.opacity = 0.32 + u.h * 0.15;
    });
  }
}

/** Box のまわりを、ロゴの青と金の帯が囲む。帯はそれぞれ自分の軸のまわりに、Box とは別にゆっくり回る(Box と一緒に上下にゆれる) */
function buildBands(u: Unit): void {
  const center = new Vector3();
  const bands = u.m.bands.map((d) => {
    const holder = new Group();
    holder.rotation.set(d.tilt, d.yaw, 0, "YXZ"); // 傾けてから、向きを変える
    const geo = ribbonGeometry(d);
    const backHalf = new Mesh(geo, ribbonMaterial(-1, center));
    backHalf.renderOrder = 0; // ガラスの奥の面より先
    const frontHalf = new Mesh(geo, ribbonMaterial(1, center));
    frontHalf.renderOrder = 7; // ガラスの手前の面よりあと
    const turn = new Group(); // 自分の軸(輪の面に垂直)のまわりに回る
    turn.add(backHalf, frontHalf);
    holder.add(turn);
    u.lift.add(holder);
    return { d, turn, mats: [backHalf.material, frontHalf.material] };
  });
  u.paint.push((K) => {
    for (const b of bands) {
      const col = b.d.id === "b" ? K.hl : b.d.id === "a2" ? (K.dark ? K.accentHover : K.word1) : K.accent;
      const al = K.dark ? (b.d.id === "a2" ? 0.42 : 0.55) : b.d.id === "b" ? 0.62 : b.d.id === "a2" ? 0.42 : 0.52;
      for (const m of b.mats) {
        m.uniforms.uC.value.copy(lin(col));
        m.uniforms.uA.value = al;
        m.blending = blendingFor(K.dark);
        m.needsUpdate = true;
      }
    }
  });
  u.tick.push((st) => {
    u.lift.getWorldPosition(center); // 帯を奥と手前に分ける面の中心(Box の中心)
    for (const b of bands) {
      b.turn.rotation.y = st.still ? b.d.ph : b.d.ph + st.clock * b.d.spd * Math.PI * 2;
      for (const m of b.mats) m.uniforms.uGlow.value = u.h;
    }
  });
}

/** 浮く高さ・回転・ゆれ・光り方を、今の時刻と状態で決める(毎回の描画)。want = ポインターが乗った・選ばれた(1)か(0) */
export function updateUnit(u: Unit, want: number, dt: number, clock: number, still: boolean, turnSeconds: number): void {
  u.h += (want - u.h) * (still ? 1 : 1 - Math.exp(-dt * 7));
  const bob = still ? 0 : Math.sin((clock / 6.2) * Math.PI * 2 + u.phase) * BOB_AMPLITUDE;
  u.lift.position.y = u.m.yC + bob + u.h * HOVER_LIFT;
  // 動きを減らす設定では止める。どの Box も斜め(2 つの面が見える角度)で止める
  u.spin.rotation.y = still ? 0.6 + (u.i % 2) * 0.12 : u.ang + (clock / turnSeconds) * Math.PI * 2;
  const st: TickState = { clock, still, near: 1 - (bob + u.h * HOVER_LIFT + 0.04) / 0.16 };
  for (const f of u.tick) f(st);
}
