// 立体で使い回す小さな画像(やわらかい丸・点・縦にぼける線)。舞台 1 つにつき 1 組を作り、舞台を外すときに捨てる。
import { CanvasTexture } from "three";

export type Textures = {
  /** やわらかい丸(影・光だまり) */
  soft: CanvasTexture;
  /** 小さな点(点線の軌道・角の点) */
  dot: CanvasTexture;
  /** 縦にぼける線(縦の細い線) */
  vfade: CanvasTexture;
  dispose(): void;
};

function canvas2d(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const x = c.getContext("2d");
  if (!x) throw new Error("2D の描画を使えません");
  return [c, x];
}

function radial(stops: [number, number][], size = 256): CanvasTexture {
  const [c, x] = canvas2d(size, size);
  const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, a] of stops) g.addColorStop(o, `rgba(255,255,255,${a})`);
  x.fillStyle = g;
  x.fillRect(0, 0, size, size);
  return new CanvasTexture(c);
}

function vfade(): CanvasTexture {
  const [c, x] = canvas2d(4, 256);
  const g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, "rgba(255,255,255,0)");
  g.addColorStop(0.3, "rgba(255,255,255,1)");
  g.addColorStop(0.7, "rgba(255,255,255,1)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, 4, 256);
  return new CanvasTexture(c);
}

export function createTextures(): Textures {
  const soft = radial([
    [0, 1],
    [0.3, 0.6],
    [0.62, 0.18],
    [1, 0],
  ]);
  const dot = radial(
    [
      [0, 1],
      [0.42, 1],
      [0.62, 0.35],
      [0.8, 0],
    ],
    64,
  );
  const fade = vfade();
  return {
    soft,
    dot,
    vfade: fade,
    dispose() {
      soft.dispose();
      dot.dispose();
      fade.dispose();
    },
  };
}
