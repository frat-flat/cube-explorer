// 入金キューブの画面(explorer/)を Next.js から使える形にまとめる。
// three.js と画面のスクリプトを public/explorer/bundle.js に、画面の HTML を src/app/explorerMarkup.ts に書き出す。
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = p => readFileSync(join(root, p), "utf8");

const parts = [
  "node_modules/three/build/three.min.js",
  "node_modules/three/examples/js/controls/OrbitControls.js",
  "explorer/script3d.js",
  "explorer/app.js",
];
mkdirSync(join(root, "public/explorer"), { recursive: true });
writeFileSync(join(root, "public/explorer/bundle.js"), parts.map(p => `/* ${p} */\n${read(p)}`).join("\n;\n"));
writeFileSync(
  join(root, "src/app/explorerMarkup.ts"),
  `// 自動生成(scripts/build-explorer.mjs)。直接編集しない\nexport const explorerMarkup = ${JSON.stringify(read("explorer/body.html"))};\n`,
);
console.log("explorer bundle written");
