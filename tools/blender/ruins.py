"""夕暮れの砂漠の巨大遺跡(石畳の参道の両側に、作品が巨大な石の遺跡として建つ)を Blender で組み、光を焼き込む。

    python3 tools/blender/ruins.py --out public/worlds/ruins.glb [--size 2048] [--samples 64] [--still still.png]

空は Nishita の夕空(太陽の向きは json の sun と同じ)。砂丘は参道の近く(細かい)と遠く(粗い)で組を分ける。
"""
import json
import math
import os
import random
import sys

import bpy  # noqa: F401 (bmesh より先に読む)
import bmesh
from mathutils import Euler, Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from worldkit import P, World, args, emit  # noqa: E402

A = args({"out": "ruins.glb"})
rnd = random.Random(5)
SC = 11                       # 作品の大きさ(倍)
N, STEP = 4, 55
SITES = [((1 if i % 2 else -1) * (38 + rnd.uniform(-2, 2)), -i * STEP) for i in range(N)]
ZEND = SITES[-1][1] - 50      # 参道の終わり(奥の神殿の前)
TOP = 4.8                     # 基壇の上面
SUN = (-0.8, 0.17, -0.45)    # three.js の向き(太陽のある方):左やや前の低い夕日
CZ = -60                      # 空と地面の中心

w = World(samples=A.samples)

w.group("sky", A.size // 2, unlit=True)
w.group("sand", A.size, rough=0.95)
w.group("dunes", A.size // 2, rough=0.95)
w.group("road", A.size, rough=0.85)
w.group("stone", A.size, rough=0.9)
w.group("cols", A.size, rough=0.9)
w.group("glow", bake=False)


def fbox(group, size, center, material, ry=0.0, taper=1.0):
    """bpy.ops を使わない箱。taper<1 で上がすぼまる"""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    for v in bm.verts:
        if v.co.z > 0:
            v.co.x *= taper
            v.co.y *= taper
    bmesh.ops.scale(bm, vec=(size[0], size[2], size[1]), verts=bm.verts)
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(ry, 3, "Z"), verts=bm.verts)
    bmesh.ops.translate(bm, vec=P(*center), verts=bm.verts)
    return w.mesh_from_bmesh(group, "box", bm, material, smooth=False)


def fcyl(group, r_top, r_bot, h, center, material, seg=24, caps=True, rx=0.0, rz=0.0, jag=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, segments=seg, radius1=r_bot, radius2=r_top, depth=h)
    if jag:  # 折れた上面をぎざぎざに
        for v in bm.verts:
            if v.co.z > 0:
                v.co.z += rnd.uniform(-jag, jag * 0.3)
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Euler((rx, 0, rz)).to_matrix(), verts=bm.verts)
    bmesh.ops.translate(bm, vec=P(*center), verts=bm.verts)
    return w.mesh_from_bmesh(group, "cyl", bm, material)


def rubble(group, size, center, material, rot=(0, 0, 0), jit=0.06):
    """角の欠けた石塊:細かく割ってずらす"""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=2, use_grid_fill=True)
    for v in bm.verts:
        corner = sum(abs(c) > 0.49 for c in v.co)
        v.co *= 1 - (corner == 3) * rnd.uniform(0.0, 0.18)
        v.co += Vector((rnd.uniform(-jit, jit), rnd.uniform(-jit, jit), rnd.uniform(-jit, jit)))
    bmesh.ops.scale(bm, vec=(size[0], size[2], size[1]), verts=bm.verts)
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Euler(rot).to_matrix(), verts=bm.verts)
    bmesh.ops.translate(bm, vec=P(*center), verts=bm.verts)
    return w.mesh_from_bmesh(group, "rubble", bm, material, smooth=False)


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


def math_node(nt, op, a, b=None):
    m = nt.nodes.new("ShaderNodeMath")
    m.operation = op
    for k, v in enumerate((a, b)):
        if v is None:
            continue
        if isinstance(v, (int, float)):
            m.inputs[k].default_value = v
        else:
            nt.links.new(v, m.inputs[k])
    return m.outputs[0]


def bump(nt, bsdf, height, strength, dist=0.1):
    b = nt.nodes.new("ShaderNodeBump")
    b.inputs["Strength"].default_value = strength
    b.inputs["Distance"].default_value = dist
    nt.links.new(height, b.inputs["Height"])
    nt.links.new(b.outputs["Normal"], bsdf.inputs["Normal"])
    return b


