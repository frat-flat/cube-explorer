"""RPG の森(夕暮れ)を Blender で組み、光を焼き込む。

    python3 tools/blender/rpg.py --out public/worlds/rpg.glb [--size 2048] [--samples 64] [--still still.png]

曲がりくねった小道の脇に苔むした祭壇。開いた宝箱の上にキューブが浮かび、足もとで魔法陣が光る。
低い夕日が木の葉の間から差し込み、地面にまだらの光を落とす。
"""
import json
import math
import os
import random
import sys

import bpy
import bmesh
from mathutils import Vector, noise

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from worldkit import P, World, args, emit, mat  # noqa: E402

A = args({"out": "rpg.glb"})
N = 4
rng = random.Random(7)


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
        elif isinstance(v, (int, float)) and sock.type == "VECTOR":
            sock.default_value = (v, v, v)
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

    def nrm(s):
        return s.node("ShaderNodeNewGeometry").outputs["Normal"]

    def attr(s, name):
        return s.node("ShaderNodeAttribute", attribute_name=name).outputs["Color"]

    def xyz(s, v):
        return s.node("ShaderNodeSeparateXYZ", {0: v}).outputs

    def comb(s, x, y, z):
        return s.node("ShaderNodeCombineXYZ", {0: x, 1: y, 2: z}).outputs[0]

    def vmul(s, v, k):
        return s.node("ShaderNodeVectorMath", {0: v, 1: k}, operation="MULTIPLY").outputs[0]

    def m(s, op, a, b=0.0, c=0.0, clamp=False):
        return s.node("ShaderNodeMath", {0: a, 1: b, 2: c}, operation=op, use_clamp=clamp).outputs[0]

    def noise(s, v, scale, detail=6.0, rough=0.5, dist=0.0):
        n = s.node("ShaderNodeTexNoise", {"Scale": scale, "Detail": detail, "Roughness": rough, "Distortion": dist})
        if v is not None:
            s.set(n.inputs["Vector"], v)
        return n.outputs["Fac"]

    def voronoi(s, v, scale, feature="F1", out="Distance"):
        n = s.node("ShaderNodeTexVoronoi", {"Scale": scale}, feature=feature)
        if v is not None:
            s.set(n.inputs["Vector"], v)
        return n.outputs[out]

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


def smooth(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


# ---- 小道とひらけた場所 ----
pts = [(math.sin(k * 0.85) * 4.2, 12 - k * 6.5) for k in range(N + 2)]


def catmull(ps, steps):
    ps = [ps[0]] + ps + [ps[-1]]
    out = []
    for i in range(1, len(ps) - 2):
        p0, p1, p2, p3 = ps[i - 1], ps[i], ps[i + 1], ps[i + 2]
        for s in range(steps):
            t = s / steps
            out.append(tuple(0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t * t
                                    + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t ** 3) for j in range(2)))
    out.append(ps[-2])
    return out


# 入口側に少し伸ばす
path = catmull([(0.0, 20.0)] + pts, 24)
alts = []  # 祭壇の中心と、小道の点
for i in range(N):
    px, pz = pts[i + 1]
    nx, nz = pts[i + 2][0] - pts[i][0], pts[i + 2][1] - pts[i][1]
    ln = math.hypot(nx, nz)
    tx, tz = nx / ln, nz / ln
    side = -1 if i % 2 == 0 else 1
    cx, cz = px - tz * side * 5.4, pz + tx * side * 5.4
    alts.append(((cx, cz), (px, pz)))
ZMIN, ZMAX = pts[-1][1] - 16, 30.0
XR = 32.0


def seg_dist(x, z, ax, az, bx, bz):
    dx, dz = bx - ax, bz - az
    t = max(0, min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz + 1e-9)))
    return math.hypot(x - ax - dx * t, z - az - dz * t)


def d_path(x, z):
    return min(seg_dist(x, z, *path[i], *path[i + 1]) for i in range(0, len(path) - 1))


def d_clear(x, z):
    d = 1e9
    for (cx, cz), (px, pz) in alts:
        d = min(d, math.hypot(x - cx, z - cz) - 2.6, seg_dist(x, z, px, pz, cx, cz) - 0.6)
    return d


def d_walk(x, z):
    return min(d_path(x, z), d_clear(x, z))


def height(x, z):
    d = d_walk(x, z)
    n = noise.noise(Vector((x * 0.08, z * 0.08, 0.3))) * 0.5 + 0.5
    n2 = noise.noise(Vector((x * 0.3, z * 0.3, 2.0)))
    return smooth(2.5, 12.0, d) * (0.4 + n * 2.2) + smooth(1.8, 4.0, d) * n2 * 0.15


w = World(samples=A.samples)
# 夕暮れの空(焼き込みの環境光)
wn = w.sc.world.node_tree
bg = wn.nodes["Background"]
grad = wn.nodes.new("ShaderNodeTexGradient")
tco = wn.nodes.new("ShaderNodeTexCoord")
sep = wn.nodes.new("ShaderNodeSeparateXYZ")
wn.links.new(tco.outputs["Generated"], sep.inputs[0])
wr = wn.nodes.new("ShaderNodeValToRGB")
wr.color_ramp.elements[0].position, wr.color_ramp.elements[0].color = 0.5, (0.9, 0.45, 0.25, 1)
wr.color_ramp.elements[1].position, wr.color_ramp.elements[1].color = 0.85, (0.18, 0.2, 0.45, 1)
wn.links.new(sep.outputs[2], wr.inputs[0])
wn.links.new(wr.outputs[0], bg.inputs["Color"])
bg.inputs["Strength"].default_value = 0.7

