"""宇宙空間(自由に飛べる)を Blender で組み、光を焼き込む。

    python3 tools/blender/space.py --out public/worlds/space.glb [--size 2048] [--samples 64] [--still still.png]

作品は小惑星を削った台の上。帯模様と環のある巨大な惑星・クレーターの月・小惑星帯・天の川と星雲(光らない空の球に焼く)。
"""
import math
import os
import random
import sys

import bpy  # noqa: F401 (bmesh より先に読む)
import bmesh
from mathutils import Euler, Matrix, Vector, noise

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from worldkit import P, World, args, emit  # noqa: E402

A = args({"out": "space.glb"})
N = 4
rnd = random.Random(6)
SKY = 420.0
SUN = Vector((260, 80, -120)).normalized()     # three.js 座標での太陽の向き
PL_C, PL_R = (-150, -30, -230), 46.0            # 惑星
MOON_C, MOON_R = (95, 42, -205), 9.0

w = World(samples=A.samples)
w.sky((0.004, 0.005, 0.012), 1.0)  # ごく弱い環境光(夜側が真っ黒にならない程度)

w.group("sky", A.size, unlit=True)            # 天の川・星雲・太陽(空の球)
w.group("planet", A.size, rough=0.9)          # 惑星と環
w.group("moon", A.size // 2, rough=0.95)
w.group("rock", A.size, rough=0.92)           # 小惑星と作品の台
w.group("metal", A.size // 4, rough=0.35, metal=1.0)
w.group("halo", A.size // 4, unlit=True, opacity=0.85)  # 惑星の大気の縁
w.group("glow", bake=False)                   # 星・台の光の輪


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


def as_emission(m, nt, col, strength=1.0):
    out = nt.nodes["Material Output"]
    nt.nodes.remove(nt.nodes["Principled BSDF"])
    e = nd(nt, "ShaderNodeEmission", Strength=strength)
    nt.links.new(col, e.inputs["Color"])
    nt.links.new(e.outputs[0], out.inputs[0])


def no_shadow(o):
    """空や光の縁は光を遮らない・照り返さない"""
    o.visible_shadow = False
    o.visible_diffuse = False
    o.visible_glossy = False
    o.visible_transmission = False
    o.visible_volume_scatter = False
    return o


# ---- 材質 ----
def sky_mat():
    m, nt, _ = nmat("sky")
    d = vmth(nt, "NORMALIZE", pos(nt))
    # 細かい星(二層)
    stars = None
    for sc, sz, k in ((260.0, 0.07, 1.4), (700.0, 0.09, 0.7)):
        vo = nd(nt, "ShaderNodeTexVoronoi", Scale=sc)
        nt.links.new(d, vo.inputs["Vector"])
        dot = nd(nt, "ShaderNodeMapRange", **{"From Min": 0.0, "From Max": sz, "To Min": 1.0, "To Max": 0.0})
        nt.links.new(vo.outputs["Distance"], dot.inputs["Value"])
        br = mth(nt, "POWER", nd_sep(nt, vo.outputs["Color"]), 5.0)
        s = mth(nt, "MULTIPLY", mth(nt, "POWER", dot.outputs[0], 2.0), mth(nt, "MULTIPLY", br, k))
        stars = s if stars is None else mth(nt, "ADD", stars, s)
    # 天の川:大円に沿った帯
    nrm = Vector((0.35, 0.55, 0.76)).normalized()
    b = vmth(nt, "DOT_PRODUCT", d, tuple(nrm))
    band = mth(nt, "EXPONENT", mth(nt, "MULTIPLY", mth(nt, "MULTIPLY", b, b), -45.0))
    nz = nd(nt, "ShaderNodeTexNoise", Scale=3.5, Detail=12.0, Roughness=0.62)
    nt.links.new(d, nz.inputs["Vector"])
    dust = ramp(nt, nz.outputs["Fac"], [(0.38, (0.0, 0.0, 0.0)), (0.56, (0.05, 0.045, 0.04)), (0.75, (0.16, 0.14, 0.12))])
    lane = nd(nt, "ShaderNodeTexNoise", Scale=16.0, Detail=12.0, Roughness=0.65)
    nt.links.new(d, lane.inputs["Vector"])
    lanes = ramp(nt, lane.outputs["Fac"], [(0.42, (1, 1, 1)), (0.56, (0.08, 0.08, 0.1))])
    milky = mix(nt, band, (0, 0, 0), mix(nt, 1.0, dust, lanes, "MULTIPLY"))
    # 星雲:色の雲(紫・青・桃)
    nb = nd(nt, "ShaderNodeTexNoise", Scale=1.6, Detail=10.0, Roughness=0.58, Distortion=0.6)
    nt.links.new(d, nb.inputs["Vector"])
    ncol = ramp(nt, nb.outputs["Fac"], [(0.3, (0.0, 0.0, 0.0)), (0.42, (0.012, 0.004, 0.025)), (0.52, (0.04, 0.012, 0.07)),
                                         (0.6, (0.008, 0.03, 0.07)), (0.7, (0.07, 0.015, 0.035)), (0.8, (0.0, 0.0, 0.0))])
    nm = nd(nt, "ShaderNodeTexNoise", Scale=0.9, Detail=3.0)
    nt.links.new(d, nm.inputs["Vector"])
    mask = nd(nt, "ShaderNodeMapRange", **{"From Min": 0.52, "From Max": 0.72})
    nt.links.new(nm.outputs["Fac"], mask.inputs["Value"])
    neb = mix(nt, mask.outputs[0], (0, 0, 0), ncol)
    # 太陽:円盤と光のにじみ(無限遠なので空に描く)
    sd = Vector((SUN.x, -SUN.z, SUN.y))
    s = mth(nt, "MAXIMUM", vmth(nt, "DOT_PRODUCT", d, tuple(sd)), 0.0)
    disc = nd(nt, "ShaderNodeMapRange", **{"From Min": math.cos(math.radians(1.6)), "From Max": math.cos(math.radians(1.3)), "To Max": 6.0})
    nt.links.new(s, disc.inputs["Value"])
    glow = mth(nt, "ADD", mth(nt, "MULTIPLY", mth(nt, "POWER", s, 900.0), 1.4), mth(nt, "MULTIPLY", mth(nt, "POWER", s, 40.0), 0.12))
    sun = mix(nt, 1.0, mix(nt, disc.outputs[0], (0, 0, 0), (1.0, 0.97, 0.9)), mix(nt, glow, (0, 0, 0), (1.0, 0.8, 0.55)), "ADD")
    col = mix(nt, 1.0, mix(nt, 1.0, milky, neb, "ADD"), mix(nt, 1.0, sun, mix(nt, stars, (0, 0, 0), (0.95, 0.95, 1.0)), "ADD"), "ADD")
    as_emission(m, nt, col)
    return m


def nd_sep(nt, col):
    s = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(col, s.inputs[0])
    return s.outputs[0]


def planet_mat():
    """ガス惑星:緯度の帯をノイズでゆがめ、大きな渦を一つ"""
    m, nt, bsdf = nmat("planet")
    c = P(*PL_C)
    p = vmth(nt, "SCALE", vmth(nt, "SUBTRACT", pos(nt), tuple(c)), None)
    p.node.inputs["Scale"].default_value = 1 / PL_R
    ax = (PL_ROT @ Vector((0, 0, 1)))
    e1 = (PL_ROT @ Vector((1, 0, 0)))
    e2 = (PL_ROT @ Vector((0, 1, 0)))
    cx = nd(nt, "ShaderNodeCombineXYZ")
    for i, e in enumerate((e1, e2, ax)):
        nt.links.new(vmth(nt, "DOT_PRODUCT", p, tuple(e)), cx.inputs[i])
    lp = cx.outputs[0]
    # 渦に向けて座標をねじる
    warp = nd(nt, "ShaderNodeTexNoise", Scale=2.2, Detail=6.0, Roughness=0.55)
    nt.links.new(lp, warp.inputs["Vector"])
    lat = mth(nt, "ADD", nd_sepz(nt, lp), mth(nt, "MULTIPLY", mth(nt, "SUBTRACT", warp.outputs["Fac"], 0.5), 0.12))
    wv = nd(nt, "ShaderNodeTexWave", wave_type="BANDS", bands_direction="Z", Scale=1.7, Distortion=1.2, Detail=2.0, **{"Detail Scale": 0.8})
    cz = nd(nt, "ShaderNodeCombineXYZ")
    nt.links.new(lat, cz.inputs[2])
    nt.links.new(cz.outputs[0], wv.inputs["Vector"])
    bands = ramp(nt, wv.outputs["Fac"], [(0.0, (0.5, 0.3, 0.16)), (0.18, (0.82, 0.72, 0.55)), (0.32, (0.88, 0.8, 0.66)), (0.45, (0.45, 0.25, 0.12)),
                                         (0.58, (0.7, 0.5, 0.32)), (0.72, (0.9, 0.84, 0.72)), (0.86, (0.58, 0.36, 0.2)), (1.0, (0.76, 0.62, 0.46))])
    fine = nd(nt, "ShaderNodeTexNoise", Scale=14.0, Detail=12.0, Roughness=0.6)
    fx = nd(nt, "ShaderNodeMapping")
    fx.inputs["Scale"].default_value = (0.25, 0.25, 4.0)  # 横に流れる細かい雲
    nt.links.new(lp, fx.inputs["Vector"])
    nt.links.new(fx.outputs[0], fine.inputs["Vector"])
    col = mix(nt, 0.35, bands, fine.outputs["Color"], "OVERLAY")
    # 大赤斑
    sp = vmth(nt, "SUBTRACT", lp, (0.62, -0.62, -0.38))
    spm = nd(nt, "ShaderNodeMapping")
    spm.inputs["Scale"].default_value = (1.0, 1.0, 2.2)
    nt.links.new(sp, spm.inputs["Vector"])
    dd = vmth(nt, "LENGTH", spm.outputs[0])
    spot = nd(nt, "ShaderNodeMapRange", **{"From Min": 0.2, "From Max": 0.1})
    nt.links.new(dd, spot.inputs["Value"])
    col = mix(nt, spot.outputs[0], col, (0.55, 0.2, 0.09))
    # 極に向けて暗く青みがかる
    pol = mth(nt, "POWER", mth(nt, "ABSOLUTE", nd_sepz(nt, lp)), 4.0)
    col = mix(nt, mth(nt, "MULTIPLY", pol, 0.7, True), col, (0.25, 0.3, 0.36))
    nt.links.new(col, bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.9
    return m


def nd_sepz(nt, v):
    s = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(v, s.inputs[0])
    return s.outputs[2]


def ring_mat():
    m, nt, bsdf = nmat("ring")
    dd = mth(nt, "DIVIDE", vmth(nt, "DISTANCE", pos(nt), tuple(P(*PL_C))), PL_R)
    cz = nd(nt, "ShaderNodeCombineXYZ")
    nt.links.new(dd, cz.inputs[0])
    nz = nd(nt, "ShaderNodeTexNoise", Scale=26.0, Detail=12.0, Roughness=0.72)
    nt.links.new(cz.outputs[0], nz.inputs["Vector"])
    col = ramp(nt, nz.outputs["Fac"], [(0.3, (0.03, 0.028, 0.025)), (0.42, (0.22, 0.19, 0.15)), (0.52, (0.55, 0.48, 0.38)),
                                       (0.62, (0.36, 0.31, 0.25)), (0.75, (0.7, 0.63, 0.52))])
    # カッシーニの間隙
    gap = nd(nt, "ShaderNodeMapRange", **{"From Min": 0.0, "From Max": 0.025, "To Min": 1.0, "To Max": 0.0})
    nt.links.new(mth(nt, "ABSOLUTE", mth(nt, "SUBTRACT", dd, 1.72)), gap.inputs["Value"])
    col = mix(nt, gap.outputs[0], col, (0.02, 0.02, 0.02))
    nt.links.new(col, bsdf.inputs["Base Color"])
    return m


def rock_mat(name, base, dark, w=0.0):
    """小惑星:黒っぽい岩に、明るい斑と細かな凸凹"""
    m, nt, bsdf = nmat(name)
    p = pos(nt)
    n1 = nd(nt, "ShaderNodeTexNoise", Scale=0.9, Detail=10.0, Roughness=0.62, noise_dimensions="4D", W=w)
    nt.links.new(p, n1.inputs["Vector"])
    vo = nd(nt, "ShaderNodeTexVoronoi", Scale=3.0)
    nt.links.new(p, vo.inputs["Vector"])
    col = ramp(nt, n1.outputs["Fac"], [(0.3, dark), (0.55, base), (0.75, tuple(min(1, c * 1.5) for c in base))])
    spec = ramp(nt, vo.outputs["Distance"], [(0.0, (0.75, 0.75, 0.75)), (0.15, (1, 1, 1))])
    col = mix(nt, 1.0, col, spec, "MULTIPLY")
    nt.links.new(col, bsdf.inputs["Base Color"])
    n2 = nd(nt, "ShaderNodeTexNoise", Scale=9.0, Detail=12.0, Roughness=0.7)
    nt.links.new(p, n2.inputs["Vector"])
    h = mth(nt, "ADD", n2.outputs["Fac"], mth(nt, "MULTIPLY", vo.outputs["Distance"], 0.6))
    b = nd(nt, "ShaderNodeBump", Strength=0.8, Distance=0.3)
    nt.links.new(h, b.inputs["Height"])
    nt.links.new(b.outputs["Normal"], bsdf.inputs["Normal"])
    bsdf.inputs["Roughness"].default_value = 0.92
    return m


def halo_mat():
    """大気の縁:内側から外へ青く消えていく"""
    m, nt, _ = nmat("halo")
    dd = mth(nt, "DIVIDE", vmth(nt, "DISTANCE", pos(nt), tuple(P(*PL_C))), PL_R)
    col = ramp(nt, dd, [(0.995, (0.16, 0.26, 0.5)), (1.008, (0.06, 0.1, 0.22)), (1.03, (0.01, 0.02, 0.05)), (1.06, (0, 0, 0))])
    as_emission(m, nt, col)
    return m


PL_ROT = (Euler((0.25, 0.0, 0.0)).to_matrix() @ Euler((0.0, 0.35, 0.0)).to_matrix())  # Blender 座標での惑星の傾き

M = {
    "sky": sky_mat(),
    "planet": planet_mat(),
    "ring": ring_mat(),
    "moon": rock_mat("moon", (0.42, 0.41, 0.4), (0.2, 0.2, 0.2), 2.0),
    "rock": rock_mat("rock", (0.24, 0.21, 0.18), (0.07, 0.065, 0.06)),
    "rock2": rock_mat("rock2", (0.3, 0.27, 0.24), (0.1, 0.09, 0.08), 5.0),
    "cut": rock_mat("cut", (0.38, 0.36, 0.34), (0.2, 0.19, 0.18), 9.0),
    "halo": halo_mat(),
}
mm, nt, b = nmat("metal")
b.inputs["Base Color"].default_value = (0.62, 0.6, 0.58, 1)
b.inputs["Metallic"].default_value = 1.0
b.inputs["Roughness"].default_value = 0.35
M["metal"] = mm
GLOW = [emit(f"star{i}", c, 4.0) for i, c in enumerate([(1, 1, 1), (0.7, 0.8, 1.0), (1.0, 0.86, 0.68), (0.45, 0.45, 0.5)])]
RING = emit("ring_glow", (0.35, 0.85, 1.0), 6.0)


# ---- 形 ----
def rock_bm(radius, stretch=(1, 1, 1), sub=3, seed=0, amp=0.35, freq=1.1, craters=0, flat=None):
    """ゆがんだ岩:ノイズで膨らませ、クレーターをえぐる。flat=上面を平らに削る高さ(半径に対する割合)"""
    r = random.Random(seed)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0)
    off = Vector((r.random() * 50, r.random() * 50, r.random() * 50))
    cr = [(Vector((r.gauss(0, 1), r.gauss(0, 1), r.gauss(0, 1))).normalized(), 0.12 + r.random() * 0.3) for _ in range(craters)]
    for v in bm.verts:
        d = v.co.normalized()
        h = 1 + amp * noise.fractal(d * freq + off, 0.7, 2.1, 6) + amp * 0.35 * noise.ridged_multi_fractal(d * freq * 2.5 + off, 0.9, 2.0, 4, 1.0, 2.0) * 0.3
        for cd, cs in cr:
            a = d.angle(cd)
            if a < cs * 1.4:
                t = a / cs
                h += (-0.12 * (1 - t * t) if t < 1 else 0.05 * (1 - (t - 1) / 0.4)) * cs * 2.2
        v.co = Vector((d.x * stretch[0], d.y * stretch[1], d.z * stretch[2])) * radius * h
    if flat is not None:
        top = flat * radius * stretch[2]
        for v in bm.verts:
            if v.co.z > top:
                v.co.z = top
    return bm


def place(bm, center, rot=None):
    if rot is not None:
        bmesh.ops.rotate(bm, verts=bm.verts[:], cent=(0, 0, 0), matrix=rot)
    bmesh.ops.translate(bm, verts=bm.verts[:], vec=P(*center))
    return bm


# ---- 空の球(内側から見る) ----
bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=24, radius=SKY)
bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
no_shadow(w.mesh_from_bmesh("sky", "sky", bm, M["sky"]))

# 明るい星(小さな光る粒。空の画像より鋭く見える)
for i in range(1400):
    d = Vector((rnd.gauss(0, 1), rnd.gauss(0, 1), rnd.gauss(0, 1))).normalized()
    s = 0.25 + rnd.random() ** 3 * 1.1
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=0, radius=s)
    k = 3 if s < 0.4 else rnd.randrange(3)
    place(bm, tuple(d * (SKY - 15)))
    no_shadow(w.mesh_from_bmesh("glow", "star", bm, GLOW[k], smooth=False))

# ---- 惑星と環 ----
bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=96, v_segments=48, radius=PL_R)
place(bm, PL_C, PL_ROT)
w.mesh_from_bmesh("planet", "planet", bm, M["planet"])
for side in (1, -1):
    bm = bmesh.new()
    seg = 192
    inner = [bm.verts.new((math.cos(a) * PL_R * 1.24, math.sin(a) * PL_R * 1.24, side * 0.05)) for a in [k / seg * math.tau for k in range(seg)]]
    outer = [bm.verts.new((math.cos(a) * PL_R * 2.05, math.sin(a) * PL_R * 2.05, side * 0.05)) for a in [k / seg * math.tau for k in range(seg)]]
    for k in range(seg):
        f = bm.faces.new((inner[k], outer[k], outer[(k + 1) % seg], inner[(k + 1) % seg]))
        if (f.normal.z > 0) != (side > 0):
            f.normal_flip()
    place(bm, PL_C, PL_ROT)
    w.mesh_from_bmesh("planet", "ring", bm, M["ring"], smooth=False)
