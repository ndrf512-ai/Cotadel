// Симуляция обороны: взводы, командиры (COM), противник, связь, тыл, угроза штабу.
import {
  SECTORS, SECTOR_IDS, RES_LOCS, ARCH, OFFICERS, PLATOONS, STAFF, SERGEANT_NAMES,
  START_T, RELIEF_T, fmtTime, nightness,
} from './data.js';
import {
  say, pick, n1, strengthWords, ammoWords, fatigueWords, moraleWords, repeatOrder, orderText, garble, cap,
} from './lines.js';
import { Enemy } from './enemy.js';
import { Staff } from './staff.js';
import { Chain } from './chain.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const chance = (p) => Math.random() < p;

let MSG_ID = 1;

export class Sim {
  constructor() {
    this.t = START_T;
    this.reliefT = RELIEF_T;
    this.over = null;
    this.officers = {};
    for (const o of OFFICERS) {
      this.officers[o.id] = {
        ...o, ...ARCH[o.arch], stress: 10, memory: [], interference: 0, alive: true, lastOrderT: -999,
        lastAskT: {}, grudge: 0, promise: null, incident: null, waitingAnswer: null, inHQ: false, praised: 0, reprimanded: 0,
      };
      this.initCharacter(this.officers[o.id]);
    }
    this.platoons = {};
    for (const p of PLATOONS) {
      this.platoons[p.id] = {
        ...p, maxMen: p.men, wounded: 0, killed: 0, where: p.sector ? { type: 'sector', s: p.sector } : { type: 'res', loc: p.loc },
        onLineSince: START_T - (p.sector ? 26 * 60 : 0), order: { task: 'hold', priority: null, freedom: null }, saveAmmo: false,
        raid: null, counter: null, handover: 0, supportFor: null, auth: { withdraw: 'inherit', initiative: 'inherit' }, known: null,
      };
    }
    this.sectors = {};
    for (const s of SECTOR_IDS) {
      const holder = Object.values(this.platoons).find((p) => p.sector === s);
      this.sectors[s] = {
        id: s, fort: SECTORS[s].fort, line: 'ok', repairEta: 0, held: 'line1', holder: holder ? holder.id : null,
        enemyHold: 0, mines: 0, op: null, shelledUntil: 0, noise: 0,
      };
    }
    for (const p of Object.values(this.platoons)) p.known = { t: START_T - 30, how: 'доклад', men: p.men, ammo: p.ammo, fatigue: p.fatigue, morale: p.morale, wounded: 0, killed: 0 };
    this.depot = { ammo: 14, meds: 10, food: 2.6, water: 2.0, mat: 30, well: true, ration: 1 };
    this.med = { light: 6, severe: 3, healing: [], priority: 'return', fatigue: 20, dead: 0, returned: 0, staff: 6, sanitarsOut: null };
    this.eng = { men: 16, task: null, mat: 0 };
    this.hq = { stage: 0, komendant: 10, threat: 0, reserveCP: 0, cpBuilt: false, relocated: false, pelengRisk: 0, docsBurned: false, pushOp: null };
    this.captain = { fatigue: 15, asleep: false, sleepUntil: 0, visiting: null, authority: 50 };
    this.inbox = [];
    this.log = [];
    this.notes = []; // донесения (бумаги)
    this.knowledge = {};
    for (const s of SECTOR_IDS) this.knowledge[s] = { t: START_T - 30, held: 'line1', our: this.sectors[s].holder, enemy: 'нет данных', combat: false, line: 'ok' };
    this.ledger = { t: START_T - 60, ...this.depot };
    this.airdrop = null;
    this.flags = {};
    this.stats = { enemyKilled: 0, ourKilled: 0, ourWounded: 0, ordersGiven: 0, callsMissed: 0, visits: 0, interventions: 0, trustLog: [] };
    this.enemy = new Enemy(this);
    this.player = { zone: 'hq', x: 0, z: 0 };
    this.staff = new Staff(this);
    this.chain = new Chain(this);
    this.fx = []; // визуальные/звуковые события для мира: {type, sector, near}
    this.subtitle = null;
    this._tick = 0;
  }

  /** Черты, которые проявляются в поведении: решительность, манера докладывать, отношение к капитану. */
  initCharacter(o) {
    const A = o.arch;
    o.resolve ??= { executor: 50, initiator: 90, cautious: 25, natural: 80, veteran: 70, timid: 20 }[A] ?? 50;
    o.style ??= { executor: 'all', initiator: 'serious', cautious: 'all', natural: 'serious', veteran: 'serious', timid: 'all' }[A] ?? 'all';
    o.proposes ??= ['initiator', 'natural', 'veteran'].includes(A);
    o.respect ??= 50;        // уважение к капитану
    o.confidence ??= 55;     // уверенность в решениях капитана
    if (o.style === 'serious') o.reportEvery = 0;
  }

  /** Действенная самостоятельность: доверие к капитану даёт смелость действовать самому. */
  effAuto(o) { return clamp(o.autonomy + (o.confidence - 50) * 0.3, 0, 100); }

  rel(o, key, d, why) {
    o[key] = clamp((o[key] ?? 50) + d, 0, 100);
    if (why && Math.abs(d) >= 4) this.remember(o, why, d);
  }

  // ===================== Время =====================
  update(dtMin) {
    if (this.over) return;
    this._acc = (this._acc || 0) + dtMin;
    while (this._acc >= 1) {
      this._acc -= 1;
      this.t += 1;
      this.tick();
      if (this.over) break;
    }
  }

  tick() {
    this._tick++;
    this.enemy.tick();
    for (const s of SECTOR_IDS) this.combatTick(this.sectors[s]);
    this.movementTick();
    for (const p of Object.values(this.platoons)) this.platoonTick(p);
    for (const o of Object.values(this.officers)) if (o.alive) this.officerTick(o);
    this.commsTick();
    if (this._tick % 10 === 0) { this.logisticsTick(10); this.medTick(10); this.engTick(10); }
    this.captainTick();
    this.hqTick();
    this.inboxTick();
    for (const m of this.inbox) if (!m.routed && this.t >= m.arrive) this.staff.route(m);
    this.staff.tick();
    this.chain.tick();
    if (this.t >= this.reliefT && !this.over) this.finish('victory');
  }

  get time() { return fmtTime(this.t); }
  get night() { return nightness(this.t); }

  // ===================== Утилиты =====================
  P(id) { return this.platoons[id]; }
  O(id) { return this.officers[id]; }
  officerOf(p) { return this.officers[p.officer]; }
  platoonOf(o) { return this.platoons[o.unit]; }
  holderOf(s) { const h = this.sectors[s].holder; return h ? this.platoons[h] : null; }
  reservePlatoons() { return Object.values(this.platoons).filter((p) => p.where.type === 'res' && p.men > 4); }
  inSector(s) { return Object.values(this.platoons).filter((p) => p.where.type === 'sector' && p.where.s === s); }

  remember(o, text, weight) {
    o.memory.push({ t: this.t, text, weight });
    if (o.memory.length > 30) o.memory.shift();
  }

  trust(o, d, why) {
    o.trust = clamp(o.trust + d, 0, 100);
    if (why && Math.abs(d) >= 4) this.remember(o, why, d);
  }

  autonomy(o, d) { o.autonomy = clamp(o.autonomy + d, 0, 100); }

  addLog(from, text, kind = 'msg') {
    this.log.push({ t: this.t, from, text, kind });
    if (this.log.length > 300) this.log.shift();
  }

  say(text, who = null, dur = 5) { this.subtitle = { text, who, until: performance.now() + dur * 1000 }; }

  // ===================== Бой =====================
  defPower(p, sec) {
    const o = this.officerOf(p);
    const ammoF = p.ammo > 0.05 ? 1 : 0.3;
    const fatigueF = 1 - p.fatigue / 220;
    const moraleF = 0.55 + p.morale / 220;
    const offF = o && o.alive ? 0.85 + o.exp / 330 : 0.8;
    const away = o && (o.inHQ || o.atMeeting) ? 0.85 : 1;
    let fortF = 1;
    if (sec) fortF = (sec.held === 'line1' ? 1 + sec.fort / 80 : 1.3) * (sec.posture === 'prepare' ? 1.08 : sec.posture === 'observe' ? 0.96 : 1);
    const handF = p.handover > 0 ? 0.7 : 1;
    const saveF = p.saveAmmo ? 0.85 : 1;
    return p.men * ammoF * fatigueF * moraleF * offF * away * fortF * handF * saveF;
  }

  combatTick(sec) {
    const op = sec.op;
    if (!op || op.phase !== 'active') return;
    const defenders = this.inSector(sec.id);
    let def = 0;
    for (const p of defenders) def += this.defPower(p, sec);
    const nightF = op.type === 'infil' ? 1 + this.night * 0.5 : 1;
    const typeF = op.type === 'feint' ? 0.55 : op.type === 'probe' ? 0.7 : 1;
    const att = op.str * nightF * typeF;
    const ratio = def > 0 ? att / (def * 4.6) : 99;
    op.maxRatio = Math.max(op.maxRatio || 0, ratio);
    op.ratio = ratio;
    sec.noise = Math.min(1, att / 200 + 0.3);

    // потери противника
    let eLoss = def * 0.064 * rnd(0.6, 1.4) * (op.type === 'feint' ? 0.35 : 1);
    if (sec.mines > 0 && op.minutes < 15) { eLoss += 1.5; sec.mines = Math.max(0, sec.mines - 0.1); }
    const hp = this.holderOf(sec.id);
    if (hp && hp.ambush > this.t && op.minutes < 20) eLoss *= 1.25;
    if (sec.posture === 'prepare' && op.minutes < 15) eLoss *= 1.1;
    eLoss = Math.min(op.str, eLoss);
    op.str -= eLoss; op.lost += eLoss; this.stats.enemyKilled += eLoss * 0.4; this.enemy.pool -= 0;
    // наши потери
    if (defenders.length) {
      const total = att * 0.0004 * Math.min(2.2, Math.max(0.3, ratio)) * rnd(0.5, 1.5);
      for (const p of defenders) this.casualties(p, total * (p.men / defenders.reduce((a, b) => a + b.men, 0)), sec.id);
    }
    for (const p of defenders) {
      p.ammo = Math.max(0, p.ammo - 0.03 * (p.men / 28) * (p.saveAmmo ? 0.6 : 1) * (op.type === 'feint' ? 0.8 : 1));
      p.fatigue = clamp(p.fatigue + 0.1, 0, 100);
      const o = this.officerOf(p); if (o) o.stress = clamp(o.stress + 0.25 * (1.2 - o.resil / 100) * Math.max(0.5, ratio), 0, 100);
    }
    op.minutes++;
    op.pressure = clamp((op.pressure || 0) + (ratio - 1) * 0.025, 0, 2);
    this.fx.push({ type: 'combat', sector: sec.id, k: Math.min(1, att / 150) });

    // решение офицера об отходе
    const holder = this.holderOf(sec.id);
    if (holder && sec.held === 'line1' && op.minutes % 4 === 0) this.considerWithdraw(holder, sec, op);

    // прорыв линии
    if (op.pressure >= 1 || defenders.length === 0) {
      op.pressure = 0.25;
      if (sec.held === 'line1') {
        sec.held = 'line2';
        for (const p of defenders) { this.casualties(p, p.men * (holder?.order.priority === 'hold' ? 0.12 : 0.06), sec.id); p.morale -= 8; }
        if (holder) this.report(holder, 'lineLost', { sector: sec.id }, { urgent: true, intel: { held: 'line2', combat: true } });
        op.tookLine1 = true;
      } else {
        this.loseSector(sec, op);
        return;
      }
    }
    // противник выдохся
    const breakFrac = { assault: 0.42, feint: 0.3, probe: 0.3, infil: 0.38, push: 0.45 }[op.type] || 0.4;
    if (op.lost > op.init * breakFrac || op.minutes > op.maxDur) this.endOp(sec, op, true);
  }

