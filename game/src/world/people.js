// Low-poly люди: 5 деталей на человека, одна текстура-атлас на тип (дёшево для телефона).
import * as THREE from 'three';
import { mat } from '../engine/ps1.js';
import { toTex } from '../engine/textures.js';

// Типы внешности: цвета областей атласа
const LOOKS = {
  soldier: { uni: '#5c5a3e', pants: '#4a4632', helmet: '#4c5440', hair: '#2a2018' },
  officer: { uni: '#6a6248', pants: '#3a3428', helmet: '#3e3a2c', hair: '#2a2018' },
  enemy: { uni: '#5e605c', pants: '#4a4c48', helmet: '#40443e', hair: '#2a2018' },
  medic: { uni: '#a8a490', pants: '#4a4632', helmet: '#4c5440', hair: '#3a2a1a', arm: '#a02018' },
  olya: { uni: '#6a6650', pants: '#4a4632', helmet: '#4c5440', hair: '#3a2a1a' },
  wounded: { uni: '#7a7458', pants: '#4a4632', helmet: '#4c5440', hair: '#2a2018', arm: '#d8d0c0' },
};
const R = { uni: 0, pants: 1, skin: 2, boots: 3, helmet: 4, face: 5, hair: 6, arm: 7, belt: 8 };
const atlas = new Map();

function lookMat(look, beard, pale) {
  const key = `${look}|${beard ? 1 : 0}|${pale ? 1 : 0}`;
  if (atlas.has(key)) return atlas.get(key);
  const L = LOOKS[look] || LOOKS.soldier;
  const c = document.createElement('canvas'); c.width = 24; c.height = 24;
  const x = c.getContext('2d');
  const cell = (i, col) => { x.fillStyle = col; x.fillRect((i % 3) * 8, Math.floor(i / 3) * 8, 8, 8); };
  const skin = pale ? '#b49480' : '#b08060';
  cell(R.uni, L.uni); cell(R.pants, L.pants); cell(R.skin, skin); cell(R.boots, '#221e18'); cell(R.helmet, L.helmet);
  cell(R.hair, L.hair); cell(R.arm, L.arm || L.uni); cell(R.belt, '#3a2a1a');
  // лицо 8×8
  const fx = (R.face % 3) * 8, fy = Math.floor(R.face / 3) * 8;
  x.fillStyle = skin; x.fillRect(fx, fy, 8, 8);
  x.fillStyle = '#1a1612'; x.fillRect(fx + 2, fy + 3, 1, 1); x.fillRect(fx + 5, fy + 3, 1, 1);
  x.fillStyle = '#7a5040'; x.fillRect(fx + 3, fy + 6, 2, 1);
  if (beard) { x.fillStyle = '#4a3a2c'; x.fillRect(fx + 1, fy + 5, 6, 3); }
  // шум формы
  for (let i = 0; i < 40; i++) { x.fillStyle = `rgba(0,0,0,${Math.random() * 0.15})`; x.fillRect(Math.random() * 24, Math.random() * 24, 1, 1); }
  const t = toTex(c, false);
  const m = mat({ map: t, outdoor: true });
  atlas.set(key, m);
  return m;
}

const cellUV = (i) => [((i % 3) * 8 + 4) / 24, 1 - (Math.floor(i / 3) * 8 + 4) / 24];

/** Коробка с UV: все грани — однотонная область атласа, перед (+z) — опционально «лицо». */
function partGeo(w, h, d, region, frontRegion, oy = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, oy, 0);
  const uv = g.attributes.uv;
  const [u, v] = cellUV(region);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u, v);
  if (frontRegion !== undefined) {
    const fx = (frontRegion % 3) * 8 / 24, fy = 1 - (Math.floor(frontRegion / 3) * 8 + 8) / 24;
    // грань +z: вершины 16..19 (0,1 — верх; 2,3 — низ)
    const s = 8 / 24;
    uv.setXY(16, fx, fy + s); uv.setXY(17, fx + s, fy + s); uv.setXY(18, fx, fy); uv.setXY(19, fx + s, fy);
  }
  return g;
}

function mergeParts(list) {
  const pos = [], nor = [], uv = [], idx = [];
  let off = 0;
  for (const g of list) {
    const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nor.push(n.getX(i), n.getY(i), n.getZ(i)); uv.push(u.getX(i), u.getY(i)); }
    for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + off);
    off += p.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

