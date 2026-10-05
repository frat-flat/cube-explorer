"""ゲームの世界(横に続くステージ)を Blender で組み、光を焼き込む。

    python3 tools/blender/game.py --out public/worlds/game.glb [--size 2048] [--samples 64] [--still still.png]

土管・？ブロック・レンガ・コイン・雲・丸い丘。形は遊び心のまま、質感と柔らかい日差しは上質な 3D ゲーム風に。
？ブロックの下に来るとブラウザ側でキューブが飛び出す(ブロックの位置は json の qblocks)。
"""
import json
import math
import os
import random
import sys

import bpy
import bmesh
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from worldkit import P, World, args, emit, mat  # noqa: E402

A = args({"out": "game.glb"})
N = 4
GAP = 7.0
L = max(1, N - 1) * GAP
X0, X1 = -14.0, L + 22
BY, BZ = 3.4, -1.0  # ？ブロックの高さと奥行き
rng = random.Random(5)


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

    def boxuv(s):
        """面の向きで座標を選ぶ(手続きテクスチャを箱の各面にまっすぐ貼る)"""
        x, y, z = s.xyz(s.pos())
        nx, ny, nz = [s.m("ABSOLUTE", c) for c in s.xyz(s.nrm())]
        side = s.m("GREATER_THAN", nx, 0.5)
        top = s.m("GREATER_THAN", nz, 0.5)
        u = s.m("ADD", s.m("MULTIPLY", x, s.m("SUBTRACT", 1.0, side)), s.m("MULTIPLY", y, side))
        v = s.m("ADD", s.m("MULTIPLY", z, s.m("SUBTRACT", 1.0, top)), s.m("MULTIPLY", y, top))
        return s.comb(u, v, 0.0)

    def out(s, color, bump=None, strength=0.2, dist=0.02, rough=None):
        s.set(s.b.inputs["Base Color"], color)
        if rough is not None:
            s.set(s.b.inputs["Roughness"], rough)
        if bump is not None:
            bn = s.node("ShaderNodeBump", {"Strength": strength, "Distance": dist, "Height": bump})
            s.nt.links.new(bn.outputs[0], s.b.inputs["Normal"])
        return s.mt


def brick_mat(name, c1, c2, mortar, scale=1.0):
    g = NG(name, rough=0.6)
    br = g.node("ShaderNodeTexBrick", {"Vector": g.boxuv(), "Color1": c1, "Color2": c2, "Mortar": mortar, "Scale": scale,
                                       "Mortar Size": 0.018, "Mortar Smooth": 0.3, "Brick Width": 0.5, "Row Height": 0.25}, offset=0.5)
    nz = g.noise(g.pos(), 9.0, 6)
    col = g.mix(g.m("MULTIPLY", nz, 0.3), br.outputs["Color"], (0.1, 0.03, 0.01))
    return g.out(col, bump=g.m("ADD", g.m("SUBTRACT", 1.0, br.outputs["Fac"]), g.m("MULTIPLY", nz, 0.15)), strength=0.5, dist=0.02)


def qblock_mat():
    g = NG("qblock", rough=0.35)
    nz = g.noise(g.pos(), 6.0, 4)
    col = g.mix(nz, (0.9, 0.3, 0.0), (1.0, 0.45, 0.02))
    return g.out(col, bump=nz, strength=0.05, dist=0.01)


def grass_top():
    g = NG("grasstop", rough=0.75)
    p = g.pos()
    x, y, _ = g.xyz(p)
    big = g.noise(p, 0.12, 3)
    fine = g.noise(p, 6.0, 6)
    # 刈り込みの縞(ゆるい市松)
    ch = g.m("MULTIPLY", g.m("SIGN", g.m("MULTIPLY", g.m("SINE", g.m("MULTIPLY", x, 0.9)), g.m("SINE", g.m("MULTIPLY", y, 0.9)))), 0.5)
    t = g.m("ADD", g.m("ADD", g.m("MULTIPLY", big, 0.7), g.m("MULTIPLY", fine, 0.25)), g.m("MULTIPLY", ch, 0.08))
    col = g.ramp(t, [(0.25, (0.05, 0.2, 0.02)), (0.5, (0.1, 0.36, 0.03)), (0.75, (0.22, 0.5, 0.06))])
    return g.out(col, bump=fine, strength=0.2, dist=0.03)


