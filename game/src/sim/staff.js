// Штаб помощников: принимают доклады, решают делегированные вопросы, ищут капитана.
// Цепочка командования: капитан → штаб → командиры взводов → бойцы.
import { SECTORS, SECTOR_IDS, RES_LOCS, fmtTime } from './data.js';
import { cap } from './lines.js';

const chance = (p) => Math.random() < p;
const INFO_URGENT = ['lost', 'lineLost', 'officerKilled', 'contact', 'selfWithdraw'];

export const DELEG_INFO = {
  reports: { who: 'Орлов', title: 'Текущие доклады', opts: { me: 'Все доклады — мне лично', deputy: 'Принимает начальник штаба, мне — сводку' } },
  reserve: { who: 'Орлов', title: 'Просьбы о резерве', opts: { me: 'Решаю сам', deputy: 'Решает начальник штаба по докладу' } },
  withdraw: { who: 'Орлов', title: 'Отход на вторую линию', opts: { me: 'Только с моего разрешения', commanders: 'Командиры решают сами' } },
  initiative: { who: 'Орлов', title: 'Вылазки и контратаки по инициативе', opts: { me: 'Только с моего разрешения', allow: 'Разрешены', forbid: 'Запрещены' } },
  rotation: { who: 'Орлов', title: 'Смена взводов', opts: { off: 'Только по моему приказу', deputy: 'Начальник штаба организует сам' } },
  ammo: { who: 'Дьяков', title: 'Патроны на позиции', opts: { off: 'Выдавать по моему приказу', report: 'Докладывать, если кончаются', auto: 'Подвозить самому ниже нормы' } },
  engAuto: { who: 'Лучко', title: 'Ремонт укреплений', opts: { off: 'По моим заданиям', on: 'Чинить самым разбитым участкам' } },
  lines: { who: 'Мирон', title: 'Ремонт связи', opts: { order: 'По порядку', combat: 'Сначала участки, где бой' } },
};

export class Staff {
  constructor(sim) {
    this.sim = sim;
    this.deleg = { reports: 'deputy', reserve: 'me', withdraw: 'me', initiative: 'me', rotation: 'off', ammo: 'report', engAuto: 'off', lines: 'combat', watch: null };
    this.digest = [];
    this.lastBrief = sim.t;
    this.workload = 0;      // загруженность начальника штаба
    this._t = 0;
  }

  get home() { return this.sim.player.zone === 'hq'; }

  sectorOf(m) {
    const p = m.unit ? this.sim.P(m.unit) : null;
    return p ? (p.where.s || p.sector || null) : m.intelSector || null;
  }

  note(from, text, urgent = false) {
    this.digest.push({ t: this.sim.t, from, text, urgent });
    if (this.digest.length > 60) this.digest.shift();
  }

  /** Новое сообщение дошло до штаба: кто им займётся? */
  route(m) {
    const sim = this.sim, D = this.deleg;
    m.routed = true;
    const opts = m.options || [];
    const info = opts.length <= 1 && m.channel !== 'visit' && m.channel !== 'radio' && m.channel !== 'adj';
    const s = this.sectorOf(m);
    const watched = D.watch && s === D.watch;
    // перегруженный штаб иногда упускает доклады
    this.workload += 1;
    if (info && D.reports === 'deputy' && !(this.home && m.urgent)) {
      if (this.workload > 6 && !m.urgent && chance(0.15)) { m.route = 'lost'; m.done = true; sim.inbox = sim.inbox.filter((x) => x !== m); return; }
      sim.receive(m);
      opts[0]?.fn();
      sim.close(m);
      m.route = 'deputy';
      const urgent = INFO_URGENT.includes(m.kind);
      this.note(m.fromName, m.text, urgent);
      if (urgent || watched) this.notice(`${m.fromName}: ${shorten(m.text)}`, m.kind === 'lost' || m.kind === 'officerKilled' || (watched && urgent));
      return;
    }
    if (this.decide(m)) { m.route = 'deputy'; return; }
    m.route = 'player';
    if (!this.home && m.channel !== 'visit') {
      m.expireAt += 30;
      if (m.urgent || watched) m.runner = true;
    }
  }

