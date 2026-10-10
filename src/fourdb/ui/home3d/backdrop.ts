// 背景の飾り「ロゴの線」: 十字の細い線・点線の軌道・小さな点(SVG)。数値と決まった文字だけで組み立てる(innerHTML を使わない)。
// 色は tokens.css の変数をそのまま使う(明るい・暗いが変わっても描き直さなくてよい)。class は画面の CSS で上書きしたいとき用。

const NS = "http://www.w3.org/2000/svg";
let seq = 0;

function el(name: string, attrs: Record<string, string | number>): SVGElement {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, typeof v === "number" ? String(Math.round(v * 100) / 100) : v);
  return e;
}

const ORBIT_STYLE = {
  b: "fill:none;stroke-width:1.1;stroke-linecap:round;stroke:color-mix(in srgb, var(--accent) 34%, transparent)",
  o: "fill:none;stroke-width:1.1;stroke-linecap:round;stroke:color-mix(in srgb, var(--hl) 38%, transparent)",
  g: "fill:none;stroke-width:1.1;stroke-linecap:round;stroke:color-mix(in srgb, var(--line-strong) 34%, transparent)",
} as const;
const DOT_STYLE = { b: "fill:var(--accent);opacity:0.55", o: "fill:var(--hl);opacity:0.7" } as const;

/** 幅 W・高さ H の背景に、十字の中心(cx, cy)で描く。前の中身は消す。描いた SVG を返す(舞台が transform で少し動かす) */
export function drawLogoBackdrop(host: HTMLElement, W: number, H: number, cx: number, cy: number): SVGElement {
  clearBackdrop(host);
  const id = ++seq;
  const R = Math.min(W, H);
  const svg = el("svg", { viewBox: `0 0 ${Math.round(W)} ${Math.round(H)}`, preserveAspectRatio: "none", width: "100%", height: "100%", "aria-hidden": "true", focusable: "false" });
  svg.setAttribute("style", "display:block");
  const defs = el("defs", {});
  const fade = (name: string, x2: number, y2: number) => {
    const g = el("linearGradient", { id: `${name}${id}`, gradientUnits: "userSpaceOnUse", x1: 0, y1: 0, x2, y2 });
    for (const [offset, op] of [
      [0, 0],
      [0.5, 0.42],
      [1, 0],
    ] as const) {
      const s = el("stop", { offset });
      s.setAttribute("style", `stop-color:var(--line-strong);stop-opacity:${op}`);
      g.appendChild(s);
    }
    defs.appendChild(g);
  };
  fade("h3dfx", W, 0);
  fade("h3dfy", 0, H);
  svg.appendChild(defs);
  const line = (x1: number, y1: number, x2: number, y2: number, grad: string) => {
    const l = el("line", { class: "ax", x1, y1, x2, y2 });
    l.setAttribute("style", `stroke-width:1;stroke:url(#${grad}${id})`);
    svg.appendChild(l);
  };
  line(0, cy, W, cy, "h3dfx");
  line(cx, 0, cx, H, "h3dfy");
  const circ = (r: number, kind: keyof typeof ORBIT_STYLE, gap: number) => {
    const c = el("circle", { class: `orb ${kind}`, cx, cy, r, "stroke-dasharray": `0.01 ${gap}` });
    c.setAttribute("style", ORBIT_STYLE[kind]);
    svg.appendChild(c);
  };
  circ(R * 0.34, "b", 7);
  circ(R * 0.5, "o", 8);
  circ(R * 0.7, "g", 9);
  const ell = el("ellipse", { class: "orb b", cx, cy, rx: R * 0.62, ry: R * 0.17, transform: `rotate(-9 ${Math.round(cx)} ${Math.round(cy)})`, "stroke-dasharray": "0.01 7" });
  ell.setAttribute("style", ORBIT_STYLE.b);
  svg.appendChild(ell);
  const dot = (x: number, y: number, kind: keyof typeof DOT_STYLE, r: number) => {
    const d = el("circle", { class: `pt ${kind}`, cx: x, cy: y, r });
    d.setAttribute("style", DOT_STYLE[kind]);
    svg.appendChild(d);
  };
  const onOrbit = (a: number, r: number, kind: keyof typeof DOT_STYLE, s: number) => dot(cx + Math.cos(a) * r, cy + Math.sin(a) * r, kind, s);
  onOrbit(-0.62, R * 0.34, "b", 2.6);
  onOrbit(-2.45, R * 0.5, "o", 3);
  onOrbit(-2.1, R * 0.7, "o", 2.4);
  onOrbit(0.35, R * 0.7, "b", 2.2);
  dot(cx - R * 0.7, cy, "o", 2.6);
  dot(cx + R * 0.7, cy, "o", 2.6);
  dot(cx, cy - R * 0.5, "o", 2.4);
  host.appendChild(svg);
  return svg;
}

/** 背景の飾りを消す(自分で入れた SVG だけ) */
export function clearBackdrop(host: HTMLElement): void {
  for (const c of Array.from(host.children)) if (c instanceof SVGElement && c.namespaceURI === NS) c.remove();
}