def dirt_mat():
    g = NG("dirt", rough=0.9)
    p = g.pos()
    _, _, z = g.xyz(p)
    band = g.noise(g.comb(g.m("MULTIPLY", g.xyz(p)[0], 0.15), 0.0, g.m("MULTIPLY", z, 2.5)), 1.0, 3, 0.5, 1.0)
    peb = g.voronoi(p, 3.0)
    pm = g.m("LESS_THAN", peb, 0.18)
    col = g.ramp(band, [(0.3, (0.22, 0.09, 0.03)), (0.55, (0.38, 0.17, 0.06)), (0.8, (0.5, 0.27, 0.1))])
    col = g.mix(pm, col, (0.55, 0.4, 0.25))
    return g.out(col, bump=g.m("ADD", g.m("MULTIPLY", pm, g.m("SUBTRACT", 0.2, peb)), g.m("MULTIPLY", g.noise(p, 8, 6), 0.05)), strength=0.6, dist=0.08)


def plastic(name, color, rough=0.3, var=0.06):
    g = NG(name, rough=rough)
    nz = g.noise(g.pos(), 2.0, 3)
    col = g.mix(nz, tuple(c * (1 - var) for c in color), tuple(min(1, c * (1 + var)) for c in color))
    return g.out(col)


def hill_mat(color):
    g = NG(f"hill{color}", rough=0.8)
    p = g.pos()
    dots = g.voronoi(p, 0.35)
    nz = g.noise(p, 0.3, 4)
    col = g.mix(nz, tuple(c * 0.8 for c in color), color)
    col = g.mix(g.m("LESS_THAN", dots, 0.22), col, tuple(c * 0.6 for c in color))
    return g.out(col)


def sky_mat():
    g = NG("skydome")
    _, _, z = g.xyz(g.pos())
    col = g.ramp(g.m("DIVIDE", z, 80.0), [(0.0, (0.75, 0.88, 1.0)), (0.25, (0.38, 0.62, 1.0)), (1.0, (0.12, 0.32, 0.85))])
    e = g.node("ShaderNodeEmission", {"Color": col, "Strength": 1.0})
    g.nt.links.new(e.outputs[0], g.nt.nodes["Material Output"].inputs[0])
    return g.mt


w = World(samples=A.samples)
w.sky((0.55, 0.72, 1.0), 0.9)

