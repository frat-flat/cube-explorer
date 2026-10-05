"""和の庭(縁側から見る枯山水)を Blender で組み、光を焼き込む。

    python3 tools/blender/zen.py --out public/worlds/zen.glb [--size 2048] [--samples 64] [--still still.png]

白砂の砂紋(石のまわりは同心円)・苔・庭石・石灯籠・紅葉と松・建仁寺垣と竹林・池。夕方の低い日差し。
作品は苔の上の庭石に載せた黒い石板の上。
"""
import json
import math
import os
import random
import sys

import bpy  # noqa: F401 (bmesh より先に読む)
import bmesh
from mathutils import Euler, Matrix, Vector, noise

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from worldkit import P, World, args, emit  # noqa: E402

A = args({"out": "zen.glb"})
N = 4
rnd = random.Random(7)
W, D = 30.0, 27.6
ZD = D / 2                       # 縁側の外側(屋内側)の端
DECK_Z0, DECK_H = ZD - 3.0, 0.42
POND = (8.5, -7.3, 3.4)
SUN_FROM = Vector((-26, 15, -12))  # three.js 座標での太陽の位置(左奥から差す)
ROCKS = [(-6.0, 3.5), (3.5, 1.0), (-2.5, -5.5), (0.5, -10.5)]  # 作品の石

w = World(samples=A.samples)

