"""Blender で展示の世界を作るための共通部品。

- 座標は three.js 側(Y が上、入口が +Z)で書き、P() で Blender(Z が上)に直す
- 物は「組」に入れる。組ごとに 1 つにまとめ、色(albedo)と光(lightmap)を別々の画像に焼く
  → ブラウザでは MeshStandardMaterial(map=色, lightMap=光) にするので、懐中電灯など動く光も効く
- 書き出し: <out>.glb と、組ごとの光の画像 <out>_<組>_light.jpg、情報 <out>.json
"""
import json
import math
import os
import sys

import bpy
import bmesh
import numpy as np
from mathutils import Vector


def P(x, y, z):
    return Vector((x, -z, y))


class World:
    def __init__(self, samples=64):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        self.sc = sc = bpy.context.scene
        sc.render.engine = "CYCLES"
        sc.cycles.device = "CPU"
        sc.cycles.samples = samples
        sc.cycles.use_denoising = True
        sc.view_settings.view_transform = "AgX"
        self.samples = samples
        sc.world = bpy.data.worlds.new("world")
        sc.world.use_nodes = True
        self.groups = {}  # 組の名前 -> {"objs": [], "size": n, "rough": r, "metal": m, "opacity": o}
        self.spots = []
        self.extra = {}

    # ---- 背景 ----
    def sky(self, color, strength):
        bg = self.sc.world.node_tree.nodes["Background"]
        bg.inputs["Color"].default_value = (*color, 1)
        bg.inputs["Strength"].default_value = strength

    # ---- 組 ----
    def group(self, name, size=1024, rough=0.8, metal=0.0, bake=True, unlit=False, opacity=1.0):
        """bake=False: 焼かない(光る物。GLB の emissive のまま)
        unlit=True: 発光の色(空・ネオン・ホログラムの模様など)だけを画像に焼き、ブラウザでは光の計算をせずに貼る
        metal>=0.5: 拡散光が無いので光の画像は焼かない(映り込みで見せる)
        opacity<1: ブラウザで半透明にする(水面・ガラス)"""
        self.groups[name] = dict(objs=[], size=size, rough=rough, metal=metal, bake=bake, unlit=unlit, opacity=opacity)

    def add(self, group, o, material):
        o.data.materials.clear()
        o.data.materials.append(material)
        self.groups[group]["objs"].append(o)
        return o

    # ---- 形 ----
    def box(self, group, size, center, material, ry=0.0):
        bpy.ops.mesh.primitive_cube_add(size=1, location=P(*center))
        o = bpy.context.object
        o.scale = (size[0], size[2], size[1])
        o.rotation_euler = (0, 0, ry)
        bpy.ops.object.transform_apply(scale=True, rotation=True)
        return self.add(group, o, material)

    def cyl(self, group, r_top, r_bot, h, center, material, seg=32, caps=True):
        bpy.ops.mesh.primitive_cone_add(vertices=seg, radius1=r_bot, radius2=r_top, depth=h, location=P(*center),
                                        end_fill_type="NGON" if caps else "NOTHING")
        o = bpy.context.object
        bpy.ops.object.shade_smooth()
        return self.add(group, o, material)

    def plane(self, group, w, h, center, material, ry=0.0, face_up=False):
        """縦の板(既定は +Z を向く)。face_up=True なら床に寝かせる"""
        bpy.ops.mesh.primitive_plane_add(size=1, location=P(*center))
        o = bpy.context.object
        o.scale = (w, h, 1)
        o.rotation_euler = (0, 0, ry) if face_up else (math.pi / 2, 0, ry)
        bpy.ops.object.transform_apply(scale=True, rotation=True)
        return self.add(group, o, material)

    def mesh_from_bmesh(self, group, name, bm, material, smooth=True):
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        o = bpy.data.objects.new(name, me)
        self.sc.collection.objects.link(o)
        if smooth:
            for p in me.polygons:
                p.use_smooth = True
        return self.add(group, o, material)

    # ---- 作品の場所 ----
    def spot(self, **d):
        e = bpy.data.objects.new(f"spot_{len(self.spots) + 1}", None)
        self.sc.collection.objects.link(e)
        e.location = P(d["x"], d["y"], d["z"])
        for k, v in d.items():
            e[k] = v
        self.spots.append(d)

    # ---- 光 ----
    def light(self, kind, pos, energy, color=(1, 1, 1), target=None, **kw):
        ld = bpy.data.lights.new("l", kind)
        ld.energy = energy
        ld.color = color
        for k, v in kw.items():
            setattr(ld, k, v)
        lo = bpy.data.objects.new("l", ld)
        self.sc.collection.objects.link(lo)
        lo.location = P(*pos)
        if target is not None:
            lo.rotation_euler = (P(*target) - lo.location).to_track_quat("-Z", "Y").to_euler()
        return lo

    # ---- 一枚絵 ----
    def still(self, path, cam_pos, look_at, lens=22, size=(1280, 720)):
        cd = bpy.data.cameras.new("cam")
        cd.lens = lens
        co = bpy.data.objects.new("cam", cd)
        self.sc.collection.objects.link(co)
        co.location = P(*cam_pos)
        co.rotation_euler = (P(*look_at) - co.location).to_track_quat("-Z", "Y").to_euler()
        self.sc.camera = co
        self.sc.render.resolution_x, self.sc.render.resolution_y = size
        self.sc.render.resolution_percentage = 100
        self.sc.render.image_settings.file_format = "PNG"
        self.sc.render.image_settings.color_depth = "8"
        self.sc.render.filepath = path
        bpy.ops.render.render(write_still=True)
        bpy.data.objects.remove(co)

    # ---- 焼き込みと書き出し ----
    def _join(self, name, objs):
        bpy.ops.object.select_all(action="DESELECT")
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        if len(objs) > 1:
            bpy.ops.object.join()
        o = bpy.context.object
        o.name = name
        o.data.name = name
        return o

    def _uv(self, o):
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

    def _bake(self, o, size, kind):
        """kind: 'albedo'(色だけ) / 'light'(光だけ、色なし) / 'emit'(発光の色)"""
        img = bpy.data.images.new(f"{o.name}_{kind}", size, size, float_buffer=True)
        for slot in o.material_slots:
            nt = slot.material.node_tree
            n = nt.nodes.get("__bake__") or nt.nodes.new("ShaderNodeTexImage")
            n.name = "__bake__"
            n.image = img
            nt.nodes.active = n
        b = self.sc.render.bake
        b.margin = 8
        b.use_pass_direct = kind == "light"
        b.use_pass_indirect = kind == "light"
        b.use_pass_color = kind == "albedo"
        self.sc.cycles.samples = 1 if kind in ("albedo", "emit") else self.samples
        bpy.ops.object.bake(type="EMIT" if kind == "emit" else "DIFFUSE")
        self.sc.cycles.samples = self.samples
        return img

    def _denoise(self, img):
        sc = self.sc
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
        vt = sc.view_settings.view_transform
        sc.view_settings.view_transform = "Standard"
        sc.render.image_settings.file_format = "OPEN_EXR"
        sc.render.image_settings.color_depth = "32"
        path = os.path.join(bpy.app.tempdir, f"{img.name}.exr")
        sc.render.filepath = path
        hidden = [ob for ob in sc.objects if not ob.hide_render]
        for ob in hidden:
            ob.hide_render = True
        bpy.ops.render.render(write_still=True)
        for ob in hidden:
            ob.hide_render = False
        sc.view_settings.view_transform = vt
        sc.use_nodes = False
        return bpy.data.images.load(path)

    @staticmethod
    def _save(px, size, path, scale=1.0):
        """リニアの値を scale 倍して sRGB の JPEG に"""
        rgb = np.clip(px[:, :3] * scale, 0, 1)
        rgb = np.where(rgb <= 0.0031308, rgb * 12.92, 1.055 * np.power(rgb, 1 / 2.4) - 0.055)
        out = bpy.data.images.new(os.path.basename(path), size, size, alpha=False)
        px = px.copy()
        px[:, :3] = rgb
        px[:, 3] = 1
        out.pixels[:] = px.ravel()
        out.filepath_raw = path
        out.file_format = "JPEG"
        bpy.context.scene.render.image_settings.quality = 90
        out.save()
        return out

    def export(self, out):
        base = os.path.splitext(out)[0]
        info = {"groups": {}, "spots": self.spots, **self.extra}
        joined = {}
        for name, g in self.groups.items():
            if g["objs"]:
                joined[name] = self._join(name, g["objs"])
        for name, o in joined.items():
            g = self.groups[name]
            if not g["bake"]:
                continue
            print(f"baking {name} {g['size']}px ...", flush=True)
            self._uv(o)
            entry = {"rough": g["rough"], "metal": g["metal"]}
            if g["opacity"] < 1:
                entry["opacity"] = g["opacity"]
            if g["unlit"]:
                apx = np.array(self._bake(o, g["size"], "emit").pixels[:], dtype=np.float32).reshape(-1, 4)
                entry["unlit"] = True
            else:
                apx = np.array(self._bake(o, g["size"], "albedo").pixels[:], dtype=np.float32).reshape(-1, 4)
                if g["metal"] < 0.5:
                    lit = self._denoise(self._bake(o, g["size"], "light"))
                    lpx = np.array(lit.pixels[:], dtype=np.float32).reshape(-1, 4)
                    # 光の画像は明るい所(上位 0.5%)が 1 になるように縮め、その倍率を json に残す
                    peak = float(np.percentile(lpx[:, :3].max(axis=1), 99.5)) or 1.0
                    lpath = f"{base}_{name}_light.jpg"
                    self._save(lpx, g["size"], lpath, 1.0 / peak)
                    entry.update(light=os.path.basename(lpath), lightScale=peak)
            aimg = self._save(apx, g["size"], os.path.join(bpy.app.tempdir, f"{name}_albedo.jpg"))  # 色は GLB の中に入る
            info["groups"][name] = entry
            # 書き出し用の材質:色の画像だけ。光は別の画像でブラウザが重ねる
            m = bpy.data.materials.new(f"{name}_baked")
            m.use_nodes = True
            nt = m.node_tree
            bsdf = nt.nodes["Principled BSDF"]
            t = nt.nodes.new("ShaderNodeTexImage")
            t.image = aimg
            nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
            bsdf.inputs["Roughness"].default_value = g["rough"]
            bsdf.inputs["Metallic"].default_value = g["metal"]
            o.data.materials.clear()
            o.data.materials.append(m)
            me = o.data
            while len(me.uv_layers) > 1:
                me.uv_layers.remove(me.uv_layers[0])
        for ob in list(self.sc.objects):
            if ob.type in ("LIGHT", "CAMERA"):
                bpy.data.objects.remove(ob)
        bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_image_format="JPEG", export_jpeg_quality=88,
                                  export_extras=True, export_lights=False, export_cameras=False, export_apply=True)
        with open(base + ".json", "w") as f:
            json.dump(info, f, ensure_ascii=False, indent=1)
        print("wrote", out, flush=True)