  considerWithdraw(p, sec, op) {
    const o = this.officerOf(p);
    if (!o || o.waitingAnswer) return;
    const ord = p.order;
    let threshold = o.withdrawAt;
    if (ord.priority === 'people') threshold *= 0.8;
    if (ord.priority === 'hold') threshold = o.arch === 'cautious' && o.resil < 50 && op.pressure > 0.85 ? 0.85 : 9;
    if (ord.conditional) threshold = Math.min(threshold, 0.7);
    if (p.ammo <= 0.05) threshold *= 0.6;
    if (op.pressure < threshold) {
      // просьба о резерве
      if (op.ratio > o.askReserveAt && !this.recentlyAsked(o, 'reserve', 50)) this.askReserve(p, sec);
      return;
    }
    let free = ord.freedom === 'free' || ord.conditional || this.staff.deleg.withdraw === 'commanders' || p.auth.withdraw === 'yes' || (ord.freedom !== 'strict' && o.autonomy >= 35);
    if (p.auth.withdraw === 'no') free = false;
    if (free || o.arch === 'cautious' && op.pressure > 0.9) {
      sec.held = 'line2';
      op.pressure = 0.1;
      p.morale -= 3;
      const disobey = ord.priority === 'hold' || ord.freedom === 'strict';
      if (disobey) { o.incident = { kind: 'disobey', t: this.t, ratio: op.maxRatio }; this.remember(o, 'отошёл вопреки приказу', -2); }
      else o.incident = { kind: 'withdraw', t: this.t, ratio: op.maxRatio };
      this.report(p, 'selfWithdraw', { sector: sec.id }, { intel: { held: 'line2', combat: true } });
    } else if (!this.recentlyAsked(o, 'withdraw', 30)) {
      o.lastAskT.withdraw = this.t;
      o.waitingAnswer = 'withdraw';
      this.send({
        from: o, unit: p.id, kind: 'askWithdraw', urgent: true, expire: 15,
        text: say(o, 'askWithdraw', { sector: sec.id }),
        intel: { combat: true },
        options: [
          { label: 'Разрешаю. Отходите на вторую линию.', fn: () => { o.waitingAnswer = null; sec.held = sec.held === 'line1' ? 'line2' : sec.held; if (sec.op) sec.op.pressure = 0.1; this.trust(o, 2); this.knowledgePatch(sec.id, { held: 'line2' }); return { text: 'Есть, отходим.' }; } },
          { label: 'Нет. Держаться.', fn: () => { o.waitingAnswer = null; p.order.priority = 'hold'; this.trust(o, o.arch === 'cautious' ? -4 : -1, 'отказал в отходе'); o.lastDenied = this.t; return { text: o.arch === 'cautious' ? 'Есть… держаться. Под вашу ответственность, капитан.' : 'Есть держаться.' }; } },
        ],
        onIgnore: () => {
          o.waitingAnswer = null;
          if (o.arch === 'executor') { this.addLog(o.short, 'Не дождавшись ответа, продолжает удерживать позицию.'); }
          else { sec.held = sec.held === 'line1' ? 'line2' : sec.held; if (sec.op) sec.op.pressure = 0.1; this.trust(o, -4, 'не дождался ответа из штаба'); this.addLog(o.short, 'Не дождавшись ответа, отвёл взвод на вторую линию.'); }
        },
      });
    }
  }

  recentlyAsked(o, what, mins) { return this.t - (o.lastAskT[what] || -999) < mins; }

  askReserve(p, sec) {
    const o = this.officerOf(p);
    o.lastAskT.reserve = this.t;
    const res = this.reservePlatoons();
    const options = [];
    for (const r of res) {
      const eta = RES_LOCS[r.where.loc].t[sec.id] + 5;
      options.push({ label: `Высылаю ${r.name} (${RES_LOCS[r.where.loc].short}, ~${eta} мин)`, fn: () => {
        if (r.where.type !== 'res') return { text: 'Резерв уже ушёл в другое место.' };
        this.orderMove(r, { task: 'reinforce', sector: sec.id, priority: null, freedom: 'free' });
        this.trust(o, o.arch === 'cautious' ? 6 : 4, 'прислал резерв, когда было тяжело');
        o.reserveSent = this.t;
        return { text: o.arch === 'cautious' ? 'Спасибо, капитан! Ждём!' : 'Понял. Ждём.' };
      } });
    }
    options.push({ label: 'Держитесь своими силами.', fn: () => {
      this.trust(o, -3); o.lastDenied = this.t; o.deniedReserve = this.t;
      return { text: o.arch === 'cautious' ? 'Своими силами… Есть.' : o.arch === 'initiator' ? 'Как скажешь. Подержим.' : 'Есть.' };
    } });
    options.push({ label: 'Отходите на вторую линию.', fn: () => {
      if (sec.held === 'line1') { sec.held = 'line2'; if (sec.op) sec.op.pressure = 0.1; }
      this.knowledgePatch(sec.id, { held: 'line2' });
      return { text: 'Есть, отходим на вторую.' };
    } });
    this.send({ from: o, unit: p.id, kind: 'askReserve', urgent: true, expire: 15, text: say(o, 'askReserve', { sector: sec.id }), options, intel: { combat: true }, onIgnore: () => { this.trust(o, -3, 'просил резерв — штаб молчал'); } });
  }

  casualties(p, n, sId) {
    if (n <= 0 || p.men <= 0) return;
    // дробные потери накапливаем
    p._cas = (p._cas || 0) + n;
    while (p._cas >= 1 && p.men > 0) {
      p._cas -= 1;
      p.men -= 1;
      const killed = chance(0.35);
      if (killed) { p.killed++; this.stats.ourKilled++; } else {
        p.wounded++; this.stats.ourWounded++;
        const lost = this.sectors[sId]?.held === 'lost';
        if (!lost || chance(0.5)) this.med.incoming = (this.med.incoming || []).concat([{ t: this.t + rnd(15, 45), severe: chance(0.45), unit: p.id }]);
      }
      p.morale = clamp(p.morale - 1.2 * (1.2 - (this.officerOf(p)?.auth || 50) / 200), 0, 100);
      const o = this.officerOf(p);
      if (o && o.alive && chance(o.arch === 'natural' || o.arch === 'initiator' ? 0.02 : 0.012)) this.officerKilled(p, o);
    }
  }

  officerKilled(p, o) {
    o.alive = false;
    const name = SERGEANT_NAMES.find((n) => !Object.values(this.officers).some((x) => x.name === n)) || 'Сержант Безымянный';
    const arch = pick(['timid', 'veteran', 'executor']);
    const id = 'sgt' + MSG_ID++;
    const nu = {
      id, name, short: name.split(' ').pop(), arch, unit: p.id, ...ARCH[arch],
      exp: arch === 'veteran' ? 70 : 40, disc: 70, init: 30, caution: 60, aggr: 40, auth: 45, resil: 55, care: 60,
      trust: 45, autonomy: 25, stress: 30, memory: [], interference: 0, alive: true, lastOrderT: -999, lastAskT: {}, grudge: 0,
      promise: null, incident: null, waitingAnswer: null, inHQ: false, praised: 0, reprimanded: 0,
      look: { beard: chance(0.5), pale: chance(0.5), cap: true },
      bio: 'Принял взвод после гибели командира. ' + ({ timid: 'Растерян, боится ошибиться.', veteran: 'Опытный, немногословный.', executor: 'Исполнительный служака.' })[arch],
      replaced: o.name,
    };
    this.officers[id] = nu;
    p.officer = id;
    this.initCharacter(this.officers[id]);
    p.morale = clamp(p.morale - 12, 0, 100);
    for (const x of Object.values(this.officers)) if (x.alive && x !== nu) x.stress += 8;
    this.send({ from: nu, unit: p.id, kind: 'officerKilled', urgent: true, expire: 60,
      text: `Капитан… ${o.name} убит. Командование взводом принял ${name}. Жду приказаний.`,
      options: [{ label: 'Принимайте взвод. Держитесь.', fn: () => ({ text: 'Есть.' }) }] });
    this.addLog(p.name, `${o.name} убит.`, 'death');
    this.addLog('Кадры', `${p.name}: командование принял ${name}.`, 'staffchange');
  }

  loseSector(sec, op) {
    sec.held = 'lost';
    const defenders = this.inSector(sec.id);
    for (const p of defenders) {
      this.casualties(p, p.men * 0.2, sec.id);
      p.morale = clamp(p.morale - 15, 0, 100);
      p.where = { type: 'res', loc: 'center' };
      p.sector = null;
      const o = this.officerOf(p);
      if (o) {
        o.incident = { kind: 'lost', t: this.t, ratio: op.maxRatio, followed: p.order.priority === 'hold' };
        if (o.deniedReserve && this.t - o.deniedReserve < 120) this.rel(o, 'confidence', -10, 'просил резерв — не дали, потеряли участок');
        if (o.forced && this.t - o.forced.t < 180) this.rel(o, 'confidence', -10, 'капитан настоял — и мы всё потеряли');
      }
      if (p.id === sec.holder) this.report(p, 'lost', { sector: sec.id }, { urgent: true, intel: { held: 'lost', combat: true } });
    }
    sec.holder = null;
    sec.enemyHold = op.str * 0.6;
    sec.line = 'cut';
    this.enemy.onSectorTaken(sec.id, op.str);
    this.endOp(sec, op, false);
    this.fx.push({ type: 'boom', near: 0.5 });
  }

  endOp(sec, op, repelled) {
    op.phase = 'done';
    sec.op = null;
    sec.noise = 0;
    this.enemy.onOpEnd(op, repelled);
    if (!repelled) return;
    const defenders = this.inSector(sec.id);
    if (sec.held === 'line2' && op.tookLine1) sec.enemyHold = Math.max(sec.enemyHold, op.str * 0.3);
    for (const p of defenders) {
      p.morale = clamp(p.morale + (op.type === 'feint' ? 2 : 7), 0, 100);
      const o = this.officerOf(p);
      if (!o) continue;
      const k = p.killed - (p._kBefore || 0), w = p.wounded - (p._wBefore || 0);
      p._kBefore = p.killed; p._wBefore = p.wounded;
      o.incident = { kind: 'repelled', t: this.t, ratio: op.maxRatio, losses: k + w };
      if (o.reserveSent && this.t - o.reserveSent < 120) { this.rel(o, 'confidence', 6, 'капитан прислал помощь вовремя — отбились'); o.reserveSent = null; }
      if (o.forced && this.t - o.forced.t < 180) { this.rel(o, 'confidence', 5, 'капитан настоял — и оказался прав'); o.forced = null; }
      if (p.id === sec.holder) {
        this.report(p, 'repelled', { sector: sec.id, k, w, ammo: p.ammo }, { intel: { combat: false, enemy: 'атака отбита', held: sec.held } });
        // инициатива: преследование
        if (o.raids >= 1 && this.staff.deleg.initiative !== 'forbid' && op.str < 60 && sec.held === 'line2' && (o.autonomy > 45 || p.order.freedom === 'free') && chance(0.6)) {
          this.startCounter(p, sec, true);
        }
      }
      if (p.ammo < 1.5 && !this.recentlyAsked(o, 'ammo', 90)) this.askAmmo(p);
    }
  }