  /** Делегированные решения. Помощник действует по своему разумению — и может ошибиться. */
  decide(m) {
    const sim = this.sim, D = this.deleg;
    const pickOpt = (i, who, what) => {
      sim.receive(m);
      const o = m.options[i];
      const r = o.fn();
      sim.close(m);
      this.note(who, `${m.fromName} — ${what}${r && r.text ? ` («${shorten(r.text)}»)` : ''}`);
      sim.addLog(who, `${m.fromName}: ${what}.`, 'deleg');
      return true;
    };
    if (m.kind === 'askAmmo' && D.ammo === 'auto') {
      const i = sim.depot.ammo >= 2 ? (chance(0.15) ? 1 : 0) : sim.depot.ammo >= 1 ? 1 : 2;
      return pickOpt(i, 'Дьяков', ['выслал два боекомплекта', 'выслал один боекомплект', 'патронов нет, велел экономить'][i]);
    }
    if (m.kind === 'askReserve' && D.reserve === 'deputy') {
      const res = m.options.length > 2;
      // Орлов верит докладу на слово — преувеличение командира его обманывает
      const scary = /роты|батальона|больше|срочно|сомнут/i.test(m.text);
      const busy = sim.t - (this.lastReserveSent || -999) < 40;
      if (res && scary && !busy) { this.lastReserveSent = sim.t; return pickOpt(0, 'Орлов', 'отправил резерв'); }
      return pickOpt(m.options.length - 2, 'Орлов', 'резерва не дал: «держитесь своими силами»');
    }
    if (m.kind === 'askWithdraw' && D.withdraw === 'commanders') return pickOpt(0, 'Орлов', 'отход на вторую линию разрешён');
    if ((m.kind === 'raidAsk' || m.kind === 'selfCounter') && D.initiative !== 'me') {
      return pickOpt(D.initiative === 'allow' ? 0 : 1, 'Орлов', D.initiative === 'allow' ? 'инициатива разрешена' : 'инициатива запрещена');
    }
    if (m.kind === 'askRelief' && D.rotation === 'deputy') {
      const res = m.options.length > 2;
      const quiet = !SECTOR_IDS.some((s) => sim.sectors[s].op);
      if (res && quiet) return pickOpt(0, 'Орлов', 'организовал смену');
      return pickOpt(m.options.length - 2, 'Орлов', 'пообещал смену через четыре часа');
    }
    return false;
  }

  /** Сообщение капитану от начальника штаба. */
  notice(text, urgent) {
    const sim = this.sim;
    sim.addLog('Орлов', text, urgent ? 'urgent' : 'deputy');
    if (this.home) { sim.say(text, 'Орлов', 6); return; }
    if (urgent) {
      sim.send({ fromName: 'Гусев', from: { short: 'Гусев', name: 'Ординарец Гусев (посыльный)' }, channel: 'runner', kind: 'notice', urgent: true, expire: 90,
        text: `Капитан! Начальник штаба передаёт: ${text}`, options: [{ label: 'Понял. Иду в штаб.', fn: () => ({}) }, { label: 'Понял. Пусть Орлов действует по обстановке.', fn: () => { this.deleg.reserve = 'deputy'; this.deleg.withdraw = 'commanders'; return { text: 'Есть! Передам.' }; } }] });
      const m = sim.inbox[sim.inbox.length - 1];
      if (m && m.kind === 'notice') { m.routed = true; m.route = 'player'; m.runner = true; }
    }
  }

