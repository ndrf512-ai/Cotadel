// Армия гарнизона: взвод = командир + отделения (сержант и бойцы).
// Командир участка решает, сколько отделений в окопе и кто отдыхает; сержант расставляет бойцов;
// боец живёт по своему состоянию: спокоен → насторожен → обнаружил → под огнём → подавлен.
// Решения принимаются с интервалами (не каждый кадр); вдали — реже.
import * as THREE from 'three';
import { setPose, act, Walker } from './people.js';
import { SECTOR_POS, SPOTS, TRENCHES, floorAt, polar } from './layout.js';

const V = (x, z) => ({ x, z });
const rnd = (a, b) => a + Math.random() * (b - a);
const SURNAMES = ['Глушко', 'Ведерников', 'Рябов', 'Мухин', 'Лаптев', 'Зуев', 'Кузьмин', 'Тарасов', 'Белых', 'Огнев', 'Сидоренко', 'Панкратов', 'Ершов', 'Носов', 'Гайдамака', 'Чернов'];
const ORD = ['1-е', '2-е', '3-е'];
const ALERT_WORD = { calm: 'спокоен', wary: 'насторожен', spotted: 'обнаружил противника', underfire: 'под огнём', suppressed: 'подавлен огнём', regroup: 'перегруппировывается' };
const HP_WORD = { ok: 'в строю', wounded: 'ранен', heavy: 'тяжело ранен', dead: 'выбыл' };
const SAPS = Object.fromEntries(['N', 'E', 'S'].map((s) => [s, TRENCHES.filter((t) => t.kind === 'sap' && t.sector === s).map((t) => t.pts[t.pts.length - 1])]));

export class Army {
  constructor(life, battle, T, audio) {
    this.life = life; this.battle = battle; this.T = T; this.audio = audio;
    this.units = {};
    this.officerNpc = {};
    this.seq = [];          // цепочки передачи сведений и приказов
    this.nameIdx = 0;
    this.evIdx = 0;
  }

  // ---------- состав ----------
  makeUnit(sim, p) {
    const nSq = p.small ? 1 : 3;
    const u = { pid: p.id, squads: [], key: '', rest: 0, restT: rnd(40, 70), alert: 'calm', lastMen: p.men, oid: null, officer: null, obsT: 0 };
    for (let i = 0; i < nSq; i++) {
      const sq = { idx: i, name: SURNAMES[this.nameIdx++ % SURNAMES.length], agents: [] };
      for (let k = 0; k < 3; k++) {
        const leader = k === 0;
        const ag = this.agent(u, sq, leader ? 'leader' : 'soldier', leader ? { look: 'leader', weapon: 'smg' } : { look: 'soldier', rifle: true });
        sq.agents.push(ag);
      }
      u.squads.push(sq);
    }
    this.units[p.id] = u;
    return u;
  }

  agent(u, sq, rank, look) {
    const p = this.life.spawn(look, 0, -300, 0, null);
    p.root.visible = false;
    const a = { p, u, sq, rank, hp: 'ok', alert: 'calm', w: new Walker(p, floorAt), decideT: rnd(0, 1.5), slot: null, busy: null, shots: 0, label: '' };
    p.agent = a;
    return a;
  }

  allAgents(u) { const out = []; for (const sq of u.squads) out.push(...sq.agents); return out; }
  okAgents(u) { return this.allAgents(u).filter((a) => a.hp === 'ok'); }
  leaderOf(sq) { return sq.agents.find((a) => a.hp === 'ok' && a.rank === 'leader') || sq.agents.find((a) => a.hp === 'ok'); }

  // ---------- главный цикл ----------
  update(dt, t, sim, cam) {
    for (const p of Object.values(sim.platoons)) {
      const u = this.units[p.id] || this.makeUnit(sim, p);
      this.syncOfficer(sim, u, p);
      this.syncStrength(sim, u, p, cam);
      this.unitBrain(sim, u, p, dt);
      for (const a of this.allAgents(u)) this.agentTick(sim, u, p, a, dt, t, cam);
      if (u.officer) this.officerTick(sim, u, p, dt, cam);
    }
    // события цепи командования (приказы, совещания)
    const ev = sim.chain.events;
    while (this.evIdx < ev.length) this.onChainEvent(sim, ev[this.evIdx++]);
    if (ev.length > 200) { ev.splice(0, ev.length - 50); this.evIdx = Math.min(this.evIdx, ev.length); }
    this.runSeq(dt, sim);
  }

