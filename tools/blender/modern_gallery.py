"""白い現代美術館を Blender で組み、光(影・照り返し)を画像に焼き込んで GLB に書き出す。

使い方(Blender 4.2 / bpy モジュール):
    python3 tools/blender/modern_gallery.py --out public/worlds/modern.glb [--size 2048] [--samples 128] [--still out.png]

座標は three.js 側(Y が上、入口が +Z)で書き、Blender 側(Z が上)へは P() で直す。
作品を置く場所は "spot_1"... の空オブジェクトとして GLB に入る(extras に向き・距離)。
"""
import argparse
import math
import sys

import bpy
import numpy as np
from mathutils import Vector

# ---- 引数 ----
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
ap = argparse.ArgumentParser()
ap.add_argument("--out", default="modern.glb")
ap.add_argument("--size", type=int, default=2048, help="焼き込み画像の一辺(床・壁)")
ap.add_argument("--samples", type=int, default=128)
ap.add_argument("--still", default="", help="Cycles で入口からの一枚絵も出す")
ap.add_argument("--exposure", type=float, default=-0.6)
ap.add_argument("--still-only", action="store_true")
args = ap.parse_args(argv)

W, H, L, N = 14.0, 5.4, 28.0, 4  # 幅・天井高・奥行き・作品数


def P(x, y, z):
    """three.js 座標 → Blender 座標"""
    return Vector((x, -z, y))


# ---- 空の場面 ----
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = "CYCLES"
sc.cycles.device = "CPU"
sc.cycles.samples = args.samples
sc.cycles.use_denoising = True
sc.view_settings.view_transform = "AgX"
sc.view_settings.exposure = args.exposure
world = bpy.data.worlds.new("world")
sc.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.9, 0.9, 0.92, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.05


# ---- 材質 ----
def mat(name, color, rough=0.8, noise=0.0, noise_scale=6.0, metal=0.0, bump=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if noise or bump:
        tc = nt.nodes.new("ShaderNodeTexCoord")
        nz = nt.nodes.new("ShaderNodeTexNoise")
        nz.inputs["Scale"].default_value = noise_scale
        nz.inputs["Detail"].default_value = 8
        nt.links.new(tc.outputs["Object"], nz.inputs["Vector"])
        if noise:
            mix = nt.nodes.new("ShaderNodeMix")
            mix.data_type = "RGBA"
            mix.inputs["A"].default_value = (*[c * (1 - noise) for c in color], 1)
            mix.inputs["B"].default_value = (*[min(1, c * (1 + noise)) for c in color], 1)
            nt.links.new(nz.outputs["Fac"], mix.inputs["Factor"])
            nt.links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])
        if bump:
            b = nt.nodes.new("ShaderNodeBump")
            b.inputs["Strength"].default_value = bump
            nt.links.new(nz.outputs["Fac"], b.inputs["Height"])
            nt.links.new(b.outputs["Normal"], bsdf.inputs["Normal"])
    return m


def emit(name, color, strength):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.remove(nt.nodes["Principled BSDF"])
    e = nt.nodes.new("ShaderNodeEmission")
    e.inputs["Color"].default_value = (*color, 1)
    e.inputs["Strength"].default_value = strength
    nt.links.new(e.outputs[0], nt.nodes["Material Output"].inputs[0])
    m["lamp"] = True
    return m


M = {
    "concrete": mat("concrete", (0.25, 0.245, 0.235), rough=0.25, noise=0.18, noise_scale=1.4, bump=0.03),
    "plaster": mat("plaster", (0.86, 0.86, 0.84), rough=0.95, noise=0.02, noise_scale=40, bump=0.04),
    "ceiling": mat("ceiling", (0.88, 0.88, 0.87), rough=1.0),
    "dark": mat("dark", (0.035, 0.035, 0.04), rough=0.85, noise=0.05, noise_scale=30),
    "black": mat("black", (0.02, 0.02, 0.02), rough=0.35),
    "leather": mat("leather", (0.03, 0.025, 0.022), rough=0.5, noise=0.2, noise_scale=80, bump=0.1),
    "steel": mat("steel", (0.6, 0.6, 0.6), rough=0.3, metal=1.0),
    "oak": mat("oak", (0.42, 0.28, 0.16), rough=0.6, noise=0.25, noise_scale=12),
    "ink": mat("ink", (0.03, 0.03, 0.03), rough=0.6),
    "light": emit("light", (1.0, 0.97, 0.92), 6.0),
    "sky": emit("sky", (0.92, 0.96, 1.0), 4.0),
}