w.group("gravel", A.size, rough=0.95)       # 白砂
w.group("deck", A.size, rough=0.6)          # 縁側・軒・障子
w.group("stone", A.size, rough=0.9)         # 庭石・灯籠・飛石・石板
w.group("plants", A.size, rough=0.85, vcol=True)       # 苔・紅葉・松・刈込み
w.group("fence", A.size // 2, rough=0.7, vcol=True)    # 竹垣と竹林
w.group("water", A.size // 4, rough=0.05, opacity=0.78)
w.group("sky", A.size // 2, unlit=True)     # 夕方の空と遠い山
w.group("glow", bake=False)                 # 灯籠の火袋


# ---- 節点の小道具 ----
def nmat(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    return m, nt, nt.nodes["Principled BSDF"]


def nd(nt, kind, **kw):
    n = nt.nodes.new(kind)
    for k, v in kw.items():
        if hasattr(n, k):
            setattr(n, k, v)
        else:
            n.inputs[k].default_value = v
    return n


def mth(nt, op, a, b=None, clamp=False):
    n = nt.nodes.new("ShaderNodeMath")
    n.operation = op
    n.use_clamp = clamp
    for i, x in enumerate((a, b)):
        if x is None:
            continue
        if isinstance(x, (int, float)):
            n.inputs[i].default_value = x
        else:
            nt.links.new(x, n.inputs[i])
    return n.outputs[0]


def vmth(nt, op, a, b=None):
    n = nt.nodes.new("ShaderNodeVectorMath")
    n.operation = op
    for i, x in enumerate((a, b)):
        if x is None:
            continue
        if isinstance(x, (tuple, list, Vector)):
            n.inputs[i].default_value = tuple(x)
        else:
            nt.links.new(x, n.inputs[i])
    return n.outputs["Value" if op in ("DOT_PRODUCT", "LENGTH", "DISTANCE") else "Vector"]


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


def mix(nt, fac, a, b, blend="MIX"):
    n = nt.nodes.new("ShaderNodeMix")
    n.data_type = "RGBA"
    n.blend_type = blend
    for sock, x in (("Factor", fac), ("A", a), ("B", b)):
        if isinstance(x, (int, float)):
            n.inputs[sock].default_value = x
        elif isinstance(x, tuple):
            n.inputs[sock].default_value = (*x, 1) if len(x) == 3 else x
        else:
            nt.links.new(x, n.inputs[sock])
    return n.outputs["Result"]


def pos(nt):
    return nt.nodes.new("ShaderNodeNewGeometry").outputs["Position"]  # 世界座標(組にまとめても変わらない)


def tex(nt, kind, vec, **kw):
    n = nd(nt, kind, **kw)
    nt.links.new(vec, n.inputs["Vector"])
    return n


def bump(nt, bsdf, h, strength, dist=0.1):
    b = nd(nt, "ShaderNodeBump", Strength=strength, Distance=dist)
    nt.links.new(h, b.inputs["Height"])
    nt.links.new(b.outputs["Normal"], bsdf.inputs["Normal"])


def smooth(nt, x, e0, e1):
    n = nd(nt, "ShaderNodeMapRange", interpolation_type="SMOOTHSTEP", **{"From Min": e0, "From Max": e1})
    nt.links.new(x, n.inputs["Value"])
    return n.outputs[0]


def no_shadow(o):
    o.visible_shadow = False
    o.visible_diffuse = False
    o.visible_glossy = False
    o.visible_transmission = False
    o.visible_volume_scatter = False
    return o


def sun_angles():
    d = P(*SUN_FROM).normalized()
    return math.asin(d.z), math.atan2(d.x, d.y)


# ---- 材質 ----
RAKE = 0.11  # 砂紋の間隔(m)


def gravel_mat(centers):
    """白砂:平行の砂紋。centers=[(x, z, 半径)] のまわりは同心円の砂紋にする"""
    m, nt, bsdf = nmat("gravel")
    p = pos(nt)
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(p, sep.inputs[0])
    # 砂紋の線を少し揺らす(熊手の手のぶれ)
    wob = tex(nt, "ShaderNodeTexNoise", p, Scale=0.35, Detail=2.0)
    wy = mth(nt, "ADD", sep.outputs[1], mth(nt, "MULTIPLY", mth(nt, "SUBTRACT", wob.outputs["Fac"], 0.5), 0.35))
    phase = mth(nt, "MULTIPLY", wy, math.tau / RAKE)
    for (x, z, r) in centers:
        c = P(x, 0, z)
        d = vmth(nt, "DISTANCE", vmth(nt, "MULTIPLY", p, (1, 1, 0)), (c.x, c.y, 0))
        ring = mth(nt, "MULTIPLY", d, math.tau / RAKE)
        k = smooth(nt, d, r + 1.05, r + 0.9)  # 円の内側は 1
        phase = mth(nt, "ADD", mth(nt, "MULTIPLY", phase, mth(nt, "SUBTRACT", 1.0, k)), mth(nt, "MULTIPLY", ring, k))
    s = mth(nt, "MULTIPLY", mth(nt, "ADD", mth(nt, "SINE", phase), 1.0), 0.5)
    ridge = mth(nt, "POWER", s, 0.6)  # 山を丸く、谷を細く
    grain = tex(nt, "ShaderNodeTexVoronoi", p, Scale=180.0)
    gr2 = tex(nt, "ShaderNodeTexNoise", p, Scale=60.0, Detail=4.0)
    h = mth(nt, "ADD", ridge, mth(nt, "MULTIPLY", grain.outputs["Distance"], 0.25))
    bump(nt, bsdf, h, 0.9, 0.03)
    # 砂粒の色:白〜灰〜少し黄味。谷は少し暗い
    gc = ramp(nt, nd_r(nt, grain.outputs["Color"]), [(0.0, (0.48, 0.47, 0.44)), (0.4, (0.7, 0.69, 0.65)), (0.8, (0.78, 0.77, 0.74)), (1.0, (0.62, 0.58, 0.5))])
    gc = mix(nt, 0.25, gc, gr2.outputs["Color"], "OVERLAY")
    dirt = tex(nt, "ShaderNodeTexNoise", p, Scale=0.25, Detail=6.0)
    gc = mix(nt, smooth(nt, dirt.outputs["Fac"], 0.55, 0.75), gc, (0.55, 0.52, 0.46))
    gc = mix(nt, 1.0, gc, mix(nt, ridge, (0.8, 0.8, 0.8), (1, 1, 1)), "MULTIPLY")
    nt.links.new(gc, bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.95
    return m


def nd_r(nt, col):
    s = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(col, s.inputs[0])
    return s.outputs[0]


def surf_mat(name, cols, scale=4.0, bump_s=0.4, bscale=30.0, rough=0.8, w=0.0, detail=8.0):
    """色の段(cols=[(位置, 色)])をノイズで混ぜ、細かな凸凹を付けた汎用の材質"""
    m, nt, bsdf = nmat(name)
    p = pos(nt)
    n = tex(nt, "ShaderNodeTexNoise", p, Scale=scale, Detail=detail, Roughness=0.6, noise_dimensions="4D", W=w)
    col = ramp(nt, n.outputs["Fac"], cols)
    nt.links.new(col, bsdf.inputs["Base Color"])
    if bump_s:
        b = tex(nt, "ShaderNodeTexNoise", p, Scale=bscale, Detail=10.0, Roughness=0.65)
        bump(nt, bsdf, b.outputs["Fac"], bump_s, 0.05)
    bsdf.inputs["Roughness"].default_value = rough
    return m, nt, bsdf, col


def stone_mat(name, base, w):
    """庭石:灰色に黒い筋と、黄緑の地衣類の斑"""
    m, nt, bsdf, col = surf_mat(name, [(0.25, tuple(c * 0.45 for c in base)), (0.5, base), (0.7, tuple(min(1, c * 1.25) for c in base))],
                                scale=1.6, bump_s=0.6, bscale=7.0, rough=0.88, w=w)
    p = pos(nt)
    li = tex(nt, "ShaderNodeTexNoise", p, Scale=5.0, Detail=10.0, Roughness=0.7, noise_dimensions="4D", W=w + 3)
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    up = nd_z(nt, geo.outputs["Normal"])
    lk = mth(nt, "MULTIPLY", smooth(nt, li.outputs["Fac"], 0.56, 0.64), smooth(nt, up, 0.2, 0.8))
    col2 = mix(nt, lk, col, (0.32, 0.36, 0.16))
    nt.links.new(col2, bsdf.inputs["Base Color"])
    return m


def nd_z(nt, v):
    s = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(v, s.inputs[0])
    return s.outputs[2]


def wood_mat(name, base, dark, scale=(1, 1, 1), rough=0.55):
    """木目:長手方向に伸ばした波と年季の汚れ"""
    m, nt, bsdf = nmat(name)
    p = pos(nt)
    mp = nd(nt, "ShaderNodeMapping")
    mp.inputs["Scale"].default_value = scale
    nt.links.new(p, mp.inputs["Vector"])
    wv = tex(nt, "ShaderNodeTexWave", mp.outputs[0], wave_type="RINGS", Scale=3.0, Distortion=8.0, Detail=6.0, **{"Detail Scale": 1.5})
    col = ramp(nt, wv.outputs["Fac"], [(0.0, dark), (0.6, base), (1.0, tuple(min(1, c * 1.2) for c in base))])
    n = tex(nt, "ShaderNodeTexNoise", p, Scale=2.0, Detail=6.0)
    col = mix(nt, 0.35, col, n.outputs["Color"], "OVERLAY")
    nt.links.new(col, bsdf.inputs["Base Color"])
    bump(nt, bsdf, wv.outputs["Fac"], 0.15, 0.02)
    bsdf.inputs["Roughness"].default_value = rough
    return m


def sky_mat():
    """夕方の空(Nishita)に、遠い山並みの影を重ねる"""
    m, nt, _ = nmat("sky")
    d = vmth(nt, "NORMALIZE", pos(nt))
    el, rot = sun_angles()
    sk = nd(nt, "ShaderNodeTexSky", sky_type="NISHITA", sun_disc=False, sun_elevation=el, sun_rotation=rot, altitude=200, air_density=1.4, dust_density=2.5)
    nt.links.new(d, sk.inputs["Vector"])
    sky = mix(nt, 1.0, sk.outputs["Color"], (0.12, 0.12, 0.12), "MULTIPLY")
    z = nd_z(nt, d)
    flat = vmth(nt, "NORMALIZE", vmth(nt, "MULTIPLY", d, (1, 1, 0)))
    for k, (base, amp, col, sc) in enumerate(((0.05, 0.07, (0.36, 0.42, 0.5), 2.0), (0.02, 0.05, (0.2, 0.27, 0.26), 4.0))):
        n = tex(nt, "ShaderNodeTexNoise", flat, Scale=sc, Detail=6.0, Roughness=0.55, noise_dimensions="4D", W=k * 5.0)
        hz = mth(nt, "ADD", base, mth(nt, "MULTIPLY", n.outputs["Fac"], amp))
        inside = smooth(nt, mth(nt, "SUBTRACT", hz, z), -0.002, 0.002)
        sky = mix(nt, inside, sky, col)
    out = nt.nodes["Material Output"]
    nt.nodes.remove(nt.nodes["Principled BSDF"])
    e = nd(nt, "ShaderNodeEmission", Strength=1.0)
    nt.links.new(sky, e.inputs["Color"])
    nt.links.new(e.outputs[0], out.inputs[0])
    return m


def leaf_mat(name, cols, w):
    m, nt, bsdf, col = surf_mat(name, cols, scale=3.0, bump_s=1.0, bscale=26.0, rough=0.75, w=w)
    # 葉の塊らしく、細かな影の斑
    vo = tex(nt, "ShaderNodeTexVoronoi", pos(nt), Scale=14.0)
    col2 = mix(nt, 1.0, col, ramp(nt, vo.outputs["Distance"], [(0.0, (0.55, 0.55, 0.55)), (0.35, (1, 1, 1))]), "MULTIPLY")
    nt.links.new(col2, bsdf.inputs["Base Color"])
    return m


def water_mat():
    m, nt, bsdf = nmat("water")
    bsdf.inputs["Base Color"].default_value = (0.03, 0.07, 0.06, 1)
    bsdf.inputs["Roughness"].default_value = 0.04
    n = tex(nt, "ShaderNodeTexNoise", pos(nt), Scale=3.0, Detail=4.0)
    bump(nt, bsdf, n.outputs["Fac"], 0.08, 0.02)
    return m


M = {
    "gravel": gravel_mat([(x, z, 1.75) for x, z in ROCKS] + [(-11.0, -3.0, 1.6), (6.5, 7.0, 1.2), (POND[0], POND[1], POND[2] + 0.4)]),
    "rock": stone_mat("rock", (0.36, 0.35, 0.33), 0.0),
    "rock2": stone_mat("rock2", (0.3, 0.3, 0.3), 4.0),
    "lantern": stone_mat("lantern", (0.46, 0.45, 0.42), 8.0),
    "slate": surf_mat("slate", [(0.3, (0.035, 0.035, 0.038)), (0.7, (0.08, 0.08, 0.085))], scale=6, bump_s=0.15, bscale=40, rough=0.45)[0],
    "moss": surf_mat("moss", [(0.2, (0.05, 0.09, 0.02)), (0.45, (0.12, 0.2, 0.04)), (0.7, (0.2, 0.28, 0.06)), (0.9, (0.3, 0.3, 0.08))],
                     scale=3.0, bump_s=0.8, bscale=90.0, rough=0.95)[0],
    "maple": leaf_mat("maple", [(0.2, (0.42, 0.04, 0.02)), (0.45, (0.65, 0.1, 0.03)), (0.65, (0.8, 0.28, 0.04)), (0.85, (0.85, 0.5, 0.08))], 1.0),
    "maple2": leaf_mat("maple2", [(0.25, (0.35, 0.03, 0.03)), (0.55, (0.58, 0.06, 0.04)), (0.85, (0.75, 0.2, 0.05))], 6.0),
    "pine": leaf_mat("pine", [(0.3, (0.03, 0.06, 0.03)), (0.6, (0.07, 0.13, 0.05)), (0.9, (0.12, 0.18, 0.07))], 2.0),
    "shrub": leaf_mat("shrub", [(0.3, (0.04, 0.09, 0.03)), (0.6, (0.09, 0.17, 0.05)), (0.9, (0.16, 0.24, 0.07))], 3.0),
    "bamboo_leaf": leaf_mat("bamboo_leaf", [(0.3, (0.07, 0.13, 0.035)), (0.6, (0.15, 0.24, 0.06)), (0.9, (0.27, 0.33, 0.1))], 5.0),
    "bark": surf_mat("bark", [(0.3, (0.04, 0.03, 0.025)), (0.6, (0.1, 0.075, 0.06)), (0.85, (0.17, 0.15, 0.12))], scale=6, bump_s=0.8, bscale=20, rough=0.9)[0],
    "pine_bark": surf_mat("pine_bark", [(0.3, (0.07, 0.05, 0.04)), (0.6, (0.2, 0.14, 0.1)), (0.85, (0.3, 0.24, 0.18))], scale=10, bump_s=1.0, bscale=12, rough=0.9)[0],
    "deck": wood_mat("deck", (0.32, 0.2, 0.11), (0.14, 0.08, 0.04), (0.08, 1.0, 1.0), 0.35),
    "post": wood_mat("post", (0.28, 0.18, 0.1), (0.12, 0.07, 0.035), (1.0, 1.0, 0.08), 0.6),
    "beam": wood_mat("beam", (0.12, 0.08, 0.05), (0.05, 0.03, 0.02), (0.08, 1.0, 1.0), 0.6),
    "tile": surf_mat("tile", [(0.3, (0.06, 0.065, 0.07)), (0.7, (0.12, 0.125, 0.13))], scale=5, bump_s=0.2, bscale=40, rough=0.45)[0],
    "paper": surf_mat("paper", [(0.3, (0.78, 0.76, 0.7)), (0.7, (0.86, 0.84, 0.78))], scale=20, bump_s=0.05, bscale=80, rough=0.9)[0],
    "bamboo": surf_mat("bamboo", [(0.25, (0.38, 0.3, 0.14)), (0.5, (0.55, 0.45, 0.22)), (0.75, (0.48, 0.42, 0.2))], scale=8, bump_s=0.1, bscale=60, rough=0.5, w=1.0)[0],
    "culm": surf_mat("culm", [(0.25, (0.16, 0.24, 0.07)), (0.55, (0.3, 0.38, 0.12)), (0.8, (0.42, 0.44, 0.2))], scale=3, bump_s=0.05, bscale=60, rough=0.45, w=2.0)[0],
    "rope": surf_mat("rope", [(0.3, (0.04, 0.03, 0.02)), (0.7, (0.1, 0.07, 0.04))], scale=40, bump_s=0.4, bscale=200, rough=0.9)[0],
    "water": water_mat(),
    "sky": sky_mat(),
    "pad": surf_mat("pad", [(0.3, (0.08, 0.16, 0.04)), (0.7, (0.16, 0.26, 0.06))], scale=6, bump_s=0.2, bscale=30, rough=0.5)[0],
}
FIRE = emit("fire", (1.0, 0.6, 0.25), 3.0)


# ---- 形の道具 ----
def blob(radius, stretch=(1, 1, 1), sub=3, seed=0, amp=0.3, freq=1.2, flat=None, floor=None):
    """ノイズでゆがめた塊(岩・苔・葉の塊)。flat=上を平らに、floor=下を平らに(半径に対する割合)"""
    r = random.Random(seed)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0)
    off = Vector((r.random() * 50, r.random() * 50, r.random() * 50))
    for v in bm.verts:
        d = v.co.normalized()
        h = 1 + amp * noise.fractal(d * freq + off, 0.7, 2.1, 6)
        v.co = Vector((d.x * stretch[0], d.y * stretch[1], d.z * stretch[2])) * radius * h
    for lim, up in ((flat, True), (floor, False)):
        if lim is None:
            continue
        t = lim * radius * stretch[2]
        for v in bm.verts:
            if (up and v.co.z > t) or (not up and v.co.z < t):
                v.co.z = t
    return bm


def place(bm, center, rot=None):
    if rot is not None:
        bmesh.ops.rotate(bm, verts=bm.verts[:], cent=(0, 0, 0), matrix=rot)
    bmesh.ops.translate(bm, verts=bm.verts[:], vec=P(*center))
    return bm


def tube(bm, a, b, r0, r1, seg=7):
    """a から b への円錐台(三 three.js 座標)"""
    a, b = P(*a), P(*b)
    ax = (b - a)
    q = ax.normalized().to_track_quat("Z", "Y").to_matrix()
    ring = []
    for t, r in ((0, r0), (1, r1)):
        ring.append([bm.verts.new(a + ax * t + q @ Vector((math.cos(k / seg * math.tau) * r, math.sin(k / seg * math.tau) * r, 0))) for k in range(seg)])
    for k in range(seg):
        bm.faces.new((ring[0][k], ring[0][(k + 1) % seg], ring[1][(k + 1) % seg], ring[1][k]))


def rz(a):
    return Matrix.Rotation(a, 3, "Z")


# ---- 空 ----
bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=24, radius=150)
bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
no_shadow(w.mesh_from_bmesh("sky", "sky", bm, M["sky"]))

# ---- 白砂の地面(縁側の下まで) ----
bm = bmesh.new()
bmesh.ops.create_grid(bm, x_segments=90, y_segments=84, size=1.0)
bmesh.ops.scale(bm, vec=(W / 2 + 0.5, D / 2 + 0.5, 1), verts=bm.verts[:])
for v in bm.verts:  # ほんの少しのうねり
    v.co.z = noise.noise(Vector((v.co.x * 0.15, v.co.y * 0.15, 0.3))) * 0.03
bmesh.ops.translate(bm, verts=bm.verts[:], vec=(0, 0, 0))
w.mesh_from_bmesh("gravel", "gravel", bm, M["gravel"])
# 外の土(垣の外、竹林の下)
w.plane("plants", W + 40, 30, (0, -0.02, -D / 2 - 14), M["moss"], face_up=True)
for s in (-1, 1):
    w.plane("plants", 20, D + 2, (s * (W / 2 + 10), -0.02, 0), M["moss"], face_up=True)

# ---- 作品の庭石・苔・石板 ----
DECK_C = (0.0, ZD - 2.0)
for i, (x, z) in enumerate(ROCKS):
    bm = blob(1.0, (1.3, 1.15, 0.8), sub=4, seed=20 + i, amp=0.3, freq=1.2, flat=0.42)
    top = 0.55
    place(bm, (x, top - 0.42 * 0.8, z), rz(rnd.random() * 6))
    w.mesh_from_bmesh("stone", "rock", bm, M["rock" if i % 2 else "rock2"])
    w.cyl("stone", 0.76, 0.8, 0.08, (x, top + 0.04, z), M["slate"], seg=40)
    bm = blob(1.0, (1.95, 1.7, 0.16), sub=4, seed=40 + i, amp=0.12, freq=1.5, floor=0.0)
    place(bm, (x, -0.03, z), rz(rnd.random() * 6))
    w.mesh_from_bmesh("plants", "moss", bm, M["moss"])
    # 添え石
    for k in range(2):
        t = rnd.random() * math.tau
        s = 0.3 + rnd.random() * 0.25
        bm = blob(s, (1.3, 1.0, 0.8), sub=3, seed=60 + i * 3 + k, amp=0.25, floor=-0.3)
        place(bm, (x + math.cos(t) * 1.35, 0.05, z + math.sin(t) * 1.2), rz(t))
        w.mesh_from_bmesh("stone", "rock_s", bm, M["rock2"])
    face = math.atan2(DECK_C[0] - x, DECK_C[1] - z)
    w.spot(x=x, y=top + 0.08, z=z, face=face, dist=3.4, r=1.7, lift=0.04)

# 三尊石と苔の島(作品のない石組)
for (x, z, r), seed in (((-11.0, -3.0, 1.6), 80), ((6.5, 7.0, 1.2), 90)):
    bm = blob(1.0, (r * 1.15, r, 0.14), sub=4, seed=seed, amp=0.12, floor=0.0)
    place(bm, (x, -0.03, z))
    w.mesh_from_bmesh("plants", "moss", bm, M["moss"])
    for k, (dx, dz, s, h) in enumerate(((0, 0, 0.55, 1.9), (0.75, 0.35, 0.4, 1.1), (-0.65, 0.4, 0.35, 0.9))):
        bm = blob(s, (1.0, 0.9, h), sub=4, seed=seed + k, amp=0.25, freq=1.4, floor=-0.2)
        place(bm, (x + dx * r, s * h * 0.2, z + dz * r), rz(rnd.random() * 6))
        w.mesh_from_bmesh("stone", "sanzon", bm, M["rock"])

# ---- 縁側(engawa)・柱・軒・障子 ----
FRONT = DECK_Z0
PW = 0.18
z = FRONT
while z < ZD - 0.01:  # 床板(長手方向に通す)
    w.box("deck", (W + 1.0, 0.035, PW - 0.006), (0, DECK_H - 0.0175, z + PW / 2), M["deck"])
    z += PW
w.box("deck", (W + 1.0, 0.12, 0.08), (0, DECK_H - 0.1, FRONT + 0.04), M["beam"])          # 縁框
w.box("deck", (W + 1.0, DECK_H - 0.1, 0.05), (0, (DECK_H - 0.1) / 2, FRONT + 0.4), M["beam"])  # 床下の影
for x in [-W / 2 - 0.3 + k * (W + 0.6) / 7 for k in range(8)]:  # 真ん中に柱を立てない
    w.box("deck", (0.12, DECK_H - 0.12, 0.12), (x, (DECK_H - 0.12) / 2, FRONT + 0.25), M["post"])  # 束
    w.box("deck", (0.16, 2.3, 0.16), (x, DECK_H + 1.15, FRONT + 0.12), M["post"])               # 柱
# 桁・垂木・軒(手前に 1m 出す)
EAVE_Y0, EAVE_Y1 = DECK_H + 2.3, DECK_H + 3.1
w.box("deck", (W + 1.0, 0.24, 0.2), (0, EAVE_Y0 + 0.12, FRONT + 0.12), M["beam"])
z0, z1 = FRONT - 1.1, ZD
for x in [-W / 2 - 0.5 + k * 0.45 for k in range(int((W + 1.0) / 0.45) + 1)]:
    bm = bmesh.new()
    tube(bm, (x, EAVE_Y0 + 0.28, z0), (x, EAVE_Y1, z1), 0.05, 0.05, seg=4)
    w.mesh_from_bmesh("deck", "rafter", bm, M["beam"], smooth=False)
# 野地板と瓦(斜めの板の上に丸瓦の列)
sl = math.atan2(EAVE_Y1 - EAVE_Y0 - 0.28, z1 - z0)
L = math.hypot(EAVE_Y1 - EAVE_Y0 - 0.28, z1 - z0)
bm = bmesh.new()
bmesh.ops.create_cube(bm, size=1.0)
bmesh.ops.scale(bm, vec=(W + 1.2, L + 0.2, 0.05), verts=bm.verts[:])
bmesh.ops.rotate(bm, verts=bm.verts[:], cent=(0, 0, 0), matrix=Matrix.Rotation(sl, 3, "X"))
place(bm, (0, (EAVE_Y0 + 0.28 + EAVE_Y1) / 2 + 0.08, (z0 + z1) / 2))
w.mesh_from_bmesh("deck", "roofboard", bm, M["beam"], smooth=False)
for x in [-W / 2 - 0.55 + k * 0.28 for k in range(int((W + 1.1) / 0.28) + 1)]:
    bm = bmesh.new()
    tube(bm, (x, EAVE_Y0 + 0.42, z0 - 0.08), (x, EAVE_Y1 + 0.14, z1), 0.1, 0.1, seg=8)
    w.mesh_from_bmesh("deck", "tile", bm, M["tile"])
w.box("deck", (W + 1.3, 0.16, 0.12), (0, EAVE_Y0 + 0.36, z0 - 0.06), M["tile"])  # 軒先の瓦
# 雨樋は省き、奥は障子(格子と紙)
w.box("deck", (W + 1.0, 0.1, 0.12), (0, DECK_H + 0.05, ZD - 0.06), M["beam"])
w.box("deck", (W + 1.0, 0.16, 0.12), (0, DECK_H + 2.2, ZD - 0.06), M["beam"])
w.box("deck", (W + 1.0, EAVE_Y1 - DECK_H - 2.28, 0.1), (0, (DECK_H + 2.28 + EAVE_Y1) / 2, ZD - 0.05), M["paper"])
w.plane("deck", W + 1.0, 2.1, (0, DECK_H + 1.15, ZD - 0.03), M["paper"], ry=math.pi)
for x in [-W / 2 - 0.5 + k * 0.3 for k in range(int((W + 1.0) / 0.3) + 1)]:
    w.box("deck", (0.025, 2.1, 0.03), (x, DECK_H + 1.15, ZD - 0.06), M["post"])
for y in [DECK_H + 0.1 + k * 0.3 for k in range(8)]:
    w.box("deck", (W + 1.0, 0.025, 0.03), (0, y, ZD - 0.06), M["post"])
# 両端の壁(縁側の端を閉じる)
for s in (-1, 1):
    w.box("deck", (0.15, EAVE_Y1, 3.3), (s * (W / 2 + 0.55), EAVE_Y1 / 2, ZD - 1.55), M["paper"])
    w.box("deck", (0.18, EAVE_Y1, 0.16), (s * (W / 2 + 0.55), EAVE_Y1 / 2, ZD - 0.08), M["post"])

# 沓脱石と飛石
bm = blob(0.42, (1.5, 0.9, 0.5), sub=3, seed=5, amp=0.1, flat=0.5, floor=-0.6)
place(bm, (0, 0.17, FRONT - 0.5))
w.mesh_from_bmesh("stone", "kutsunugi", bm, M["rock"])
for k in range(9):
    x = math.sin(k * 0.8) * 0.9 - 1.0 - k * 0.15
    s = 0.33 + rnd.random() * 0.1
    bm = blob(s, (1.2, 1.0, 0.25), sub=3, seed=200 + k, amp=0.1, flat=0.5, floor=-0.5)
    place(bm, (x, 0.04, FRONT - 1.5 - k * 0.95), rz(rnd.random() * 6))
    w.mesh_from_bmesh("stone", "tobiishi", bm, M["rock2"])


# ---- 石灯籠 ----
def hexcyl(r0, r1, h, y, x, z, m, seg=6, rot=0.0, caps=True):
    o = w.cyl("stone", r1, r0, h, (x, y + h / 2, z), m, seg=seg, caps=caps)
    o.rotation_euler = (0, 0, rot)
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(rotation=True)
    bpy.ops.object.shade_flat()
    return o


def kasuga(x, z, s=1.0):
    m = M["lantern"]
    y = 0
    for r0, r1, h in ((0.42, 0.36, 0.14), (0.28, 0.2, 0.12)):
        hexcyl(r0 * s, r1 * s, h * s, y, x, z, m)
        y += h * s
    w.cyl("stone", 0.11 * s, 0.13 * s, 0.85 * s, (x, y + 0.425 * s, z), m, seg=16)  # 竿
    for yy in (0.25, 0.6):
        w.cyl("stone", 0.14 * s, 0.14 * s, 0.03 * s, (x, y + yy * s, z), m, seg=16)
    y += 0.85 * s
    hexcyl(0.2 * s, 0.36 * s, 0.14 * s, y, x, z, m)  # 中台
    y += 0.14 * s
    # 火袋:六本の柱と中の火
    for k in range(6):
        t = k / 6 * math.tau
        w.box("stone", (0.07 * s, 0.34 * s, 0.07 * s), (x + math.cos(t) * 0.24 * s, y + 0.17 * s, z + math.sin(t) * 0.24 * s), m, ry=-t)
    w.cyl("glow", 0.2 * s, 0.2 * s, 0.3 * s, (x, y + 0.17 * s, z), FIRE, seg=12)
    y += 0.34 * s
    hexcyl(0.42 * s, 0.56 * s, 0.07 * s, y, x, z, m)  # 笠の下端
    y += 0.07 * s
    hexcyl(0.56 * s, 0.1 * s, 0.32 * s, y, x, z, m)   # 笠
    y += 0.32 * s
    w.cyl("stone", 0.07 * s, 0.11 * s, 0.08 * s, (x, y + 0.04 * s, z), m, seg=12)
    o = w.cyl("stone", 0.0, 0.1 * s, 0.22 * s, (x, y + 0.19 * s, z), m, seg=12)  # 宝珠
    w.light("POINT", (x, y - 0.5 * s, z), 6, (1.0, 0.62, 0.3), shadow_soft_size=0.08)
    return o


def yukimi(x, z):
    """雪見灯籠:三本脚と広い笠(池の畔)"""
    m = M["lantern"]
    for k in range(3):
        t = k / 3 * math.tau + 0.3
        bm = bmesh.new()
        tube(bm, (x + math.cos(t) * 0.55, 0, z + math.sin(t) * 0.55), (x + math.cos(t) * 0.3, 0.55, z + math.sin(t) * 0.3), 0.07, 0.06, seg=8)
        w.mesh_from_bmesh("stone", "leg", bm, m)
    hexcyl(0.4, 0.4, 0.08, 0.55, x, z, m)
    for k in range(6):
        t = k / 6 * math.tau
        w.box("stone", (0.06, 0.26, 0.06), (x + math.cos(t) * 0.26, 0.76, z + math.sin(t) * 0.26), m, ry=-t)
    w.cyl("glow", 0.2, 0.2, 0.22, (x, 0.76, z), FIRE, seg=12)
    hexcyl(0.95, 0.95, 0.06, 0.89, x, z, m)
    hexcyl(0.95, 0.12, 0.34, 0.95, x, z, m)
    w.cyl("stone", 0.0, 0.1, 0.22, (x, 1.4, z), m, seg=12)
    w.light("POINT", (x, 0.76, z), 5, (1.0, 0.62, 0.3), shadow_soft_size=0.08)


kasuga(-W / 2 + 3.5, ZD - 6.5)
kasuga(W / 2 - 3.0, ZD - 8.0, 0.9)
kasuga(-W / 2 + 4.0, -D / 2 + 4.0, 1.1)
yukimi(POND[0] - POND[2] - 0.9, POND[1] + 1.8)

# ---- 池:水面・縁の石・睡蓮の葉 ----
bm = bmesh.new()
bmesh.ops.create_circle(bm, cap_ends=True, segments=64, radius=POND[2] + 0.1)
place(bm, (POND[0], 0.02, POND[1]))
w.mesh_from_bmesh("water", "water", bm, M["water"], smooth=False)
for a in range(30):
    t = a / 30 * math.tau + rnd.random() * 0.1
    s = 0.22 + rnd.random() * 0.25
    bm = blob(s, (1.3, 1.0, 0.7), sub=3, seed=400 + a, amp=0.25, floor=-0.3)
    place(bm, (POND[0] + math.cos(t) * (POND[2] + 0.1), s * 0.12, POND[1] + math.sin(t) * (POND[2] + 0.1)), rz(t))
    w.mesh_from_bmesh("stone", "edge", bm, M["rock2" if a % 3 else "rock"])
for k in range(7):
    t = rnd.random() * math.tau
    d = rnd.random() * (POND[2] - 0.8)
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=True, segments=16, radius=0.2 + rnd.random() * 0.15)
    place(bm, (POND[0] + math.cos(t) * d, 0.035, POND[1] + math.sin(t) * d))
    w.mesh_from_bmesh("plants", "pad", bm, M["pad"], smooth=False)


# ---- 木:紅葉と松 ----
def tree(x, z, h, leaf_mats, pine=False, seed=0):
    r = random.Random(seed)
    bm = bmesh.new()
    tips = []

    def branch(a, d, ln, rad, depth):
        b = tuple(a[i] + d[i] * ln for i in range(3))
        tube(bm, a, b, rad, rad * 0.72, seg=7)
        if depth == 0:
            tips.append(b)
            return
        for _ in range(2 if depth > 1 else 3):
            nd_ = Vector((d[0] + (r.random() - 0.5) * (1.6 if pine else 1.2), d[1] + (0.05 if pine else 0.35), d[2] + (r.random() - 0.5) * (1.6 if pine else 1.2))).normalized()
            branch(b, tuple(nd_), ln * (0.78 if pine else 0.72), rad * 0.62, depth - 1)

    lean = (r.random() - 0.5) * (0.5 if pine else 0.25)
    branch((x, -0.05, z), (lean, 1.0, (r.random() - 0.5) * 0.25), h * (0.45 if pine else 0.36), 0.16 if pine else 0.13, 3 if pine else 4)
    w.mesh_from_bmesh("plants", "trunk", bm, M["pine_bark" if pine else "bark"])
    for k, t in enumerate(tips):
        s = (0.75 + r.random() * 0.4) if pine else (0.38 + r.random() * 0.25)
        st = (1.4, 1.2, 0.38) if pine else (1.0, 1.0, 0.7)
        bm2 = blob(s, st, sub=2, seed=seed * 100 + k, amp=0.3 if pine else 0.5, freq=1.8 if pine else 2.6)
        place(bm2, (t[0], t[1] + (0.05 if pine else 0.15), t[2]), rz(r.random() * 6))
        w.mesh_from_bmesh("plants", "leaves", bm2, leaf_mats[k % len(leaf_mats)])
        if not pine:  # 内側を埋める小さな塊
            bm2 = blob(s * 0.9, (1, 1, 0.8), sub=2, seed=seed * 100 + k + 50, amp=0.5, freq=2.6)
            place(bm2, ((t[0] + x) / 2 * 0.3 + t[0] * 0.7, t[1] - 0.4, (t[2] + z) / 2 * 0.3 + t[2] * 0.7))
            w.mesh_from_bmesh("plants", "leaves", bm2, leaf_mats[(k + 1) % len(leaf_mats)])


MAPLE = [M["maple"], M["maple2"]]
for (x, z, h, s) in ((-11.5, 1.0, 4.2, 1), (11.0, 3.5, 3.8, 2), (-5.5, -11.5, 4.6, 3), (5.0, -11.8, 3.6, 4)):
    tree(x, z, h, MAPLE, seed=s)
tree(12.0, -2.0, 3.4, [M["pine"]], pine=True, seed=9)
tree(-12.5, 8.0, 3.0, [M["pine"]], pine=True, seed=10)
# 散った紅葉(苔と砂の上)
for k in range(260):
    x, z = (rnd.random() - 0.5) * (W - 2), -D / 2 + 1 + rnd.random() * (D - 5)
    near = min(math.hypot(x - tx, z - tz) for tx, tz in ((-11.5, 1.0), (11.0, 3.5), (-5.5, -11.5), (5.0, -11.8)))
    if near > 4.5 and rnd.random() < 0.85:
        continue
    if math.hypot(x - POND[0], z - POND[1]) < POND[2] + 0.3:
        continue
    w.plane("plants", 0.07, 0.06, (x, 0.012, z), MAPLE[k % 2], ry=rnd.random() * 6, face_up=True)
# 刈込み(つつじの丸い茂み)を垣の足元に
for k in range(16):
    side = k % 3
    if side == 0:
        x, z = (rnd.random() - 0.5) * (W - 4), -D / 2 + 0.9
    else:
        x, z = (-1 if side == 1 else 1) * (W / 2 - 0.9), -D / 2 + 3 + rnd.random() * (D - 9)
    if math.hypot(x - POND[0], z - POND[1]) < POND[2] + 1.2:
        continue
    s = 0.6 + rnd.random() * 0.5
    bm = blob(s, (1.3, 1.1, 0.75), sub=3, seed=500 + k, amp=0.12, freq=2.0, floor=-0.1)
    place(bm, (x, 0.05, z), rz(rnd.random() * 6))
    w.mesh_from_bmesh("plants", "shrub", bm, M["shrub"])

# ---- 建仁寺垣(割竹を縦に密に並べ、押縁を三段) と竹林 ----
FH = 1.9


def fence_line(x0, z0, x1, z1):
    L = math.hypot(x1 - x0, z1 - z0)
    ux, uz = (x1 - x0) / L, (z1 - z0) / L
    bm = bmesh.new()
    d = 0.0
    while d < L:
        x, z = x0 + ux * d, z0 + uz * d
        r0 = 0.032 + rnd.random() * 0.008
        tube(bm, (x, 0, z), (x, FH + rnd.random() * 0.02, z), r0, r0, seg=5)
        d += 0.062
    w.mesh_from_bmesh("fence", "fence", bm, M["bamboo"])
    bm = bmesh.new()
    nx, nz = -uz * 0.05, ux * 0.05
    for s in (1, -1):
        for y in (0.35, 1.0, 1.65):
            tube(bm, (x0 + nx * s, y, z0 + nz * s), (x1 + nx * s, y, z1 + nz * s), 0.035, 0.035, seg=6)
    for k in range(int(L / 1.8) + 1):
        x, z = x0 + ux * k * 1.8, z0 + uz * k * 1.8
        tube(bm, (x + nx * 1.3, 0, z + nz * 1.3), (x + nx * 1.3, FH + 0.12, z + nz * 1.3), 0.06, 0.06, seg=8)
    w.mesh_from_bmesh("fence", "rails", bm, M["culm"])
    # 笠竹
    bm = bmesh.new()
    tube(bm, (x0, FH + 0.04, z0), (x1, FH + 0.04, z1), 0.07, 0.07, seg=8)
    w.mesh_from_bmesh("fence", "cap", bm, M["culm"])


fence_line(-W / 2, -D / 2, W / 2, -D / 2)
fence_line(-W / 2, -D / 2, -W / 2, DECK_Z0 - 0.3)
fence_line(W / 2, -D / 2, W / 2, DECK_Z0 - 0.3)
# 竹林(垣の外)
bm = bmesh.new()
tops = []
for k in range(300):
    side = k % 3
    if side == 0:
        x, z = (rnd.random() - 0.5) * (W + 14), -D / 2 - 1.2 - rnd.random() * 9
    else:
        x, z = (-1 if side == 1 else 1) * (W / 2 + 1.2 + rnd.random() * 8), -D / 2 + rnd.random() * (D - 2)
    h = 7 + rnd.random() * 4
    r0 = 0.05 + rnd.random() * 0.04
    lx, lz = (rnd.random() - 0.5) * 0.9, (rnd.random() - 0.5) * 0.9
    tube(bm, (x, 0, z), (x + lx, h, z + lz), r0, r0 * 0.6, seg=6)
    tops.append((x + lx * 0.8, h * 0.82, z + lz * 0.8))
w.mesh_from_bmesh("fence", "culms", bm, M["culm"])
for k, (x, y, z) in enumerate(tops):
    if k % 2:
        continue
    for q in range(11):
        t = rnd.random() * math.tau
        o = 0.2 + rnd.random() * 1.1
        yy = y * (0.55 + rnd.random() * 0.55)
        bm = blob(0.35 + rnd.random() * 0.4, (1.2, 1.0, 0.75), sub=1, seed=700 + k * 11 + q, amp=0.5, freq=2.5)
        place(bm, (x + math.cos(t) * o, yy, z + math.sin(t) * o), rz(t))
        w.mesh_from_bmesh("plants", "bamboo_top", bm, M["bamboo_leaf"])

# ---- 光:夕方の空と、左奥からの低い日差し ----
wn = w.sc.world.node_tree
el, rot = sun_angles()
sk = wn.nodes.new("ShaderNodeTexSky")
sk.sky_type = "NISHITA"
sk.sun_disc = False
sk.sun_elevation, sk.sun_rotation = el, rot
sk.altitude, sk.air_density, sk.dust_density = 200, 1.4, 2.5
bg = wn.nodes["Background"]
wn.links.new(sk.outputs[0], bg.inputs["Color"])
bg.inputs["Strength"].default_value = 0.12
w.light("SUN", tuple(SUN_FROM), 4.2, (1.0, 0.72, 0.45), target=(0, 0, 0), angle=math.radians(1.2))

sd = SUN_FROM.normalized()
w.extra.update({
    "title": "和の庭",
    "tip": "縁側から庭へ下りて、石の上の作品を見て回ります。床をタップで移動、ドラッグで見回せます。",
    "start": {"x": 0, "z": ZD - 1.0, "yaw": 0, "pitch": -0.1},
    "walk": [{"t": "rect", "x0": -W / 2 + 1.2, "z0": -D / 2 + 1.2, "x1": W / 2 - 1.2, "z1": ZD - 0.8}],
    "bg": "#c9d3df", "fog": ["#ddd2c0", 0.012], "exposure": 1.0,
    "hemi": ["#d7e2ff", "#5a4a32", 0.55],
    "sun": {"dir": [sd.x, sd.y, sd.z], "color": "#ffcf96", "intensity": 1.35, "box": 20},
    "reflect": {"r": POND[2], "x": POND[0], "z": POND[1], "y": 0.02, "group": "water", "opacity": 0.78},
    "palette": ["#ece6d8", "#2b2f3a"],
})

if A.still:
    w.still(A.still, (0, 1.6, ZD - 1.0), (0, 1.6 - math.tan(0.1) * 10, ZD - 11.0), lens=16)
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
