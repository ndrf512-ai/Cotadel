// Low-poly люди в стиле PS1: 6 деталей на человека, атлас 32×32 на тип внешности.
// Роли различимы по головному убору, снаряжению и цвету формы.
// Анимации — целевые позы с плавным переходом + процедурные движения и случайные мелкие действия.
import * as THREE from 'three';
import { mat } from '../engine/ps1.js';
import { toTex } from '../engine/textures.js';

// Цветовые схемы. variant даёт разброс оттенков формы.
const LOOKS = {
  soldier: { uni: ['#5c5a3e', '#625f40', '#57563c'], pants: '#4a4632', helmet: '#4c5440', cap: '#4c5440', gear: 'roll' },
  officer: { uni: ['#6e664a'], pants: '#3a3a44', helmet: '#3e3a2c', cap: '#3c3e30', band: '#8a2018', gear: 'strap', boots: '#1a1612', coat: true },
  leader: { uni: ['#5a5a3c', '#605e40'], pants: '#46422e', helmet: '#465036', cap: '#4c5440', band: '#3a2a1a', gear: 'leader' },
  staff: { uni: ['#625c46'], pants: '#3a3a44', cap: '#4a4a36', band: '#8a2018', gear: 'strap', boots: '#1a1612' },
  enemy: { uni: ['#5e605c', '#585a56', '#64665e'], pants: '#4a4c48', helmet: '#40443e', cap: '#40443e', gear: 'pack', boots: '#2a2622' },
  medic: { uni: ['#b0ac98'], pants: '#4a4632', helmet: '#4c5440', cap: '#4c5440', arm: '#a02018', gear: 'bag' },
  signal: { uni: ['#5a5a40'], pants: '#4a4632', helmet: '#4c5440', cap: '#4c5440', gear: 'phone' },
  eng: { uni: ['#56523c'], pants: '#46402e', helmet: '#4c5440', cap: '#4c5440', gear: 'shovel' },
  supply: { uni: ['#4a4a3c'], pants: '#3e3a2c', helmet: '#4c5440', cap: '#5a4a38', gear: 'none', quilted: true },
  olya: { uni: ['#6a6650'], pants: '#4a4632', helmet: '#4c5440', cap: '#4a4a36', hair: '#3a2a1a', gear: 'none' },
  wounded: { uni: ['#7a7458'], pants: '#4a4632', helmet: '#4c5440', cap: '#4c5440', arm: '#d8d0c0', gear: 'none' },
};
// области атласа (сетка 4×4 по 8 пикселей)
const R = { uni: 0, uni2: 1, pants: 2, skin: 3, boots: 4, helmet: 5, face: 6, hair: 7, belt: 8, metal: 9, white: 10, arm: 11, canvas: 12, wood: 13, band: 14, cap: 15 };
const atlas = new Map();
const SKINS = ['#b08060', '#b8907a', '#a87458', '#c09a80'];

