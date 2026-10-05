"""宮殿を改装した欧州の美術館を Blender で組み、光を焼き込む。

    python3 tools/blender/european.py --out public/worlds/european.glb [--size 2048] [--samples 64] [--still still.png]

アーチの戸口でつながった部屋が奥へ続く。寄木の床・ダマスク織の壁・格天井・シャンデリア・金の額縁。
"""
import math
import os
import sys

import bpy
import bmesh
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from worldkit import P, World, args, emit, mat, painting  # noqa: E402

A = args({"out": "european.glb"})
N = 4
RW, RD, H = 11.0, 10.0, 6.0
ROOMS = max(2, math.ceil(N / 2))
Z0 = RD / 2                       # 入口の壁
ZEND = -(ROOMS - 1) * RD - RD / 2  # 奥の壁
WALLC = [(0.30, 0.035, 0.045), (0.05, 0.16, 0.10), (0.05, 0.08, 0.20), (0.30, 0.18, 0.05)]  # 部屋ごとの壁の色


# ---- 材質を組む小道具(ノードを式のように書く) ----
class NG:
    def __init__(s, name, rough=0.8, metal=0.0):
        s.mt = bpy.data.materials.new(name)
        s.mt.use_nodes = True
        s.nt = s.mt.node_tree
        s.b = s.nt.nodes["Principled BSDF"]
        s.b.inputs["Roughness"].default_value = rough
        s.b.inputs["Metallic"].default_value = metal

    def set(s, sock, v):
        if isinstance(v, bpy.types.NodeSocket):
            s.nt.links.new(v, sock)
        elif isinstance(v, (tuple, list)) and len(v) == 3 and sock.type == "RGBA":
            sock.default_value = (*v, 1)
        else:
            sock.default_value = v

    def node(s, t, ins=None, **props):
        n = s.nt.nodes.new(t)
        for k, v in props.items():
            setattr(n, k, v)
        for k, v in (ins or {}).items():
            s.set(n.inputs[k], v)
        return n

    def pos(s):
        return s.node("ShaderNodeNewGeometry").outputs["Position"]

    def xyz(s, v):
        return s.node("ShaderNodeSeparateXYZ", {0: v}).outputs

    def comb(s, x, y, z):
        return s.node("ShaderNodeCombineXYZ", {0: x, 1: y, 2: z}).outputs[0]

    def m(s, op, a, b=0.0, c=0.0, clamp=False):
        return s.node("ShaderNodeMath", {0: a, 1: b, 2: c}, operation=op, use_clamp=clamp).outputs[0]

    def noise(s, v, scale, detail=6.0, rough=0.5, dist=0.0):
        n = s.node("ShaderNodeTexNoise", {"Scale": scale, "Detail": detail, "Roughness": rough, "Distortion": dist})
        if v is not None:
            s.set(n.inputs["Vector"], v)
        return n.outputs["Fac"]

    def white(s, v):
        return s.node("ShaderNodeTexWhiteNoise", {"Vector": v}, noise_dimensions="3D").outputs["Value"]

    def mix(s, f, a, b):
        n = s.node("ShaderNodeMix", data_type="RGBA")
        s.set(n.inputs[0], f)
        s.set(n.inputs[6], a)
        s.set(n.inputs[7], b)
        return n.outputs[2]

    def ramp(s, f, stops):
        n = s.node("ShaderNodeValToRGB")
        els = n.color_ramp.elements
        els[0].position, els[0].color = stops[0][0], (*stops[0][1], 1)
        els[1].position, els[1].color = stops[-1][0], (*stops[-1][1], 1)
        for p, c in stops[1:-1]:
            e = els.new(p)
            e.color = (*c, 1)
        s.set(n.inputs[0], f)
        return n.outputs[0]

    def out(s, color, bump=None, strength=0.2, dist=0.02, rough=None):
        s.set(s.b.inputs["Base Color"], color)
        if rough is not None:
            s.set(s.b.inputs["Roughness"], rough)
        if bump is not None:
            bn = s.node("ShaderNodeBump", {"Strength": strength, "Distance": dist, "Height": bump})
            s.nt.links.new(bn.outputs[0], s.b.inputs["Normal"])
        return s.mt