w.group("ground", A.size, rough=0.95)
w.group("bark", A.size, rough=0.9)
w.group("leaves", A.size, rough=0.75, vcol=True)
w.group("grass", A.size, rough=0.8, vcol=True)
w.group("stone", A.size, rough=0.85, vcol=True)
w.group("gold", A.size // 4, rough=0.3, metal=1.0)
w.group("sky", A.size // 2, unlit=True)
w.group("glow", bake=False)


# ---- 材質 ----
def ground_mat():
    g = NG("ground", rough=0.95)
    p = g.pos()
    mk = g.xyz(g.attr("mask"))  # R: 小道  G: ひらけた場所
    big = g.noise(p, 0.15, 4)
    fine = g.noise(p, 2.5, 8, 0.6)
    grass = g.ramp(g.m("ADD", g.m("MULTIPLY", big, 0.6), g.m("MULTIPLY", fine, 0.4)),
                   [(0.3, (0.03, 0.05, 0.012)), (0.5, (0.07, 0.11, 0.025)), (0.65, (0.12, 0.15, 0.04)), (0.8, (0.2, 0.19, 0.07))])
    litter = g.m("MULTIPLY_ADD", g.noise(p, 1.3, 6, 0.7), 3.0, -1.55, clamp=True)  # 落ち葉
    leafc = g.ramp(g.noise(p, 6.0, 2), [(0.3, (0.18, 0.07, 0.02)), (0.7, (0.32, 0.17, 0.05))])
    col = g.mix(litter, grass, leafc)
    peb = g.voronoi(g.vmul(p, 1.0), 9.0)
    dirt = g.ramp(g.m("ADD", g.m("MULTIPLY", fine, 0.7), g.m("MULTIPLY", peb, 0.5)),
                  [(0.25, (0.07, 0.045, 0.025)), (0.5, (0.16, 0.11, 0.06)), (0.75, (0.24, 0.18, 0.11))])
    edge = g.m("MULTIPLY_ADD", g.noise(p, 1.6, 4), 0.6, -0.3)
    pm = g.m("MULTIPLY_ADD", g.m("ADD", mk[0], edge), 2.2, -0.6, clamp=True)
    col = g.mix(pm, col, dirt)
    moss = g.ramp(fine, [(0.3, (0.05, 0.08, 0.015)), (0.7, (0.14, 0.17, 0.04))])
    cm = g.m("MULTIPLY_ADD", g.m("ADD", mk[1], edge), 2.0, -0.5, clamp=True)
    col = g.mix(cm, col, g.mix(g.m("MULTIPLY", g.noise(p, 0.8, 3), 1.0), dirt, moss))
    return g.out(col, bump=g.m("ADD", g.m("MULTIPLY", peb, g.m("MULTIPLY", pm, 0.6)), fine), strength=0.35, dist=0.05)


def bark_mat():
    g = NG("bark", rough=0.9)
    x, y, z = g.xyz(g.pos())
    v = g.comb(g.m("MULTIPLY", x, 6), g.m("MULTIPLY", y, 6), g.m("MULTIPLY", z, 0.8))
    fur = g.voronoi(v, 3.0, "DISTANCE_TO_EDGE")
    nz = g.noise(g.comb(x, y, g.m("MULTIPLY", z, 0.3)), 6.0, 8, 0.6)
    col = g.ramp(g.m("ADD", g.m("MULTIPLY", fur, 2.5), g.m("MULTIPLY", nz, 0.4)),
                 [(0.05, (0.012, 0.009, 0.007)), (0.3, (0.06, 0.045, 0.032)), (0.7, (0.13, 0.11, 0.085))])
    # 根もとの苔(上を向いた面と低い所)
    nzv = g.xyz(g.nrm())[2]
    moss = g.m("MULTIPLY_ADD", g.m("ADD", g.m("SUBTRACT", 1.6, z), g.m("MULTIPLY", g.noise(g.pos(), 1.5, 4), 1.5)), 0.8, g.m("MULTIPLY", nzv, 0.5), clamp=True)
    col = g.mix(g.m("MULTIPLY", moss, 0.85), col, g.mix(nz, (0.04, 0.08, 0.01), (0.12, 0.17, 0.03)))
    return g.out(col, bump=g.m("ADD", fur, g.m("MULTIPLY", nz, 0.3)), strength=0.6, dist=0.06)


def leaf_mat(name, c0, c1, c2):
    g = NG(name, rough=0.6)
    p = g.pos()
    cells = g.voronoi(g.vmul(p, 1.0), 4.5)
    big = g.noise(p, 0.6, 4)
    col = g.ramp(g.m("ADD", g.m("MULTIPLY", cells, 0.7), g.m("MULTIPLY", big, 0.6)), [(0.15, c0), (0.5, c1), (0.85, c2)])
    g.b.inputs["Subsurface Weight"].default_value = 0.0
    return g.out(col, bump=g.m("SUBTRACT", 1.0, cells), strength=1.0, dist=0.2)


def rock_mat():
    g = NG("rock", rough=0.85)
    p = g.pos()
    nz = g.noise(p, 1.8, 10, 0.65)
    cr = g.voronoi(p, 2.2, "DISTANCE_TO_EDGE")
    col = g.ramp(nz, [(0.3, (0.07, 0.07, 0.065)), (0.55, (0.17, 0.165, 0.15)), (0.75, (0.26, 0.25, 0.22))])
    up = g.xyz(g.nrm())[2]
    moss = g.m("MULTIPLY_ADD", g.m("ADD", up, g.m("MULTIPLY", g.noise(p, 2.5, 6), 0.9)), 3.0, -2.2, clamp=True)
    col = g.mix(moss, col, g.mix(nz, (0.04, 0.07, 0.012), (0.16, 0.2, 0.04)))
    return g.out(col, bump=g.m("ADD", nz, g.m("MULTIPLY_ADD", cr, 8, 0, clamp=True)), strength=0.5, dist=0.05)


def plank_mat():
    g = NG("plank", rough=0.7)
    x, y, z = g.xyz(g.pos())
    gr = g.noise(g.comb(g.m("MULTIPLY", g.m("ADD", x, y), 2), g.m("MULTIPLY", z, 40), 0.0), 1.0, 8, 0.6, 2.0)
    col = g.ramp(gr, [(0.2, (0.06, 0.03, 0.012)), (0.6, (0.17, 0.09, 0.035)), (0.9, (0.26, 0.15, 0.06))])
    return g.out(col, bump=gr, strength=0.3, dist=0.01)


def grass_mat():
    g = NG("grass", rough=0.7)
    t = g.xyz(g.attr("tip"))[0]
    nz = g.noise(g.pos(), 0.7, 3)
    base = g.mix(nz, (0.02, 0.045, 0.008), (0.04, 0.08, 0.012))
    tip = g.mix(nz, (0.1, 0.22, 0.03), (0.28, 0.3, 0.06))
    return g.out(g.mix(t, base, tip))


def sky_mat():
    """空のドーム:地平線は夕焼け、上は群青。薄い雲"""
    g = NG("skydome")
    p = g.pos()
    x, y, z = g.xyz(p)
    h = g.m("DIVIDE", z, 80.0)
    cl = g.noise(g.comb(g.m("MULTIPLY", x, 0.02), g.m("MULTIPLY", y, 0.02), g.m("MULTIPLY", z, 0.08)), 3.0, 6, 0.6)
    col = g.ramp(h, [(0.0, (1.0, 0.45, 0.16)), (0.08, (0.95, 0.38, 0.28)), (0.22, (0.42, 0.22, 0.42)), (0.5, (0.1, 0.1, 0.3)), (1.0, (0.03, 0.04, 0.12))])
    cm = g.m("MULTIPLY", g.m("MULTIPLY_ADD", cl, 3.0, -1.6, clamp=True), g.m("MULTIPLY_ADD", h, -2.5, 1.0, clamp=True))
    col = g.mix(g.m("MULTIPLY", cm, 0.7), col, (1.0, 0.55, 0.4))
    s = g.node("ShaderNodeEmission", {"Color": col, "Strength": 1.0})
    g.nt.links.new(s.outputs[0], g.nt.nodes["Material Output"].inputs[0])
    return g.mt


M = {
    "ground": ground_mat(),
    "bark": bark_mat(),
    "leaf": leaf_mat("leaf", (0.006, 0.02, 0.004), (0.025, 0.07, 0.01), (0.07, 0.15, 0.02)),
    "leaf2": leaf_mat("leaf2", (0.005, 0.016, 0.008), (0.018, 0.05, 0.022), (0.05, 0.11, 0.04)),
    "leaf3": leaf_mat("leaf3", (0.02, 0.025, 0.004), (0.07, 0.08, 0.012), (0.2, 0.17, 0.03)),
    "rock": rock_mat(),
    "plank": plank_mat(),
    "grass": grass_mat(),
    "sky": sky_mat(),
    "gold": mat("gold", (0.85, 0.6, 0.25), rough=0.3, metal=1.0, noise=0.2, noise_scale=20, bump=0.15),
    "stem": mat("stem", (0.7, 0.66, 0.55), rough=0.6, noise=0.1),
    "shine": emit("shine", (1.0, 0.75, 0.35), 8.0),
    "fly": emit("fly", (0.8, 1.0, 0.45), 10.0),
    "moon": emit("moon", (1.0, 0.95, 0.85), 6.0),
}
HUES = [(0.45, 0.95, 1.0), (0.75, 0.55, 1.0), (1.0, 0.85, 0.45)]
RUNE = [emit(f"rune{k}", c, 5.0) for k, c in enumerate(HUES)]
MUSH = [emit(f"mush{k}", c, 4.0) for k, c in enumerate([(0.35, 0.95, 1.0), (1.0, 0.4, 0.85), (1.0, 0.7, 0.3)])]

# ---- 地面(起伏。歩く所は平ら)----
GX, GZ = 2 * XR, ZMAX - ZMIN
bm = bmesh.new()
nx_, nz_ = 128, int(128 * GZ / GX)
bmesh.ops.create_grid(bm, x_segments=nx_, y_segments=nz_, size=0.5)
bmesh.ops.scale(bm, vec=(GX, GZ, 1), verts=bm.verts[:])
bmesh.ops.translate(bm, verts=bm.verts[:], vec=P(0, 0, (ZMAX + ZMIN) / 2))
cl = bm.loops.layers.color.new("mask")
vm = {}
for v in bm.verts:
    x, z = v.co.x, -v.co.y
    dp, dc = d_path(x, z), d_clear(x, z)
    v.co.z = height(x, z)
    vm[v.index] = (1 - smooth(0.7, 1.8, dp), 1 - smooth(-0.6, 1.2, dc))
for f in bm.faces:
    for lp in f.loops:
        a, b = vm[lp.vert.index]
        lp[cl] = (a, b, 0, 1)
ground = w.mesh_from_bmesh("ground", "ground", bm, M["ground"])


# ---- 木 ----
def blob(group, c, r, sq, material, sub=2, rough=0.3, seed=0.0):
    """ふくらんだ葉のかたまり(凸凹の球)"""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0)
    for v in bm.verts:
        n = v.co.normalized()
        d = 1 + rough * noise.noise(n * 1.8 + Vector((seed, seed * 1.3, 0))) + rough * 0.7 * noise.noise(n * 4.5 + Vector((0, seed, 3)))
        v.co = Vector((n.x * r * d, n.y * r * d, n.z * r * sq * d))
    bmesh.ops.translate(bm, verts=bm.verts[:], vec=P(*c))
    return w.mesh_from_bmesh(group, "blob", bm, material)


def tube(bm, pts_, radii, seg, lobes=0.0, seed=0.0):
    """点列に沿った筒(幹・枝)。lobes>0 で根張り"""
    rings = []
    for i, (p, r) in enumerate(zip(pts_, radii)):
        t = (pts_[min(i + 1, len(pts_) - 1)] - pts_[max(i - 1, 0)]).normalized()
        a = t.cross(Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))).normalized()
        b = t.cross(a).normalized()
        ring = []
        for k in range(seg):
            th = k / seg * 2 * math.pi
            rr = r * (1 + 0.12 * noise.noise(Vector((math.cos(th) * 2, math.sin(th) * 2, i * 0.4 + seed))))
            if lobes and i < 3:
                rr *= 1 + lobes * (3 - i) / 3 * (0.5 + 0.5 * math.sin(th * 5 + seed))
            ring.append(bm.verts.new(p + (a * math.cos(th) + b * math.sin(th)) * rr))
        rings.append(ring)
    for i in range(len(rings) - 1):
        for k in range(seg):
            bm.faces.new((rings[i][k], rings[i][(k + 1) % seg], rings[i + 1][(k + 1) % seg], rings[i + 1][k]))
    bm.faces.new(list(reversed(rings[-1])))


