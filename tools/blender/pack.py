"""焼いた世界をまとめて 1 つのアーティファクト用フォルダにする。

    python3 tools/blender/pack.py <出力フォルダ> zen underwater ...

<出力>/index.html(world.html に世界の一覧を入れたもの)・<w>.data.js(GLB と json を埋め込み)・<w>_<組>_light.jpg
"""
import base64
import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
WORLDS = os.path.join(HERE, "..", "..", "public", "worlds")
out, names = sys.argv[1], sys.argv[2:]
os.makedirs(out, exist_ok=True)
lst = []
for n in names:
    info = json.load(open(os.path.join(WORLDS, f"{n}.json"), encoding="utf-8"))
    lst.append({"id": n, "title": info.get("title", n)})
    files = {f"{n}.glb": "application/octet-stream", f"{n}.json": "application/json"}
    emb = {k: f"data:{v};base64," + base64.b64encode(open(os.path.join(WORLDS, k), "rb").read()).decode() for k, v in files.items()}
    with open(os.path.join(out, f"{n}.data.js"), "w") as f:
        f.write(f"window.WORLD_FILES = {json.dumps(emb)};\n")
    for g in info["groups"].values():
        if g.get("light"):
            shutil.copy(os.path.join(WORLDS, g["light"]), out)
s = open(os.path.join(WORLDS, "world.html"), encoding="utf-8").read()
for t in ['<!doctype html>\n', '<html lang="ja">\n', '<head>\n', '</head>\n', '<body>\n', '</body>\n', '</html>\n', '<meta charset="utf-8">\n',
          '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n']:
    s = s.replace(t, "")
s = s.replace("<title>展示の世界 Blender版</title>", "<title>展示の世界 Blender版</title>")
s = s.replace('<script src="https://cdnjs', f"<script>window.WORLD_LIST = {json.dumps(lst, ensure_ascii=False)};</script>\n<script src=\"https://cdnjs", 1)
open(os.path.join(out, "index.html"), "w", encoding="utf-8").write(s)
for fn in sorted(os.listdir(out)):
    print(fn, os.path.getsize(os.path.join(out, fn)) // 1024, "KB")