def herringbone(name, w=0.075, n=6):
    """寄木(ヘリンボーン):板の幅 w、長さ n*w。45 度回して背骨が部屋の奥へ向かう"""
    g = NG(name, rough=0.3)
    x, y, _ = g.xyz(g.pos())
    k = 1 / (math.sqrt(2) * w)
    u = g.m("MULTIPLY", g.m("ADD", x, y), k)
    v = g.m("MULTIPLY", g.m("SUBTRACT", y, x), k)
    i, j = g.m("FLOOR", u), g.m("FLOOR", v)
    fu, fv = g.m("SUBTRACT", u, i), g.m("SUBTRACT", v, j)
    dd = g.m("SUBTRACT", i, j)
    d = g.m("SUBTRACT", dd, g.m("MULTIPLY", g.m("FLOOR", g.m("DIVIDE", dd, 2 * n)), 2 * n))  # 0..2n-1
    hor = g.m("LESS_THAN", d, n)
    ver = g.m("SUBTRACT", 1.0, hor)
    back = g.m("SUBTRACT", 2 * n - 1, d)
    idx = g.m("SUBTRACT", i, g.m("MULTIPLY", d, hor))
    idy = g.m("SUBTRACT", j, g.m("MULTIPLY", back, ver))
    pid = g.comb(idx, idy, hor)
    r = g.white(pid)
    along = g.m("ADD", g.m("MULTIPLY", g.m("DIVIDE", g.m("ADD", d, fu), n), hor), g.m("MULTIPLY", g.m("DIVIDE", g.m("ADD", back, fv), n), ver))
    across = g.m("ADD", g.m("MULTIPLY", fv, hor), g.m("MULTIPLY", fu, ver))
    e1 = g.m("MULTIPLY", g.m("MINIMUM", across, g.m("SUBTRACT", 1.0, across)), w)
    e2 = g.m("MULTIPLY", g.m("MINIMUM", along, g.m("SUBTRACT", 1.0, along)), w * n)
    groove = g.m("MULTIPLY_ADD", g.m("MINIMUM", e1, e2), 900.0, -0.4, clamp=True)  # 継ぎ目で 0
    grain = g.noise(g.comb(g.m("MULTIPLY_ADD", along, 1.5, g.m("MULTIPLY", r, 20)), g.m("MULTIPLY", across, 18), g.m("MULTIPLY", r, 7)), 1.0, 8, 0.6, 0.4)
    tone = g.ramp(r, [(0.0, (0.13, 0.055, 0.02)), (0.5, (0.22, 0.11, 0.045)), (1.0, (0.32, 0.18, 0.08))])
    col = g.mix(g.m("MULTIPLY_ADD", grain, 0.9, -0.15, clamp=True), g.mix(0.6, tone, (0.08, 0.035, 0.012)), tone)
    col = g.mix(groove, (0.03, 0.015, 0.006), col)
    wear = g.noise(None, 0.35, 3)
    col = g.mix(g.m("MULTIPLY", wear, 0.35), col, (0.42, 0.28, 0.14))
    return g.out(col, bump=g.m("ADD", g.m("MULTIPLY", groove, 0.6), g.m("MULTIPLY", grain, 0.15)), strength=0.25, dist=0.003,
                 rough=g.m("MULTIPLY_ADD", wear, 0.25, 0.18))


def damask(name, color):
    """ダマスク織の壁布:同じ色の濃淡でメダリオンと菱の格子"""
    g = NG(name, rough=0.75)
    x, y, z = g.xyz(g.pos())
    s = g.m("ADD", x, y)
    cw, ch = 0.55, 0.78

    def cell(off_s, off_t):
        cu = g.m("SUBTRACT", g.m("FRACT", g.m("MULTIPLY_ADD", s, 1 / cw, off_s)), 0.5)
        cv = g.m("SUBTRACT", g.m("FRACT", g.m("MULTIPLY_ADD", z, 1 / ch, off_t)), 0.5)
        cu2 = g.m("MULTIPLY", cu, 1.35)
        rr = g.m("SQRT", g.m("ADD", g.m("MULTIPLY", cu2, cu2), g.m("MULTIPLY", cv, cv)))
        a = g.m("ARCTAN2", cv, cu2)
        petal = g.m("ADD", 0.26, g.m("MULTIPLY", g.m("COSINE", g.m("MULTIPLY", a, 6)), 0.06))
        petal = g.m("ADD", petal, g.m("MULTIPLY", g.m("COSINE", g.m("MULTIPLY", a, 2)), 0.05))
        fill = g.m("MULTIPLY_ADD", g.m("SUBTRACT", petal, rr), 80.0, 0.5, clamp=True)
        hole = g.m("MULTIPLY_ADD", g.m("SUBTRACT", g.m("MULTIPLY", petal, 0.45), rr), 80.0, 0.5, clamp=True)
        ring = g.m("MULTIPLY_ADD", g.m("SUBTRACT", 0.012, g.m("ABSOLUTE", g.m("SUBTRACT", g.m("MULTIPLY", petal, 0.7), rr))), 120.0, 0.0, clamp=True)
        return g.m("MAXIMUM", g.m("SUBTRACT", fill, g.m("MULTIPLY", g.m("SUBTRACT", hole, ring), 0.8)), 0.0)

    big = cell(0.0, 0.0)
    small = g.m("MULTIPLY", cell(0.5, 0.5), 0.0)
    # 小さな菱(格子の交点)
    du = g.m("ABSOLUTE", g.m("SUBTRACT", g.m("FRACT", g.m("MULTIPLY_ADD", s, 1 / cw, 0.5)), 0.5))
    dv = g.m("ABSOLUTE", g.m("SUBTRACT", g.m("FRACT", g.m("MULTIPLY_ADD", z, 1 / ch, 0.5)), 0.5))
    dia = g.m("MULTIPLY_ADD", g.m("SUBTRACT", 0.13, g.m("ADD", g.m("MULTIPLY", du, 1.4), dv)), 60.0, 0.0, clamp=True)
    pat = g.m("MAXIMUM", g.m("MAXIMUM", big, small), dia)
    fab = g.noise(g.comb(g.m("MULTIPLY", s, 400), g.m("MULTIPLY", z, 30), 0.0), 1.0, 2)
    dark = tuple(c * 0.78 for c in color)
    lite = tuple(min(1, c * 1.22 + 0.006) for c in color)
    col = g.mix(pat, dark, lite)
    col = g.mix(g.m("MULTIPLY", fab, 0.25), col, (0, 0, 0))
    return g.out(col, bump=pat, strength=0.08, dist=0.002, rough=g.m("MULTIPLY_ADD", pat, -0.35, 0.8))


