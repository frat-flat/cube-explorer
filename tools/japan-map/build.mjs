// World の「日本地図」で住所にピンを立てるための名前と位置(public/worlds/japan.json)を作る。作り直すときだけ使う:
//   npm i --no-save jpn-atlas @b4moss/jp-local-gov-id-data && node tools/japan-map/build.mjs
// 位置: jpn-atlas(BSD-3-Clause)に入っている国土地理院「地球地図日本」2016 の shapefile(経度・緯度)
// 名前: @b4moss/jp-local-gov-id-data(元は総務省「全国地方公共団体コード」)
// 人口: tools/japan-map/population.json(population.py で作る。総務省「住民基本台帳人口」CC BY 4.0)
// 出力: 都道府県と市区町村ごとの代表点(経度・緯度)と県境の線と人口のドット。地図そのものは画面で地理院タイルを読む
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const dataDir = require.resolve("@b4moss/jp-local-gov-id-data/prefectures.json").replace(/prefectures\.json$/, "");
const prefs = JSON.parse(readFileSync(dataDir + "prefectures.json", "utf8")).prefectures;
const munis = readdirSync(dataDir + "prefectures").flatMap((f) => JSON.parse(readFileSync(dataDir + "prefectures/" + f, "utf8")).municipalities);

const area = (ring) => { let a = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]); return a / 2; };
const centroid = (ring) => { let x = 0, y = 0, a = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]; a += f; x += (ring[j][0] + ring[i][0]) * f; y += (ring[j][1] + ring[i][1]) * f; } return a ? [x / (3 * a), y / (3 * a)] : ring[0]; };
// 市区町村ごとにいちばん大きい島の重心、都道府県は島の面積で重みを付けた重心
const shp = readFileSync(require.resolve("jpn-atlas/build/polbnda_jpn.shp")), dbf = readFileSync(require.resolve("jpn-atlas/build/polbnda_jpn.dbf"));
const dHead = dbf.readUInt16LE(8), dRec = dbf.readUInt16LE(10), fields = [];
for (let o = 32; dbf[o] !== 0x0d; o += 32) fields.push([dbf.toString("latin1", o, o + 11).replace(/\0.*/, ""), dbf[o + 16]]);
const admAt = (i) => { let o = dHead + i * dRec + 1; for (const [n, l] of fields) { if (n === "adm_code") return dbf.toString("latin1", o, o + l).trim(); o += l; } return ""; };
const geo = new Map(), prefAcc = new Map();
for (let o = 100, i = 0; o < shp.length; i++) {
  const len = shp.readInt32BE(o + 4) * 2, b = o + 8; o = b + len;
  if (shp.readInt32LE(b) !== 5) continue;
  const np = shp.readInt32LE(b + 36), nv = shp.readInt32LE(b + 40), parts = [...Array(np)].map((_, k) => shp.readInt32LE(b + 44 + 4 * k)), pts = b + 44 + 4 * np;
  const code = admAt(i).slice(0, 5);
  for (let k = 0; k < np; k++) {
    const ring = []; for (let j = parts[k]; j < (k + 1 < np ? parts[k + 1] : nv); j++) ring.push([shp.readDoubleLE(pts + 16 * j), shp.readDoubleLE(pts + 16 * j + 8)]);
    const a = Math.abs(area(ring)), c = centroid(ring);
    if (!geo.has(code) || geo.get(code).a < a) geo.set(code, { a, c });
    const pa = prefAcc.get(code.slice(0, 2)) || { a: 0, x: 0, y: 0 }; pa.a += a; pa.x += c[0] * a; pa.y += c[1] * a; prefAcc.set(code.slice(0, 2), pa);
  }
}
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const prefOut = prefs.map((p) => { const a = prefAcc.get(p.code); return { c: p.code, n: p.name, lon: r4(a.x / a.a), lat: r4(a.y / a.a) }; }).sort((a, b) => a.c.localeCompare(b.c));
// 区は市の点を、地図に無い町村は都道府県の点を使う。[都道府県コード, 名前, 経度, 緯度]
const cityOut = munis.map((m) => {
  const c5 = m.code.slice(0, 5), city = munis.find((x) => x.name !== m.name && m.name.startsWith(x.name) && x.prefectureCode === m.prefectureCode);
  const ll = geo.get(c5) || (city && geo.get(city.code.slice(0, 5))), pf = prefOut.find((p) => p.c === m.prefectureCode);
  return [m.prefectureCode, m.name, ...(ll ? [r4(ll.c[0]), r4(ll.c[1])] : [pf.lon, pf.lat])];
});
// 県境(空撮に重ねる線): 市区町村の輪郭の辺のうち、違う都道府県どうしが共有する辺だけをつないで線にする
const E = new Map(); let nE = 0;
const key = (p) => p[0].toFixed(6) + "," + p[1].toFixed(6);
for (let o = 100, i = 0; o < shp.length; i++) {
  const len = shp.readInt32BE(o + 4) * 2, b = o + 8; o = b + len;
  if (shp.readInt32LE(b) !== 5) continue;
  const np = shp.readInt32LE(b + 36), nv = shp.readInt32LE(b + 40), parts = [...Array(np)].map((_, k) => shp.readInt32LE(b + 44 + 4 * k)), pts = b + 44 + 4 * np;
  const pf = admAt(i).slice(0, 2);
  for (let k = 0; k < np; k++) {
    const ring = []; for (let j = parts[k]; j < (k + 1 < np ? parts[k + 1] : nv); j++) ring.push([shp.readDoubleLE(pts + 16 * j), shp.readDoubleLE(pts + 16 * j + 8)]);
    for (let j = 0; j + 1 < ring.length; j++) { const a = key(ring[j]), c = key(ring[j + 1]), kk = a < c ? a + "|" + c : c + "|" + a; const e = E.get(kk) || { p: new Set(), a: ring[j], b: ring[j + 1] }; e.p.add(pf); E.set(kk, e); nE++; }
  }
}
const segs = [...E.values()].filter((e) => e.p.size > 1);
// chain
const adj = new Map(); const K = key;
segs.forEach((s, i) => { for (const p of [s.a, s.b]) { const k = K(p); (adj.get(k) || adj.set(k, []).get(k)).push(i); } });
const used = new Uint8Array(segs.length), lines = [];
for (let i = 0; i < segs.length; i++) {
  if (used[i]) continue; used[i] = 1; const line = [segs[i].a, segs[i].b];
  for (const dir of [1, 0]) {
    for (;;) { const end = dir ? line[line.length - 1] : line[0], nx = (adj.get(K(end)) || []).find((j) => !used[j]); if (nx == null) break; used[nx] = 1; const s = segs[nx], o = K(s.a) === K(end) ? s.b : s.a; if (dir) line.push(o); else line.unshift(o); }
  }
  lines.push(line);
}
function simplify(pts, tol) { if (pts.length < 3) return pts; const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1; const st = [[0, pts.length - 1]];
  while (st.length) { const [a, b] = st.pop(); let md = 0, mi = -1; const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
    for (let i = a + 1; i < b; i++) { const d = L > 1e-12 ? Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / L : Math.hypot(pts[i][0] - ax, pts[i][1] - ay); if (d > md) { md = d; mi = i; } }
    if (md > tol) { keep[mi] = 1; st.push([a, mi], [mi, b]); } } return pts.filter((_, i) => keep[i]); }