const geoCache = new Map();
function bodyGeo(kind) {
  if (geoCache.has(kind)) return geoCache.get(kind);
  const parts = [];
  parts.push(partGeo(0.42, 0.56, 0.24, R.uni, undefined, 0.28));             // торс
  parts.push(partGeo(0.44, 0.07, 0.26, R.belt, undefined, 0.04));            // ремень
  parts.push(partGeo(0.22, 0.25, 0.22, R.skin, R.face, 0.73));               // голова
  if (kind === 'cap') { parts.push(partGeo(0.25, 0.08, 0.26, R.helmet, undefined, 0.89)); parts.push(partGeo(0.22, 0.02, 0.1, R.helmet, undefined, 0.86).translate(0, 0, 0.15)); }
  else if (kind === 'hair') { parts.push(partGeo(0.24, 0.08, 0.24, R.hair, undefined, 0.88)); parts.push(partGeo(0.22, 0.22, 0.05, R.hair, undefined, 0.72).translate(0, 0, -0.12)); }
  else if (kind === 'bare') parts.push(partGeo(0.23, 0.06, 0.23, R.hair, undefined, 0.88));
  else { parts.push(partGeo(0.3, 0.1, 0.32, R.helmet, undefined, 0.88)); parts.push(partGeo(0.24, 0.06, 0.26, R.helmet, undefined, 0.95)); }
  const g = mergeParts(parts);
  geoCache.set(kind, g);
  return g;
}
const armGeo = mergeParts([partGeo(0.12, 0.52, 0.12, R.uni, undefined, -0.24), partGeo(0.1, 0.1, 0.1, R.skin, undefined, -0.54)]);
const armGeoBand = mergeParts([partGeo(0.12, 0.52, 0.12, R.uni, undefined, -0.24), partGeo(0.13, 0.08, 0.13, R.arm, undefined, -0.1), partGeo(0.1, 0.1, 0.1, R.skin, undefined, -0.54)]);
const legGeo = mergeParts([partGeo(0.16, 0.5, 0.17, R.pants, undefined, -0.25), partGeo(0.17, 0.42, 0.2, R.boots, undefined, -0.68).translate(0, 0, 0.01)]);

const rifleGeo = new THREE.BoxGeometry(0.04, 0.04, 1.1);
const crateGeo = new THREE.BoxGeometry(0.55, 0.3, 0.35);
let rifleMat = null, crateMat = null;

/**
 * o: { look: soldier|officer|enemy|medic|olya|wounded, head: helmet|cap|hair|bare, beard, pale, rifle, pose }
 */
export function makePerson(o = {}) {
  const m = lookMat(o.look || 'soldier', o.beard, o.pale);
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const hips = new THREE.Group(); hips.position.y = 0.92; body.add(hips);
  const torso = new THREE.Group(); hips.add(torso);
  torso.add(new THREE.Mesh(bodyGeo(o.head || 'helmet'), m));
  const arm = (x) => { const g = new THREE.Group(); g.position.set(x, 0.52, 0); g.add(new THREE.Mesh(o.look === 'medic' || o.look === 'wounded' ? armGeoBand : armGeo, m)); torso.add(g); return g; };
  const armL = arm(-0.28), armR = arm(0.28);
  const leg = (x) => { const g = new THREE.Group(); g.position.set(x, 0, 0); g.add(new THREE.Mesh(legGeo, m)); hips.add(g); return g; };
  const legL = leg(-0.11), legR = leg(0.11);
  const p = { root, body, hips, torso, armL, armR, legL, legR, phase: Math.random() * 6, pose: 'stand', walking: false, talk: 0, firing: 0 };
  if (o.rifle) {
    rifleMat = rifleMat || mat({ color: 0x3a2a1a, outdoor: true });
    const r = new THREE.Mesh(rifleGeo, rifleMat); r.position.set(0.05, -0.3, 0.1); r.rotation.x = 1.3; armR.add(r); p.rifle = r;
  }
  crateMat = crateMat || mat({ color: 0x5a6040, outdoor: true });
  const crate = new THREE.Mesh(crateGeo, crateMat); crate.position.set(-0.28, -0.4, 0.35); crate.visible = false; armR.add(crate); p.crate = crate;
  setPose(p, o.pose || 'stand');
  return p;
}

