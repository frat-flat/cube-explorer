// World の「日本地図」で使う地図データ(public/worlds/japan.json)を作る。作り直すときだけ使う:
//   npm i --no-save jpn-atlas topojson-client @b4moss/jp-local-gov-id-data && node tools/japan-map/build.mjs
// 形: jpn-atlas(BSD-3-Clause、元は国土地理院「地球地図日本」2016。850×680 に投影済み)
// 名前: @b4moss/jp-local-gov-id-data(元は総務省「全国地方公共団体コード」)
// 出力: 都道府県の輪郭(簡略化)と、市区町村ごとの代表点(いちばん大きい島の重心)。住所はこの名前で照らしてピンを立てる
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as topo from "topojson-client";

const require = createRequire(import.meta.url);
const atlas = JSON.parse(readFileSync(require.resolve("jpn-atlas/japan/japan.json"), "utf8"));
const dataDir = require.resolve("@b4moss/jp-local-gov-id-data/prefectures.json").replace(/prefectures\.json$/, "");
const prefs = JSON.parse(readFileSync(dataDir + "prefectures.json", "utf8")).prefectures;
const munis = readdirSync(dataDir + "prefectures").flatMap((f) => JSON.parse(readFileSync(dataDir + "prefectures/" + f, "utf8")).municipalities);

const r1 = (v) => Math.round(v * 10) / 10;
const area = (ring) => { let a = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]); return a / 2; };
const centroid = (ring) => { let x = 0, y = 0, a = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]; a += f; x += (ring[j][0] + ring[i][0]) * f; y += (ring[j][1] + ring[i][1]) * f; } return a ? [x / (3 * a), y / (3 * a)] : ring[0]; };
// ダグラス・ポーカーで点を間引く
function simplify(pts, tol) {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(); let md = 0, mi = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
    for (let i = a + 1; i < b; i++) { const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / L; if (d > md) { md = d; mi = i; } }
    if (md > tol) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
// 閉じた輪は始点と終点が同じなので、半分に切ってそれぞれ間引く
const simplifyRing = (r, tol) => { const m = r.length >> 1; return [...simplify(r.slice(0, m + 1), tol).slice(0, -1), ...simplify(r.slice(m), tol)]; };
const polys = (g) => (g.type === "Polygon" ? [g.coordinates] : g.coordinates);

const prefOut = topo.feature(atlas, atlas.objects.prefectures).features.map((f) => {
  const p = prefs.find((x) => x.code === String(f.id).padStart(2, "0"));
  const rings = polys(f.geometry).map((pl) => pl[0]).filter((r) => Math.abs(area(r)) > 0.6).map((r) => simplifyRing(r, 0.35).map(([x, y]) => [r1(x), r1(y)])).filter((r) => r.length > 3);
  const big = polys(f.geometry).map((pl) => pl[0]).sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)))[0];
  const [cx, cy] = centroid(big);
  return { c: p.code, n: p.name, cx: r1(cx), cy: r1(cy), r: rings };
}).sort((a, b) => a.c.localeCompare(b.c));

const shape = new Map(topo.feature(atlas, atlas.objects.municipalities).features.map((f) => {
  const big = polys(f.geometry).map((pl) => pl[0]).sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)))[0];
  return [String(f.id).padStart(5, "0"), centroid(big)];
}));
// 区は市の点を、地図に無い町村は都道府県の点を使う
const cityOut = munis.map((m) => {
  const c5 = m.code.slice(0, 5), city = munis.find((x) => x.name !== m.name && m.name.startsWith(x.name) && x.prefectureCode === m.prefectureCode);
  const pt = shape.get(c5) || (city && shape.get(city.code.slice(0, 5)));
  const pf = prefOut.find((p) => p.c === m.prefectureCode);
  return [m.prefectureCode, m.name, ...(pt ? [r1(pt[0]), r1(pt[1])] : [pf.cx, pf.cy])];
});
const out = { src: "地図: 国土地理院「地球地図日本」(jpn-atlas) / 市区町村名: 総務省「全国地方公共団体コード」", w: 865, h: 770, pref: prefOut, city: cityOut };
writeFileSync(new URL("../../public/worlds/japan.json", import.meta.url), JSON.stringify(out));
console.log("prefectures", prefOut.length, "points", prefOut.reduce((a, p) => a + p.r.reduce((b, r) => b + r.length, 0), 0), "cities", cityOut.length, "missing", munis.filter((m) => !shape.has(m.code.slice(0, 5))).length);