function lookMat(look, variant, face) {
  const key = `${look}|${variant}|${face}`;
  if (atlas.has(key)) return atlas.get(key);
  const L = LOOKS[look] || LOOKS.soldier;
  const c = document.createElement('canvas'); c.width = 32; c.height = 32;
  const x = c.getContext('2d');
  const cell = (i, col) => { x.fillStyle = col; x.fillRect((i % 4) * 8, Math.floor(i / 4) * 8, 8, 8); };
  const uni = L.uni[variant % L.uni.length];
  const skin = SKINS[face % SKINS.length];
  cell(R.uni, uni); cell(R.pants, L.pants); cell(R.skin, skin); cell(R.boots, L.boots || '#221e18');
  cell(R.helmet, L.helmet || '#4c5440'); cell(R.hair, L.hair || ['#2a2018', '#4a3828', '#6a5a40', '#1a1612'][face % 4]);
  cell(R.belt, '#3a2a1a'); cell(R.metal, '#3a3c38'); cell(R.white, '#d8d4c8'); cell(R.arm, L.arm || uni);
  cell(R.canvas, '#6a6448'); cell(R.wood, '#5a4430'); cell(R.band, L.band || L.cap || '#4c5440'); cell(R.cap, L.cap || '#4c5440');
  // вторая область формы: складки/стёганка
  const ux = (R.uni2 % 4) * 8, uy = Math.floor(R.uni2 / 4) * 8;
  x.fillStyle = uni; x.fillRect(ux, uy, 8, 8);
  x.fillStyle = 'rgba(0,0,0,.18)';
  if (L.quilted) for (let i = 0; i < 8; i += 2) x.fillRect(ux, uy + i, 8, 1);
  else { x.fillRect(ux + 3, uy, 1, 8); x.fillRect(ux + 1, uy + 2, 2, 2); x.fillRect(ux + 5, uy + 2, 2, 2); }
  // лицо
  const fx = (R.face % 4) * 8, fy = Math.floor(R.face / 4) * 8;
  x.fillStyle = skin; x.fillRect(fx, fy, 8, 8);
  x.fillStyle = 'rgba(0,0,0,.25)'; x.fillRect(fx + 1, fy + 2, 2, 1); x.fillRect(fx + 5, fy + 2, 2, 1); // брови
  x.fillStyle = '#1a1612'; x.fillRect(fx + 2, fy + 3, 1, 1); x.fillRect(fx + 5, fy + 3, 1, 1);
  x.fillStyle = 'rgba(0,0,0,.18)'; x.fillRect(fx + 4, fy + 4, 1, 2);
  x.fillStyle = '#7a5040'; x.fillRect(fx + 3, fy + 6, 2, 1);
  const f = face % 5;
  if (f === 1) { x.fillStyle = '#3a2a1c'; x.fillRect(fx + 2, fy + 5, 4, 1); }                  // усы
  if (f === 2) { x.fillStyle = 'rgba(40,30,20,.35)'; x.fillRect(fx + 1, fy + 5, 6, 3); }        // щетина
  if (f === 3) { x.fillStyle = '#4a3a2c'; x.fillRect(fx + 1, fy + 5, 6, 3); x.fillStyle = '#7a5040'; x.fillRect(fx + 3, fy + 6, 2, 1); } // борода
  if (f === 4) { x.fillStyle = 'rgba(160,40,30,.5)'; x.fillRect(fx + 6, fy + 1, 1, 3); }        // шрам
  if (f === 5) { x.fillStyle = '#2a2420'; x.fillRect(fx + 1, fy + 3, 3, 1); x.fillRect(fx + 4, fy + 3, 3, 1); x.fillRect(fx + 1, fy + 2, 1, 2); x.fillRect(fx + 6, fy + 2, 1, 2); x.fillStyle = 'rgba(200,220,220,.5)'; x.fillRect(fx + 2, fy + 3, 1, 1); x.fillRect(fx + 5, fy + 3, 1, 1); } // очки
  for (let i = 0; i < 60; i++) { const px = Math.random() * 32 | 0, py = Math.random() * 32 | 0; if (Math.floor(px / 8) + Math.floor(py / 8) * 4 === R.face) continue; x.fillStyle = `rgba(0,0,0,${Math.random() * 0.14})`; x.fillRect(px, py, 1, 1); }
  const m = mat({ map: toTex(c, false), outdoor: true });
  atlas.set(key, m);
  return m;
}

const cellUV = (i) => [((i % 4) * 8 + 4) / 32, 1 - (Math.floor(i / 4) * 8 + 4) / 32];

function part(w, h, d, region, front, tx = 0, ty = 0, tz = 0, rx = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  if (rz) g.rotateZ(rz);
  g.translate(tx, ty, tz);
  const uv = g.attributes.uv;
  const [u, v] = cellUV(region);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u, v);
  if (front !== undefined) {
    const s = 8 / 32, fx = (front % 4) * s, fy = 1 - (Math.floor(front / 4) + 1) * s;
    uv.setXY(16, fx, fy + s); uv.setXY(17, fx + s, fy + s); uv.setXY(18, fx, fy); uv.setXY(19, fx + s, fy);
  }
  return g;
}
function dome(r, region, ty, sy = 0.8) {
  const g = new THREE.SphereGeometry(r, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2);
  g.scale(1, sy, 1.08); g.translate(0, ty, 0);
  const uv = g.attributes.uv, [u, v] = cellUV(region);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u, v);
  return g;
}
function cyl(rt, rb, h, region, ty, seg = 7) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg); g.translate(0, ty, 0);
  const uv = g.attributes.uv, [u, v] = cellUV(region);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u, v);
  return g;
}

function merge(list) {
  const pos = [], nor = [], uv = [], idx = [];
  let off = 0;
  for (const g0 of list) {
    const g = g0.index ? g0 : g0;
    const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nor.push(n.getX(i), n.getY(i), n.getZ(i)); uv.push(u.getX(i), u.getY(i)); }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + off);
    else for (let i = 0; i < p.count; i++) idx.push(i + off);
    off += p.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