# 大気の縁:惑星の中心に置き、入口の方を向いた円板(内側は惑星に隠れる)
bm = bmesh.new()
seg = 128
ci = [bm.verts.new((math.cos(a) * PL_R * 0.9, math.sin(a) * PL_R * 0.9, 0)) for a in [k / seg * math.tau for k in range(seg)]]
co = [bm.verts.new((math.cos(a) * PL_R * 1.08, math.sin(a) * PL_R * 1.08, 0)) for a in [k / seg * math.tau for k in range(seg)]]
for k in range(seg):
    bm.faces.new((ci[k], co[k], co[(k + 1) % seg], ci[(k + 1) % seg]))
look = (P(0, 3, 20) - P(*PL_C)).normalized()
place(bm, PL_C, look.to_track_quat("Z", "Y").to_matrix())
no_shadow(w.mesh_from_bmesh("halo", "halo", bm, M["halo"], smooth=False))

# ---- 月 ----
place(bm := rock_bm(MOON_R, sub=5, seed=11, amp=0.05, freq=1.5, craters=40), MOON_C)
w.mesh_from_bmesh("moon", "moon", bm, M["moon"])

# ---- 作品の台:平らに削った小惑星。台の縁に金属の輪と光の線 ----
maxR = 6 + (N - 1) * 2.0
START = (2.0, 3.5, maxR + 10)
for i in range(N):
    a = 0.5 + i * 0.95
    rr = 6 + i * 2.0
    x, y, z = math.cos(a) * rr, math.sin(i * 1.3) * 2.4, math.sin(a) * rr
    rad = 1.25
    bm = rock_bm(rad, (1.15, 1.0, 0.85), sub=4, seed=100 + i, amp=0.28, freq=1.3, craters=4, flat=0.55)
    top = 0.55 * rad * 0.85
    place(bm, (x, y - top, z), Matrix.Rotation(rnd.random() * 6, 3, "Z"))
    w.mesh_from_bmesh("rock", "pedestal", bm, M["cut"])
    # 削った面の上の金属の円盤と、光る輪
    w.cyl("metal", 0.62, 0.66, 0.06, (x, y + 0.03, z), M["metal"], seg=48)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=False, segments=64, radius1=0.68, radius2=0.68, depth=0.015)
    place(bm, (x, y + 0.035, z))
    no_shadow(w.mesh_from_bmesh("glow", "ring", bm, RING))
    # 台のまわりを回る小石
    for k in range(5):
        t = rnd.random() * math.tau
        d = 1.9 + rnd.random() * 0.9
        place(bm := rock_bm(0.08 + rnd.random() * 0.14, sub=2, seed=300 + i * 10 + k, amp=0.4),
              (x + math.cos(t) * d, y - 0.4 + rnd.random() * 1.2, z + math.sin(t) * d), Euler((rnd.random() * 6, rnd.random() * 6, 0)).to_matrix())
        w.mesh_from_bmesh("rock", "pebble", bm, M["rock2"])
    face = math.atan2(START[0] - x, START[2] - z)
    w.spot(x=x, y=y + 0.06, z=z, face=face, dist=3.9, r=1.7, lift=0.05)

