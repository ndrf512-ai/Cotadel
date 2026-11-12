// Видимый бой. Всё, что видно, выводится из симуляции:
// численность врага = op.str, продвижение = op.pressure, прорыв = sec.held, отход = конец операции.
import * as THREE from 'three';
import { makePerson, setPose, animate, resetPose } from './people.js';
import { SECTOR_POS, baseGround, floorAt, polar } from './layout.js';
import { mat } from '../engine/ps1.js';

const ANG = { N: 0, E: 90, S: 180, W: 270 };
const MAX_ENEMY = 40;
const rnd = (a, b) => a + Math.random() * (b - a);

export class Battle {
  constructor(scene, audio, life) {
    this.scene = scene; this.audio = audio; this.life = life;
    this.pool = [];
    this.squads = {};      // активные атаки: s → { op, men: [] }
    this.scouts = {};      // признаки подготовки: s → [] далёкие фигуры
    this.pushSquad = null;
    this.dead = [];
    // трассеры: один LineSegments на все
    this.trN = 48;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(this.trN * 6), 3));
    this.trLine = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xffd890, transparent: true, opacity: 0.85 }));
    this.trLine.frustumCulled = false;
    scene.add(this.trLine);
    this.tracers = [];
    // фонтанчики земли от попаданий
    const pm = mat({ color: 0x5a4a38, outdoor: true });
    this.puffs = Array.from({ length: 24 }, () => { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), pm); m.visible = false; scene.add(m); return { m, t: 0 }; });
    this.shotBudget = 0;
    this.prevMen = {};
  }

  // ---------- пул фигур противника ----------
  take() {
    let p = this.pool.find((x) => !x.used);
    if (!p) {
      if (this.pool.length >= MAX_ENEMY) return null;
      p = makePerson({ look: 'enemy', rifle: true });
      p.root.traverse((c) => { c.userData.interact = { id: 'enemy', label: 'Противник' }; });
      this.scene.add(p.root);
      this.pool.push(p);
    }
    p.used = true; p.root.visible = true; p.dead = false; p.state = 'move'; p.stateT = 0; p.body.visible = true;
    setPose(p, 'stand'); resetPose(p);
    return p;
  }
  free(p) { p.used = false; p.root.visible = false; }

  place(p, r, a) {
    const [x, z] = polar(r, a);
    p.r = r; p.a = a;
    p.root.position.set(x, baseGround(x, z), z);
    p.root.rotation.y = Math.atan2(-x, -z); // лицом к штабу
  }

  // ---------- главный цикл ----------
  update(dt, t, sim, cam) {
    this.shotBudget = Math.min(14, this.shotBudget + dt * 14);
    for (const s of ['N', 'E', 'S', 'W']) {
      this.prep(s, sim, dt);
      this.assault(s, sim, dt, t, cam);
    }
    this.push(sim, dt, t, cam);
    this.ourCasualties(sim);
    // убитые лежат, потом исчезают
    for (const d of [...this.dead]) { d.deadT -= dt; if (d.deadT <= 0) { this.free(d); this.dead.splice(this.dead.indexOf(d), 1); } }
    // анимация видимых
    for (const p of this.pool) {
      if (!p.used) continue;
      const dd = Math.hypot(p.root.position.x - cam.x, p.root.position.z - cam.z);
      p.body.visible = dd < 95;
      if (dd < 95) animate(p, dt, t);
    }
    this.updateFx(dt, cam);
  }

  /** Признаки подготовки атаки: вдали перебегают фигуры. */
  prep(s, sim, dt) {
    const plan = sim.enemy.plan.find((x) => x.prepped && !x.started && x.target === s && x.type !== 'shelling');
    const want = plan ? (plan.signals === 'loud' ? 6 : plan.type === 'infil' ? 0 : 3) : 0;
    let g = this.scouts[s] || (this.scouts[s] = []);
    while (g.length > want) this.free(g.pop());
    while (g.length < want) {
      const p = this.take(); if (!p) break;
      this.place(p, rnd(90, 100), ANG[s] + rnd(-35, 35));
      p.dir = Math.random() < 0.5 ? -1 : 1; p.walkT = rnd(2, 6);
      g.push(p);
    }
    for (const p of g) {
      p.walkT -= dt;
      if (p.walkT <= 0) { p.walkT = rnd(3, 8); p.moving = !p.moving; setPose(p, p.moving ? 'stand' : 'crouch'); p.running = true; }
      p.walking = p.moving;
      if (p.moving) {
        p.a += p.dir * dt * 0.9;
        if (Math.abs(p.a - ANG[s]) > 40) p.dir *= -1;
        const [x, z] = polar(p.r, p.a);
        p.root.position.set(x, baseGround(x, z), z);
        p.root.rotation.y = Math.atan2(polar(1, p.a + 90 * p.dir)[0], polar(1, p.a + 90 * p.dir)[1]);
      }
    }
  }

  /** Атака на сектор: численность, продвижение и потери — из op. */
  assault(s, sim, dt, t, cam) {
    const sec = sim.sectors[s];
    const op = sec.op;
    let sq = this.squads[s];
    const active = op && (op.phase === 'active' || op.phase === 'arty');
    if (!active) {
      if (sq) { this.retreat(sq, sec.held === 'lost'); delete this.squads[s]; }
      return;
    }
    if (!sq || sq.op !== op) {
      if (sq) this.retreat(sq, false);
      sq = this.squads[s] = { op, men: [], init: op.init };
    }
    const alive = sq.men.filter((p) => !p.dead);
    const want = op.phase === 'arty' ? Math.min(12, Math.ceil(op.init / 16)) : Math.max(0, Math.min(16, Math.ceil(op.str / 14)));
    // потери противника видны: лишние падают
    while (alive.length > want && op.phase === 'active') {
      const v = alive.splice((Math.random() * alive.length) | 0, 1)[0];
      this.kill(v);
    }
    while (alive.length < want && sq.spawned !== true) {
      const p = this.take(); if (!p) break;
      this.place(p, rnd(84, 92), ANG[s] + rnd(-28, 28));
      p.sq = sq; sq.men.push(p); alive.push(p);
      p.state = 'down'; p.stateT = rnd(0, 2); setPose(p, 'crouch');
    }
    if (op.phase === 'active') sq.spawned = true;
    // рубеж, до которого противник дошёл
    const pressure = Math.min(1.2, op.pressure || 0);
    let front = op.phase === 'arty' ? 86 : 82 - pressure * 20;
    if (sec.held === 'line2') front = 60 - Math.min(1, pressure) * 14;
    if (op.type === 'feint') front = Math.max(front, 76);
    const our = this.ourTargets(s);
    for (const p of alive) {
      p.stateT -= dt;
      const goal = Math.max(front + rnd(-3, 3), sec.held === 'line2' ? 48 : 64);
      if (p.state === 'run') {
        if (p.r > goal) {
          p.r -= dt * 3.2; const [x, z] = polar(p.r, p.a);
          p.root.position.set(x, floorAt(x, z), z);
        }
        if (p.stateT <= 0 || p.r <= goal) { p.state = Math.random() < 0.5 ? 'fire' : 'down'; p.stateT = rnd(1.5, 4); setPose(p, p.state === 'fire' ? (Math.random() < 0.5 ? 'fire' : 'prone') : 'prone'); p.walking = false; }
      } else if (p.state === 'down' || p.state === 'fire') {
        if (p.state === 'fire' && op.phase === 'active' && Math.random() < dt * 0.9) this.shoot(p, our, cam, true);
        if (p.stateT <= 0) {
          if (p.r > goal + 2 && op.phase === 'active') { p.state = 'run'; p.stateT = rnd(1.2, 2.5); setPose(p, 'stand'); p.walking = true; p.running = true; }
          else { p.state = 'fire'; p.stateT = rnd(2, 4); setPose(p, Math.random() < 0.6 ? 'prone' : 'fire'); }
        }
      }
      p.root.rotation.y = Math.atan2(-p.root.position.x, -p.root.position.z);
    }
    // наши стреляют в ответ
    if (op.phase === 'active') {
      const enemies = alive;
      for (const m of our) if (enemies.length && Math.random() < dt * 0.7) {
        const e = enemies[(Math.random() * enemies.length) | 0];
        this.tracer(m.x, m.y + 1.4, m.z, e.root.position.x, e.root.position.y + 0.5, e.root.position.z);
        this.puff(e.root.position.x + rnd(-1.5, 1.5), e.root.position.z + rnd(-1.5, 1.5));
        this.sound(m.x, m.z, cam, false);
        if (m.p) m.p.fire = 1;
      }
      // пулемёты — очередями
      for (const g of this.life.T.dynamic.mg[s] || []) {
        if (!g.visible || !enemies.length || Math.random() > dt * 0.6) continue;
        const e = enemies[(Math.random() * enemies.length) | 0];
        for (let i = 0; i < 4; i++) this.tracer(g.position.x, g.position.y + 0.2, g.position.z, e.root.position.x + rnd(-2, 2), e.root.position.y + 0.4, e.root.position.z + rnd(-2, 2), i * 0.07);
        this.sound(g.position.x, g.position.z, cam, true);
      }
    }
  }

  ourTargets(s) {
    const out = [];
    for (const u of Object.values(this.life.units)) for (const m of u.men) {
      if (!m.root.visible || !m.sector || m.sector !== s) continue;
      out.push({ x: m.root.position.x, y: m.root.position.y, z: m.root.position.z, p: m });
    }
    if (!out.length) for (const [x, z] of SECTOR_POS[s].line1) out.push({ x, y: floorAt(x, z), z });
    return out;
  }

  shoot(p, targets, cam, enemy) {
    const q = targets[(Math.random() * targets.length) | 0];
    const x = p.root.position.x, y = p.root.position.y + (p.pose === 'prone' ? 0.3 : 1.2), z = p.root.position.z;
    this.life.muzzle(x, y, z);
    this.tracer(x, y, z, q.x + rnd(-1, 1), q.y + 1.2 + rnd(-0.4, 0.6), q.z + rnd(-1, 1));
    this.puff(q.x + rnd(-1.6, 1.6), q.z + rnd(-1.6, 1.6));
    p.fire = 1;
    this.sound(x, z, cam, false);
  }

  sound(x, z, cam, mg) {
    if (this.shotBudget < 1) return;
    this.shotBudget -= mg ? 3 : 1;
    const d = Math.min(1, Math.hypot(x - cam.x, z - cam.z) / 120);
    if (mg) this.audio.mg(d); else this.audio.shot(d);
  }

  kill(p) {
    p.dead = true; p.walking = false; setPose(p, 'lie'); p.deadT = 50;
    this.dead.push(p);
    if (p.sq) p.sq.men = p.sq.men.filter((x) => x !== p);
  }

  retreat(sq, won) {
    for (const p of sq.men) {
      if (p.dead) continue;
      if (won) { this.free(p); continue; } // в захваченном секторе — гарнизон противника (см. life.enemies)
      p.state = 'retreat'; setPose(p, 'stand'); p.walking = true; p.running = true;
      const go = () => {
        if (!p.used || p.state !== 'retreat') return;
        p.r += 0.12 * 3.5; const [x, z] = polar(p.r, p.a);
        p.root.position.set(x, baseGround(x, z), z); p.root.rotation.y = Math.atan2(x, z);
        if (p.r > 108) { this.free(p); return; }
        requestAnimationFrame(go);
      };
      requestAnimationFrame(go);
    }
  }

  /** Штурм КП из захваченного сектора: противник идёт к штабу. */
  push(sim, dt, t, cam) {
    const op = sim.hq.pushOp;
    const act = op && op.phase === 'active';
    if (!act) { if (this.pushSquad) { this.retreat(this.pushSquad, false); this.pushSquad = null; } return; }
    let sq = this.pushSquad;
    if (!sq) {
      sq = this.pushSquad = { men: [] };
      for (let i = 0; i < Math.min(12, Math.ceil(op.str / 12)); i++) {
        const p = this.take(); if (!p) break;
        this.place(p, rnd(42, 50), ANG[op.from] + rnd(-20, 20)); p.state = 'run'; p.sq = sq; sq.men.push(p);
      }
    }
    const want = Math.ceil(op.str / 12);
    const alive = sq.men.filter((p) => !p.dead);
    while (alive.length > want) this.kill(alive.splice(0, 1)[0]);
    const goal = 42 - (sim.hq.threat / 100) * 32;
    const targets = [{ x: -9, y: 1.2, z: 1.8 }, { x: 0, y: 1.2, z: -6 }];
    for (const p of alive) {
      p.stateT -= dt;
      if (p.r > goal && p.stateT <= 0) { setPose(p, 'stand'); p.walking = true; p.running = true; p.r -= dt * 3; const [x, z] = polar(p.r, p.a); p.root.position.set(x, floorAt(x, z), z); if (Math.random() < dt * 0.6) p.stateT = rnd(1, 2.5); }
      else { p.walking = false; setPose(p, 'fire'); if (Math.random() < dt) this.shoot(p, targets, cam, true); }
      p.root.rotation.y = Math.atan2(-p.root.position.x, -p.root.position.z);
    }
  }

  /** Наши потери видны: боец падает на позиции. */
  ourCasualties(sim) {
    for (const p of Object.values(sim.platoons)) {
      const prev = this.prevMen[p.id];
      this.prevMen[p.id] = p.men;
      if (prev === undefined || p.men >= prev) continue;
      const s = p.where.s;
      if (!s || !sim.sectors[s].op) continue;
      const u = this.life.units[p.id];
      const vis = u ? u.men.filter((m) => m.root.visible && m.pose !== 'lie' && m.pose !== 'sit') : [];
      if (!vis.length) continue;
      const m = vis[(Math.random() * vis.length) | 0];
      setPose(m, 'lie'); m.downT = 25;
      this.puff(m.root.position.x, m.root.position.z);
    }
  }

  // ---------- эффекты ----------
  tracer(x0, y0, z0, x1, y1, z1, delay = 0) {
    if (this.tracers.length >= this.trN) this.tracers.shift();
    this.tracers.push({ a: [x0, y0, z0], b: [x1, y1, z1], t: -delay, dur: Math.max(0.12, Math.hypot(x1 - x0, z1 - z0) / 260) });
  }
  puff(x, z) {
    const p = this.puffs.find((q) => q.t <= 0) || this.puffs[0];
    p.m.position.set(x, baseGround(x, z) + 0.2, z); p.m.visible = true; p.t = 0.5; p.m.scale.setScalar(0.4);
  }
  updateFx(dt, cam) {
    const arr = this.trLine.geometry.attributes.position.array;
    arr.fill(0);
    let i = 0;
    for (const tr of [...this.tracers]) {
      tr.t += dt;
      const k = tr.t / tr.dur;
      if (k > 1.15) { this.tracers.splice(this.tracers.indexOf(tr), 1); continue; }
      if (k < 0) continue;
      const k0 = Math.max(0, k - 0.18), k1 = Math.min(1, k);
      for (let j = 0; j < 3; j++) { arr[i * 6 + j] = tr.a[j] + (tr.b[j] - tr.a[j]) * k0; arr[i * 6 + 3 + j] = tr.a[j] + (tr.b[j] - tr.a[j]) * k1; }
      i++;
    }
    this.trLine.geometry.attributes.position.needsUpdate = true;
    this.trLine.geometry.setDrawRange(0, i * 2);
    for (const p of this.puffs) if (p.t > 0) { p.t -= dt; p.m.scale.setScalar(0.4 + (0.5 - p.t) * 2.2); p.m.position.y += dt * 0.6; if (p.t <= 0) p.m.visible = false; }
  }
}