def wall_uv(nt):
    """壁は (x+y, 高さ)、上を向く面は (x, y) を石積みの模様の座標にする"""
    p = pos(nt)
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(p, sep.inputs[0])
    side = nt.nodes.new("ShaderNodeCombineXYZ")
    nt.links.new(math_node(nt, "ADD", sep.outputs["X"], sep.outputs["Y"]), side.inputs["X"])
    nt.links.new(sep.outputs["Z"], side.inputs["Y"])
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    ns = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(geo.outputs["Normal"], ns.inputs[0])
    up = math_node(nt, "GREATER_THAN", math_node(nt, "ABSOLUTE", ns.outputs["Z"]), 0.6)
    mv = nt.nodes.new("ShaderNodeMix")
    mv.data_type = "VECTOR"
    nt.links.new(up, mv.inputs["Factor"])
    nt.links.new(side.outputs[0], mv.inputs[4])
    nt.links.new(p, mv.inputs[5])
    return mv.outputs[1], up, sep.outputs["Z"]


def sandstone(name, base, joints=(2.4, 1.2), dust=True):
    """風化した砂岩:石積みの目地・侵食の凹凸・根元の黒ずみ・上面に積もった砂"""
    m, nt = nodes(name)
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.92
    vec, up, z = wall_uv(nt)
    p = pos(nt)
    ero = noise(nt, p, 1.6, 10, 0.62)
    fine = noise(nt, p, 14, 6, 0.6)
    col = ramp(nt, ero, [(0.3, tuple(c * 0.72 for c in base)), (0.55, base), (0.75, tuple(min(1, c * 1.15) for c in base))])
    height = math_node(nt, "MULTIPLY", fine, 0.3)
    if joints:
        br = nt.nodes.new("ShaderNodeTexBrick")
        br.offset = 0.5
        br.inputs["Scale"].default_value = 1.0
        br.inputs["Brick Width"].default_value = joints[0]
        br.inputs["Row Height"].default_value = joints[1]
        br.inputs["Mortar Size"].default_value = 0.035
        br.inputs["Mortar Smooth"].default_value = 0.5
        br.inputs["Color1"].default_value = (0.74, 0.72, 0.7, 1)
        br.inputs["Color2"].default_value = (1.12, 1.06, 1.0, 1)
        br.inputs["Mortar"].default_value = (0.45, 0.42, 0.4, 1)
        nt.links.new(vec, br.inputs["Vector"])
        col = mix(nt, 1.0, col, br.outputs["Color"], "MULTIPLY")
        height = math_node(nt, "SUBTRACT", height, br.outputs["Fac"])
    height = math_node(nt, "ADD", height, ero)
    # 根元(地面から 1.5m)の黒ずみ
    zz = nt.nodes.new("ShaderNodeMapRange")
    zz.inputs["From Max"].default_value = 1.5
    nt.links.new(z, zz.inputs["Value"])
    col = mix(nt, 1.0, col, ramp(nt, zz.outputs[0], [(0.0, (0.7, 0.62, 0.55)), (1.0, (1, 1, 1))]), "MULTIPLY")
    if dust:  # 上を向く面に積もった砂
        sm = nt.nodes.new("ShaderNodeSeparateColor")
        nt.links.new(ramp(nt, noise(nt, p, 0.6, 3), [(0.4, (0, 0, 0)), (0.6, (1, 1, 1))]), sm.inputs[0])
        col = mix(nt, math_node(nt, "MULTIPLY", up, sm.outputs[0]), col, (0.62, 0.42, 0.24))
    nt.links.new(col, bsdf.inputs["Base Color"])
    bump(nt, bsdf, height, 0.6, 0.06)
    return m


