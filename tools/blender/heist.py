"""赤外線センサーが張られた夜の美術館(円形の大広間)を Blender で組み、光を焼き込む。

    python3 tools/blender/heist.py --out public/worlds/heist.glb [--size 2048] [--samples 64] [--still still.png]

赤い光線・監視カメラ・ガラスケース・懐中電灯はブラウザ側で動かす(public/worlds/heist.html)。
"""
import math
import os
import sys

import bpy  # noqa: F401 (bmesh より先に読む)
import bmesh

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from worldkit import P, World, args, emit, mat, painting  # noqa: E402

A = args({"out": "heist.glb"})
N = 4
R, H = 11.0, 7.0
DOME = R * 0.5
RE = R - 3.3      # 作品の円
RI = R * 0.28     # 中央のセンサー円
OCU = 1.8         # 天窓の半径

w = World(samples=A.samples)
w.sky((0.05, 0.08, 0.18), 1.0)  # 天窓から見える夜空

w.group("floor", A.size, rough=0.08, metal=0.0)
w.group("walls", A.size, rough=0.85)
w.group("dome", A.size // 2, rough=0.9)
w.group("stone", A.size // 2, rough=0.35)
w.group("brass", A.size // 2, rough=0.3, metal=1.0)
w.group("art", A.size // 2, rough=0.55)
w.group("glow", bake=False)

M = {
    "marble": mat("marble", (0.03, 0.03, 0.035), rough=0.08, noise=0.4, noise_scale=0.8, veins=((0.42, 0.41, 0.4), 0.9)),
    "wall": mat("wall", (0.16, 0.15, 0.14), rough=0.9, noise=0.15, noise_scale=3, bump=0.05),
    "panel": mat("panel", (0.06, 0.035, 0.022), rough=0.5, noise=0.25, noise_scale=40, w=3),
    "pilaster": mat("pilaster", (0.24, 0.23, 0.22), rough=0.7, noise=0.1, noise_scale=8, bump=0.03),
    "dome": mat("dome", (0.2, 0.2, 0.21), rough=0.95, noise=0.1, noise_scale=4, bump=0.04),
    "ped": mat("ped", (0.012, 0.012, 0.014), rough=0.22),
    "brass": mat("brass", (0.8, 0.6, 0.32), rough=0.3, metal=1.0, noise=0.08, noise_scale=30),
    "cam": mat("cam", (0.7, 0.7, 0.7), rough=0.4),
    "red": emit("red", (1.0, 0.08, 0.06), 6.0),
    "exit": emit("exit", (0.1, 0.9, 0.4), 4.0),
}

# ---- 床:黒い大理石の円 ----
bm = bmesh.new()
bmesh.ops.create_circle(bm, cap_ends=True, segments=96, radius=R + 0.05)
w.mesh_from_bmesh("floor", "floor", bm, M["marble"], smooth=False)


# ---- 壁:内向きの円筒(腰板つき) ----
def ring_wall(group, radius, y0, y1, material, seg=96):
    bm = bmesh.new()
    ret = bmesh.ops.create_circle(bm, segments=seg, radius=radius)
    ex = bmesh.ops.extrude_edge_only(bm, edges=bm.edges[:])
    for v in [e for e in ex["geom"] if isinstance(e, bmesh.types.BMVert)]:
        v.co.z = y1 - y0
    bmesh.ops.translate(bm, verts=bm.verts[:], vec=(0, 0, y0))
    bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    for f in bm.faces:  # 内側を向ける
        c = f.calc_center_median()
        if f.normal.dot(c.normalized()) > 0:
            f.normal_flip()
    return w.mesh_from_bmesh(group, "ring", bm, material)


ring_wall("walls", R, 0, H, M["wall"])
ring_wall("walls", R - 0.04, 0, 1.1, M["panel"])
# 腰板の笠木・幅木・天井の蛇腹(真鍮と石)
for y, h, d, m, grp in ((1.1, 0.06, 0.08, M["brass"], "brass"), (0.0, 0.18, 0.1, M["ped"], "stone"), (H - 0.35, 0.35, 0.35, M["pilaster"], "walls")):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=False, segments=96, radius1=R - d, radius2=R - d, depth=h)
    bmesh.ops.translate(bm, verts=bm.verts[:], vec=(0, 0, y + h / 2))
    for f in bm.faces:
        if f.normal.dot(f.calc_center_median().normalized()) > 0:
            f.normal_flip()
    w.mesh_from_bmesh(grp, "trim", bm, m)

# 付け柱 24 本(入口の 1 本は抜く)
for a in range(24):
    t = a / 24 * math.pi * 2
    if a == 0:
        continue
    w.box("walls", (0.55, H - 0.35, 0.28), (math.sin(t) * (R - 0.14), (H - 0.35) / 2, math.cos(t) * (R - 0.14)), M["pilaster"], ry=t)

# ---- ドーム(中央に天窓の穴) ----
bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=64, v_segments=32, radius=R)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -1e-4 or math.hypot(v.co.x, v.co.y) < OCU - 1e-3], context="VERTS")
bmesh.ops.scale(bm, vec=(1, 1, DOME / R), verts=bm.verts[:])
bmesh.ops.translate(bm, verts=bm.verts[:], vec=(0, 0, H))
for f in bm.faces:
    if f.normal.z > 0 and f.calc_center_median().z > H + 0.1:
        f.normal_flip()
