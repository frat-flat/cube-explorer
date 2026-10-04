# Blender で展示の世界を作る

`modern_gallery.py` は「白い現代美術館」を Blender で組み、Cycles で光と影を画像に焼き込んで `public/worlds/modern.glb` に書き出す。
ブラウザ側(`public/worlds/modern.html`)は焼き込んだ画像をそのまま貼るだけなので、光の計算をせずに軽く写実的に見える。

```
python3 -m pip install bpy==4.2.0
python3 tools/blender/modern_gallery.py --out public/worlds/modern.glb --size 2048 --samples 64 --still still.png
```

- Blender 本体は要らない(`bpy` は Python 3.11 用の Blender モジュール)。4コアで約19分。
- 作品の場所は GLB 内の空オブジェクト `spot_1`… に入る(extras: x, y, z, face, dist, r)。
- `--still` で入口からの Cycles の一枚絵も出す(質感の目標)。