def sand_mat(name, base, ripple=True):
    m, nt = nodes(name)
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.95
    p = pos(nt)
    big = noise(nt, p, 0.02, 4)
    mid = noise(nt, p, 0.3, 6)
    col = ramp(nt, big, [(0.3, tuple(c * 0.85 for c in base)), (0.7, tuple(min(1, c * 1.08) for c in base))])
    col = mix(nt, 0.4, col, ramp(nt, mid, [(0.3, (0.82, 0.8, 0.78)), (0.7, (1, 1, 1))]), "MULTIPLY")
    nt.links.new(col, bsdf.inputs["Base Color"])
    if ripple:  # 風紋
        wv = nt.nodes.new("ShaderNodeTexWave")
        wv.wave_type = "BANDS"
        wv.bands_direction = "DIAGONAL"
        wv.inputs["Scale"].default_value = 0.35
        wv.inputs["Distortion"].default_value = 6
        wv.inputs["Detail"].default_value = 2
        wv.inputs["Detail Scale"].default_value = 0.6
        nt.links.new(p, wv.inputs["Vector"])
        bump(nt, bsdf, wv.outputs["Fac"], 0.35, 0.1)
    return m


def strata_mat(name):
    """遠くの台地:赤い地層の縞"""
    m, nt = nodes(name)
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 1.0
    p = pos(nt)
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(p, sep.inputs[0])
    n = noise(nt, p, 0.04, 4)
    v = math_node(nt, "ADD", math_node(nt, "MULTIPLY", n, 18.0), sep.outputs["Z"])
    s = math_node(nt, "SINE", math_node(nt, "MULTIPLY", v, 0.45))
    t = math_node(nt, "ADD", math_node(nt, "MULTIPLY", s, 0.5), 0.5)
    col = ramp(nt, t, [(0.0, (0.4, 0.2, 0.1)), (0.5, (0.47, 0.25, 0.13)), (1.0, (0.55, 0.33, 0.19))])
    nt.links.new(col, bsdf.inputs["Base Color"])
    return m


def paving():
    """参道の敷石(砂がところどころ積もる)"""
    m, nt = nodes("paving")
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.85
    p = pos(nt)
    br = nt.nodes.new("ShaderNodeTexBrick")
    br.offset = 0.5
    br.inputs["Scale"].default_value = 1.0
    br.inputs["Brick Width"].default_value = 2.0
    br.inputs["Row Height"].default_value = 1.0
    br.inputs["Mortar Size"].default_value = 0.03
    br.inputs["Mortar Smooth"].default_value = 0.4
    br.inputs["Color1"].default_value = (0.5, 0.38, 0.25, 1)
    br.inputs["Color2"].default_value = (0.62, 0.48, 0.33, 1)
    br.inputs["Mortar"].default_value = (0.35, 0.25, 0.16, 1)
    nt.links.new(p, br.inputs["Vector"])
    ero = noise(nt, p, 2.0, 8)
    col = mix(nt, 0.5, br.outputs["Color"], ramp(nt, ero, [(0.3, (0.7, 0.7, 0.7)), (0.7, (1, 1, 1))]), "MULTIPLY")
    drift = ramp(nt, noise(nt, p, 0.12, 6), [(0.5, (0, 0, 0)), (0.62, (1, 1, 1))])
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(drift, sep.inputs[0])
    col = mix(nt, sep.outputs[0], col, (0.62, 0.43, 0.25))
    nt.links.new(col, bsdf.inputs["Base Color"])
    h = math_node(nt, "SUBTRACT", math_node(nt, "MULTIPLY", ero, 0.4), br.outputs["Fac"])
    bump(nt, bsdf, h, 0.5, 0.03)
    return m


def sun_angles(d):
    dx, dy, dz = d
    return math.atan2(dy, math.hypot(dx, dz)), math.atan2(dx, -dz)


def sky_node(nt, disc):
    s = nt.nodes.new("ShaderNodeTexSky")
    s.sky_type = "NISHITA"
    s.sun_elevation, s.sun_rotation = sun_angles(SUN)
    s.sun_disc = disc
    s.sun_size = math.radians(2.0)
    s.air_density = 1.4
    s.dust_density = 3.0
    s.ozone_density = 1.5
    return s


