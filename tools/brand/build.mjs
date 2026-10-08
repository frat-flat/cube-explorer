// ロゴ(tools/brand/4db-logo.webp、黒地 1254×1254)から、画面で使う画像を public/brand/ に作る。作り直すときだけ使う:
//   node tools/brand/build.mjs
// 画像の処理には sharp を使う(Next.js といっしょに入っているので、別に入れなくてよい)
// 出力:
//   icon-32.png・icon-192.png・apple-icon-180.png  ブラウザのタブとホーム画面のアイコン(ロゴ全体をそのまま縮める)
//   logo-64.png                                     ダッシュボード左上のロゴ(ロゴ全体。28px で表示するので 2 倍の大きさ)
//   mark.png・wordmark.png                          ログイン画面のロゴ。黒地を透明にして、絵(mark)と文字(wordmark)に分ける
//   mark-lines.png                                  mark のうち、細い線(点線・十字)と点だけ。ログイン画面で、リボンより先に軌道を描くのに使う
// 切り出し位置(MARK・WORD)と点の位置(DOTS)は、ログイン画面のアニメーション(src/app/login/LoginLogo.tsx)と合わせてある
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const sharp = require("sharp");

const src = fileURLToPath(new URL("4db-logo.webp", import.meta.url));
const outDir = fileURLToPath(new URL("../../public/brand/", import.meta.url));
mkdirSync(outDir, { recursive: true });

// 元の画像の中での位置(px)。左右は同じ幅にして、2枚を縦に並べると元のロゴと同じ並びになるようにする
const MARK = { left: 64, top: 24, width: 1126, height: 928 }; // 絵(リボン・十字・点・点線)
const WORD = { left: 64, top: 952, width: 1126, height: 198 }; // 文字(4DB と FOUR DIMENSIONAL DATABASE)
// 点の中心と半径(光のにじみを含む)。中心の光と上の光は、リボンにかからないよう小さめ
const DOTS = [
  [626, 532, 20], [624, 164, 14],
  [626, 78, 22], [626, 912, 22], [168, 534, 20], [1098, 532, 20],
  [546, 160, 22], [914, 342, 22], [294, 296, 14], [290, 694, 14], [328, 728, 22],
];
const LOGIN_WIDTH = 720; // ログイン画面では 300px 前後で表示するので、2 倍より少し大きく
const BLACK = 3; // 元の画像の黒地は 1〜3 くらいのむら。これ以下は透明にする

const whole = (size, name) => sharp(src).resize(size, size, { kernel: "lanczos3" }).png({ compressionLevel: 9 }).toFile(outDir + name);

// 黒地の上の光る絵を、透明な地の絵に戻す。黒の上に重ねたときに元と同じ見え方になるように、
// 不透明度 = いちばん明るい色の強さ、色 = 元の色 ÷ 不透明度 とする(黒からの「乗算済み」を戻す)
async function transparent(input, rect, name) {
  const width = LOGIN_WIDTH;
  const height = Math.round((rect.height * width) / rect.width);
  // 先に黒地のまま縮める(黒地のままなら、乗算済みの色で縮めるのと同じになり、ふちが黒ずまない)
  const { data } = await input.extract(rect).resize(width, height, { kernel: "lanczos3" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(width * height * 4);
  for (let i = 0, o = 0; i < data.length; i += 3, o += 4) {
    const r = Math.max(0, data[i] - BLACK), g = Math.max(0, data[i + 1] - BLACK), b = Math.max(0, data[i + 2] - BLACK);
    const m = Math.max(r, g, b);
    if (m === 0) continue; // 透明(out は 0 で埋まっている)
    out[o] = Math.round((r * 255) / m);
    out[o + 1] = Math.round((g * 255) / m);
    out[o + 2] = Math.round((b * 255) / m);
    out[o + 3] = Math.min(255, Math.round((m * 255) / (255 - BLACK)));
  }
  await sharp(out, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 9, effort: 10 }).toFile(outDir + name);
  return { name, width, height };
}

// 細い線と点だけを残し、ほか(リボン)を黒にした元の画像。細い線 = 周りより明るく、周り(半径 10px ほど)は暗いところ
async function linesOnly() {
  const { data, info } = await sharp(src).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const around = await sharp(src).removeAlpha().blur(10).raw().toBuffer();
  const { width: W, height: H } = info;
  const max = (buf, i) => Math.max(buf[i * 3], buf[i * 3 + 1], buf[i * 3 + 2]);
  const thin = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) if (max(data, i) - max(around, i) > 25 && max(around, i) < 45) thin[i] = 1;
  // 線のふち(にじみ)も入るように 2px 広げ、点を足す
  const keep = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!thin[y * W + x]) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const yy = y + dy, xx = x + dx;
      if (yy >= 0 && yy < H && xx >= 0 && xx < W) keep[yy * W + xx] = 1;
    }
  }
  for (const [cx, cy, r] of DOTS) for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) keep[y * W + x] = 1;
  const out = Buffer.alloc(data.length);
  for (let i = 0; i < W * H; i++) if (keep[i]) data.copy(out, i * 3, i * 3, i * 3 + 3);
  return sharp(out, { raw: { width: W, height: H, channels: 3 } });
}

await whole(32, "icon-32.png");
await whole(192, "icon-192.png");
await whole(180, "apple-icon-180.png");
await whole(64, "logo-64.png");
const made = [
  await transparent(sharp(src), MARK, "mark.png"),
  await transparent(sharp(src), WORD, "wordmark.png"),
  await transparent(await linesOnly(), MARK, "mark-lines.png"),
];
for (const m of made) console.log(`${m.name}: ${m.width}×${m.height}`);
console.log(`出力: ${outDir}`);
