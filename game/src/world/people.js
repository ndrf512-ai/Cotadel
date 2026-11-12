// Low-poly люди (~150 треугольников) с простыми «деревянными» анимациями.
import * as THREE from 'three';
import { boxGeo } from '../engine/geo.js';
import { mat } from '../engine/ps1.js';

const geoCache = new Map();
function g(w, h, d) {
  const k = `${w}|${h}|${d}`;
  if (!geoCache.has(k)) geoCache.set(k, boxGeo(w, h, d, 1));
  return geoCache.get(k);
}

function part(parent, w, h, d, x, y, z, m, pivotY = 0) {
  // pivotY: смещение геометрии относительно сустава (для рук/ног — вниз)
  const pivot = new THREE.Group();
  pivot.position.set(x, y, z);
  const mesh = new THREE.Mesh(g(w, h, d), m);
  mesh.position.y = pivotY;
  pivot.add(mesh);
  parent.add(pivot);
  return pivot;
}

export function makePerson(tex, o = {}) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const uni = mat({ map: tex.uniform, color: o.color ?? 0xffffff });
  const dark = mat({ color: o.pants ?? 0x4a4632 });
  const boots = mat({ color: 0x24201a });
  const skin = mat({ color: 0xb08468 });
  const faceM = mat({ map: o.beard ? tex.faceBeard : o.pale ? tex.facePale : tex.face });
  const helmet = mat({ color: o.helmetColor ?? 0x4c5440 });

  const hips = new THREE.Group(); hips.position.y = 0.92; body.add(hips);
  const torso = part(hips, 0.42, 0.56, 0.24, 0, 0, 0, uni, 0.28);
  // голова
  const head = new THREE.Group(); head.position.y = 0.6; torso.add(head);
  const skull = new THREE.Mesh(g(0.22, 0.25, 0.22), skin); skull.position.y = 0.13; head.add(skull);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.21, 0.24), faceM); face.position.set(0, 0.13, 0.111); head.add(face);
  if (o.cap) {
    const c = new THREE.Mesh(g(0.25, 0.08, 0.26), helmet); c.position.set(0, 0.28, 0); head.add(c);
    const v = new THREE.Mesh(g(0.22, 0.02, 0.1), helmet); v.position.set(0, 0.25, 0.15); head.add(v);
  } else if (o.helmet !== false) {
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2), helmet); h.position.y = 0.2; h.scale.set(1, 0.8, 1.05); head.add(h);
  } else if (o.hair) {
    const h = new THREE.Mesh(g(0.24, 0.1, 0.24), mat({ color: o.hair })); h.position.set(0, 0.27, -0.01); head.add(h);
    const b = new THREE.Mesh(g(0.22, 0.2, 0.06), mat({ color: o.hair })); b.position.set(0, 0.12, -0.12); head.add(b);
  }
  // руки
  const armL = part(torso, 0.12, 0.52, 0.12, -0.28, 0.52, 0, uni, -0.24);
  const armR = part(torso, 0.12, 0.52, 0.12, 0.28, 0.52, 0, uni, -0.24);
  for (const a of [armL, armR]) { const hnd = new THREE.Mesh(g(0.1, 0.1, 0.1), skin); hnd.position.y = -0.54; a.add(hnd); }
  // ноги
  const legL = part(hips, 0.16, 0.5, 0.17, -0.11, 0, 0, dark, -0.25);
  const legR = part(hips, 0.16, 0.5, 0.17, 0.11, 0, 0, dark, -0.25);
  for (const l of [legL, legR]) { const b = new THREE.Mesh(g(0.17, 0.42, 0.2), boots); b.position.set(0, -0.68, 0.01); l.add(b); }
  if (o.rifle) {
    const r = new THREE.Mesh(g(0.04, 0.04, 1.1), mat({ color: 0x3a2a1a })); r.position.set(0.05, -0.3, 0.1); r.rotation.x = 1.3; armR.add(r);
  }
  const person = { root, body, hips, torso, head, armL, armR, legL, legR, phase: Math.random() * 6, pose: 'stand', walking: false, talk: 0 };
  setPose(person, o.pose || 'stand');
  return person;
}