const cache = new Map();
function memo(k, f) { if (!cache.has(k)) cache.set(k, f()); return cache.get(k); }

/** Торс с шеей и снаряжением (без головы). */
function torsoGeo(gear, officer, coat) {
  return memo('t' + gear + officer + coat, () => {
    const p = [];
    p.push(part(0.40, 0.30, 0.23, R.uni2, undefined, 0, 0.42, 0));        // грудь
    p.push(part(0.36, 0.24, 0.21, R.uni, undefined, 0, 0.17, 0));         // живот
    p.push(part(0.40, 0.05, 0.23, R.belt, undefined, 0, 0.06, 0));        // ремень
    p.push(part(0.07, 0.05, 0.02, R.metal, undefined, 0, 0.06, 0.12));    // пряжка
    p.push(part(0.11, 0.10, 0.10, R.skin, undefined, 0, 0.6, 0));         // шея
    p.push(part(0.46, 0.08, 0.22, R.uni, undefined, 0, 0.55, 0));         // плечи
    if (gear === 'roll') p.push(part(0.09, 0.62, 0.09, R.canvas, undefined, 0, 0.36, 0.08, 0, 0.75)); // скатка через плечо
    if (gear === 'roll' || gear === 'pack') { p.push(part(0.08, 0.08, 0.06, R.belt, undefined, -0.12, 0.08, 0.12)); p.push(part(0.08, 0.08, 0.06, R.belt, undefined, 0.12, 0.08, 0.12)); }
    if (gear === 'pack') p.push(part(0.3, 0.32, 0.12, R.canvas, undefined, 0, 0.36, -0.16));
    if (gear === 'roll') p.push(part(0.08, 0.14, 0.06, R.metal, undefined, 0.19, 0.0, -0.06)); // фляга
    if (gear === 'roll' || gear === 'leader') p.push(part(0.18, 0.2, 0.1, R.canvas, undefined, -0.21, -0.04, 0.02)); // сумка противогаза
    if (gear === 'leader') { p.push(part(0.06, 0.1, 0.05, R.belt, undefined, -0.08, 0.08, 0.12), part(0.06, 0.1, 0.05, R.belt, undefined, 0.02, 0.08, 0.12), part(0.06, 0.1, 0.05, R.belt, undefined, 0.12, 0.08, 0.12)); p.push(part(0.03, 0.56, 0.02, R.belt, undefined, 0, 0.33, 0.12, 0, -0.62)); } // подсумки для дисков, ремень
    if (gear === 'pack') { p.push(part(0.1, 0.12, 0.08, R.metal, undefined, 0.2, -0.02, -0.06)); p.push(part(0.08, 0.2, 0.08, R.metal, undefined, -0.12, 0.05, -0.2)); } // фляга, лопатка
    if (gear === 'strap') { p.push(part(0.04, 0.58, 0.02, R.belt, undefined, 0.02, 0.33, 0.12, 0, 0.62)); p.push(part(0.2, 0.16, 0.05, R.belt, undefined, -0.22, -0.05, 0.04)); } // портупея и планшет
    if (gear === 'bag') { p.push(part(0.22, 0.2, 0.09, R.white, undefined, 0.2, 0.02, 0.06)); p.push(part(0.08, 0.08, 0.01, R.arm, undefined, 0.2, 0.04, 0.11)); }
    if (gear === 'phone') { p.push(part(0.26, 0.22, 0.14, R.metal, undefined, 0, 0.32, -0.18)); p.push(cyl(0.09, 0.09, 0.12, R.wood, 0, 7).rotateZ(Math.PI / 2).translate(0, 0.05, -0.2)); }
    if (gear === 'shovel') { p.push(part(0.04, 0.5, 0.03, R.wood, undefined, 0.1, 0.3, -0.15, 0, 0.3)); p.push(part(0.16, 0.18, 0.02, R.metal, undefined, 0.18, 0.06, -0.15, 0, 0.3)); }
    if (officer) p.push(part(0.08, 0.02, 0.05, R.band, undefined, -0.19, 0.6, 0), part(0.08, 0.02, 0.05, R.band, undefined, 0.19, 0.6, 0)); // погоны/петлицы
    if (officer) { p.push(part(0.12, 0.06, 0.06, R.metal, undefined, -0.06, 0.38, 0.14)); p.push(part(0.08, 0.13, 0.06, R.belt, undefined, 0.2, -0.02, 0.06)); } // бинокль, кобура
    if (coat) { p.push(part(0.46, 0.5, 0.29, R.uni2, undefined, 0, -0.23, 0)); p.push(part(0.47, 0.06, 0.3, R.uni, undefined, 0, 0.0, 0)); } // полы шинели
    return merge(p);
  });
}

