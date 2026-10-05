"""摩天楼の街(歩行者天国の大通り。作品は超高層ビルほどの大きさで広場の基壇に建つ)を Blender で組み、光を焼き込む。

    python3 tools/blender/city.py --out public/worlds/city.glb [--size 2048] [--samples 64] [--still still.png]

空は Nishita の空(太陽の向きは json の sun と同じ)。ビルは大通りから見える面だけ作る。
"""
import json
import math
import os
import random
import sys

import bpy  # noqa: F401 (bmesh より先に読む)
import bmesh
from mathutils import Euler, Matrix

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from worldkit import P, World, args, mat  # noqa: E402

A = args({"out": "city.glb"})
rnd = random.Random(21)
SC = 10                      # 作品の大きさ(倍)
AV = 14.0                    # 大通りの半分の幅
STREETS = [20.0, -40.0, -100.0]   # 東西の車道(中心の z)
RW = 8.0                     # 車道の半分の幅
SITES = [(-34, -10), (34, -10), (-34, -70), (34, -70)]
XCOLS = [(14, 58), (70, 124), (136, 190), (202, 256), (268, 322), (334, 388), (400, 454)]  # 街区(x の範囲、右側)
ZST = [20 + 60 * k for k in range(8, -10, -1)]  # 東西の通り(遠くまで)
WALK = dict(x0=-70, x1=70, z0=-107, z1=58)       # 歩ける範囲の外枠(見えない面を省く)
NEAR = dict(x=140, z0=-180, z1=120)
SUN = (0.42, 0.85, 0.36)      # three.js の向き(太陽のある方)

w = World(samples=A.samples)


def fbox(group, size, center, material, ry=0.0):
    """bpy.ops を使わない箱(物が多いと ops は遅い)"""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.scale(bm, vec=(size[0], size[2], size[1]), verts=bm.verts)
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(ry, 3, "Z"), verts=bm.verts)
    bmesh.ops.translate(bm, vec=P(*center), verts=bm.verts)
    return w.mesh_from_bmesh(group, "box", bm, material, smooth=False)


def fcyl(group, r_top, r_bot, h, center, material, seg=32, caps=True, rx=0.0, rz=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, segments=seg, radius1=r_bot, radius2=r_top, depth=h)
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Euler((rx, 0, rz)).to_matrix(), verts=bm.verts)
    bmesh.ops.translate(bm, vec=P(*center), verts=bm.verts)
    return w.mesh_from_bmesh(group, "cyl", bm, material)


w.box, w.cyl = fbox, fcyl

