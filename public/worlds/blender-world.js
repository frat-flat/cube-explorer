/* Blender で焼いた世界を three.js(r128)に読み込む共通部品。world.html とビルダーの展示(/builder)が使う。
   要るもの: THREE・THREE.GLTFLoader(・圧縮した GLB なら MeshoptDecoder、床の映り込みなら THREE.Reflector)
   読むファイル: <w>.json(tools/blender/worldkit.py が書く)・<w>.glb・<w>_<組>_light.jpg

   BlenderWorld.load(名前, { base: "/worlds/", files: { ファイル名: data:URL }, info?: 読み込み済みの json }) → { info, root }
     root は材質を置き換え済み(焼いた面は 色×光の画像、葉や岩は頂点の色、空は光らせる、金属は映り込み)
   BlenderWorld.mirror(info, w, l) → 床の映り込み(json の reflect がなければ null)
   BlenderWorld.env(renderer, scene, x, y, z) → 金属や作品の映り込みに使う、まわりの景色(PMREM) */
(() => {
  const b64buf = (d) => { const s = atob(d.slice(d.indexOf(",") + 1)), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u.buffer; };
  // 公開ページは fetch が制限されるので、埋め込み(data:)は自分で展開し、画像は createImageBitmap を使わず <img> で読ませる
  function loadGLTF(url) {
    const loader = new THREE.GLTFLoader(), cib = window.createImageBitmap;
    if (window.MeshoptDecoder) loader.setMeshoptDecoder(window.MeshoptDecoder);
    window.createImageBitmap = undefined;
    return new Promise((ok, ng) => { try { if (url.startsWith("data:")) loader.parse(b64buf(url), "", ok, ng); else loader.load(url, ok, undefined, ng); } catch (e) { ng(e); } })
      .finally(() => { window.createImageBitmap = cib; });
  }
  const tl = new THREE.TextureLoader(), loadTex = (url) => new Promise((ok, ng) => tl.load(url, ok, undefined, ng));
  // 光の画像の手直し(json の組ごとに、焼き直さずに調整できる): lift=暗い所を持ち上げる割合、sat=色みを残す割合
  function tweak(img, lift, sat) {
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const x = c.getContext("2d"); x.drawImage(img, 0, 0); const d = x.getImageData(0, 0, c.width, c.height), p = d.data;
    for (let i = 0; i < p.length; i += 4) {
      const l = 0.3 * p[i] + 0.55 * p[i + 1] + 0.15 * p[i + 2];
      for (let k = 0; k < 3; k++) { const v = l + (p[i + k] - l) * sat; p[i + k] = v + (255 - v) * lift * (1 - v / 255); }
    }
    x.putImageData(d, 0, 0); return new THREE.CanvasTexture(c);
  }

  async function load(name, { base = "", files = {}, info = null } = {}) {
    const src = (f) => files[f] || base + f;
    info = info || (files[`${name}.json`] ? JSON.parse(decodeURIComponent(escape(atob(files[`${name}.json`].split(",")[1])))) : await (await fetch(src(`${name}.json`))).json());
    const [gltf, lights] = await Promise.all([loadGLTF(src(`${name}.glb`)), Promise.all(Object.entries(info.groups).filter(([, g]) => g.light).map(async ([k, g]) => {
      let t = await loadTex(src(g.light));
      if (g.lift || g.sat != null) t = tweak(t.image, g.lift || 0, g.sat ?? 1);
      t.flipY = false; t.encoding = THREE.sRGBEncoding; return [k, t];
    }))]);
    const light = Object.fromEntries(lights), root = gltf.scene;
    root.traverse((o) => {
      if (!o.isMesh) return;
      const key = info.groups[o.name] ? o.name : info.groups[o.parent?.name] ? o.parent.name : null, g = key && info.groups[key];
      o.userData.group = key;
      if (info.combined) { // 古い焼き方(色と光をまとめて 1 枚に焼いた現代美術館):焼いた画像をそのまま見せる
        const m = o.material;
        o.material = m.userData?.baked ? new THREE.MeshBasicMaterial({ map: m.map, color: new THREE.Color(1.3, 1.3, 1.3), toneMapped: false }) : new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
        o.receiveShadow = true; return;
      }
      if (g && g.vcol) { // 色 × 光を頂点の色に焼いた物(葉・草・岩)
        const k = g.lightScale || 1; o.material = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(k, k, k), side: THREE.DoubleSide });
      } else if (g && g.unlit) {
        o.material = new THREE.MeshBasicMaterial({ map: o.material.map, toneMapped: false, fog: !g.nofog, transparent: (g.opacity ?? 1) < 1, opacity: g.opacity ?? 1, side: THREE.DoubleSide });
      } else if (g) {
        // 焼いた光の面は MeshBasic(色 × 光の画像)。動く光(太陽・半球光)は作品と金属だけに効かせ、二重に明るくならないようにする
        const tr = { transparent: (g.opacity ?? 1) < 1, opacity: g.opacity ?? 1, depthWrite: (g.opacity ?? 1) >= 1 };
        if (light[key]) { o.geometry.setAttribute("uv2", o.geometry.attributes.uv); o.material = new THREE.MeshBasicMaterial({ map: o.material.map, lightMap: light[key], lightMapIntensity: g.lightScale || 1, ...tr }); }
        else o.material = new THREE.MeshStandardMaterial({ map: o.material.map, roughness: g.rough, metalness: g.metal, ...tr });
        o.receiveShadow = true;
      } else { // 光る物
        const c = o.material.emissive ? o.material.emissive.clone() : new THREE.Color(1, 1, 1);
        o.material = new THREE.MeshBasicMaterial({ color: c.multiplyScalar(1.6), toneMapped: false });
      }
    });
    if (!info.spots || !info.spots.length) { // 作品の場所が json に無ければ、GLB の空オブジェクト spot_1, spot_2 … の extras から
      const sp = []; root.traverse((o) => { if (/^spot_\d+$/.test(o.name)) sp.push(o); });
      info.spots = sp.sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true })).map((o) => o.userData);
    }
    return { info, root };
  }

  // 床の映り込み(json の reflect)。w・l を渡すとその大きさにする(展示室を増やしたとき)
  function mirror(info, w, l) {
    const R = info.reflect; if (!R || !THREE.Reflector) return null;
    const geo = w ? new THREE.PlaneGeometry(w, l) : R.r ? new THREE.CircleGeometry(R.r, 64) : new THREE.PlaneGeometry(R.w, R.l);
    const m = new THREE.Reflector(geo, { textureWidth: 1024, textureHeight: 1024, color: R.color || 0x777777 });
    m.rotation.x = -Math.PI / 2; m.position.set(R.x || 0, (R.y || 0) - 0.004, R.z || 0); return m;
  }
  // 映り込みの floor の組は少し透かして、下の鏡を見せる
  const glossFloor = (info, root) => { const R = info.reflect; if (R) root.traverse((o) => { if (o.isMesh && o.userData.group === (R.group || "floor")) Object.assign(o.material, { transparent: true, opacity: R.opacity ?? 0.85 }); }); };

  function env(r, scene, x, y, z) {
    const cube = new THREE.CubeCamera(0.1, 200, new THREE.WebGLCubeRenderTarget(256, { encoding: THREE.sRGBEncoding, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter }));
    cube.position.set(x, y, z); scene.add(cube); cube.update(r, scene); scene.remove(cube);
    const pm = new THREE.PMREMGenerator(r), rt = pm.fromCubemap(cube.renderTarget.texture); pm.dispose(); cube.renderTarget.dispose(); return rt;
  }

  window.BlenderWorld = { load, mirror, glossFloor, env };
})();