function headGeo(hat) {
  return memo('h' + hat, () => {
    const p = [];
    p.push(part(0.2, 0.23, 0.21, R.skin, R.face, 0, 0.12, 0));
    p.push(part(0.04, 0.05, 0.04, R.skin, undefined, 0, 0.1, 0.12));            // нос
    p.push(part(0.03, 0.06, 0.04, R.skin, undefined, -0.11, 0.12, 0), part(0.03, 0.06, 0.04, R.skin, undefined, 0.11, 0.12, 0)); // уши
    if (hat !== 'hair') p.push(part(0.2, 0.13, 0.02, R.hair, undefined, 0, 0.17, -0.11)); // затылок
    if (hat === 'helmet') { p.push(dome(0.15, R.helmet, 0.18)); p.push(cyl(0.165, 0.17, 0.03, R.helmet, 0.19, 8)); p.push(part(0.012, 0.13, 0.012, R.belt, undefined, -0.105, 0.11, 0.04), part(0.012, 0.13, 0.012, R.belt, undefined, 0.105, 0.11, 0.04)); }
    else if (hat === 'ehelm') { p.push(dome(0.15, R.helmet, 0.17, 0.95)); p.push(cyl(0.15, 0.185, 0.07, R.helmet, 0.15, 8)); }
    else if (hat === 'cap') { p.push(cyl(0.15, 0.115, 0.06, R.cap, 0.27, 8)); p.push(cyl(0.118, 0.118, 0.04, R.band, 0.24, 8)); p.push(part(0.18, 0.015, 0.08, R.boots, undefined, 0, 0.23, 0.12)); }
    else if (hat === 'pilotka') { p.push(part(0.2, 0.07, 0.22, R.cap, undefined, 0.01, 0.25, 0, 0, 0.12)); }
    else if (hat === 'ushanka') { p.push(part(0.24, 0.1, 0.24, R.cap, undefined, 0, 0.27, 0)); p.push(part(0.05, 0.12, 0.14, R.cap, undefined, -0.12, 0.18, 0), part(0.05, 0.12, 0.14, R.cap, undefined, 0.12, 0.18, 0)); }
    else if (hat === 'hair') { p.push(part(0.22, 0.07, 0.22, R.hair, undefined, 0, 0.25, -0.005)); p.push(part(0.2, 0.18, 0.05, R.hair, undefined, 0, 0.13, -0.11)); p.push(part(0.16, 0.05, 0.18, R.cap, undefined, 0.02, 0.29, 0, 0, 0.2)); }
    else if (hat === 'bandage') { p.push(part(0.22, 0.06, 0.22, R.white, undefined, 0, 0.2, 0)); p.push(part(0.21, 0.04, 0.21, R.hair, undefined, 0, 0.245, 0)); }
    else p.push(part(0.21, 0.04, 0.21, R.hair, undefined, 0, 0.245, 0));
    return merge(p);
  });
}
const armGeo = (band) => memo('a' + band, () => merge([
  part(0.12, 0.3, 0.12, R.uni, undefined, 0, -0.14, 0), part(0.11, 0.26, 0.11, R.uni, undefined, 0, -0.4, 0.01),
  ...(band ? [part(0.13, 0.07, 0.13, R.arm, undefined, 0, -0.1, 0)] : []),
  part(0.08, 0.1, 0.09, R.skin, undefined, 0, -0.58, 0.01),
]));
const legGeo = (wide) => memo('l' + wide, () => merge([
  part(wide ? 0.19 : 0.16, 0.3, wide ? 0.2 : 0.17, R.pants, undefined, 0, -0.15, 0),
  part(0.14, 0.18, 0.15, R.pants, undefined, 0, -0.38, 0),
  part(0.15, 0.38, 0.17, R.boots, undefined, 0, -0.68, 0.0), part(0.14, 0.07, 0.24, R.boots, undefined, 0, -0.84, 0.04),
]));