def sky_dome_mat(strength):
    """見える空:夕焼けの Nishita + 高い薄雲(夕日に染まる)"""
    m, nt = nodes("sky")
    nt.nodes.remove(nt.nodes["Principled BSDF"])
    nrm = nt.nodes.new("ShaderNodeVectorMath")
    nrm.operation = "NORMALIZE"
    nt.links.new(pos(nt), nrm.inputs[0])
    s = sky_node(nt, True)
    nt.links.new(nrm.outputs[0], s.inputs[0])
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(nrm.outputs[0], sep.inputs[0])
    div = nt.nodes.new("ShaderNodeVectorMath")
    div.operation = "DIVIDE"
    nt.links.new(nrm.outputs[0], div.inputs[0])
    cz = nt.nodes.new("ShaderNodeCombineXYZ")
    zz = math_node(nt, "ADD", sep.outputs["Z"], 0.1)
    for k in ("X", "Y", "Z"):
        nt.links.new(zz, cz.inputs[k])
    nt.links.new(cz.outputs[0], div.inputs[1])
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (1.0, 3.0, 1.0)  # 横に流れる筋雲
    nt.links.new(div.outputs[0], mp.inputs["Vector"])
    cl = noise(nt, mp.outputs["Vector"], 0.7, 8, 0.6)
    cm = ramp(nt, cl, [(0.5, (0, 0, 0)), (0.72, (1, 1, 1))])
    band = ramp(nt, sep.outputs["Z"], [(0.0, (0, 0, 0)), (0.06, (0.6, 0.6, 0.6)), (0.5, (0.35, 0.35, 0.35)), (0.9, (0, 0, 0))])
    k = mix(nt, 1.0, cm, band, "MULTIPLY")
    sk = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(k, sk.inputs[0])
    tint = ramp(nt, sep.outputs["Z"], [(0.0, (1.35, 0.78, 0.5)), (0.2, (1.05, 0.82, 0.75)), (0.6, (0.78, 0.8, 1.0))])
    warm = mix(nt, 1.0, s.outputs["Color"], tint, "MULTIPLY")  # 地平は橙、上は群青に寄せる
    skyc = mix(nt, sk.outputs[0], warm, (3.2, 1.5, 0.8))
    below = ramp(nt, sep.outputs["Z"], [(0.0, (1, 1, 1)), (0.0001, (0, 0, 0))])
    fin = mix(nt, below, skyc, (2.6, 1.5, 0.9))
    e = nt.nodes.new("ShaderNodeEmission")
    e.inputs["Strength"].default_value = strength
    nt.links.new(fin, e.inputs["Color"])
    nt.links.new(e.outputs[0], nt.nodes["Material Output"].inputs[0])
    return m


# 光を集める空(太陽の円盤は消し、太陽は SUN ランプで)
wn = w.sc.world.node_tree
wt = wn.nodes.new("ShaderNodeMix")
wt.data_type, wt.blend_type = "RGBA", "MULTIPLY"
wt.inputs["Factor"].default_value = 1.0
wt.inputs["B"].default_value = (1.0, 0.75, 0.6, 1)
wn.links.new(sky_node(wn, False).outputs["Color"], wt.inputs["A"])
wn.links.new(wt.outputs["Result"], wn.nodes["Background"].inputs["Color"])
wn.nodes["Background"].inputs["Strength"].default_value = 0.25

M = {
    "stone": sandstone("stone", (0.62, 0.45, 0.28)),
    "stone2": sandstone("stone2", (0.55, 0.4, 0.26), joints=(3.2, 1.6)),
    "col": sandstone("col", (0.64, 0.48, 0.31), joints=None),
    "rubble": sandstone("rubble", (0.58, 0.42, 0.27), joints=None),
    "sand": sand_mat("sand", (0.66, 0.45, 0.26)),
    "dune": sand_mat("dune", (0.64, 0.43, 0.25), ripple=False),
    "mesa": strata_mat("mesa"),
    "paving": paving(),
    "dark": sandstone("dark", (0.08, 0.06, 0.045), joints=None, dust=False),
    "fire": emit("fire", (1.0, 0.45, 0.12), 12.0),
    "ember": emit("ember", (1.0, 0.25, 0.05), 6.0),
}


# ---- 地形:参道の近くは平ら、外へ行くほど大きな砂丘 ----
def clamp(v):
    return max(0.0, min(1.0, v))


def ground(x, z):
    f = clamp((abs(x) - 58) / 50)
    for sx, sz in SITES:
        f = min(f, clamp((math.hypot(x - sx, z - sz) - 30) / 30))
    f = max(f, clamp((ZEND - 30 - z) / 60), clamp((z - 80) / 60)) if abs(x) > 40 else f
    small = clamp((abs(x) - 9) / 8) * 0.22 * (math.sin(x * 0.21) + math.cos(z * 0.17 + x * 0.05))
    dunes = ((math.sin(x * 0.035) + math.cos(z * 0.03 + x * 0.012)) * 4 + math.sin((x - z) * 0.07) * 1.6 + 7) * f
    r = clamp((abs(x) - 140) / 260) + clamp((-z + ZEND - 120) / 300) + clamp((z - 140) / 300)
    far = (math.sin(x * 0.011 + z * 0.006) + math.cos(z * 0.009 - x * 0.004) + 2) * 9 * min(1.0, r)
    return small + dunes + far