w.mesh_from_bmesh("dome", "dome", bm, M["dome"])
# ドームの肋骨 16 本
for k in range(16):
    t = k / 16 * math.pi * 2
    bm = bmesh.new()
    pts = []
    for i in range(25):
        u = i / 24  # 0..1 を外周→天窓へ
        rr = R - (R - OCU) * u
        zz = DOME * math.sqrt(max(0, 1 - (rr / R) ** 2))
        pts.append((rr, zz))
    verts = []
    for rr, zz in pts:
        row = []
        for dx, dz in ((-0.12, 0), (0.12, 0), (0.12, -0.18), (-0.12, -0.18)):
            # 肋骨の断面(幅 0.24、ドームの内側へ 0.18)
            row.append(bm.verts.new((rr * math.cos(t) - dx * math.sin(t), rr * math.sin(t) + dx * math.cos(t), H + zz + dz)))
        verts.append(row)
    for i in range(len(verts) - 1):
        for j in range(4):
            a1, a2, b1, b2 = verts[i][j], verts[i][(j + 1) % 4], verts[i + 1][j], verts[i + 1][(j + 1) % 4]
            bm.faces.new((a1, a2, b2, b1))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    w.mesh_from_bmesh("dome", "rib", bm, M["pilaster"], smooth=False)
# 天窓の縁(真鍮の輪)
bm = bmesh.new()
bmesh.ops.create_cone(bm, cap_ends=False, segments=48, radius1=OCU, radius2=OCU, depth=0.3)
bmesh.ops.translate(bm, verts=bm.verts[:], vec=(0, 0, H + DOME * math.sqrt(1 - (OCU / R) ** 2) - 0.1))
w.mesh_from_bmesh("brass", "oculus", bm, M["brass"])

# ---- 壁の絵(付け柱の間、金の額縁、上に絵画灯) ----
PALS = [
    [(0.05, 0.04, 0.03), (0.35, 0.18, 0.06), (0.6, 0.45, 0.25), (0.15, 0.2, 0.25)],
    [(0.02, 0.05, 0.1), (0.1, 0.25, 0.4), (0.7, 0.65, 0.5), (0.25, 0.1, 0.05)],
    [(0.1, 0.02, 0.02), (0.45, 0.08, 0.05), (0.85, 0.6, 0.3), (0.05, 0.05, 0.04)],
    [(0.04, 0.08, 0.04), (0.2, 0.35, 0.15), (0.6, 0.6, 0.35), (0.3, 0.25, 0.15)],
]
pi = 0
for a in range(24):
    t = (a + 0.5) / 24 * math.pi * 2
    if a in (0, 23) or a % 2 == 1:  # 入口の両脇は空け、1 つおきに掛ける
        continue
    rr = R - 0.03
    pw, ph, cy = 1.9, 1.4, 3.1
    x, z = math.sin(t) * rr, math.cos(t) * rr
    ry = t + math.pi  # 内側を向く
    w.plane("art", pw, ph, (math.sin(t) * (rr - 0.04), cy, math.cos(t) * (rr - 0.04)), painting(f"paint{pi}", PALS[pi % 4], pi * 1.7), ry=ry)
    fx, fz = math.cos(t), -math.sin(t)  # 壁に沿う向き
    for dx, dy, sw, sh in ((0, ph / 2 + 0.06, pw + 0.24, 0.12), (0, -ph / 2 - 0.06, pw + 0.24, 0.12), (pw / 2 + 0.06, 0, 0.12, ph), (-pw / 2 - 0.06, 0, 0.12, ph)):
        bx, bz = math.sin(t) * (rr - 0.05) + fx * dx, math.cos(t) * (rr - 0.05) + fz * dx
        w.box("brass", (sw, sh, 0.08), (bx, cy + dy, bz), M["brass"], ry=t)
    # 絵画灯(真鍮の筒)と、その光
    w.box("brass", (0.6, 0.05, 0.05), (math.sin(t) * (rr - 0.32), cy + ph / 2 + 0.32, math.cos(t) * (rr - 0.32)), M["brass"], ry=t)
    w.light("AREA", (math.sin(t) * (rr - 0.3), cy + ph / 2 + 0.28, math.cos(t) * (rr - 0.3)), 14, (1.0, 0.78, 0.5),
            target=(math.sin(t) * rr, cy - 0.3, math.cos(t) * rr), shape="RECTANGLE", size=0.5, size_y=0.04)
    pi += 1