  /** Сколько людей видно = доля реальной численности взвода. Потери и пополнения — живые. */
  syncStrength(sim, u, p, cam) {
    const all = this.allAgents(u);
    const target = p.men <= 0 ? 0 : Math.max(1, Math.round(p.men / p.maxMen * all.length));
    const ok = all.filter((a) => a.hp === 'ok');
    if (ok.length > target) {
      const inFight = p.where.type === 'sector' && sim.sectors[p.where.s].op;
      const a = ok.filter((x) => x.rank !== 'leader').concat(ok.filter((x) => x.rank === 'leader')).find((x) => x.p.root.visible) || ok[ok.length - 1];
      if (inFight && a.p.root.visible && a.slot && a.slot.kind !== 'rest') {
        const r = Math.random();
        if (r < 0.35) this.die(a);
        else this.wound(sim, u, a, r < 0.6 ? 'heavy' : 'wounded');
        this.battle.puff(a.p.root.position.x, a.p.root.position.z);
      } else { a.hp = 'gone'; a.p.root.visible = false; a.busy = null; }
    } else if (ok.length < target) {
      // пополнение: из медпункта вернулись или прибыли люди
      const a = all.find((x) => x.hp === 'gone');
      if (a) {
        a.hp = 'ok'; a.busy = null; a.p.root.visible = true; setPose(a.p, 'stand');
        const from = p.where.type === 'sector' ? this.T.dugouts[SECTOR_POS[p.where.s].dug.id].spots.door : SPOTS.hqDoorOut;
        a.p.root.position.set(from[0], floorAt(from[0], from[1]), from[1]);
        a.placed = true; a.goal = null; u.key = '';
      }
    }
  }

  die(a) {
    a.hp = 'dead'; a.busy = null; a.w.path = []; a.p.walking = false;
    setPose(a.p, 'lie'); a.deadT = 45;
    this.tag(a, 'Погибший боец');
  }

  wound(sim, u, a, kind) {
    a.hp = kind; a.busy = null; a.w.path = []; a.p.walking = false;
    setPose(a.p, 'wounded'); a.woundT = 0; a.helpers = null;
    this.tag(a, kind === 'heavy' ? 'Тяжело раненый' : 'Раненый');
    this.seekHelp(u, a);
  }

  /** Товарищи сами спешат на помощь — без приказа. */
  seekHelp(u, a) {
    const helpers = this.okAgents(u).filter((x) => !x.busy && x.p.root.visible && x.slot && x.slot.kind !== 'rest')
      .sort((x, y) => x.p.root.position.distanceTo(a.p.root.position) - y.p.root.position.distanceTo(a.p.root.position));
    const need = a.hp === 'heavy' ? 2 : 1;
    if (helpers.length < need) return;
    const hs = helpers.slice(0, need);
    for (const h of hs) h.busy = { type: 'aid', target: a, team: hs, phase: 'go' };
    a.helpers = hs;
  }

  // ---------- командир участка: расстановка ----------
  unitBrain(sim, u, p, dt) {
    const w = p.where;
    let alert = 'calm';
    if (w.type === 'sector') {
      const s = w.s, sec = sim.sectors[s];
      const op = sec.op;
      const sq = this.battle.squads[s];
      if (op && op.phase === 'active') alert = (op.ratio || 0) > 1.5 ? 'suppressed' : 'underfire';
      else if (op && op.phase === 'arty') alert = 'underfire';
      else if ((sq && sq.men.length) || (sim.enemy.recon && sim.enemy.recon.s === s && sim.enemy.recon.spotted)) alert = 'spotted';
      else if (sec.posture === 'prepare' || sim.enemy.visibleNear(s) || sec.shelledUntil > sim.t) alert = 'wary';
      if (u.held && u.held !== sec.held && sec.held === 'line2') u.regroupT = 30;
      u.held = sec.held;
      if (u.regroupT > 0) { u.regroupT -= dt; if (alert === 'calm' || alert === 'wary') alert = 'regroup'; }
    }
    // тревога растёт — сведения идут по цепочке вверх
    const rank = { calm: 0, wary: 1, regroup: 2, spotted: 2, underfire: 3, suppressed: 3 };
    if (rank[alert] > rank[u.alert] && rank[alert] >= 1) this.reportUp(sim, u, p, alert);
    u.alert = alert;
    // смена отдыхающего отделения
    u.restT -= dt;
    if (u.restT <= 0) { u.restT = rnd(50, 80); u.rest = (u.rest + 1) % u.squads.length; }
    const posture = w.type === 'sector' ? (sim.sectors[w.s].posture || 'hold') : '';
    const key = [w.type, w.s || w.loc || '', w.type === 'sector' ? sim.sectors[w.s].held : '', alert === 'calm' ? 'calm' : alert === 'wary' ? 'wary' : 'fight', posture, u.rest, w.type === 'move' ? w.eta : ''].join('|');
    if (key !== u.key) { u.key = key; this.layout(sim, u, p, alert, posture); }
  }