w.group("ground", A.size, rough=0.8)
w.group("blocks", A.size // 2, rough=0.4)
w.group("pipes", A.size // 2, rough=0.25)
w.group("deco", A.size, rough=0.7)
w.group("gold", A.size // 4, rough=0.22, metal=1.0)
w.group("sky", A.size // 2, unlit=True)

M = {
    "grass": grass_top(),
    "dirt": dirt_mat(),
    "brick": brick_mat("brick", (0.5, 0.15, 0.04), (0.62, 0.22, 0.06), (0.08, 0.035, 0.02)),
    "castle": brick_mat("castle", (0.55, 0.2, 0.07), (0.66, 0.28, 0.1), (0.1, 0.05, 0.03), scale=0.7),
    "q": qblock_mat(),
    "qmark": plastic("qmark", (0.95, 0.88, 0.7), rough=0.4),
    "rivet": plastic("rivet", (0.32, 0.12, 0.02), rough=0.4),
    "pipe": plastic("pipe", (0.04, 0.42, 0.06), rough=0.22, var=0.04),
    "pipein": plastic("pipein", (0.005, 0.04, 0.008), rough=0.5),
    "bush": hill_mat((0.12, 0.5, 0.06)),
    "hill": hill_mat((0.09, 0.4, 0.06)),
    "hill2": hill_mat((0.14, 0.48, 0.1)),
    "cloud": plastic("cloud", (0.92, 0.94, 0.97), rough=0.9, var=0.02),
    "pole": plastic("pole", (0.75, 0.78, 0.75), rough=0.3),
    "flag": plastic("flag", (0.05, 0.45, 0.08), rough=0.6),
    "door": plastic("door", (0.02, 0.012, 0.01), rough=0.9),
    "gold": mat("gold", (1.0, 0.66, 0.08), rough=0.2, metal=1.0, noise=0.05, noise_scale=10),
    "stem": plastic("stem", (0.1, 0.35, 0.05)),
    "sky": sky_mat(),
}
PETAL = [plastic(f"petal{k}", c, rough=0.5) for k, c in enumerate([(0.95, 0.95, 0.9), (0.95, 0.75, 0.05), (0.9, 0.12, 0.08)])]


# ---- 形の小道具 ----
def bbox(group, size, center, material, bevel=0.06, seg=3, ry=0.0):
    """角を丸めた箱"""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(size[0], size[2], size[1]), verts=bm.verts[:])
    if bevel:
        bmesh.ops.bevel(bm, geom=bm.edges[:], offset=bevel, segments=seg, affect="EDGES", profile=0.5)
    if ry:
        bmesh.ops.rotate(bm, verts=bm.verts[:], cent=(0, 0, 0), matrix=Matrix.Rotation(ry, 3, "Z"))
    bmesh.ops.translate(bm, verts=bm.verts[:], vec=P(*center))
    return w.mesh_from_bmesh(group, "bbox", bm, material, smooth=False)


def sphere(group, c, r, material, sq=1.0, seg=24):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=seg // 2, radius=r)
    bmesh.ops.scale(bm, vec=(1, 1, sq), verts=bm.verts[:])
    bmesh.ops.translate(bm, verts=bm.verts[:], vec=P(*c))
    return w.mesh_from_bmesh(group, "sphere", bm, material)


def tube(group, r, y0, y1, x, z, material, seg=40, bevel=0.0, cap=True):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=cap, segments=seg, radius1=r, radius2=r, depth=y1 - y0)
    if bevel:
        bmesh.ops.bevel(bm, geom=[e for e in bm.edges if not e.is_manifold or abs(e.verts[0].co.z - e.verts[1].co.z) < 1e-4], offset=bevel, segments=3, affect="EDGES")
    bmesh.ops.translate(bm, verts=bm.verts[:], vec=P(x, (y0 + y1) / 2, z))
    o = w.mesh_from_bmesh(group, "tube", bm, material)
    return o


def text(group, s, size, center, rz, material, depth=0.03, flat=False):
    bpy.ops.object.text_add(location=P(*center))
    t = bpy.context.object
    t.data.body = s
    t.data.size = size
    t.data.extrude = depth
    t.data.bevel_depth = 0.008
    t.data.align_x = "CENTER"
    t.data.align_y = "CENTER"
    t.rotation_euler = (0, 0, rz) if flat else (math.pi / 2, 0, rz)
    bpy.ops.object.convert(target="MESH")
    t = bpy.context.object
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return w.add(group, t, material)


# ---- 地面(草の厚板と土の層) ----
GW = X1 - X0 + 30
GX = (X0 + X1) / 2
ZF, ZB = 7.5, -10.5
bbox("ground", (GW, 2.6, ZF - ZB), (GX, -1.6, (ZF + ZB) / 2), M["dirt"], bevel=0.0)
bbox("ground", (GW + 0.1, 0.32, ZF - ZB + 0.12), (GX, -0.16, (ZF + ZB) / 2), M["grass"], bevel=0.12, seg=4)
# 草の縁の垂れ(前の面で波打つ)
for k in range(int(GW / 0.9)):
    x = X0 - 15 + k * 0.9 + 0.45
    sphere("ground", (x, -0.33, ZF + 0.02), 0.32, M["grass"], sq=0.6, seg=12)

# ---- ？ブロックとレンガ ----
QB = []


def brick(x, y, z):
    bbox("blocks", (1, 1, 1), (x, y, z), M["brick"], bevel=0.04, seg=2)


def qblock(x, y, z):
    bbox("blocks", (1, 1, 1), (x, y, z), M["q"], bevel=0.07, seg=3)
    for rz, (nx, nz) in ((0, (0, 1)), (math.pi / 2, (1, 0)), (math.pi, (0, -1)), (-math.pi / 2, (-1, 0))):
        text("blocks", "?", 0.78, (x + nx * 0.505, y - 0.02, z + nz * 0.505), rz, M["qmark"], depth=0.025)
        ux, uz = nz, -nx  # 面に沿う向き
        for a, b in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
            sphere("blocks", (x + nx * 0.5 + ux * a * 0.37, y + b * 0.37, z + nz * 0.5 + uz * a * 0.37), 0.045, M["rivet"], seg=10)
    text("blocks", "?", 0.78, (x, y + 0.505, z), 0, M["qmark"], depth=0.025, flat=True)


for i in range(N):
    x = i * GAP
    qblock(x, BY, BZ)
    QB.append({"x": x, "y": BY, "z": BZ})
    if i % 3 == 0:
        brick(x - 1, BY, BZ)
        brick(x + 1, BY, BZ)
    elif i % 3 == 2:
        for dx in (-1, 1, 2):
            brick(x + dx, BY, BZ)
    w.spot(x=x, y=BY + 0.5, z=BZ, face=0, dist=4.8, r=0.6, lift=0.1)
# 浮いたレンガの列
for i in range(N):
    if i % 2 == 0:
        for k in range(4):
            brick(i * GAP + 2 + k, 6.6, -5)


# ---- 土管 ----
def pipe(x, z, h):
    tube("pipes", 0.75, 0, h - 0.27, x, z, M["pipe"], cap=False)
    tube("pipes", 0.95, h - 0.27, h + 0.3, x, z, M["pipe"], bevel=0.05)
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=True, segments=40, radius=0.76)
    bmesh.ops.translate(bm, verts=bm.verts[:], vec=P(x, h + 0.302, z))
    w.mesh_from_bmesh("pipes", "hole", bm, M["pipein"], smooth=False)


for i in range(N):
    pipe(i * GAP + GAP / 2, -4.4, [1.6, 2.6, 2.0][i % 3])
pipe(-9, -4.4, 2.2)

# ---- コイン ----
coins = []


def coin(x, y, z):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=28, radius1=0.28, radius2=0.28, depth=0.08)
    bmesh.ops.bevel(bm, geom=[e for e in bm.edges if abs(e.verts[0].co.z - e.verts[1].co.z) < 1e-4], offset=0.025, segments=2, affect="EDGES")
    bmesh.ops.rotate(bm, verts=bm.verts[:], cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, "X"))
    bmesh.ops.translate(bm, verts=bm.verts[:], vec=P(x, y, z))
    w.mesh_from_bmesh("gold", "coin", bm, M["gold"])
    bbox("gold", (0.07, 0.3, 0.12), (x, y, z), M["gold"], bevel=0.02, seg=2)
    coins.append({"x": x, "y": y, "z": z})


