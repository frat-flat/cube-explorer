"""雨の夜、ネオン街のビルの屋上(作品はホログラムの台の上に浮かぶ)を Blender で組み、光を焼き込む。

    python3 tools/blender/cyber.py --out public/worlds/cyber.glb [--size 2048] [--samples 64] [--still still.png]

濡れた床の映り込みはブラウザの鏡(json の reflect)。まわりの摩天楼・空・ネオンは光の計算をしない(unlit / 発光)。
"""
import json
import math
import os
import random
import sys

import bpy  # noqa: F401 (bmesh より先に読む)
import bmesh

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from worldkit import P, World, args, emit, mat  # noqa: E402

A = args({"out": "cyber.glb"})
rnd = random.Random(9)
W, D = 28.0, 26.0          # 屋上の幅・奥行き
HW, HD = W / 2, D / 2
FONT_PATHS = ["/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf", "/usr/share/fonts/truetype/fonts-japanese-gothic.ttf"]

w = World(samples=A.samples)
FONT = next((bpy.data.fonts.load(p) for p in FONT_PATHS if os.path.exists(p)), None)  # 日本語のネオン用
w.sky((0.03, 0.018, 0.06), 1.0)  # 光を集めるための夜空(見える空はドーム)

w.group("floor", A.size, rough=0.12)
w.group("props", A.size, rough=0.6)
w.group("towers", A.size, unlit=True)
w.group("sky", A.size // 4, unlit=True)
w.group("holo", 256, unlit=True, opacity=0.22)
w.group("glow", bake=False)


# ---- 材質の部品 ----
def nodes(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    return m, m.node_tree


def pos(nt):
    return nt.nodes.new("ShaderNodeNewGeometry").outputs["Position"]


def noise(nt, vec, scale, detail=6, rough=0.55):
    n = nt.nodes.new("ShaderNodeTexNoise")
    n.inputs["Scale"].default_value = scale
    n.inputs["Detail"].default_value = detail
    n.inputs["Roughness"].default_value = rough
    nt.links.new(vec, n.inputs["Vector"])
    return n.outputs["Fac"]


def ramp(nt, fac, stops):
    r = nt.nodes.new("ShaderNodeValToRGB")
    els = r.color_ramp.elements
    els[0].position, els[0].color = stops[0][0], (*stops[0][1], 1)
    els[1].position, els[1].color = stops[-1][0], (*stops[-1][1], 1)
    for p, c in stops[1:-1]:
        e = els.new(p)
        e.color = (*c, 1)
    nt.links.new(fac, r.inputs["Fac"])
    return r.outputs["Color"]


def bump(nt, bsdf, height, strength, dist=0.05):
    b = nt.nodes.new("ShaderNodeBump")
    b.inputs["Strength"].default_value = strength
    b.inputs["Distance"].default_value = dist
    nt.links.new(height, b.inputs["Height"])
    nt.links.new(b.outputs["Normal"], bsdf.inputs["Normal"])


def emission_out(nt, color, strength=1.0):
    nt.nodes.remove(nt.nodes["Principled BSDF"])
    e = nt.nodes.new("ShaderNodeEmission")
    e.inputs["Strength"].default_value = strength
    if isinstance(color, tuple):
        e.inputs["Color"].default_value = (*color, 1)
    else:
        nt.links.new(color, e.inputs["Color"])
    nt.links.new(e.outputs[0], nt.nodes["Material Output"].inputs[0])
    return e


def wet_roof():
    """濡れた屋上:黒っぽいアスファルト防水、継ぎ目、水たまり(暗く・つるつる)"""
    m, nt = nodes("wetroof")
    bsdf = nt.nodes["Principled BSDF"]
    p = pos(nt)
    grit = noise(nt, p, 14, 8, 0.7)
    big = noise(nt, p, 0.35, 4)
    puddle = ramp(nt, big, [(0.5, (0, 0, 0)), (0.56, (1, 1, 1))])
    col = ramp(nt, grit, [(0.3, (0.018, 0.018, 0.02)), (0.7, (0.06, 0.058, 0.062))])
    # 防水シートの継ぎ目(1.2m ごと)
    br = nt.nodes.new("ShaderNodeTexBrick")
    br.inputs["Scale"].default_value = 1.0
    br.inputs["Brick Width"].default_value = 3.6
    br.inputs["Row Height"].default_value = 1.2
    br.inputs["Mortar Size"].default_value = 0.025
    br.inputs["Mortar Smooth"].default_value = 0.6
    br.offset = 0.5
    nt.links.new(p, br.inputs["Vector"])
    seam = nt.nodes.new("ShaderNodeMix")
    seam.data_type = "RGBA"
    seam.blend_type = "MULTIPLY"
    nt.links.new(br.outputs["Fac"], seam.inputs["Factor"])
    nt.links.new(col, seam.inputs["A"])
    seam.inputs["B"].default_value = (0.5, 0.5, 0.5, 1)
    dark = nt.nodes.new("ShaderNodeMix")
    dark.data_type = "RGBA"
    nt.links.new(puddle, dark.inputs["Factor"])
    nt.links.new(seam.outputs["Result"], dark.inputs["A"])
    dark.inputs["B"].default_value = (0.008, 0.008, 0.01, 1)
    nt.links.new(dark.outputs["Result"], bsdf.inputs["Base Color"])
    rr = ramp(nt, big, [(0.5, (0.32, 0.32, 0.32)), (0.56, (0.03, 0.03, 0.03))])
    nt.links.new(rr, bsdf.inputs["Roughness"])
    h = nt.nodes.new("ShaderNodeMath")
    h.operation = "MULTIPLY"
    nt.links.new(grit, h.inputs[0])
    nt.links.new(br.outputs["Fac"], h.inputs[1])
    bump(nt, bsdf, h.outputs[0], 0.25, 0.02)
    return m


def concrete(name, color, streak=True):
    """雨だれの筋がついたコンクリート"""
    m, nt = nodes(name)
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.7
    p = pos(nt)
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (6, 6, 0.4) if streak else (1, 1, 1)
    nt.links.new(p, mp.inputs["Vector"])
    s = noise(nt, mp.outputs["Vector"], 2.0, 8)
    g = noise(nt, p, 9, 8)
    mix = nt.nodes.new("ShaderNodeMath")
    mix.operation = "MULTIPLY_ADD"
    nt.links.new(s, mix.inputs[0])
    mix.inputs[1].default_value = 0.6
    nt.links.new(g, mix.inputs[2])
    c = ramp(nt, mix.outputs[0], [(0.45, tuple(x * 0.45 for x in color)), (1.0, color)])
    nt.links.new(c, bsdf.inputs["Base Color"])
    bump(nt, bsdf, g, 0.15, 0.02)
    return m


def tower_mat(name, lit, body, fill, ww, fh, mort, seed):
    """窓の格子(UV 'win' はメートル単位)。fill の割合で窓に明かりがつく"""
    m, nt = nodes(name)
    uv = nt.nodes.new("ShaderNodeUVMap")
    uv.uv_map = "win"
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Location"].default_value = (seed, seed * 0.37, 0)
    nt.links.new(uv.outputs["UV"], mp.inputs["Vector"])
    br = nt.nodes.new("ShaderNodeTexBrick")
    br.offset = 0.0
    br.inputs["Scale"].default_value = 1.0
    br.inputs["Brick Width"].default_value = ww
    br.inputs["Row Height"].default_value = fh
    br.inputs["Mortar Size"].default_value = mort
    br.inputs["Bias"].default_value = 0.0
    br.inputs["Color1"].default_value = (0, 0, 0, 1)
    br.inputs["Color2"].default_value = (1, 1, 1, 1)
    br.inputs["Mortar"].default_value = (0, 0, 0, 1)
    nt.links.new(mp.outputs["Vector"], br.inputs["Vector"])
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(br.outputs["Color"], sep.inputs[0])
    on = ramp(nt, sep.outputs[0], [(1 - fill - 0.01, (0, 0, 0)), (1 - fill, (1, 1, 1))])
    # 明かりの色に少しむら(階ごと・窓ごと)
    tint = ramp(nt, noise(nt, mp.outputs["Vector"], 0.05, 2), [(0.35, lit), (0.65, tuple(c * 0.55 for c in lit))])
    win = nt.nodes.new("ShaderNodeMix")
    win.data_type = "RGBA"
    nt.links.new(on, win.inputs["Factor"])
    win.inputs["A"].default_value = (*[c * 2.2 for c in body], 1)  # 消えた窓
    nt.links.new(tint, win.inputs["B"])
    out = nt.nodes.new("ShaderNodeMix")
    out.data_type = "RGBA"
    inv = nt.nodes.new("ShaderNodeMath")
    inv.operation = "SUBTRACT"
    inv.inputs[0].default_value = 1
    nt.links.new(br.outputs["Fac"], inv.inputs[1])
    nt.links.new(inv.outputs[0], out.inputs["Factor"])
    out.inputs["A"].default_value = (*body, 1)
    nt.links.new(win.outputs["Result"], out.inputs["B"])
    emission_out(nt, out.outputs["Result"])
    return m


def screen_mat(name, c1, c2, seed):
    """ビルの壁の大型ビジョン:色の帯がにじむ映像"""
    m, nt = nodes(name)
    p = pos(nt)
    wv = nt.nodes.new("ShaderNodeTexWave")
    wv.inputs["Scale"].default_value = 0.08
    wv.inputs["Distortion"].default_value = 6 + seed
    wv.inputs["Detail"].default_value = 3
    nt.links.new(p, wv.inputs["Vector"])
    c = ramp(nt, wv.outputs["Fac"], [(0.2, c1), (0.5, (0.9, 0.9, 1.0)), (0.8, c2)])
    emission_out(nt, c, 0.75)
    return m


def sky_mat():
    """夜の空:地平線は街の明かりで赤紫、上は濃紺。低い雲が下から照らされる"""
    m, nt = nodes("sky")
    p = pos(nt)
    nrm = nt.nodes.new("ShaderNodeVectorMath")
    nrm.operation = "NORMALIZE"
    nt.links.new(p, nrm.inputs[0])
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(nrm.outputs[0], sep.inputs[0])
    grad = ramp(nt, sep.outputs["Z"], [(0.0, (0.16, 0.05, 0.16)), (0.03, (0.32, 0.09, 0.26)), (0.12, (0.09, 0.03, 0.12)),
                                        (0.35, (0.022, 0.014, 0.05)), (1.0, (0.006, 0.006, 0.016))])
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (1, 1, 3.5)
    nt.links.new(nrm.outputs[0], mp.inputs["Vector"])
    cl = noise(nt, mp.outputs["Vector"], 2.2, 10, 0.6)
    cm = ramp(nt, cl, [(0.45, (0, 0, 0)), (0.75, (1, 1, 1))])
    band = ramp(nt, sep.outputs["Z"], [(0.02, (0, 0, 0)), (0.1, (1, 1, 1)), (0.45, (0.2, 0.2, 0.2)), (0.7, (0, 0, 0))])
    k = nt.nodes.new("ShaderNodeMix")
    k.data_type = "RGBA"
    k.blend_type = "MULTIPLY"
    k.inputs["Factor"].default_value = 1
    nt.links.new(cm, k.inputs["A"])
    nt.links.new(band, k.inputs["B"])
    cloud = nt.nodes.new("ShaderNodeMix")
    cloud.data_type = "RGBA"
    sepk = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(k.outputs["Result"], sepk.inputs[0])
    nt.links.new(sepk.outputs[0], cloud.inputs["Factor"])
    nt.links.new(grad, cloud.inputs["A"])
    cloud.inputs["B"].default_value = (0.2, 0.07, 0.2, 1)
    emission_out(nt, cloud.outputs["Result"])
    return m


def holo_mat():
    """光の円錐:下ほど明るい水色"""
    m, nt = nodes("holo")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(pos(nt), sep.inputs[0])
    mm = nt.nodes.new("ShaderNodeMapRange")
    mm.inputs["From Min"].default_value = 0.3
    mm.inputs["From Max"].default_value = 2.6
    nt.links.new(sep.outputs["Z"], mm.inputs["Value"])
    e = emission_out(nt, ramp(nt, mm.outputs[0], [(0.0, (0.35, 0.9, 1.0)), (1.0, (0.03, 0.15, 0.3))]))
    # Cycles の一枚絵では透ける(焼くのは発光の色だけ)
    add = nt.nodes.new("ShaderNodeAddShader")
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    e.inputs["Strength"].default_value = 0.4
    nt.links.new(tr.outputs[0], add.inputs[0])
    nt.links.new(e.outputs[0], add.inputs[1])
    nt.links.new(add.outputs[0], nt.nodes["Material Output"].inputs[0])
    return m


M = {
    "roof": wet_roof(),
    "conc": concrete("conc", (0.2, 0.2, 0.22)),
    "coping": concrete("coping", (0.32, 0.32, 0.33), streak=False),
    "steel": mat("steel", (0.1, 0.105, 0.115), rough=0.35, metal=0.0, noise=0.3, noise_scale=20),
    "galv": mat("galv", (0.28, 0.29, 0.3), rough=0.4, noise=0.25, noise_scale=12, bump=0.04),
    "dark": mat("dark", (0.012, 0.012, 0.016), rough=0.4),
    "wood": mat("wood", (0.22, 0.12, 0.06), rough=0.85, noise=0.4, noise_scale=30, bump=0.1),
    "rust": mat("rust", (0.25, 0.1, 0.05), rough=0.8, noise=0.45, noise_scale=14, bump=0.08),
    "door": mat("door", (0.08, 0.12, 0.14), rough=0.5, noise=0.2, noise_scale=10),
    "towerA": tower_mat("towerA", (1.0, 0.72, 0.42), (0.008, 0.009, 0.014), 0.42, 3.0, 3.6, 0.9, 0.0),
    "towerB": tower_mat("towerB", (0.55, 0.78, 1.0), (0.006, 0.008, 0.014), 0.55, 1.4, 3.4, 0.3, 7.3),
    "towerC": tower_mat("towerC", (0.95, 0.85, 0.7), (0.012, 0.01, 0.012), 0.3, 2.2, 3.8, 1.0, 3.1),
    "sign_back": emit("sign_back", (0.004, 0.004, 0.007), 1.0),
    "sky": sky_mat(),
    "holo": holo_mat(),
}
NEON = {k: emit(k, c, s) for k, c, s in (("pink", (1.0, 0.1, 0.75), 1.6), ("cyan", (0.1, 0.9, 1.0), 1.6), ("amber", (1.0, 0.7, 0.12), 1.6),
                                         ("violet", (0.45, 0.25, 1.0), 1.6), ("red", (1.0, 0.12, 0.1), 1.6), ("green", (0.15, 1.0, 0.55), 1.6),
                                         ("beacon", (1.0, 0.08, 0.05), 12), ("lamp", (1.0, 0.82, 0.55), 10), ("pad", (0.1, 0.45, 1.0), 4))}
SCREENS = [screen_mat("scr0", (0.9, 0.05, 0.5), (0.05, 0.3, 0.9), 0), screen_mat("scr1", (0.05, 0.8, 0.9), (0.4, 0.1, 0.9), 2),
           screen_mat("scr2", (1.0, 0.5, 0.05), (0.8, 0.05, 0.2), 4)]


# ---- 文字のネオン ----
def neon_text(text, color, size, center, ry, vertical=False, group="glow"):
    cu = bpy.data.curves.new("txt", "FONT")
    cu.body = "\n".join(text) if vertical else text
    if FONT:
        cu.font = FONT
    cu.size = size
    cu.align_x, cu.align_y = "CENTER", "CENTER"
    cu.extrude = 0.02
    cu.space_line = 0.9
    o = bpy.data.objects.new("txt", cu)
    w.sc.collection.objects.link(o)
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.convert(target="MESH")
    o = bpy.context.object
    o.location = P(*center)
    o.rotation_euler = (math.pi / 2, 0, ry)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return w.add(group, o, NEON[color])


def face_origin(x, z):
    return math.atan2(-x, -z)


# ---- 屋上の床 ----
w.plane("floor", W, D, (0, 0, 0), M["roof"], face_up=True)

# ---- 手すり壁(高さ 1.1)と笠木、上端のネオン ----
for sw, sd, x, z in ((W, 0.4, 0, -HD), (W, 0.4, 0, HD), (0.4, D, -HW, 0), (0.4, D, HW, 0)):
    w.box("props", (sw + 0.4 * (sd < 1), 1.05, sd), (x, 0.525, z), M["conc"])
    w.box("props", (sw + 0.5 * (sd < 1) + 0.1 * (sw < 1), 0.08, sd + 0.1), (x, 1.09, z), M["coping"])
for sw, sd, x, z in ((W - 0.5, 0.03, 0, -HD + 0.22), (W - 0.5, 0.03, 0, HD - 0.22), (0.03, D - 0.5, -HW + 0.22, 0), (0.03, D - 0.5, HW - 0.22, 0)):
    w.box("glow", (sw, 0.03, sd), (x, 1.04, z), NEON["cyan"])
# 幅木(床と壁の境の立ち上がり)と排水口
for sw, sd, x, z in ((W - 0.4, 0.06, 0, -HD + 0.23), (W - 0.4, 0.06, 0, HD - 0.23), (0.06, D - 0.4, -HW + 0.23, 0), (0.06, D - 0.4, HW - 0.23, 0)):
    w.box("props", (sw, 0.18, sd), (x, 0.09, z), M["dark"])
for x, z in ((-HW + 0.5, -HD + 0.5), (HW - 0.5, -HD + 0.5), (-HW + 0.5, HD - 0.5), (HW - 0.5, HD - 0.5)):
    w.cyl("props", 0.14, 0.16, 0.06, (x, 0.03, z), M["galv"], seg=12)

# ---- 奥の看板(鉄の柱と黒い板、ネオンの文字) ----
bz = -HD + 1.3
for x in (-3.8, 3.8):
    w.box("props", (0.22, 6.2, 0.22), (x, 3.1, bz), M["rust"])
    for y in (1.5, 3.2):
        w.box("props", (0.1, 0.1, 1.2), (x, y, bz + 0.5), M["rust"])
w.box("props", (8.0, 0.08, 0.08), (0, 3.9, bz), M["rust"])
w.box("props", (9.2, 3.0, 0.25), (0, 5.4, bz - 0.12), M["dark"])
w.box("props", (9.4, 0.12, 0.9), (0, 3.85, bz + 0.3), M["galv"])  # 点検の足場
neon_text("CUBE EXPLORER", "pink", 1.05, (0, 5.85, bz + 0.03), 0)
neon_text("立体データ展", "cyan", 0.85, (0, 4.75, bz + 0.03), 0)
w.light("AREA", (0, 5.3, bz + 1.6), 900, (1.0, 0.25, 0.8), target=(0, 0, 4), shape="RECTANGLE", size=8, size_y=1.5)

# ---- 階段室(左手前):扉と庇、扉の上の灯り ----
hx, hz = -10.6, 5.6
w.box("props", (4.2, 3.2, 3.6), (hx, 1.6, hz), M["conc"])
w.box("props", (4.5, 0.14, 3.9), (hx, 3.27, hz), M["coping"])
w.box("props", (0.06, 2.1, 1.0), (hx + 2.11, 1.05, hz), M["door"])
w.box("props", (0.7, 0.06, 1.5), (hx + 2.45, 2.45, hz), M["galv"])
w.box("glow", (0.06, 0.12, 0.35), (hx + 2.14, 2.3, hz), NEON["lamp"])
w.light("POINT", (hx + 2.5, 2.3, hz), 60, (1.0, 0.75, 0.45), shadow_soft_size=0.1)
neon_text("非常口", "green", 0.22, (hx + 2.12, 2.75, hz), math.pi / 2)
w.box("props", (0.5, 0.35, 0.5), (hx - 0.8, 3.5, hz + 0.8), M["galv"])  # 換気口

# ---- 室外機 ----
def hvac(x, z, ry=0.0):
    w.box("props", (2.0, 0.12, 1.5), (x, 0.06, z), M["rust"], ry=ry)
    w.box("props", (1.9, 1.15, 1.4), (x, 0.7, z), M["galv"], ry=ry)
    for k in range(9):  # 横のルーバー
        w.box("props", (1.92, 0.03, 0.05), (x, 0.25 + k * 0.1, z + math.cos(ry) * 0.71), M["steel"], ry=ry)
    w.cyl("props", 0.52, 0.52, 0.06, (x, 1.3, z), M["steel"], seg=24)
    w.cyl("props", 0.12, 0.12, 0.08, (x, 1.35, z), M["dark"], seg=12)


hvac(-11.0, -9.5)
hvac(-8.4, -9.5)
hvac(11.0, -9.0)
hvac(-11.2, -2.2, ry=math.pi / 2)

# ---- 給水塔(右手前):鉄の脚・木の桶・たが ----
tx, tz = 10.2, 8.6
for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
    w.box("props", (0.14, 3.2, 0.14), (tx + a, 1.6, tz + b), M["rust"])
for y in (1.1, 2.4):
    for sw, sd, x, z in ((2.1, 0.08, tx, tz - 1), (2.1, 0.08, tx, tz + 1), (0.08, 2.1, tx - 1, tz), (0.08, 2.1, tx + 1, tz)):
        w.box("props", (sw, 0.08, sd), (x, y, z), M["rust"])
w.cyl("props", 1.45, 1.45, 2.5, (tx, 4.45, tz), M["wood"], seg=28)
for y in (3.5, 4.2, 4.9, 5.5):
    w.cyl("props", 1.48, 1.48, 0.06, (tx, y, tz), M["rust"], seg=28)
w.cyl("props", 0.1, 1.62, 0.8, (tx, 6.1, tz), M["rust"], seg=28)
w.box("props", (3.4, 0.08, 3.4), (tx, 3.22, tz), M["steel"])

# ---- 配管・換気筒・天窓 ----
def pipe(r, length, center, m):
    """three.js の Z 方向に寝かせた円柱"""
    o = w.cyl("props", r, r, length, center, m, seg=12)
    o.rotation_euler = (math.pi / 2, 0, 0)
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(rotation=True)
    return o


for k, y in enumerate((0.3, 0.55)):
    pipe(0.09, D - 6, (HW - 1.0 - k * 0.3, y, -1.5), M["galv"])
for z in range(-13, 10, 3):
    w.box("props", (0.8, 0.5 if z else 0.5, 0.12), (HW - 1.15, 0.25, z + 0.5), M["rust"])
for x, z in ((-6.5, -7.5), (6.8, -6.0), (-1.0, -8.8)):
    w.cyl("props", 0.22, 0.22, 0.9, (x, 0.45, z), M["galv"], seg=16)
    w.cyl("props", 0.05, 0.36, 0.2, (x, 1.0, z), M["galv"], seg=16)
w.box("props", (2.4, 0.5, 1.6), (6.5, 0.25, -2.0), M["conc"])
w.box("props", (2.2, 0.06, 1.4), (6.5, 0.52, -2.0), M["dark"])  # 天窓のガラス(暗い)

# ---- アンテナと赤い灯 ----
ax, az = -12.6, 11.6
w.box("props", (0.08, 8.0, 0.08), (ax, 4.0, az), M["steel"])
for y in (2.5, 5.0):
    w.box("props", (1.2, 0.04, 0.04), (ax, y, az), M["steel"])
w.cyl("glow", 0.12, 0.12, 0.2, (ax, 8.1, az), NEON["beacon"], seg=12)

# ---- ホログラムの台(作品の場所) ----
SPOTS = [(-3.6, 3.6), (3.6, 3.6), (-3.6, -3.4), (3.6, -3.4)]
for x, z in SPOTS:
    w.cyl("props", 0.78, 0.9, 0.22, (x, 0.11, z), M["steel"], seg=40)
    w.cyl("props", 0.7, 0.74, 0.08, (x, 0.26, z), M["dark"], seg=40)
    bpy.ops.mesh.primitive_torus_add(major_radius=0.66, minor_radius=0.03, major_segments=48, minor_segments=8, location=P(x, 0.3, z))
    w.add("glow", bpy.context.object, NEON["cyan"])
    w.cyl("glow", 0.55, 0.55, 0.01, (x, 0.305, z), NEON["pad"], seg=40)
    w.cyl("holo", 1.0, 0.56, 2.3, (x, 1.45, z), M["holo"], seg=40, caps=False)
    w.light("POINT", (x, 0.6, z), 25, (0.3, 0.8, 1.0), shadow_soft_size=0.4)
    w.spot(x=x, y=0.3, z=z, face=0, dist=3.5, r=1.2, lift=0.75)


# ---- まわりの摩天楼(屋上を向く面だけ作る。UV 'win' はメートル) ----
def tower(bm, uvl, x, z, wd, dp, y0, y1, ry):
    c, s = math.cos(ry), math.sin(ry)
    pts = [(-wd / 2, -dp / 2), (wd / 2, -dp / 2), (wd / 2, dp / 2), (-wd / 2, dp / 2)]
    pts = [(x + px * c + pz * s, z - px * s + pz * c) for px, pz in pts]
    u0 = 0.0
    for k in range(4):
        (ax_, az_), (bx_, bz_) = pts[k], pts[(k + 1) % 4]
        mx, mz = (ax_ + bx_) / 2, (az_ + bz_) / 2
        nx, nz = (bz_ - az_), -(bx_ - ax_)  # 外向き
        L = math.hypot(nx, nz)
        if (nx * -mx + nz * -mz) / (L * math.hypot(mx, mz)) < -0.15:  # 屋上から見えない面
            u0 += L
            continue
        vs = [bm.verts.new(P(ax_, y0, az_)), bm.verts.new(P(bx_, y0, bz_)), bm.verts.new(P(bx_, y1, bz_)), bm.verts.new(P(ax_, y1, az_))]
        f = bm.faces.new(vs)
        for lp, (u, v) in zip(f.loops, ((u0, y0), (u0 + L, y0), (u0 + L, y1), (u0, y1))):
            lp[uvl].uv = (u, v)
        u0 += L


bms = {k: bmesh.new() for k in ("towerA", "towerB", "towerC")}
uvls = {k: b.loops.layers.uv.new("win") for k, b in bms.items()}
tops = []
placed = []

# ---- 隣のビル(屋上より少し高い)と、その壁のネオン看板 ----
SIGNS = [("立体データ", "pink", True), ("CUBE", "cyan", False), ("営業中", "amber", False), ("キューブ街", "violet", True),
         ("3D", "red", False), ("データ", "green", True), ("BAR", "amber", False), ("夜市", "pink", True)]
for k, (txt, col, vert) in enumerate(SIGNS):
    a = -1.25 + k * (2.5 / 5) if k < 6 else math.pi + (k - 6.5) * 1.3
    d = 27 + (k % 3) * 6
    x, z = math.sin(a) * d, -math.cos(a) * d
    ry = face_origin(x, z)
    nx, nz = math.sin(ry), math.cos(ry)
    n = len(txt)
    sw, sh = (2.2, 2.0 * n + 0.6) if vert else (1.9 * n + 1.0, 2.4)
    y = 3.5 + (k % 3) * 3 + sh / 2
    bw = max(9.0, sw + 3)
    bx, bz = x - nx * (bw / 2 + 0.5), z - nz * (bw / 2 + 0.5)  # 看板の後ろのビル
    btop = y + sh / 2 + rnd.uniform(3, 28)
    tower(bms["towerA" if k % 2 else "towerC"], uvls["towerA" if k % 2 else "towerC"], bx, bz, bw, bw, -140, btop, ry)
    placed.append((bx, bz, bw))
    if rnd.random() < 0.5:
        tops.append((bx, btop + 1.2, bz))
    w.box("towers", (sw, sh, 0.4), (x, y, z), M["sign_back"], ry=ry)
    neon_text(txt, col, 1.7, (x + nx * 0.24, y, z + nz * 0.24), ry, vertical=vert)
    for dy in (sh / 2, -sh / 2):  # 細い枠
        w.box("glow", (sw + 0.1, 0.06, 0.06), (x + nx * 0.22, y + dy, z + nz * 0.22), NEON[col], ry=ry)
    lc = NEON[col].node_tree.nodes["Emission"].inputs["Color"].default_value[:3]
    w.light("AREA", (x + nx * 2, y, z + nz * 2), 2600, lc, target=(x * 0.3, 0, z * 0.3), size=max(sw, sh) * 0.8)

# ---- 遠くの摩天楼 ----
for k in range(80):
    for _ in range(40):
        a = rnd.uniform(0, math.tau)
        d = 52 + rnd.random() ** 1.3 * 180
        x, z = math.sin(a) * d, math.cos(a) * d
        wd = 12 + rnd.random() * 16
        if all(math.hypot(x - px, z - pz) > (wd + pw) * 0.6 for px, pz, pw in placed):
            break
    placed.append((x, z, wd))
    top = -40 + rnd.random() ** 1.2 * 150
    key = rnd.choice(("towerA", "towerA", "towerB", "towerC"))
    dp, ry = wd * rnd.uniform(0.7, 1.3), rnd.uniform(0, math.pi)
    tower(bms[key], uvls[key], x, z, wd, dp, -140, top, ry)
    top0 = top
    if rnd.random() < 0.45:  # 上の段(セットバック)
        f = rnd.uniform(0.55, 0.8)
        top2 = top + rnd.uniform(6, 22)
        tower(bms[key], uvls[key], x, z, wd * f, dp * f, top, top2, ry)
        top = top2
    if rnd.random() < 0.3:
        tops.append((x, top + 1.2, z))
    # 壁の大型ビジョン
    if d < 130 and rnd.random() < 0.3 and top0 > 10:
        # 屋上にいちばん向いている壁に貼る
        best = max(range(4), key=lambda q: math.cos(ry + q * math.pi / 2 - face_origin(x, z)))
        fr = ry + best * math.pi / 2
        half = (dp if best % 2 == 0 else wd) / 2
        nx, nz = math.sin(fr), math.cos(fr)
        sw, sh = rnd.uniform(7, 11), rnd.uniform(5, 8)
        cy = rnd.uniform(max(-4, top0 - 30), top0 - sh / 2 - 2)
        w.plane("towers", min(sw, (wd if best % 2 == 0 else dp) - 2), sh, (x + nx * (half + 0.3), cy, z + nz * (half + 0.3)), rnd.choice(SCREENS), ry=fr)
for key, b in bms.items():
    w.mesh_from_bmesh("towers", key, b, M[key], smooth=False)
for x, y, z in tops:
    w.box("glow", (1.0, 1.0, 1.0), (x, y, z), NEON["beacon"])

# ---- 空のドーム(光の計算には加わらない) ----
bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=24, radius=480)
bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
dome = w.mesh_from_bmesh("sky", "sky", bm, M["sky"])
for k in ("visible_diffuse", "visible_glossy", "visible_transmission", "visible_volume_scatter", "visible_shadow"):
    setattr(dome, k, False)

# ---- 光 ----
w.light("SUN", (10, 30, 10), 0.08, (0.55, 0.62, 1.0), target=(0, 0, 0), angle=math.radians(8))  # 雲越しの街明かり
w.light("AREA", (0, 9, 0), 120, (0.4, 0.35, 0.9), target=(0, 0, 0), size=14)  # 雲の照り返し
w.light("AREA", (-HW - 2, 5, 4), 500, (0.1, 0.85, 1.0), target=(0, 0, 4), size=6)
w.light("AREA", (HW + 2, 5, -1), 450, (0.5, 0.3, 1.0), target=(0, 0, -1), size=6)

# ---- ブラウザ用の情報 ----
w.extra.update({
    "title": "ネオン街の屋上",
    "tip": "雨のネオン街。ホログラムの台の上に作品が浮かびます。床をタップかドラッグで見回して歩きます。",
    "start": {"x": 0, "z": HD - 2, "yaw": 0, "pitch": -0.06},
    "walk": [{"t": "rect", "x0": -HW + 0.8, "z0": -HD + 2.2, "x1": HW - 0.8, "z1": HD - 0.8}],
    "speed": 3,
    "bg": "#0a0614",
    "fog": ["#1a0c28", 0.006],
    "exposure": 1.15,
    "far": 700,
    "hemi": ["#5a46c8", "#0a0612", 0.55],
    "spotColor": "#cfe9ff",
    "spotIntensity": 2.0,
    "reflect": {"w": W, "l": D, "opacity": 0.78},
    "palette": ["#1a3aff", "#6ff6ff"],
    "glowCubes": True,
})

if A.still:
    w.still(A.still, (0, 1.6, HD - 2), (0, 1.0, 0), lens=18)
    if A.still_only:
        os._exit(0)

w.export(A.out)
# 空は霧で消さない
jp = os.path.splitext(A.out)[0] + ".json"
with open(jp) as f:
    info = json.load(f)
if "sky" in info["groups"]:
    info["groups"]["sky"]["nofog"] = True
with open(jp, "w") as f:
    json.dump(info, f, ensure_ascii=False, indent=1)
os._exit(0)