  layout(sim, u, p, alert, posture) {
    const w = p.where;
    const agents = this.allAgents(u);
    if (w.type === 'move') {
      const to = w.to.sector ? this.dugDoor(w.to.sector) : SPOTS.res[w.to.loc] || SPOTS.res.center;
      const realSec = Math.max(15, (w.eta - sim.t) / 0.5 * 0.9);
      agents.forEach((a, i) => { if (a.hp === 'ok') a.slot = { kind: 'march', x: to[0] + (i % 3) * 0.6 - 0.6, z: to[1] + Math.floor(i / 3) * 0.6, face: 0, speed: Math.max(1.0, 70 / realSec) }; });
      return;
    }
    if (w.type === 'res') {
      const c = w.loc === 'center' ? SPOTS.campfire : SPOTS.res[w.loc];
      const guard = w.loc === 'hq';
      agents.forEach((a, i) => {
        if (guard) {
          const g = [[-11.5, 0.2], [-11.5, 3.4], [-13, -1.5], [-13, 5], [-9, 6], [-8.5, -2.5], [-12, 1.8], [-6, 6.5], [-5.5, -7], [-10, -6]][i % 10];
          a.slot = { kind: 'guard', x: g[0], z: g[1], face: Math.atan2(g[0], g[1]) };
        } else {
          const ang = i / agents.length * Math.PI * 2, r = 1.9 + (i % 2) * 0.5;
          const x = c[0] + Math.sin(ang) * r, z = c[1] + Math.cos(ang) * r;
          a.slot = { kind: 'res', x, z, face: Math.atan2(c[0] - x, c[1] - z) };
        }
      });
      return;
    }
    const s = w.s, sp = SECTOR_POS[s], sec = sim.sectors[s];
    const line = sec.held === 'line2' ? sp.line2 : sp.line1;
    const ref = this.T.dugouts[sp.dug.id];
    // сколько отделений в окопе — решает командир по обстановке и задаче
    const fight = alert !== 'calm';
    const resting = new Set();
    if (!fight && posture !== 'prepare' && u.squads.length > 1) {
      resting.add(u.rest);
      if (posture === 'observe') resting.add((u.rest + 1) % u.squads.length);
    }
    const nSq = u.squads.length;
    let bunk = 0;
    u.squads.forEach((sq, si) => {
      const chunk = line.slice(Math.floor(si * line.length / nSq), Math.max(Math.floor(si * line.length / nSq) + 1, Math.floor((si + 1) * line.length / nSq)));
      sq.agents.forEach((a, k) => {
        if (resting.has(si)) {
          const b = ref.bunks[bunk % ref.bunks.length];
          const extra = bunk >= ref.bunks.length;
          a.slot = extra ? { kind: 'rest', x: ref.spots.center[0] + (bunk - 3) * 0.45, z: ref.spots.center[2] + 0.4, face: 0, sitY: ref.d.floor } : { kind: 'rest', x: b[0], z: b[2], face: b[3], sitY: b[1] - 0.48 };
          bunk++;
          return;
        }
        let pt = chunk[(k * 2 + si) % chunk.length];
        let kind = 'line';
        if (k === 1 && sec.held === 'line1' && sp.mg.length && (si === 0 || si === nSq - 1)) { pt = sp.mg[si === 0 ? 0 : sp.mg.length - 1]; kind = 'mg'; }
        // наблюдатель: в спокойствии и при задаче «наблюдать» — вперёд, в сапу
        if (k === 2 && si === (u.rest + 1) % nSq && !fight && sec.held === 'line1') {
          const saps = SAPS[s] || [];
          if (saps.length) { const sp2 = saps[si % saps.length]; pt = [sp2[0], sp2[1]]; kind = 'observe'; }
          else if (posture === 'observe' || si === 0) kind = 'observe';
        }
        const jx = (Math.random() - 0.5) * 0.6, jz = (Math.random() - 0.5) * 0.6;
        a.slot = { kind, x: pt[0] + jx, z: pt[1] + jz, face: Math.atan2(pt[0], pt[1]) };
      });
    });
  }

  dugDoor(s) { const sp = this.T.dugouts[SECTOR_POS[s].dug.id].spots.door; return sp; }

