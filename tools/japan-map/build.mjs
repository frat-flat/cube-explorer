// World の「日本地図」で住所にピンを立てるための名前と位置(public/worlds/japan.json)を作る。作り直すときだけ使う:
//   npm i --no-save jpn-atlas @b4moss/jp-local-gov-id-data && node tools/japan-map/build.mjs
// 位置: jpn-atlas(BSD-3-Clause)に入っている国土地理院「地球地図日本」2016 の shapefile(経度・緯度)
// 名前: @b4moss/jp-local-gov-id-data(元は総務省「全国地方公共団体コード」)
// 出力: 都道府県と市区町村ごとの代表点(経度・緯度)。地図そのものは画面で地理院タイルを読む
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
const out = { src: "位置: 国土地理院「地球地図日本」(jpn-atlas) / 市区町村名: 総務省「全国地方公共団体コード」", pref: prefOut, city: cityOut };
writeFileSync(new URL("../../public/worlds/japan.json", import.meta.url), JSON.stringify(out));
console.log("prefectures", prefOut.length, "cities", cityOut.length, "missing", munis.filter((m) => !geo.has(m.code.slice(0, 5))).length);