w.group("sky", A.size // 2, unlit=True)
w.group("ground", A.size // 2, rough=0.9)
w.group("road", A.size, rough=0.85)
w.group("pave", A.size, rough=0.55)
w.group("towers", A.size, rough=0.35)
w.group("towers_far", A.size // 2, rough=0.4)
w.group("props", A.size, rough=0.5)
w.group("green", A.size // 2, rough=0.9, vcol=True)


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


def mix(nt, fac, a, b, blend="MIX"):
    m = nt.nodes.new("ShaderNodeMix")
    m.data_type = "RGBA"
    m.blend_type = blend
    for sock, v in (("Factor", fac), ("A", a), ("B", b)):
        if isinstance(v, (tuple, float, int)):
            m.inputs[sock].default_value = v if sock == "Factor" else (*v, 1)
        else:
            nt.links.new(v, m.inputs[sock])
    return m.outputs["Result"]


def bump(nt, bsdf, height, strength, dist=0.05):
    b = nt.nodes.new("ShaderNodeBump")
    b.inputs["Strength"].default_value = strength
    b.inputs["Distance"].default_value = dist
    nt.links.new(height, b.inputs["Height"])
    nt.links.new(b.outputs["Normal"], bsdf.inputs["Normal"])


def brick(nt, vec, w_, h_, mortar, c1, c2, mc, offset=0.5, smooth=0.1):
    br = nt.nodes.new("ShaderNodeTexBrick")
    br.offset = offset
    br.inputs["Scale"].default_value = 1.0
    br.inputs["Brick Width"].default_value = w_
    br.inputs["Row Height"].default_value = h_
    br.inputs["Mortar Size"].default_value = mortar
    br.inputs["Mortar Smooth"].default_value = smooth
    br.inputs["Color1"].default_value = (*c1, 1)
    br.inputs["Color2"].default_value = (*c2, 1)
    br.inputs["Mortar"].default_value = (*mc, 1)
    nt.links.new(vec, br.inputs["Vector"])
    return br


def paver(name, c1, c2, mc, bw, bh, rough, offset=0.5):
    """敷石・歩道の板石(継ぎ目は凹ませる)"""
    m, nt = nodes(name)
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = rough
    p = pos(nt)
    br = brick(nt, p, bw, bh, 0.012, c1, c2, mc, offset, 0.4)
    dirt = noise(nt, p, 0.12, 6)
    grit = noise(nt, p, 30, 4)
    c = mix(nt, 0.35, br.outputs["Color"], ramp(nt, dirt, [(0.3, (0.6, 0.6, 0.6)), (0.7, (1, 1, 1))]), "MULTIPLY")
    c = mix(nt, 0.25, c, ramp(nt, grit, [(0.3, (0.7, 0.7, 0.7)), (0.7, (1, 1, 1))]), "MULTIPLY")
    nt.links.new(c, bsdf.inputs["Base Color"])
    inv = nt.nodes.new("ShaderNodeMath")
    inv.operation = "SUBTRACT"
    inv.inputs[0].default_value = 1
    nt.links.new(br.outputs["Fac"], inv.inputs[1])
    bump(nt, bsdf, inv.outputs[0], 0.5, 0.01)
    return m


def asphalt(name, base):
    m, nt = nodes(name)
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.9
    p = pos(nt)
    g = noise(nt, p, 40, 6, 0.7)
    patch = noise(nt, p, 0.08, 4)
    c = ramp(nt, g, [(0.3, tuple(x * 0.6 for x in base)), (0.7, tuple(x * 1.25 for x in base))])
    c = mix(nt, ramp(nt, patch, [(0.55, (0, 0, 0)), (0.6, (0.5, 0.5, 0.5))]), c, tuple(x * 0.6 for x in base))
    # 轍(わだち)の黒ずみ
    nt.links.new(c, bsdf.inputs["Base Color"])
    bump(nt, bsdf, g, 0.3, 0.01)
    return m


def facade(name, glass1, glass2, frame, ww, fh, mort, rough_glass=0.12, offset=0.0):
    """ビルの壁(UV 'win' はメートル)。窓ごとに色が少し違う"""
    m, nt = nodes(name)
    bsdf = nt.nodes["Principled BSDF"]
    uv = nt.nodes.new("ShaderNodeUVMap")
    uv.uv_map = "win"
    br = brick(nt, uv.outputs["UV"], ww, fh, mort, glass1, glass2, frame, offset, 0.0)
    br.inputs["Bias"].default_value = -0.3
    stain = noise(nt, pos(nt), 0.05, 5)
    c = mix(nt, 0.3, br.outputs["Color"], ramp(nt, stain, [(0.3, (0.75, 0.75, 0.75)), (0.7, (1, 1, 1))]), "MULTIPLY")
    nt.links.new(c, bsdf.inputs["Base Color"])
    r = nt.nodes.new("ShaderNodeMapRange")
    r.inputs["To Min"].default_value = rough_glass
    r.inputs["To Max"].default_value = 0.65
    nt.links.new(br.outputs["Fac"], r.inputs["Value"])
    nt.links.new(r.outputs[0], bsdf.inputs["Roughness"])
    bump(nt, bsdf, br.outputs["Fac"], 0.4, 0.05)
    return m


def foliage(name, c1, c2):
    m, nt = nodes(name)
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.85
    p = pos(nt)
    v = nt.nodes.new("ShaderNodeTexVoronoi")
    v.inputs["Scale"].default_value = 4.0
    nt.links.new(p, v.inputs["Vector"])
    n = noise(nt, p, 1.2, 4)
    c = ramp(nt, n, [(0.3, c1), (0.7, c2)])
    c = mix(nt, 0.5, c, ramp(nt, v.outputs["Distance"], [(0.0, (1, 1, 1)), (0.6, (0.45, 0.45, 0.45))]), "MULTIPLY")
    nt.links.new(c, bsdf.inputs["Base Color"])
    bump(nt, bsdf, v.outputs["Distance"], 0.8, 0.1)
    bsdf.inputs["Subsurface Weight"].default_value = 0.0
    return m


def sun_angles(d):
    """three.js の向き → Nishita の (高さ, 回転)"""
    dx, dy, dz = d
    return math.atan2(dy, math.hypot(dx, dz)), math.atan2(dx, -dz)


def sky_node(nt, disc):
    s = nt.nodes.new("ShaderNodeTexSky")
    s.sky_type = "NISHITA"
    s.sun_elevation, s.sun_rotation = sun_angles(SUN)
    s.sun_disc = disc
    s.sun_size = math.radians(1.2)
    s.air_density = 1.0
    s.dust_density = 0.8
    s.ozone_density = 1.0
    s.altitude = 0
    return s


def sky_dome_mat(strength):
    """見える空:Nishita の空 + 薄い積雲"""
    m, nt = nodes("sky")
    nt.nodes.remove(nt.nodes["Principled BSDF"])
    nrm = nt.nodes.new("ShaderNodeVectorMath")
    nrm.operation = "NORMALIZE"
    nt.links.new(pos(nt), nrm.inputs[0])
    s = sky_node(nt, True)
    nt.links.new(nrm.outputs[0], s.inputs[0])
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(nrm.outputs[0], sep.inputs[0])
    # 雲:方向を地平に向かって押しつぶしたノイズ
    div = nt.nodes.new("ShaderNodeVectorMath")
    div.operation = "DIVIDE"
    nt.links.new(nrm.outputs[0], div.inputs[0])
    cz = nt.nodes.new("ShaderNodeCombineXYZ")
    mx = nt.nodes.new("ShaderNodeMath")
    mx.operation = "ADD"
    mx.inputs[1].default_value = 0.12
    nt.links.new(sep.outputs["Z"], mx.inputs[0])
    for k in ("X", "Y", "Z"):
        nt.links.new(mx.outputs[0], cz.inputs[k])
    nt.links.new(cz.outputs[0], div.inputs[1])
    cl = noise(nt, div.outputs[0], 0.9, 8, 0.6)
    cm = ramp(nt, cl, [(0.52, (0, 0, 0)), (0.68, (1, 1, 1))])
    band = ramp(nt, sep.outputs["Z"], [(0.0, (0, 0, 0)), (0.05, (0.7, 0.7, 0.7)), (0.5, (0.5, 0.5, 0.5)), (0.9, (0, 0, 0))])
    k = mix(nt, 1.0, cm, band, "MULTIPLY")
    sk = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(k, sk.inputs[0])
    skyc = nt.nodes.new("ShaderNodeMix")
    skyc.data_type = "RGBA"
    nt.links.new(sk.outputs[0], skyc.inputs["Factor"])
    nt.links.new(s.outputs["Color"], skyc.inputs["A"])
    skyc.inputs["B"].default_value = (2.6, 2.6, 2.7, 1)
    # 地平線より下は霞の色
    below = ramp(nt, sep.outputs["Z"], [(0.0, (1, 1, 1)), (0.0001, (0, 0, 0))])
    fin = mix(nt, below, skyc.outputs["Result"], (1.9, 2.1, 2.4))
    e = nt.nodes.new("ShaderNodeEmission")
    e.inputs["Strength"].default_value = strength
    nt.links.new(fin, e.inputs["Color"])
    nt.links.new(e.outputs[0], nt.nodes["Material Output"].inputs[0])
    return m


# 光を集める空(太陽の円盤は消し、太陽は SUN ランプで)
wn = w.sc.world.node_tree
s = sky_node(wn, False)
wn.links.new(s.outputs["Color"], wn.nodes["Background"].inputs["Color"])
wn.nodes["Background"].inputs["Strength"].default_value = 0.3

M = {
    "asph": asphalt("asph", (0.07, 0.07, 0.075)),
    "road": asphalt("road", (0.06, 0.06, 0.065)),
    "paint": mat("paint", (0.75, 0.74, 0.7), rough=0.6, noise=0.25, noise_scale=8),
    "ypaint": mat("ypaint", (0.75, 0.55, 0.1), rough=0.6, noise=0.25, noise_scale=8),
    "granite": paver("granite", (0.42, 0.4, 0.37), (0.55, 0.53, 0.5), (0.25, 0.24, 0.22), 1.2, 0.6, 0.4),
    "plaza": paver("plaza", (0.5, 0.45, 0.38), (0.36, 0.33, 0.3), (0.2, 0.19, 0.17), 0.9, 0.9, 0.45, 0.0),
    "walk": paver("walk", (0.48, 0.48, 0.47), (0.55, 0.55, 0.54), (0.3, 0.3, 0.3), 1.5, 1.5, 0.75, 0.0),
    "curb": mat("curb", (0.52, 0.5, 0.48), rough=0.7, noise=0.2, noise_scale=10, bump=0.05),
    "pod": mat("pod", (0.07, 0.07, 0.075), rough=0.18, noise=0.35, noise_scale=60, veins=((0.32, 0.31, 0.3), 1.6)),
    "steel": mat("steel", (0.07, 0.075, 0.08), rough=0.4, noise=0.2, noise_scale=20),
    "brass": mat("brass", (0.75, 0.55, 0.3), rough=0.3, noise=0.1, noise_scale=30),
    "wood": mat("wood", (0.32, 0.2, 0.11), rough=0.7, noise=0.3, noise_scale=25, bump=0.08),
    "bark": mat("bark", (0.16, 0.11, 0.08), rough=0.95, noise=0.4, noise_scale=12, bump=0.3),
    "soil": mat("soil", (0.1, 0.07, 0.05), rough=1.0, noise=0.4, noise_scale=10, bump=0.2),
    "tire": mat("tire", (0.02, 0.02, 0.02), rough=0.8),
    "cglass": mat("cglass", (0.02, 0.025, 0.03), rough=0.1),
    "lamp": mat("lamp", (0.9, 0.88, 0.8), rough=0.3),
    "leaf": foliage("leaf", (0.06, 0.12, 0.03), (0.16, 0.24, 0.06)),
    "hedge": foliage("hedge", (0.04, 0.09, 0.03), (0.1, 0.17, 0.05)),
}
CAR_COLS = [(0.6, 0.6, 0.62), (0.03, 0.03, 0.035), (0.35, 0.03, 0.03), (0.04, 0.1, 0.3), (0.75, 0.5, 0.05), (0.8, 0.8, 0.78)]
CARM = [mat(f"car{k}", c, rough=0.25, noise=0.05, noise_scale=5) for k, c in enumerate(CAR_COLS)]
STYLES = [
    facade("glassblue", (0.05, 0.08, 0.12), (0.12, 0.16, 0.2), (0.32, 0.34, 0.36), 1.5, 3.8, 0.12),
    facade("stone", (0.03, 0.035, 0.04), (0.08, 0.08, 0.085), (0.5, 0.45, 0.37), 2.2, 3.6, 0.8, offset=0.0),
    facade("darkglass", (0.015, 0.02, 0.025), (0.05, 0.06, 0.07), (0.06, 0.06, 0.065), 3.0, 4.0, 0.22),
    facade("brick", (0.04, 0.045, 0.05), (0.12, 0.1, 0.08), (0.3, 0.14, 0.08), 2.6, 3.2, 1.0),
    facade("white", (0.06, 0.08, 0.1), (0.14, 0.15, 0.16), (0.62, 0.62, 0.6), 1.8, 3.6, 0.6),
    facade("greenglass", (0.04, 0.09, 0.08), (0.1, 0.16, 0.15), (0.4, 0.42, 0.42), 1.3, 3.9, 0.1),
]
SHOP = facade("shop", (0.18, 0.15, 0.1), (0.05, 0.05, 0.055), (0.12, 0.12, 0.13), 6.0, 5.5, 0.5, rough_glass=0.1)


# ---- ビル(見える壁だけ。UV 'win' はメートル) ----
class FaceSet:
    """(組, 材質) ごとに bmesh を貯める"""
    def __init__(self):
        self.d = {}

    def get(self, group, m):
        k = (group, m.name)
        if k not in self.d:
            bm = bmesh.new()
            self.d[k] = (bm, bm.loops.layers.uv.new("win"), m)
        return self.d[k][:2]

    def flush(self):
        for (group, name), (bm, _, m) in self.d.items():
            w.mesh_from_bmesh(group, name, bm, m, smooth=False)


FS = FaceSet()


def visible(nx, nz, c):
    """歩ける範囲から見える向きか"""
    if nx > 0:
        return WALK["x1"] > c
    if nx < 0:
        return WALK["x0"] < c
    if nz > 0:
        return WALK["z1"] > c
    return WALK["z0"] < c


def walls(group, m, x0, x1, z0, z1, y0, y1, u_off=0.0):
    bm, uvl = FS.get(group, m)
    sides = (((x0, z1), (x1, z1), 0, 1, z1), ((x1, z1), (x1, z0), 1, 0, x1), ((x1, z0), (x0, z0), 0, -1, z0), ((x0, z0), (x0, z1), -1, 0, x0))
    u = u_off
    for (ax, az), (bx, bz), nx, nz, c in sides:
        L = math.hypot(bx - ax, bz - az)
        if visible(nx, nz, c):
            f = bm.faces.new([bm.verts.new(P(ax, y0, az)), bm.verts.new(P(bx, y0, bz)), bm.verts.new(P(bx, y1, bz)), bm.verts.new(P(ax, y1, az))])
            for lp, uv in zip(f.loops, ((u, y0), (u + L, y0), (u + L, y1), (u, y1))):
                lp[uvl].uv = uv
        u += L


def building(group, x0, x1, z0, z1, h, style):
    m = STYLES[style]
    off = rnd.uniform(0, 50)
    walls(group, SHOP if group == "towers" else m, x0, x1, z0, z1, 0, 5.5, off)
    y = 5.5
    tiers = [h]
    if h > 70 and rnd.random() < 0.6:
        tiers = [h * rnd.uniform(0.55, 0.75), h]
    for k, yt in enumerate(tiers):
        walls(group, m, x0, x1, z0, z1, y, yt - 2.5, off)
        walls(group, STYLES[1] if style != 1 else STYLES[2], x0, x1, z0, z1, yt - 2.5, yt, off)  # 屋上の縁
        y = yt
        ins = min(x1 - x0, z1 - z0) * 0.14
        x0, x1, z0, z1 = x0 + ins, x1 - ins, z0 + ins, z1 - ins


def block_rects(z_hi, z_lo, xa, xb):
    """1 街区に 1〜3 棟"""
    n = rnd.choice((1, 2, 2, 3))
    if n == 1:
        return [(xa, xb, z_lo, z_hi)]
    if (z_hi - z_lo) >= (xb - xa):
        cuts = sorted(rnd.uniform(z_lo + 14, z_hi - 14) for _ in range(n - 1))
        zs = [z_lo] + cuts + [z_hi]
        return [(xa, xb, zs[k] + (k > 0) * 1.5, zs[k + 1] - (k < n - 1) * 1.5) for k in range(n)]
    cuts = sorted(rnd.uniform(xa + 14, xb - 14) for _ in range(n - 1))
    xs = [xa] + cuts + [xb]
    return [(xs[k] + (k > 0) * 1.5, xs[k + 1] - (k < n - 1) * 1.5, z_lo, z_hi) for k in range(n)]


# ---- 地面(遠くまでのアスファルト) ----
w.plane("ground", 1700, 1700, (0, -0.03, -25), M["asph"], face_up=True)

# ---- 街区:歩道の台とビル ----
plazas = set()
for sx, sz in SITES:
    plazas.add((1 if sx > 0 else -1, sz))
for j in range(len(ZST) - 1):
    zh, zl = ZST[j] - RW, ZST[j + 1] + RW
    zc = (zh + zl) / 2
    for side in (-1, 1):
        for ci, (xa, xb) in enumerate(XCOLS):
            if side < 0:
                xa, xb = -xb, -xa
            near = abs(xa + xb) / 2 < NEAR["x"] and NEAR["z0"] < zc < NEAR["z1"]
            if ci == 0 and (side, zc) in plazas:
                continue  # 作品の広場
            if ci == 0 and -156 < zc < -100:
                continue  # 突き当たりの塔(下で作る)
            if near:
                w.box("pave", (xb - xa, 0.15, zh - zl), ((xa + xb) / 2, 0.075, zc), M["walk"])
            else:
                w.box("ground", (xb - xa, 0.15, zh - zl), ((xa + xb) / 2, 0.075, zc), M["walk"])
            for bx0, bx1, bz0, bz1 in block_rects(zh - 3, zl + 3, xa + 3, xb - 3):
                d = math.hypot((bx0 + bx1) / 2, (bz0 + bz1) / 2 + 25)
                h = 22 + rnd.random() ** 1.6 * (230 if d < 220 else 120)
                if ci == 0:
                    h = max(h, 45)
                building("towers" if near else "towers_far", bx0, bx1, bz0, bz1, h, rnd.randrange(len(STYLES)))

# 突き当たりの高層タワー(大通りの正面を閉じる)
w.box("pave", (116, 0.15, 44), (0, 0.075, -130), M["walk"])
walls("towers", SHOP, -52, 52, -150, -112, 0, 6, 0)
walls("towers", STYLES[2], -52, 52, -150, -112, 6, 22, 0)
walls("towers", STYLES[1], -52, 52, -150, -112, 22, 26, 0)
building("towers", -24, 24, -148, -118, 240, 0)

# ---- 大通り(歩行者天国)と広場 ----
for z in range(58, -108, -20):  # 区切って焼き込みの解像度を保つ
    z1 = max(z - 20, -108)
    w.box("pave", (2 * AV, 0.12, z - z1), (0, 0.06, (z + z1) / 2), M["granite"])
for sx, sz in SITES:
    s = 1 if sx > 0 else -1
    w.box("pave", (44, 0.15, 44), (s * 36, 0.075, sz), M["plaza"])

# ---- 車道(東西)と横断歩道・白線 ----
for zs in STREETS:
    for x0, x1 in ((-140, -AV), (AV, 140)):
        w.plane("road", x1 - x0, 2 * RW, ((x0 + x1) / 2, 0.0, zs), M["road"], face_up=True)
    for k in range(int(2 * AV / 1.4)):  # 大通りを渡る縞
        x = -AV + 0.7 + k * 1.4
        w.box("road", (0.8, 0.02, 2 * RW - 2.4), (x, 0.13, zs), M["paint"])
    for x0, x1 in ((-140, -AV - 4), (AV + 4, 140)):
        for x in range(int(x0), int(x1) - 3, 9):  # 中央の破線
            w.box("road", (4.0, 0.01, 0.16), (x + 2, 0.005, zs), M["paint"])
        for dz in (-RW + 0.4, RW - 0.4):  # 端の白線
            w.box("road", (x1 - x0, 0.01, 0.15), ((x0 + x1) / 2, 0.005, zs + dz), M["paint"])
        w.box("road", (0.4, 0.01, RW - 0.6), ((AV + 3.0) * (1 if x0 > 0 else -1), 0.005, zs + (RW / 2 - 0.3) * (1 if x0 > 0 else -1)), M["paint"])  # 停止線
# 南北の車道(大通りの外側)
for sx in (-64, 64):
    for z0, z1 in ((120, 28), (12, -32), (-48, -92), (-108, -180)):
        w.plane("road", 12, z0 - z1, (sx, 0.0, (z0 + z1) / 2), M["road"], face_up=True)
        for z in range(int(z1) + 2, int(z0) - 4, 9):
            w.box("road", (0.16, 0.01, 4.0), (sx, 0.005, z + 2), M["ypaint"])

# ---- 作品の基壇(黒御影石)と銘板 ----
for i, (sx, sz) in enumerate(SITES):
    s = 1 if sx > 0 else -1
    w.box("props", (24, 0.6, 24), (sx, 0.45, sz), M["pod"])
    w.box("props", (22.4, 0.6, 22.4), (sx, 0.9, sz), M["pod"])
    for k in range(3):  # 大通り側の階段
        w.box("props", (0.45, 0.2 * (k + 1), 8), (sx - s * (12.2 + 0.45 * (2 - k) + 0.2), 0.15 + 0.1 * (k + 1), sz), M["pod"])
    # 銘板(真鍮の文字)
    bx = sx - s * 12.05
    cu = bpy.data.curves.new("txt", "FONT")
    cu.body = f"No.{i + 1:02d}"
    cu.size = 0.42
    cu.align_x, cu.align_y = "CENTER", "CENTER"
    cu.extrude = 0.01
    o = bpy.data.objects.new("txt", cu)
    w.sc.collection.objects.link(o)
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.convert(target="MESH")
    o = bpy.context.object
    o.location = P(bx - s * 0.02, 0.9, sz + 6.2)
    o.rotation_euler = (math.pi / 2, 0, -s * math.pi / 2)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    w.add("props", o, M["brass"])
    # 広場の植え込みと木
    for dz in (-17, 17):
        w.box("props", (10, 0.6, 3), (sx + s * 4, 0.45, sz + dz), M["curb"])
        w.box("green", (9.6, 0.9, 2.6), (sx + s * 4, 1.05, sz + dz), M["hedge"])


# ---- 並木・街灯・ベンチ ----
def tree(x, z, sc_=1.0):
    w.cyl("props", 0.16 * sc_, 0.26 * sc_, 4.2 * sc_, (x, 2.1 * sc_, z), M["bark"], seg=8)
    w.box("props", (1.6, 0.04, 1.6), (x, 0.13, z), M["steel"])  # 木の根元の鉄の格子
    bm = bmesh.new()
    for k in range(6):
        r = rnd.uniform(1.1, 1.6) * sc_
        c = (rnd.uniform(-1.3, 1.3) * sc_, rnd.uniform(-1.3, 1.3) * sc_, (5.2 + rnd.uniform(-0.8, 1.4)) * sc_)
        ret = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=r)
        for v in ret["verts"]:
            v.co.z *= 0.85
            v.co += v.co.normalized() * rnd.uniform(-0.25, 0.25) * r
            v.co.x += c[0]
            v.co.y += c[1]
            v.co.z += c[2]
    bmesh.ops.translate(bm, verts=bm.verts[:], vec=P(x, 0, z))
    w.mesh_from_bmesh("green", "crown", bm, M["leaf"])


def near_street(z, gap):
    return any(abs(z - s) < gap for s in STREETS)


for z in range(54, -106, -11):
    if near_street(z, 11):
        continue
    for s in (-1, 1):
        tree(s * (AV - 3.2), z + rnd.uniform(-0.5, 0.5))
for sx, sz in SITES:
    s = 1 if sx > 0 else -1
    for dz in (-14, 0, 14):
        tree(sx + s * 17, sz + dz, 1.15)
for z in range(52, -106, -22):
    if near_street(z, 9):
        continue
    for s in (-1, 1):
        x = s * (AV - 0.8)
        w.cyl("props", 0.07, 0.11, 8, (x, 4, z), M["steel"], seg=10)
        w.box("props", (1.6, 0.1, 0.12), (x - s * 0.75, 8.0, z), M["steel"])
        w.box("props", (0.7, 0.14, 0.32), (x - s * 1.5, 7.9, z), M["lamp"])
for z in range(46, -106, -26):
    if near_street(z, 10):
        continue
    w.box("props", (0.6, 0.45, 2.4), (-1.6, 0.35, z), M["curb"])  # ベンチの台
    w.box("props", (0.6, 0.45, 2.4), (1.6, 0.35, z), M["curb"])
    for k in range(4):
        for s in (-1, 1):
            w.box("props", (0.12, 0.05, 2.5), (s * 1.6 - 0.21 + k * 0.14, 0.6, z), M["wood"])
# 車止め(大通りの入口)
for zs in STREETS:
    for dz in (-RW - 0.6, RW + 0.6):
        for x in range(-12, 13, 3):
            w.cyl("props", 0.11, 0.13, 0.9, (x, 0.57, zs + dz), M["steel"], seg=10)
# 信号機
for zs in STREETS:
    for s in (-1, 1):
        for dz in (-1, 1):
            x, z = s * (AV + 1.2), zs + dz * (RW + 1.2)
            w.cyl("props", 0.09, 0.11, 5.5, (x, 2.9, z), M["steel"], seg=8)
            w.box("props", (s * 0 + 3.4, 0.12, 0.12), (x + s * 1.7, 5.4, z), M["steel"])
            w.box("props", (1.2, 0.4, 0.35), (x + s * 2.6, 5.1, z), M["tire"])


# ---- 車(東西の車道に止まる・走る) ----
def car(x, z, ry, col):
    c, s = math.cos(ry), math.sin(ry)

    def at(dx, dz):
        return x + dx * c + dz * s, z - dx * s + dz * c
    bx, bz = at(0, 0)
    w.box("props", (4.5, 0.75, 1.85), (bx, 0.65, bz), col, ry=ry)
    cx, cz = at(-0.25, 0)
    w.box("props", (2.5, 0.62, 1.65), (cx, 1.33, cz), M["cglass"], ry=ry)
    for dx in (-1.45, 1.45):
        for dz in (-0.85, 0.85):
            wx, wz = at(dx, dz)
            w.cyl("props", 0.34, 0.34, 0.24, (wx, 0.34, wz), M["tire"], seg=14, rx=math.pi / 2, rz=ry)


for zs in STREETS:
    for k in range(7):
        side = rnd.choice((-1, 1))
        x = side * rnd.uniform(AV + 6, 135)
        lane = rnd.choice((-1, 1))
        car(x, zs + lane * 3.6, 0 if lane > 0 else math.pi, rnd.choice(CARM))
    for side in (-1, 1):  # 信号待ち
        car(side * (AV + 6.5), zs + side * 3.6, 0 if side > 0 else math.pi, rnd.choice(CARM))

FS.flush()

# ---- 空のドーム(光の計算には加わらない) ----
bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=64, v_segments=32, radius=950)
bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
bmesh.ops.translate(bm, verts=bm.verts[:], vec=P(0, 0, -25))
dome = w.mesh_from_bmesh("sky", "sky", bm, sky_dome_mat(0.25))
for k in ("visible_diffuse", "visible_glossy", "visible_transmission", "visible_volume_scatter", "visible_shadow"):
    setattr(dome, k, False)

# ---- 太陽 ----
w.light("SUN", tuple(c * 100 for c in SUN), 4.2, (1.0, 0.93, 0.84), target=(0, 0, 0), angle=math.radians(0.6))

# ---- ブラウザ用の情報 ----
L = math.sqrt(sum(c * c for c in SUN))
walk = [{"t": "rect", "x0": -AV + 0.8, "z0": -107, "x1": AV - 0.8, "z1": 58}]
walk += [{"t": "rect", "x0": -70, "z0": zs - RW + 0.5, "x1": 70, "z1": zs + RW - 0.5} for zs in STREETS]
walk += [{"t": "rect", "x0": min(s * 14, s * 57), "z0": sz - 21, "x1": max(s * 14, s * 57), "z1": sz + 21}
         for sx, sz in SITES for s in [1 if sx > 0 else -1]]
w.extra.update({
    "title": "摩天楼の街",
    "tip": "キューブが超高層ビルの大きさで建つ街です。歩行者天国の大通りを歩いて見上げます。",
    "start": {"x": 0, "z": 52, "yaw": 0, "pitch": 0.14},
    "walk": walk,
    "speed": 7,
    "bg": "#c9d6e3",
    "fog": ["#c6d3df", 0.0016],
    "exposure": 1.0,
    "far": 3200,
    "hemi": ["#dfefff", "#6a6a64", 0.6],
    "sun": {"dir": [c / L for c in SUN], "color": "#fff1dc", "intensity": 1.5, "box": 150},
    "palette": ["#cfd8df", "#2a5f8a"],
})
for i, (sx, sz) in enumerate(SITES):
    w.spot(x=sx, y=1.2, z=sz, face=math.pi / 2 if sx < 0 else -math.pi / 2, dist=2.6, r=12.5, scale=SC, lift=0.0)

if A.still:
    w.sc.view_settings.exposure = -0.3
    w.still(A.still, (0, 1.6, 52), (0, 1.6 + math.tan(0.14) * 50, 2), lens=18)
    if A.still_only:
        os._exit(0)

w.sc.view_settings.exposure = 0
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