def broadleaf(x, z, h, s):
    """広葉樹:根張りのある曲がった幹、太い枝 4 本、葉のかたまり"""
    bm = bmesh.new()
    y0 = height(x, z) - 0.3
    lean = Vector((rng.uniform(-0.6, 0.6), rng.uniform(-0.6, 0.6), 0))
    base = P(x, y0, z)
    trunk = [base + Vector((0, 0, h * t)) + lean * t * t + Vector((noise.noise(Vector((t * 3, x, z))) * 0.25, noise.noise(Vector((z, t * 3, x))) * 0.25, 0)) for t in [i / 12 for i in range(13)]]
    r0 = 0.28 * s + h * 0.018
    tube(bm, trunk, [r0 * (1 - 0.65 * t) for t in [i / 12 for i in range(13)]], 14, lobes=0.6, seed=x)
    crowns = [trunk[-1] + Vector((0, 0, 0.6))]
    for k in range(4):
        t0 = rng.uniform(0.5, 0.8)
        p0 = trunk[int(t0 * 12)]
        a = k / 4 * 2 * math.pi + rng.uniform(-0.5, 0.5)
        L = rng.uniform(2.0, 3.5) * s
        d = Vector((math.cos(a), math.sin(a), rng.uniform(0.5, 1.0))).normalized()
        br = [p0 + d * L * u + Vector((0, 0, 0.6 * u * u * L * 0.3)) for u in [i / 5 for i in range(6)]]
        tube(bm, br, [r0 * 0.45 * (1 - 0.7 * u) for u in [i / 5 for i in range(6)]], 7, seed=k)
        crowns.append(br[-1])
    o = w.mesh_from_bmesh("bark", "tree", bm, M["bark"])
    lm = M[rng.choice(["leaf", "leaf", "leaf", "leaf2", "leaf3"])]
    far = d_walk(x, z) > 11
    for c in crowns:
        for q in range(1 if far else 3):
            off = Vector((rng.uniform(-1.2, 1.2), rng.uniform(-1.2, 1.2), rng.uniform(-0.4, 1.0))) * s
            cc = c + off
            blob("leaves", (cc.x, cc.z, -cc.y), rng.uniform(1.0, 1.7) * s * (1.4 if far else 1.0), 0.8, lm, rough=0.42, seed=rng.random() * 10)
    return o