def axis(lo_f, hi_f, lo, hi, fine, coarse):
    vals = [lo_f + k * fine for k in range(int((hi_f - lo_f) / fine) + 1)]
    v = lo_f
    while v > lo:
        v -= coarse
        vals.insert(0, max(v, lo))
    v = hi_f
    while v < hi:
        v += coarse
        vals.append(min(v, hi))
    return vals


XS = axis(-110, 110, -620, 620, 2.5, 16)
ZS = axis(-270, 80, CZ - 620, CZ + 620, 2.5, 16)
bms = {"sand": bmesh.new(), "dunes": bmesh.new()}
vids = {}
for key in bms:
    vids[key] = {}
for i in range(len(XS) - 1):
    for j in range(len(ZS) - 1):
        cx, cz = (XS[i] + XS[i + 1]) / 2, (ZS[j] + ZS[j + 1]) / 2
        if math.hypot(cx, cz - CZ) > 820:  # 空のドームの外は作らない
            continue
        key = "sand" if (-110 < cx < 110 and -270 < cz < 80) else "dunes"
        bm, vd = bms[key], vids[key]
        vs = []
        for a, b in ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)):
            if (a, b) not in vd:
                vd[(a, b)] = bm.verts.new(P(XS[a], ground(XS[a], ZS[b]), ZS[b]))
            vs.append(vd[(a, b)])
        bm.faces.new(vs)
for key, bm in bms.items():
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    for f in bm.faces:
        if f.normal.z < 0:
            f.normal_flip()
    w.mesh_from_bmesh(key, key, bm, M["sand" if key == "sand" else "dune"])

# ---- 参道の敷石(区切って解像度を保つ) ----
for z in range(70, int(ZEND) - 12, -24):
    z1 = max(z - 24, ZEND - 12)
    fbox("road", (14, 0.3, z - z1), (0, -0.1, (z + z1) / 2), M["paving"])
    for s in (-1, 1):  # 縁石
        fbox("road", (0.6, 0.45, z - z1), (s * 7.3, -0.05, (z + z1) / 2), M["stone"])


# ---- 塔門(入口と奥の神殿) ----
def pylon_gate(zc, half_open, pw, ph, depth, lint_h):
    for s in (-1, 1):
        cx = s * (half_open + 2 + pw / 2)
        fbox("stone", (pw, ph, depth), (cx, ph / 2 - 0.5, zc), M["stone2"], taper=0.86)
        fbox("stone", (pw * 0.9, 1.0, depth * 0.9 + 0.8), (cx, ph - 0.1, zc), M["stone"])  # 軒の張り出し
        fbox("stone", (pw * 0.95, 0.4, depth * 0.95 + 0.4), (cx, ph - 0.8, zc), M["stone"])
        fbox("stone", (2.2, lint_h, depth * 0.7), (s * (half_open + 1.1), lint_h / 2 - 0.5, zc), M["stone"])  # 門柱
    fbox("stone", (2 * half_open + 5.5, 2.2, depth * 0.7), (0, lint_h + 0.6, zc), M["stone"])  # まぐさ石
    fbox("stone", (2 * half_open + 6.5, 0.6, depth * 0.75), (0, lint_h + 2.0, zc), M["stone"])


pylon_gate(28, 9, 12, 17, 6, 12)
fbox("stone", (40, 0.6, 14), (0, 0.0, 28), M["stone"])
# 奥の神殿:大きな塔門と、その後ろの列柱室の壁
pylon_gate(ZEND - 12, 7, 24, 27, 9, 17)
fbox("stone", (80, 1.2, 20), (0, 0.1, ZEND - 12), M["stone"])
fbox("stone", (60, 16, 40), (0, 7.5, ZEND - 40), M["stone2"])
fbox("stone", (13, 17, 1.0), (0, 8, ZEND - 16.2), M["dark"])  # 門の奥の暗がり
# オベリスク(入口の前に一対)
for s in (-1, 1):
    fbox("cols", (3.4, 1.2, 3.4), (s * 11.5, 0.4, 36), M["stone"])
    fbox("cols", (2.0, 16, 2.0), (s * 11.5, 9, 36), M["col"], taper=0.7)
    fbox("cols", (1.4, 1.6, 1.4), (s * 11.5, 17.7, 36), M["col"], taper=0.02)


