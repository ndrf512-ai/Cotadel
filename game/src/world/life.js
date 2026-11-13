// Жизнь гарнизона: люди на позициях, подносчики, санитары, связисты, инженеры,
// резерв на марше, посыльные, посетители штаба, противник в захваченных секторах, бой, свет.
import * as THREE from 'three';
import { makePerson, animate, Walker, setPose } from './people.js';
import { waveFlag } from './hq.js';
import { G, mat } from '../engine/ps1.js';
import { nightness, RES_LOCS } from '../sim/data.js';
import { SECTOR_POS, SPOTS, DUGOUTS, floorAt, buildNav, nearestNode, findPath, polar, baseGround, zoneAt, R_FRONT, R_SECOND, R_WIRE } from './layout.js';

const tmp = new THREE.Vector3();
const V = (x, z) => ({ x, z });
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export class Life {
  constructor(scene, W, T, lights, audio) {
    this.scene = scene; this.W = W; this.T = T; this.audio = audio; this.lights = lights;
    this.nav = buildNav();
    this.people = new Set();
    this.walkers = [];
    // --- штаб ---
    const S = W.refs.spots;
    this.olya = this.spawn({ look: 'olya', head: 'hair', pale: true, face: 0, pose: 'sitdesk' }, S.olya.x, S.olya.z, Math.PI / 2, { id: 'staff', who: 'olya', label: 'Сержант Мирон — связь' }, 0);
    this.orlov = this.spawn({ look: 'staff', head: 'cap', face: 1, pose: 'sitdesk' }, S.orlov.x, S.orlov.z, 0, { id: 'staff', who: 'orlov', label: 'Начальник штаба Орлов' }, 0);
    this.gusev = this.spawn({ look: 'soldier', head: 'pilotka', face: 0 }, -1.6, 1.9, -0.6, { id: 'staff', who: 'gusev', label: 'Ординарец Гусев' }, 0);
    this.gusevW = new Walker(this.gusev, () => 0); this.gusevW.speed = 1.25;
    this.initGusev();
    this.radioOp = this.spawn({ look: 'signal', head: 'pilotka', pose: 'sitdesk' }, S.radioOp.x, S.radioOp.z, Math.PI / 2, { id: 'soldier', role: 'radio', label: 'Радист' }, 0);
    this.clerk = this.spawn({ look: 'staff', head: 'pilotka', face: 2, pose: 'sitdesk' }, S.clerk.x, S.clerk.z, 0, { id: 'soldier', role: 'clerk', label: 'Писарь штаба' }, 0);
    this.orlovW = new Walker(this.orlov, (x, z) => 0); this.orlovW.speed = 1.1;
    this.orlovT = 40 + Math.random() * 40; this.orlovAt = 'desk';
    this.hqWounded = S.wounded.map(([x, z]) => { const p = this.spawn({ look: 'wounded', head: 'bare', pose: 'lie' }, x, z - 0.9, 0.2, { id: 'wounded', label: 'Раненый' }, 0); p.root.visible = false; return p; });
    this.guards = [[-2.2, 1.4], [-2.0, 2.4]].map(([x, z]) => { const p = this.spawn({ look: 'soldier', rifle: true, pose: 'crouch' }, x, z, -Math.PI / 2, null, 0); p.root.visible = false; return p; });
    // --- тыловые службы ---
    const [dx, dz] = SPOTS.depot;
    this.dyakov = this.spawn({ look: 'supply', head: 'ushanka', beard: true, face: 3 }, dx + 1.5, dz + 0.4, -1.2, { id: 'staff', who: 'dyakov', label: 'Старшина Дьяков — склад' });
    const med = T.dugouts.med;
    this.grin = this.spawn({ look: 'medic', head: 'cap', pale: true, face: 1 }, med.spots.officer[0], med.spots.officer[2], -Math.PI / 2, { id: 'staff', who: 'grin', label: 'Военврач Гриневич' });
    this.spawn({ look: 'medic', head: 'pilotka', pose: 'work' }, med.spots.center[0] + 0.8, med.spots.center[2] - 1.2, 0.5, { id: 'soldier', role: 'medic', label: 'Санитар' });
    this.medWounded = [];
    for (const b of med.bunks) { const p = this.spawn({ look: 'wounded', head: 'bare', pose: 'lie' }, b[0], b[2] - 0.6, 0, { id: 'wounded', label: 'Раненый' }); p.root.position.y = b[1] - 0.25; p.root.visible = false; p.bunk = b; this.medWounded.push(p); }
    for (let i = 0; i < 4; i++) { const c = med.spots.center; const p = this.spawn({ look: 'wounded', head: 'bare', pose: 'lie' }, c[0] - 1.6 + i * 0.95, c[2] - 1.0, 0, { id: 'wounded', label: 'Раненый' }); p.root.visible = false; this.medWounded.push(p); }
    const [ex, ez] = SPOTS.engYard;
    this.luchko = this.spawn({ look: 'officer', head: 'hair', pale: true, face: 0 }, ex + 1.2, ez + 0.4, 0.8, { id: 'staff', who: 'luchko', label: 'Мл. лейтенант Лучко — инженеры' });
    this.engineers = [0, 1, 2].map((i) => this.spawn({ look: 'eng', pose: 'work' }, ex + 1.5 + i * 0.6, ez + 1.6, 3.1, { id: 'soldier', role: 'eng', label: 'Сапёр' }));
    // --- взводы живут в army.js; здесь — только противник в захваченных секторах ---
    this.enemies = {};
    this.officerNpc = {};
    this.army = null;
    // --- эффекты ---
    this.flash = lights.add(new THREE.Vector3(0, -50, 0), 0xffd0a0, 30, 0); this.flash.priority = true;
    this.flare = lights.add(new THREE.Vector3(0, -50, 0), 0xe8ffe0, 60, 0); this.flare.priority = true;
    const mFlash = mat({ color: 0, emissive: 0xffe0a0, outdoor: true, side: THREE.DoubleSide });
    this.muzzles = Array.from({ length: 10 }, () => { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), mFlash); m.visible = false; scene.add(m); return m; });
    this.flareMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), mat({ color: 0, emissive: 0xf0ffe8, outdoor: true, side: THREE.DoubleSide }));
    this.flareMesh.visible = false; scene.add(this.flareMesh);
    this.bursts = Array.from({ length: 4 }, () => { const b = new THREE.Mesh(new THREE.IcosahedronGeometry(1.4, 0), mat({ color: 0, emissive: 0xffa040, outdoor: true })); b.visible = false; scene.add(b); return { m: b, t: 0 }; });
    // воронки: следы разрывов остаются на местности
    const crM = mat({ color: 0x2a2219, outdoor: true });
    const crG = new THREE.CylinderGeometry(1, 1.15, 0.06, 7);
    this.craters = Array.from({ length: 36 }, () => { const m = new THREE.Mesh(crG, crM); m.visible = false; scene.add(m); return m; });
    this.craterI = 0;
    this.battleSmokeT = 0;
    this.smoke = Array.from({ length: 12 }, () => { const b = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6, 0), mat({ color: 0x3a3632, outdoor: true, transparent: true, opacity: 0.8, depthWrite: false })); b.visible = false; scene.add(b); return { m: b, t: 0 }; });
    this.flareT = 0; this.nextFlare = 5; this.shake = 0; this.lampV = 0; this.lampA = 0;
    this.pendingFx = [];
    this.seenDeliveries = new Set(); this.seenIncoming = new Set();
    this.visitors = new Map(); this.runners = new Map();
    this.doorOpen = 0;
    this.arrivedRunner = null;
    // рабочие места: люди заняты делом рядом с предметами
    const st = [
      { o: { look: 'supply', head: 'pilotka', pose: 'work' }, at: [SPOTS.kitchen[0] - 0.9, SPOTS.kitchen[1] + 0.6], face: SPOTS.kitchen, label: 'Повар', role: 'cook' },
      { o: { look: 'eng', head: 'pilotka', pose: 'work' }, at: [SPOTS.generator[0] + 0.3, SPOTS.generator[1] + 1.0], face: SPOTS.generator, label: 'Механик у генератора', role: 'mech' },
      { o: { look: 'soldier', rifle: true, pose: 'aim' }, at: SPOTS.np, out: true, label: 'Наблюдатель НП', role: 'np' },
      { o: { look: 'signal', pose: 'phone' }, at: [-11.2, 0.6], face: [-12, 0.6], label: 'Связист у линии', role: 'signal' },
      { o: { look: 'supply', head: 'ushanka', pose: 'papers' }, at: [SPOTS.depot[0] - 3.4, SPOTS.depot[1] - 0.6], face: [SPOTS.depot[0] - 3.5, SPOTS.depot[1] - 1.6], label: 'Кладовщик', role: 'depot' },
      { o: { look: 'soldier', head: 'pilotka', pose: 'work' }, at: [-2.4, 7.4], face: [-2.7, 6.7], label: 'Боец у бочек с водой', role: 'walk' },
      { o: { look: 'soldier', rifle: true, pose: 'stand' }, at: [-8.6, 4.5], out: true, label: 'Часовой у входа в штаб', role: 'sentry' },
    ];
    for (const s of st) {
      const p = this.spawn(s.o, s.at[0], s.at[1], 0, { id: 'soldier', role: s.role, label: s.label });
      p.root.rotation.y = s.out ? Math.atan2(s.at[0], s.at[1]) : Math.atan2(s.face[0] - s.at[0], s.face[1] - s.at[1]);
    }
    // собеседники: двое курят у склада, двое у кухни
    this.chats = [];
    for (const [ax, az, bx, bz] of [[SPOTS.depot[0] + 3.2, SPOTS.depot[1] + 3.2, SPOTS.depot[0] + 4.1, SPOTS.depot[1] + 3.5], [SPOTS.kitchen[0] + 1.8, SPOTS.kitchen[1] - 1.2, SPOTS.kitchen[0] + 2.6, SPOTS.kitchen[1] - 0.6]]) {
      const a = this.spawn({ look: 'soldier', head: 'pilotka' }, ax, az, Math.atan2(bx - ax, bz - az), { id: 'soldier', role: 'walk', label: 'Боец' });
      const b = this.spawn({ look: 'soldier', rifle: true }, bx, bz, Math.atan2(ax - bx, az - bz), { id: 'soldier', role: 'walk', label: 'Боец' });
      this.chats.push({ a, b, t: 0, who: 0 });
    }
    // связные штаба: носят приказы на участки, в командирский блиндаж, на склад
    this.couriers = [0, 1].map((i) => {
      const home = [-9.8 + i * 0.9, 3.1];
      const p = this.spawn({ look: 'soldier', head: 'pilotka' }, home[0], home[1], Math.PI / 2, { id: 'soldier', role: 'runner', label: 'Связной штаба' });
      const w = new Walker(p, floorAt); w.speed = 2.7;
      return { p, w, home, t: 20 + i * 35, job: null, phase: 'idle' };
    });
    this.courierJobs = [];
    this.stationSpots = st.map((s) => s.at).concat([SPOTS.campfire, SPOTS.res.hq, [-10.5, 1.8], [7.4, 6.5], [SPOTS.engYard[0] - 1, SPOTS.engYard[1] + 2]]);
    const wl = [{ look: 'soldier', rifle: true }, { look: 'supply', head: 'pilotka', pose: 'carry' }, { look: 'signal' }, { look: 'soldier', head: 'pilotka', pose: 'papers' }];
    this.wanderers = wl.map((o) => { const p = this.spawn(o, 0, 10, 0, { id: 'soldier', role: o.look === 'supply' ? 'carrier' : o.look === 'signal' ? 'signal' : 'walk', label: o.look === 'signal' ? 'Связист' : o.look === 'supply' ? 'Боец хозвзвода' : 'Боец' }); const w = new Walker(p, floorAt); this.walkers.push({ w, p, wander: true }); return p; });
  }

  // ---------- общие ----------
  spawn(o, x, z, ry = 0, tagData = null, y) {
    const p = makePerson(o);
    p.root.position.set(x, y ?? floorAt(x, z), z); p.root.rotation.y = ry;
    this.scene.add(p.root); this.people.add(p);
    if (tagData) this.tag(p, tagData);
    return p;
  }
  remove(p) { this.scene.remove(p.root); this.people.delete(p); }
  tag(p, data) { p.root.traverse((c) => { c.userData.interact = data; }); }
  interactables() { const out = []; for (const p of this.people) if (p.root.visible && p.root.children.length) out.push(p.root); return out; }

  path(from, to) {
    const a = nearestNode(this.nav, from.x, from.z), b = nearestNode(this.nav, to.x, to.z);
    const pts = findPath(this.nav, a, b).map((n) => V(n.x, n.z));
    pts.unshift(V(from.x, from.z)); pts.push(V(to.x, to.z));
    return pts;
  }
  walk(o, from, to, done, speed = 1.3, tagData = null) {
    const p = this.spawn(o, from.x, from.z, 0, tagData);
    const w = new Walker(p, floorAt); w.speed = speed;
    const item = { w, p };
    w.go(this.path(from, to), () => { done ? done(item) : this.endWalk(item); });
    this.walkers.push(item);
    return item;
  }
  endWalk(item) { this.remove(item.p); this.walkers = this.walkers.filter((x) => x !== item); }

  // ---------- противник в захваченных секторах ----------
  syncLost(sim) {
    for (const s of ['N', 'E', 'S', 'W']) {
      const lost = sim.sectors[s].held === 'lost';
      if (lost && !this.enemies[s]) {
        this.enemies[s] = SECTOR_POS[s].line1.filter((_, i) => i % 3 === 1).slice(0, 4).map(([x, z]) => this.spawn({ look: 'enemy', rifle: true, pose: 'aim' }, x, z, Math.atan2(-x, -z), { id: 'enemy', label: 'Противник' }));
      } else if (!lost && this.enemies[s]) { for (const e of this.enemies[s]) this.remove(e); delete this.enemies[s]; }
    }
  }

  posOf(sim, w) {
    if (!w) return V(0, 10);
    if (w.type === 'sector') { const d = SECTOR_POS[w.s].dug; return V(d.center[0], d.center[1]); }
    if (w.type === 'res') { const c = SPOTS.res[w.loc] || SPOTS.res.center; return V(c[0], c[1]); }
    return V(0, 10);
  }

  // ---------- рабочие процессы ----------
  syncTasks(sim) {
    // подносчики патронов
    for (const d of sim.deliveries || []) {
      if (this.seenDeliveries.has(d)) continue;
      this.seenDeliveries.add(d);
      const p = sim.P(d.p);
      const to = this.posOf(sim, p.where);
      const from = V(SPOTS.depot[0], SPOTS.depot[1] + 1);
      const len = this.path(from, to).reduce((a, b, i, arr) => a + (i ? dist2(arr[i - 1], b) : 0), 0);
      const speed = Math.max(0.9, len / Math.max(15, (d.eta - sim.t) / 0.5));
      for (let i = 0; i < 2; i++) {
        const it = this.walk({ look: 'supply', head: 'pilotka', pose: 'carry' }, V(from.x + i * 0.5, from.z), to, null, speed, { id: 'soldier', role: 'carrier', unit: p.id, label: 'Подносчик патронов' });
        setPose(it.p, 'carry'); it.delay = i * 1.2;
      }
    }
    // санитары с ранеными
    const inc = sim.med.incoming || [];
    let active = this.walkers.filter((w) => w.medic).length;
    for (const w of inc) {
      if (this.seenIncoming.has(w)) continue;
      this.seenIncoming.add(w);
      if (active >= 4) continue;
      const p = sim.P(w.unit);
      if (!p) continue;
      const from = this.posOf(sim, p.where.type === 'move' ? p.where.from : p.where);
      const md = DUGOUTS.find((d) => d.id === 'med');
      const to = V(md.rect[0] - 1.2, (md.rect[2] + md.rect[3]) / 2);
      const speed = Math.max(0.7, this.path(from, to).reduce((a, b, i, arr) => a + (i ? dist2(arr[i - 1], b) : 0), 0) / Math.max(20, (w.t - sim.t) / 0.5));
      const a = this.walk({ look: 'medic', head: 'pilotka' }, from, to, null, speed, { id: 'soldier', role: 'medic', label: 'Санитар' }); a.medic = true;
      const b = this.walk({ look: 'wounded', head: 'bare' }, V(from.x + 0.6, from.z), to, null, speed, { id: 'wounded', label: 'Раненый' }); b.medic = true; b.delay = 0.6;
      active++;
    }
    // связисты на обрывах
    for (const s of ['N', 'E', 'S', 'W']) {
      const sec = sim.sectors[s];
      const key = 'sig' + s;
      const need = sec.line === 'cut' && sec.held !== 'lost';
      if (need && !this[key]) {
        const [x, z] = polar(R_SECOND - 6, { N: 0, E: 90, S: 180, W: 270 }[s]);
        this[key] = this.walk({ look: 'signal' }, V(-9, 2), V(x, z), (it) => { setPose(it.p, 'work'); }, 1.6, { id: 'soldier', role: 'signal', label: 'Связист-линейщик' });
      } else if (!need && this[key]) { this.endWalk(this[key]); this[key] = null; }
    }
    // инженеры
    const task = sim.eng.task;
    const site = task && task.sector ? SECTOR_POS[task.sector].line1 : null;
    const ek = site ? task.sector + task.type : 'yard';
    if (this.engKey !== ek) {
      this.engKey = ek;
      this.engineers.forEach((e, i) => {
        let x, z;
        if (site) { const s = site[(i * 2 + 2) % site.length]; x = s[0]; z = s[1]; }
        else { x = SPOTS.engYard[0] + 1.5 + i * 0.6; z = SPOTS.engYard[1] + 1.6; }
        e.root.position.set(x, floorAt(x, z), z); setPose(e, 'work');
      });
      const lx = site ? site[1][0] : SPOTS.engYard[0] + 1.2, lz = site ? site[1][1] : SPOTS.engYard[1] + 0.4;
      this.luchko.root.position.set(lx, floorAt(lx, lz), lz);
    }
    // бродячие бойцы между тыловыми точками
    for (const it of this.walkers.filter((w) => w.wander)) {
      if (it.w.path.length) continue;
      // дошёл — постоял, поработал, пошёл дальше
      if (it.busy === undefined) it.busy = 0;
      if (it.busy > 0) { it.busy -= 1 / 60; continue; }
      if (!it.didWork && it.p.base) { it.didWork = true; it.busy = 5 + Math.random() * 10; setPose(it.p, ['work', 'papers', 'stand', 'crouch'][(Math.random() * 4) | 0]); continue; }
      it.didWork = false;
      if (it.p.base === undefined) it.p.base = it.p.pose;
      setPose(it.p, it.p.base);
      const t = this.stationSpots[(Math.random() * this.stationSpots.length) | 0];
      it.w.go(this.path(V(it.p.root.position.x, it.p.root.position.z), V(t[0] + Math.random() * 1.5 - 0.75, t[1] + Math.random() * 1.5 - 0.75)));
    }
  }

  // ---------- посыльные и посетители ----------
  syncMessengers(sim, cam) {
    // посетители штаба (командиры лично, связные)
    const want = [...sim.pending('visit'), ...sim.pending('courier')];
    for (const m of want) {
      if (this.visitors.has(m.id)) continue;
      const courier = m.channel === 'courier';
      const look = m.from?.look || {};
      const S = this.W.refs.spots;
      const busy = [...this.visitors.values()].filter((v) => v.state !== 'out').length;
      const end = busy ? S.visitor2 : S.visitor;
      const it = this.walk(courier ? { look: 'soldier', rifle: true } : { look: 'officer', head: look.cap === false ? 'bare' : 'cap', beard: look.beard, pale: look.pale },
        V(-9.5, 1.8), V(end.x, end.z), (x) => { x.arrived = true; }, 1.5,
        { id: 'visitor', msg: m.id, label: courier ? `Связной (${m.fromName})` : `${m.from?.short || m.fromName} — доклад` });
      this.visitors.set(m.id, { it, m, state: 'in' });
      if (sim.player.zone === 'hq') sim.say(courier ? `Капитан, связной от ${m.fromName}.` : `Капитан, к вам ${m.from?.short || m.fromName}.`, 'Гусев', 4);
    }
    for (const [id, v] of this.visitors) {
      const alive = sim.inbox.includes(v.m) && !v.m.done;
      if (v.it.arrived && v.state === 'in') { tmp.set(cam.x - v.it.p.root.position.x, 0, cam.z - v.it.p.root.position.z); v.it.p.root.rotation.y = Math.atan2(tmp.x, tmp.z); }
      if (!alive && v.state !== 'out') {
        v.state = 'out'; v.it.p.root.traverse((c) => { c.userData.interact = null; });
        const pos = v.it.p.root.position;
        v.it.w.go(this.path(V(pos.x, pos.z), V(-9.5, 1.8)), () => { this.endWalk(v.it); this.visitors.delete(id); });
      }
    }
    // посыльный находит капитана в поле
    if (sim.player.zone !== 'hq') {
      for (const m of sim.inbox) {
        if (!m.runner || m.done || sim.t < m.arrive || this.runners.has(m.id)) continue;
        const it = this.walk({ look: 'soldier', head: 'pilotka' }, V(-9.5, 1.8), V(cam.x, cam.z), null, 3.4, { id: 'runner', msg: m.id, label: 'Посыльный из штаба' });
        it.runner = m; it.retarget = 0;
        this.runners.set(m.id, it);
      }
    }
    for (const [id, it] of this.runners) {
      const m = it.runner;
      const pos = it.p.root.position;
      if (m.done || !sim.inbox.includes(m) || sim.player.zone === 'hq') {
        this.runners.delete(id);
        it.p.root.traverse((c) => { c.userData.interact = null; });
        it.w.go(this.path(V(pos.x, pos.z), V(-9.5, 1.8)), () => this.endWalk(it));
        continue;
      }
      if (Math.hypot(pos.x - cam.x, pos.z - cam.z) < 2.2) { it.w.path = []; this.arrivedRunner = m; it.p.talk = 0.3; tmp.set(cam.x - pos.x, 0, cam.z - pos.z); it.p.root.rotation.y = Math.atan2(tmp.x, tmp.z); continue; }
      it.retarget -= 1 / 60;
      if (it.retarget <= 0 || !it.w.path.length) { it.retarget = 3; it.w.go(this.path(V(pos.x, pos.z), V(cam.x, cam.z))); }
    }
  }

  /** Ординарец: у него свой распорядок по штабу; с докладом сам подходит к капитану. */
  initGusev() {
    const N = {
      A: [-1.6, 1.9], S0: [-2.6, 2.6], B: [-0.5, 0], C: [-1.6, -1.0], D: [-1.55, -2.5], E: [1.0, -0.6],
      F: [3, 1.9], G: [5.0, 1.9], H: [5.0, 0.05], I: [6.0, 2.9], J2: [6.6, -0.2], J: [6.6, -1.0], K: [7.6, -2.0], L: [9.0, -4.0], M: [9.0, -1.6],
    };
    const E = [['A', 'S0'], ['A', 'B'], ['B', 'C'], ['C', 'D'], ['B', 'E'], ['A', 'F'], ['F', 'G'], ['G', 'H'], ['G', 'I'], ['G', 'J2'], ['J2', 'J'], ['J', 'K'], ['K', 'L'], ['K', 'M']];
    const adj = {}; for (const k in N) adj[k] = [];
    for (const [a, b] of E) { adj[a].push(b); adj[b].push(a); }
    this.gN = N; this.gAdj = adj;
    this.gStations = [
      { n: 'S0', pose: 'work', face: [-3.18, 3.27], what: 'подкидывает дрова в печку' },
      { n: 'E', pose: 'papers', face: [2.1, -0.75], what: 'раскладывает бумаги на вашем столе' },
      { n: 'D', pose: 'papers', face: [-0.5, -2.5], what: 'подточил карандаши у карты' },
      { n: 'H', pose: 'work', face: [5.0, -0.65], what: 'топит печку в вашей комнате' },
      { n: 'I', pose: 'work', face: [6.9, 2.95], what: 'заправляет вашу кровать' },
      { n: 'L', pose: 'work', face: [9.6, -4.6], what: 'ставит самовар' },
      { n: 'K', pose: 'work', face: [8.0, -3.0], what: 'накрывает на стол' },
    ];
    this.gState = { mode: 'go', st: this.gStations[0], t: 0, retarget: 0 };
    this.gGo(this.gStations[0]);
  }

  gNearest(x, z) { let best = 'A', bd = 1e9; for (const [k, [nx, nz]] of Object.entries(this.gN)) { const d = (nx - x) ** 2 + (nz - z) ** 2; if (d < bd) { bd = d; best = k; } } return best; }
  gRoute(from, to) {
    const prev = { [from]: null }, q = [from];
    while (q.length) { const c = q.shift(); if (c === to) break; for (const n of this.gAdj[c]) if (!(n in prev)) { prev[n] = c; q.push(n); } }
    const path = []; for (let c = to; c; c = prev[c]) path.unshift(this.gN[c]);
    return path.map(([x, z]) => V(x, z));
  }
  gGo(st, extra) {
    const p = this.gusev.root.position;
    setPose(this.gusev, 'stand');
    const route = this.gRoute(this.gNearest(p.x, p.z), st ? st.n : this.gNearest(extra.x, extra.z));
    if (extra) route.push(extra);
    this.gusevW.go([V(p.x, p.z), ...route], () => {
      if (!st) return;
      setPose(this.gusev, st.pose);
      this.gusev.root.rotation.y = Math.atan2(st.face[0] - this.gusev.root.position.x, st.face[1] - this.gusev.root.position.z);
      this.gState.mode = 'work'; this.gState.t = 15 + Math.random() * 20;
    });
  }

  updateGusev(dt, sim, cam, adj) {
    const g = this.gusev, gs = this.gState;
    this.gusevW.update(dt);
    const inHQ = sim.player.zone === 'hq';
    const d = Math.hypot(cam.x - g.root.position.x, cam.z - g.root.position.z);
    if (adj && inHQ) {
      // доклад: идёт к капитану, останавливается рядом, говорит
      if (gs.mode !== 'report') { gs.mode = 'report'; gs.retarget = 0; }
      gs.retarget -= dt;
      if (d > 1.6 && (gs.retarget <= 0 || !this.gusevW.path.length)) {
        gs.retarget = 1.5;
        const dir = Math.atan2(g.root.position.x - cam.x, g.root.position.z - cam.z);
        this.gGo(null, V(cam.x + Math.sin(dir) * 1.2, cam.z + Math.cos(dir) * 1.2));
      }
      if (d <= 1.7) { this.gusevW.path = []; g.walking = false; setPose(g, 'stand'); g.root.rotation.y = Math.atan2(cam.x - g.root.position.x, cam.z - g.root.position.z); g.talk = 0.3; }
      this.tag(g, { id: 'staff', who: 'gusev', label: 'Гусев — разрешите доложить' });
      return;
    }
    if (gs.mode === 'report') { gs.mode = 'go'; this.gNext(); }
    if (gs.mode === 'work') {
      gs.t -= dt;
      if (gs.t <= 0) this.gNext();
    }
    this.tag(g, { id: 'staff', who: 'gusev', label: gs.mode === 'work' ? `Ординарец Гусев — ${gs.st.what}` : 'Ординарец Гусев' });
  }

  gNext() {
    const gs = this.gState;
    let st; do st = this.gStations[(Math.random() * this.gStations.length) | 0]; while (st === gs.st);
    gs.st = st; gs.mode = 'go';
    this.gGo(st);
  }

  /** События цепи командования: приказ связным — бежит связной; совещание — связной в командирский блиндаж. */
  onChainEvent(sim, ev) {
    const D = this.T.dugouts;
    if (ev.type === 'order' && ev.via === 'связным') {
      const ref = D[{ N: 'dugN', E: 'dugE', S: 'dugS', W: 'dugW' }[ev.s]];
      if (ref) this.courierJobs.unshift({ to: ref.spots.door, what: `несёт приказ на ${{ N: 'северный', E: 'восточный', S: 'южный', W: 'западный' }[ev.s]} участок`, urgent: true });
    }
    if (ev.type === 'meeting' && D.cmd) this.courierJobs.unshift({ to: D.cmd.spots.door, what: 'несёт сводку в командирский блиндаж', urgent: true });
  }

  updateCouriers(dt, sim) {
    const D = this.T.dugouts;
    for (const c of this.couriers) {
      c.w.update(dt);
      if (c.phase === 'idle') {
        c.t -= dt;
        if (c.t > 0 && !this.courierJobs.length) continue;
        let job = this.courierJobs.shift();
        if (!job && c.t <= 0) {
          const opts = [[D.cmd?.spots.door, 'несёт донесение в командирский блиндаж'], [D.dugN.spots.door, 'несёт пакет на северный участок'], [D.dugE.spots.door, 'несёт пакет на восточный участок'], [D.dugS.spots.door, 'несёт пакет на южный участок'], [[SPOTS.depot[0] + 1.5, SPOTS.depot[1] + 1.5], 'несёт заявку на склад'], [D.med.spots.door, 'несёт записку в медпункт'], [[SPOTS.engYard[0] + 0.5, SPOTS.engYard[1] + 1.5], 'несёт приказ сапёрам']].filter((o) => o[0]);
          const [to, what] = opts[(Math.random() * opts.length) | 0];
          job = { to, what };
        }
        if (!job) continue;
        c.job = job; c.phase = 'go';
        setPose(c.p, 'stand'); c.w.speed = job.urgent ? 3.3 : 2.4;
        this.tag(c.p, { id: 'soldier', role: 'runner', label: `Связной штаба — ${job.what}` });
        const pos = c.p.root.position;
        c.w.go(this.path(V(pos.x, pos.z), V(job.to[0], job.to[1])), () => { c.phase = 'hand'; c.t = 3.5; setPose(c.p, 'report'); c.p.talk = 2; });
      } else if (c.phase === 'hand') {
        c.t -= dt;
        if (c.t <= 0) {
          c.phase = 'back'; setPose(c.p, 'stand'); c.w.speed = 2.2;
          this.tag(c.p, { id: 'soldier', role: 'runner', label: 'Связной штаба — возвращается' });
          const pos = c.p.root.position;
          c.w.go(this.path(V(pos.x, pos.z), V(c.home[0], c.home[1])), () => { c.phase = 'idle'; c.t = 60 + Math.random() * 90; setPose(c.p, Math.random() < 0.5 ? 'sit' : 'stand'); c.p.wantYaw = Math.PI / 2; this.tag(c.p, { id: 'soldier', role: 'runner', label: 'Связной штаба — ждёт поручений' }); });
        }
      }
    }
  }

  /** Работа штаба: Орлов ходит к карте, связисты отвечают на вызовы, писарь печатает. */
  hqLife(dt, sim) {
    const S = this.W.refs.spots;
    this.orlovW.update(dt);
    this.orlovT -= dt;
    if (this.orlovT <= 0 && !this.orlovW.path.length) {
      if (this.orlovAt === 'desk') {
        this.orlovAt = 'map'; setPose(this.orlov, 'stand');
        this.orlovW.go([V(-0.8, 1.9), V(-0.5, 0.4), V(-0.6, -0.9), V(-1.6, -1.7), V(S.orlovMap.x, S.orlovMap.z)], () => { setPose(this.orlov, 'papers'); this.orlov.root.rotation.y = Math.PI / 2; });
        this.orlovT = 18 + Math.random() * 12;
      } else {
        this.orlovAt = 'desk'; setPose(this.orlov, 'stand');
        this.orlovW.go([V(-1.6, -1.7), V(-0.6, -0.9), V(-0.5, 0.4), V(-0.8, 1.9), V(S.orlov.x, S.orlov.z)], () => { setPose(this.orlov, 'sitdesk'); this.orlov.root.rotation.y = 0; });
        this.orlovT = 50 + Math.random() * 60;
      }
    }
    const phone = sim.ringing() || sim.pending('phone').length;
    setPose(this.olya, phone ? 'phone' : 'sitdesk');
    setPose(this.radioOp, sim.pending('radio').length || (sim.t % 40 < 8) ? 'phone' : 'sitdesk');
    this.clerk.typing = sim.player.zone === 'hq' && Math.random() < dt * 0.6;
  }

  // ---------- эффекты ----------
  muzzle(x, y, z) {
    const m = this.muzzles.find((q) => !q.visible) || this.muzzles[0];
    m.position.set(x, y, z); m.visible = true; m.userData.t = 0.06;
  }

  boom(at, near) {
    // at: точка разрыва {x,z} или null (далеко)
    const k = 1 - near;
    if (near < 0.4) { this.audio.whistle(near); setTimeout(() => this.audio.boom(near), 850); } else this.audio.boom(near);
    this.shake = Math.max(this.shake, k * 0.15);
    this.lampV += (Math.random() - 0.5) * k * 2.2;
    if (k > 0.35) this.dustBurst(k);
    if (at) {
      const y = baseGround(at.x, at.z);
      const b = this.bursts.find((q) => q.t <= 0) || this.bursts[0];
      b.m.position.set(at.x, y + 0.8, at.z); b.m.visible = true; b.t = 0.2;
      const s = this.smoke.find((q) => q.t <= 0) || this.smoke[0];
      s.m.position.set(at.x, y + 1, at.z); s.m.visible = true; s.t = 4; s.m.scale.setScalar(0.6);
      if (Math.hypot(at.x, at.z) > 15) this.crater(at.x, at.z);
      this.flash.pos.set(at.x, y + 3, at.z); this.flash.intensity = 2.2; this.flash.range = 28;
    }
  }

  crater(x, z) {
    const c = this.craters[this.craterI++ % this.craters.length];
    const r = 0.55 + Math.random() * 0.6;
    c.position.set(x, floorAt(x, z) + 0.035, z); c.scale.set(r, 1, r * (0.8 + Math.random() * 0.4)); c.rotation.y = Math.random() * 3;
    c.visible = true;
  }

  dustBurst(k) {
    const d = this.W.refs.dust;
    for (let i = 0; i < d.n; i++) {
      if (Math.random() > k) continue;
      d.pos[i * 3] = (Math.random() - 0.5) * 5.2; d.pos[i * 3 + 1] = 2.25;
      d.pos[i * 3 + 2] = -2 + (Math.random() - 0.5) * 3.6 + (Math.random() < 0.3 ? 3.2 : 0);
      d.vel[i] = 0.2 + Math.random() * 0.6;
    }
  }

  fx(fx, sim, cam) {
    if (fx.type === 'boom') {
      let at = null;
      if (fx.hq) at = V((Math.random() - 0.5) * 24, (Math.random() - 0.5) * 24);
      else if (fx.sector) { const l = SECTOR_POS[fx.sector].line1; const q = l[(Math.random() * l.length) | 0]; const o = SECTOR_POS[fx.sector].outward; const r = (Math.random() - 0.3) * 8; at = V(q[0] + o[0] * r + (Math.random() - 0.5) * 6, q[1] + o[1] * r + (Math.random() - 0.5) * 6); }
      else at = V(SPOTS.depot[0] + (Math.random() - 0.5) * 14, SPOTS.depot[1] + (Math.random() - 0.5) * 14);
      const d = Math.hypot(at.x - cam.x, at.z - cam.z);
      const inside = sim.player.zone === 'hq' || sim.player.zone.startsWith('dug');
      this.boom(at, Math.min(1, d / 90) * (inside ? 0.85 : 1) + (inside ? 0.12 : 0));
    }
    if (fx.type === 'friendlyArty' && fx.sector) {
      // наша артиллерия кладёт снаряды по скоплению противника
      const [x, z] = polar(R_FRONT + 18 + Math.random() * 14, { N: 0, E: 90, S: 180, W: 270 }[fx.sector] + (Math.random() - 0.5) * 50);
      this.boom(V(x, z), Math.min(1, Math.hypot(x - cam.x, z - cam.z) / 90));
    }
    if (fx.type === 'skirmish' && fx.sector) {
      // короткая ночная перестрелка у проволоки
      this.audio.mg(Math.min(1, Math.hypot(cam.x, cam.z) / 120));
      this.flareT = 0; this.nextFlare = 0;
    }
    if (fx.type === 'relocate') for (let i = 0; i < 3; i++) this.boom(V(cam.x + 4, cam.z), 0.1);
    if (fx.type === 'plane') this.audio.boom(1);
  }

  update(dt, t, sim, cam) {
    this.syncLost(sim);
    this.syncTasks(sim);
    this.syncMessengers(sim, cam);
    for (const it of [...this.walkers]) {
      if (it.delay > 0) { it.delay -= dt; it.p.root.visible = false; continue; }
      it.p.root.visible = true;
      it.w.update(dt);
    }
    // видимость/анимация только рядом
    for (const p of this.people) {
      const d = Math.hypot(p.root.position.x - cam.x, p.root.position.z - cam.z);
      p.far = d > 55;
      p.body.visible = d < 62;
      if (!p.far && p.root.visible) animate(p, dt, t);
    }
    this.hqLife(dt, sim);
    this.updateCouriers(dt, sim);
    const nightK = nightness(sim.t);
    for (const l of this.T.dynamic.lanterns || []) l.intensity = 0.65 * Math.min(1, nightK * 1.5 + 0.1);
    // разговоры по очереди
    for (const c of this.chats) { c.t -= dt; if (c.t <= 0) { c.t = 1.5 + Math.random() * 2.5; c.who ^= 1; (c.who ? c.b : c.a).talk = c.t; } }
    // люди рядом поворачивают голову к капитану
    for (const p of this.people) {
      if (!p.root.visible || p.walking || p.pose === 'lie' || p.pose === 'prone') { p.lookAt = undefined; continue; }
      const dx = cam.x - p.root.position.x, dz = cam.z - p.root.position.z;
      const d = Math.hypot(dx, dz);
      if (d > 3.5) { p.lookAt = undefined; continue; }
      let a = Math.atan2(dx, dz) - p.root.rotation.y;
      a = ((a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      p.lookAt = Math.abs(a) < 1.6 ? a : undefined;
    }
    // Гусев: доклад
    const adj = sim.pending('adj').length > 0;
    this.updateGusev(dt, sim, cam, adj);
    const nPend = sim.staff.pendingDecisions().length;
    this.tag(this.orlov, { id: 'staff', who: 'orlov', label: nPend ? `Орлов — ${nPend} вопр. ждут решения` : 'Начальник штаба Орлов' });
    if (nPend) this.orlov.talk = 0.3;
    if (sim.ringing() || sim.pending('radio').length) this.olya.talk = 0.2;
    // раненые: в штабе (по угрозе) и в медпункте (по загрузке)
    const nW = Math.min(this.hqWounded.length, sim.hq.stage >= 2 ? 2 + sim.hq.stage : 0);
    this.hqWounded.forEach((p, i) => { p.root.visible = i < nW; });
    const med = sim.med.light + sim.med.severe;
    this.medWounded.forEach((p, i) => { p.root.visible = i < Math.min(this.medWounded.length, Math.ceil(med / 3)); });
    this.guards.forEach((p) => { p.root.visible = sim.hq.stage >= 4; });
    // реальные запасы видны глазами
    const dep = this.T.dynamic;
    dep.depotCrates.forEach((c, i) => { c.visible = i < Math.ceil(sim.depot.ammo); });
    dep.depotSacks.forEach((c, i) => { c.visible = i < Math.ceil(sim.depot.food * 3); });
    dep.engLogs.forEach((c, i) => { c.visible = i < Math.ceil(sim.depot.mat / 3); });
    for (const d of DUGOUTS) {
      if (!d.unitSector) continue;
      const p = Object.values(sim.platoons).find((x) => x.where.type === 'sector' && x.where.s === d.unitSector && x.where.role !== 'support');
      const ref = this.T.dugouts[d.id];
      ref.crates.forEach((c, i) => { c.visible = !!p && i < Math.ceil(p.ammo); });
      ref.lamp.on = sim.sectors[d.unitSector].held !== 'lost';
    }
    for (const s of ['N', 'E', 'S']) {
      const p = sim.holderOf(s);
      for (const g of dep.mg[s]) g.visible = !!p && p.men > 8 && sim.sectors[s].held === 'line1';
    }
    dep.fire.scale.y = 0.8 + Math.random() * 0.4;
    if (Math.hypot(cam.x - 9.7, cam.z + 4.9) < 110) waveFlag(this.W, t, 0.8 + Math.sin(t * 0.13) * 0.3);

    // события симуляции
    for (const fx of sim.fx.splice(0)) {
      if (fx.type === 'combat') continue;
      if (fx.delay) { this.pendingFx.push({ ...fx, at: t + fx.delay * 0.6 }); continue; }
      this.fx(fx, sim, cam);
    }
    for (const fx of [...this.pendingFx]) if (t >= fx.at) { this.pendingFx.splice(this.pendingFx.indexOf(fx), 1); this.fx(fx, sim, cam); }

    // бой: звук по расстоянию, вспышки
    let k = 0, nearest = 1;
    for (const s of ['N', 'E', 'S', 'W']) {
      const op = sim.sectors[s].op;
      if (!op || op.phase !== 'active') continue;
      const [x, z] = polar(R_FRONT + 2, { N: 0, E: 90, S: 180, W: 270 }[s]);
      const d = Math.min(1, Math.hypot(x - cam.x, z - cam.z) / 110);
      k = Math.max(k, Math.min(1, op.str / 150));
      nearest = Math.min(nearest, d);
    }
    // дым над участками, где идёт бой
    this.battleSmokeT -= dt;
    if (this.battleSmokeT <= 0) {
      this.battleSmokeT = 1.2;
      for (const s of ['N', 'E', 'S', 'W']) {
        const op = sim.sectors[s].op;
        if (!op || op.phase !== 'active') continue;
        const [x, z] = polar(R_FRONT + 3 + Math.random() * 16, { N: 0, E: 90, S: 180, W: 270 }[s] + (Math.random() - 0.5) * 60);
        const sm = this.smoke.find((q) => q.t <= 0);
        if (sm) { sm.m.position.set(x, baseGround(x, z) + 0.8, z); sm.m.visible = true; sm.t = 5; sm.m.scale.setScalar(0.6); }
      }
    }
    const push = sim.hq.pushOp && sim.hq.pushOp.phase === 'active';
    const inside = sim.player.zone === 'hq' || sim.player.zone.startsWith('dug');
    this.audio.combat = push ? 1 : k * 0.7;
    this.audio.distance = push ? 0.1 : Math.min(1, nearest + (inside ? 0.15 : 0));
    if (push && Math.random() < dt * 6) { this.flash.pos.set(-8, 2, 1.8); this.flash.intensity = 1.6; this.flash.range = 10; this.audio.shot(0.05 + Math.random() * 0.2); }
    for (const m of this.muzzles) if (m.visible) { m.lookAt(cam); m.userData.t -= dt; if (m.userData.t <= 0) m.visible = false; }
    this.flash.intensity = Math.max(0, this.flash.intensity - dt * 9);
    for (const b of this.bursts) if (b.t > 0) { b.t -= dt; if (b.t <= 0) b.m.visible = false; }
    for (const s of this.smoke) if (s.t > 0) { s.t -= dt; s.m.position.y += dt * 0.6; s.m.scale.setScalar(0.6 + (4 - s.t) * 0.5); s.m.material.uniforms.uOpacity.value = 0.7; if (s.t <= 0) s.m.visible = false; }
    // осветительные ракеты
    const night = nightness(sim.t);
    this.nextFlare -= dt;
    if (night > 0.6 && this.nextFlare <= 0 && this.flareT <= 0) {
      this.flareT = 9; this.nextFlare = 8 + Math.random() * (k > 0 ? 6 : 25);
      const [x, z] = polar(R_WIRE + 3 + Math.random() * 15, Math.random() * 270 - 50);
      this.flareMesh.position.set(x, baseGround(x, z) + 24, z); this.flareMesh.visible = true;
      this.audio.flare();
    }
    if (this.flareT > 0) {
      this.flareT -= dt; this.flareMesh.position.y -= dt * 2.2; this.flareMesh.lookAt(cam);
      this.flare.pos.copy(this.flareMesh.position);
      this.flare.intensity = Math.min(1, this.flareT / 2) * 1.8 * (0.85 + Math.random() * 0.15);
      if (this.flareT <= 0) { this.flareMesh.visible = false; this.flare.intensity = 0; }
    }

    // лампа в штабе, пыль
    const L = this.W.refs;
    this.lampV += (-this.lampA * 9 - this.lampV * 1.2) * dt; this.lampA += this.lampV * dt;
    L.lampG.rotation.z = this.lampA * 0.35; L.lampG.rotation.x = this.lampA * 0.2;
    L.lamp.pos.set(L.lampBase.x + Math.sin(this.lampA * 0.35) * -0.55, 1.55, L.lampBase.z + Math.sin(this.lampA * 0.2) * 0.55);
    const d = L.dust;
    for (let i = 0; i < d.n; i++) { if (d.pos[i * 3 + 1] < -1) continue; d.pos[i * 3 + 1] -= d.vel[i] * dt; if (d.pos[i * 3 + 1] < 0) d.pos[i * 3 + 1] = -10; }
    d.pts.geometry.attributes.position.needsUpdate = true;
    if (Math.random() < dt * 0.15 * sim.hq.stage) this.dustBurst(0.08);
    if (this.doorOpen > 0) this.doorOpen -= dt;

    // день/ночь
    const fog = new THREE.Color().setRGB(0.33, 0.37, 0.4).lerp(new THREE.Color(0.025, 0.03, 0.055), night);
    if (this.flare.intensity > 0.2) fog.lerp(new THREE.Color(0.2, 0.24, 0.2), 0.4 * this.flare.intensity);
    G.uFogColor.value.copy(fog);
    G.uFogNear.value = inside ? 8 : 12;
    G.uFogFar.value = 90 - night * 50;
    G.uAmbientOut.value.setRGB(0.42, 0.46, 0.52).lerp(new THREE.Color(0.05, 0.06, 0.09), night);
    G.uSunCol.value.setRGB(0.36, 0.37, 0.38).multiplyScalar(1 - night);
    G.uAmbientIn.value.setRGB(0.11, 0.08, 0.055).add(new THREE.Color(0.05, 0.04, 0.03).multiplyScalar(1 - night));
    const m = sim.t % 1440;
    L.mHand.rotation.z = -(m % 60) / 60 * Math.PI * 2;
    L.hHand.rotation.z = -((m / 60) % 12) / 12 * Math.PI * 2;
    const ring = sim.ringing();
    const blink = Math.sin(t * 9) > 0;
    L.phoneLamp.material.uniforms.uEmissive.value.setHex(ring && blink ? 0xff3010 : 0x000000);
    L.radioLamp.material.uniforms.uEmissive.value.setHex(sim.pending('radio').length && blink ? 0x60ff30 : 0x103000);
    L.swLamps.forEach((l, i) => l.material.uniforms.uEmissive.value.setHex(ring && i === (ring.id % 6) && blink ? 0xffa020 : 0x000000));
    this.shake = Math.max(0, this.shake - dt * 0.35);
  }
}