export function setPose(p, pose) {
  p.pose = pose;
  p.body.rotation.set(0, 0, 0);
  p.body.position.set(0, 0, 0);
  p.hips.position.y = 0.92;
  p.legL.rotation.set(0, 0, 0); p.legR.rotation.set(0, 0, 0);
  p.armL.rotation.set(0, 0, 0); p.armR.rotation.set(0, 0, 0);
  p.torso.rotation.set(0, 0, 0);
  if (pose === 'sit') {
    p.hips.position.y = 0.5;
    p.legL.rotation.x = -1.5; p.legR.rotation.x = -1.5;
    p.armL.rotation.x = -0.9; p.armR.rotation.x = -0.9;
  } else if (pose === 'lie') {
    p.body.rotation.x = -Math.PI / 2;
    p.body.position.set(0, 0.25, 0.9);
  } else if (pose === 'crouch') {
    p.hips.position.y = 0.6;
    p.legL.rotation.x = -1.2; p.legR.rotation.x = 0.3;
    p.torso.rotation.x = 0.3;
    p.armL.rotation.x = -1.2; p.armR.rotation.x = -1.4;
  }
}

/** Простая анимация: ходьба, дыхание, жестикуляция при разговоре. */
export function animate(p, dt, t) {
  p.phase += dt * (p.walking ? 7 : 1.4);
  if (p.pose === 'stand') {
    if (p.walking) {
      const s = Math.sin(p.phase);
      p.legL.rotation.x = s * 0.6; p.legR.rotation.x = -s * 0.6;
      p.armL.rotation.x = -s * 0.5; p.armR.rotation.x = s * 0.5;
      p.hips.position.y = 0.92 + Math.abs(Math.cos(p.phase)) * 0.03;
    } else {
      p.legL.rotation.x = p.legR.rotation.x = 0;
      p.armL.rotation.x = Math.sin(p.phase) * 0.03;
      p.armR.rotation.x = p.talk > 0 ? -0.6 + Math.sin(t * 5) * 0.25 : -Math.sin(p.phase) * 0.03;
      p.hips.position.y = 0.92;
      p.torso.rotation.x = Math.sin(p.phase * 0.5) * 0.015;
    }
  } else if (p.pose === 'lie') {
    p.torso.rotation.x = Math.sin(p.phase * 0.7) * 0.02;
    p.armL.rotation.z = Math.sin(t * 0.5) * 0.05;
  } else if (p.pose === 'sit') {
    p.head.rotation.y = Math.sin(t * 0.3) * 0.2;
    p.armR.rotation.x = -0.9 + Math.sin(t * 3) * (p.talk > 0 ? 0.15 : 0.02);
  }
  if (p.talk > 0) p.talk -= dt;
}

/** NPC, идущий по маршруту. */
export class Walker {
  constructor(person) { this.p = person; this.path = []; this.speed = 1.1; this.done = null; }
  go(points, done) { this.path = points.map((v) => v.clone()); this.done = done; }
  update(dt) {
    const r = this.p.root;
    if (!this.path.length) { this.p.walking = false; return; }
    const tgt = this.path[0];
    const d = new THREE.Vector3(tgt.x - r.position.x, 0, tgt.z - r.position.z);
    const len = d.length();
    if (len < 0.05) { this.path.shift(); if (!this.path.length) { this.p.walking = false; const f = this.done; this.done = null; f && f(); } return; }
    this.p.walking = true;
    d.normalize();
    r.position.x += d.x * Math.min(len, this.speed * dt);
    r.position.z += d.z * Math.min(len, this.speed * dt);
    const want = Math.atan2(d.x, d.z);
    r.rotation.y += ((want - r.rotation.y + Math.PI * 3) % (Math.PI * 2) - Math.PI) * Math.min(1, dt * 8);
  }
}