  askAmmo(p) {
    const o = this.officerOf(p);
    o.lastAskT.ammo = this.t;
    this.send({ from: o, unit: p.id, kind: 'askAmmo', expire: 30, text: say(o, 'askAmmo', { ammo: p.ammo }),
      intel: { },
      options: [
        { label: 'Высылаю два боекомплекта.', disabled: () => this.depot.ammo < 2, fn: () => { this.sendAmmo(p, 2); this.trust(o, 3); return { text: 'Спасибо, капитан. Ждём подносчиков.' }; } },
        { label: 'Один боекомплект — больше нет.', disabled: () => this.depot.ammo < 1, fn: () => { this.sendAmmo(p, 1); this.trust(o, 1); return { text: 'Понял. Будем беречь.' }; } },
        { label: 'Склад пуст. Экономьте.', fn: () => { p.saveAmmo = true; this.trust(o, -2); return { text: o.arch === 'cautious' ? 'Чем же нам стрелять, капитан…' : 'Есть экономить.' }; } },
      ],
      onIgnore: () => this.trust(o, -2, 'просил патроны — не ответили') });
  }

  startCounter(p, sec, own = false) {
    const o = this.officerOf(p);
    p.counter = { sector: sec.id, t: this.t + 20, own };
    if (own) this.send({ from: o, unit: p.id, kind: 'selfCounter', expire: 20, text: say(o, 'selfCounter', { sector: sec.id }), options: [
      { label: 'Добро. Действуйте.', fn: () => { this.trust(o, 3); this.autonomy(o, 3); return { text: 'Есть!' }; } },
      { label: 'Отставить! Назад на позиции.', fn: () => { p.counter = null; this.interfere(o, true); return { text: o.arch === 'initiator' ? 'Капитан, мы же их почти… Есть, отставить.' : 'Есть.' }; } },
    ] });
  }

  resolveCounter(p) {
    const c = p.counter; p.counter = null;
    const sec = this.sectors[c.sector];
    const o = this.officerOf(p);
    if (sec.op) return; // бой продолжается — контратака сорвана
    const mine = this.defPower(p, null) * rnd(0.7, 1.3) * (0.9 + (o?.aggr || 50) / 300);
    const theirs = Math.max(8, sec.enemyHold) * 1.4 * (this.night > 0.5 ? 0.8 : 1);
    const success = mine > theirs * 0.55;
    const loss = Math.min(p.men * 0.3, theirs * 0.05 * rnd(0.6, 1.4));
    const k0 = p.killed + p.wounded;
    this.casualties(p, loss, c.sector);
    const k = p.killed + p.wounded - k0;
    p.fatigue = clamp(p.fatigue + 8, 0, 100);
    if (success) {
      this.stats.enemyKilled += sec.enemyHold * 0.3;
      if (sec.held === 'lost') {
        sec.held = 'line2';
        sec.holder = p.id; p.where = { type: 'sector', s: sec.id }; p.sector = sec.id; p.onLineSince = this.t;
        this.enemy.onSectorRetaken(sec.id);
      } else sec.held = 'line1';
      sec.enemyHold = 0;
      p.morale = clamp(p.morale + 10, 0, 100);
      p.ammo += c.own ? 0.6 : 0.3;
      if (o) { o.incident = { kind: 'counterOk', t: this.t }; if (c.own) this.autonomy(o, 4); else this.rel(o, 'confidence', 5, 'контратака по приказу капитана удалась'); }
      this.report(p, 'counterOk', { k }, { intel: { held: sec.held, combat: false } });
    } else {
      sec.enemyHold *= 0.8;
      p.morale = clamp(p.morale - 6, 0, 100);
      if (o) { o.incident = { kind: 'counterFail', t: this.t, own: c.own }; if (!c.own) this.rel(o, 'confidence', o.forced ? -10 : -6, 'контратака по приказу капитана провалилась'); }
      this.report(p, 'counterFail', { k }, {});
    }
  }

  // ===================== Перемещения =====================
  orderMove(p, ord) {
    const from = p.where;
    let eta = 15;
    if (from.type === 'res') eta = RES_LOCS[from.loc].t[ord.sector] ?? 15;
    else if (from.type === 'sector') eta = 25;
    eta += 5 + rnd(0, 6);
    if (this.night > 0.5) eta *= 1.25;
    if (from.type === 'res') p.homeLoc = from.loc;
    p.where = { type: 'move', to: ord, eta: this.t + eta, from };
    p.order = { task: 'hold', priority: ord.priority, freedom: ord.freedom };
    this.enemy.observeMove(p, ord);
  }

  /** Приказ, отправленный со связным: исполняется по прибытии. */
  courierOrder(p, ord) {
    const eta = this.t + rnd(15, 30) * (this.night > 0.5 ? 1.2 : 1);
    (this.pendingOrders = this.pendingOrders || []).push({ p: p.id, ord, eta, lost: chance(0.08) });
    this.stats.ordersGiven++;
    return eta;
  }

  movementTick() {
    for (const po of [...(this.pendingOrders || [])]) {
      if (this.t < po.eta) continue;
      this.pendingOrders = this.pendingOrders.filter((x) => x !== po);
      const p = this.P(po.p), o = this.officerOf(p);
      if (po.lost || !o) { this.addLog('Связь', `Связной с приказом для ${p.name.replace('взвод', 'взвода')} не вернулся.`, 'bad'); continue; }
      this.applyOrder(p, po.ord);
      this.addLog(o.short, `Приказ получен: ${orderText(po.ord)}.`);
    }
    for (const p of Object.values(this.platoons)) if (p.scout && this.t >= p.scout.t) this.resolveScout(p);
    for (const p of Object.values(this.platoons)) {
      if (p.counter && this.t >= p.counter.t) this.resolveCounter(p);
      if (p.raid && this.t >= p.raid.t) this.resolveRaid(p);
      if (p.handover > 0) p.handover--;
      const w = p.where;
      if (w.type !== 'move' || this.t < w.eta) continue;
      const ord = w.to;
      const o = this.officerOf(p);
      if (ord.task === 'reinforce') {
        const sec = this.sectors[ord.sector];
        if (sec.held === 'lost') { p.counter = { sector: sec.id, t: this.t + 10, own: false }; p.where = { type: 'res', loc: 'center' }; }
        else {
          p.where = { type: 'sector', s: ord.sector, role: 'support' }; p.sector = ord.sector;
          if (!sec.holder) sec.holder = p.id;
        }
        this.report(p, 'arrived', { sector: ord.sector }, { intel: {} });
      } else if (ord.task === 'relieve' && !this.sectors[ord.sector]) {
        p.where = { type: 'res', loc: ord.backLoc || 'center' }; p.sector = null;
      } else if (ord.task === 'relieve') {
        const sec = this.sectors[ord.sector];
        const old = this.holderOf(ord.sector);
        p.where = { type: 'sector', s: ord.sector }; p.sector = ord.sector; p.onLineSince = this.t;
        sec.holder = p.id; p.handover = 20;
        if (old && old !== p) {
          old.handover = 20;
          old.where = { type: 'move', to: { task: 'toRes', loc: ord.backLoc || 'center' }, eta: this.t + 20 + RES_LOCS[ord.backLoc || 'center'].t[ord.sector], from: { type: 'sector', s: ord.sector } };
          old.sector = null;
          const oo = this.officerOf(old);
          if (oo && oo.promise && oo.promise.what === 'relief') { this.trust(oo, 6, 'обещал смену — и сменил'); oo.promise = null; }
          else if (oo) this.trust(oo, 4, 'сменил нас вовремя');
        }
        this.enemy.observeHandover(ord.sector);
        this.report(p, 'arrived', { sector: ord.sector }, { intel: { our: p.id } });
      } else if (ord.task === 'moveRes' || ord.task === 'toRes' || ord.task === 'returnRes') {
        p.where = { type: 'res', loc: ord.loc };
        p.sector = null;
        p.saveAmmo = false;
      }
    }
  }

  // ===================== Взвод =====================
  platoonTick(p) {
    const n = this.night;
    const w = p.where;
    if (p.men <= 0) return;
    if (w.type === 'sector') {
      const sec = this.sectors[w.s];
      const shelled = sec.shelledUntil > this.t;
      const post = sec.posture === 'prepare' ? 1.6 : sec.posture === 'observe' ? 0.75 : 1;
      p.fatigue = clamp(p.fatigue + (0.012 + n * 0.012 + (shelled ? 0.03 : 0)) * post * (this.depot.food <= 0 ? 1.5 : 1), 0, 100);
      if (sec.posture === 'prepare' && !sec.op && sec.held !== 'lost') sec.fort = clamp(sec.fort + 0.006, 0, Math.max(sec.fort, Math.min(95, SECTORS[sec.id].fort + 20)));
      if (!sec.op && p.fatigue > 0) p.fatigue = clamp(p.fatigue - 0.004, 0, 100); // урывками спят
    } else if (w.type === 'res') {
      const rest = w.loc === 'hq' ? 0.075 : w.loc === 'center' ? 0.065 : 0.05;
      p.fatigue = clamp(p.fatigue - rest * (this.depot.food <= 0 ? 0.4 : 1), 0, 100);
      p.morale = clamp(p.morale + 0.008, 0, 100);
    } else if (w.type === 'move') p.fatigue = clamp(p.fatigue + 0.03, 0, 100);
    if (p.fatigue > 75) p.morale = clamp(p.morale - 0.02, 0, 100);
    if (this.depot.food <= 0 || this.depot.water <= 0) p.morale = clamp(p.morale - 0.03, 0, 100);
    if (p.morale < 18 && w.type === 'sector' && chance(0.002)) {
      // дезертирство / самовольный отход при сломленной морали
      const k = Math.max(1, Math.round(p.men * 0.05));
      p.men -= k; this.stats.deserted = (this.stats.deserted || 0) + k;
      this.addLog(p.name, `Ночью ${k} чел. оставили позиции. Мораль взвода сломлена.`, 'bad');
    }
  }