def spruce(x, z, h, s):
    """針葉樹:まっすぐな幹と、ぎざぎざの円錐を重ねた枝葉"""
    bm = bmesh.new()
    y0 = height(x, z) - 0.3
    tr = [P(x, y0 + h * t, z) for t in [i / 8 for i in range(9)]]
    tube(bm, tr, [(0.22 * s + 0.01 * h) * (1 - 0.8 * t) for t in [i / 8 for i in range(9)]], 10, lobes=0.4, seed=z)
    w.mesh_from_bmesh("bark", "spruce", bm, M["bark"])
    tiers = 6
    for k in range(tiers):
        t = k / tiers
        y = y0 + h * (0.28 + 0.68 * t)
        r = (2.4 - 1.9 * t) * s
        bm = bmesh.new()
        seg = 18
        top = bm.verts.new(P(x, y + r * 1.25, z))
        ring = []
        for q in range(seg):
            a = q / seg * 2 * math.pi
            rr = r * (1 + (0.25 if q % 2 else -0.05) + 0.1 * noise.noise(Vector((a, k, x))))
            ring.append(bm.verts.new(P(x + math.cos(a) * rr, y - (0.35 if q % 2 else 0.1) * s, z + math.sin(a) * rr)))
        inner = [bm.verts.new(P(x + math.cos(q / seg * 6.283) * r * 0.3, y + 0.15, z + math.sin(q / seg * 6.283) * r * 0.3)) for q in range(seg)]
        for q in range(seg):
            bm.faces.new((top, ring[q], ring[(q + 1) % seg]))
            bm.faces.new((ring[q], inner[q], inner[(q + 1) % seg], ring[(q + 1) % seg]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        w.mesh_from_bmesh("leaves", "fir", bm, M["leaf2"], smooth=False)


trees = []
for a in range(4000):
    if len(trees) >= 72:
        break
    x, z = rng.uniform(-XR + 2, XR - 2), rng.uniform(ZMIN + 2, ZMAX - 2)
    d = d_walk(x, z)
    if d < 2.6 or any(math.hypot(x - tx, z - tz) < 3.2 for tx, tz, *_ in trees):
        continue
    if d > 16 and rng.random() < 0.6:
        continue
    trees.append((x, z, rng.uniform(8, 13) + min(d, 10) * 0.25, rng.uniform(0.85, 1.25), rng.random() < 0.3))
for x, z, h, s, con in trees:
    (spruce if con else broadleaf)(x, z, h, s)

# 倒木
for (x, z, a, L) in ((-6.5, 4.0, 0.4, 7), (8.0, -12.0, -0.8, 6)):
    bm = bmesh.new()
    y = height(x, z) + 0.2
    ps = [P(x + math.cos(a) * L * (u - 0.5), y + 0.05 * math.sin(u * 5), z + math.sin(a) * L * (u - 0.5)) for u in [i / 8 for i in range(9)]]
    tube(bm, ps, [0.38 - 0.12 * u for u in [i / 8 for i in range(9)]], 12, seed=x)
    w.mesh_from_bmesh("bark", "log", bm, M["bark"])

# 茂み・岩
for a in range(3000):
    x, z = rng.uniform(-XR + 2, XR - 2), rng.uniform(ZMIN + 2, ZMAX - 2)
    d = d_walk(x, z)
    if d < 1.0 or d > 10:
        continue
    if rng.random() < 0.97:
        continue
    s = rng.uniform(0.5, 1.1)
    blob("leaves", (x, height(x, z) + s * 0.25, z), s, 0.65, M[rng.choice(["leaf", "leaf2"])], sub=2, rough=0.35, seed=x)
rocks = 0
for a in range(3000):
    if rocks >= 30:
        break
    x, z = rng.uniform(-20, 20), rng.uniform(ZMIN + 4, ZMAX - 4)
    d = d_walk(x, z)
    if d < 1.4 or d > 12:
        continue
    s = rng.uniform(0.35, 1.3)
    blob("stone", (x, height(x, z) + s * 0.1, z), s, 0.6, M["rock"], sub=2, rough=0.35, seed=rng.random() * 50)
    rocks += 1

# 草むら(小道とひらけた場所のふち)
bm = bmesh.new()
tipl = bm.loops.layers.color.new("tip")
tuft = 0
for a in range(40000):
    if tuft >= 3400:
        break
    x, z = rng.uniform(-18, 18), rng.uniform(ZMIN + 4, ZMAX - 2)
    d = d_walk(x, z)
    if d < 0.9 or d > 9 or (d > 4 and rng.random() < 0.5):
        continue
    tuft += 1
    y = height(x, z) - 0.02
    for b in range(7):
        a2 = rng.uniform(0, 2 * math.pi)
        hh = rng.uniform(0.12, 0.38)
        lean = rng.uniform(0.04, 0.18)
        wd = 0.02
        bx, bz = x + rng.uniform(-0.12, 0.12), z + rng.uniform(-0.12, 0.12)
        ca, sa = math.cos(a2), math.sin(a2)
        v1 = bm.verts.new(P(bx - sa * wd, y, bz + ca * wd))
        v2 = bm.verts.new(P(bx + sa * wd, y, bz - ca * wd))
        v3 = bm.verts.new(P(bx + ca * lean * 0.5 + sa * wd * 0.5, y + hh * 0.55, bz + sa * lean * 0.5 - ca * wd * 0.5))
        v4 = bm.verts.new(P(bx + ca * lean * 0.5 - sa * wd * 0.5, y + hh * 0.55, bz + sa * lean * 0.5 + ca * wd * 0.5))
        v5 = bm.verts.new(P(bx + ca * lean, y + hh, bz + sa * lean))
        f1 = bm.faces.new((v1, v2, v3, v4))
        f2 = bm.faces.new((v4, v3, v5))
        for f in (f1, f2):
            for lp in f.loops:
                t = (lp.vert.co.z - y) / hh
                lp[tipl] = (t, t, t, 1)
w.mesh_from_bmesh("grass", "grass", bm, M["grass"], smooth=False)


# ---- 祭壇・宝箱・魔法陣 ----
def ring_mesh(group, cx, cz, y, r0, r1, material, seg=96):
    bm = bmesh.new()
    a = [bm.verts.new(P(cx + math.cos(k / seg * 6.283) * r0, y, cz + math.sin(k / seg * 6.283) * r0)) for k in range(seg)]
    b = [bm.verts.new(P(cx + math.cos(k / seg * 6.283) * r1, y, cz + math.sin(k / seg * 6.283) * r1)) for k in range(seg)]
    for k in range(seg):
        f = bm.faces.new((a[k], b[k], b[(k + 1) % seg], a[(k + 1) % seg]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    for f in bm.faces:
        if f.normal.z < 0:
            f.normal_flip()
    return w.mesh_from_bmesh(group, "ring", bm, material, smooth=False)


def strip(group, a, b, y, wd, material):
    """地面に寝かせた細い帯(a→b)"""
    dx, dz = b[0] - a[0], b[1] - a[1]
    L = math.hypot(dx, dz)
    w.plane(group, L, wd, ((a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2), material, ry=-math.atan2(dz, dx), face_up=True)


def octa(group, cx, cz, y0, h, r0, r1, material, ry):
    bm = bmesh.new()
    seg = 8
    lo = [bm.verts.new(P(cx + math.cos(k / seg * 6.283 + ry) * r0, y0, cz + math.sin(k / seg * 6.283 + ry) * r0)) for k in range(seg)]
    hi = [bm.verts.new(P(cx + math.cos(k / seg * 6.283 + ry) * r1, y0 + h, cz + math.sin(k / seg * 6.283 + ry) * r1)) for k in range(seg)]
    for k in range(seg):
        bm.faces.new((lo[k], lo[(k + 1) % seg], hi[(k + 1) % seg], hi[k]))
    bm.faces.new(hi)
    bm.faces.new(list(reversed(lo)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bmesh.ops.bevel(bm, geom=bm.edges[:], offset=0.03, segments=2, affect="EDGES")
    for v in bm.verts:  # 欠けと歪み
        v.co += Vector((noise.noise(v.co * 3) * 0.03, noise.noise(v.co * 3 + Vector((5, 0, 0))) * 0.03, 0))
    return w.mesh_from_bmesh(group, "altar", bm, material, smooth=False)


spots, walk = [], []
for i, ((cx, cz), (px, pz)) in enumerate(alts):
    ry = math.atan2(px - cx, pz - cz)  # 宝箱の正面を小道へ
    ca, sa = math.cos(ry), math.sin(ry)
    L = lambda lx, ly, lz: (cx + lx * ca + lz * sa, ly, cz - lx * sa + lz * ca)
    octa("stone", cx, cz, -0.05, 0.3, 1.75, 1.6, M["rock"], ry)
    octa("stone", cx, cz, 0.25, 0.3, 1.32, 1.2, M["rock"], ry + 0.39)
    # 宝箱
    w.box("stone", (1.0, 0.5, 0.66), L(0, 0.8, 0), M["plank"], ry=ry)
    for bx in (-0.36, 0.36):
        w.box("gold", (0.08, 0.52, 0.7), L(bx, 0.8, 0), M["gold"], ry=ry)
    w.box("gold", (1.04, 0.05, 0.7), L(0, 0.58, 0), M["gold"], ry=ry)
    w.box("gold", (0.14, 0.18, 0.04), L(0, 0.92, 0.34), M["gold"], ry=ry)
    w.box("glow", (0.92, 0.02, 0.58), L(0, 1.03, 0), M["shine"], ry=ry)
    # 開いたふた(半円筒を後ろの蝶番で開く)
    bm = bmesh.new()
    seg = 12
    hinge = Vector((0, 0.0, 0))
    rows = []
    for sx in (-0.5, 0.5):
        rows.append([Vector((sx, math.sin(k / seg * math.pi) * 0.33, -math.cos(k / seg * math.pi) * 0.33 + 0.33)) for k in range(seg + 1)])
    ang = -1.95
    vs = []
    for row in rows:
        rv = []
        for p in row:
            # ふたの付け根(後ろの上の縁)を軸に x 軸まわりに回す
            yy = p.y * math.cos(ang) - (p.z) * math.sin(ang)
            zz = p.y * math.sin(ang) + (p.z) * math.cos(ang)
            wx, wy, wz = L(p.x, 1.05 + yy, -0.33 + zz)
            rv.append(bm.verts.new(P(wx, wy, wz)))
        vs.append(rv)
    for k in range(seg):
        bm.faces.new((vs[0][k], vs[0][k + 1], vs[1][k + 1], vs[1][k]))
    bm.faces.new(vs[0])
    bm.faces.new(list(reversed(vs[1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.04)
    w.mesh_from_bmesh("stone", "lid", bm, M["plank"], smooth=False)
    w.light("POINT", L(0, 1.3, 0), 60, (1.0, 0.7, 0.35), shadow_soft_size=0.3)
    # 魔法陣(光る線)
    hue = RUNE[i % 3]
    hc = HUES[i % 3]
    y = 0.03
    for r0, r1 in ((2.02, 2.08), (2.4, 2.46), (2.95, 3.02)):
        ring_mesh("glow", cx, cz, y, r0, r1, hue)
    for k in range(2):
        for j in range(3):
            a0 = k * math.pi / 3 + j * 2 * math.pi / 3 + ry
            a1 = a0 + 2 * math.pi / 3
            pa = (cx + math.cos(a0) * 2.95, cz + math.sin(a0) * 2.95)
            pb = (cx + math.cos(a1) * 2.95, cz + math.sin(a1) * 2.95)
            strip("glow", pa, pb, y + 0.002, 0.045, hue)
    for j in range(28):  # ルーン文字の刻み
        a0 = j / 28 * 2 * math.pi
        for q in range(2):
            u0, u1 = rng.uniform(-0.05, 0.05), rng.uniform(-0.05, 0.05)
            r0, r1 = rng.uniform(2.5, 2.62), rng.uniform(2.72, 2.88)
            strip("glow", (cx + math.cos(a0 + u0) * r0, cz + math.sin(a0 + u0) * r0), (cx + math.cos(a0 + u1) * r1, cz + math.sin(a0 + u1) * r1), y + 0.004, 0.03, hue)
    for k in range(6):
        a0 = k / 6 * 2 * math.pi
        w.light("POINT", (cx + math.cos(a0) * 2.6, 0.25, cz + math.sin(a0) * 2.6), 25, hc, shadow_soft_size=0.3)
    # 苔むした立石 3 本
    for k in range(3):
        a0 = ry + math.pi + (k - 1) * 0.9
        sx, sz = cx + math.cos(a0) * 3.6, cz + math.sin(a0) * 3.6
        hh = rng.uniform(1.2, 1.9)
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.bevel(bm, geom=bm.edges[:], offset=0.08, segments=2, affect="EDGES")
        bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=2)
        for v in bm.verts:
            v.co = Vector((v.co.x * 0.55 * (1 - 0.2 * v.co.z), v.co.y * 0.35, (v.co.z + 0.5) * hh)) + Vector((noise.noise(v.co * 2.5 + Vector((k, i, 0))) * 0.07, noise.noise(v.co * 2.5 + Vector((0, k, i))) * 0.07, 0))
        bmesh.ops.rotate(bm, verts=bm.verts[:], cent=(0, 0, 0), matrix=__import__("mathutils").Matrix.Rotation(-a0 + 0.3, 3, "Z"))
        bmesh.ops.translate(bm, verts=bm.verts[:], vec=P(sx, height(sx, sz) - 0.1, sz))
        w.mesh_from_bmesh("stone", "menhir", bm, M["rock"], smooth=False)
    face = math.atan2(px - cx, pz - cz)
    w.spot(x=cx, y=1.75, z=cz, face=face, dist=3.7, r=1.9, scale=0.85, lift=0)
    walk.append({"t": "circ", "x": round(cx, 3), "z": round(cz, 3), "r": 3.4})
    for u in range(1, 6):  # 小道から祭壇へ
        walk.append({"t": "circ", "x": round(px + (cx - px) * u / 6, 3), "z": round(pz + (cz - pz) * u / 6, 3), "r": 1.3})
for k in range(0, len(path), 3):
    walk.append({"t": "circ", "x": round(path[k][0], 3), "z": round(path[k][1], 3), "r": 1.6})

# 光るキノコ
for a in range(4000):
    if a > 3999:
        break
    x, z = rng.uniform(-16, 16), rng.uniform(ZMIN + 4, ZMAX - 4)
    d = d_walk(x, z)
    if d < 0.7 or d > 3.5 or rng.random() < 0.985:
        continue
    k = rng.randrange(3)
    for q in range(3):
        s = rng.uniform(0.6, 1.4)
        ox, oz = x + rng.uniform(-0.25, 0.25), z + rng.uniform(-0.25, 0.25)
        y = height(ox, oz)
        w.cyl("stone", 0.03 * s, 0.04 * s, 0.24 * s, (ox, y + 0.12 * s, oz), M["stem"], seg=8)
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=6, radius=0.12 * s)
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -1e-4], context="VERTS")
        bmesh.ops.scale(bm, vec=(1, 1, 0.6), verts=bm.verts[:])
        bmesh.ops.translate(bm, verts=bm.verts[:], vec=P(ox, y + 0.23 * s, oz))
        w.mesh_from_bmesh("glow", "cap", bm, MUSH[k])
    w.light("POINT", (x, height(x, z) + 0.35, z), 5, [(0.35, 0.95, 1.0), (1.0, 0.4, 0.85), (1.0, 0.7, 0.3)][k], shadow_soft_size=0.2)

# 蛍
for k in range(70):
    q = path[rng.randrange(len(path))]
    x, z = q[0] + rng.uniform(-7, 7), q[1] + rng.uniform(-5, 5)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.025)
    bmesh.ops.translate(bm, verts=bm.verts[:], vec=P(x, height(x, z) + rng.uniform(0.5, 2.8), z))
    w.mesh_from_bmesh("glow", "fly", bm, M["fly"])

# 看板(CUBE FOREST)とランタン
SX, SZ = 2.4, 13.0
w.box("stone", (0.12, 1.9, 0.12), (SX, 0.95, SZ), M["plank"])
w.box("stone", (1.7, 0.6, 0.07), (SX, 1.6, SZ + 0.08), M["plank"])
bpy.ops.object.text_add(location=P(SX, 1.54, SZ + 0.12))
t = bpy.context.object
t.data.body = "CUBE FOREST"
t.data.size = 0.22
t.data.extrude = 0.012
t.data.align_x = "CENTER"
t.data.align_y = "CENTER"
t.rotation_euler = (math.pi / 2, 0, 0)
bpy.ops.object.convert(target="MESH")
t = bpy.context.object
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
w.add("stone", t, mat("carve", (0.025, 0.015, 0.008), rough=0.9))
w.box("stone", (0.5, 0.05, 0.05), (SX - 0.25, 1.95, SZ), M["plank"])
w.box("gold", (0.18, 0.26, 0.18), (SX - 0.45, 1.68, SZ), M["gold"])
w.box("glow", (0.12, 0.18, 0.12), (SX - 0.45, 1.68, SZ), M["shine"])
w.light("POINT", (SX - 0.45, 1.68, SZ + 0.2), 40, (1.0, 0.65, 0.3), shadow_soft_size=0.1)

# ---- 空のドームと月 ----
bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=24, radius=95)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -12], context="VERTS")
for f in bm.faces:
    f.normal_flip()
bmesh.ops.translate(bm, verts=bm.verts[:], vec=P(0, 0, (ZMAX + ZMIN) / 2))
sky = w.mesh_from_bmesh("sky", "sky", bm, M["sky"])
for k in ("visible_diffuse", "visible_glossy", "visible_shadow", "visible_transmission", "visible_volume_scatter"):
    setattr(sky, k, False)
bm = bmesh.new()
bmesh.ops.create_icosphere(bm, subdivisions=2, radius=3.0)
bmesh.ops.translate(bm, verts=bm.verts[:], vec=P(-40, 55, ZMIN - 50))
w.mesh_from_bmesh("glow", "moon", bm, M["moon"])

# ---- 夕日(低く、木の葉の間から)----
SUN_DIR = (-0.75, 0.32, -0.58)  # 太陽の方向(three 座標、太陽へ向かう向き)
w.light("SUN", (SUN_DIR[0] * 50, SUN_DIR[1] * 50, SUN_DIR[2] * 50), 4.5, (1.0, 0.55, 0.25), target=(0, 0, 0), angle=math.radians(1.5))

w.extra.update({
    "title": "RPGの森",
    "tip": "森の小道を進むと、祭壇の宝箱の上にキューブが浮かんでいます。",
    "start": {"x": 0, "z": 16.0, "yaw": 0, "pitch": -0.04},
    "walk": walk,
    "bg": "#2a2440",
    "fog": ["#3b3556", 0.03],
    "exposure": 1.1,
    "far": 220,
    "hemi": ["#8d9cff", "#22301a", 0.6],
    "sun": {"dir": list(SUN_DIR), "color": "#ffa868", "intensity": 1.1, "box": 40},
    "palette": ["#d8fbff", "#5a3aa8"],
    "glowCubes": True,
})

tri = {g: sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in v["objs"]) for g, v in w.groups.items()}
print("triangles", sum(tri.values()), tri, flush=True)
if A.still:
    for ob in w.sc.objects:
        if ob.type == "LIGHT":
            ob.visible_camera = False
    w.still(A.still, (0, 1.6, 16.0), (0.3, 1.5, 4), lens=18)
    if A.still_only:
        os._exit(0)

w.export(A.out)
# 空のドームは霧に沈めない
jp = os.path.splitext(A.out)[0] + ".json"
with open(jp) as f:
    info = json.load(f)
if "sky" in info["groups"]:
    info["groups"]["sky"]["nofog"] = True
with open(jp, "w") as f:
    json.dump(info, f, ensure_ascii=False, indent=1)
os._exit(0)