for k in range(4):
    coin(-4 + k * 1.1, 1.25, 0.6)
for i in range(N - 1):
    for k in range(3):
        coin(i * GAP + 2.4 + k * 1.1, 1.25, 0.2 if i % 2 else 1.4)

# ---- 丘・茂み・雲・花 ----
x = X0 - 6
k = 0
while x < X1 + 10:
    s = 6 + rng.random() * 6
    sphere("deco", (x, -s * 0.25, -18 - rng.random() * 8), s, M["hill" if k % 2 else "hill2"], sq=0.8, seg=40)
    x += 13 + rng.random() * 6
    k += 1
x = X0
while x < X1:
    z = -3.2 - rng.random()
    for dx, s in ((-0.8, 0.75), (0, 1.05), (0.8, 0.75)):
        sphere("deco", (x + dx, 0.15, z), s, M["bush"], sq=0.85)
    x += 8 + rng.random() * 5
for k in range(9):
    cx, cy, cz = X0 + rng.random() * (X1 - X0), 9 + rng.random() * 5, -18 - rng.random() * 14
    for dx, dy, s in ((-1.2, 0, 1.1), (0, 0.4, 1.5), (1.2, 0, 1.1), (0.4, -0.3, 1.0), (-0.5, 0.5, 1.0)):
        sphere("deco", (cx + dx, cy + dy, cz), s, M["cloud"], sq=0.85, seg=20)
for k in range(60):
    fx, fz = rng.uniform(X0, X1), rng.choice([rng.uniform(5.8, 7.2), rng.uniform(-2.8, -2.4), rng.uniform(-6, -4)])
    tube("deco", 0.015, 0, 0.22, fx, fz, M["stem"], seg=6)
    pm = PETAL[k % 3]
    for a in range(5):
        t = a / 5 * 2 * math.pi
        sphere("deco", (fx + math.cos(t) * 0.05, 0.23, fz + math.sin(t) * 0.05), 0.045, pm, sq=0.5, seg=8)
    sphere("deco", (fx, 0.24, fz), 0.03, PETAL[1], seg=8)