# ---- 台座(作品の場所)とスポット ----
angs = [-2.45 + i * 4.9 / (N - 1) for i in range(N)]
for i, a in enumerate(angs):
    x, z = math.sin(a) * RE, -math.cos(a) * RE
    w.box("stone", (0.9, 1.05, 0.9), (x, 0.525, z), M["ped"], ry=-a)
    w.box("brass", (1.0, 0.08, 1.0), (x, 0.04, z), M["brass"], ry=-a)
    w.box("brass", (0.96, 0.04, 0.96), (x, 1.07, z), M["brass"], ry=-a)
    w.light("SPOT", (x * 0.82, H - 0.3, z * 0.82), 1500, (1.0, 0.85, 0.62), target=(x, 1.2, z),
            spot_size=math.radians(24), spot_blend=0.5, shadow_soft_size=0.05)
    w.spot(x=x, y=1.09, z=z, face=-a, dist=3.3, r=1.4)

# 中央のセンサー柱
w.cyl("stone", 0.32, 0.42, 1.25, (0, 0.625, 0), M["ped"])
w.cyl("glow", 0.06, 0.06, 0.05, (0, 1.27, 0), M["red"])

# 床の非常灯の輪(外周)と中央の輪
for r0, r1 in ((R - 0.14, R - 0.06), (RI - 0.05, RI)):
    bm = bmesh.new()
    o1 = bmesh.ops.create_circle(bm, segments=120, radius=r1)["verts"]
    o0 = bmesh.ops.create_circle(bm, segments=120, radius=r0)["verts"]
    for k in range(120):
        bm.faces.new((o0[k], o0[(k + 1) % 120], o1[(k + 1) % 120], o1[k]))
    bmesh.ops.translate(bm, verts=bm.verts[:], vec=(0, 0, 0.006))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    for f in bm.faces:
        if f.normal.z < 0:
            f.normal_flip()
    w.mesh_from_bmesh("glow", "ring", bm, M["red"], smooth=False)

# 非常口の表示
w.box("glow", (1.6, 0.5, 0.06), (0, 3.4, R - 0.3), M["exit"])

# 監視カメラの台(本体はブラウザで首を振る)
cams = []
for k in range(4):
    t = (k + 0.5) * (math.pi / 2)
    x, z = math.sin(t) * (R - 0.4), -math.cos(t) * (R - 0.4)
    w.box("stone", (0.08, 0.5, 0.08), (x, 4.95, z), M["ped"])
    cams.append({"x": x, "y": 4.6, "z": z, "base": math.pi - t})
w.extra["cams"] = cams
w.extra["R"], w.extra["H"], w.extra["RI"], w.extra["DOME"], w.extra["OCU"] = R, H, RI, DOME, OCU
w.extra["start"] = {"x": 0, "z": R - 1.6, "yaw": 0, "pitch": -0.05}

# ---- 月明かり(天窓から斜めに差す) ----
w.light("SUN", (0, H + DOME + 5, 0), 1.6, (0.62, 0.74, 1.0), target=(1.2, 0, -1.0), angle=math.radians(0.6))
# 外周の非常灯で壁の下がうっすら赤く
for k in range(8):
    t = k / 8 * math.pi * 2
    w.light("POINT", (math.sin(t) * (R - 0.4), 0.1, math.cos(t) * (R - 0.4)), 1.5, (1.0, 0.1, 0.06), shadow_soft_size=0.2)

if A.still:
    w.still(A.still, (0, 1.6, R - 1.6), (0, 1.8, 0), lens=18)
    if A.still_only:
        os._exit(0)

w.export(A.out)
os._exit(0)