let rifleMat, metalMat, propMat;
// оружие: винтовка (с затвором, ремнём, штыком у наших), автомат с диском
const rifleGeo = (bayonet) => memo('rifle' + bayonet, () => merge([
  part(0.05, 0.08, 0.32, R.wood, undefined, 0, -0.01, -0.35), part(0.04, 0.05, 0.55, R.wood, undefined, 0, 0, 0.08),
  part(0.022, 0.022, 0.4, R.metal, undefined, 0, 0.02, 0.5), part(0.02, 0.03, 0.06, R.metal, undefined, 0.03, 0.03, -0.12),
  part(0.006, 0.08, 0.5, R.belt, undefined, -0.025, -0.05, 0.0),
  ...(bayonet ? [part(0.01, 0.012, 0.28, R.metal, undefined, 0, 0.02, 0.83)] : []),
]));
const smgGeo = () => memo('smg', () => merge([
  part(0.045, 0.07, 0.22, R.wood, undefined, 0, -0.01, -0.22), part(0.05, 0.06, 0.2, R.wood, undefined, 0, 0, -0.02),
  part(0.04, 0.04, 0.3, R.metal, undefined, 0, 0.015, 0.22), cyl(0.07, 0.07, 0.05, R.metal, 0, 9).rotateZ(Math.PI / 2).translate(0, -0.06, 0.04),
]));

const ROLE_DEFAULTS = {
  soldier: { head: 'helmet' }, officer: { head: 'cap' }, staff: { head: 'cap' }, enemy: { head: 'ehelm' }, leader: { head: 'helmet' },
  medic: { head: 'pilotka' }, signal: { head: 'pilotka' }, eng: { head: 'helmet' }, supply: { head: 'ushanka' },
  olya: { head: 'hair' }, wounded: { head: 'bandage' },
};

/**
 * o: { look, head, beard, pale, rifle, pose, variant, face }
 */
export function makePerson(o = {}) {
  const look = o.look || 'soldier';
  const L = LOOKS[look] || LOOKS.soldier;
  const variant = o.variant ?? (Math.random() * 3 | 0);
  const face = o.face ?? (o.beard ? 3 : o.pale ? 0 : (Math.random() * 5 | 0));
  const gait = { speed: 0.85 + Math.random() * 0.3, swing: 0.8 + Math.random() * 0.45, lean: -0.04 + Math.random() * 0.1, tempo: 0.8 + Math.random() * 0.5 };
  const m = lookMat(look, variant, face);
  let head = o.head || ROLE_DEFAULTS[look]?.head || 'helmet';
  if (head === 'bare' && look !== 'wounded') head = 'pilotka';
  const officer = look === 'officer' || look === 'staff';
  if (look === 'enemy' && head === 'helmet') head = 'ehelm';
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const hips = new THREE.Group(); hips.position.y = 0.92; body.add(hips);
  const torso = new THREE.Group(); hips.add(torso);
  torso.add(new THREE.Mesh(torsoGeo(L.gear, officer, !!L.coat && !o.noCoat), m));
  const headG = new THREE.Group(); headG.position.y = 0.63; torso.add(headG);
  headG.add(new THREE.Mesh(headGeo(head), m));
  const arm = (x) => { const g = new THREE.Group(); g.position.set(x, 0.52, 0); g.add(new THREE.Mesh(armGeo(!!L.arm), m)); torso.add(g); return g; };
  const armL = arm(-0.26), armR = arm(0.26);
  const leg = (x) => { const g = new THREE.Group(); g.position.set(x, 0, 0); g.add(new THREE.Mesh(legGeo(officer), m)); hips.add(g); return g; };
  const legL = leg(-0.1), legR = leg(0.1);
  const p = { root, body, hips, torso, head: headG, armL, armR, legL, legR, phase: Math.random() * 6, pose: 'stand', walking: false, running: false,
    talk: 0, idle: { t: 1 + Math.random() * 5, act: null, d: 0 }, cur: null, role: look, fire: 0, gait };
  const weapon = o.weapon || (o.rifle ? 'rifle' : null);
  if (weapon) {
    rifleMat = rifleMat || mat({ color: 0x7a6650, outdoor: true });
    const r = new THREE.Mesh(weapon === 'smg' ? smgGeo() : rifleGeo(look !== 'enemy'), m);
    r.position.set(0.02, -0.5, 0.12); r.rotation.x = 1.45; armR.add(r); p.rifle = r; p.weapon = weapon;
  }
  propMat = propMat || mat({ color: 0x6a6448, outdoor: true });
  const crate = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.3, 0.35), propMat); crate.position.set(-0.26, -0.55, 0.3); crate.visible = false; armR.add(crate); p.crate = crate;
  const paper = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.01, 0.27), mat({ color: 0xd8d0b8, outdoor: true })); paper.position.set(-0.13, -0.6, 0.12); paper.visible = false; armR.add(paper); p.paper = paper;
  p.pose = o.pose || 'stand';
  p.cur = poseTarget(p, 0);
  applyPose(p, p.cur);
  return p;
}