# ---- ゴールの旗と城 ----
FX = L + 9
tube("deco", 0.08, 0.5, 9.0, FX, -2, M["pole"], seg=16)
sphere("deco", (FX, 9.1, -2), 0.26, M["flag"])
brick(FX, 0.5, -2)
bm = bmesh.new()
v = [bm.verts.new(P(FX - 0.08, 8.7, -2 + dz)) for dz in (-0.02, 0.02)]
t1 = bm.verts.new(P(FX - 1.7, 8.1, -2))
v2 = [bm.verts.new(P(FX - 0.08, 7.5, -2 + dz)) for dz in (-0.02, 0.02)]
bm.faces.new((v[0], t1, v2[0]))
bm.faces.new((v[1], v2[1], t1))
w.mesh_from_bmesh("deco", "flag", bm, M["flag"], smooth=False)
CX = L + 16
bbox("deco", (6, 4, 4), (CX, 2, -6), M["castle"], bevel=0.03, seg=1)
bbox("deco", (3, 2.4, 3), (CX, 5.2, -6), M["castle"], bevel=0.03, seg=1)
for kx in range(6):
    bbox("deco", (0.6, 0.6, 0.6), (CX - 2.5 + kx, 4.3, -4.2), M["castle"], bevel=0.03, seg=1)
    bbox("deco", (0.6, 0.6, 0.6), (CX - 2.5 + kx, 4.3, -7.8), M["castle"], bevel=0.03, seg=1)
for kx in range(3):
    bbox("deco", (0.6, 0.6, 0.6), (CX - 1 + kx, 6.7, -4.7), M["castle"], bevel=0.03, seg=1)
bbox("deco", (1.4, 1.6, 0.1), (CX, 0.8, -3.98), M["door"], bevel=0.0)
sphere("deco", (CX, 1.6, -3.98), 0.7, M["door"], sq=1.0, seg=24)
for wx in (-0.6, 0.6):
    bbox("deco", (0.4, 0.8, 0.1), (CX + wx, 5.2, -4.48), M["door"], bevel=0.0)

# ---- 空のドーム ----
bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=24, radius=110)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -15], context="VERTS")
for f in bm.faces:
    f.normal_flip()
bmesh.ops.translate(bm, verts=bm.verts[:], vec=P(GX, 0, -5))
sky = w.mesh_from_bmesh("sky", "sky", bm, M["sky"])
for k in ("visible_diffuse", "visible_glossy", "visible_shadow", "visible_transmission", "visible_volume_scatter"):
    setattr(sky, k, False)

# ---- 柔らかい日差し ----
SUN_DIR = (-0.33, 0.85, 0.42)
w.light("SUN", (SUN_DIR[0] * 50, SUN_DIR[1] * 50, SUN_DIR[2] * 50), 3.2, (1.0, 0.95, 0.85), target=(0, 0, 0), angle=math.radians(6))

w.extra.update({
    "title": "ゲームの世界",
    "tip": "？ブロックの下まで行くか、ブロックを指すとキューブが飛び出します。コインも拾えます。",
    "start": {"x": -7, "z": 5, "yaw": -0.38, "pitch": 0.12},
    "eye": 2.0,
    "walk": [{"t": "rect", "x0": X0 + 3, "z0": -2.6, "x1": L + 11, "z1": 5.6}],
    "bg": "#6aa8ff",
    "fog": ["#9cc8ff", 0.006],
    "exposure": 1.0,
    "far": 300,
    "hemi": ["#ffffff", "#7a9a5a", 0.8],
    "sun": {"dir": list(SUN_DIR), "color": "#fff4e0", "intensity": 1.2, "box": 40},
    "palette": ["#fff3b0", "#e5402a"],
    "qblocks": QB,
    "coins": coins,
})

tri = {g: sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in v["objs"]) for g, v in w.groups.items()}
print("triangles", sum(tri.values()), tri, flush=True)
if A.still:
    for ob in w.sc.objects:
        if ob.type == "LIGHT":
            ob.visible_camera = False
    w.sc.view_settings.look = "AgX - Punchy"
    w.still(A.still, (-7, 2.0, 5), (-3.3, 3.2, -4.3), lens=18)
    if A.still_only:
        os._exit(0)

w.export(A.out)
jp = os.path.splitext(A.out)[0] + ".json"
with open(jp) as f:
    info = json.load(f)
if "sky" in info["groups"]:
    info["groups"]["sky"]["nofog"] = True
with open(jp, "w") as f:
    json.dump(info, f, ensure_ascii=False, indent=1)
os._exit(0)
