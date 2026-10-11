// 立体のシェーダー(GLSL)。試作(js/home3d.js)と同じもの。three r128 の ShaderMaterial に渡す。

/** ガラス・つや消しの共通の頂点: 立体の中の位置(辺の長さで割る)・面の向き・目への向き */
export const SOLID_VS = /* glsl */ `
  uniform float uSize;
  varying vec3 vN; varying vec3 vV; varying vec3 vP;
  void main() {
    vP = position / uSize;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vN = normalize(mat3(modelMatrix) * normal);
    vV = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

/** ガラスの面: 縁ほど濃く、色は青から金へ。景色の映り込みと柔らかい光 */
export const GLASS_FS = /* glsl */ `
  uniform vec3 uA; uniform vec3 uB; uniform vec3 uTint;
  uniform float uAlpha; uniform float uRim; uniform float uGlow; uniform float uWarm; uniform float uEdge;
  uniform vec3 uSky; uniform vec3 uHor; uniform vec3 uL; uniform float uSpec; uniform float uEnv; uniform float uCol; uniform vec3 uGrad;
  varying vec3 vN; varying vec3 vV; varying vec3 vP;
  void main() {
    vec3 N = normalize(vN);
    vec3 V = normalize(vV);
    if (dot(N, V) < 0.0) N = -N;
    float f = pow(1.0 - abs(dot(N, V)), 2.0);
    vec3 r = reflect(-V, N);
    vec3 env = mix(uHor, uSky, smoothstep(-0.15, 0.85, r.y));
    float sp = pow(max(dot(r, normalize(uL)), 0.0), 28.0);
    vec3 a = abs(vP) * 2.0;
    float mx = max(a.x, max(a.y, a.z));
    float mn = min(a.x, min(a.y, a.z));
    float e = a.x + a.y + a.z - mx - mn;
    float edge = smoothstep(0.7, 1.0, e);
    float t = 0.5 + dot(vP, uGrad);
    vec3 c = mix(uA, uB, smoothstep(0.55, 1.05, t) * uWarm);
    vec3 col = mix(uTint, c, clamp(uCol + (1.0 - uCol) * max(f, edge * 0.8), 0.0, 1.0));
    col = mix(col, env, uEnv * (0.35 + 0.65 * f));
    col = mix(col, c, 0.3 * uGlow);
    col += sp * uSpec;
    float al = uAlpha + uRim * f + uEdge * edge + sp * uSpec * 0.6;
    al *= 1.0 + 0.8 * uGlow;
    gl_FragColor = vec4(col, clamp(al, 0.0, 1.0));
    #include <encodings_fragment>
  }`;

/** つや消しの面: やわらかい光(上と左の手前から)。影の側も沈みすぎない */
export const MATTE_FS = /* glsl */ `
  uniform vec3 uLit; uniform vec3 uShade; uniform vec3 uRimC; uniform float uGlow; uniform float uSize;
  varying vec3 vN; varying vec3 vV; varying vec3 vP;
  void main() {
    vec3 N = normalize(vN);
    float d = 0.5 + 0.5 * dot(N, normalize(vec3(-0.45, 0.8, 0.5)));
    d = d * d * (3.0 - 2.0 * d);
    vec3 col = mix(uShade, uLit, d);
    col = mix(col, uLit, 0.12 * (vP.y + 0.5));
    float f = pow(1.0 - abs(dot(N, normalize(vV))), 3.0);
    col = mix(col, uRimC, 0.25 * f);
    col = mix(col, uLit, 0.25 * uGlow);
    gl_FragColor = vec4(col, 1.0);
    #include <encodings_fragment>
  }`;

/**
 * 帯(ロゴの青と金)。帯は Box を囲むので、Box の中心を通りカメラに向いた面で「奥の半分」と「手前の半分」に分け、
 * 奥はガラスより先に(ガラス越しに見える)、手前はガラスのあとに描く(uSide: 奥 = -1、手前 = +1)
 */
export const RIBBON_VS = /* glsl */ `
  uniform vec3 uCenter;
  varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying float vSide;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vN = normalize(mat3(modelMatrix) * normal);
    vV = normalize(cameraPosition - wp.xyz);
    vSide = dot(wp.xyz - uCenter, normalize(cameraPosition - uCenter));
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

export const RIBBON_FS = /* glsl */ `
  uniform vec3 uC; uniform float uA; uniform float uGlow; uniform float uSide;
  varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying float vSide;
  void main() {
    if (vSide * uSide < 0.0) discard;
    float y = vUv.y;
    float edge = smoothstep(0.0, 0.3, y) * (1.0 - smoothstep(0.7, 1.0, y));
    float hair = 0.9 + 0.1 * sin(y * 22.0 + sin(vUv.x * 14.0) * 1.4);
    float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
    float a = uA * edge * hair * (0.5 + 0.5 * f) * (1.0 + 0.5 * uGlow);
    gl_FragColor = vec4(uC, clamp(a, 0.0, 1.0));
    #include <encodings_fragment>
  }`;

/** 床の格子: 真ん中から外へ、手前(札のある所)では消える。消え方は画素ごとに(線は端の 2 点しかないため)。xScale = 横の広さ */
export const gridVS = (xScale: number): string => /* glsl */ `
  uniform float uSize; varying vec2 vQ;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vQ = vec2(position.x / ${xScale.toFixed(3)}, position.z / 3.2);
    gl_PointSize = uSize;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

export const gridFS = (points: boolean): string => /* glsl */ `
  uniform vec3 uC; uniform float uA; varying vec2 vQ;
  void main() {
    float vF = (1.0 - smoothstep(0.3, 1.0, length(vQ))) * (1.0 - smoothstep(0.12, 0.55, vQ.y));
    ${points ? "vec2 d = gl_PointCoord - 0.5; if (dot(d, d) > 0.25) discard;" : ""}
    gl_FragColor = vec4(uC, uA * vF);
    #include <encodings_fragment>
  }`;
