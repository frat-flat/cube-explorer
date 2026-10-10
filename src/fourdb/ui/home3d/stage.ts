// 立体のホームの舞台(mountStage)。three r128 の描く部品・カメラ・毎回の描画・見張り(大きさ・明暗・動き・見えているか)・ポインターを持つ。
//
// DOM で触ってよいのは次だけ(利用者の文字を innerHTML に入れない):
//   自分で作った <canvas>(canvasHost の中)・backdrop の SVG(数値だけで組み立てる)・札の style.transform と --k・
//   others の style.top・root の data-label / data-mode / data-motion / data-ready。
//
// 札(labels[i])は、画面が描いた「位置を決める入れ物」(position: absolute; left: 0; top: 0)。ここは transform で動かすだけ。
// 札の基準の点は root の data-label で変わる(画面の CSS が中の札を寄せる):
//   below = 札の上の中央(translateX(-50%))、front = 札の中央(translate(-50%, -50%))、float = 札の下の中央(translate(-50%, -100%))。
// --k は札の大きさの倍率: front のときは台の正面の大きさに合わせた値(0.42〜1.5)、below・float のときは 1(札が重なるときだけ TIGHT_K)。
import { PerspectiveCamera, Raycaster, Vector2, WebGLRenderer, sRGBEncoding } from "three";
import { parseLookLenient, type Look, type WorldId } from "@/fourdb/core/prefs";
import { clearBackdrop, drawLogoBackdrop } from "./backdrop";
import { Framer, MARGIN, freeRects, largest, type Fit, type Rect } from "./framing";
import { readPalette, type Palette } from "./palette";
import { buildScene, type SceneModel } from "./scene";
import { createTextures } from "./textures";
import type { LabelModeReason, Stage, StageCallbacks, StageElements } from "./types";
import { createWorld } from "./world";

/** 画角(狭くして、ゆがみの少ない落ち着いた見え方に) */
const FOV_DEG = 16;
/** 札が重なるときの、札の大きさの倍率(below・float) */
export const TIGHT_K = 0.8;
/** 台の正面の文字の倍率(1 = 名前が 12.5px)。これより小さいと読みにくいので、台の下に出す */
const KMIN = 0.74;
/** 単位の数の上限(規則 R) */
const MAX_UNITS = 6;

const sameLook = (a: Look, b: Look) => a.shape === b.shape && a.tilt === b.tilt && a.base === b.base && a.label === b.label && a.bg === b.bg && a.layout === b.layout;