  // ---------- боец ----------
  agentTick(sim, u, p, a, dt, t, cam) {
    const pr = a.p;
    if (a.hp === 'gone') { pr.root.visible = false; return; }
    if (p.men <= 0 && a.hp === 'ok') { a.hp = 'gone'; pr.root.visible = false; return; }
    if (!a.placed) {
      if (!a.slot) { pr.root.visible = false; return; }
      a.placed = true;
      pr.root.position.set(a.slot.x, a.slot.sitY ?? floorAt(a.slot.x, a.slot.z), a.slot.z);
      pr.root.rotation.y = a.slot.face || 0;
    }
    pr.root.visible = true;
    if (a.hp === 'dead') { a.deadT -= dt; if (a.deadT <= 0 || p.where.type !== 'sector') { a.hp = 'gone'; pr.root.visible = false; } return; }
    if (a.hp === 'wounded' || a.hp === 'heavy') {
      a.woundT += dt;
      if (!a.helpers && a.woundT % 4 < dt) this.seekHelp(u, a);
      if (a.woundT > 90 || p.where.type !== 'sector') { a.hp = 'gone'; pr.root.visible = false; } // унесли санитары
      return;
    }
    a.w.update(dt);
    if (a.busy) { this.doBusy(sim, u, a, dt, t, cam); return; }
    a.decideT -= dt;
    const far = Math.hypot(pr.root.position.x - cam.x, pr.root.position.z - cam.z) > 55;
    if (a.decideT > 0) return;
    a.decideT = far ? rnd(2.5, 4) : rnd(0.6, 1.4);
    const slot = a.slot;
    if (!slot) return;
    const d = Math.hypot(pr.root.position.x - slot.x, pr.root.position.z - slot.z);
    const alert = slot.kind === 'rest' ? 'calm' : u.alert;
    a.alert = alert;
    if (d > 0.5) {
      if (!a.w.path.length || a.goal !== slot) {
        a.goal = slot;
        setPose(pr, 'stand');
        const run = alert !== 'calm' && alert !== 'wary';
        a.w.speed = slot.speed || (run ? 3.0 : 1.3 * pr.gait.speed);
        a.w.go(this.life.path(V(pr.root.position.x, pr.root.position.z), V(slot.x, slot.z)), () => { if (slot.sitY !== undefined) pr.root.position.y = slot.sitY; pr.wantYaw = slot.face; });
      }
      this.updLabel(sim, u, p, a);
      return;
    }
    pr.wantYaw = slot.face;
    if (slot.sitY !== undefined) pr.root.position.y = slot.sitY;
    this.chooseAction(sim, u, p, a, alert, slot, cam);
    this.updLabel(sim, u, p, a);
  }

  chooseAction(sim, u, p, a, alert, slot, cam) {
    const pr = a.p;
    const ammo = p.ammo > 2.5 ? 'ok' : p.ammo > 1 ? 'low' : 'crit';
    a.ammo = ammo;
    if (slot.kind === 'rest') { setPose(pr, Math.random() < 0.85 ? 'sit' : 'stand'); return; }
    if (slot.kind === 'res') { setPose(pr, sim.night > 0.5 ? 'sit' : Math.random() < 0.6 ? 'sit' : 'stand'); if (Math.random() < 0.15) pr.talk = 2; return; }
    if (slot.kind === 'guard') { setPose(pr, 'aim'); return; }
    if (slot.kind === 'march') { setPose(pr, 'stand'); return; }
    const s = p.where.s;
    const enemies = this.battle.enemiesIn(s);
    if (alert === 'calm') {
      if (slot.kind === 'observe') { setPose(pr, Math.random() < 0.7 ? 'observe' : 'aim'); return; }
      if (a.rank === 'leader' && Math.random() < 0.08) { a.busy = { type: 'rounds', i: 0, phase: 'go' }; return; }
      const r = Math.random();
      if (r < 0.05) { // перекинуться словом с соседом
        const nb = a.sq.agents.find((x) => x !== a && x.hp === 'ok' && x.slot && Math.hypot(x.p.root.position.x - pr.root.position.x, x.p.root.position.z - pr.root.position.z) < 6);
        if (nb) { pr.talk = 2.5; nb.p.talk = 1.5; pr.wantYaw = Math.atan2(nb.p.root.position.x - pr.root.position.x, nb.p.root.position.z - pr.root.position.z); return; }
      }
      if (r < 0.07 && slot.kind === 'line') { // переходит на соседнее место
        const j = this.jitterSlot(slot); a.slot = j; return;
      }
      if (pr.pose === 'cover' || pr.pose === 'fire' || r < 0.1) setPose(pr, slot.kind === 'mg' ? 'aim' : ['stand', 'aim', 'stand', 'crouch'][(Math.random() * 4) | 0]);
      return;
    }
    if (alert === 'wary' || alert === 'regroup') {
      if (slot.kind === 'observe') { setPose(pr, 'observe'); return; }
      setPose(pr, Math.random() < 0.6 ? 'aim' : 'crouch');
      if (a.rank === 'leader' && Math.random() < 0.15) act(pr, 'point', 1.5);
      return;
    }
    // обнаружил / под огнём / подавлен
    if (alert === 'spotted' && !enemies.length) { setPose(pr, slot.kind === 'observe' || a.rank === 'leader' ? 'observe' : 'cover'); return; }
    setPose(pr, slot.kind === 'mg' ? 'fire' : 'cover');
    if (a.rank === 'leader' && Math.random() < 0.2) { act(pr, 'point', 1.2); return; }
    if (!enemies.length) return;
    if (pr.action) return;
    const fireP = (alert === 'suppressed' ? 0.25 : 0.6) * (ammo === 'ok' ? 1 : ammo === 'low' ? 0.7 : 0.3);
    if (a.shots >= (a.rank === 'leader' ? 6 : 4)) { a.shots = 0; act(pr, 'reload', 2.2); return; }
    if (Math.random() < fireP) {
      const e = enemies[(Math.random() * enemies.length) | 0];
      if (slot.kind !== 'mg') act(pr, 'popup', 0.9);
      const pos = pr.root.position;
      this.battle.ourShot(pos.x, pos.y + (slot.kind === 'mg' ? 1.15 : 1.35), pos.z, e, slot.kind === 'mg' || pr.weapon === 'smg', cam);
      this.life.muzzle(pos.x + Math.sin(pr.root.rotation.y) * 0.8, pos.y + 1.35, pos.z + Math.cos(pr.root.rotation.y) * 0.8);
      pr.fire = 1; a.shots++;
    }
  }