# ---- 参道の列柱(ところどころ折れ、ドラムが転がる) ----
def column(x, z, broken):
    fbox("cols", (2.6, 0.6, 2.6), (x, 0.1, z), M["stone"])
    fcyl("cols", 1.1, 1.15, 0.4, (x, 0.6, z), M["col"])
    n = rnd.randint(1, 4) if broken else 7
    y = 0.8
    for k in range(n):
        r0 = 0.95 - k * 0.012
        last = broken and k == n - 1
        fcyl("cols", r0 - 0.012, r0, 1.35, (x, y + 0.675, z), M["col"], seg=20, rz=rnd.uniform(0, 1), jag=0.45 if last else 0.0)
        y += 1.37
    if broken:
        for k in range(rnd.randint(1, 3)):  # 倒れたドラム
            s = 1 if x > 0 else -1
            fcyl("cols", 0.9, 0.92, 1.35, (x + s * rnd.uniform(2.5, 6), 0.7, z + rnd.uniform(-4, 4)), M["col"], seg=20,
                 rx=math.pi / 2, rz=rnd.uniform(0, math.pi))
        return
    fcyl("cols", 1.25, 0.88, 0.6, (x, y + 0.3, z), M["col"])  # 柱頭
    fbox("cols", (2.6, 0.7, 2.6), (x, y + 0.95, z), M["stone"])


for z in range(16, int(ZEND) + 12, -15):
    for s in (-1, 1):
        column(s * 10, z, rnd.random() < 0.3)

# ---- 作品の基壇(3 段)・正面の大階段・かがり火・崩れた壁 ----
fires = []
for i, (sx, sz) in enumerate(SITES):
    s = 1 if sx > 0 else -1
    for k, (wd, y0, y1) in enumerate(((30, -1.0, 1.6), (25, 1.6, 3.2), (20, 3.2, TOP))):
        fbox("stone", (wd, y1 - y0, wd), (sx, (y0 + y1) / 2, sz), M["stone"])
        fbox("stone", (wd + 0.5, 0.3, wd + 0.5), (sx, y1 - 0.15, sz), M["stone2"])  # 段の縁
    for k in range(12):  # 大階段(参道の側)
        h = 0.4 * (k + 1)
        fbox("stone", (0.55, h, 9), (sx - s * (16.5 - k * 0.55), h / 2, sz), M["stone2"])
    for dz in (-5.6, 5.6):  # 階段の脇の袖壁と、かがり火
        fbox("stone", (7.0, 2.4, 1.2), (sx - s * 13.5, 1.2, sz + dz), M["stone"], taper=0.95)
        fx = sx - s * 16.8
        fbox("stone", (1.6, 2.6, 1.6), (fx, 1.3, sz + dz * 1.15), M["stone2"], taper=0.85)
        fcyl("cols", 0.75, 0.4, 0.5, (fx, 2.85, sz + dz * 1.15), M["dark"], seg=16)
        fcyl("glow", 0.02, 0.45, 1.1, (fx, 3.6, sz + dz * 1.15), M["fire"], seg=10)
        fires.append((fx, 4.0, sz + dz * 1.15))
    # 奥の崩れた壁(石を積んだまま歯抜けに)
    bx = sx + s * 13.5
    for zz in range(-12, 13, 3):
        hgt = rnd.choice((1, 2, 2, 3, 4))
        for k in range(hgt):
            rubble("stone", (2.0, 1.4, 2.9), (bx + rnd.uniform(-0.15, 0.15), TOP + 0.7 + k * 1.42, sz + zz + rnd.uniform(-0.1, 0.1)), M["rubble"],
                   rot=(0, 0, rnd.uniform(-0.05, 0.05)), jit=0.05)
    # 足もとに崩れ落ちた大石
    for k in range(5):
        a = rnd.uniform(0, math.tau)
        d = rnd.uniform(17, 24)
        x, z = sx + math.cos(a) * d, sz + math.sin(a) * d
        if abs(x) < 13:
            continue
        sz_ = rnd.uniform(1.5, 3.2)
        rubble("cols", (sz_ * 1.4, sz_, sz_), (x, sz_ * 0.3, z), M["rubble"], rot=(rnd.uniform(-0.3, 0.3), rnd.uniform(-0.3, 0.3), rnd.uniform(0, 3)), jit=0.08)
    w.spot(x=sx, y=TOP, z=sz, face=math.pi / 2 if sx < 0 else -math.pi / 2, dist=3.3, r=17.5, scale=SC, lift=0.0)