  /** Плановая работа помощников. */
  tick() {
    const sim = this.sim, D = this.deleg;
    this.workload = Math.max(0, this.workload - 0.08);
    if (sim.t % 30 !== 0) return;
    // ротация
    if (D.rotation === 'deputy' && !SECTOR_IDS.some((s) => sim.sectors[s].op)) {
      const res = sim.reservePlatoons().filter((p) => p.men > 18 && p.fatigue < 40);
      const tired = Object.values(sim.platoons).filter((p) => p.where.type === 'sector' && !p.small && p.fatigue > 66).sort((a, b) => b.fatigue - a.fatigue)[0];
      if (res[0] && tired) {
        sim.orderMove(res[0], { task: 'relieve', sector: tired.where.s, backLoc: res[0].where.loc });
        this.note('Орлов', `Организовал смену: ${res[0].name} сменяет ${tired.name.replace('взвод', 'взвод')} на ${SECTORS[tired.where.s].gen} участке.`);
        sim.addLog('Орлов', `Смена: ${res[0].call} → ${SECTORS[tired.where.s].name.toLowerCase()}.`, 'deleg');
      }
    }
    // патроны
    for (const p of Object.values(sim.platoons)) {
      if (p.where.type !== 'sector' || p.men <= 0) continue;
      const pending = (sim.deliveries || []).some((d) => d.p === p.id);
      if (p.ammo > 1.3 || pending) continue;
      if (D.ammo === 'auto' && sim.depot.ammo >= 1) {
        if (chance(0.12)) continue; // не успел — завтра заметит
        sim.sendAmmo(p, sim.depot.ammo >= 2 ? 2 : 1);
        this.note('Дьяков', `Сам выслал патроны: ${p.name}.`);
        sim.addLog('Дьяков', `Подвоз патронов: ${p.name}.`, 'deleg');
      } else if (D.ammo === 'report' && !sim.recentFlag('ammoRep_' + p.id, 120)) {
        sim.staffMsg('dyakov', `Капитан, у ${p.name.replace('взвод', 'взвода')} патроны на исходе. На складе — ${sim.depot.ammo.toFixed(1).replace('.', ',')} бк. Выслать?`, [
          { label: 'Выслать два боекомплекта.', disabled: () => sim.depot.ammo < 2, fn: () => { sim.sendAmmo(p, 2); return { text: 'Есть. Подносчики пошли.' }; } },
          { label: 'Выслать один.', disabled: () => sim.depot.ammo < 1, fn: () => { sim.sendAmmo(p, 1); return { text: 'Есть.' }; } },
          { label: 'Не надо.', fn: () => ({ text: 'Понял.' }) },
        ]);
      }
    }
    // инженеры
    if (D.engAuto === 'on' && !sim.eng.task && !sim.flags.engInf) {
      const t = sim.engTasks().filter((x) => x.type === 'fort').sort((a, b) => sim.sectors[a.sector].fort - sim.sectors[b.sector].fort)[0];
      if (t && sim.sectors[t.sector].fort < 60 && sim.depot.mat >= t.mat) { sim.engAssign(t); this.note('Лучко', `Сама взялась: ${t.label.toLowerCase()}.`); }
    }
  }

  /** Капитан вернулся в штаб — начальник штаба сразу вводит в курс. */
  onEnterHQ() {
    const sim = this.sim;
    const pend = sim.inbox.filter((m) => m.route === 'player' && !m.done && sim.t >= m.arrive);
    const fresh = this.digest.filter((d) => d.t > this.lastBrief);
    if (pend.length >= 2) {
      const list = pend.slice(0, 3).map((m) => `${m.fromName} — ${KIND[m.kind] || 'ждёт решения'}`).join('; ');
      sim.say(`Капитан, у нас сразу ${pend.length} ${pend.length < 5 ? 'вопроса' : 'вопросов'}: ${list}.`, 'Орлов', 9);
    } else if (fresh.length) sim.say(`Капитан, пока вас не было — ${fresh.length} докладов. Сводка у меня.`, 'Орлов', 5);
  }

  pendingDecisions() {
    const sim = this.sim;
    return sim.inbox.filter((m) => m.route === 'player' && !m.done && sim.t >= m.arrive && m.channel !== 'runner');
  }
}

const KIND = {
  askReserve: 'просит резерв', askAmmo: 'просит патроны', askRelief: 'просит смену', askWithdraw: 'просит разрешения на отход',
  raidAsk: 'просит разрешить вылазку', selfCounter: 'идёт в контратаку', breakdown: 'на грани срыва', staff: 'вопрос по службе',
  army: 'радиограмма «Берега»', letter: 'почта', deserter: 'дезертир', speaker: 'громкоговоритель', visit_complain: 'пришёл с претензией',
  visit_summoned: 'прибыл по вызову', visit_relieved: 'пришёл сам не свой', officerKilled: 'гибель командира',
};

export function shorten(t, n = 110) {
  t = String(t).replace(/\s+/g, ' ');
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}
