"""海の底(泳いで回れる)を Blender で組み、光を焼き込む。

    python3 tools/blender/underwater.py --out public/worlds/underwater.glb [--size 2048] [--samples 64] [--still still.png]

砂紋のある砂地・岩礁・サンゴ・昆布の森。水面の揺らぎは光(上からの光に模様を付ける)で砂に落とす。
作品は岩の上のガラスの泡のドームの中。青い霧はブラウザ側(fog)。
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

A = args({"out": "underwater.glb"})
N = 4
rnd = random.Random(8)
R, SURF = 18.0, 15.0
SIZE = R * 2 + 56
FOG = (0.0045, 0.085, 0.15)  # #0d5570 のリニア値(一枚絵の霧)


def hgt(x, z):
    """海底の高さ(three.js の x, z)"""
    return (math.sin(x * 0.18) * 0.35 + math.cos(z * 0.22 + x * 0.07) * 0.3 + math.sin((x + z) * 0.09) * 0.25
            + noise.fractal(Vector((x * 0.05, z * 0.05, 0.5)), 0.8, 2.0, 4) * 0.8 + max(0, math.hypot(x, z) - R - 6) * 0.12)


w = World(samples=A.samples)
w.sky((0.02, 0.11, 0.16), 1.0)  # 水に散った光(上から青く)

w.group("seabed", A.size, rough=0.95)
w.group("rock", A.size, rough=0.9)
w.group("coral", A.size, rough=0.75)
w.group("kelp", A.size // 2, rough=0.7)
w.group("dome", A.size // 4, rough=0.05, opacity=0.2)
w.group("brass", A.size // 4, rough=0.3, metal=1.0)
w.group("surface", A.size // 2, unlit=True, opacity=0.55)
w.group("glow", bake=False)


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
    return nt.nodes.new("ShaderNodeNewGeometry").outputs["Position"]


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


def caustic(nt, vec, scale):
    """水面の揺らぎが集めた光の網目(0..1)。座標をノイズでゆがめ、ボロノイの境目を細く光らせる"""
    wn = tex(nt, "ShaderNodeTexNoise", vec, Scale=scale * 0.35, Detail=2.0)
    v2 = nt.nodes.new("ShaderNodeVectorMath")
    v2.operation = "ADD"
    nt.links.new(vec, v2.inputs[0])
    sub = nt.nodes.new("ShaderNodeVectorMath")
    sub.operation = "SCALE"
    nt.links.new(wn.outputs["Color"], sub.inputs[0])
    sub.inputs["Scale"].default_value = 0.6 / scale * 2
    nt.links.new(sub.outputs[0], v2.inputs[1])
    vo = tex(nt, "ShaderNodeTexVoronoi", v2.outputs[0], feature="DISTANCE_TO_EDGE", Scale=scale)
    return smooth(nt, vo.outputs["Distance"], 0.07, 0.0)


# ---- 材質 ----
def sand_mat():
    m, nt, bsdf = nmat("sand")
    p = pos(nt)
    # 砂紋:向きの揃った波をノイズでゆがめる
    mp = nd(nt, "ShaderNodeMapping")
    mp.inputs["Rotation"].default_value = (0, 0, 0.5)
    nt.links.new(p, mp.inputs["Vector"])
    wv = tex(nt, "ShaderNodeTexWave", mp.outputs[0], wave_type="BANDS", wave_profile="SAW", Scale=2.6, Distortion=5.0, Detail=3.0, **{"Detail Scale": 0.6})
    fine = tex(nt, "ShaderNodeTexNoise", p, Scale=80.0, Detail=6.0)
    h = mth(nt, "ADD", wv.outputs["Fac"], mth(nt, "MULTIPLY", fine.outputs["Fac"], 0.25))
    bump(nt, bsdf, h, 0.6, 0.05)
    n = tex(nt, "ShaderNodeTexNoise", p, Scale=0.4, Detail=8.0, Roughness=0.6)
    col = ramp(nt, n.outputs["Fac"], [(0.3, (0.36, 0.31, 0.22)), (0.55, (0.52, 0.46, 0.33)), (0.75, (0.6, 0.54, 0.41))])
    sp = tex(nt, "ShaderNodeTexVoronoi", p, Scale=60.0)
    col = mix(nt, smooth(nt, nd_r(nt, sp.outputs["Color"]), 0.9, 0.95), col, (0.2, 0.18, 0.15))  # 黒い砂粒
    col = mix(nt, smooth(nt, nd_r(nt, sp.outputs["Color"]), 0.04, 0.0), col, (0.85, 0.82, 0.75))  # 貝殻のかけら
    col = mix(nt, 1.0, col, mix(nt, wv.outputs["Fac"], (0.88, 0.88, 0.88), (1, 1, 1)), "MULTIPLY")
    nt.links.new(col, bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.95
    return m


def nd_r(nt, col):
    s = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(col, s.inputs[0])
    return s.outputs[0]


def surf_mat(name, cols, scale=4.0, bump_s=0.4, bscale=30.0, rough=0.8, w=0.0, bump_kind="noise"):
    m, nt, bsdf = nmat(name)
    p = pos(nt)
    n = tex(nt, "ShaderNodeTexNoise", p, Scale=scale, Detail=8.0, Roughness=0.6, noise_dimensions="4D", W=w)
    col = ramp(nt, n.outputs["Fac"], cols)
    nt.links.new(col, bsdf.inputs["Base Color"])
    if bump_kind == "brain":  # 脳サンゴの迷路の溝
        b = tex(nt, "ShaderNodeTexWave", p, wave_type="BANDS", Scale=bscale, Distortion=18.0, Detail=4.0, **{"Detail Scale": 2.0})
        bump(nt, bsdf, b.outputs["Fac"], bump_s, 0.03)
        col = mix(nt, 1.0, col, mix(nt, b.outputs["Fac"], (0.6, 0.6, 0.6), (1, 1, 1)), "MULTIPLY")
        nt.links.new(col, bsdf.inputs["Base Color"])
    elif bump_kind == "pores":  # 細かい穴(サンゴのポリプ・海綿)
        b = tex(nt, "ShaderNodeTexVoronoi", p, Scale=bscale)
        bump(nt, bsdf, b.outputs["Distance"], bump_s, 0.02)
    elif bump_s:
        b = tex(nt, "ShaderNodeTexNoise", p, Scale=bscale, Detail=10.0, Roughness=0.65)
        bump(nt, bsdf, b.outputs["Fac"], bump_s, 0.05)
    bsdf.inputs["Roughness"].default_value = rough
    return m


def rock_mat(name, w):
    """岩礁:灰緑の岩に、藻の緑と石灰藻の桃色の斑"""
    m, nt, bsdf = nmat(name)
    p = pos(nt)
    n = tex(nt, "ShaderNodeTexNoise", p, Scale=1.4, Detail=10.0, Roughness=0.62, noise_dimensions="4D", W=w)
    col = ramp(nt, n.outputs["Fac"], [(0.3, (0.08, 0.09, 0.08)), (0.5, (0.22, 0.24, 0.21)), (0.7, (0.32, 0.33, 0.29))])
    al = tex(nt, "ShaderNodeTexNoise", p, Scale=3.5, Detail=8.0, noise_dimensions="4D", W=w + 2)
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    sz = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(geo.outputs["Normal"], sz.inputs[0])
    up = smooth(nt, sz.outputs[2], 0.1, 0.7)
    col = mix(nt, mth(nt, "MULTIPLY", smooth(nt, al.outputs["Fac"], 0.48, 0.6), up), col, (0.16, 0.24, 0.07))
    pk = tex(nt, "ShaderNodeTexNoise", p, Scale=6.0, Detail=6.0, noise_dimensions="4D", W=w + 5)
    col = mix(nt, smooth(nt, pk.outputs["Fac"], 0.6, 0.66), col, (0.55, 0.28, 0.32))
    nt.links.new(col, bsdf.inputs["Base Color"])
    vo = tex(nt, "ShaderNodeTexVoronoi", p, Scale=4.0)
    fine = tex(nt, "ShaderNodeTexNoise", p, Scale=12.0, Detail=12.0, Roughness=0.7)
    bump(nt, bsdf, mth(nt, "ADD", fine.outputs["Fac"], mth(nt, "MULTIPLY", vo.outputs["Distance"], 0.8)), 0.9, 0.2)
    bsdf.inputs["Roughness"].default_value = 0.9
    return m


def surface_mat():
    """水面の裏側:明るい網目と、空の抜け(真上ほど明るい)"""
    m, nt, _ = nmat("surface")
    p = pos(nt)
    c1 = caustic(nt, p, 0.35)
    col = mix(nt, c1, (0.12, 0.42, 0.52), (0.7, 0.95, 1.0))
    out = nt.nodes["Material Output"]
    nt.nodes.remove(nt.nodes["Principled BSDF"])
    e = nd(nt, "ShaderNodeEmission", Strength=1.0)
    nt.links.new(col, e.inputs["Color"])
    nt.links.new(e.outputs[0], out.inputs[0])
    return m


M = {
    "sand": sand_mat(),
    "rock": rock_mat("rock", 0.0),
    "rock2": rock_mat("rock2", 7.0),
    "brain": surf_mat("brain", [(0.3, (0.45, 0.36, 0.14)), (0.7, (0.62, 0.52, 0.22))], scale=3, bump_s=0.8, bscale=9, rough=0.7, bump_kind="brain"),
    "brain2": surf_mat("brain2", [(0.3, (0.22, 0.32, 0.18)), (0.7, (0.36, 0.46, 0.26))], scale=3, bump_s=0.8, bscale=11, rough=0.7, w=3, bump_kind="brain"),
    "kelp": surf_mat("kelp", [(0.3, (0.18, 0.15, 0.03)), (0.6, (0.32, 0.27, 0.06)), (0.85, (0.42, 0.38, 0.1))], scale=1.5, bump_s=0.2, bscale=20, rough=0.6),
    "slate": surf_mat("slate", [(0.3, (0.04, 0.05, 0.055)), (0.7, (0.09, 0.1, 0.11))], scale=6, bump_s=0.1, bscale=40, rough=0.4),
}
CORAL = [surf_mat(f"coral{i}", [(0.25, tuple(c * 0.55 for c in col)), (0.6, col), (0.9, tuple(min(1, c * 1.25) for c in col))],
                  scale=5, bump_s=0.5, bscale=60, rough=0.75, w=i, bump_kind="pores")
         for i, col in enumerate([(0.75, 0.22, 0.28), (0.85, 0.42, 0.14), (0.45, 0.22, 0.62), (0.82, 0.3, 0.5), (0.85, 0.7, 0.3), (0.2, 0.5, 0.55)])]
dm, nt, b = nmat("dome")
b.inputs["Base Color"].default_value = (0.75, 0.92, 1.0, 1)
b.inputs["Roughness"].default_value = 0.05
M["dome"] = dm
bm_, nt, b = nmat("brass")
b.inputs["Base Color"].default_value = (0.78, 0.58, 0.32, 1)
b.inputs["Metallic"].default_value = 1.0
b.inputs["Roughness"].default_value = 0.3
M["brass"] = bm_
M["surface"] = surface_mat()
CYAN = emit("cyan", (0.35, 0.95, 1.0), 4.0)


# ---- 形の道具 ----
def blob(radius, stretch=(1, 1, 1), sub=3, seed=0, amp=0.3, freq=1.2, flat=None, floor=None, ridge=0.0):
    r = random.Random(seed)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0)
    off = Vector((r.random() * 50, r.random() * 50, r.random() * 50))
    for v in bm.verts:
        d = v.co.normalized()
        h = 1 + amp * noise.fractal(d * freq + off, 0.7, 2.1, 6)
        if ridge:
            h += ridge * (noise.ridged_multi_fractal(d * freq * 2 + off, 0.9, 2.0, 4, 1.0, 2.0) - 0.8)
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


def rand_rot(r):
    return Euler((r.random() * 6, r.random() * 6, r.random() * 6)).to_matrix()


# ---- 海底 ----
bm = bmesh.new()
bmesh.ops.create_grid(bm, x_segments=120, y_segments=120, size=SIZE / 2)
for v in bm.verts:
    v.co.z = hgt(v.co.x, -v.co.y)
w.mesh_from_bmesh("seabed", "seabed", bm, M["sand"])

# ---- 水面(下から見上げる) ----
bm = bmesh.new()
bmesh.ops.create_grid(bm, x_segments=8, y_segments=8, size=110)
bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
place(bm, (0, SURF, 0))
no_shadow(w.mesh_from_bmesh("surface", "surface", bm, M["surface"], smooth=False))

# ---- 作品:岩の上のガラスの泡 ----
spots = []
START = (0.0, 4.4, R * 0.52 + 11.0)
for i in range(N):
    a = i / N * math.tau + 0.3
    rr = R * 0.52 + (rnd.random() - 0.5) * 3
    x, z = math.sin(a) * rr, -math.cos(a) * rr
    hm = 0.8 + rnd.random() * 1.8
    base = hgt(x, z)
    top = base + hm
    bm = blob(1.0, (1.9, 1.7, (hm + 1.0)), sub=4, seed=30 + i, amp=0.22, freq=1.3, ridge=0.08,
              flat=(hm) / (hm + 1.0) * 0.98, floor=-0.2)
    place(bm, (x, base, z), rz(rnd.random() * 6))
    w.mesh_from_bmesh("rock", "pedestal", bm, M["rock2" if i % 2 else "rock"])
    w.cyl("rock", 1.36, 1.4, 0.1, (x, top + 0.05, z), M["slate"], seg=48)
    # 真鍮の輪とガラスの泡
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=False, segments=64, radius1=1.42, radius2=1.42, depth=0.16)
    place(bm, (x, top + 0.12, z))
    w.mesh_from_bmesh("brass", "rim", bm, M["brass"])
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=False, segments=64, radius1=1.44, radius2=1.44, depth=0.02)
    place(bm, (x, top + 0.22, z))
    no_shadow(w.mesh_from_bmesh("glow", "ring", bm, CYAN))
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=24, radius=1.4)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -0.25], context="VERTS")
    place(bm, (x, top + 0.2 + 0.25, z))
    no_shadow(w.mesh_from_bmesh("dome", "dome", bm, M["dome"]))
    face = math.atan2(START[0] - x, START[2] - z)
    w.spot(x=x, y=top + 0.1, z=z, face=face, dist=3.7, r=1.7, scale=0.7, lift=0.04)
    spots.append((x, z, top))


def free(x, z, m=2.6):
    return all(math.hypot(x - sx, z - sz) > m for sx, sz, _ in spots) and math.hypot(x - START[0], z - START[2]) > 3


# ---- 岩礁:散らばる岩と、外側を囲む大きな岩の壁 ----
for k in range(36):
    t = rnd.random() * math.tau
    d = 3 + rnd.random() * (R + 2)
    x, z = math.sin(t) * d, math.cos(t) * d
    if not free(x, z, 3.0):
        continue
    s = 0.5 + rnd.random() ** 2 * 1.8
    bm = blob(s, (1.2, 1.0, 0.65), sub=3 if s < 1.2 else 4, seed=100 + k, amp=0.3, freq=1.4, ridge=0.1, floor=-0.35)
    place(bm, (x, hgt(x, z) + s * 0.15, z), rz(rnd.random() * 6))
    w.mesh_from_bmesh("rock", "reef", bm, M["rock" if k % 2 else "rock2"])
for k in range(16):
    t = k / 16 * math.tau + rnd.random() * 0.3
    d = R + 9 + rnd.random() * 8
    x, z = math.sin(t) * d, math.cos(t) * d
    s = 3.5 + rnd.random() * 3.5
    bm = blob(s, (1.3, 1.0, 1.0 + rnd.random() * 0.8), sub=4, seed=200 + k, amp=0.32, freq=1.1, ridge=0.12, floor=-0.3)
    place(bm, (x, hgt(x, z) + s * 0.2, z), rz(rnd.random() * 6))
    w.mesh_from_bmesh("rock", "wall", bm, M["rock2" if k % 2 else "rock"])


# ---- サンゴ ----
def staghorn(x, y, z, m, seed, s=1.0):
    r = random.Random(seed)
    bm = bmesh.new()

    def br(a, d, ln, rad, depth):
        b = tuple(a[i] + d[i] * ln for i in range(3))
        tube(bm, a, b, rad, rad * 0.8, seg=6)
        if depth == 0:
            sp = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=rad * 0.85)
            bmesh.ops.translate(bm, verts=sp["verts"], vec=P(*b))
            return
        for _ in range(2):
            nd_ = Vector((d[0] + (r.random() - 0.5) * 1.3, d[1] + 0.25, d[2] + (r.random() - 0.5) * 1.3)).normalized()
            br(b, tuple(nd_), ln * 0.8, rad * 0.75, depth - 1)

    for _ in range(3):
        d0 = Vector(((r.random() - 0.5) * 0.8, 1.0, (r.random() - 0.5) * 0.8)).normalized()
        br((x, y - 0.05, z), tuple(d0), 0.45 * s, 0.07 * s, 3)
    w.mesh_from_bmesh("coral", "staghorn", bm, m)


def table(x, y, z, m, seed, s=1.0):
    r = random.Random(seed)
    bm = bmesh.new()
    tube(bm, (x, y - 0.05, z), (x, y + 0.45 * s, z), 0.1 * s, 0.07 * s, seg=8)
    w.mesh_from_bmesh("coral", "stalk", bm, m)
    bm = blob(0.55 * s, (1.0, 0.9, 0.08), sub=3, seed=seed, amp=0.25, freq=2.4)
    place(bm, (x, y + 0.5 * s, z), rz(r.random() * 6))
    w.mesh_from_bmesh("coral", "table", bm, m)


def fan(x, y, z, m, seed, s=1.0):
    """ウミウチワ:縦に立つ薄い扇"""
    r = random.Random(seed)
    bm = blob(0.7 * s, (1.0, 0.05, 0.85), sub=3, seed=seed, amp=0.2, freq=2.0, floor=-0.6)
    place(bm, (x, y + 0.45 * s, z), rz(r.random() * 6))
    w.mesh_from_bmesh("coral", "fan", bm, m)


def tubes(x, y, z, m, seed, s=1.0):
    """筒状の海綿"""
    r = random.Random(seed)
    for k in range(3 + r.randrange(3)):
        h = (0.4 + r.random() * 0.7) * s
        rr = (0.08 + r.random() * 0.06) * s
        ox, oz = (r.random() - 0.5) * 0.4 * s, (r.random() - 0.5) * 0.4 * s
        o = w.cyl("coral", rr, rr * 0.8, h, (x + ox, y + h / 2 - 0.03, z + oz), m, seg=12, caps=False)
        o.data.materials.clear()
        o.data.materials.append(m)


def brain(x, y, z, seed, s=1.0):
    r = random.Random(seed)
    bm = blob(0.45 * s + r.random() * 0.3, (1.0, 1.0, 0.65), sub=3, seed=seed, amp=0.1, freq=1.5, floor=-0.2)
    place(bm, (x, y, z), rz(r.random() * 6))
    w.mesh_from_bmesh("coral", "brain", bm, M["brain" if seed % 2 else "brain2"])


def coral_patch(cx, cz, rad, n, seed):
    r = random.Random(seed)
    for k in range(n):
        t = r.random() * math.tau
        d = r.random() * rad
        x, z = cx + math.cos(t) * d, cz + math.sin(t) * d
        if not free(x, z, 2.0):
            continue
        y = hgt(x, z)
        kind = r.randrange(6)
        m = CORAL[r.randrange(len(CORAL))]
        s = 0.7 + r.random() * 0.6
        if kind in (0, 1):
            staghorn(x, y, z, m, seed * 100 + k, s)
        elif kind == 2:
            table(x, y, z, m, seed * 100 + k, s)
        elif kind == 3:
            fan(x, y, z, m, seed * 100 + k, s)
        elif kind == 4:
            tubes(x, y, z, m, seed * 100 + k, s)
        else:
            brain(x, y, z, seed * 100 + k, s)


# 台の岩の足元と、あちこちの小さな群れ
for i, (x, z, top) in enumerate(spots):
    for k in range(7):
        t = k / 7 * math.tau + rnd.random() * 0.5
        d = 2.0 + rnd.random() * 0.8
        px, pz = x + math.cos(t) * d, z + math.sin(t) * d
        y = hgt(px, pz)
        kind = (k + i) % 4
        m = CORAL[(k * 2 + i) % len(CORAL)]
        [staghorn, fan, tubes, lambda a, b, c, mm, sd, s: brain(a, b, c, sd, s)][kind](px, y, pz, m, 900 + i * 10 + k, 0.8 + rnd.random() * 0.4)
for k in range(14):
    t = rnd.random() * math.tau
    d = 4 + rnd.random() * (R + 4)
    coral_patch(math.sin(t) * d, math.cos(t) * d, 1.6, 6, 50 + k)


# ---- 昆布の森(根元から水面近くまで、葉を互い違いに) ----
def kelp(x, z, seed):
    r = random.Random(seed)
    y0 = hgt(x, z)
    h = 7 + r.random() * 6
    segs = 22
    ph = r.random() * 6
    pts = [(x + math.sin(ph + q * 0.35) * 0.25 * q / segs * 3, y0 + h * q / segs, z + math.cos(ph * 1.3 + q * 0.3) * 0.25 * q / segs * 3) for q in range(segs + 1)]
    bm = bmesh.new()
    for q in range(segs):
        tube(bm, pts[q], pts[q + 1], 0.03, 0.025, seg=5)
    w.mesh_from_bmesh("kelp", "stipe", bm, M["kelp"])
    bm = bmesh.new()
    for q in [x * 0.5 for x in range(4, segs * 2 + 1)]:
        lo_, f = int(q), q - int(q)
        hi_ = min(segs, lo_ + 1)
        a = tuple(pts[lo_][i] * (1 - f) + pts[hi_][i] * f for i in range(3))
        t = q * 2.4 + ph
        L = 1.0 + r.random() * 0.6
        dx, dz = math.cos(t), math.sin(t)
        # 葉:根元が細く、先が垂れる 3 区間の帯(両面)
        prev = None
        for j in range(4):
            u = j / 3
            c = (a[0] + dx * L * u * (1 - 0.3 * u), a[1] + 0.25 * u - 0.7 * u * u, a[2] + dz * L * u * (1 - 0.3 * u))
            wd = 0.03 + 0.08 * math.sin(math.pi * min(1, u * 1.2 + 0.1))
            px, pz = -dz * wd, dx * wd
            row = [bm.verts.new(P(c[0] + px, c[1] + e, c[2] + pz)) for e in (0, -0.004)] + [bm.verts.new(P(c[0] - px, c[1] + e, c[2] - pz)) for e in (0, -0.004)]
            if prev:  # 表と裏(ブラウザは片面だけ描く)
                bm.faces.new((prev[0], prev[2], row[2], row[0]))
                bm.faces.new((row[1], row[3], prev[3], prev[1]))
            prev = row
    w.mesh_from_bmesh("kelp", "blades", bm, M["kelp"])


for k in range(40):
    t = rnd.random() * math.tau
    d = 6 + rnd.random() * (R + 6)
    x, z = math.sin(t) * d, math.cos(t) * d
    if not free(x, z, 3.2):
        continue
    kelp(x, z, 600 + k)

# ---- 光:水面から差す揺らいだ光(模様つきのスポット)と、水に散った青い光 ----
lo = w.light("SPOT", (4, 70, -2), 260000, (0.72, 0.93, 1.0), target=(0, 0, 0), spot_size=math.radians(95), spot_blend=0.3, shadow_soft_size=0.1)  # 大きいと模様がぼける
ld = lo.data
ld.use_nodes = True
lt = ld.node_tree
tc = lt.nodes.new("ShaderNodeTexCoord")
sep = lt.nodes.new("ShaderNodeSeparateXYZ")
lt.links.new(tc.outputs["Normal"], sep.inputs[0])
cxy = lt.nodes.new("ShaderNodeCombineXYZ")
for i in (0, 1):
    lt.links.new(mth(lt, "MULTIPLY", mth(lt, "DIVIDE", sep.outputs[i], sep.outputs[2]), 70.0), cxy.inputs[i])  # 海底の上での m 単位
c1 = caustic(lt, cxy.outputs[0], 0.55)
sh = lt.nodes.new("ShaderNodeVectorMath")
sh.inputs[1].default_value = (3.7, 1.3, 0.5)
lt.links.new(cxy.outputs[0], sh.inputs[0])
c2 = caustic(lt, sh.outputs[0], 0.33)
strength = mth(lt, "ADD", 0.45, mth(lt, "MULTIPLY", mth(lt, "ADD", c1, mth(lt, "MULTIPLY", c2, 0.7)), 1.6))
lt.links.new(strength, lt.nodes["Emission"].inputs["Strength"])

w.extra.update({
    "title": "海の底",
    "tip": "海の中を泳いで回れます。W・矢印キーで見ている向きへ進み、ドラッグで向きを変え、泡のドームの作品をクリックで近くへ。",
    "start": {"x": START[0], "y": START[1], "z": START[2], "yaw": 0, "pitch": -0.1},
    "fly": True, "limit": R + 8, "minY": 1.0, "maxY": SURF - 1.5, "speed": 3,
    "bg": "#0b4a63", "fog": ["#0d5570", 0.045], "exposure": 1.05,
    "hemi": ["#8ae0ff", "#0b2a36", 0.75],
    "sun": {"dir": [0.15, 1.0, 0.1], "color": "#c8f2ff", "intensity": 1.0, "box": 25},
    "palette": ["#f4efe6", "#1e6f8a"],
})

if A.still:
    # 一枚絵だけ:ガラスを透かし、霧を合成で足す(ブラウザの FogExp2 に近い深さで)
    M["dome"].node_tree.nodes["Principled BSDF"].inputs["Alpha"].default_value = 0.3
    sc = w.sc
    sc.view_layers[0].use_pass_mist = True
    sc.world.mist_settings.start, sc.world.mist_settings.depth, sc.world.mist_settings.falloff = 0.0, 34.0, "QUADRATIC"
    sc.use_nodes = True
    ct = sc.node_tree
    ct.nodes.clear()
    rl = ct.nodes.new("CompositorNodeRLayers")
    mx = ct.nodes.new("CompositorNodeMixRGB")
    mx.inputs[2].default_value = (*FOG, 1)
    ct.links.new(rl.outputs["Mist"], mx.inputs[0])
    ct.links.new(rl.outputs["Image"], mx.inputs[1])
    co = ct.nodes.new("CompositorNodeComposite")
    ct.links.new(mx.outputs[0], co.inputs[0])
    w.still(A.still, START, (START[0], START[1] - math.tan(0.1) * 10, START[2] - 10), lens=16)
    M["dome"].node_tree.nodes["Principled BSDF"].inputs["Alpha"].default_value = 1.0
    sc.use_nodes = False
    if A.still_only:
        os._exit(0)

w.export(A.out)
os._exit(0)