  jitterSlot(slot) {
    return { ...slot, x: slot.x + (Math.random() - 0.5) * 2.2, z: slot.z + (Math.random() - 0.5) * 2.2 };
  }

  /** Поручения бойца: помощь раненому, обход сержанта. */
  doBusy(sim, u, a, dt, t, cam) {
    const b = a.busy, pr = a.p;
    if (b.type === 'aid') {
      const w = b.target;
      if (w.hp !== 'wounded' && w.hp !== 'heavy') { a.busy = null; return; }
      const wp = w.p.root.position;
      if (b.phase === 'go') {
        if (!a.w.path.length) { setPose(pr, 'stand'); a.w.speed = 3; a.w.go([V(pr.root.position.x, pr.root.position.z), V(wp.x + (b.team.indexOf(a) ? -0.7 : 0.7), wp.z)]); b.phase = 'run'; }
        return;
      }
      if (b.phase === 'run') { if (!a.w.path.length) { b.phase = 'aid'; b.t = 4; setPose(pr, 'aid'); pr.wantYaw = Math.atan2(wp.x - pr.root.position.x, wp.z - pr.root.position.z); } return; }
      if (b.phase === 'aid') {
        b.t -= dt;
        if (b.t > 0) return;
        if (b.team.some((h) => h.busy && h.busy.phase !== 'aid' && h.busy.phase !== 'carry')) return;
        // уносим в блиндаж
        const door = this.dugDoor(u.lastSector || sim.P(u.pid).where.s || 'N');
        const dest = this.T.dugouts[SECTOR_POS[sim.P(u.pid).where.s || 'N'].dug.id].spots.center;
        b.phase = 'carry';
        setPose(pr, w.hp === 'heavy' ? 'stretcher' : 'support');
        a.w.speed = 1.0;
        a.w.go(this.life.path(V(pr.root.position.x, pr.root.position.z), V(dest[0] + (b.team.indexOf(a) ? 0.4 : -0.4), dest[2])), () => {
          w.hp = 'gone'; w.p.root.visible = false; w.helpers = null;
          for (const h of b.team) { h.busy = null; setPose(h.p, 'stand'); }
        });
        if (b.team[0] === a) { w.carry = b.team; if (w.hp === 'wounded') { setPose(w.p, 'support'); w.walkWith = a; } }
        return;
      }
      if (b.phase === 'carry' && b.team[0] === a) {
        // раненый движется вместе с несущими
        const team = b.team;
        const cx = team.reduce((s, h) => s + h.p.root.position.x, 0) / team.length, cz = team.reduce((s, h) => s + h.p.root.position.z, 0) / team.length;
        if (w.hp === 'heavy') { w.p.root.position.set(cx, floorAt(cx, cz) + 0.62, cz); w.p.root.rotation.y = pr.root.rotation.y + Math.PI / 2; setPose(w.p, 'lie'); }
        else { w.p.root.position.set(cx + 0.45 * Math.cos(pr.root.rotation.y), floorAt(cx, cz), cz - 0.45 * Math.sin(pr.root.rotation.y)); w.p.root.rotation.y = pr.root.rotation.y; w.p.walking = true; }
      }
      return;
    }
    if (b.type === 'rounds') {
      // сержант обходит своих бойцов
      const mates = a.sq.agents.filter((x) => x !== a && x.hp === 'ok' && x.slot && x.slot.kind !== 'rest');
      if (b.phase === 'go') {
        if (b.i >= mates.length) { a.busy = null; a.slot && (a.goal = null); return; }
        const m = mates[b.i];
        const mp = m.p.root.position;
        setPose(pr, 'stand'); a.w.speed = 1.2;
        a.w.go(this.life.path(V(pr.root.position.x, pr.root.position.z), V(mp.x + 0.8, mp.z)));
        b.phase = 'walk'; b.m = m;
        return;
      }
      if (b.phase === 'walk' && !a.w.path.length) {
        b.phase = 'talk'; b.t = 2.5;
        const mp = b.m.p.root.position;
        pr.wantYaw = Math.atan2(mp.x - pr.root.position.x, mp.z - pr.root.position.z);
        b.m.p.wantYaw = pr.wantYaw + Math.PI;
        pr.talk = 2; act(pr, Math.random() < 0.5 ? 'point' : 'salute', 1.2); b.m.p.talk = 1;
        return;
      }
      if (b.phase === 'talk') { b.t -= dt; if (b.t <= 0) { b.i++; b.phase = 'go'; } }
      return;
    }
    if (b.type === 'relay') {
      // бежит с донесением к командиру и обратно
      if (b.phase === 'go') { setPose(pr, 'stand'); a.w.speed = 3.2; a.w.go(this.life.path(V(pr.root.position.x, pr.root.position.z), V(b.to.x, b.to.z))); b.phase = 'run'; return; }
      if (b.phase === 'run' && !a.w.path.length) { b.phase = 'talk'; b.t = 2.5; setPose(pr, 'report'); pr.talk = 2; if (b.then) b.then(); return; }
      if (b.phase === 'talk') { b.t -= dt; if (b.t <= 0) { a.busy = null; a.goal = null; } }
    }
  }