  // ===================== Командиры (COM) =====================
  officerTick(o) {
    const p = this.platoonOf(o);
    if (!p || p.men <= 0) return;
    o.stress = clamp(o.stress - 0.03, 0, 100);
    this.selfManage(o, p);
    // регулярные доклады у пунктуальных
    if (o.reportEvery && p.where.type === 'sector' && !this.sectors[p.where.s].op) {
      if (!o.nextReport) o.nextReport = this.t + rnd(20, o.reportEvery);
      if (this.t >= o.nextReport) {
        o.nextReport = this.t + o.reportEvery * (o.autonomy > 60 ? 1.6 : o.autonomy < 25 ? 0.6 : 1) * rnd(0.85, 1.15);
        this.statusReport(o, p, false);
      }
    }
    // просьба о смене
    if (p.where.type === 'sector' && p.fatigue > 62 && !this.sectors[p.where.s].op && !this.recentlyAsked(o, 'relief', o.arch === 'cautious' ? 150 : 240)) {
      if (o.arch !== 'executor' || p.fatigue > 78) this.askRelief(o, p);
    }
    // обещания
    if (o.promise && this.t > o.promise.until) {
      this.trust(o, -10, 'капитан обещал смену и не сдержал слово');
      o.grudge++;
      o.promise = null;
    }
    // самостоятельное укрепление позиции у хороших командиров
    if (p.where.type === 'sector' && !this.sectors[p.where.s].op && o.fortSelf > 0.4 && o.autonomy > 40) {
      const sec = this.sectors[p.where.s];
      if (sec.held !== 'lost') sec.fort = clamp(sec.fort + 0.004 * o.fortSelf, 0, 95);
    }
    // ночная инициатива — вылазки
    const initiative = p.auth.initiative !== 'inherit' ? p.auth.initiative : this.staff.deleg.initiative;
    if (o.raids > 0 && initiative !== 'forbid' && this.night > 0.8 && p.where.type === 'sector' && !this.sectors[p.where.s].op && !p.raid && p.men > 15 && p.fatigue < 70) {
      const k = this.flags['raid_' + o.id] || 0;
      if (this.t > k && chance(0.004 * o.raids)) {
        this.flags['raid_' + o.id] = this.t + 600;
        if ((o.autonomy > 70 && o.trust > 55) || initiative === 'allow') this.startRaid(p, true);
        else this.send({ from: o, unit: p.id, kind: 'raidAsk', expire: 40, text: say(o, 'raidAsk', {}),
          options: [
            { label: 'Разрешаю. Осторожно.', fn: () => { this.startRaid(p, false); this.trust(o, 4, 'капитан доверил вылазку'); this.autonomy(o, 4); return { text: 'Есть!' }; } },
            { label: 'Запрещаю. Сидите тихо.', fn: () => { this.trust(o, o.arch === 'initiator' ? -4 : -2, 'запретил вылазку'); this.autonomy(o, -2); return { text: o.arch === 'initiator' ? 'Жаль. Такой случай…' : 'Понял.' }; } },
          ] });
      }
    }
    // помощь соседу
    if (p.where.type === 'sector' && !this.sectors[p.where.s].op && ((o.init > 50 && o.autonomy > 45) || (o.coordUntil > this.t && o.init > 30 && o.autonomy > 35)) && p.men > 18 && !p.helpSent) {
      for (const adj of SECTORS[p.where.s].adj) {
        const op = this.sectors[adj].op;
        if (op && op.phase === 'active' && op.ratio > 1.2 && chance(0.01)) {
          const nb = this.holderOf(adj);
          if (!nb) break;
          const n = Math.min(6, Math.round(p.men * 0.2));
          p.men -= n; nb.men += n; p.helpSent = { to: nb.id, n, until: this.t + 120 };
          this.report(p, 'help', { to: SECTORS[adj].loc }, {});
          const no = this.officerOf(nb); if (no) no.relation = (no.relation || 0) + 1;
          break;
        }
      }
    }
    if (p.helpSent && this.t > p.helpSent.until) {
      const nb = this.P(p.helpSent.to);
      const back = Math.min(p.helpSent.n, Math.max(0, nb.men - 4));
      nb.men -= back; p.men += back; p.helpSent = null;
    }
    // поддержка соседа выполнена — самостоятельный возврат в резерв
    if (p.where.type === 'sector' && p.where.role === 'support') {
      const sec = this.sectors[p.where.s];
      if (sec.op) p.quietSince = null;
      else if (!p.quietSince) p.quietSince = this.t;
      else if (this.t - p.quietSince > (o.autonomy > 55 ? 40 : 90) && (o.autonomy > 35 || p.order.freedom === 'free')) {
        p.quietSince = null;
        const back = p.homeLoc || 'center';
        p.where = { type: 'move', to: { task: 'moveRes', loc: back }, eta: this.t + RES_LOCS[back].t[sec.id] + 5, from: p.where };
        p.sector = null;
        if (sec.holder === p.id) sec.holder = null;
        this.send({ from: o, unit: p.id, kind: 'backRes', expire: 30, quiet: true, text: `${o.short}: «Здесь отбились. Возвращаюсь в резерв — ${RES_LOCS[back].name}. Если снова понадоблюсь — зовите.»`, options: [{ label: 'Добро.', fn: () => { this.trust(o, 2); return {}; } }, { label: 'Нет, оставайтесь на месте.', fn: () => { p.where = { type: 'sector', s: sec.id, role: 'support' }; p.sector = sec.id; this.interfere(o, true); return { text: 'Есть остаться.' }; } }] });
      }
    }
    // обида: личный визит с претензией
    if (o.grudge >= 2 && !o.inHQ && !this.flags['complain_' + o.id] && p.where.type !== 'move' && !(p.where.type === 'sector' && this.sectors[p.where.s].op)) {
      this.flags['complain_' + o.id] = true;
      this.visit(o, 'complain');
    }
    // срыв у неустойчивых
    if (o.stress > 85 && o.resil < 50 && !this.flags['break_' + o.id]) {
      this.flags['break_' + o.id] = true;
      this.breakdown(o, p);
    }
  }

  /** Командир сам ведёт хозяйство взвода — так, как умеет и как ему свойственно. */
  selfManage(o, p) {
    const inSec = p.where.type === 'sector';
    const sec = inSec ? this.sectors[p.where.s] : null;
    const quiet = !sec || !sec.op;
    // отдых по сменам: опытный и заботливый командир даёт людям спать по очереди
    if (inSec && quiet && !o.inHQ) {
      const k = 0.0022 * (o.exp / 60) * (0.5 + o.care / 140);
      p.fatigue = clamp(p.fatigue - k, 0, 100);
      if (o.style === 'all' && p.fatigue > 45 && !this.recentFlag('rest_' + o.id, 360)) {
        this.send({ from: o, unit: p.id, kind: 'selfRest', quiet: true, expire: 30, options: [{ label: 'Понял.', fn: () => ({}) }],
          text: { executor: `${o.short}: «Докладываю: организовал отдых по сменам — треть взвода спит, остальные на постах.»`, cautious: `${o.short}: «Капитан, людей кладу спать по очереди. Иначе к утру никого не останется.»`, timid: `${o.short}: «Разрешите… я положил половину людей спать. Это ничего?»` }[o.arch] || `${o.short}: «Люди отдыхают по сменам.»` });
      }
    }
    // дисциплина держится на авторитете
    const target = 35 + o.auth * 0.45;
    if (p.morale < target) p.morale = clamp(p.morale + 0.003 * (o.auth / 60), 0, 100);
    // патроны: осторожный спрашивает раньше
    const thr = 1.2 + o.caution / 110;
    if (inSec && quiet && p.ammo < thr && !this.recentlyAsked(o, 'ammo', 120) && !(this.deliveries || []).some((d) => d.p === p.id)) this.askAmmo(p);
    // противник готовит атаку на участок
    if (inSec && quiet && this.enemy.visibleNear(p.where.s) && !this.recentlyAsked(o, 'prep', 300) && (o.proposes || o.resolve < 40)) {
      o.lastAskT.prep = this.t;
      this.prepReaction(o, p, sec);
    }
    // издёрганный командир ошибается
    o.shaky = o.stress > 60 && o.resil < 55;
  }

  prepReaction(o, p, sec) {
    const s = sec.id;
    if (o.proposes) {
      const txt = { initiator: `${o.short}: «Капитан, они накапливаются передо мной. Предлагаю не ждать: выдвину пулемёт в сапу и встречу их на подходе. Разрешаете?»`,
        natural: `${o.short}: «Перед нами копошатся. Я бы поднял брустверы и перенёс пулемёт. Займусь, если не против.»`,
        veteran: `${o.short}: «Готовятся. Могу поставить растяжки на тропах. Делать?»` }[o.arch] || `${o.short}: «Противник готовится. Есть предложение.»`;
      this.send({ from: o, unit: p.id, kind: 'proposal', expire: 40, text: txt, options: [
        { label: 'Делайте.', fn: () => { p.ambush = this.t + 240; sec.fort = clamp(sec.fort + 6, 0, 95); p.fatigue = clamp(p.fatigue + 5, 0, 100); this.autonomy(o, 3); this.rel(o, 'confidence', 2); return { text: 'Есть! Встретим.' }; } },
        { label: 'Только укрепитесь, вперёд не высовываться.', fn: () => { sec.fort = clamp(sec.fort + 8, 0, 95); p.fatigue = clamp(p.fatigue + 4, 0, 100); return { text: 'Понял. Окопаемся.' }; } },
        { label: 'Нет. Сидеть тихо.', fn: () => { this.autonomy(o, -2); return { text: o.arch === 'initiator' ? 'Жаль. Есть сидеть.' : 'Понял.' }; } },
      ], onIgnore: () => { if (this.effAuto(o) > 55) { p.ambush = this.t + 240; this.addLog(o.short, 'Не дождавшись ответа, сам выдвинул пулемёт вперёд.'); } } });
    } else {
      this.send({ from: o, unit: p.id, kind: 'askOrders', expire: 40, text: { cautious: `${o.short}: «Капитан, они готовятся напасть. Что прикажете? Может, прислать резерв поближе?..»`, timid: `${o.short}: «Капитан… перед нами движение. Что мне делать?»` }[o.arch] || `${o.short}: «Противник готовится. Жду указаний.»`, options: [
        { label: 'Держаться. При сильном натиске — отходить на вторую линию.', fn: () => { p.order = { ...p.order, priority: 'people', freedom: 'free', conditional: true }; this.rel(o, 'confidence', 3); return { text: 'Понял… понял. Так и сделаю.' }; } },
        { label: 'Резерв подтянем ближе к вам.', fn: () => { const r = this.reservePlatoons()[0]; if (!r) return { text: 'Резерва нет, капитан?.. Ясно.' }; this.applyOrder(r, { task: 'moveRes', loc: 'near' + s, locName: '' }); this.rel(o, 'confidence', 5); return { text: 'Спасибо, капитан. Так спокойнее.' }; } },
        { label: 'Без паники. Действуйте сами.', fn: () => { this.autonomy(o, 4); o.stress += 6; return { text: '…Есть.' }; } },
      ] });
    }
  }

  statusReport(o, p, asked) {
    const sec = p.where.type === 'sector' ? this.sectors[p.where.s] : null;
    const est = sec ? this.enemy.visibleNear(sec.id) : 0;
    const enemy = !sec ? 'в моём районе тихо' : est > 0 ? `перед нами ${this.estimate(o, est)}, накапливаются` : pick(['перед фронтом тихо', 'противник не активен', 'изредка постреливают']);
    const honesty = o.trust < 30 && o.arch !== 'executor';
    const men = honesty ? p.men + 3 : p.men;
    this.send({
      from: o, unit: p.id, kind: 'status', expire: asked ? 30 : 25, quiet: !asked,
      text: say(o, 'status', { men, ammo: p.ammo, fatigue: p.fatigue, morale: p.morale, enemy, fort: sec ? (sec.fort > 60 ? 'в хорошем состоянии' : sec.fort > 35 ? 'частично разрушены' : 'разрушены') : '—' }),
      intel: sec ? { enemy: est > 0 ? this.estimate(o, est) : 'тихо', combat: false, held: sec.held, our: p.id } : {},
      options: [{ label: 'Понял. Продолжайте.', fn: () => ({}) }],
    });
  }

  estimate(o, real) {
    const noise = 1 + rnd(-1, 1) * (100 - o.exp) / 140;
    const mood = o.trust < 30 ? 1.2 : 1;
    return strengthWords(real * o.estimateMul * noise * mood);
  }

  askRelief(o, p) {
    o.lastAskT.relief = this.t;
    const hours = Math.round((this.t - p.onLineSince) / 60);
    const res = this.reservePlatoons();
    const options = [];
    const sAsk = p.where.s;
    for (const r of res) options.push({ label: `Меняю сейчас: ${r.name} выходит к вам.`, fn: () => {
      if (!sAsk || r.where.type !== 'res') return { text: 'Поздно — обстановка изменилась.' };
      this.orderMove(r, { task: 'relieve', sector: sAsk, backLoc: r.where.loc });
      this.trust(o, 5, 'сменил нас по просьбе'); return { text: 'Спасибо, капитан.' };
    } });
    options.push({ label: 'Смена будет через четыре часа. Слово.', fn: () => {
      o.promise = { what: 'relief', until: this.t + 240 + 30 }; this.trust(o, 2); return { text: 'Понял. Четыре часа. Дождёмся.' };
    } });
    options.push({ label: 'Сменить некем. Держитесь.', fn: () => { this.trust(o, -3, 'смены не дали'); return { text: o.arch === 'cautious' ? 'Я передам людям… Есть.' : 'Есть держаться.' }; } });
    this.send({ from: o, unit: p.id, kind: 'askRelief', expire: 40, text: say(o, 'askRelief', { hours, fatigue: p.fatigue }), options, intel: {}, onIgnore: () => this.trust(o, -2) });
  }

