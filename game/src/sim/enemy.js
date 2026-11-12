// Командование противника: собственный план, разведка, резервы, артиллерия и обман.
import { SECTORS, SECTOR_IDS, RES_LOCS, fmtTime } from './data.js';
import { strengthWords, pick, say } from './lines.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const chance = (p) => Math.random() < p;
const D = (day, h, m = 0) => (day - 1) * 1440 + h * 60 + m;

export class Enemy {
  constructor(sim) {
    this.sim = sim;
    this.pool = 1100;           // живая сила, доступная для операций
    this.shells = 900;          // снаряды и мины
    this.seenReserve = 'center';
    this.history = [];          // «что было на самом деле» — для итогового рапорта
    this.ops = [];
    this.feintDir = 'N';
    this.mainDir = null;
    this.nextHarass = sim.t + rnd(40, 90);
    this.disrupted = {};
    // План операции на трое суток. Цели выбираются по ходу, по данным разведки.
    this.plan = [
      { t: D(1, 17, 40), type: 'probe', target: 'N', str: 45 },
      { t: D(1, 21, 20), type: 'feint', target: 'feint', str: 85, signals: 'loud' },
      { t: D(1, 23, 50), type: 'feint', target: 'feint', str: 75, signals: 'loud' },
      { t: D(2, 1, 40), type: 'infil', target: 'W', str: 60 },
      { t: D(2, 4, 40), type: 'assault', target: 'main', str: 220, arty: 30, signals: 'quiet' },
      { t: D(2, 9, 30), type: 'shelling', target: 'depot', dur: 25 },
      { t: D(2, 12, 30), type: 'assault', target: 'weakest', str: 160, arty: 20 },
      { t: D(2, 18, 40), type: 'assault', target: 'weakest', str: 190, arty: 25 },
      { t: D(2, 22, 30), type: 'infil', target: 'tired', str: 70 },
      { t: D(3, 2, 40), type: 'feint', target: 'awayFromMain', str: 95, signals: 'loud' },
      { t: D(3, 4, 30), type: 'assault', target: 'main2', str: 210, arty: 35, second: { type: 'assault', target: 'weakestOther', str: 90 } },
      { t: D(3, 10, 30), type: 'assault', target: 'weakest', str: 200, arty: 20 },
      { t: D(3, 14, 10), type: 'assault', target: 'weakest', str: 180, arty: 15 },
      { t: D(3, 17, 30), type: 'assault', target: 'weakest', str: 220, arty: 25 },
      { t: D(3, 19, 0), type: 'assault', target: 'weakestOther', str: 150 },
    ];
    for (const p of this.plan) { p.t += rnd(-20, 25); p.prepAt = p.t - (p.type === 'infil' ? 60 : rnd(80, 140)); }
  }

  log(text) { this.history.push({ t: this.sim.t, text }); }

  /** Оценка обороны сектора глазами противника. */
  estimateDefense(s) {
    const sim = this.sim, sec = sim.sectors[s];
    if (sec.held === 'lost') return 0;
    let d = 0;
    for (const p of sim.inSector(s)) d += sim.defPower(p, sec);
    // резерв, который противник видел рядом
    const near = { nearN: 'N', nearE: 'E', nearS: 'S' }[this.seenReserve];
    if (near === s) d += 40;
    if (this.seenReserve === 'center') d += 12;
    return d * rnd(0.8, 1.2);
  }

  pickTarget(rule) {
    // через болото крупными силами не наступают — только просачивание
    const front = ['N', 'E', 'S'].filter((s) => this.sim.sectors[s].held !== 'lost');
    if (!front.length) front.push('W');
    const byWeak = [...front].sort((a, b) => this.estimateDefense(a) - this.estimateDefense(b));
    const lost = SECTOR_IDS.filter((s) => this.sim.sectors[s].held === 'lost');
    switch (rule) {
      case 'feint': return this.feintDir;
      case 'main': {
        const cands = byWeak.filter((s) => s !== this.feintDir && s !== 'W');
        this.mainDir = cands[0] || byWeak[0];
        return this.mainDir;
      }
      case 'main2': {
        const cands = byWeak.filter((s) => s !== this.lastFeint2);
        this.mainDir = cands[0] || byWeak[0];
        return this.mainDir;
      }
      case 'awayFromMain': {
        // демонстрация там, где резерва нет, — чтобы его оттянуть
        const target = byWeak[0];
        const far = front.filter((s) => s !== target && !SECTORS[target].adj.includes(s));
        this.lastFeint2 = far[0] || front.find((s) => s !== target);
        return this.lastFeint2;
      }
      case 'weakestOther': return byWeak.find((s) => s !== this.mainDir) || byWeak[0];
      case 'tired': {
        const ps = front.map((s) => ({ s, f: this.sim.holderOf(s)?.fatigue || 0 })).sort((a, b) => b.f - a.f);
        return ps[0]?.s || byWeak[0];
      }
      case 'weakest': return lost.length && chance(0.3) ? null : byWeak[0];
      default: return rule;
    }
  }