export function setPose(p, pose) {
  if (p.pose === pose && p._init) return;
  p._init = true;
  p.pose = pose;
  p.body.rotation.set(0, 0, 0); p.body.position.set(0, 0, 0);
  p.hips.position.y = 0.92;
  for (const l of [p.legL, p.legR, p.armL, p.armR, p.torso]) l.rotation.set(0, 0, 0);
  p.crate.visible = false;
  if (pose === 'sit') { p.hips.position.y = 0.48; p.legL.rotation.x = p.legR.rotation.x = -1.5; p.armL.rotation.x = p.armR.rotation.x = -0.8; }
  else if (pose === 'lie') { p.body.rotation.x = -Math.PI / 2; p.body.position.set(0, 0.22, 0.9); }
  else if (pose === 'crouch') { p.hips.position.y = 0.62; p.legL.rotation.x = -1.2; p.legR.rotation.x = 0.3; p.torso.rotation.x = 0.25; p.armL.rotation.x = -1.3; p.armR.rotation.x = -1.4; }
  else if (pose === 'aim') { p.armL.rotation.x = -1.45; p.armR.rotation.x = -1.35; p.armL.rotation.z = -0.3; }
  else if (pose === 'carry') { p.armL.rotation.x = -0.9; p.armR.rotation.x = -0.9; p.crate.visible = true; }
  else if (pose === 'work') { p.torso.rotation.x = 0.5; p.hips.position.y = 0.88; }
}

export function animate(p, dt, t) {
  p.phase += dt * (p.walking ? 7 : 1.4);
  const s = Math.sin(p.phase);
  if (p.walking && (p.pose === 'stand' || p.pose === 'carry')) {
    p.legL.rotation.x = s * 0.6; p.legR.rotation.x = -s * 0.6;
    if (p.pose === 'stand') { p.armL.rotation.x = -s * 0.5; p.armR.rotation.x = s * 0.5; }
    p.hips.position.y = 0.92 + Math.abs(Math.cos(p.phase)) * 0.03;
  } else if (p.pose === 'stand') {
    p.legL.rotation.x = p.legR.rotation.x = 0;
    p.armL.rotation.x = s * 0.03;
    p.armR.rotation.x = p.talk > 0 ? -0.6 + Math.sin(t * 5) * 0.25 : -s * 0.03;
    p.hips.position.y = 0.92;
  } else if (p.pose === 'carry') { p.legL.rotation.x = p.legR.rotation.x = 0; }
  else if (p.pose === 'work') { p.armR.rotation.x = -1.2 + Math.sin(t * 6 + p.phase) * 0.7; p.armL.rotation.x = -0.8; }
  else if (p.pose === 'aim') { p.torso.rotation.y = Math.sin(t * 0.7 + p.phase) * 0.15; }
  else if (p.pose === 'sit') { p.armR.rotation.x = -0.8 + (p.talk > 0 ? Math.sin(t * 4) * 0.2 : 0); }
  else if (p.pose === 'lie') { p.torso.rotation.x = Math.sin(p.phase * 0.7) * 0.02; }
  if (p.talk > 0) p.talk -= dt;
}

/** Человек, идущий по маршруту; высоту берёт из функции пола. */
export class Walker {
  constructor(person, floorAt) { this.p = person; this.path = []; this.speed = 1.3; this.done = null; this.floorAt = floorAt; }
  go(points, done) { this.path = points.map((v) => ({ x: v.x, z: v.z })); this.done = done; }
  update(dt) {
    const r = this.p.root;
    if (!this.path.length) { this.p.walking = false; return; }
    const tgt = this.path[0];
    const dx = tgt.x - r.position.x, dz = tgt.z - r.position.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.08) { this.path.shift(); if (!this.path.length) { this.p.walking = false; const f = this.done; this.done = null; f && f(); } return; }
    this.p.walking = true;
    const st = Math.min(len, this.speed * dt);
    r.position.x += dx / len * st; r.position.z += dz / len * st;
    r.position.y = this.floorAt(r.position.x, r.position.z);
    const want = Math.atan2(dx, dz);
    r.rotation.y += ((want - r.rotation.y + Math.PI * 3) % (Math.PI * 2) - Math.PI) * Math.min(1, dt * 8);
  }
}