# ---- 材質 ----
def mat(name, color, rough=0.8, metal=0.0, noise=0.0, noise_scale=6.0, bump=0.0, w=0.0, veins=None):
    """色にむら(noise)・凹凸(bump)・大理石の筋(veins=(色, 細かさ))を付けられる材質"""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    tc = nt.nodes.new("ShaderNodeTexCoord")
    col_out = None
    if noise or bump:
        nz = nt.nodes.new("ShaderNodeTexNoise")
        nz.noise_dimensions = "4D"
        nz.inputs["W"].default_value = w
        nz.inputs["Scale"].default_value = noise_scale
        nz.inputs["Detail"].default_value = 8
        nt.links.new(tc.outputs["Object"], nz.inputs["Vector"])
        if noise:
            mix = nt.nodes.new("ShaderNodeMix")
            mix.data_type = "RGBA"
            mix.inputs["A"].default_value = (*[c * (1 - noise) for c in color], 1)
            mix.inputs["B"].default_value = (*[min(1, c * (1 + noise)) for c in color], 1)
            nt.links.new(nz.outputs["Fac"], mix.inputs["Factor"])
            col_out = mix.outputs["Result"]
        if bump:
            b = nt.nodes.new("ShaderNodeBump")
            b.inputs["Strength"].default_value = bump
            nt.links.new(nz.outputs["Fac"], b.inputs["Height"])
            nt.links.new(b.outputs["Normal"], bsdf.inputs["Normal"])
    if veins:
        vcol, vscale = veins
        wv = nt.nodes.new("ShaderNodeTexWave")
        wv.inputs["Scale"].default_value = vscale
        wv.inputs["Distortion"].default_value = 14
        wv.inputs["Detail"].default_value = 10
        wv.inputs["Detail Scale"].default_value = 2.5
        nt.links.new(tc.outputs["Object"], wv.inputs["Vector"])
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].position = 0.95
        ramp.color_ramp.elements[1].position = 0.99
        nt.links.new(wv.outputs["Fac"], ramp.inputs["Fac"])
        vm = nt.nodes.new("ShaderNodeMix")
        vm.data_type = "RGBA"
        if col_out:
            nt.links.new(col_out, vm.inputs["A"])
        else:
            vm.inputs["A"].default_value = (*color, 1)
        vm.inputs["B"].default_value = (*vcol, 1)
        nt.links.new(ramp.outputs["Color"], vm.inputs["Factor"])
        col_out = vm.outputs["Result"]
    if col_out:
        nt.links.new(col_out, bsdf.inputs["Base Color"])
    return m