/** Целевые углы суставов для позы. */
function poseTarget(p, t) {
  const T = { hipsY: 0.92, bodyX: 0, bodyY: 0, bodyZ: 0, torsoX: 0, torsoY: 0, torsoZ: 0, headX: 0, headY: 0, aLX: 0, aLZ: 0.06, aRX: 0, aRZ: -0.06, lLX: 0, lRX: 0 };
  switch (p.pose) {
    case 'sit': Object.assign(T, { hipsY: 0.47, lLX: -1.5, lRX: -1.4, aLX: -0.7, aRX: -0.75, torsoX: 0.12 }); break;
    case 'lie': Object.assign(T, { bodyX: -Math.PI / 2, bodyY: 0.22, bodyZ: 0.9, aLX: -0.3, aRX: -0.2, lLX: 0.1, lRX: -0.1 }); break;
    case 'crouch': Object.assign(T, { hipsY: 0.6, lLX: -1.25, lRX: 0.35, torsoX: 0.28, aLX: -1.2, aRX: -1.35 }); break;
    case 'aim': Object.assign(T, { aLX: -1.5, aLZ: -0.35, aRX: -1.25, torsoX: 0.05, headX: 0.08 }); break;
    case 'fire': Object.assign(T, { hipsY: 0.62, lLX: -1.25, lRX: 0.35, torsoX: 0.18, aLX: -1.6, aLZ: -0.35, aRX: -1.35, headX: 0.1 }); break;
    case 'prone': Object.assign(T, { bodyX: -Math.PI / 2 + 0.15, bodyY: 0.18, bodyZ: 0.85, aLX: -2.6, aRX: -2.5, headX: -1.1 }); break;
    case 'carry': Object.assign(T, { aLX: -1.0, aRX: -1.0, aLZ: 0.25, aRZ: -0.25 }); break;
    case 'work': Object.assign(T, { hipsY: 0.86, torsoX: 0.5, aLX: -0.9, aRX: -1.3 }); break;
    case 'phone': Object.assign(T, { aRX: -2.4, aRZ: -0.35, headY: 0.2, headX: 0.1, aLX: -0.4 }); break;
    case 'papers': Object.assign(T, { aLX: -1.0, aRX: -1.05, aLZ: 0.3, aRZ: -0.3, headX: 0.35 }); break;
    case 'sitdesk': Object.assign(T, { hipsY: 0.47, lLX: -1.5, lRX: -1.45, aLX: -1.1, aRX: -1.15, torsoX: 0.25, headX: 0.3 }); break;
    case 'cover': Object.assign(T, { hipsY: 0.5, lLX: -1.45, lRX: -0.3, torsoX: 0.55, headX: 0.35, aLX: -0.8, aRX: -0.9, aLZ: 0.2 }); break;   // пригнулся за бруствером
    case 'observe': Object.assign(T, { aLX: -2.2, aRX: -2.2, aLZ: -0.45, aRZ: 0.45, headX: -0.05 }); break;                                      // бинокль у глаз
    case 'attention': Object.assign(T, { aLZ: 0.02, aRZ: -0.02, torsoX: -0.04, headX: -0.03 }); break;                                            // смирно
    case 'report': Object.assign(T, { aLZ: 0.02, aRX: -0.7, aRZ: -0.2, torsoX: -0.03 }); break;                                                     // докладывает
    case 'point': Object.assign(T, { aRX: -1.55, aRZ: -0.15, torsoY: 0.15, headY: 0.15 }); break;                                                 // указывает
    case 'wounded': Object.assign(T, { bodyX: -Math.PI / 2, bodyY: 0.22, bodyZ: 0.9, aLX: -1.9, aLZ: 0.6, aRX: -0.2, lLX: 0.4, lRX: -0.25, headY: 0.5 }); break;
    case 'aid': Object.assign(T, { hipsY: 0.42, lLX: -1.55, lRX: 0.6, torsoX: 0.85, headX: 0.4, aLX: -1.6, aRX: -1.4, aLZ: 0.3, aRZ: -0.3 }); break;   // на коленях у раненого
    case 'stretcher': Object.assign(T, { aLX: -0.5, aRX: -0.5, aLZ: 0.08, aRZ: -0.08, torsoX: 0.12 }); break;                                       // несёт носилки
    case 'support': Object.assign(T, { aLX: -0.3, aLZ: 1.2, torsoZ: -0.1, aRX: -0.3 }); break;                                                     // поддерживает раненого
  }
  return T;
}