  breakdown(o, p) {
    this.send({
      from: o, unit: p.id, kind: 'breakdown', urgent: true, expire: 25,
      text: `${o.short}… голос срывается: «Капитан, я не могу… они все умирают. Я отвожу людей. Я отвожу людей, слышите?!»`,
      options: [
        { label: '«Петя, спокойно. Ты нужен своим людям. Дыши. Держись — я рядом.»', fn: () => { o.stress -= 35; this.trust(o, 8, 'капитан поддержал в тяжёлую минуту'); return { text: '…Да. Да, капитан. Простите. Держимся.' }; } },
        { label: '«Отставить истерику! Ещё слово — пойдёшь под трибунал.»', fn: () => { o.stress -= 10; this.trust(o, -10, 'капитан накричал, когда было невыносимо'); p.morale -= 5; return { text: '…Есть. Есть отставить.' }; } },
        { label: '«Сдай командование заместителю и иди в штаб.»', fn: () => { this.visit(o, 'relieved'); p.order.freedom = 'strict'; return { text: 'Есть… иду.' }; } },
      ],
      onIgnore: () => { const sec = p.where.type === 'sector' ? this.sectors[p.where.s] : null; if (sec && sec.held === 'line1') { sec.held = 'line2'; } this.addLog(o.short, 'Отвёл взвод на вторую линию без приказа.', 'bad'); },
    });
  }

  startRaid(p, own) {
    p.raid = { t: this.t + rnd(90, 150), own };
    const o = this.officerOf(p);
    if (own) this.send({ from: o, unit: p.id, kind: 'raidOwn', quiet: true, expire: 30, text: `${o.short}: «Капитан, пошёл за ${pick(['пулемётом', '«языком»', 'их миномётом'])}. Утром доложу.»`, options: [{ label: 'Понял.', fn: () => ({}) }] });
  }

  resolveRaid(p) {
    const r = p.raid; p.raid = null;
    const o = this.officerOf(p);
    if (!o || p.men <= 0) return;
    const skill = (o.exp + o.aggr) / 200 + (this.night > 0.5 ? 0.15 : -0.2) - p.fatigue / 300;
    const ok = Math.random() < 0.35 + skill * 0.5;
    const k0 = p.killed + p.wounded;
    if (ok) {
      this.casualties(p, rnd(0, 2.2), p.where.s || 'N');
      const loot = pick(['пулемёт с двумя коробками лент', 'ящик гранат и «язык»', 'полтора ящика патронов']);
      p.ammo += 0.8; this.enemy.pool -= 15; this.stats.enemyKilled += 8;
      this.enemy.disrupt(p.where.s);
      p.morale = clamp(p.morale + 8, 0, 100);
      o.incident = { kind: 'raidOk', t: this.t };
      this.report(p, 'raidDone', { loot, k: p.killed + p.wounded - k0 }, {});
      if (loot.includes('язык')) this.prisoner();
    } else {
      this.casualties(p, rnd(2, 5), p.where.s || 'N');
      p.morale = clamp(p.morale - 6, 0, 100);
      o.incident = { kind: 'raidFail', t: this.t, own: r.own };
      this.report(p, 'raidFail', { k: p.killed + p.wounded - k0 }, {});
    }
  }

  prisoner() {
    const next = this.enemy.nextMajor();
    const truthful = chance(0.65);
    let dir = next && SECTORS[next.target] ? next.target : next && next.target === 'feint' ? this.enemy.feintDir : pick(['E', 'S']);
    if (!truthful) dir = pick(SECTOR_IDS.filter((s) => s !== dir));
    const when = next ? fmtTime(next.t).hm : '04:00';
    this.notes.push({ t: this.t, title: 'Протокол допроса', text: `Пленный, ефрейтор, сапёрный батальон.\nПоказал: основной удар готовится на ${SECTORS[dir].gen} направлении, около ${when}. Подтягивают миномёты.\nДержится уверенно. Переводчик сомневается в части показаний.` });
    this.adj('Капитан, разведчики привели пленного. Протокол допроса — в папке донесений.');
  }

  /** Командир лично приходит в штаб. */
  visit(o, reason) {
    if (o.inHQ) return;
    const p = this.platoonOf(o);
    o.inHQ = true;
    let text = '', options = [];
    if (reason === 'complain') {
      const bad = o.memory.filter((m) => m.weight < 0).slice(-2).map((m) => m.text);
      text = `${o.short} входит, не снимая каски. «Капитан, разрешите прямо. ${bad.length ? cap(bad.join('; ')) + '.' : ''} Мои люди видят, как к нам относятся. Я так воевать не могу.»`;
      options = [
        { label: '«Ты прав. Я был неправ. Это больше не повторится.»', fn: () => { o.grudge = 0; this.trust(o, 10, 'капитан признал ошибку'); this.captain.authority -= 2; return { text: '…Спасибо. Это много значит. Разрешите идти?' }; } },
        { label: '«Решения принимаю я. Иди к взводу.»', fn: () => { this.trust(o, -4); o.grudge = Math.max(0, o.grudge - 1); return { text: 'Есть. — Он уходит, не козырнув.' }; } },
        { label: '«Ещё одна такая речь — и сдашь взвод.»', fn: () => { this.trust(o, -12, 'капитан пригрозил снять с должности'); o.grudge++; this.captain.authority += 2; return { text: '…Есть. — Дверь хлопает сильнее, чем нужно.' }; } },
      ];
    } else if (reason === 'summoned') {
      text = `${o.short} входит, стряхивает землю с шинели. «Капитан, по вашему приказанию прибыл.»`;
      options = this.officerTalkOptions(o);
    } else if (reason === 'relieved') {
      text = `${o.short} входит, садится на ящик без разрешения. Руки трясутся. «Я… я готов. Делайте что хотите.»`;
      options = [
        { label: 'Налить ему чаю. Дать полчаса. Вернуть во взвод.', fn: () => { o.stress = 20; this.trust(o, 12, 'капитан дал прийти в себя'); return { text: 'Он долго молчит, потом встаёт. «Спасибо. Я пойду к своим.»' }; } },
        { label: 'Отстранить. Взвод примет заместитель.', fn: () => { this.replaceOfficer(o); return { text: 'Он кивает и выходит. Больше вы его в эту осаду не увидите.' }; } },
      ];
    }
    this.send({ from: o, unit: p?.id, channel: 'visit', kind: 'visit_' + reason, text, options, expire: 60, delay: rnd(15, 30),
      onIgnore: () => { this.trust(o, -6, 'пришёл лично — капитан не принял'); }, onClose: () => { o.inHQ = false; } });
  }

  /** Кандидаты на должность командира взвода (сержанты из подразделений гарнизона). */
  candidates() {
    if (!this.cands || this.cands.length < 2) {
      const pool = SERGEANT_NAMES.filter((n) => !Object.values(this.officers).some((x) => x.name === n) && !(this.cands || []).some((c) => c.name === n));
      const arches = [['veteran', 'Воюет с первого дня. Спокоен, говорит мало, бережёт патроны.'], ['executor', 'Служака. Всё по уставу, без самодеятельности.'], ['timid', 'Молод, старательен, но под огнём теряется.'], ['initiator', 'Лихой, любит действовать сам.']];
      this.cands = (this.cands || []).concat(pool.slice(0, 3 - (this.cands || []).length).map((name, i) => { const [arch, desc] = arches[(Math.random() * arches.length) | 0]; return { name, arch, desc }; }));
    }
    return this.cands;
  }

  /** Сменить командира взвода: снятого — в распоряжение штаба, назначенного — на взвод. */
  appoint(p, cand) {
    const old = this.officerOf(p);
    if (old && old.alive) {
      old.alive = false; old.removed = true;
      p.morale = clamp(p.morale - (old.auth > 70 ? 10 : 4), 0, 100);
      for (const x of Object.values(this.officers)) if (x.alive && x !== old) this.trust(x, old.incident && ['disobey', 'lost'].includes(old.incident.kind) ? 1 : -3, `капитан снял ${old.short}`);
    }
    const id = 'sgt' + MSG_ID++;
    const A = ARCH[cand.arch];
    this.officers[id] = { id, name: cand.name, short: cand.name.split(' ').pop(), arch: cand.arch, unit: p.id, ...A,
      exp: cand.arch === 'veteran' ? 72 : cand.arch === 'timid' ? 35 : 50, disc: cand.arch === 'executor' ? 90 : 65, init: cand.arch === 'initiator' ? 80 : 30, caution: 55, aggr: cand.arch === 'initiator' ? 75 : 40,
      auth: 50, resil: cand.arch === 'timid' ? 40 : 65, care: 60, trust: 55, autonomy: 30, stress: 15, memory: [], interference: 0, alive: true, lastOrderT: -999, lastAskT: {}, grudge: 0,
      promise: null, incident: null, waitingAnswer: null, inHQ: false, praised: 0, reprimanded: 0,
      look: { beard: Math.random() < 0.4, pale: Math.random() < 0.5, cap: true }, bio: `Назначен капитаном. ${cand.desc}`, replaced: old ? old.name : null };
    p.officer = id;
    this.initCharacter(this.officers[id]);
    this.cands = this.cands.filter((c) => c !== cand);
    this.addLog('Кадры', `${p.name}: командир — ${cand.name}${old ? ` (вместо ${old.short})` : ''}.`, 'staffchange');
    return this.officers[id];
  }

  replaceOfficer(o) {
    const p = this.platoonOf(o);
    o.alive = false; o.removed = true;
    const name = pick(SERGEANT_NAMES.filter((n) => !Object.values(this.officers).some((x) => x.name === n))) || 'Сержант Безымянный';
    const id = 'sgt' + MSG_ID++;
    this.officers[id] = { id, name, short: name.split(' ').pop(), arch: 'executor', unit: p.id, ...ARCH.executor, exp: 45, disc: 80, init: 25, caution: 55, aggr: 40, auth: 40, resil: 60, care: 55,
      trust: 50, autonomy: 20, stress: 20, memory: [], interference: 0, alive: true, lastOrderT: -999, lastAskT: {}, grudge: 0, promise: null, incident: null, waitingAnswer: null, inHQ: false, praised: 0, reprimanded: 0,
      look: { beard: false, pale: false, cap: true }, bio: `Назначен вместо ${o.short}.`, replaced: o.name };
    p.officer = id;
    this.initCharacter(this.officers[id]);
    p.morale = clamp(p.morale - 8, 0, 100);
    for (const x of Object.values(this.officers)) if (x.alive && x.id !== id) this.trust(x, -3, `капитан снял ${o.short}`);
  }