def walnut(name, color=(0.09, 0.045, 0.02)):
    """くるみ材(木目は縦)"""
    g = NG(name, rough=0.35)
    x, y, z = g.xyz(g.pos())
    gv = g.comb(g.m("MULTIPLY", g.m("ADD", x, y), 22), g.m("MULTIPLY", z, 2.5), 0.0)
    gr = g.noise(gv, 1.0, 8, 0.6, 1.5)
    col = g.mix(gr, tuple(c * 0.55 for c in color), tuple(c * 1.6 for c in color))
    return g.out(col, bump=gr, strength=0.05, dist=0.002)


def oldmaster(name, c, fh, seed):
    """古い風景画:空のグラデーション・丘・木立ち・黄ばんだニスとひび割れ・暗い四隅"""
    g = NG(name, rough=0.4)
    x, y, z = g.xyz(g.node("ShaderNodeTexCoord").outputs["Object"])
    u = g.m("ADD", g.m("SUBTRACT", x, c[0]), g.m("ADD", y, c[2]))  # 物の座標は世界の座標なので、絵の中心を引く
    v = g.m("ADD", g.m("DIVIDE", g.m("SUBTRACT", z, c[1]), fh), 0.5)  # 0(下)..1(上)
    hz = 0.38 + (seed * 0.37 % 0.15)
    cl = g.noise(g.comb(g.m("MULTIPLY", u, 1.2), g.m("MULTIPLY", z, 3.0), seed), 2.0, 6, 0.6)
    sky = g.ramp(v, [(hz, (0.85, 0.62, 0.32)), (hz + 0.2, (0.55, 0.55, 0.45)), (1.0, (0.12, 0.2, 0.3))])
    sky = g.mix(g.m("MULTIPLY_ADD", cl, 1.6, -0.75, clamp=True), sky, (0.78, 0.7, 0.55))
    hill = g.m("ADD", hz, g.m("MULTIPLY", g.m("SUBTRACT", g.noise(g.comb(u, seed, 0.0), 1.2, 3), 0.5), 0.35))
    land = g.m("LESS_THAN", v, hill)
    gn = g.noise(g.comb(g.m("MULTIPLY", u, 4), g.m("MULTIPLY", z, 6), seed + 3), 3.0, 8, 0.65)
    ground = g.ramp(gn, [(0.3, (0.07, 0.075, 0.03)), (0.55, (0.22, 0.2, 0.08)), (0.75, (0.45, 0.36, 0.15))])
    trees = g.m("GREATER_THAN", g.noise(g.comb(g.m("MULTIPLY", u, 3), g.m("MULTIPLY", z, 2), seed + 9), 2.5, 6, 0.7),
                g.m("MULTIPLY_ADD", v, 0.9, 0.08))
    col = g.mix(land, sky, ground)
    col = g.mix(g.m("MULTIPLY", trees, 0.9), col, (0.02, 0.025, 0.01))
    # ニスの黄ばみと四隅の暗さ
    vig = g.m("MULTIPLY_ADD", g.m("ADD", g.m("MULTIPLY", g.m("ABSOLUTE", g.m("SUBTRACT", v, 0.5)), 1.4), g.m("ABSOLUTE", g.m("MULTIPLY", u, 0.7))), 0.8, -0.3, clamp=True)
    col = g.mix(vig, col, (0.02, 0.012, 0.005))
    col = g.node("ShaderNodeMix", {0: 1.0, 6: col, 7: (1.0, 0.82, 0.55)}, data_type="RGBA", blend_type="MULTIPLY").outputs[2]
    crack = g.node("ShaderNodeTexVoronoi", {"Vector": g.node("ShaderNodeTexCoord").outputs["Object"], "Scale": 90}, feature="DISTANCE_TO_EDGE").outputs["Distance"]
    return g.out(col, bump=g.m("ADD", g.m("MULTIPLY_ADD", crack, 30, 0, clamp=True), g.m("MULTIPLY", gn, 0.3)), strength=0.15, dist=0.002)