  // ---------- командир участка ----------
  syncOfficer(sim, u, p) {
    const o = sim.officerOf(p);
    if (!o) { if (u.officer) u.officer.p.root.visible = false; return; }
    if (u.oid !== o.id) {
      if (u.officer) { u.officer.p.root.visible = false; this.life.remove(u.officer.p); }
      const pr = this.life.spawn({ look: 'officer', head: o.look?.cap === false ? 'pilotka' : 'cap', beard: o.look?.beard, pale: o.look?.pale, face: o.look?.face, weapon: o.arch === 'initiator' || o.arch === 'natural' ? 'smg' : null }, 0, -300, 0, null);
      pr.root.visible = false;
      u.officer = { p: pr, w: new Walker(pr, floorAt), mode: '', t: rnd(20, 50), busy: null };
      u.oid = o.id;
      this.officerNpc[o.id] = pr;
      this.firstPlace = true;
    }
  }

  officerSpot(sim, u, p) {
    const o = sim.officerOf(p), w = p.where;
    if (o.atMeeting) { const m = this.T.dugouts.cmd?.spots.meet; const i = sim.chain.meeting?.who.indexOf(o.id) ?? 0; const q = m ? m[Math.max(0, i) % m.length] : [14, -2, 0]; return { x: q[0], z: q[1], face: q[2], pose: 'stand', kind: 'meet' }; }
    if (w.type === 'res') { const c = w.loc === 'center' ? SPOTS.campfire : SPOTS.res[w.loc]; return { x: c[0] + 2.6, z: c[1] + 0.4, face: Math.atan2(-2.6, -0.4), pose: 'stand' }; }
    if (w.type === 'move') { const to = w.to.sector ? this.dugDoor(w.to.sector) : SPOTS.res[w.to.loc] || SPOTS.res.center; return { x: to[0] - 0.8, z: to[1], face: 0, pose: 'stand', speed: 1.6 }; }
    const s = w.s, sp = SECTOR_POS[s], sec = sim.sectors[s];
    const ref = this.T.dugouts[sp.dug.id];
    if (u.alert !== 'calm') {
      const line = sec.held === 'line2' ? sp.line2 : sp.line1;
      const c = line[Math.floor(line.length / 2)];
      return { x: c[0] - sp.outward[0] * 0.4, z: c[1] - sp.outward[1] * 0.4, face: Math.atan2(c[0], c[1]), pose: u.alert === 'wary' ? 'observe' : 'aim' };
    }
    return { x: ref.spots.officer[0], z: ref.spots.officer[2], face: Math.atan2(ref.spots.center[0] - ref.spots.officer[0], ref.spots.center[2] - ref.spots.officer[2]), pose: 'papers' };
  }