GROUPS = {"floor": [], "shell": [], "props": [], "lamps": []}


def box(group, size, center, material, name="box"):
    """three.js 座標の中心と寸法(幅 x, 高さ y, 奥行き z)で箱を置く"""
    bpy.ops.mesh.primitive_cube_add(size=1, location=P(*center))
    o = bpy.context.object
    o.name = name
    o.scale = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(scale=True)
    o.data.materials.append(material)
    GROUPS[group].append(o)
    return o


# ---- 部屋 ----
T = 0.2  # 壁の厚み
box("floor", (W, 0.1, L), (0, -0.05, 0), M["concrete"], "floor")
box("shell", (T, H, L + 2 * T), (-W / 2 - T / 2, H / 2, 0), M["plaster"], "wall_l")
box("shell", (T, H, L + 2 * T), (W / 2 + T / 2, H / 2, 0), M["plaster"], "wall_r")
box("shell", (W, H, T), (0, H / 2, -L / 2 - T / 2), M["plaster"], "wall_back")
box("shell", (W, H, T), (0, H / 2, L / 2 + T / 2), M["plaster"], "wall_front")
# 天井:中央に天窓の吹き抜け(幅 2.4)、左右に光の筋
SK = 2.4
box("shell", ((W - SK) / 2, 0.2, L), (-(W + SK) / 4, H + 0.1, 0), M["ceiling"], "ceil_l")
box("shell", ((W - SK) / 2, 0.2, L), ((W + SK) / 4, H + 0.1, 0), M["ceiling"], "ceil_r")
box("shell", (0.1, 0.9, L - 4), (-SK / 2 - 0.05, H + 0.45, 0), M["ceiling"], "sky_side_l")
box("shell", (0.1, 0.9, L - 4), (SK / 2 + 0.05, H + 0.45, 0), M["ceiling"], "sky_side_r")
box("shell", (SK, 0.9, 0.1), (0, H + 0.45, (L - 4) / 2), M["ceiling"], "sky_end_f")
box("shell", (SK, 0.9, 0.1), (0, H + 0.45, -(L - 4) / 2), M["ceiling"], "sky_end_b")
box("shell", (SK, 0.2, 2.1), (0, H + 0.1, L / 2 - 1.05), M["ceiling"], "ceil_fill_f")
box("shell", (SK, 0.2, 2.1), (0, H + 0.1, -L / 2 + 1.05), M["ceiling"], "ceil_fill_b")
box("lamps", (SK, 0.02, L - 4), (0, H + 0.9, 0), M["sky"], "skylight")
for x in (-4.6, 4.6):
    box("lamps", (0.3, 0.02, L - 3), (x, H - 0.011, 0), M["light"], "strip")
# 壁の足元の影目地
for x in (-W / 2 + 0.015, W / 2 - 0.015):
    box("props", (0.03, 0.06, L), (x, 0.03, 0), M["black"], "shadow_gap")

# ---- 小部屋・台・作品の場所 ----
STEP = 3.9
spots = []
for i in range(N):
    side = 1 if i % 2 else -1
    z = L / 2 - 7.5 - i * STEP
    x = side * 5.2
    for dz in (-2.4, 2.4):
        box("shell", (2.1, H, 0.16), (side * (W / 2 - 1.05), H / 2, z + dz), M["plaster"], "fin")
    if i % 4 < 2:
        box("shell", (0.02, H - 0.02, 4.64), (side * (W / 2 - 0.011), H / 2, z), M["dark"], "accent")
    box("props", (1.5, 0.42, 1.5), (x, 0.21, z), M["black"], "plinth")
    box("props", (0.44, 0.22, 0.01), (side * (W / 2 - 0.006), 1.45, z + 1.75), M["steel"], "plate")
    spots.append(dict(x=x, y=0.42, z=z, face=(math.pi / 2 if side < 0 else -math.pi / 2), dist=3.5, r=1.25))
    # 作品を照らすスポット(暖色)
    ld = bpy.data.lights.new(f"spot_light_{i}", "SPOT")
    ld.energy = 700
    ld.spot_size = math.radians(42)
    ld.spot_blend = 0.6
    ld.color = (1.0, 0.86, 0.7)
    ld.shadow_soft_size = 0.08
    lo = bpy.data.objects.new(f"spot_light_{i}", ld)
    sc.collection.objects.link(lo)
    lo.location = P(side * 2.6, H - 0.1, z)
    d = P(x, 0.9, z) - lo.location
    lo.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    # 作品の場所(GLB に空オブジェクトとして入る)
    e = bpy.data.objects.new(f"spot_{i + 1}", None)
    sc.collection.objects.link(e)
    e.location = P(x, 0.42, z)
    for k, v in spots[-1].items():
        e[k] = v