  officerTalkOptions(o) {
    const p = this.platoonOf(o);
    const inc = o.incident && this.t - o.incident.t < 360 ? o.incident : null;
    return [
      { label: 'Объявить благодарность.', fn: () => {
        const deserved = inc && ['repelled', 'counterOk', 'raidOk', 'withdraw'].includes(inc.kind);
        o.praised++;
        if (deserved) { this.rel(o, 'respect', 4); this.trust(o, 7, 'капитан отметил нашу работу'); p.morale = clamp(p.morale + 8, 0, 100); return { text: '— Служу! — Он едва заметно улыбается.' }; }
        this.trust(o, 2); return { text: '…Спасибо. — Похоже, он не понял, за что.' };
      } },
      { label: 'Сделать выговор.', fn: () => {
        o.reprimanded++;
        const fair = inc && (inc.kind === 'disobey' || inc.kind === 'raidFail' && inc.own || (inc.kind === 'withdraw' && inc.ratio < 0.9) || inc.kind === 'counterFail' && inc.own);
        if (fair) { o.disc = clamp(o.disc + 10, 0, 100); this.trust(o, -2); this.rel(o, 'respect', ['executor', 'veteran'].includes(o.arch) ? 3 : -1); return { text: 'Есть… Виноват. Учту.' }; }
        this.trust(o, -14, 'незаслуженный выговор'); o.grudge++; this.rel(o, 'respect', -10); this.rel(o, 'confidence', -5);
        for (const x of Object.values(this.officers)) if (x.alive && x !== o && x.trust > 0) this.trust(x, -2);
        return { text: 'Он бледнеет. «Капитан, при всём уважении — я сделал всё, что мог. Разрешите идти.»' };
      } },
      { label: 'Расспросить о взводе.', fn: () => ({ text: this.platoonTruth(p, o) }) },
      { label: 'Действуйте по обстановке — я вам доверяю.', fn: () => { this.autonomy(o, 8); p.order.freedom = 'free'; this.trust(o, 4, 'капитан сказал, что доверяет'); return { text: o.arch === 'executor' ? 'Есть… действовать по обстановке. — Видно, что ему непривычно.' : 'Спасибо. Не подведу.' }; } },
      { label: 'Свободен. Возвращайся к взводу.', fn: () => ({ text: 'Есть.' }) },
    ];
  }

  platoonTruth(p, o) {
    const sec = p.where.type === 'sector' ? this.sectors[p.where.s] : null;
    const l = [`В строю ${p.men} человек, выбыло ${p.killed} убитыми и ${p.wounded} ранеными.`, cap(ammoWords(p.ammo, 'x')) + '.', cap(fatigueWords(p.fatigue)) + '.', cap(moraleWords(p.morale)) + '.'];
    if (sec) l.push(`Укрепления ${sec.fort > 60 ? 'держатся' : sec.fort > 35 ? 'побиты' : 'разрушены'}. Держим ${sec.held === 'line1' ? 'первую линию' : 'вторую линию'}.`);
    return l.join(' ');
  }

  interfere(o, override) {
    o.interference++;
    this.stats.interventions++;
    this.autonomy(o, o.arch === 'executor' ? -1 : -5);
    if (o.arch === 'initiator' || o.arch === 'natural') this.trust(o, -3, override ? 'капитан отменил моё решение' : 'капитан дёргает по мелочам');
  }

  // ===================== Приказы =====================
  ordersFor(p) {
    const list = [];
    const w = p.where;
    list.push({ task: 'report', label: 'Доложить обстановку' });
    if (w.type === 'sector') {
      list.push({ task: 'hold', label: 'Удерживать позиции', params: ['priority', 'freedom'] });
      if (this.sectors[w.s].held === 'line1') list.push({ task: 'withdraw', label: 'Отойти на вторую линию' });
      if (this.sectors[w.s].held === 'line2') list.push({ task: 'counter', label: 'Контратаковать, вернуть первую линию' });
      if (this.night > 0.5 && !p.raid) list.push({ task: 'raid', label: 'Вылазка малой группой (ночь)' });
      list.push({ task: p.saveAmmo ? 'freeAmmo' : 'saveAmmo', label: p.saveAmmo ? 'Отменить экономию патронов' : 'Экономить боеприпасы' });
      if (w.role === 'support') list.push({ task: 'returnRes', label: 'Вернуться в резерв', params: ['loc'] });
    }
    if (w.type === 'res') {
      list.push({ task: 'reinforce', label: 'Выдвинуться на усиление сектора', params: ['sector', 'priority', 'freedom'] });
      list.push({ task: 'relieve', label: 'Сменить взвод на позиции', params: ['sector'] });
      list.push({ task: 'counterSector', label: 'Контратаковать потерянный сектор', params: ['lostSector'] });
      list.push({ task: 'moveRes', label: 'Переместить резерв', params: ['loc'] });
    }
    if (p.id === 'pw' && !p.scout) list.push({ task: 'scout', label: 'Разведать направление (2–3 ч)', params: ['sectorAny'] });
    if (w.type !== 'move') list.push({ task: 'come', label: 'Явиться в штаб лично' });
    return list;
  }

  /** Отдать приказ. Возвращает реплику командира (и, возможно, варианты). */
  issueOrder(p, ord, via = 'phone') {
    const o = this.officerOf(p);
    this.stats.ordersGiven++;
    const sinceLast = this.t - o.lastOrderT;
    const routine = ord.task === 'report' || ord.task === 'come';
    if (!routine && sinceLast < 45) this.interfere(o, false);
    if (!routine) o.lastOrderT = this.t;
    if (ord.freedom === 'free') this.autonomy(o, 3);
    if (ord.freedom === 'strict') this.autonomy(o, -2);

    // искажение по плохой связи
    const sec = p.where.type === 'sector' ? this.sectors[p.where.s] : null;
    if (via === 'phone' && sec && (sec.op || sec.shelledUntil > this.t) && chance(0.22)) {
      return { text: repeatOrder(o, ord, garble(orderText(ord))), retry: true };
    }

    // отказ от рискованного
    const refuse = this.wouldRefuse(o, p, ord);
    if (refuse) {
      return { text: refuse, options: [
        { label: 'Это приказ. Выполнять.', fn: () => { this.trust(o, -6, 'капитан настоял на своём'); o.forced = { t: this.t, ord }; this.applyOrder(p, ord); return { text: o.arch === 'cautious' ? '…Есть. Есть выполнять.' : 'Есть.' }; } },
        { label: 'Хорошо. Действуйте как считаете нужным.', fn: () => { this.trust(o, 5, 'капитан прислушался'); this.autonomy(o, 4); return { text: 'Спасибо, капитан.' }; } },
      ] };
    }
    this.applyOrder(p, ord);
    if (ord.task === 'report') return { text: '' };
    if (ord.task === 'come') return { text: o.arch === 'natural' ? 'Сейчас? …Иду.' : 'Есть явиться. Выхожу.' };
    let txt = repeatOrder(o, ord);
    if (o.confidence < 30) txt += pick([' …Под вашу ответственность, капитан.', ' Опять перекраиваем. Ладно.', ' Сделаю. Но я бы решил иначе.']);
    else if (o.confidence > 75 && o.arch !== 'executor') txt = pick(['Есть! ', 'Понял вас, капитан. ', '']) + txt;
    if (o.respect < 30) txt += ' — сухо, без «товарища капитана».';
    return { text: txt };
  }

  wouldRefuse(o, p, ord) {
    if (o.refuses <= 0) return null;
    const trustF = (60 - o.trust) / 60 + (50 - o.confidence) / 120;
    if (ord.task === 'counter' || ord.task === 'counterSector') {
      const s = ord.task === 'counter' ? p.where.s : ord.sector;
      const sec = this.sectors[s];
      const odds = sec ? (Math.max(8, sec.enemyHold) * 1.4) / Math.max(1, this.defPower(p, null)) : 1;
      if (odds > 0.9 && Math.random() < o.refuses * (0.4 + trustF)) {
        return o.arch === 'cautious' ? `Капитан… это верная смерть. У них там ${strengthWords(sec.enemyHold * 1.5)}, а у меня ${p.men} человек. Я не поведу людей на пулемёты.` : `Капитан, не пройдём. Их там больше, чем кажется. Я против.`;
      }
    }
    if (ord.task === 'hold' && ord.priority === 'hold' && p.men < 14 && Math.random() < o.refuses * (0.3 + trustF)) {
      return `Любой ценой? У меня ${p.men} человек, капитан. «Любой ценой» — это значит всеми. Подумайте ещё раз.`;
    }
    if (ord.task === 'raid' && p.fatigue > 70 && Math.random() < o.refuses) return 'Люди еле на ногах, капитан. Сходим — не вернёмся.';
    return null;
  }

  applyOrder(p, ord) {
    const o = this.officerOf(p);
    const sec = p.where.type === 'sector' ? this.sectors[p.where.s] : null;
    switch (ord.task) {
      case 'report': this.statusReport(o, p, true); break;
      case 'hold': p.order = { task: 'hold', priority: ord.priority, freedom: ord.freedom, conditional: ord.freedom === 'free' && ord.priority !== 'hold' }; break;
      case 'withdraw': if (sec && sec.held === 'line1') { sec.held = 'line2'; if (sec.op) sec.op.pressure = 0.1; this.knowledgePatch(sec.id, { held: 'line2' }); } break;
      case 'counter': this.startCounter(p, sec, false); break;
      case 'raid': this.startRaid(p, false); break;
      case 'saveAmmo': p.saveAmmo = true; break;
      case 'freeAmmo': p.saveAmmo = false; break;
      case 'reinforce': case 'relieve': this.orderMove(p, { ...ord, backLoc: p.where.loc }); break;
      case 'counterSector': this.orderMove(p, { task: 'reinforce', sector: ord.sector, freedom: 'free' }); break;
      case 'moveRes': case 'returnRes': p.where = { type: 'move', to: { task: 'moveRes', loc: ord.loc }, eta: this.t + 15 + rnd(0, 8), from: p.where }; this.enemy.observeMove(p, ord); break;
      case 'come': this.visit(o, 'summoned'); break;
      case 'scout': p.scout = { dir: ord.sector, t: this.t + rnd(120, 180) }; break;
    }
  }

  resolveScout(p) {
    const sc = p.scout; p.scout = null;
    const o = this.officerOf(p);
    if (!o) return;
    const k0 = p.killed + p.wounded;
    if (chance(this.night > 0.5 ? 0.12 : 0.3)) this.casualties(p, rnd(1, 3), 'W');
    const k = p.killed + p.wounded - k0;
    const plan = this.enemy.plan.filter((x) => !x.started && x.t < this.t + 600 && (x.target === sc.dir || (!x.prepped && chance(0.3))))[0];
    let text;
    if (plan && plan.target === sc.dir) text = `Ходили к ${SECTORS[sc.dir].gen} сектору. Противник готовится: ${strengthWords(plan.str * rnd(0.85, 1.15))}, ${plan.type === 'feint' ? 'шумят, но окопов не роют — похоже на показуху' : plan.type === 'infil' ? 'малыми группами, тихо' : 'подвозят мины, роют исходные'}. Думаю, около ${fmtTime(plan.t + rnd(-30, 30)).hm}.`;
    else if (plan) text = `Перед ${SECTORS[sc.dir].ins} сектором тихо. Но слышали, как техника шла в сторону ${SECTORS[plan.target]?.gen || 'южного'} сектора.`;
    else text = `Перед ${SECTORS[sc.dir].ins} сектором тихо. Противник сидит в окопах, накопления нет.`;
    if (k) text += ` Потеряли ${k}.`;
    this.send({ from: o, unit: p.id, kind: 'scout', expire: 60, text, intel: {}, intelSector: sc.dir, options: [{ label: 'Понял. Отдыхайте.', fn: () => ({}) }] });
    if (plan && plan.target === sc.dir) this.knowledgePatch(sc.dir, { enemy: strengthWords(plan.str) + ' (разведка)' });
  }