# 砂漠に散らばる遺構(半ば埋もれた石・折れたオベリスク)
for k in range(26):
    x = rnd.choice((-1, 1)) * rnd.uniform(60, 160)
    z = rnd.uniform(ZEND - 60, 60)
    g = ground(x, z)
    if rnd.random() < 0.35:
        h = rnd.uniform(6, 16)
        fbox("cols", (1.8, h, 1.8), (x, g + h / 2 - 1, z), M["col"], ry=rnd.uniform(0, 1), taper=0.75)
    else:
        sz_ = rnd.uniform(2, 5)
        rubble("cols", (sz_ * 1.6, sz_, sz_), (x, g + sz_ * 0.15, z), M["rubble"], rot=(rnd.uniform(-0.4, 0.4), rnd.uniform(-0.4, 0.4), rnd.uniform(0, 3)), jit=0.1)

# ---- 遠くの台地 ----
for k in range(16):
    a = math.pi + (rnd.random() - 0.5) * 3.6  # 主に前(-z)と左右
    d = rnd.uniform(430, 600)
    x, z = math.sin(a) * d, CZ + math.cos(a) * d
    r1 = rnd.uniform(35, 80)
    h = rnd.uniform(30, 90)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=9, radius1=r1, radius2=r1 * rnd.uniform(0.6, 0.85), depth=h)
    for v in bm.verts:
        v.co.x *= 1.6
        v.co += Vector((rnd.uniform(-6, 6), rnd.uniform(-6, 6), rnd.uniform(-2, 2) if v.co.z > 0 else 0))
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(rnd.uniform(0, 3), 3, "Z"), verts=bm.verts)
    bmesh.ops.translate(bm, vec=P(x, h / 2 + ground(x, z) - 8, z), verts=bm.verts)
    w.mesh_from_bmesh("dunes", "mesa", bm, M["mesa"], smooth=False)

# ---- 空のドーム(光の計算には加わらない) ----
bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=64, v_segments=32, radius=860)
bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
bmesh.ops.translate(bm, verts=bm.verts[:], vec=P(0, 0, CZ))
dome = w.mesh_from_bmesh("sky", "sky", bm, sky_dome_mat(0.3))
for k in ("visible_diffuse", "visible_glossy", "visible_transmission", "visible_volume_scatter", "visible_shadow"):
    setattr(dome, k, False)

# ---- 光:夕日とかがり火 ----
w.light("SUN", tuple(c * 100 for c in SUN), 5.5, (1.0, 0.62, 0.34), target=(0, 0, 0), angle=math.radians(1.0))
for x, y, z in fires:
    w.light("POINT", (x, y, z), 600, (1.0, 0.5, 0.2), shadow_soft_size=0.4)

# ---- ブラウザ用の情報 ----
L = math.sqrt(sum(c * c for c in SUN))
w.extra.update({
    "title": "砂漠の巨大遺跡",
    "tip": "夕暮れの砂漠に、キューブが巨大な石の遺跡として建っています。石畳の参道を進みます。",
    "start": {"x": 0, "z": 40, "yaw": 0, "pitch": 0.06},
    "walk": [{"t": "rect", "x0": -56, "z0": ZEND - 6, "x1": 56, "z1": 52}],
    "speed": 6,
    "bg": "#e0a878",
    "fog": ["#dca47a", 0.0018],
    "exposure": 1.05,
    "far": 2200,
    "hemi": ["#ffd9b0", "#8a5a3a", 0.5],
    "sun": {"dir": [c / L for c in SUN], "color": "#ffb878", "intensity": 1.7, "box": 180},
    "palette": ["#e6cfa0", "#7a4a22"],
})

if A.still:
    w.still(A.still, (0, 1.6, 40), (0, 1.6 + math.tan(0.06) * 50, -10), lens=18)
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