  nextMajor() {
    return this.plan.find((p) => !p.started && p.type === 'assault' && p.t > this.sim.t);
  }

  tick() {
    const sim = this.sim, t = sim.t;
    for (const p of this.plan) {
      if (!p.prepped && t >= p.prepAt) {
        p.prepped = true;
        if (p.type !== 'shelling') {
          p.target = p.target === 'depot' ? 'depot' : this.pickTarget(p.target);
          if (p.target) this.signals(p);
        }
      }
      if (!p.started && t >= p.t) {
        p.started = true;
        this.launch(p);
        if (p.second) this.launch({ ...p.second, t, target: this.pickTarget(p.second.target) });
      }
    }
    // разведпризнаки в фазе подготовки
    for (const p of this.plan) {
      if (p.prepped && !p.started && p.target && p.target !== 'depot' && t % 20 === 0) this.signals(p);
    }
    // артподготовка перед штурмом
    for (const op of this.ops) {
      if (op.phase === 'arty') {
        if (t >= op.tStart) { op.phase = 'active'; this.log(`${this.label(op)} — ${op.type === 'feint' ? 'демонстрация' : 'атака'} силами ${Math.round(op.init)} чел.`); this.onContact(op); }
        else if (chance(0.5)) this.shell(op.sector, 1);
      }
    }
    // беспокоящий огонь
    if (t >= this.nextHarass && this.shells > 0) {
      const n = sim.night > 0.5 ? rnd(2, 5) : rnd(3, 8);
      const target = chance(0.12) ? 'hq' : pick(SECTOR_IDS.filter((s) => sim.sectors[s].held !== 'lost')) || 'hq';
      for (let i = 0; i < n; i++) this.shell(target, 1, i * 1.5 + rnd(0, 0.8));
      this.nextHarass = t + rnd(45, 140);
    }
    // выдвижение к штабу из захваченного сектора
    const push = sim.hq.pushOp;
    if (push && push.phase === 'prep' && t >= push.tStart) {
      push.phase = 'active';
      this.log(`Штурмовая группа (${Math.round(push.init)} чел.) пошла на командный пункт через ${SECTORS[push.from].gen} сектор.`);
    }
    if (sim.night > 0.8 && t % 60 === 0 && chance(0.08)) this.fakeSignals();
    // пеленгация рации
    if (sim.hq.pelengRisk > 1 && chance(0.02)) {
      sim.hq.pelengRisk = 0;
      this.log('Радиопеленгаторы засекли штаб гарнизона. Налёт на командный пункт.');
      for (let i = 0; i < 6; i++) this.shell('hq', 1, i * 0.9);
    }
  }

  label(op) { return SECTORS[op.sector] ? `${SECTORS[op.sector].name} сектор` : 'КП'; }

  launch(p) {
    const sim = this.sim;
    if (p.type === 'shelling') {
      this.log('Огневой налёт по складу гарнизона.');
      sim.hq.depotHit = true;
      for (let i = 0; i < 8; i++) this.shell('depot', 1, i * 1.2);
      return;
    }
    if (!p.target) { this.log('Запланированная атака отменена: противник перегруппировывается.'); return; }
    const sec = sim.sectors[p.target];
    if (sec.op || sec.held === 'lost') {
      if (sec.held === 'lost') { this.preparePush(p.target, p.str * 0.6); return; }
      return;
    }
    let str = Math.min(p.str * (this.disrupted[p.target] > sim.t ? 0.75 : 1), this.pool);
    if (str < 25) { this.log('У противника нет сил на новую атаку.'); return; }
    this.pool -= str;
    const op = {
      id: this.ops.length + 1, type: p.type, sector: p.target, str, init: str, lost: 0, minutes: 0,
      phase: p.arty ? 'arty' : 'active', tStart: sim.t + (p.arty || 0), maxDur: { assault: 100, feint: 40, probe: 40, infil: 70 }[p.type] || 80, pressure: 0,
    };
    this.ops.push(op);
    sec.op = op;
    if (op.phase === 'active') { this.log(`${this.label(op)} — ${op.type === 'feint' ? 'демонстрация' : op.type === 'infil' ? 'просачивание' : op.type === 'probe' ? 'разведка боем' : 'атака'} силами ${Math.round(str)} чел.`); this.onContact(op); }
    else this.log(`${this.label(op)} — артподготовка (${p.arty} мин) перед атакой.`);
    if (p.type === 'feint') this.feints = (this.feints || 0) + 1;
  }