# ---- 小惑星帯 ----
for k in range(110):
    t = rnd.random() * math.tau
    d = maxR + 14 + rnd.random() * 22
    if k < 8:  # 大きな岩
        s, sub = 3.5 + rnd.random() * 5, 5
        d += 14
    elif k < 60:
        s, sub = 0.6 + rnd.random() ** 2 * 2.2, 4
    else:
        s, sub = 0.15 + rnd.random() * 0.5, 2
    c = (math.cos(t) * d, (rnd.random() - 0.5) * 10 + math.sin(t * 2) * 3, math.sin(t) * d)
    if math.hypot(c[0] - START[0], c[2] - START[2]) < 6:
        continue
    bm = rock_bm(s, (1.0, 0.65 + rnd.random() * 0.35, 0.55 + rnd.random() * 0.4), sub=sub, seed=k, amp=0.32, freq=0.9 + rnd.random(), craters=rnd.randrange(2, 9))
    place(bm, c, Euler((rnd.random() * 6, rnd.random() * 6, rnd.random() * 6)).to_matrix())
    w.mesh_from_bmesh("rock", "asteroid", bm, M["rock" if k % 3 else "rock2"])

# ---- 光:太陽(強い平行光)と、ごく弱い青い照り返し ----
w.light("SUN", tuple(SUN * 100), 5.0, (1.0, 0.95, 0.86), target=(0, 0, 0), angle=math.radians(0.5))
w.light("SUN", (-40, -20, 60), 0.12, (0.4, 0.5, 1.0), target=(0, 0, 0), angle=math.radians(10))

w.extra.update({
    "title": "宇宙空間",
    "tip": "宇宙を自由に飛べます。W・矢印キーで見ている向きへ進み、ドラッグで向きを変え、作品をクリックで近くへ。",
    "start": {"x": START[0], "y": START[1], "z": START[2], "yaw": 0.1, "pitch": -0.12},
    "fly": True, "limit": 60, "minY": -25, "maxY": 25, "speed": 4,
    "bg": "#010108", "exposure": 1.1, "far": 1000,
    "hemi": ["#4a5aa0", "#0a0a14", 0.45],
    "sun": {"dir": [SUN.x, SUN.y, SUN.z], "color": "#fff0dc", "intensity": 2.2, "box": 25},
    "palette": ["#cfe6ff", "#4b3bd0"], "glowCubes": True,
})

if A.still:
    w.still(A.still, (START[0], START[1], START[2]), (START[0] - math.sin(0.1) * 10, START[1] - 1.2, START[2] - math.cos(0.1) * 10), lens=16)
    if A.still_only:
        os._exit(0)

w.export(A.out)
os._exit(0)