function applyPose(p, c) {
  p.hips.position.y = c.hipsY;
  p.body.rotation.set(c.bodyX, 0, 0); p.body.position.set(0, c.bodyY, c.bodyZ);
  p.torso.rotation.set(c.torsoX, c.torsoY, c.torsoZ);
  p.head.rotation.set(c.headX, c.headY, 0);
  p.armL.rotation.set(c.aLX, 0, c.aLZ); p.armR.rotation.set(c.aRX, 0, c.aRZ);
  p.legL.rotation.x = c.lLX; p.legR.rotation.x = c.lRX;
}

export function resetPose(p) { p.cur = poseTarget(p, 0); applyPose(p, p.cur); }

export function act(p, type, dur) { p.action = { type, t: dur }; }

export function setPose(p, pose) {
  p.pose = pose;
  p.crate.visible = pose === 'carry';
  p.paper.visible = pose === 'papers';
}

const IDLE = {
  stand: ['look', 'look', 'adjust', 'shift', 'rub'],
  aim: ['look', 'duck', 'look'],
  sit: ['look', 'stretch', 'talk'],
  sitdesk: ['write', 'look', 'write'],
  papers: ['flip', 'look'],
  crouch: ['look', 'peek'],
  work: [], lie: [], prone: [], carry: [], phone: ['look'], fire: [],
  cover: ['peek', 'look'], observe: ['look'], attention: [], report: [], point: [], wounded: [], aid: [], stretcher: [], support: [],
};