  // ===================== Связь и сообщения =====================
  /** Канал доставки от подразделения. */
  channelFor(p) {
    if (!p) return 'phone';
    const w = p.where;
    if (w.type === 'res' && w.loc === 'hq') return 'visit';
    if (w.type === 'sector' && this.sectors[w.s].line === 'cut') return 'courier';
    if (w.type === 'move') return 'courier';
    return 'phone';
  }

  report(p, key, params, opts = {}) {
    const o = this.officerOf(p);
    if (!o) return;
    this.send({ from: o, unit: p.id, kind: key, urgent: opts.urgent, intel: opts.intel, expire: opts.urgent ? 20 : 30,
      text: say(o, key, { ...params, time: this.time.hm, est: params.est }), options: [{ label: 'Понял.', fn: () => ({}) }] });
  }

  send(m) {
    m.id = MSG_ID++;
    m.t = this.t;
    if (!m.channel) m.channel = m.from && m.from.unit ? this.channelFor(this.P(m.unit || m.from.unit)) : 'phone';
    let delay = m.delay ?? 0;
    if (m.channel === 'courier') {
      delay += rnd(12, 28);
      const sec = this.P(m.unit)?.where.s;
      if (sec && this.sectors[sec].op && chance(0.12)) { this.addLog('Связь', `Связной от ${m.from.short} не дошёл.`, 'bad'); return; }
    }
    m.arrive = this.t + delay;
    m.expireAt = m.arrive + (m.expire ?? 30) + (m.channel === 'courier' || m.channel === 'visit' ? 60 : 0);
    m.fromName = m.from?.short || m.fromName || '—';
    m.fromFull = m.from?.name || m.fromName;
    this.inbox.push(m);
  }

  staffMsg(key, text, options = [{ label: 'Понял.', fn: () => ({}) }], extra = {}) {
    const st = STAFF[key];
    this.send({ fromName: st.short, from: { short: st.short, name: st.name, staff: key }, channel: extra.channel || 'phone', kind: 'staff', text, options, expire: 40, ...extra });
  }

  adj(text) { this.say(text, 'Гусев', 7); this.addLog('Гусев', text, 'adj'); }

  /** Сообщения, готовые к доставке по каналу. */
  pending(channel) { return this.inbox.filter((m) => m.channel === channel && this.t >= m.arrive && !m.done && m.route === 'player'); }

  /** Капитан лично осмотрел позицию: карта получает достоверные данные. */
  observe(s) {
    const sec = this.sectors[s];
    if (!sec) return;
    for (const p of this.inSector(s)) this.snapshot(p, 'лично');
    const op = sec.op && sec.op.phase === 'active' ? sec.op : null;
    this.knowledgePatch(s, { held: sec.held, our: sec.holder, combat: !!op, line: sec.line, enemy: op ? strengthWords(op.str) + ' (лично)' : sec.held === 'lost' ? 'противник в секторе' : 'тихо (лично)' });
  }

