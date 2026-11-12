// PS1-рендер: вершинное освещение (Гуро), привязка вершин к сетке,
// аффинное текстурирование, 15-битная палитра с упорядоченным дизерингом, туман.
import * as THREE from 'three';

export const MAX_LIGHTS = 6;

// Общие uniform-объекты: один набор на все материалы.
export const G = {
  uSnap: { value: new THREE.Vector2(160, 120) },
  uFogColor: { value: new THREE.Color(0x0b0b0d) },
  uFogNear: { value: 4 },
  uFogFar: { value: 40 },
  uAmbientIn: { value: new THREE.Color(0x15130f) },
  uAmbientOut: { value: new THREE.Color(0x3a3d3a) },
  uSunDir: { value: new THREE.Vector3(0.3, 1, 0.2).normalize() },
  uSunCol: { value: new THREE.Color(0x404038) },
  uLightPos: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector3(0, -100, 0)) },
  uLightCol: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Color(0)) },
  uLightRange: { value: new Array(MAX_LIGHTS).fill(1) },
  uTime: { value: 0 },
  uWarp: { value: 0 }, // «плывущий» экран от усталости капитана
};

const vert = /* glsl */`
  #define MAXL ${MAX_LIGHTS}
  uniform vec2 uSnap;
  uniform float uFogNear, uFogFar;
  uniform vec3 uAmbientIn, uAmbientOut, uSunDir, uSunCol;
  uniform vec3 uLightPos[MAXL];
  uniform vec3 uLightCol[MAXL];
  uniform float uLightRange[MAXL];
  uniform vec3 uColor, uEmissive;
  uniform float uOutdoor, uTime, uWarp;
  varying vec3 vUvw;
  varying vec3 vCol;
  varying float vFog;
  #ifdef USE_VCOLOR
  attribute vec3 color;
  #endif
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec3 n = normalize(mat3(modelMatrix) * normal);
    vec3 light = mix(uAmbientIn, uAmbientOut, uOutdoor);
    light += uSunCol * max(dot(n, uSunDir), 0.0) * uOutdoor;
    for (int i = 0; i < MAXL; i++) {
      vec3 L = uLightPos[i] - world.xyz;
      float d = length(L);
      float att = clamp(1.0 - d / uLightRange[i], 0.0, 1.0);
      att *= att;
      float lam = max(dot(n, L / max(d, 0.001)), 0.0) * 0.75 + 0.25;
      light += uLightCol[i] * att * lam;
    }
    vec3 c = uColor;
    #ifdef USE_VCOLOR
    c *= color;
    #endif
    vCol = c * light + uEmissive;
    vec4 mv = viewMatrix * world;
    vec4 clip = projectionMatrix * mv;
    if (uWarp > 0.0) clip.x += sin(uTime * 1.7 + world.y * 2.0) * uWarp * 0.02 * clip.w;
    vec2 g = uSnap * 0.5;
    clip.xy = floor(clip.xy / clip.w * g + 0.5) / g * clip.w;
    vUvw = vec3(uv * clip.w, clip.w);
    vFog = smoothstep(uFogNear, uFogFar, -mv.z);
    gl_Position = clip;
  }
`;

const frag = /* glsl */`
  uniform sampler2D map;
  uniform vec3 uFogColor;
  uniform float uAffine, uOpacity;
  varying vec3 vUvw;
  varying vec3 vCol;
  varying float vFog;
  float bayer(vec2 p) {
    vec2 q = mod(floor(p), 4.0);
    int i = int(q.x + q.y * 4.0);
    float m[16];
    m[0]=0.;m[1]=8.;m[2]=2.;m[3]=10.;m[4]=12.;m[5]=4.;m[6]=14.;m[7]=6.;
    m[8]=3.;m[9]=11.;m[10]=1.;m[11]=9.;m[12]=15.;m[13]=7.;m[14]=13.;m[15]=5.;
    for (int k = 0; k < 16; k++) if (k == i) return m[k] / 16.0;
    return 0.0;
  }
  void main() {
    // Аффинная интерполяция UV (как на PS1), частично смешанная с перспективной.
    vec2 uvA = vUvw.xy / vUvw.z;
    vec4 t = texture2D(map, uvA);
    if (t.a < 0.5) discard;
    vec3 c = t.rgb * vCol;
    c = mix(c, uFogColor, vFog);
    c += (bayer(gl_FragCoord.xy) - 0.5) / 28.0;
    c = floor(clamp(c, 0.0, 1.0) * 31.0 + 0.5) / 31.0;
    gl_FragColor = vec4(c, uOpacity);
  }
`;

const white = (() => {
  const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
})();

/**
 * Материал в стиле PS1.
 * @param {object} o { map, color, emissive, outdoor, vcolor, transparent, opacity, side }
 */
export function mat(o = {}) {
  const m = new THREE.ShaderMaterial({
    uniforms: {
      ...G,
      map: { value: o.map || white },
      uColor: { value: new THREE.Color(o.color ?? 0xffffff) },
      uEmissive: { value: new THREE.Color(o.emissive ?? 0x000000) },
      uOutdoor: { value: o.outdoor ? 1 : 0 },
      uAffine: { value: 1 },
      uOpacity: { value: o.opacity ?? 1 },
    },
    vertexShader: vert,
    fragmentShader: frag,
    side: o.side ?? THREE.FrontSide,
    transparent: !!o.transparent,
    depthWrite: o.depthWrite ?? true,
    defines: o.vcolor ? { USE_VCOLOR: '' } : {},
  });
  return m;
}

/** Набор источников света, которые пишутся в общие uniform-массивы. */
export class Lights {
  constructor() { this.list = []; }
  add(pos, color, range, intensity = 1) {
    const l = { pos: pos.clone(), color: new THREE.Color(color), range, intensity, flicker: 0, base: intensity, on: true };
    this.list.push(l);
    return l;
  }
  sync(time) {
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const l = this.list[i];
      if (!l || !l.on || l.intensity <= 0.001) {
        G.uLightCol.value[i].setRGB(0, 0, 0);
        G.uLightPos.value[i].set(0, -999, 0);
        continue;
      }
      let k = l.intensity;
      if (l.flicker) k *= 1 - l.flicker * (0.5 + 0.5 * Math.sin(time * 13.1 + i * 7) * Math.sin(time * 7.3 + i));
      G.uLightPos.value[i].copy(l.pos);
      G.uLightCol.value[i].copy(l.color).multiplyScalar(k);
      G.uLightRange.value[i] = l.range;
    }
  }
}