/** Анимация: процедурная надстройка над позой и плавный переход (без рывков). */
export function animate(p, dt, t) {
  const T = poseTarget(p, t);
  const walk = p.walking && (p.pose === 'stand' || p.pose === 'carry' || p.pose === 'stretcher' || p.pose === 'support');
  const g = p.gait || { speed: 1, swing: 1, lean: 0, tempo: 1 };
  p.phase += dt * (walk ? (p.running ? 11 : 7) * g.speed : 1.4 * g.tempo);
  const s = Math.sin(p.phase);
  if (walk) {
    const a = (p.running ? 0.9 : 0.55) * g.swing;
    T.lLX = s * a; T.lRX = -s * a;
    if (p.pose === 'stand') { T.aLX = -s * a * 0.8 - (p.running ? 0.5 : 0); T.aRX = s * a * 0.8 - (p.running ? 0.5 : 0); if (p.rifle && p.running) { T.aRX = -1.0; T.aLX = -1.1; } }
    T.hipsY = 0.92 + Math.abs(Math.cos(p.phase)) * (p.running ? 0.05 : 0.025);
    T.torsoX = (p.running ? 0.25 : 0.04) + g.lean;
    T.torsoY = s * 0.06;
  } else {
    // дыхание и осанка
    T.torsoX += Math.sin(p.phase * 0.9) * 0.012 + (p.pose === 'stand' ? g.lean * 0.6 : 0);
    // случайные мелкие действия
    const id = p.idle;
    id.t -= dt;
    if (id.t <= 0) {
      if (id.act) { id.act = null; id.t = 2 + Math.random() * 6; }
      else { const list = IDLE[p.pose] || []; id.act = list.length ? list[(Math.random() * list.length) | 0] : null; id.d = Math.random() < 0.5 ? -1 : 1; id.t = 1.2 + Math.random() * 2.2; }
    }
    switch (id.act) {
      case 'look': T.headY += id.d * 0.7; T.torsoY += id.d * 0.12; break;
      case 'adjust': T.aLX = -2.3; T.aLZ = 0.3; T.headX = 0.15; break;
      case 'shift': T.torsoZ = id.d * 0.06; T.hipsY -= 0.01; T.lLX = id.d * 0.12; break;
      case 'rub': T.aRX = -1.2; T.aRZ = 0.4; T.aLX = -1.2; T.aLZ = -0.4; break;
      case 'duck': T.hipsY = 0.62; T.lLX = -1.2; T.lRX = 0.3; T.torsoX = 0.4; T.headX = 0.4; break;
      case 'peek': T.hipsY += 0.12; T.headX = -0.15; break;
      case 'stretch': T.aLX = -2.8; T.aRX = -2.8; T.torsoX = -0.1; break;
      case 'talk': T.aRX = -0.9 + Math.sin(t * 5) * 0.3; T.headY = id.d * 0.3; break;
      case 'write': T.aRX = T.aRX + Math.sin(t * 9) * 0.06; T.aRZ += Math.sin(t * 4) * 0.08; break;
      case 'flip': T.aLX -= 0.4; T.aLZ += Math.sin(t * 6) * 0.2; break;
    }
    if (p.pose === 'work') { T.aRX = -1.3 + Math.sin(t * 6 + p.phase) * 0.75; T.torsoX = 0.5 + Math.sin(t * 6 + p.phase) * 0.08; }
    if (p.pose === 'phone') T.headY += Math.sin(t * 0.8) * 0.15;
  }
  if (p.talk > 0) { T.aRX = Math.min(T.aRX, -0.6) + Math.sin(t * 5) * 0.25; T.aRZ = -0.3; T.headX -= 0.05; p.talk -= dt; }
  // короткие действия поверх позы
  const A = p.action;
  if (A) {
    A.t -= dt;
    const k = Math.min(1, A.t * 3);
    if (A.type === 'reload') { T.aLX = -0.9; T.aRX = -1.1 + Math.sin(t * 14) * 0.15; T.headX = 0.45; }
    else if (A.type === 'point') { T.aRX = -1.6; T.aRZ = -0.1; T.headY += 0.2; }
    else if (A.type === 'salute') { T.aRX = -2.6 * k; T.aRZ = -0.6 * k; T.torsoX = -0.04; }
    else if (A.type === 'popup') { T.hipsY = Math.max(T.hipsY, 0.7); T.torsoX = 0.15; T.aLX = -1.6; T.aRX = -1.35; T.aLZ = -0.35; T.headX = 0.1; }
    else if (A.type === 'flinch') { T.torsoX += 0.35; T.headX += 0.4; T.hipsY -= 0.08; }
    if (A.t <= 0) p.action = null;
  }
  // плавный поворот на месте
  if (p.wantYaw !== undefined && !p.walking) {
    const r = p.root.rotation;
    const d = ((p.wantYaw - r.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    r.y += d * Math.min(1, dt * 5);
    if (Math.abs(d) > 0.3) { T.lLX += Math.sin(t * 9) * 0.25; T.lRX -= Math.sin(t * 9) * 0.25; } // переступает при повороте
  }
  if (p.fire > 0) { T.torsoX -= p.fire * 0.4; p.fire = Math.max(0, p.fire - dt * 6); }
  if (p.lookAt !== undefined) { T.headY = THREE.MathUtils.clamp(p.lookAt, -0.9, 0.9); }
  // плавный переход к цели
  const c = p.cur;
  const k = 1 - Math.exp(-dt * (p.pose === 'lie' || p.pose === 'prone' || p.pose === 'wounded' ? 5 : 9));
  for (const key in T) c[key] += (T[key] - c[key]) * k;
  applyPose(p, c);
}

/** Человек, идущий по маршруту; высоту берёт из функции пола. */
export class Walker {
  constructor(person, floorAt) { this.p = person; this.path = []; this.speed = 1.3; this.done = null; this.floorAt = floorAt; }
  go(points, done) { this.path = points.map((v) => ({ x: v.x, z: v.z })); this.done = done; }
  update(dt) {
    const r = this.p.root;
    this.p.running = this.speed > 2.4;
    if (!this.path.length) { this.p.walking = false; return; }
    const tgt = this.path[0];
    const dx = tgt.x - r.position.x, dz = tgt.z - r.position.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.08) { this.path.shift(); if (!this.path.length) { this.p.walking = false; const f = this.done; this.done = null; f && f(); } return; }
    this.p.walking = true;
    const st = Math.min(len, this.speed * dt);
    r.position.x += dx / len * st; r.position.z += dz / len * st;
    const fy = this.floorAt(r.position.x, r.position.z);
    r.position.y += (fy - r.position.y) * Math.min(1, dt * 12);
    const want = Math.atan2(dx, dz);
    r.rotation.y += ((want - r.rotation.y + Math.PI * 3) % (Math.PI * 2) - Math.PI) * Math.min(1, dt * 6);
  }
}