  onContact(op) {
    const sim = this.sim;
    const p = sim.holderOf(op.sector);
    if (!p) return;
    p._kBefore = p.killed; p._wBefore = p.wounded;
    const o = sim.officerOf(p);
    // командир доложит; скорость зависит от характера
    const late = o.arch === 'initiator' && o.autonomy > 60 ? 15 : o.arch === 'natural' && o.autonomy > 70 ? 8 : 0;
    const est = op.init;
    sim.send({ from: o, unit: p.id, kind: 'contact', urgent: true, expire: 15, delay: late,
      text: sayContact(sim, o, op, est), intel: { combat: true, enemy: sim.estimate(o, est) },
      options: [{ label: 'Понял. Держитесь.', fn: () => ({}) }, { label: 'Действуйте по обстановке.', fn: () => { p.order.freedom = 'free'; sim.autonomy(o, 3); return { text: 'Есть.' }; } }] });
    if (chance(0.5)) sim.cutLine(op.sector);
  }

  signals(p) {
    const sim = this.sim;
    const loud = p.signals === 'loud';
    const night = sim.night > 0.5;
    let prob = loud ? 0.55 : p.type === 'infil' ? 0.08 : night ? 0.15 : 0.3;
    if (p.target === 'W') prob *= 1.3; // Кравец внимателен
    if (!chance(prob)) return;
    const s = p.target;
    const holder = sim.holderOf(s);
    const src = s === 'N' && chance(0.5) ? 'НП «Берёзы»' : holder ? sim.officerOf(holder)?.short : 'НП';
    const est = p.str * rnd(0.6, 1.5) * (loud ? 1.3 : 0.8);
    const what = pick(loud
      ? ['шум моторов, лязг', 'движение пехоты в открытую, крики команд', 'подвозят ящики, ходят не таясь']
      : ['какое-то движение в лощине', 'тихо подтягиваются небольшими группами', 'слышен приглушённый шум, костров не жгут']);
    const text = `${src}: перед ${SECTORS[s].gen} сектором ${what}. Похоже — ${strengthWords(est)}.`;
    this.reportIntel(s, text, strengthWords(est), src);
  }

  reportIntel(s, text, est, src) {
    const sim = this.sim;
    const unit = sim.holderOf(s);
    sim.send({ fromName: src, from: { short: src, name: src }, unit: unit?.id, channel: unit ? sim.channelFor(unit) : 'phone', kind: 'intel', quiet: true, expire: 25,
      text, intel: { enemy: est + ' (накапливаются)' }, intelSector: s, options: [{ label: 'Принял. Наблюдать.', fn: () => ({}) }] });
  }

  /** Ложные признаки — противник тоже умеет обманывать. */
  fakeSignals() {
    const s = pick(['N', 'E', 'S']);
    this.reportIntel(s, `НП: перед ${SECTORS[s].gen} сектором ночью слышен шум моторов, много голосов.`, 'до роты', 'НП');
  }

  shell(target, n, delay = 0) {
    const sim = this.sim;
    if (this.shells <= 0) return;
    this.shells -= n;
    if (target === 'hq') {
      sim.fx.push({ type: 'boom', near: rnd(0.05, 0.35), hq: true, delay });
      if (chance(0.15)) sim.hq.komendant = Math.max(0, sim.hq.komendant - 1);
      if (chance(0.08)) { const s = pick(SECTOR_IDS); sim.cutLine(s); }
      return;
    }
    if (target === 'depot') {
      sim.fx.push({ type: 'boom', near: rnd(0.3, 0.6), delay });
      if (chance(0.35)) { const lost = Math.min(sim.depot.ammo, rnd(0.3, 1.2)); sim.depot.ammo -= lost; }
      if (chance(0.2)) sim.depot.food = Math.max(0, sim.depot.food - 0.1);
      if (chance(0.2) && sim.depot.well) { sim.depot.well = false; sim.adj('Капитан, снаряд в колодец. Воды больше нет — только то, что в бочках.'); }
      return;
    }
    const sec = sim.sectors[target];
    sec.shelledUntil = sim.t + 10;
    sec.fort = Math.max(0, sec.fort - rnd(0.1, 0.6));
    sim.fx.push({ type: 'boom', near: target === 'N' ? 0.6 : 0.8, sector: target, delay });
    for (const p of sim.inSector(target)) {
      if (chance(0.12)) sim.casualties(p, 1, target);
      p.fatigue = Math.min(100, p.fatigue + 0.4);
    }
    if (chance(0.18)) sim.cutLine(target);
  }

