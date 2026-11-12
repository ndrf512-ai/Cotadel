// Жизнь штаба: люди, посетители, раненые, свет, разрывы, ракеты, день и ночь.
import * as THREE from 'three';
import { makePerson, animate, Walker, setPose } from './people.js';
import { G, mat } from '../engine/ps1.js';
import { nightness } from '../sim/data.js';

const tmp = new THREE.Vector3();

export class Life {
  constructor(scene, tex, W, lights, audio) {
    this.scene = scene; this.tex = tex; this.W = W; this.audio = audio;
    this.spots = W.refs.spots;
    this.people = [];
    // Оля Мирон — связистка за коммутатором
    this.olya = this.add(makePerson(tex, { helmet: false, hair: 0x3a2a1a, pale: true, pose: 'sit', color: 0xd0c8b0 }));
    this.olya.root.position.copy(this.spots.olya); this.olya.root.rotation.y = Math.PI / 2;
    this.tag(this.olya, { id: 'olya', label: 'Сержант Мирон — связь' });
    // Гусев — ординарец
    this.gusev = this.add(makePerson(tex, { cap: true, color: 0xe0d8c0 }));
    this.gusev.root.position.copy(this.spots.gusev); this.gusev.root.rotation.y = -0.6;
    this.gusevW = new Walker(this.gusev);
    this.tag(this.gusev, { id: 'gusev', label: 'Ординарец Гусев' });
    // раненые
    this.wounded = [];
    for (const [x, z] of this.spots.wounded) {
      const p = this.add(makePerson(tex, { helmet: false, hair: 0x2a2018, pose: 'lie', color: 0xb0a890 }));
      p.root.position.set(x, 0, z - 0.9); p.root.rotation.y = Math.random() * 0.4 - 0.2;
      p.root.visible = false;
      this.tag(p, { id: 'wounded', label: 'Раненый' });
      this.wounded.push(p);
    }
    // комендантское отделение у входа (стадия 4)
    this.guards = [];
    for (const [x, z] of [[-2.2, 1.4], [-2.0, 2.4]]) {
      const p = this.add(makePerson(tex, { rifle: true, pose: 'crouch' }));
      p.root.position.set(x, 0, z); p.root.rotation.y = -Math.PI / 2; p.root.visible = false;
      this.guards.push(p);
    }
    this.visitors = new Map();
    this.doorAngle = 0; this.doorOpen = 0;
    // свет
    this.L = W.refs;
    this.flash = lights.add(new THREE.Vector3(0, -50, 0), 0xffd0a0, 30, 0);
    this.flare = lights.add(new THREE.Vector3(0, -50, 0), 0xe8ffe0, 40, 0);
    // объекты снаружи: вспышки и ракеты
    const mFlash = mat({ color: 0, emissive: 0xffe0a0, outdoor: true, side: THREE.DoubleSide });
    this.muzzles = [];
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.6), mFlash);
      m.visible = false; this.W.refs.outside.add(m); this.muzzles.push(m);
    }
    this.flareMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), mat({ color: 0, emissive: 0xf0ffe8, outdoor: true, side: THREE.DoubleSide }));
    this.flareMesh.visible = false; W.refs.outside.add(this.flareMesh);
    this.burstMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6, 0), mat({ color: 0, emissive: 0xffa040, outdoor: true }));
    this.burstMesh.visible = false; W.refs.outside.add(this.burstMesh);
    this.flareT = 0; this.nextFlare = 5;
    this.shake = 0;
    this.lampV = 0; this.lampA = 0;
    this.pendingFx = [];
    this.burstT = 0;
  }

  add(p) { this.scene.add(p.root); this.people.push(p); return p; }
  remove(p) { this.scene.remove(p.root); this.people = this.people.filter((x) => x !== p); }
  tag(p, data) { p.root.traverse((c) => { c.userData.interact = data; }); }
  interactables() { return this.people.filter((p) => p.root.visible && p.root.userData !== undefined).map((p) => p.root); }

  // ---------- посетители ----------
  syncVisitors(sim) {
    const want = [...sim.pending('visit'), ...sim.pending('courier')];
    for (const m of want) {
      if (this.visitors.has(m.id)) continue;
      const courier = m.channel === 'courier';
      const o = m.from || {};
      const look = o.look || {};
      const p = this.add(makePerson(this.tex, courier ? { rifle: true } : { beard: look.beard, pale: look.pale, cap: look.cap !== false && !courier }));
      p.root.position.copy(this.spots.outside);
      const w = new Walker(p);
      const busy = [...this.visitors.values()].filter((v) => v.state !== 'out').length;
      const end = busy ? this.spots.visitor2 : this.spots.visitor;
      w.go([this.spots.door, this.spots.anteMid, this.spots.curtain, end]);
      this.tag(p, { id: 'visitor', label: courier ? `Связной (${m.fromName})` : `${o.short || m.fromName} — доклад`, msg: m.id });
      this.visitors.set(m.id, { p, w, m, state: 'in' });
      this.doorOpen = 2.5;
      this.audio.door();
      sim.say(courier ? `Капитан, связной от ${m.fromName}.` : `Капитан, к вам ${o.short || m.fromName}.`, 'Гусев', 4);
    }
    for (const [id, v] of this.visitors) {
      const alive = sim.inbox.includes(v.m) && !v.m.done;
      if (!alive && v.state !== 'out') {
        v.state = 'out';
        v.p.root.traverse((c) => { c.userData.interact = null; });
        v.w.go([this.spots.curtain, this.spots.anteMid, this.spots.door, this.spots.outside], () => { this.remove(v.p); this.visitors.delete(id); });
        this.doorOpen = 3.5;
      }
    }
  }

  // ---------- события сцены ----------
  boom(near, hq) {
    this.audio.boom(near);
    const k = 1 - near;
    this.shake = Math.max(this.shake, k * 0.12);
    this.lampV += (Math.random() - 0.5) * k * 2.2;
    if (k > 0.35) this.dustBurst(k);
    if (!hq && Math.random() < 0.6) {
      // вспышка снаружи
      const z = -25 - Math.random() * 40, x = (Math.random() - 0.5) * 50;
      const y = this.W.refs.outside.userData.groundY(z);
      this.burstMesh.position.set(x, y + 0.8, z); this.burstMesh.visible = true; this.burstT = 0.18;
      this.flash.pos.set(x, y + 3, z); this.flash.intensity = 2.2; this.flash.range = 30;
    }
  }

  dustBurst(k) {
    const d = this.W.refs.dust;
    for (let i = 0; i < d.n; i++) {
      if (Math.random() > k) continue;
      d.pos[i * 3] = (Math.random() - 0.5) * 5.2;
      d.pos[i * 3 + 1] = 2.25;
      d.pos[i * 3 + 2] = -2 + (Math.random() - 0.5) * 3.6 + (Math.random() < 0.3 ? 3.2 : 0);
      d.vel[i] = 0.2 + Math.random() * 0.6;
    }
  }

  update(dt, t, sim, camera) {
    // посетители и NPC
    this.syncVisitors(sim);
    for (const v of this.visitors.values()) {
      v.w.update(dt);
      if (v.state === 'in' && !v.w.path.length) {
        tmp.set(camera.position.x - v.p.root.position.x, 0, camera.position.z - v.p.root.position.z);
        v.p.root.rotation.y = Math.atan2(tmp.x, tmp.z);
      }
    }
    for (const p of this.people) animate(p, dt, t);
    // ординарец поворачивается к капитану, если есть доклад
    const adj = sim.pending('adj').length > 0;
    if (adj) { tmp.set(camera.position.x - this.gusev.root.position.x, 0, camera.position.z - this.gusev.root.position.z); this.gusev.root.rotation.y = Math.atan2(tmp.x, tmp.z); this.gusev.talk = 0.3; }
    this.gusev.root.userData.interact && (this.gusev.root.traverse((c) => { c.userData.interact = { id: 'gusev', label: adj ? 'Гусев — разрешите доложить' : 'Ординарец Гусев' }; }));
    if (sim.ringing() || sim.pending('radio').length) this.olya.talk = 0.2;
    // раненые в предбаннике: по стадии угрозы и загрузке медпункта
    const med = sim.med.light + sim.med.severe;
    const nW = Math.min(this.wounded.length, (sim.hq.stage >= 2 ? 2 + sim.hq.stage : 0) + (med > 22 ? 2 : 0));
    this.wounded.forEach((p, i) => { p.root.visible = i < nW; });
    this.guards.forEach((p) => { p.root.visible = sim.hq.stage >= 4; });
    // дверь
    if (this.doorOpen > 0) this.doorOpen -= dt;
    const want = this.doorOpen > 0 ? -1.3 : 0;
    this.doorAngle += (want - this.doorAngle) * Math.min(1, dt * 4);
    this.W.refs.door.rotation.y = this.doorAngle;

    // визуальные события симуляции
    for (const fx of sim.fx.splice(0)) {
      if (fx.delay) { this.pendingFx.push({ ...fx, at: t + fx.delay * 0.6 }); continue; }
      this.fx(fx, sim);
    }
    for (const fx of [...this.pendingFx]) if (t >= fx.at) { this.pendingFx.splice(this.pendingFx.indexOf(fx), 1); this.fx(fx, sim); }

    // бой: звук и вспышки на севере
    let k = 0;
    for (const s of ['N', 'E', 'S', 'W']) { const op = sim.sectors[s].op; if (op && op.phase === 'active') k = Math.max(k, Math.min(1, op.str / 150) * (s === 'N' ? 1 : 0.7)); }
    const push = sim.hq.pushOp && sim.hq.pushOp.phase === 'active';
    this.audio.combat = push ? 1 : k * 0.6;
    this.audio.distance = push ? 0.1 : sim.hq.stage >= 3 ? 0.5 : 0.85;
    const nOp = sim.sectors.N.op && sim.sectors.N.op.phase === 'active';
    this.muzzles.forEach((m, i) => {
      if (nOp && Math.random() < 0.12) {
        const z = -24 - Math.random() * 12, x = (Math.random() - 0.5) * 30;
        m.position.set(x, this.W.refs.outside.userData.groundY(z) + 0.4, z); m.lookAt(camera.position); m.visible = true;
      } else if (Math.random() < 0.4) m.visible = false;
    });
    if (push && Math.random() < dt * 6) {
      this.flash.pos.set(-3.5, 1.4, 1.8); this.flash.intensity = 1.6; this.flash.range = 6;
      this.audio.shot(0.05 + Math.random() * 0.2);
      if (Math.random() < 0.1) this.boom(0.15, true);
    }
    // вспышки гаснут
    this.flash.intensity = Math.max(0, this.flash.intensity - dt * 9);
    if (this.burstT > 0) { this.burstT -= dt; if (this.burstT <= 0) this.burstMesh.visible = false; }
    // осветительные ракеты ночью
    const night = nightness(sim.t);
    this.nextFlare -= dt;
    if (night > 0.6 && this.nextFlare <= 0 && this.flareT <= 0) {
      this.flareT = 9; this.nextFlare = 10 + Math.random() * (k > 0 ? 6 : 30);
      const z = -30 - Math.random() * 25;
      this.flareMesh.position.set((Math.random() - 0.5) * 40, this.W.refs.outside.userData.groundY(z) + 22, z);
      this.flareMesh.visible = true;
      this.audio.flare();
    }
    if (this.flareT > 0) {
      this.flareT -= dt;
      this.flareMesh.position.y -= dt * 2.2;
      this.flareMesh.lookAt(camera.position);
      this.flare.pos.copy(this.flareMesh.position);
      this.flare.intensity = Math.min(1, this.flareT / 2) * 1.6 * (0.85 + Math.random() * 0.15);
      if (this.flareT <= 0) { this.flareMesh.visible = false; this.flare.intensity = 0; }
    }

    // лампа качается после разрывов
    this.lampV += (-this.lampA * 9 - this.lampV * 1.2) * dt;
    this.lampA += this.lampV * dt;
    this.L.lampG.rotation.z = this.lampA * 0.35;
    this.L.lampG.rotation.x = this.lampA * 0.2;
    this.L.lamp.pos.set(Math.sin(this.lampA * 0.35) * -0.55, 1.55, -2 + Math.sin(this.lampA * 0.2) * 0.55);
    this.L.lamp.intensity = sim.captain.asleep ? 0.45 : 1.25;
    // пыль
    const d = this.L.dust;
    for (let i = 0; i < d.n; i++) {
      if (d.pos[i * 3 + 1] < -1) continue;
      d.pos[i * 3 + 1] -= d.vel[i] * dt;
      if (d.pos[i * 3 + 1] < 0) d.pos[i * 3 + 1] = -10;
    }
    d.pts.geometry.attributes.position.needsUpdate = true;
    if (Math.random() < dt * 0.15 * sim.hq.stage) this.dustBurst(0.08);

    // день/ночь
    const fog = new THREE.Color().setRGB(0.36, 0.38, 0.36).lerp(new THREE.Color(0.03, 0.035, 0.05), night);
    if (this.flare.intensity > 0.2) fog.lerp(new THREE.Color(0.2, 0.24, 0.2), 0.4 * this.flare.intensity);
    G.uFogColor.value.copy(fog);
    G.uFogNear.value = 5;
    G.uFogFar.value = 75 - night * 40;
    G.uAmbientOut.value.setRGB(0.42, 0.43, 0.4).lerp(new THREE.Color(0.04, 0.045, 0.06), night);
    G.uSunCol.value.setRGB(0.35, 0.34, 0.3).multiplyScalar(1 - night);
    G.uAmbientIn.value.setRGB(0.07, 0.065, 0.055).add(new THREE.Color(0.06, 0.06, 0.055).multiplyScalar(1 - night));
    // часы
    const m = sim.t % 1440;
    this.L.mHand.rotation.z = -(m % 60) / 60 * Math.PI * 2;
    this.L.hHand.rotation.z = -((m / 60) % 12) / 12 * Math.PI * 2;
    // лампочки телефона и рации
    const ring = sim.ringing();
    const blink = Math.sin(t * 9) > 0;
    this.L.phoneLamp.material.uniforms.uEmissive.value.setHex(ring && blink ? 0xff3010 : 0x000000);
    const radio = sim.pending('radio').length > 0;
    this.L.radioLamp.material.uniforms.uEmissive.value.setHex(radio && blink ? 0x60ff30 : 0x103000);
    this.L.swLamps.forEach((l, i) => l.material.uniforms.uEmissive.value.setHex(ring && i === (ring.id % 6) && blink ? 0xffa020 : 0x000000));
    // тряска
    this.shake = Math.max(0, this.shake - dt * 0.35);
  }

  fx(fx, sim) {
    if (fx.type === 'boom') this.boom(fx.near, fx.hq);
    if (fx.type === 'relocate') { for (let i = 0; i < 3; i++) this.boom(0.1, true); }
    if (fx.type === 'plane') { this.audio.boom(1); }
  }
}
