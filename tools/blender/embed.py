"""世界のファイル(GLB・光の画像・json)を world.html に埋め込み、1 枚の HTML にする(アーティファクト用)。

    python3 tools/blender/embed.py rpg out.html
"""
import base64
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
WORLDS = os.path.join(HERE, "..", "..", "public", "worlds")
name, out = sys.argv[1], sys.argv[2]
page = os.path.join(WORLDS, sys.argv[3] if len(sys.argv) > 3 else "world.html")
s = open(page, encoding="utf-8").read()
for t in ['<!doctype html>\n', '<html lang="ja">\n', '<head>\n', '</head>\n', '<body>\n', '</body>\n', '</html>\n', '<meta charset="utf-8">\n',
          '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n']:
    s = s.replace(t, "")
info = json.load(open(os.path.join(WORLDS, f"{name}.json"), encoding="utf-8"))
files = {f"{name}.glb": "application/octet-stream", f"{name}.json": "application/json"}
for g in info["groups"].values():
    if g.get("light"):
        files[g["light"]] = "image/jpeg"
emb = {k: f"data:{v};base64," + base64.b64encode(open(os.path.join(WORLDS, k), "rb").read()).decode() for k, v in files.items()}
if info.get("title"):
    s = s.replace("<title>展示の世界 Blender版</title>", f"<title>{info['title']} Blender版</title>")
s = s.replace('<script src="https://cdnjs', f"<script>window.WORLD_NAME = {json.dumps(name)}; window.WORLD_FILES = {json.dumps(emb)};</script>\n<script src=\"https://cdnjs", 1)
open(out, "w", encoding="utf-8").write(s)
print(out, os.path.getsize(out) // 1024, "KB")