export function mountStage(els: StageElements, unitCount: number, look: Look, world: WorldId, cb: StageCallbacks): Stage {
  const { root } = els;
  const n = Math.max(0, Math.min(MAX_UNITS, Math.floor(unitCount)));
  const labels = els.labels.slice(0, n);
  const others = els.others;

  // ---- canvas と描く部品(mount のたびに新しく作る) ----
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = "display:block;width:100%;height:100%;outline:none";
  els.canvasHost.appendChild(canvas);
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  } catch (e) {
    canvas.remove();
    throw e instanceof Error ? e : new Error("WebGL を使えません");
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = sRGBEncoding;
  renderer.setClearColor(0x000000, 0);

  const cleanups: (() => void)[] = [];
  const on = <T extends EventTarget>(t: T, ev: string, fn: (e: Event) => void, opts?: AddEventListenerOptions) => {
    t.addEventListener(ev, fn, opts);
    cleanups.push(() => t.removeEventListener(ev, fn, opts));
  };

  // ここから先で作れなかったとき(2D の描画が使えない など)は、作った物を捨ててから throw する
  try {
    const tex = createTextures();
    cleanups.push(() => tex.dispose());
    const camera = new PerspectiveCamera(FOV_DEG, 1, 0.1, 600);
    const worldFx = createWorld(world);
    let K: Palette = readPalette();
    // 見た目は芯のゆるい読み方で写す(知らない値・足りない部品は既定の値。呼ぶ側のまちがいで落ちないように)
    let current: Look = parseLookLenient(look);
    let model: SceneModel = buildScene(current, n, { tex, pixelRatio: renderer.getPixelRatio(), palette: () => K });
    worldFx?.attach(model.scene);
    const framer = new Framer(camera, model);
    framer.fovDeg = worldFx?.view.fovDeg ?? FOV_DEG;

    // ---- 状態 ----
    let disposed = false;
    let lost = false;
    let selected = -1;
    let hot = -1;
    let view = -1;
    let pointerHot = -1;
    let W = 1;
    let H = 1;
    const cur = { d: 8, ox: 0, oy: 0 };
    const goal = { d: 8, ox: 0, oy: 0 };
    const par = { x: 0, y: 0, tx: 0, ty: 0 };
    let first = true;
    const reduceMq = window.matchMedia("(prefers-reduced-motion: reduce)");
    let still = reduceMq.matches;
    let clock = 0;
    let last = performance.now();
    let visible = true;
    let raf = 0;
    let ready = false;
    let labelMode: Look["label"] = "below";
    let reported: [Look["label"], LabelModeReason] | null = null;
    let tight = false;
    const kNow: number[] = [];
    // 背景の十字の中心(空いている所の真ん中の横・Box の中心の高さ)。カメラが寄っていく間は、SVG をその差だけずらしてついていく
    let backdropCx = 0;
    let backdropCy = 0;
    let backdropSvg: SVGElement | null = null;
    let backdropShift = "";

    root.dataset.mode = "3d";
    root.dataset.motion = still ? "still" : "live";

    // ---- 札 ----
    function setK(i: number, k: number) {
      const el = labels[i];
      if (!el || Math.abs((kNow[i] ?? -1) - k) <= 0.004) return;
      kNow[i] = k;
      el.style.setProperty("--k", k.toFixed(3));
    }
    /** below・float の札の大きさ(1 か TIGHT_K)を、全部の札に */
    function applyFlatK() {
      if (labelMode !== "front") labels.forEach((_, i) => setK(i, tight ? TIGHT_K : 1));
    }
    function setTight(v: boolean) {
      tight = v;
      applyFlatK();
    }
    function setLabelMode(mode: Look["label"], why: LabelModeReason) {
      if (mode !== labelMode || !root.dataset.label) {
        labelMode = mode;
        framer.labelMode = mode;
        root.dataset.label = mode;
        kNow.length = 0;
        if (mode !== "front") applyFlatK();
      }
      if (!reported || reported[0] !== mode || reported[1] !== why) {
        reported = [mode, why];
        try {
          cb.onLabelMode(mode, why);
        } catch (e) {
          console.error(e);
        }
      }
    }
    /** 札の大きさを計る(--k を変えたあとに呼ぶ。描き直しの前に同期して読む) */
    function measureLabels() {
      const sizes = labels.map((el): [number, number] => [el.offsetWidth, el.offsetHeight]);
      framer.sizes = sizes;
      framer.LW = Math.max(0, ...sizes.map((s) => s[0])) || framer.LW;
      framer.LH = Math.max(0, ...sizes.map((s) => s[1])) || framer.LH;
    }
    const kOf = (faceH: number) => (faceH * 0.78) / (current.base === "stone" ? 118 : 26);

    // ---- 背景の飾り(ロゴの線だけ。十字の横の線は Box の中心の高さ) ----
    function drawBackdrop() {
      if (disposed) return;
      backdropShift = "";
      if (current.bg === "logo") backdropSvg = drawLogoBackdrop(els.backdrop, W, H, backdropCx || W / 2, backdropCy || H * 0.44);
      else {
        clearBackdrop(els.backdrop);
        backdropSvg = null;
      }
      followBackdrop();
    }

    function followBackdrop() {
      if (!backdropSvg) return;
      const dx = goal.ox - cur.ox;
      const dy = goal.oy - cur.oy;
      const t = Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 ? "" : `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
      if (t !== backdropShift) {
        backdropShift = t;
        backdropSvg.style.transform = t;
      }
    }

    // ---- よける四角(開いている右の欄・Visual の欄)を、舞台の中の px に ----
    function occluders(): Rect[] {
      let list: DOMRect[] = [];
      try {
        list = cb.occluders() ?? [];
      } catch (e) {
        console.error(e);
      }
      const rr = root.getBoundingClientRect();
      return list
        .map((r) => ({ x0: r.left - rr.left, y0: r.top - rr.top, x1: r.right - rr.left, y1: r.bottom - rr.top }))
        .filter((r) => r.x1 - r.x0 > 1 && r.y1 - r.y0 > 1 && r.x1 > 0 && r.y1 > 0 && r.x0 < W && r.y0 < H);
    }

    // ---- カメラの収め方 ----
    function computeGoal() {
      if (disposed) return;
      if (!n) {
        invalidate(); // 単位がなくても 1 回は描いて data-ready にする
        return;
      }
      // 作ったばかりの物は、最初に描くまで位置(matrixWorld)が決まっていない。計る前に決める
      model.scene.updateMatrixWorld();
      framer.W = W;
      framer.H = H;
      camera.fov = framer.fovDeg;
      camera.aspect = W / H;
      const occ = occluders();
      const area: Rect = { x0: MARGIN.l, y0: MARGIN.t, x1: W - MARGIN.r, y1: H - MARGIN.b };
      const rects = freeRects(area, occ);
      // 「台の正面」は、正面のある台座で、文字が読める大きさのときだけ。小さすぎれば台の下に
      if (current.label === "front" && model.hasFace) {
        framer.labelMode = "front";
        const f0 = framer.choose(rects);
        framer.bounds(f0.d);
        const ok = kOf(framer.labelAt(model.units[0]).faceH) >= KMIN;
        framer.labelMode = labelMode;
        setLabelMode(ok ? "front" : "below", ok ? "" : "too-small");
      }
      const measurable = labelMode !== "front";
      setTight(false);
      if (measurable) measureLabels();
      let f: Fit = framer.choose(rects);
      let focus = -1;
      if (measurable && f.clash) {
        const fi = view >= 0 ? view : selected;
        if (fi >= 0 && occ.length) {
          // 欄が開いていて全部は収まらない: 大きさは欄がないときのまま、選んだ Box(札にフォーカスがあればその Box)を空いている所の真ん中に
          const full = framer.choose([area]);
          f = { d: full.d, r: largest(rects), clash: full.clash };
          focus = fi;
        } else {
          // 札が重ならない収め方がない: 札を小さめにして収め直す
          setTight(true);
          measureLabels();
          f = framer.choose(rects);
        }
      }
      const b = framer.bounds(f.d);
      const cx = (f.r.x0 + f.r.x1) / 2;
      const cy = (f.r.y0 + f.r.y1) / 2;
      goal.d = f.d;
      goal.ox = (focus >= 0 && model.units[focus] ? framer.labelAt(model.units[focus]).px : (b.x0 + b.x1) / 2) - cx;
      goal.oy = (b.y0 + b.y1) / 2 - cy;
      backdropCx = cx;
      backdropCy = model.units.reduce((a, u) => a + framer.proj(u, 0, u.m.yC, 0)[1], 0) / n - goal.oy;
      if (first || still) Object.assign(cur, goal);
      drawBackdrop();
      first = false;
      invalidate();
    }

    function resize() {
      if (disposed) return;
      W = Math.max(1, root.clientWidth);
      H = Math.max(1, root.clientHeight);
      renderer.setSize(W, H, false);
      for (const m of model.lines) m.resolution.set(W, H);
      computeGoal();
    }

    /** 見た目を変える: 場面だけ作り直す(描く部品は使い回す) */
    function rebuild(l: Look) {
      worldFx?.detach(model.scene);
      model.dispose();
      renderer.renderLists.dispose();
      current = { ...l };
      model = buildScene(current, n, { tex, pixelRatio: renderer.getPixelRatio(), palette: () => K });
      worldFx?.attach(model.scene);
      framer.model = model;
      afterBuild();
      first = true;
      resize();
    }
    function afterBuild() {
      framer.elevation = worldFx?.view.elevation ?? model.elevation;
      model.paint(K);
      for (const m of model.lines) m.resolution.set(W, H);
      const noFace = current.label === "front" && !model.hasFace;
      setLabelMode(noFace ? "below" : current.label, noFace ? "no-face" : "");
    }

    // ---- 明暗が変わったら塗り直す ----
    function repaint() {
      if (disposed) return;
      K = readPalette();
      model.paint(K);
      invalidate();
    }

    // ---- 毎回の描画 ----
    const canRun = () => !disposed && !lost && visible && !document.hidden;
    function wake() {
      if (raf || !canRun()) return;
      last = performance.now(); // 止まっていた間の時間を飛ばさない
      raf = requestAnimationFrame(frame);
    }
    function invalidate() {
      wake();
    }
    const want = (i: number) => (i === hot || i === pointerHot || i === selected ? 1 : 0);
    function positionLabels() {
      let lowest = 0;
      for (const u of model.units) {
        const el = labels[u.i];
        if (!el) continue;
        const L = framer.labelAt(u, u.lift.position.y);
        el.style.transform = `translate(${L.px.toFixed(1)}px, ${L.py.toFixed(1)}px)`;
        if (labelMode === "front") setK(u.i, Math.max(0.42, Math.min(1.5, kOf(L.faceH))));
        if (others) lowest = Math.max(lowest, labelMode === "below" ? L.py + (framer.sizes[u.i]?.[1] ?? framer.LH) : framer.proj(u, 0, 0, model.orbit)[1]);
      }
      if (others) others.style.top = `${Math.round(lowest + 18)}px`;
    }
    function frame(now: number) {
      raf = 0;
      if (!canRun()) return;
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      if (!still) clock += dt;
      const ease = still ? 1 : 1 - Math.exp(-dt * 5);
      cur.d += (goal.d - cur.d) * ease;
      cur.ox += (goal.ox - cur.ox) * ease;
      cur.oy += (goal.oy - cur.oy) * ease;
      const pe = still ? 1 : 1 - Math.exp(-dt * 2.5);
      par.x += ((still ? 0 : par.tx) - par.x) * pe;
      par.y += ((still ? 0 : par.ty) - par.y) * pe;
      camera.aspect = W / H;
      camera.setViewOffset(W, H, cur.ox, cur.oy, W, H);
      framer.place(cur.d, par.x * 0.045, framer.elevation - par.y * 0.025);
      camera.updateMatrixWorld();
      camera.updateProjectionMatrix();
      model.update(dt, clock, still, want);
      positionLabels();
      followBackdrop();
      renderer.render(model.scene, camera);
      if (!ready) {
        ready = true;
        root.dataset.ready = "true";
      }
      // 動きを減らす設定では、変化のあるときだけ描く
      if (!still) raf = requestAnimationFrame(frame);
    }

    // ---- ポインター: 少しだけ視差。Box の上で明るく、押すと選ぶ ----
    const ray = new Raycaster();
    const ndc = new Vector2();
    function pick(e: MouseEvent): number {
      const r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return -1;
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const h = ray.intersectObjects(model.hits, false)[0];
      return h ? (h.object.userData.i as number) : -1;
    }
    const setPointerHot = (i: number) => {
      if (i === pointerHot) return;
      pointerHot = i;
      canvas.style.cursor = i >= 0 ? "pointer" : "";
      try {
        cb.onHover(i);
      } catch (err) {
        console.error(err);
      }
      invalidate();
    };
    on(canvas, "pointermove", (e) => {
      const pe = e as PointerEvent;
      const i = pick(pe);
      par.tx = ndc.x;
      par.ty = ndc.y;
      setPointerHot(i);
    });
    on(canvas, "pointerleave", () => {
      par.tx = par.ty = 0;
      setPointerHot(-1);
    });
    on(canvas, "click", (e) => {
      const i = pick(e as MouseEvent);
      if (i >= 0) cb.onPick(i);
    });

    // ---- 見張り ----
    const ro = new ResizeObserver(() => resize());
    ro.observe(root);
    cleanups.push(() => ro.disconnect());
    const mo = new MutationObserver(repaint);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    cleanups.push(() => mo.disconnect());
    on(window.matchMedia("(prefers-color-scheme: dark)"), "change", repaint);
    on(reduceMq, "change", () => {
      still = reduceMq.matches;
      root.dataset.motion = still ? "still" : "live";
      if (still) {
        Object.assign(cur, goal);
        par.tx = par.ty = 0;
      }
      invalidate();
    });
    if (typeof IntersectionObserver !== "undefined") {
      const io = new IntersectionObserver((entries) => {
        const e = entries[entries.length - 1];
        visible = !!e && e.isIntersecting;
        wake();
      });
      io.observe(root);
      cleanups.push(() => io.disconnect());
    }
    on(document, "visibilitychange", () => wake());
    on(canvas, "webglcontextlost", () => {
      if (disposed) return;
      lost = true;
      cancelAnimationFrame(raf);
      raf = 0;
      try {
        cb.onLost();
      } catch (e) {
        console.error(e);
      }
    });
    document.fonts?.ready.then(() => {
      if (disposed) return;
      first = true;
      resize();
    });

    // ---- はじめ ----
    afterBuild();
    resize();
    wake();

    function dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      raf = 0;
      for (const f of cleanups.splice(0)) f();
      worldFx?.detach(model.scene);
      worldFx?.dispose();
      model.dispose();
      renderer.renderLists.dispose();
      renderer.dispose();
      // 文脈をすでに失っていれば手放すものがない(呼ぶと THREE が警告を出す)
      if (!lost) renderer.forceContextLoss();
      canvas.remove();
      clearBackdrop(els.backdrop);
      for (const el of labels) {
        el.style.transform = "";
        el.style.removeProperty("--k");
      }
      if (others) others.style.top = "";
      delete root.dataset.label;
      delete root.dataset.motion;
      delete root.dataset.ready;
    }

    const index = (i: number) => (Number.isInteger(i) && i >= 0 && i < n ? i : -1);
    return {
      setLook(l) {
        if (disposed) return;
        const next = parseLookLenient(l);
        if (sameLook(next, current)) return;
        rebuild(next);
      },
      setSelected(i) {
        if (disposed) return;
        selected = index(i);
        computeGoal();
      },
      setHot(i) {
        if (disposed) return;
        hot = index(i);
        invalidate();
      },
      setView(i) {
        if (disposed) return;
        view = index(i);
        computeGoal();
      },
      reframe() {
        if (disposed) return;
        computeGoal();
      },
      dispose,
    };
  } catch (e) {
    for (const f of cleanups.splice(0)) f();
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
    throw e;
  }
}

/** WebGL を使えるか(試しに作った文脈はすぐ手放す) */
export function canUseWebGL(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl2") ?? c.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

