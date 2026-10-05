// 立体ビュー:行=縦(y)、列=横(x)、奥行き=奥(z)。表に出している面とコマを光らせる
const Cube3D = (() => {
  const host = document.getElementById("cube3d");
  const tip = document.getElementById("cube-tip");
  if (!window.THREE || !(() => { try { return !!document.createElement("canvas").getContext("webgl"); } catch { return false; } })()) {
    host.insertAdjacentHTML("beforeend", '<p class="cube-fallback">この環境では3D表示を使えません。表は下で見られます。</p>');
    return { update() {} };
  }
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const tok = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 2000);
  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  scene.add(new THREE.AmbientLight(0xffffff, 0.8));
  const sun = new THREE.DirectionalLight(0xffffff, 0.55);
  sun.position.set(6, 12, 10);
  scene.add(sun);

  const world = new THREE.Group();   // コマ
  const marks = new THREE.Group();   // 面の枠・光るコマ
  const labels = new THREE.Group();  // 軸ラベル
  scene.add(world, marks, labels);
  // ピンポイントで触れているもの(コマ・行・列・奥行きの1枚)を囲う枠
  const hoverBox = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthTest: false }));
  hoverBox.renderOrder = 30; hoverBox.visible = false;
  scene.add(hoverBox);
  const boxGeo = new THREE.BoxGeometry(0.78, 0.78, 0.78);

  let dims = { nR: 1, nC: 1, nZ: 1 };
  let solid = null, ghost = null, solidIdx = [], ghostIdx = [];
  let structKey = "", glowMats = [];
  let ctx = null; // 直近の update に渡された情報

  // 座標:目盛りの番号 → 3D の位置(中心が原点)
  const pos = (r, c, k) => new THREE.Vector3(
    c - (dims.nC - 1) / 2,
    (dims.nR - 1) / 2 - r,
    (dims.nZ - 1) / 2 - k,
  );

  function disposeGroup(g) {
    for (const o of [...g.children]) {
      g.remove(o);
      o.geometry && o.geometry !== boxGeo && o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.map && m.map.dispose(); m.dispose(); });
    }
  }

  // ── 軸ラベル(HTML を重ねる)──────────────────────────
  // 毎フレーム、各軸について「画面上でキューブの外周にある辺」を選び、その外側にラベルを置く。
  // こうするとどの角度から見てもラベルがコマに重ならない。行・列・奥行きは色で見分ける
  const overlay = document.createElement("div");
  overlay.className = "cube-labels";
  host.appendChild(overlay);
  const AXIS_COLOR = { y: "--ax-row", x: "--ax-col", z: "--ax-depth" };
  let axisSets = [];

  function buildLabels(R, C, Z) {
    overlay.innerHTML = "";
    disposeGroup(labels);
    const { nR, nC, nZ } = dims;
    const hx = nC / 2, hy = nR / 2, hz = nZ / 2;
    const make = (dir, A, n, prefix) => {
      const color = new THREE.Color(tok(AXIS_COLOR[dir]));
      // 同じ向きの4本の辺(候補)
      const signs = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
      const edges = signs.map(([a, b]) => {
        const at = t => dir === "x" ? new THREE.Vector3(t, a * (hy + 0.06), b * (hz + 0.06))
          : dir === "y" ? new THREE.Vector3(a * (hx + 0.06), t, b * (hz + 0.06))
          : new THREE.Vector3(a * (hx + 0.06), b * (hy + 0.06), t);
        const half = dir === "x" ? hx : dir === "y" ? hy : hz;
        const geo = new THREE.BufferGeometry().setFromPoints([at(-half), at(half)]);
        const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest: false }));
        line.renderOrder = 12;
        line.visible = false;
        labels.add(line);
        return { at, line };
      });
      const coordOf = i => dir === "x" ? i - (nC - 1) / 2 : dir === "y" ? (nR - 1) / 2 - i : (nZ - 1) / 2 - i;
      const items = A.members.map((m, i) => {
        const el = document.createElement("span");
        el.className = `cl cl-${dir}`;
        el.textContent = A.name(m);
        el.addEventListener("pointerenter", () => hoverSlab(dir, i));
        el.addEventListener("pointerleave", hideHover);
        el.addEventListener("click", () => { hideHover(); ctx && ctx.onAxisPick && ctx.onAxisPick(dir, i); });
        overlay.appendChild(el);
        return { el, t: coordOf(i), i, w: 0, h: 0 };
      });
      const titleEl = document.createElement("span");
      titleEl.className = `cl-title cl-${dir}`;
      titleEl.textContent = `${prefix}:${A.label}`;
      overlay.appendChild(titleEl);
      const half = dir === "x" ? hx : dir === "y" ? hy : hz;
      return { dir, edges, items, titleEl, half, chosen: -1, pending: -1, pendingSince: 0, step: 0 };
    };
    axisSets = [make("y", R, nR, "行"), make("x", C, nC, "列"), make("z", Z, nZ, "奥行き")];
    // 大きさを一度だけ測る
    for (const set of axisSets) for (const it of set.items) { it.w = it.el.offsetWidth; it.h = it.el.offsetHeight; }
  }

  const toScreen = (v, w, h) => {
    const p = v.clone().project(camera);
    return { x: (p.x + 1) / 2 * w, y: (1 - p.y) / 2 * h, z: p.z };
  };

  // ラベルの切り替え方(鈍く、でもキューブには重ねない):
  // 回していくと、今の辺のラベルが手前から順にキューブの輪郭にかかり始める。
  // かかる手前で1枚ずつ消していき(コマの並びと連動して隠れていく)、
  // 消えたラベルが半分を超えたときに初めて別の辺へ乗り換える。
  const SWITCH_HIDDEN_RATIO = 0.5; // 今の辺のラベルがこの割合以上隠れたら乗り換える
  const CLEAR_PX = 6;              // キューブの輪郭からこれだけ離れていないラベルは隠す
  const STEP_RELAX = 0.5;          // 間引きを減らすのは、必要な間隔が今の半分以下になってから

  function fadeIn(set) {
    for (const el of [...set.items.map(it => it.el), set.titleEl]) {
      el.classList.remove("fade"); void el.offsetWidth; el.classList.add("fade");
    }
  }

  // 画面上のキューブの輪郭(8つの角の凸包)
  function hullOf(pts) {
    const p = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lo = [], up = [];
    for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    for (const q of p.reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }
  // 矩形(余白つき)が輪郭に触れるか(分離軸で判定)
  function hitsHull(r, hull, pad) {
    const rx0 = r.x - pad, ry0 = r.y - pad, rx1 = r.x + r.w + pad, ry1 = r.y + r.h + pad;
    const rp = [{ x: rx0, y: ry0 }, { x: rx1, y: ry0 }, { x: rx1, y: ry1 }, { x: rx0, y: ry1 }];
    const axes = [{ x: 1, y: 0 }, { x: 0, y: 1 }];
    for (let i = 0; i < hull.length; i++) {
      const a = hull[i], b = hull[(i + 1) % hull.length];
      axes.push({ x: -(b.y - a.y), y: b.x - a.x });
    }
    for (const ax of axes) {
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const q of rp) { const d = q.x * ax.x + q.y * ax.y; a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
      for (const q of hull) { const d = q.x * ax.x + q.y * ax.y; b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
      if (a1 < b0 || b1 < a0) return false;
    }
    return true;
  }

  function layoutLabels() {
    if (!axisSets.length) return;
    const w = host.clientWidth, h = host.clientHeight;
    const c0 = toScreen(new THREE.Vector3(0, 0, 0), w, h);
    const { nR, nC, nZ } = dims;
    const hx = nC / 2 + 0.06, hy = nR / 2 + 0.06, hz = nZ / 2 + 0.06;
    const corners = [];
    for (const a of [-1, 1]) for (const b of [-1, 1]) for (const c of [-1, 1]) corners.push(toScreen(new THREE.Vector3(a * hx, b * hy, c * hz), w, h));
    const hull = hullOf(corners);
    const used = []; // 他の軸のラベルと重ならないように、置いた矩形を覚えておく
    const cross = (r, u) => r.x < u.x + u.w && r.x + r.w > u.x && r.y < u.y + u.h && r.y + r.h > u.y;
    const overlaps = r => used.some(u => cross(r, u));
    // ラベルを出せない場所:キューブの輪郭の近く・枠の外・下の案内文の上
    const hintR = hint.hidden ? null : { x: hint.offsetLeft, y: hint.offsetTop, w: hint.offsetWidth, h: hint.offsetHeight };
    const blocked = (r, pad) => hitsHull(r, hull, pad) || r.x < 0 || r.y < 0 || r.x + r.w > w || r.y + r.h > h || (hintR && cross(r, hintR));

    for (const set of axisSets) {
      const n = set.items.length;
      // ある辺にラベルを置いたらどうなるかを計算する
      const evalEdge = (idx, step) => {
        const edge = set.edges[idx];
        const a = toScreen(edge.at(-set.half), w, h), b = toScreen(edge.at(set.half), w, h);
        const mid = toScreen(edge.at(0), w, h);
        let ex = b.x - a.x, ey = b.y - a.y; const len = Math.hypot(ex, ey) || 1; ex /= len; ey /= len;
        // 外向き:辺に垂直で、中心から離れる向き
        let ox = -ey, oy = ex;
        if ((mid.x - c0.x) * ox + (mid.y - c0.y) * oy < 0) { ox = -ox; oy = -oy; }
        // 矩形のいちばん辺に近い角が、辺から gap だけ離れるように置く
        const place = (p, ww, hh, gap) => {
          const d = gap + Math.abs(ox) * ww / 2 + Math.abs(oy) * hh / 2;
          return { x: p.x + ox * d - ww / 2, y: p.y + oy * d - hh / 2, w: ww, h: hh };
        };
        const pitch = n > 1 ? len / (n - 1) : Infinity; // 目盛り1つ分の画面上の長さ
        const need = Math.max(...set.items.map(it => Math.abs(ex) * it.w + Math.abs(ey) * it.h)) + 6;
        const want = Math.max(1, Math.ceil(need / pitch));
        const st = step || want;
        const rows = [];
        let shown = 0, clash = 0;
        for (const it of set.items) {
          const sel = it.el.classList.contains("sel");
          if (!(it.i % st === 0 || sel)) { rows.push({ it, show: false }); continue; }
          const r = place(toScreen(edge.at(it.t), w, h), it.w, it.h, 12);
          const hit = blocked(r, CLEAR_PX);
          shown++; if (hit) clash++;
          rows.push({ it, show: true, r, hit });
        }
        const score = Math.hypot(mid.x - c0.x, mid.y - c0.y) - mid.z * 0.5;
        return { idx, edge, place, ex, ey, want, rows, shown, clash, ratio: shown ? clash / shown : 1, score };
      };

      // 辺を選ぶ:今の辺のラベルが半分以上隠れるまでは動かさない
      let cur = set.chosen >= 0 ? evalEdge(set.chosen, set.step) : null;
      if (!cur || cur.ratio >= SWITCH_HIDDEN_RATIO) {
        const cands = set.edges.map((_, i) => evalEdge(i, 0))
          .sort((p, q) => (p.ratio - q.ratio) || (q.score - p.score));
        const next = cands[0];
        if (!cur || (next.idx !== cur.idx && next.ratio < cur.ratio - 0.2)) {
          const switched = !!cur;
          set.chosen = next.idx; set.step = next.want;
          cur = evalEdge(set.chosen, set.step);
          if (switched) fadeIn(set);
        }
      }
      // 間引き:増やすのはすぐ(重なり防止)、減らすのは十分に余裕ができてから
      if (!set.step || cur.want > set.step || cur.want <= Math.floor(set.step * STEP_RELAX)) {
        set.step = cur.want;
        cur = evalEdge(set.chosen, set.step);
      }
      set.edges.forEach((e, i) => { e.line.visible = i === set.chosen; });

      let shownOk = 0;
      for (const row of cur.rows) {
        const el = row.it.el;
        el.style.visibility = row.show ? "visible" : "hidden";
        if (!row.show) continue;
        el.style.transform = `translate(${row.r.x}px, ${row.r.y}px)`;
        // キューブや他の軸のラベルにかかりそうなラベルは消す(重ねない)
        const off = row.hit || overlaps(row.r);
        el.style.opacity = off ? "0" : "";
        el.style.pointerEvents = off ? "none" : "";
        if (!off) { used.push(row.r); shownOk++; }
      }
      set.hidden = n - shownOk;

      // 軸の名前:辺の終わりの先。他のラベル・キューブ・案内文と重なるなら外側へずらし、だめなら反対の端へ
      const tw = set.titleEl.offsetWidth, th = set.titleEl.offsetHeight;
      const tEnd = set.dir === "y" ? -set.half : set.half;
      let tr = null, bestBad = Infinity;
      for (const end of [tEnd, -tEnd]) {
        const tp = toScreen(cur.edge.at(end + (end > 0 ? 0.9 : -0.9)), w, h);
        for (let gap = 14, k = 0; k < 6 && bestBad > 0; k++, gap += th + 4) {
          for (const side of [0, 1, -1]) {
            const sh = side * (tw / 2 + 8);
            const r = cur.place({ x: tp.x + cur.ex * sh, y: tp.y + cur.ey * sh }, tw, th, gap);
            r.x = Math.min(Math.max(r.x, 2), w - tw - 2); r.y = Math.min(Math.max(r.y, 2), h - th - 2);
            // 他の名前・ラベルとの重なりが一番困る。次にキューブ・案内文
            const bad = (overlaps(r) ? 2 : 0) + (blocked(r, 4) ? 1 : 0) + k * 0.01 + Math.abs(side) * 0.005;
            if (bad < bestBad) { bestBad = bad; tr = r; }
            if (bad < 1) break;
          }
        }
        if (bestBad < 1) break;
      }
      set.titleEl.style.transform = `translate(${tr.x}px, ${tr.y}px)`;
      used.push(tr);
    }
  }

  // ラベルを省いている軸があるときの案内
  const hint = document.createElement("div");
  hint.className = "cube-hint";
  host.appendChild(hint);
  const NAMES = { y: "行", x: "列", z: "奥行き" };
  function updateHint() {
    const crowded = axisSets.filter(s => s.step >= 3).map(s => NAMES[s.dir]);
    hint.textContent = crowded.length ? `この角度では${crowded.join("・")}のラベルが重なるため一部を省いています。「正面」「上面」「側面」で全部見られます。` : "";
    hint.hidden = !crowded.length;
  }

  function showHover(center, size) {
    hoverBox.material.color.set(tok("--join"));
    hoverBox.position.copy(center); hoverBox.scale.set(size.x, size.y, size.z); hoverBox.visible = true;
  }
  const hideHover = () => { hoverBox.visible = false; };
  // 軸のラベルに触れたら、その値の1枚(行・列・奥行きの層)を囲う
  function hoverSlab(dir, i) {
    const { nR, nC, nZ } = dims;
    if (dir === "y") showHover(new THREE.Vector3(0, (nR - 1) / 2 - i, 0), new THREE.Vector3(nC + 0.1, 1, nZ + 0.1));
    else if (dir === "x") showHover(new THREE.Vector3(i - (nC - 1) / 2, 0, 0), new THREE.Vector3(1, nR + 0.1, nZ + 0.1));
    else showHover(new THREE.Vector3(0, 0, (nZ - 1) / 2 - i), new THREE.Vector3(nC + 0.1, nR + 0.1, 1));
  }

  function markSelected(c3) {
    for (const set of axisSets) for (const it of set.items) {
      const on = c3.sel && ((set.dir === "y" && it.i === c3.sel.r) || (set.dir === "x" && it.i === c3.sel.c)) ||
        (set.dir === "z" && c3.mode === "slice" && it.i === c3.sliceK);
      it.el.classList.toggle("sel", !!on);
    }
  }

  function buildCells(c3) {
    disposeGroup(world);
    solid = ghost = null; solidIdx = []; ghostIdx = [];
    const base = new THREE.Color(tok("--cell-base"));
    const hot = new THREE.Color(tok("--accent"));
    const act = [], gh = [];
    // 潜っている場所があれば、その中のコマだけ実体で、周りは半透明にする
    for (const it of c3.items) (c3.isActive(it) && (!c3.focus || c3.focus.has(it)) ? act : gh).push(it);
    const make = (items, mat) => {
      if (!items.length) return null;
      const mesh = new THREE.InstancedMesh(boxGeo, mat, items.length);
      const m4 = new THREE.Matrix4(), col = new THREE.Color();
      items.forEach((it, i) => {
        m4.setPosition(pos(it.r, it.c, it.k));
        mesh.setMatrixAt(i, m4);
        col.copy(base).lerp(hot, 0.15 + 0.85 * (c3.max ? it.v / c3.max : 0));
        mesh.setColorAt(i, col);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
      world.add(mesh);
      return mesh;
    };
    solid = make(act, new THREE.MeshLambertMaterial());
    ghost = make(gh, new THREE.MeshLambertMaterial({ transparent: true, opacity: c3.focus ? 0.07 : 0.1, depthWrite: false }));
    solidIdx = act; ghostIdx = gh;
  }

  function outline(center, size, color, opacity = 1) {
    const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x, size.y, size.z));
    const line = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
    line.position.copy(center);
    marks.add(line);
    return line;
  }

  function buildMarks(c3) {
    disposeGroup(marks);
    glowMats = [];
    const { nR, nC, nZ } = dims;
    const accent = new THREE.Color(tok("--accent"));
    const join = new THREE.Color(tok("--join"));
    if (c3.focus) {
      // 潜っている場所を囲う枠(外側の立体の中での位置)
      const b = c3.focus.box;
      const a = pos(b.r0, b.c0, b.k0), z = pos(b.r1, b.c1, b.k1);
      const center = a.clone().add(z).multiplyScalar(0.5);
      const size = new THREE.Vector3(Math.abs(z.x - a.x) + 1.08, Math.abs(z.y - a.y) + 1.08, Math.abs(z.z - a.z) + 1.08);
      const e = outline(center, size, join);
      e.material.depthTest = false; e.renderOrder = 11;
      outline(new THREE.Vector3(0, 0, 0), new THREE.Vector3(nC + 0.1, nR + 0.1, nZ + 0.1), accent, 0.25);
      return;
    }
    // 表に出している面:断面ならその層、集約なら正面に投影した面
    const faceCenter = new THREE.Vector3(0, 0, c3.mode === "slice" ? pos(0, 0, c3.sliceK).z : (nZ - 1) / 2 + 0.9);
    const plane = new THREE.Mesh(
      new THREE.BoxGeometry(nC + 0.1, nR + 0.1, c3.mode === "slice" ? 0.98 : 0.04),
      new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: c3.mode === "slice" ? 0.1 : 0.16, depthWrite: false }),
    );
    plane.position.copy(faceCenter);
    marks.add(plane);
    outline(faceCenter, new THREE.Vector3(nC + 0.1, nR + 0.1, c3.mode === "slice" ? 0.98 : 0.04), accent);
    if (c3.mode === "aggregate") {
      // 奥行きを集約して正面へ潰していることを示す薄い枠
      outline(new THREE.Vector3(0, 0, 0), new THREE.Vector3(nC + 0.1, nR + 0.1, nZ + 0.1), accent, 0.35);
    }

    // 選んだコマ:集約なら奥行き方向の列全体、断面なら1コマ
    if (c3.sel) {
      const { r, c } = c3.sel;
      let center, size;
      if (c3.mode === "slice") {
        center = pos(r, c, c3.sliceK); size = new THREE.Vector3(0.96, 0.96, 0.96);
      } else {
        center = pos(r, c, 0); center.z = 0; size = new THREE.Vector3(0.96, 0.96, nZ - 0.04);
        // 正面の面上の位置
        const dot = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.96, 0.06),
          new THREE.MeshBasicMaterial({ color: join, transparent: true, opacity: 0.9 }));
        dot.position.set(center.x, center.y, faceCenter.z);
        marks.add(dot);
      }
      for (const [scale, op] of [[1, 0.75], [1.2, 0.25], [1.45, 0.1]]) {
        // 周りのコマに隠れないよう、深度に関係なく手前に描く
        const m = new THREE.MeshBasicMaterial({ color: join, transparent: true, opacity: op, depthWrite: false, depthTest: false });
        const glow = new THREE.Mesh(new THREE.BoxGeometry(size.x * scale, size.y * scale, size.z + (scale - 1)), m);
        glow.position.copy(center);
        glow.renderOrder = 10;
        marks.add(glow);
        glowMats.push([m, op]);
      }
      const edge = outline(center, size, join);
      edge.material.depthTest = false;
      edge.renderOrder = 11;
    }
  }

  // カメラ
  let tween = null;
  function viewPose(kind) {
    const { nR, nC, nZ } = dims;
    const radius = 0.5 * Math.sqrt(nR * nR + nC * nC + nZ * nZ) + 2.5;
    const dist = radius / Math.sin((camera.fov * Math.PI) / 360) * (camera.aspect < 1 ? 1.0 : 0.72);
    const dir = { iso: [0.85, 0.65, 1.15], front: [0, 0, 1], top: [0, 1, 0.0001], side: [1, 0, 0] }[kind];
    return new THREE.Vector3(...dir).normalize().multiplyScalar(dist);
  }
  function snap(kind, animate = true) {
    const to = viewPose(kind);
    const prevT = controls.target.clone();
    controls.target.set(0, 0, 0);
    if (!animate || reduceMotion) { camera.position.copy(to); tween = null; return; }
    tween = { from: camera.position.clone(), to, tFrom: prevT, tTo: new THREE.Vector3(), t0: performance.now(), ms: 450 };
    controls.target.copy(tween.tFrom);
  }
  // 潜った場所へズームする(向きはそのまま、近づくだけ)
  function zoomTo(box) {
    const a = pos(box.r0, box.c0, box.k0), z = pos(box.r1, box.c1, box.k1);
    const center = a.clone().add(z).multiplyScalar(0.5);
    const radius = 0.5 * a.distanceTo(z) + 1.6;
    const dist = Math.max(radius / Math.sin((camera.fov * Math.PI) / 360) * (camera.aspect < 1 ? 1.0 : 0.8), 9);
    const dir = camera.position.clone().sub(controls.target).normalize();
    const to = center.clone().add(dir.multiplyScalar(dist));
    if (reduceMotion) { controls.target.copy(center); camera.position.copy(to); tween = null; return; }
    tween = { from: camera.position.clone(), to, tFrom: controls.target.clone(), tTo: center, t0: performance.now(), ms: 600 };
  }
  document.querySelectorAll("[data-view]").forEach(b => b.addEventListener("click", () => snap(b.dataset.view)));

  function resize() {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(host);

  // ポインタ:クリックで選択、ホバーで値
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function hit(ev) {
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const targets = [solid, ghost].filter(Boolean);
    const h = ray.intersectObjects(targets, false)[0];
    if (!h) return null;
    return (h.object === solid ? solidIdx : ghostIdx)[h.instanceId];
  }
  let down = null, firstHit = null;
  renderer.domElement.addEventListener("pointerdown", e => { down = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener("click", e => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5 || !ctx) return;
    // 2回目のクリック(ダブルクリック・ダブルタップ)なら、1回目に触れたコマの中に入る
    if (e.detail >= 2 && ctx.onEnter) {
      const it = firstHit || hit(e);
      firstHit = null;
      if (it) { tip.hidden = true; hideHover(); ctx.onEnter(it); }
      return;
    }
    const it = hit(e);
    firstHit = it;
    if (it) ctx.onPick(it);
  });
  renderer.domElement.addEventListener("pointermove", e => {
    if (e.buttons) { tip.hidden = true; hideHover(); return; }
    const it = hit(e);
    if (!it || !ctx) { tip.hidden = true; hideHover(); return; }
    showHover(pos(it.r, it.c, it.k), new THREE.Vector3(1, 1, 1));
    const rect = host.getBoundingClientRect();
    tip.textContent = ctx.describe(it) + (!ctx.onEnter ? "" : ctx.canEnter && !ctx.canEnter(it) ? "(これ以上は分かれていません)" : "(ダブルクリックで中へ)");
    tip.hidden = false;
    tip.style.left = Math.min(e.clientX - rect.left + 12, rect.width - tip.offsetWidth - 4) + "px";
    tip.style.top = (e.clientY - rect.top + 12) + "px";
  });
  renderer.domElement.addEventListener("pointerleave", () => { tip.hidden = true; hideHover(); });

  let lastHint = 0;
  (function loop(t) {
    requestAnimationFrame(loop);
    if (tween) {
      const p = Math.min(1, (t - tween.t0) / tween.ms);
      const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      camera.position.lerpVectors(tween.from, tween.to, e);
      if (tween.tTo) controls.target.lerpVectors(tween.tFrom, tween.tTo, e);
      if (p === 1) tween = null;
    }
    const pulse = reduceMotion ? 1 : 0.7 + 0.3 * Math.sin(t / 260);
    for (const [m, op] of glowMats) m.opacity = op * pulse;
    controls.update();
    renderer.render(scene, camera);
    layoutLabels();
    if (t - lastHint > 800) { updateHint(); lastHint = t; }
  })(0);

  let firstView = true, focusKey = "";
  return {
    /** c3: { R, C, Z, items[{r,c,k,v}], max, mode, sliceK, sel{r,c}|null, isActive(it), onPick(it), describe(it) } */
    update(c3) {
      ctx = c3;
      const key = [c3.R.label, c3.C.label, c3.Z.label, c3.mode, c3.sliceK, c3.measure].join("|");
      const sizeChanged = dims.nR !== c3.R.members.length || dims.nC !== c3.C.members.length || dims.nZ !== c3.Z.members.length;
      dims = { nR: c3.R.members.length, nC: c3.C.members.length, nZ: c3.Z.members.length };
      if (key !== structKey) {
        structKey = key;
        buildCells(c3);
        buildLabels(c3.R, c3.C, c3.Z);
      }
      buildMarks(c3);
      markSelected(c3);
      overlay.classList.toggle("pickable", !!c3.onAxisPick);
      for (const set of axisSets) for (const it of set.items) it.el.title = c3.onAxisPick ? "タップでこの値に潜る" : "";
      hideHover();
      resize();
      const fKey = c3.focus ? c3.focus.key : "";
      if (firstView || (sizeChanged && !c3.focus)) { snap("iso", !firstView); firstView = false; }
      else if (fKey !== focusKey) { if (c3.focus) zoomTo(c3.focus.box); else snap("iso"); }
      focusKey = fKey;
    },
  };
})();