  ringing() { return this.pending('phone').sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0))[0] || null; }

  /** Игрок принял сообщение: применяем разведданные и пишем в журнал. */
  /** Что штаб знает о взводе (по последнему докладу или личному осмотру). */
  snapshot(p, how = 'доклад') {
    if (!p) return;
    p.known = { t: this.t, how, men: p.men, ammo: p.ammo, fatigue: p.fatigue, morale: p.morale, wounded: p.wounded, killed: p.killed };
  }

  receive(m) {
    m.done = true;
    if (m.unit && this.P(m.unit)) this.snapshot(this.P(m.unit), m.channel === 'visit' ? 'лично' : 'доклад');
    if (m.unit && m.intel) {
      const p = this.P(m.unit);
      const s = p?.where.s || p?.sector || (m.intel.sector);
      if (s) this.knowledgePatch(s, { ...m.intel, our: m.intel.our || this.sectors[s].holder });
    }
    if (m.intelSector) this.knowledgePatch(m.intelSector, m.intel);
    this.addLog(m.fromName, m.text, m.urgent ? 'urgent' : 'msg');
    this.inbox = this.inbox.filter((x) => x !== m);
  }

  close(m) { m.onClose?.(); }

  knowledgePatch(s, patch) {
    const k = this.knowledge[s];
    Object.assign(k, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
    k.t = this.t;
  }

  inboxTick() {
    for (const m of [...this.inbox]) {
      if (!m.done && this.t > m.expireAt) {
        this.inbox = this.inbox.filter((x) => x !== m);
        if (m.channel === 'phone' && !m.quiet) { this.stats.callsMissed++; this.addLog('Мирон', `Неотвеченный вызов: ${m.fromName}.`, 'missed'); }
        m.onIgnore?.();
        m.onClose?.();
      }
    }
  }

  commsTick() {
    for (const s of SECTOR_IDS) {
      const sec = this.sectors[s];
      if (sec.line === 'cut' && sec.held !== 'lost') {
        if (!sec.repairEta) sec.repairEta = this.t + rnd(35, 70) / (this.eng.task?.type === 'lines' ? 2.5 : 1) * (this.staff.deleg.lines === 'combat' ? (sec.op ? 0.6 : 1.3) : 1);
        if (this.t >= sec.repairEta) {
          sec.line = 'ok'; sec.repairEta = 0;
          this.say(`Связь с ${SECTORS[s].ins} сектором восстановлена.`, 'Мирон', 4);
          this.addLog('Мирон', `Восстановлена линия: ${SECTORS[s].name.toLowerCase()} сектор.`);
          this.knowledgePatch(s, { line: 'ok' });
        }
      }
    }
  }

  cutLine(s) {
    const sec = this.sectors[s];
    if (sec.line === 'cut') return;
    sec.line = 'cut'; sec.repairEta = 0;
    this.say(`Капитан, ${SECTORS[s].name.toLowerCase()} не отвечает — обрыв линии. Линейщики вышли.`, 'Мирон', 5);
    this.addLog('Мирон', `Обрыв линии: ${SECTORS[s].name.toLowerCase()} сектор.`, 'bad');
    this.knowledgePatch(s, { line: 'cut' });
  }

  // ===================== Тыл =====================
  sendAmmo(p, n) {
    n = Math.min(n, this.depot.ammo);
    this.depot.ammo -= n;
    const eta = this.t + rnd(20, 40);
    (this.deliveries = this.deliveries || []).push({ p: p.id, n, eta });
  }

  logisticsTick(m) {
    const d = this.depot;
    const men = Object.values(this.platoons).reduce((a, p) => a + p.men, 0) + 40;
    d.food = Math.max(0, d.food - (m / 1440) * (men / 170) * d.ration);
    d.water = Math.max(0, d.water - (m / 1440) * (men / 170));
    if (d.well) d.water = Math.min(3, d.water + (m / 1440) * 0.9);
    for (const del of [...(this.deliveries || [])]) {
      if (this.t < del.eta) continue;
      this.deliveries = this.deliveries.filter((x) => x !== del);
      const p = this.P(del.p);
      let n = del.n;
      const s = p.where.s;
      if (s && (this.sectors[s].shelledUntil > this.t || this.sectors[s].op) && chance(0.35)) {
        n *= 0.5; this.addLog('Дьяков', `Подносчики к ${p.name} попали под огонь. Дошла половина.`, 'bad');
      }
      p.ammo += n;
    }
    if (d.food <= 0 && !this.flags.hunger) { this.flags.hunger = true; this.staffMsg('dyakov', 'Капитан, продукты кончились. Совсем. Люди второй раз спрашивают про кухню.'); }
    if (d.water <= 0.2 && !this.flags.thirst) { this.flags.thirst = true; this.staffMsg('dyakov', 'Капитан, воды почти нет. Колодец — сами знаете. Растапливаем снег, но это капля.'); }
    if (this.depot.ammo < 3 && !this.flags.ammoLow) { this.flags.ammoLow = true; this.staffMsg('dyakov', `Капитан, на складе патронов — ${n1(this.depot.ammo)} боекомплекта. Это всё. Нужен сброс.`); }
    // сброс снабжения
    if (this.airdrop && this.t >= this.airdrop.t && !this.airdrop.done) this.resolveAirdrop();
  }

  resolveAirdrop() {
    const a = this.airdrop; a.done = true;
    const frac = rnd(0.35, 0.8) * (this.hq.stage >= 3 ? 0.6 : 1);
    const got = { ammo: 8 * frac, meds: 6 * frac, food: 1.2 * frac, mat: 10 * frac };
    this.depot.ammo += got.ammo; this.depot.meds += got.meds; this.depot.food += got.food; this.depot.mat += got.mat;
    this.fx.push({ type: 'plane' });
    const lostNeutral = chance(0.45);
    let text = `Капитан, сброс принят. Собрали: патронов — ${n1(got.ammo)} бк, медикаментов — ${Math.round(got.meds)} упаковок, продуктов — на ${(got.food * 24).toFixed(0)} ч.`;
    const options = [{ label: 'Понял. Распределяй.', fn: () => ({}) }];
    if (lostNeutral) {
      text += ' Ещё три тюка упали в ничейную полосу, перед ' + SECTORS[a.neutral = pick(['N', 'E', 'S'])].gen + ' сектором. Видно их.';
      options.unshift({ label: 'Пусть взвод сходит за тюками.', fn: () => {
        const p = this.holderOf(a.neutral);
        if (!p) return { text: 'Там уже некому идти, капитан.' };
        const ok = chance(this.night > 0.5 ? 0.7 : 0.35);
        const k0 = p.killed + p.wounded;
        this.casualties(p, ok ? rnd(0, 2) : rnd(2, 5), a.neutral);
        if (ok) { this.depot.ammo += 3; this.depot.meds += 3; }
        this.addLog(p.name, ok ? `Тюки вытащили. Потери: ${p.killed + p.wounded - k0}.` : `За тюками ходили неудачно. Потери: ${p.killed + p.wounded - k0}.`);
        return { text: ok ? 'Вытащили! Патроны и бинты.' : 'Не вытащили… Их пулемёт пристрелян. Людей потеряли.' };
      } });
    }
    this.staffMsg('dyakov', text, options);
    this.ledger = { t: this.t, ...this.depot };
  }

  medTick(m) {
    const md = this.med;
    for (const w of [...(md.incoming || [])]) {
      if (this.t < w.t) continue;
      md.incoming = md.incoming.filter((x) => x !== w);
      if (w.severe) md.severe++; else md.light++;
    }
    const load = md.light + md.severe;
    md.fatigue = clamp(md.fatigue + (load > 20 ? 0.5 : -0.3) * (m / 10), 0, 100);
    const eff = (1 - md.fatigue / 160) * (md.staff / 6);
    // лечение лёгких → возврат в строй
    const backRate = (md.priority === 'return' ? 1 / 360 : 1 / 720) * m * eff;
    let back = md.light * backRate;
    md._back = (md._back || 0) + back;
    while (md._back >= 1 && md.light > 0) {
      md._back--; md.light--; md.returned++;
      const ps = Object.values(this.platoons).filter((p) => p.men > 0 && !p.small);
      const p = ps.sort((a, b) => a.men / a.maxMen - b.men / b.maxMen)[0];
      if (p) p.men++;
    }
    // тяжёлые
    const medsNeed = md.severe * 0.02 * (m / 10);
    let death = md.priority === 'severe' ? 0.0025 : 0.005;
    if (this.depot.meds <= 0) death = 0.018; else this.depot.meds = Math.max(0, this.depot.meds - medsNeed);
    if (load > 28) death *= 1.6;
    md._dead = (md._dead || 0) + md.severe * death * m / eff;
    while (md._dead >= 1 && md.severe > 0) { md._dead--; md.severe--; md.dead++; this.stats.ourKilled++; }
    // тяжёлые постепенно стабилизируются
    md._stab = (md._stab || 0) + md.severe * (m / 1440) * eff;
    while (md._stab >= 1 && md.severe > 0) { md._stab--; md.severe--; md.light++; }
    if (this.depot.meds < 2 && !this.flags.medsLow) {
      this.flags.medsLow = true;
      this.staffMsg('grin', 'Капитан, это Гриневич. Медикаменты на исходе. Ещё сутки — и я буду оперировать без наркоза. Мне нужен сброс, или… отдайте мне спирт со склада, хоть что-то.', [
        { label: 'Дьяков, отдать спирт в медпункт.', fn: () => { this.depot.meds += 1.5; this.flags.spirit = true; for (const p of Object.values(this.platoons)) p.morale -= 2; return { text: 'Спасибо. Люди будут ворчать, но двое доживут до утра.' }; } },
        { label: 'Спирт — неприкосновенный запас. Держитесь.', fn: () => ({ text: 'Тогда считайте сами, капитан. Я буду называть вам цифры.' }) },
      ]);
    }
    if (load > 26 && !this.recentFlag('medOverload', 300)) {
      this.staffMsg('grin', `Капитан, у меня ${md.light + md.severe} раненых на ${md.staff} человек персонала. Кладём в проходах. Кого лечить первым?`, [
        { label: 'Тех, кого можно вернуть в строй.', fn: () => { md.priority = 'return'; return { text: 'Понял. Тяжёлые подождут. Не все дождутся.' }; } },
        { label: 'Тяжёлых. Спасайте жизни.', fn: () => { md.priority = 'severe'; return { text: 'Спасибо, капитан. Это правильно. Но строй это не пополнит.' }; } },
      ]);
    }
  }

  recentFlag(k, mins) { if (this.t - (this.flags[k] || -9999) < mins) return true; this.flags[k] = this.t; return false; }

  engTick(m) {
    const e = this.eng;
    if (!e.task) return;
    const speed = (this.night > 0.5 ? 1.25 : 1) * (e.men / 16);
    e.task.progress += (m / e.task.dur) * speed;
    if (e.task.type === 'fort') this.sectors[e.task.sector].fort = clamp(this.sectors[e.task.sector].fort + 30 * (m / e.task.dur) * speed, 0, 95);
    if (e.task.progress >= 1) {
      const t = e.task; e.task = null;
      const txt = {
        fort: `Капитан, Лучко. Укрепления в ${SECTORS[t.sector]?.name.toLowerCase().replace('ый', 'ом').replace('ий', 'ем')} секторе подняли. Накатник, ход сообщения, две запасные ячейки.`,
        mines: `Подступы к ${SECTORS[t.sector]?.gen} сектору заминированы. Сорок мин. Схема — у вас в сейфе.`,
        lines: 'Линии связи переложили, где могли. Пару дней продержатся — если не будет прямых попаданий.',
        cp: 'Запасной командный пункт готов. Блиндаж у колодца, три наката, связь протянута. Если что — есть куда уходить.',
        well: 'Колодец расчистили. Вода будет.',
      }[t.type];
      if (t.type === 'mines') this.sectors[t.sector].mines = 1;
      if (t.type === 'cp') this.hq.cpBuilt = true;
      if (t.type === 'well') this.depot.well = true;
      this.staffMsg('luchko', txt);
    }
  }

  engTasks() {
    const list = [];
    for (const s of SECTOR_IDS) if (this.sectors[s].held !== 'lost') list.push({ type: 'fort', sector: s, label: `Укрепить ${SECTORS[s].gen} сектор`, dur: 240, mat: 8 });
    for (const s of SECTOR_IDS) if (this.sectors[s].held !== 'lost' && !this.sectors[s].mines) list.push({ type: 'mines', sector: s, label: `Минировать подступы ${SECTORS[s].gen} сектора`, dur: 180, mat: 6 });
    list.push({ type: 'lines', label: 'Восстанавливать и перекладывать связь', dur: 180, mat: 3 });
    if (!this.hq.cpBuilt) list.push({ type: 'cp', label: 'Строить запасной командный пункт', dur: 480, mat: 12 });
    if (!this.depot.well) list.push({ type: 'well', label: 'Расчистить колодец', dur: 150, mat: 4 });
    return list;
  }

  engAssign(task) {
    const e = this.eng;
    if (this.depot.mat < task.mat) return { text: `Капитан, материалов нет. Нужно ${task.mat}, на складе — ${Math.floor(this.depot.mat)}. Разбирать блиндажи?` };
    this.depot.mat -= task.mat;
    const was = e.task;
    e.task = { ...task, progress: 0 };
    const hrs = (task.dur / 60 / (this.night > 0.5 ? 1.25 : 1)).toFixed(0);
    return { text: `${was ? 'Бросаю ' + was.label.toLowerCase() + '. ' : ''}Понял: ${task.label.toLowerCase()}. Если не будет обстрела — часа ${hrs}. Если будет — дольше.` };
  }

  // ===================== Капитан =====================
  captainTick() {
    const c = this.captain;
    if (c.asleep) {
      c.fatigue = clamp(c.fatigue - 0.35, 0, 100);
      if (this.t >= c.sleepUntil) this.wake('Гусев трясёт вас за плечо: «Капитан, вы просили разбудить.»');
    } else c.fatigue = clamp(c.fatigue + 0.075, 0, 100);
  }

  sleep(hours) {
    this.captain.asleep = true;
    this.captain.sleepUntil = this.t + hours * 60;
  }

  wake(text) {
    if (!this.captain.asleep) return;
    this.captain.asleep = false;
    if (text) this.say(text, null, 5);
  }

  // ===================== Штаб — угроза =====================
  hqTick() {
    const lost = SECTOR_IDS.filter((s) => this.sectors[s].held === 'lost');
    const line2 = SECTOR_IDS.filter((s) => this.sectors[s].held === 'line2');
    const cut = SECTOR_IDS.filter((s) => this.sectors[s].line === 'cut');
    const combat = SECTOR_IDS.filter((s) => this.sectors[s].op && this.sectors[s].op.phase === 'active');
    const push = this.hq.pushOp;
    let st = 0;
    if (line2.length || cut.length >= 2 || combat.length >= 2) st = 1;
    if (lost.length) st = 2;
    if (lost.length >= 2 || (lost.length && push && push.phase === 'prep')) st = 3;
    if (push && push.phase === 'active') st = 4;
    if (st !== this.hq.stage) this.onStage(st, this.hq.stage);
    this.hq.stage = st;
    if (push && push.phase === 'active') this.pushTick(push);
  }

  onStage(st, prev) {
    if (st > prev) {
      if (st === 2) this.adj('Капитан… раненых несут прямо к нам. Медпункт не успевает. Кладу в предбаннике.');
      if (st === 3 && !this.hq.docsBurned) {
        this.staffMsg('mironova', 'Капитан, разрешите подготовить документы к уничтожению? Если они прорвутся — шифры не должны достаться.', [
          { label: 'Разрешаю. Жечь по моей команде.', fn: () => { this.hq.docsReady = true; return { text: 'Есть. Канистра у печки.' }; } },
          { label: 'Рано. Мы удержимся.', fn: () => { for (const p of Object.values(this.platoons)) p.morale += 1; return { text: 'Есть… — Она смотрит на вас дольше обычного.' }; } },
        ], { channel: 'adj' });
      }
      if (st === 4) this.say('Стрельба у самого хода сообщения! Комендантское отделение — к бою!', 'Гусев', 6);
    }
  }

  pushTick(op) {
    const blockers = Object.values(this.platoons).filter((p) => p.where.type === 'res' && (p.where.loc === 'hq' || p.where.loc === 'center'));
    let def = this.hq.komendant * 1.1 * 1.6 + (this.flags.engInf ? 14 : 0);
    for (const p of blockers) def += this.defPower(p, null) * (p.where.loc === 'hq' ? 1.7 : 1);
    const ratio = op.str / (def * 4);
    op.ratio = ratio;
    op.minutes++;
    const eLoss = Math.min(op.str, def * 0.03 * rnd(0.6, 1.4));
    op.str -= eLoss; op.lost += eLoss; this.stats.enemyKilled += eLoss * 0.4;
    const ourLoss = op.str * 0.0009 * Math.min(2, ratio);
    if (blockers.length) for (const p of blockers) this.casualties(p, ourLoss / blockers.length, 'N');
    else this.hq.komendant = Math.max(0, this.hq.komendant - ourLoss);
    this.hq.threat = clamp(this.hq.threat + Math.min(3, (ratio - 0.9) * 1.2), 0, 100);
    this.fx.push({ type: 'hqfight', k: Math.min(1, op.str / 100) });
    if (this.hq.threat >= 100) this.hqFalls();
    else if (op.lost > op.init * 0.45 || op.str < 15) {
      op.phase = 'done'; this.hq.pushOp = null; this.hq.threat = Math.max(0, this.hq.threat - 30);
      this.adj('Отбились! Отошли они… Капитан, у входа их человек десять лежит.');
      this.enemy.onPushEnd(op);
    }
  }

  hqFalls() {
    if (this.hq.cpBuilt && !this.hq.relocated) {
      this.hq.relocated = true; this.hq.threat = 40; this.hq.pushOp.phase = 'done'; this.hq.pushOp = null;
      for (const s of SECTOR_IDS) if (this.sectors[s].line === 'ok') this.cutLine(s);
      this.say('Штаб оставлен. Вы уходите на запасной КП — под огнём, с картой под шинелью.', null, 8);
      this.fx.push({ type: 'relocate' });
      return;
    }
    this.finish('hq');
  }

  finish(kind) {
    if (this.over) return;
    this.over = kind;
  }

  // ===================== Итоговый рапорт =====================
  report_summary() {
    const ps = Object.values(this.platoons);
    const alive = ps.reduce((a, p) => a + p.men, 0);
    const lines = [];
    lines.push(this.over === 'victory' ? 'Гарнизон удержал рубеж до подхода частей деблокирующей группы.' : this.over === 'hq' ? 'Командный пункт гарнизона захвачен противником. Связь с гарнизоном потеряна.' : 'Гарнизон утратил боеспособность.');
    lines.push('');
    lines.push(`Осада длилась ${Math.round((this.t - START_T) / 60)} ч. В строю — ${alive} чел. Убито — ${this.stats.ourKilled}, ранено — ${this.stats.ourWounded}. В медпункте — ${this.med.light + this.med.severe}.`);
    lines.push(`Потери противника — около ${Math.round(this.stats.enemyKilled / 10) * 10} чел. убитыми.`);
    lines.push(`Отдано приказов — ${this.stats.ordersGiven}. Пропущено вызовов — ${this.stats.callsMissed}. Вмешательств в решения командиров — ${this.stats.interventions}.`);
    lines.push('');
    lines.push('КОМАНДИРЫ:');
    for (const o of Object.values(this.officers)) {
      const fate = o.removed ? 'отстранён' : !o.alive ? 'погиб' : 'жив';
      const t = o.trust > 70 ? 'безоговорочно доверяет вам' : o.trust > 50 ? 'доверяет вам' : o.trust > 30 ? 'насторожен' : 'не доверяет вам';
      const a = o.autonomy > 65 ? 'действовал самостоятельно' : o.autonomy > 35 ? 'действовал по обстановке' : 'перестал проявлять инициативу';
      lines.push(`— ${o.name}: ${fate}${o.alive ? `; ${t}; ${a}` : ''}.`);
    }
    lines.push('');
    lines.push('ЧТО БЫЛО НА САМОМ ДЕЛЕ:');
    for (const e of this.enemy.history) lines.push(`— ${fmtTime(e.t).full}: ${e.text}`);
    return lines.join('\n');
  }
}