const border = lines.map((l) => simplify(l, 0.002).map(([x, y]) => [r4(x), r4(y)]));
// 白地図のドット: 地図に形がある市区町村(政令市は市でまとめ、区は除く)ごとに [経度, 緯度, 人口, 名前, 出す縮尺]
// 出す縮尺: 0=いつも、1=日本全体のときだけ(東京23区をまとめた点)、2=寄ったときだけ(23区の一つ一つ)
const pop = JSON.parse(readFileSync(new URL("./population.json", import.meta.url), "utf8"));
const ku = (m) => /^131[0-2]\d$/.test(m.code.slice(0, 5)) && m.code.slice(0, 5) <= "13123";
const dots = munis.filter((m) => geo.has(m.code.slice(0, 5)) && pop[m.code]).map((m) => { const c = geo.get(m.code.slice(0, 5)).c; return [r4(c[0]), r4(c[1]), pop[m.code], m.name, ku(m) ? 2 : 0]; });
const k23 = dots.filter((d) => d[4] === 2), s23 = k23.reduce((a, d) => a + d[2], 0);
if (k23.length) dots.push([r4(k23.reduce((a, d) => a + d[0] * d[2], 0) / s23), r4(k23.reduce((a, d) => a + d[1] * d[2], 0) / s23), s23, "東京23区", 1]);
dots.sort((a, b) => b[2] - a[2]);
const out = { src: "位置: 国土地理院「地球地図日本」(jpn-atlas) / 市区町村名: 総務省「全国地方公共団体コード」 / 人口: 総務省「住民基本台帳人口」令和4年1月1日", pref: prefOut, city: cityOut, border, dots };
writeFileSync(new URL("../../public/worlds/japan.json", import.meta.url), JSON.stringify(out));
console.log("dots", dots.length, "23ku", k23.length, "prefectures", prefOut.length, "cities", cityOut.length, "border lines", border.length, "missing", munis.filter((m) => !geo.has(m.code.slice(0, 5))).length);