  observeMove(p, ord) {
    const sim = this.sim;
    const seen = sim.night > 0.5 ? 0.25 : 0.8;
    if (ord.loc && chance(seen)) this.seenReserve = ord.loc;
    if (ord.sector && chance(seen)) this.seenReserve = 'near' + ord.sector;
  }

  observeHandover(s) {
    const sim = this.sim;
    if (sim.night < 0.5 && chance(0.4) && this.pool > 120 && !sim.sectors[s].op) {
      this.log(`Противник заметил смену подразделений в ${SECTORS[s].gen} секторе и ударил в момент смены.`);
      const p = { type: 'assault', target: s, str: 100, t: sim.t + 25, prepAt: sim.t, prepped: true };
      this.plan.push(p);
    }
  }

  disrupt(s) { if (s) this.disrupted[s] = this.sim.t + 360; }

  visibleNear(s) {
    const p = this.plan.find((x) => x.prepped && !x.started && x.target === s);
    return p ? p.str : 0;
  }

  onOpEnd(op, repelled) {
    this.pool += op.str * (repelled ? 0.85 : 0.4);
    this.log(`${this.label(op)}: ${repelled ? 'атака отбита' : 'противник овладел сектором'}; потери атакующих ≈ ${Math.round(op.lost)} чел.`);
    if (op.type === 'feint' && repelled) {
      // если резерв клюнул на демонстрацию — запоминаем
      const res = Object.values(this.sim.platoons).find((p) => p.where.type === 'sector' && p.where.s === op.sector && p.where.role === 'support');
      if (res) { this.seenReserve = 'near' + op.sector; this.log(`Резерв гарнизона выдвинулся к ${SECTORS[op.sector].gen} сектору — демонстрация достигла цели.`); }
    }
  }

  onSectorTaken(s, str) { this.preparePush(s, str * 0.5); }

  preparePush(from, str) {
    const sim = this.sim;
    if (sim.hq.pushOp) { sim.hq.pushOp.str += str * 0.5; sim.hq.pushOp.init += str * 0.5; return; }
    const lostIds = SECTOR_IDS.filter((s) => sim.sectors[s].held === 'lost');
    const lost = lostIds.length;
    // чем больше секторов потеряно, тем сильнее удар по ядру обороны:
    // в него идут и свежие силы, и гарнизоны захваченных секторов
    const extra = Math.min(this.pool, 60 + (lost >= 2 ? 100 : 0) + (lost >= 3 ? 200 : 0));
    this.pool -= extra;
    let fromHold = 0;
    if (lost >= 2) for (const s of lostIds) { const k = sim.sectors[s].enemyHold * 0.6; sim.sectors[s].enemyHold -= k; fromHold += k; }
    const total = str + extra + fromHold;
    sim.hq.pushOp = { type: 'push', from, str: total, init: total, lost: 0, minutes: 0, phase: 'prep', tStart: sim.t + rnd(60, 100) };
    this.log(`Противник готовит удар по командному пункту из ${SECTORS[from].gen} сектора (${Math.round(total)} чел.).`);
    sim.say(`Капитан, с позиций докладывают: в ${SECTORS[from].gen} секторе противник накапливается. Похоже, пойдут на штаб.`, 'Мирон', 7);
    sim.addLog('Мирон', `Противник накапливается в ${SECTORS[from].gen} секторе — угроза штабу.`, 'urgent');
  }

  onSectorRetaken(s) {
    const push = this.sim.hq.pushOp;
    if (push && push.from === s && push.phase === 'prep') { this.sim.hq.pushOp = null; this.log(`Контратака гарнизона в ${SECTORS[s].gen} секторе сорвала подготовку удара по КП.`); }
  }

  onPushEnd(op) {
    const sim = this.sim;
    const lostIds = SECTOR_IDS.filter((s) => sim.sectors[s].held === 'lost');
    if (lostIds.length >= 2) setTimeoutFree(this, lostIds);
    this.pool += op.str * 0.6; this.log(`Штурм командного пункта отбит; потери ≈ ${Math.round(op.lost)} чел.`); }
}

/** После отбитого штурма противник, удерживающий несколько секторов, готовит новый. */
function setTimeoutFree(enemy, lostIds) {
  const s = lostIds[(Math.random() * lostIds.length) | 0];
  enemy.plan.push({ type: 'assault', target: s, str: 60, t: enemy.sim.t + 120 + Math.random() * 90, prepAt: enemy.sim.t, prepped: true });
}

function sayContact(sim, o, op, est) {
  const noise = 1 + (Math.random() * 2 - 1) * (100 - o.exp) / 140;
  return say(o, 'contact', { sector: op.sector, time: fmtTime(sim.t).hm, est: est * o.estimateMul * noise * (o.trust < 30 ? 1.2 : 1) });
}