# 長椅子:革の座面と鉄の脚
for z in (3.0,):
    box("props", (0.62, 0.1, 2.6), (0, 0.42, z), M["leather"], "bench_seat")
    for dz in (-1.05, 1.05):
        box("props", (0.56, 0.37, 0.05), (0, 0.185, z + dz), M["steel"], "bench_leg")

# 入口の受付台(木)
box("props", (2.6, 1.05, 0.7), (-4.4, 0.525, L / 2 - 2.2), M["oak"], "desk")
box("props", (2.7, 0.04, 0.8), (-4.4, 1.07, L / 2 - 2.2), M["black"], "desk_top")

# 奥の壁の文字(本物の立体文字)
for txt, size, y, mat_ in (("CUBE COLLECTION", 0.52, 3.2, M["ink"]), ("3D DATA  PERMANENT EXHIBITION", 0.16, 2.55, M["ink"])):
    bpy.ops.object.text_add(location=P(0, y, -L / 2 + 0.01))
    t = bpy.context.object
    t.data.body = txt
    t.data.size = size
    t.data.align_x = "CENTER"
    t.data.align_y = "CENTER"
    t.data.extrude = 0.006
    t.data.space_character = 1.25
    t.rotation_euler = (math.pi / 2, 0, 0)
    bpy.ops.object.convert(target="MESH")
    t.data.materials.append(mat_)
    GROUPS["props"].append(t)

# 天井の光の筋・天窓の後ろに面光源(Cycles の明るさの主役。焼き込み後は捨てる)
for x in (-4.6, 4.6):
    ad = bpy.data.lights.new("strip_area", "AREA")
    ad.shape = "RECTANGLE"
    ad.size, ad.size_y = 0.3, L - 3
    ad.energy = 350
    ad.color = (1.0, 0.95, 0.88)
    ao = bpy.data.objects.new("strip_area", ad)
    sc.collection.objects.link(ao)
    ao.location = P(x, H - 0.03, 0)
ad = bpy.data.lights.new("sky_area", "AREA")
ad.shape = "RECTANGLE"
ad.size, ad.size_y = SK, L - 4
ad.energy = 1100
ad.color = (0.9, 0.95, 1.0)
ao = bpy.data.objects.new("sky_area", ad)
sc.collection.objects.link(ao)
ao.location = P(0, H + 0.85, 0)


# ---- 入口からの一枚絵(Cycles、比較用) ----
def add_camera():
    cd = bpy.data.cameras.new("cam")
    cd.lens = 22
    co = bpy.data.objects.new("cam", cd)
    sc.collection.objects.link(co)
    co.location = P(0, 1.6, L / 2 - 1.6)
    co.rotation_euler = (P(0, 1.45, 0) - co.location).to_track_quat("-Z", "Y").to_euler()
    sc.camera = co
    return co


if args.still:
    cam = add_camera()
    sc.render.resolution_x, sc.render.resolution_y = 1280, 720
    sc.render.filepath = args.still
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)
    if args.still_only:
        sys.exit(0)


# ---- まとめて焼き込む ----
def join(name, objs):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.object
    o.name = name
    return o


def tone(px, exposure):
    """焼いた明るさ(リニア)を sRGB の 8bit 用に。AgX 風に明るい所をなだらかに丸める"""
    rgb = px[:, :3] * (2.0 ** exposure)
    rgb = rgb / (1.0 + rgb * 0.18)  # 明るい所だけ穏やかに圧縮
    rgb = np.clip(rgb, 0, 1)
    out = np.where(rgb <= 0.0031308, rgb * 12.92, 1.055 * np.power(rgb, 1 / 2.4) - 0.055)
    px[:, :3] = out
    px[:, 3] = 1
    return px