def velvet(name, color):
    g = NG(name, rough=0.95)
    g.b.inputs["Sheen Weight"].default_value = 0.8
    g.b.inputs["Sheen Tint"].default_value = (1, 0.6, 0.6, 1)
    nz = g.noise(None, 30, 4)
    return g.out(g.mix(nz, tuple(c * 0.7 for c in color), color))


w = World(samples=A.samples)
w.sky((0.25, 0.22, 0.2), 0.3)

w.group("floor", A.size, rough=0.22)
w.group("walls", A.size, rough=0.8)
w.group("ceil", A.size // 2, rough=0.9)
w.group("stone", A.size // 2, rough=0.25)
w.group("gold", A.size // 2, rough=0.28, metal=1.0)
w.group("art", A.size // 2, rough=0.6)
w.group("glow", bake=False)

M = {
    "floor": herringbone("parquet"),
    "walnut": walnut("walnut"),
    "plaster": mat("plaster", (0.78, 0.72, 0.6), rough=0.9, noise=0.06, noise_scale=3, bump=0.02),
    "plaster2": mat("plaster2", (0.66, 0.58, 0.45), rough=0.9, noise=0.08, noise_scale=3, bump=0.02),
    "marble": mat("marble", (0.8, 0.77, 0.71), rough=0.15, noise=0.1, noise_scale=0.9, veins=((0.6, 0.56, 0.5), 0.35)),
    "marble_d": mat("marble_d", (0.12, 0.09, 0.08), rough=0.15, noise=0.3, noise_scale=1.2, veins=((0.36, 0.3, 0.25), 0.4)),
    "gold": mat("gold", (0.85, 0.62, 0.3), rough=0.28, metal=1.0, noise=0.12, noise_scale=25, bump=0.1),
    "velvet": velvet("velvet", (0.28, 0.01, 0.025)),
    "candle": mat("candle", (0.85, 0.8, 0.7), rough=0.6),
    "bulb": emit("bulb", (1.0, 0.78, 0.48), 12.0),
    "sky": emit("skylight", (1.0, 0.96, 0.88), 5.0),
}
WALLM = [damask(f"damask{k}", WALLC[k % 4]) for k in range(ROOMS)]


# ---- 形の小道具 ----
def sweep(group, path, prof, nrm, material, closed=False, center=None, smooth=False, caps=True):
    """path(three の座標の点列)に沿って断面 prof[(a, b)] を押し出す。a は path の外側、b は nrm の向き"""
    pts = [P(*p) for p in path]
    n = P(*nrm).normalized()
    if center is not None:  # a が center から外向きになるように向きをそろえる
        t0 = (pts[1] - pts[0]).normalized()
        if n.cross(t0).dot(pts[0] - P(*center)) < 0:
            pts.reverse()
    bm = bmesh.new()
    m = len(pts)
    rings = []
    for i in range(m):
        tin = (pts[i] - pts[i - 1]).normalized() if (closed or i > 0) else None
        tout = (pts[(i + 1) % m] - pts[i]).normalized() if (closed or i < m - 1) else None
        t = (tin + tout).normalized() if (tin and tout and (tin + tout).length > 1e-6) else (tin or tout)
        side = n.cross(t).normalized()
        ref = n.cross(tin or tout).normalized()
        sc = 1 / max(0.3, side.dot(ref))
        rings.append([bm.verts.new(pts[i] + side * a * sc + n * b) for a, b in prof])
    k = len(prof)
    for i in range(m if closed else m - 1):
        r0, r1 = rings[i], rings[(i + 1) % m]
        for j in range(k):
            bm.faces.new((r0[j], r0[(j + 1) % k], r1[(j + 1) % k], r1[j]))
    if not closed and caps:
        bm.faces.new(rings[0])
        bm.faces.new(list(reversed(rings[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return w.mesh_from_bmesh(group, "sweep", bm, material, smooth=smooth)


def circle(r, seg=12):
    return [(math.cos(a / seg * 2 * math.pi) * r, math.sin(a / seg * 2 * math.pi) * r) for a in range(seg)]


def cut(o, cutters):
    """o から cutters をくり抜く(ブーリアン)"""
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = o
    for c in cutters:
        md = o.modifiers.new("cut", "BOOLEAN")
        md.operation = "DIFFERENCE"
        md.object = c
        md.solver = "EXACT"
        bpy.ops.object.modifier_apply(modifier=md.name)
    for c in cutters:
        bpy.data.objects.remove(c)


def cutter_box(size, center):
    bpy.ops.mesh.primitive_cube_add(size=1, location=P(*center))
    c = bpy.context.object
    c.scale = (size[0], size[2], size[1])
    return c


def cutter_cyl(r, depth, center):
    bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=r, depth=depth, location=P(*center), rotation=(math.pi / 2, 0, 0))
    return bpy.context.object


def frame(group, cx, cy, cz, fw, fh, ry, material, prof):
    """壁に掛ける額(ry の向きの壁面に、幅 fw 高さ fh の内寸)"""
    ca, sa = math.cos(ry), math.sin(ry)
    loc = lambda dx, dy: (cx + ca * dx, cy + dy, cz - sa * dx)
    path = [loc(-fw / 2, -fh / 2), loc(fw / 2, -fh / 2), loc(fw / 2, fh / 2), loc(-fw / 2, fh / 2)]
    return sweep(group, path, prof, (sa, 0, ca), material, closed=True, center=(cx, cy, cz))


FRAME = [(0.0, -0.01), (0.0, 0.03), (0.03, 0.06), (0.07, 0.085), (0.11, 0.07), (0.14, 0.045), (0.17, 0.05), (0.19, 0.03), (0.19, -0.01)]
ARCHP = [(0.0, -0.01), (0.0, 0.06), (0.05, 0.09), (0.16, 0.09), (0.2, 0.06), (0.3, 0.04), (0.3, -0.01)]

# ---- 床・天井 ----
bm = bmesh.new()
bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=0.5)
bmesh.ops.scale(bm, vec=(RW, Z0 - ZEND, 1), verts=bm.verts[:])
bmesh.ops.translate(bm, verts=bm.verts[:], vec=P(0, 0, (Z0 + ZEND) / 2))
w.mesh_from_bmesh("floor", "floor", bm, M["floor"], smooth=False)

PALS = [
    [(0.03, 0.025, 0.02), (0.25, 0.14, 0.05), (0.6, 0.45, 0.22), (0.12, 0.16, 0.2)],
    [(0.02, 0.04, 0.07), (0.12, 0.22, 0.3), (0.65, 0.58, 0.42), (0.28, 0.12, 0.04)],
    [(0.07, 0.02, 0.015), (0.4, 0.1, 0.04), (0.8, 0.58, 0.3), (0.04, 0.04, 0.035)],
    [(0.03, 0.06, 0.03), (0.18, 0.3, 0.12), (0.62, 0.58, 0.32), (0.32, 0.24, 0.12)],
]

# ---- 仕切りの壁(アーチの戸口)----
DW, DH = 1.35, 2.6  # 戸口の半幅・アーチの付け根の高さ
TW = 0.6            # 壁の厚さ


def arch_wall(z, door):
    o = w.box("stone", (RW, H, TW), (0, H / 2, z), M["marble"])
    # 腰の黒大理石と幅木
    for sz in (-1, 1):
        w.box("stone", (RW - 0.02, 0.22, 0.05), (0, 0.11, z + sz * (TW / 2 + 0.02)), M["marble_d"])
    if door:
        cut(o, [cutter_box((DW * 2, DH + 0.01, TW + 0.4), (0, DH / 2 - 0.01, z)), cutter_cyl(DW, TW + 0.4, (0, DH, z))])
        pts = [(-DW, 0, 0), (-DW, DH, 0)] + [(-math.cos(a / 24 * math.pi) * DW, DH + math.sin(a / 24 * math.pi) * DW, 0) for a in range(1, 24)] + [(DW, DH, 0), (DW, 0, 0)]
        for sz in (-1, 1):
            zz = z + sz * TW / 2
            sweep("gold", [(x, y, zz) for x, y, _ in pts], ARCHP, (0, 0, sz), M["gold"], center=(0, DH, zz))
            # 要石
            w.box("stone", (0.36, 0.5, 0.14), (0, DH + DW + 0.2, zz + sz * 0.05), M["marble_d"])
            # 戸口の両脇の付け柱
            for sx in (-1, 1):
                fw, fh = 1.5, 1.9
                w.plane("art", fw, fh, (sx * 3.95, 2.9, zz + sz * 0.03), oldmaster(f"pw{z}{sz}{sx}", (sx * 3.95, 2.9, zz), fh, z + sx * 2.1 + sz), ry=0 if sz > 0 else math.pi)
                frame("gold", sx * 3.95, 2.9, zz + sz * 0.02, fw, fh, 0 if sz > 0 else math.pi, M["gold"], FRAME)
                w.light("AREA", (sx * 3.95, 4.3, zz + sz * 0.45), 30, (1.0, 0.8, 0.55), target=(sx * 3.95, 2.6, zz), shape="RECTANGLE", size=0.9, size_y=0.05)
                w.box("gold", (0.9, 0.05, 0.05), (sx * 3.95, 4.3, zz + sz * 0.4), M["gold"])
                w.box("stone", (0.5, H - 0.9, 0.12), (sx * (DW + 0.75), (H - 0.9) / 2, zz + sz * 0.06), M["marble"])
                w.box("gold", (0.6, 0.22, 0.18), (sx * (DW + 0.75), H - 1.0, zz + sz * 0.09), M["gold"])
                w.box("stone", (0.62, 0.3, 0.18), (sx * (DW + 0.75), 0.15, zz + sz * 0.09), M["marble_d"])
    return o


arch_wall(Z0 + TW / 2, False)
arch_wall(ZEND - TW / 2, False)
for k in range(1, ROOMS):
    arch_wall(-k * RD + RD / 2, True)

# ---- 部屋 ----
spots, walk = [], []
seed = [0.37]


def rnd():
    seed[0] = (seed[0] * 9301 + 0.49297) % 1.0
    return seed[0]


pidx = 0
for k in range(ROOMS):
    cz = -k * RD
    z0, z1 = cz - RD / 2, cz + RD / 2
    walk.append({"t": "rect", "x0": -RW / 2 + 0.7, "z0": z0 + 0.8, "x1": RW / 2 - 0.7, "z1": z1 - 0.8})
    if k:
        walk.append({"t": "rect", "x0": -DW + 0.35, "z0": z1 - 1.2, "x1": DW - 0.35, "z1": z1 + 1.2})
    for s in (-1, 1):
        xw = s * RW / 2
        ry = -s * math.pi / 2  # 内側を向く
        w.plane("walls", RD, H, (xw, H / 2, cz), WALLM[k], ry=ry)
        # 腰板(くるみ材)・上の笠木(金)・幅木(黒大理石)
        w.box("walls", (0.08, 1.1, RD), (xw - s * 0.04, 0.55, cz), M["walnut"])
        w.box("gold", (0.14, 0.07, RD), (xw - s * 0.08, 1.13, cz), M["gold"])
        w.box("stone", (0.12, 0.2, RD), (xw - s * 0.07, 0.1, cz), M["marble_d"])
        for q in range(5):  # 腰板の額縁(浮き彫り)
            pz = z0 + RD / 5 * (q + 0.5)
            frame("walls", xw - s * 0.08, 0.62, pz, RD / 5 - 0.5, 0.6, ry, M["walnut"], [(0, 0), (0, 0.025), (0.04, 0.025), (0.06, 0)])
        # 天井の蛇腹(段々)
        for dy, hh, dp, mm in ((H - 0.12, 0.24, 0.42, "plaster"), (H - 0.32, 0.16, 0.3, "plaster"), (H - 0.44, 0.08, 0.2, "gold"), (H - 0.52, 0.08, 0.14, "plaster")):
            w.box("gold" if mm == "gold" else "ceil", (dp, hh, RD), (xw - s * dp / 2, dy, cz), M[mm])
        # 付け柱(中央と両端)
        for pz in (cz, z0 + 0.45, z1 - 0.45):
            w.box("stone", (0.12, H - 1.9, 0.5), (xw - s * 0.06, 1.2 + (H - 1.9) / 2 - 0.05, pz), M["marble"])
            w.box("gold", (0.18, 0.28, 0.62), (xw - s * 0.09, H - 0.82, pz), M["gold"])
            w.box("stone", (0.18, 0.12, 0.6), (xw - s * 0.09, 1.2, pz), M["marble_d"])
        # 絵(金の額、上に絵画灯)
        for dz in (-2.5, 2.5):
            fw, fh = 1.6 + rnd() * 0.7, 1.2 + rnd() * 0.7
            px, pz, cy = xw - s * 0.05, cz + dz, 3.05
            w.plane("art", fw, fh, (px - s * 0.01, cy, pz), (oldmaster(f"paint{pidx}", (px, cy, pz), fh, pidx * 1.3 + 0.4) if pidx % 3 else painting(f"paint{pidx}", PALS[pidx % 4], pidx * 1.3 + 0.4)), ry=ry)
            frame("gold", px, cy, pz, fw, fh, ry, M["gold"], FRAME)
            w.box("gold", (0.05, 0.05, fw * 0.55), (xw - s * 0.4, cy + fh / 2 + 0.35, pz), M["gold"])
            w.box("gold", (0.3, 0.025, 0.025), (xw - s * 0.25, cy + fh / 2 + 0.37, pz), M["gold"])
            w.light("AREA", (xw - s * 0.42, cy + fh / 2 + 0.3, pz), 30, (1.0, 0.8, 0.55), target=(xw, cy - 0.25, pz),
                    shape="RECTANGLE", size=fw * 0.55, size_y=0.05)
            pidx += 1
    # 格天井
    w.plane("ceil", RW, RD, (0, H, cz), M["plaster"], face_up=True)
    ceil = w.groups["ceil"]["objs"][-1]
    for p in ceil.data.polygons:
        p.flip()
    for x in [-RW / 2 + 1.85 * i for i in range(1, 6)]:
        w.box("ceil", (0.22, 0.32, RD), (x, H - 0.16, cz), M["plaster2"])
        w.box("gold", (0.05, 0.03, RD), (x, H - 0.33, cz), M["gold"])
    for zz in [z0 + 1.65 * i for i in range(1, 7)]:
        w.box("ceil", (RW, 0.32, 0.22), (0, H - 0.16, zz), M["plaster2"])
        w.box("gold", (RW, 0.03, 0.05), (0, H - 0.33, zz), M["gold"])
    # 天窓(格天井の中央の 4 マス)と、その光
    w.box("glow", (3.4, 0.02, 3.2), (0, H - 0.02, cz + 0.0), M["sky"])
    w.light("AREA", (0, H - 0.4, cz), 420, (1.0, 0.95, 0.86), target=(0, 0, cz), shape="RECTANGLE", size=3.2, size_y=3.0)
    # シャンデリア
    cy = H - 1.9
    sweep("gold", [(0, cy + 0.02, cz), (0, H - 0.33, cz)], circle(0.025, 8), (1, 0, 0), M["gold"])
    for rr, yy, th in ((0.65, cy, 0.035), (0.38, cy + 0.42, 0.025), (0.2, cy - 0.18, 0.04)):
        sweep("gold", [(math.cos(a / 40 * 6.283) * rr, yy, cz + math.sin(a / 40 * 6.283) * rr) for a in range(40)], circle(th, 8), (0, 1, 0), M["gold"], closed=True)
    w.cyl("gold", 0.12, 0.05, 0.5, (0, cy - 0.05, cz), M["gold"], seg=16)
    w.cyl("gold", 0.0, 0.08, 0.2, (0, cy - 0.38, cz), M["gold"], seg=16)
    for a in range(10):
        t = a / 10 * 2 * math.pi
        ca, sa = math.cos(t), math.sin(t)
        arm = [(ca * rr, cy + 0.05 - 0.12 * math.sin(rr / 0.95 * math.pi), cz + sa * rr) for rr in [0.08 + i * 0.09 for i in range(10)]]
        arm.append((ca * 0.95, cy + 0.12, cz + sa * 0.95))
        sweep("gold", arm, circle(0.018, 6), (-sa, 0, ca), M["gold"])
        bx, bz = cz + sa * 0.95, ca * 0.95
        w.cyl("gold", 0.05, 0.025, 0.06, (bz, cy + 0.15, bx), M["gold"], seg=12)
        w.cyl("ceil", 0.018, 0.018, 0.16, (bz, cy + 0.26, bx), M["candle"], seg=8)
        w.cyl("glow", 0.0, 0.022, 0.07, (bz, cy + 0.38, bx), M["bulb"], seg=8)
        # 飾りの珠
        w.cyl("gold", 0.0, 0.02, 0.07, (ca * 0.65, cy - 0.06, cz + sa * 0.65), M["gold"], seg=8)
    w.light("POINT", (0, cy + 0.3, cz), 320, (1.0, 0.72, 0.42), shadow_soft_size=0.6)

    # 作品:1 部屋に 2 点。大理石の台座と、真鍮の柱に赤いビロードのロープ
    here = [i for i in (2 * k, 2 * k + 1) if i < N]
    for j, i in enumerate(here):
        x = 0 if len(here) == 1 else (2.5 if j else -2.5)
        z = cz - 1.2
        w.box("stone", (1.05, 0.12, 1.05), (x, 0.06, z), M["marble_d"])
        w.cyl("stone", 0.4, 0.46, 0.92, (x, 0.58, z), M["marble"], seg=40)
        for yy, rr in ((0.16, 0.5), (1.01, 0.44)):
            w.cyl("stone", rr, rr, 0.06, (x, yy, z), M["marble"], seg=40)
        w.box("stone", (0.98, 0.1, 0.98), (x, 1.09, z), M["marble_d"])
        posts = [(x - 0.98, z + 0.98), (x + 0.98, z + 0.98), (x + 0.98, z - 0.98), (x - 0.98, z - 0.98)]
        for px, pz in posts:
            w.cyl("gold", 0.025, 0.03, 0.9, (px, 0.47, pz), M["gold"], seg=12)
            w.cyl("gold", 0.15, 0.17, 0.05, (px, 0.025, pz), M["gold"], seg=20)
            bm = bmesh.new()
            bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=0.055)
            bmesh.ops.translate(bm, verts=bm.verts[:], vec=P(px, 0.95, pz))
            w.mesh_from_bmesh("gold", "knob", bm, M["gold"])
        for q in range(3):
            (ax, az), (bx, bz) = posts[q], posts[q + 1]
            rope = [(ax + (bx - ax) * t, 0.88 - 0.26 * math.sin(t * math.pi), az + (bz - az) * t) for t in [u / 16 for u in range(17)]]
            dx, dz = bx - ax, bz - az
            sweep("art", rope, circle(0.022, 8), (dz, 0, -dx), M["velvet"], smooth=True)
        w.light("SPOT", (x * 0.6, H - 0.5, z + 2.4), 700, (1.0, 0.9, 0.75), target=(x, 1.2, z),
                spot_size=math.radians(30), spot_blend=0.6, shadow_soft_size=0.15)
        w.spot(x=x, y=1.14, z=z, face=0, dist=3.6, r=1.45, lift=0.1)

# 入口の壁と奥の壁の大きな絵
for zz, ry in ((Z0 - 0.02, math.pi), (ZEND + 0.02, 0.0)):
    fw, fh = 3.2, 2.2
    w.plane("art", fw, fh, (0, 3.0, zz + (0.04 if ry == 0 else -0.04)), oldmaster(f"big{ry}", (0, 3.0, zz), fh, 7.7 + ry), ry=ry)
    frame("gold", 0, 3.0, zz + (0.03 if ry == 0 else -0.03), fw, fh, ry, M["gold"], [(a * 1.4, b * 1.3) for a, b in FRAME])
    w.light("AREA", (0, 4.8, zz + (0.9 if ry == 0 else -0.9)), 120, (1.0, 0.82, 0.58), target=(0, 2.6, zz), shape="RECTANGLE", size=2.6, size_y=0.1)
    # 両脇のコンソールと花瓶
    for sx in (-1, 1):
        cx = sx * 3.0
        dz = 0.3 if ry == 0 else -0.3
        w.box("stone", (1.3, 0.06, 0.5), (cx, 0.9, zz + dz), M["marble_d"])
        w.box("gold", (1.2, 0.12, 0.44), (cx, 0.81, zz + dz), M["gold"])
        for lx in (-0.5, 0.5):
            w.cyl("gold", 0.03, 0.02, 0.75, (cx + lx, 0.375, zz + dz), M["gold"], seg=10)
        prof = [(0.0, 0.0), (0.12, 0.0), (0.16, 0.08), (0.2, 0.25), (0.17, 0.4), (0.09, 0.5), (0.08, 0.58), (0.12, 0.62), (0.0, 0.62)]
        bm = bmesh.new()
        rings = []
        for rr, hh in prof:
            rings.append([bm.verts.new(P(cx + math.cos(a / 24 * 6.283) * rr, 0.93 + hh, zz + dz + math.sin(a / 24 * 6.283) * rr)) for a in range(24)])
        for i in range(len(rings) - 1):
            for a in range(24):
                bm.faces.new((rings[i][a], rings[i][(a + 1) % 24], rings[i + 1][(a + 1) % 24], rings[i + 1][a]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        w.mesh_from_bmesh("stone", "vase", bm, mat(f"porcelain{sx}{ry}", (0.06, 0.1, 0.3), rough=0.12, noise=0.3, noise_scale=6))

# 柔らかい環境光(壁の反射の代わり)
w.light("AREA", (0, H - 0.2, (Z0 + ZEND) / 2), 60, (1.0, 0.9, 0.78), target=(0, 0, (Z0 + ZEND) / 2), shape="RECTANGLE", size=RW - 1, size_y=Z0 - ZEND - 1)

w.extra.update({
    "title": "宮殿を改装した欧州の美術館",
    "tip": "アーチの戸口をくぐって、部屋から部屋へ奥に進みます。",
    "start": {"x": 0, "z": Z0 - 1.3, "yaw": 0, "pitch": -0.04},
    "walk": walk,
    "bg": "#1a120e",
    "exposure": 1.05,
    "hemi": ["#fff0dc", "#3a2a1c", 0.55],
    "spotColor": "#ffe6c0",
    "reflect": {"w": RW, "l": Z0 - ZEND, "z": (Z0 + ZEND) / 2, "opacity": 0.9},
    "palette": ["#f3e3c0", "#7a1a2a"],
})

if A.still:
    for ob in w.sc.objects:  # 面光源そのものは写さない
        if ob.type == "LIGHT":
            ob.visible_camera = False
    w.still(A.still, (0, 1.6, Z0 - 1.3), (0, 1.75, -10), lens=17)
    if A.still_only:
        os._exit(0)

w.export(A.out)
os._exit(0)