def painting(name, palette, w):
    """油絵風:色の帯をノイズでゆがめた抽象画。palette は 4 色"""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.55
    tc = nt.nodes.new("ShaderNodeTexCoord")
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.noise_dimensions = "4D"
    nz.inputs["W"].default_value = w
    nz.inputs["Scale"].default_value = 2.2
    nz.inputs["Detail"].default_value = 12
    nz.inputs["Distortion"].default_value = 0.8
    nt.links.new(tc.outputs["Object"], nz.inputs["Vector"])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    els = ramp.color_ramp.elements
    els[0].position, els[0].color = 0.3, (*palette[0], 1)
    els[1].position, els[1].color = 0.7, (*palette[3], 1)
    e = els.new(0.45)
    e.color = (*palette[1], 1)
    e = els.new(0.58)
    e.color = (*palette[2], 1)
    nt.links.new(nz.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    b = nt.nodes.new("ShaderNodeBump")
    b.inputs["Strength"].default_value = 0.25
    nz2 = nt.nodes.new("ShaderNodeTexNoise")
    nz2.inputs["Scale"].default_value = 90
    nt.links.new(tc.outputs["Object"], nz2.inputs["Vector"])
    nt.links.new(nz2.outputs["Fac"], b.inputs["Height"])
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
    return m


def args(defaults):
    import argparse
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=defaults["out"])
    ap.add_argument("--size", type=int, default=2048)
    ap.add_argument("--samples", type=int, default=64)
    ap.add_argument("--still", default="")
    ap.add_argument("--still-only", action="store_true")
    return ap.parse_args(argv)