  officerTick(sim, u, p, dt, cam) {
    const o = sim.officerOf(p), off = u.officer, pr = off.p;
    const hide = !o.alive || o.inHQ || p.men <= 0;
    if (hide) { pr.root.visible = false; off.w.path = []; return; }
    if (!pr.root.visible) {
      pr.root.visible = true;
      const sp = this.officerSpot(sim, u, p);
      pr.root.position.set(sp.x, floorAt(sp.x, sp.z), sp.z);
    }
    off.w.update(dt);
    // метка для разговора
    const hasMsg = sim.inbox.some((m) => m.route === 'player' && !m.done && m.unit === p.id && sim.t >= m.arrive);
    const lab = hasMsg ? `${o.short} — хочет доложить` : `${o.name} — ${p.name}`;
    if (off.label !== lab) { off.label = lab; this.life.tag(pr, { id: 'officer', oid: o.id, label: lab }); }
    if (hasMsg) pr.talk = 0.3;
    if (off.busy) { this.officerBusy(sim, u, p, dt); return; }
    const sp = this.officerSpot(sim, u, p);
    const d = Math.hypot(pr.root.position.x - sp.x, pr.root.position.z - sp.z);
    if (d > 0.6) {
      if (!off.w.path.length || off.goalKey !== sp.x + ',' + sp.z) {
        off.goalKey = sp.x + ',' + sp.z;
        setPose(pr, 'stand');
        off.w.speed = sp.speed || (u.alert === 'calm' ? 1.3 : 2.8);
        off.w.go(this.cmdPath(V(pr.root.position.x, pr.root.position.z), V(sp.x, sp.z)));
      }
      return;
    }
    // на месте
    const near = Math.hypot(cam.x - pr.root.position.x, cam.z - pr.root.position.z) < 4;
    if (near) { setPose(pr, 'stand'); pr.wantYaw = Math.atan2(cam.x - pr.root.position.x, cam.z - pr.root.position.z); return; }
    pr.wantYaw = sp.face;
    setPose(pr, sp.kind === 'meet' ? 'stand' : sp.pose);
    if (sp.kind === 'meet' && Math.random() < dt * 0.4) pr.talk = 2;
    // в спокойствии командир сам обходит отделения
    off.t -= dt;
    if (off.t <= 0 && u.alert === 'calm' && p.where.type === 'sector' && !o.atMeeting) {
      off.t = rnd(70, 140);
      off.busy = { type: 'inspect', i: 0, phase: 'go' };
    } else if (u.alert !== 'calm' && Math.random() < dt * 0.3) act(pr, 'point', 1.4);
  }

  /** Маршрут с обходом стола совещаний в командирском блиндаже. */
  cmdPath(from, to) {
    const path = this.life.path(from, to);
    const c = this.T.dugouts.cmd;
    if (!c || !c.spots.walk) return path;
    const [x0, x1, z0, z1] = c.d.rect;
    const W = c.spots.walk;
    const inside = (q) => q.x > x0 && q.x < x1 && q.z > z0 && q.z < z1;
    const far = (q) => inside(q) && (q.z - W.tz) * W.away > -0.3;
    const side = [V(W.near[0], W.near[1]), V(W.far[0], W.far[1])];
    if (far(to)) { const last = path.pop(); path.push(...side, last); }
    if (far(from)) { const first = path.shift(); path.unshift(first, side[1], side[0]); }
    return path;
  }

  /** Командир идёт по отделениям: обход, передача приказа, доклад по телефону. */
  officerBusy(sim, u, p, dt) {
    const off = u.officer, pr = off.p, b = off.busy;
    if (b.type === 'phone') {
      if (b.phase === 'go') {
        const ref = this.T.dugouts[SECTOR_POS[p.where.s || 'N'].dug.id];
        const ph = ref.spots.officer;
        setPose(pr, 'stand'); off.w.speed = 2.4;
        off.w.go(this.life.path(V(pr.root.position.x, pr.root.position.z), V(ph[0], ph[2])));
        b.phase = 'walk';
        return;
      }
      if (b.phase === 'walk' && !off.w.path.length) { b.phase = 'talk'; b.t = 4; setPose(pr, 'phone'); return; }
      if (b.phase === 'talk') { b.t -= dt; if (b.t <= 0) { off.busy = b.after || null; if (off.busy) off.busy.phase = 'go'; } }
      return;
    }
    if (b.type === 'inspect' || b.type === 'brief') {
      const leaders = u.squads.map((sq) => this.leaderOf(sq)).filter(Boolean).filter((l) => l.slot && l.slot.kind !== 'rest');
      if (b.phase === 'go') {
        if (b.i >= leaders.length) { off.busy = null; off.goalKey = null; return; }
        const l = leaders[b.i], lp = l.p.root.position;
        setPose(pr, 'stand'); off.w.speed = b.type === 'brief' ? 2.6 : 1.3;
        off.w.go(this.life.path(V(pr.root.position.x, pr.root.position.z), V(lp.x + 0.9, lp.z + 0.3)));
        b.phase = 'walk'; b.l = l;
        return;
      }
      if (b.phase === 'walk' && !off.w.path.length) {
        b.phase = 'talk'; b.t = b.type === 'brief' ? 2.8 : 2.2;
        const lp = b.l.p.root.position;
        pr.wantYaw = Math.atan2(lp.x - pr.root.position.x, lp.z - pr.root.position.z);
        b.l.p.wantYaw = pr.wantYaw + Math.PI;
        pr.talk = 2.2; act(pr, 'point', 1.5);
        if (b.type === 'brief') { setPose(b.l.p, 'attention'); act(b.l.p, 'salute', 1.2); b.l.decideT = 3; }
        else b.l.p.talk = 1.5;
        return;
      }
      if (b.phase === 'talk') {
        b.t -= dt;
        if (b.t <= 0) {
          // сержант передаёт своим
          if (b.type === 'brief') { act(b.l.p, 'point', 1.5); b.l.p.talk = 1.5; b.l.decideT = 1.5; }
          b.i++; b.phase = 'go';
        }
      }
    }
  }