def bake(o, size):
    me = o.data
    uv = me.uv_layers.new(name="bake")
    me.uv_layers.active = uv
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.004, scale_to_bounds=True)
    bpy.ops.uv.pack_islands(margin=0.003, rotate=True)
    bpy.ops.object.mode_set(mode="OBJECT")
    img = bpy.data.images.new(f"{o.name}_bake", size, size, float_buffer=True)
    for slot in o.material_slots:
        m = slot.material.copy()  # 焼き込み画像は物ごとに別
        slot.material = m
        n = m.node_tree.nodes.new("ShaderNodeTexImage")
        n.image = img
        m.node_tree.nodes.active = n
    sc.cycles.bake_type = "COMBINED"
    sc.render.bake.use_pass_direct = True
    sc.render.bake.use_pass_indirect = True
    sc.render.bake.use_pass_diffuse = True
    sc.render.bake.use_pass_glossy = False  # 見る向きで変わる照りは焼かない
    sc.render.bake.use_pass_transmission = False
    sc.render.bake.use_pass_emit = True
    sc.render.bake.margin = 8
    bpy.ops.object.bake(type="COMBINED")
    # 焼いた画像を OIDN でノイズ取り(合成ノードで画像を通す)
    img = denoise(img)
    px = np.array(img.pixels[:], dtype=np.float32).reshape(-1, 4)
    out = bpy.data.images.new(f"{o.name}_lm", size, size, alpha=False)
    out.pixels[:] = tone(px, args.exposure).ravel()
    out.file_format = "JPEG"
    # 書き出し用の材質:焼いた画像だけを色に
    for slot in o.material_slots:
        old = slot.material
        m = bpy.data.materials.new(f"{o.name}_baked")
        m.use_nodes = True
        nt = m.node_tree
        bsdf = nt.nodes["Principled BSDF"]
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = out
        nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
        src = old.node_tree.nodes.get("Principled BSDF")
        if src:  # 照り(ざらつき・金属)は残して three.js で光らせる
            bsdf.inputs["Roughness"].default_value = src.inputs["Roughness"].default_value
            bsdf.inputs["Metallic"].default_value = src.inputs["Metallic"].default_value
        m["baked"] = True
        slot.material = m
    while len(me.uv_layers) > 1:
        me.uv_layers.remove(me.uv_layers[0])


def denoise(img):
    size = img.size[0]
    sc.use_nodes = True
    nt = sc.node_tree
    nt.nodes.clear()
    i = nt.nodes.new("CompositorNodeImage")
    i.image = img
    d = nt.nodes.new("CompositorNodeDenoise")
    d.prefilter = "NONE"
    c = nt.nodes.new("CompositorNodeComposite")
    nt.links.new(i.outputs[0], d.inputs[0])
    nt.links.new(d.outputs[0], c.inputs[0])
    sc.render.resolution_x = sc.render.resolution_y = size
    sc.render.resolution_percentage = 100
    sc.render.use_compositing = True
    sc.render.use_sequencer = False
    vt = sc.view_settings.view_transform
    sc.view_settings.view_transform = "Standard"
    sc.render.image_settings.file_format = "OPEN_EXR"
    sc.render.image_settings.color_depth = "32"
    path = bpy.app.tempdir + f"/{img.name}.exr"
    sc.render.filepath = path
    # 合成だけを走らせるため、場面の描画を止める
    for ob in sc.objects:
        ob.hide_render = True
    bpy.ops.render.render(write_still=True)
    for ob in sc.objects:
        ob.hide_render = False
    sc.view_settings.view_transform = vt
    sc.use_nodes = False
    return bpy.data.images.load(path)


for k in ("floor", "shell", "props"):
    GROUPS[k] = [join(k, GROUPS[k])]
lamps = join("lamps", GROUPS["lamps"])

for k, s in (("floor", args.size), ("shell", args.size), ("props", args.size // 2)):
    print(f"baking {k} {s}px ...", flush=True)
    bake(GROUPS[k][0], s)

# 焼き込みに使った光は書き出さない
for ob in list(sc.objects):
    if ob.type == "LIGHT":
        bpy.data.objects.remove(ob)

bpy.ops.export_scene.gltf(
    filepath=args.out,
    export_format="GLB",
    export_image_format="JPEG",
    export_jpeg_quality=88,
    export_extras=True,
    export_lights=False,
    export_cameras=False,
    export_apply=True,
)
print("wrote", args.out)
import os; os._exit(0)  # bpy が終了時に落ちることがあるので、書き出し後はすぐ抜ける