  // ---------- цепочка сведений вверх ----------
  reportUp(sim, u, p, alert) {
    if (p.where.type !== 'sector' || !u.officer) return;
    const obs = this.okAgents(u).find((a) => a.slot && a.slot.kind === 'observe') || this.okAgents(u).find((a) => a.slot && a.slot.kind === 'line');
    if (!obs) return;
    const sq = obs.sq, leader = this.leaderOf(sq);
    act(obs.p, 'point', 1.6); obs.p.talk = 1.5;
    if (!leader || leader === obs || leader.busy || alert === 'underfire' || alert === 'suppressed') {
      // в бою — командир сам к телефону
      if (!u.officer.busy) u.officer.busy = { type: 'phone', phase: 'go' };
      return;
    }
    const op = u.officer.p.root.position;
    leader.busy = { type: 'relay', phase: 'go', to: V(op.x + 0.8, op.z), then: () => { if (!u.officer.busy) u.officer.busy = { type: 'phone', phase: 'go' }; } };
  }

  /** Приказ пришёл от Орлова: командир принимает по телефону и обходит сержантов. */
  onChainEvent(sim, ev) {
    if (this.life.onChainEvent) this.life.onChainEvent(sim, ev);
    if (ev.type !== 'order') return;
    const p = sim.holderOf(ev.s);
    if (!p) return;
    const u = this.units[p.id];
    if (!u || !u.officer) return;
    u.officer.busy = { type: 'phone', phase: 'go', after: { type: 'brief', i: 0, phase: 'go' } };
  }

  runSeq() {}

  // ---------- для боя и интерфейса ----------
  /** Где наши в секторе — по ним стреляет противник. */
  targets(s) {
    const out = [];
    for (const u of Object.values(this.units)) for (const a of this.allAgents(u)) {
      if (a.hp !== 'ok' || !a.p.root.visible || !a.slot || a.slot.kind === 'rest') continue;
      const pos = a.p.root.position;
      if (Math.hypot(pos.x, pos.z) < 20) continue;
      const sec = sectorOf(pos.x, pos.z);
      if (sec !== s) continue;
      out.push({ x: pos.x, y: pos.y, z: pos.z, a });
    }
    return out;
  }

  updLabel(sim, u, p, a) {
    const pos = a.slot ? { line: 'в окопе', mg: 'у пулемёта', observe: 'наблюдает', rest: 'отдыхает в блиндаже', res: 'в резерве', guard: 'охраняет штаб', march: 'на марше' }[a.slot.kind] : '';
    const who = a.rank === 'leader' ? `Сержант ${a.sq.name}, командир ${ORD[a.sq.idx]} отделения` : `Боец ${ORD[a.sq.idx]} отделения сержанта ${a.sq.name}`;
    const amm = a.ammo === 'crit' ? ', патроны на исходе' : a.ammo === 'low' ? ', патронов мало' : '';
    const lab = `${who} (${p.name}) — ${pos}${a.alert && a.alert !== 'calm' ? ', ' + ALERT_WORD[a.alert] : ''}${amm}`;
    if (a.label !== lab) { a.label = lab; this.life.tag(a.p, { id: 'soldier', role: a.rank === 'leader' ? 'leader' : 'line', unit: p.id, label: lab, agent: true, alert: a.alert, ammo: a.ammo, kind: a.slot && a.slot.kind, squad: a.sq.name }); }
  }

  tag(a, label) { a.label = label; this.life.tag(a.p, { id: a.hp === 'dead' ? 'none' : 'wounded', label }); }

  /** Сводка для экрана командования: отделения участка. */
  summary(pid) {
    const u = this.units[pid];
    if (!u) return null;
    return u.squads.map((sq) => {
      const ok = sq.agents.filter((a) => a.hp === 'ok');
      const where = ok.length ? { rest: 'отдыхает', line: 'в окопе', mg: 'в окопе', observe: 'в окопе', res: 'в резерве', guard: 'у штаба', march: 'на марше' }[ok[0].slot?.kind] || '' : 'выбыло';
      return { name: `${ORD[sq.idx]} отд. (сержант ${sq.name})`, ok: ok.length, where, alert: ALERT_WORD[u.alert] };
    });
  }
}

function sectorOf(x, z) {
  let a = Math.atan2(x, -z) * 180 / Math.PI; if (a < 0) a += 360;
  if (a >= 315 || a < 45) return 'N';
  if (a < 135) return 'E';
  if (a < 225) return 'S';
  return 'W';
}

export { ALERT_WORD, HP_WORD };
