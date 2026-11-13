// Цепь командования: капитан → командир обороны (Орлов) → командиры участков → отделения → бойцы.
// Капитан ставит ЗАДАЧУ участку. Орлов передаёт её по связи, сам улаживает сбои связи
// и повторяет приказ; командир участка исполняет её по своему характеру.
// К капитану поднимается только то, что требует его решения (отказ, спор, просьба).
import { SECTORS, SECTOR_IDS, RES_LOCS, fmtTime } from './data.js';
import { pick, strengthWords } from './lines.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const chance = (p) => Math.random() < p;

/** Задачи участку — то, что капитан решает сам. Остальное делают командиры. */
export const TASKS = {
  hold: { label: 'Держать участок', short: 'держит' },
  observe: { label: 'Наблюдать сектор', short: 'наблюдает' },
  prepare: { label: 'Готовиться к отражению атаки', short: 'готов к бою' },
  withdraw: { label: 'Отойти на запасную позицию', short: 'на запасной позиции' },
  fortify: { label: 'Подготовить оборону (сапёры)', short: 'укрепляет' },
  reinforce: { label: 'Усилить резервом', short: 'усилен' },
  relieve: { label: 'Сменить подразделение', short: 'смена' },
  supply: { label: 'Отправить снабжение', short: 'снабжение' },
  retake: { label: 'Вернуть участок контратакой', short: 'контратака' },
};

export class Chain {
  constructor(sim) {
    this.sim = sim;
    this.queue = [];            // приказы в пути: { s, task, eta, tries, via }
    this.task = { N: 'hold', E: 'hold', S: 'hold', W: 'hold' };
    this.since = { N: sim.t, E: sim.t, S: sim.t, W: sim.t };
    this.events = [];           // для мира: передача приказов, тревога, совещание
    this.meeting = null;        // { until, who: [officerId] }
    this.nextMeeting = this.alignedNext(8 * 60);
    this.hqHold = false;
    this.helpUsed = {};         // запросы помощи у армии по суткам
  }

  alignedNext(min) { const t = this.sim.t; const day = Math.floor(t / 1440); let n = day * 1440 + min; if (n <= t) n += 720; return n; }

  /** Как быстро Орлов дотянется до участка. */
  relayDelay(s) {
    const sim = this.sim, sec = sim.sectors[s];
    if (sim.player.zone === 'dug:' + SECTOR_POS_DUG[s] || sim.player.zone === s) return { d: 0.5, via: 'лично' };
    if (sec.line === 'cut' || sec.held === 'lost') return { d: rnd(14, 26), via: 'связным' };
    return { d: rnd(2, 4), via: 'по телефону' };
  }

  /** Капитан ставит задачу участку. Возвращает реплику Орлова. */
  order(s, task) {
    const sim = this.sim;
    const sec = sim.sectors[s];
    const holder = sim.holderOf(s);
    if (task === 'reinforce') return this.sendReserve(s);
    if (task === 'relieve') return this.relieve(s);
    if (task === 'supply') return this.supply(s);
    if (task === 'fortify') return this.fortify(s);
    if (task === 'retake') return this.retake(s);
    if (!holder) return { ok: false, text: `Орлов: «На ${SECTORS[s].gen} участке некому передавать — участок потерян.»` };
    if (task === 'withdraw' && sec.held !== 'line1') return { ok: false, text: 'Орлов: «Они и так на запасной позиции.»' };
    const { d, via } = this.relayDelay(s);
    this.queue = this.queue.filter((q) => q.s !== s);
    this.queue.push({ s, task, eta: sim.t + d, tries: 0, via });
    if (via === 'связным') this.events.push({ type: 'runner', s, t: sim.t });
    sim.stats.ordersGiven++;
    const o = sim.officerOf(holder);
    return { ok: true, text: `Орлов: «Есть. ${via === 'лично' ? 'Командир рядом с вами — приказ получен лично' : via === 'связным' ? `Телефон на ${SECTORS[s].name.toLowerCase()} участок молчит — посылаю связного` : `Звоню на ${SECTORS[s].name.toLowerCase()} участок`}: «${TASKS[task].label}».»` };
  }

  pending(s) { return this.queue.find((q) => q.s === s); }

  tick() {
    const sim = this.sim;
    for (const q of [...this.queue]) {
      if (sim.t < q.eta) continue;
      this.queue.splice(this.queue.indexOf(q), 1);
      this.deliver(q);
    }
    // задача «к бою» не держится вечно: командиры сами снимают напряжение
    for (const s of SECTOR_IDS) {
      const sec = sim.sectors[s];
      sec.posture = this.task[s];
      if (this.task[s] === 'prepare' && sim.t - this.since[s] > 360 && !sec.op) {
        this.task[s] = 'hold'; this.since[s] = sim.t;
        const h = sim.holderOf(s), o = h && sim.officerOf(h);
        if (o) sim.staff.note(o.short, 'Люди измотаны ожиданием. Перевёл участок на обычное несение службы.');
      }
      if (sec.held === 'lost' && this.task[s] !== 'hold') { this.task[s] = 'hold'; }
      if (this.task[s] === 'withdraw' && sec.held === 'line1' && !this.pending(s)) this.task[s] = 'hold';
    }
    // совещания командиров: утром и вечером, если тихо
    if (sim.t >= this.nextMeeting) {
      this.nextMeeting = sim.t + 720;
      if (!SECTOR_IDS.some((s) => sim.sectors[s].op)) this.callMeeting(false);
    }
    if (this.meeting && sim.t >= this.meeting.until) this.endMeeting();
  }

  deliver(q) {
    const sim = this.sim, s = q.s, sec = sim.sectors[s];
    const p = sim.holderOf(s);
    if (!p) return;
    const o = sim.officerOf(p);
    // связь под огнём рвётся: Орлов повторяет сам, капитана не дёргает
    if (q.via === 'по телефону' && (sec.op || sec.shelledUntil > sim.t) && chance(0.2) && q.tries < 3) {
      q.tries++; q.eta = sim.t + rnd(2, 5); this.queue.push(q);
      sim.staff.note('Орлов', `${o.short} не разобрал приказ — повторяю.`);
      return;
    }
    const ord = { hold: { task: 'hold' }, observe: { task: 'hold' }, prepare: { task: 'hold', priority: 'hold' }, withdraw: { task: 'withdraw' } }[q.task];
    const r = sim.issueOrder(p, ord, 'chain');
    if (r.options) {
      // командир возражает — решать капитану
      sim.send({ from: o, unit: p.id, kind: 'objection', urgent: true, expire: 30, toPlayer: true,
        text: `${o.short} возражает против приказа «${TASKS[q.task].label.toLowerCase()}»: ${r.text}`,
        options: r.options.map((x) => ({ ...x, fn: () => { const rr = x.fn(); if (/приказ/.test(x.label)) this.setTask(s, q.task, o); return rr; } })) });
      return;
    }
    this.setTask(s, q.task, o, r.text, q.via);
  }

  setTask(s, task, o, reply, via) {
    const sim = this.sim;
    this.task[s] = task; this.since[s] = sim.t;
    sim.sectors[s].posture = task;
    if (o) {
      sim.staff.note(o.short, `Принял: ${TASKS[task].label.toLowerCase()}.${reply ? ' ' + reply : ''}`);
      this.events.push({ type: 'order', s, oid: o.id, task, t: sim.t, via });
    }
  }

  // ---------- резерв ----------
  bestReserve(s) {
    const sim = this.sim;
    const res = sim.reservePlatoons().filter((p) => p.men > 6);
    if (!res.length) return null;
    return res.sort((a, b) => (RES_LOCS[a.where.loc].t[s] + a.fatigue * 0.2) - (RES_LOCS[b.where.loc].t[s] + b.fatigue * 0.2))[0];
  }

  sendReserve(s) {
    const sim = this.sim, sec = sim.sectors[s];
    const r = this.bestReserve(s);
    if (!r) return { ok: false, text: 'Орлов: «Резерва нет, капитан. Все в деле.»' };
    if (sec.held === 'lost') return this.retake(s);
    sim.orderMove(r, { task: 'reinforce', sector: s, freedom: 'free' });
    const o = sim.officerOf(r);
    this.events.push({ type: 'reserve', s, pid: r.id, t: sim.t });
    return { ok: true, text: `Орлов: «${r.name} (${o?.short}) выходит на ${SECTORS[s].gen} участок. Будут к ${fmtTime(r.where.eta).hm}.»` };
  }

  relieve(s) {
    const sim = this.sim;
    const h = sim.holderOf(s);
    if (!h) return { ok: false, text: 'Орлов: «Менять некого — участок потерян.»' };
    const r = this.bestReserve(s);
    if (!r) return { ok: false, text: 'Орлов: «Сменить нечем — резерв занят.»' };
    if (r.fatigue > h.fatigue - 10) return { ok: false, text: `Орлов: «${r.name} устал не меньше. Смысла нет, капитан.»` };
    sim.orderMove(r, { task: 'relieve', sector: s, backLoc: r.where.loc });
    return { ok: true, text: `Орлов: «Организую смену: ${r.name} сменит ${h.name.replace('взвод', 'взвод')}. Прибудут к ${fmtTime(r.where.eta).hm}.»` };
  }

  retake(s) {
    const sim = this.sim;
    if (sim.sectors[s].held !== 'lost') {
      const h = sim.holderOf(s);
      if (!h || sim.sectors[s].held !== 'line2') return { ok: false, text: 'Орлов: «Участок в наших руках, контратака не нужна.»' };
      const r = sim.issueOrder(h, { task: 'counter' }, 'chain');
      if (r.options) { this.objection(h, 'retake', r); return { ok: true, text: `Орлов: «${sim.officerOf(h).short} возражает. Его доводы — у вас на столе.»` }; }
      return { ok: true, text: `Орлов: «${sim.officerOf(h).short} готовит контратаку на первую линию.»` };
    }
    const res = this.bestReserve(s);
    if (!res) return { ok: false, text: 'Орлов: «Контратаковать некем.»' };
    const r = sim.issueOrder(res, { task: 'counterSector', sector: s }, 'chain');
    if (r.options) { this.objection(res, 'retake', r); return { ok: true, text: `Орлов: «${sim.officerOf(res).short} против. Решайте.»` }; }
    return { ok: true, text: `Орлов: «${res.name} пойдёт возвращать ${SECTORS[s].gen} участок.»` };
  }

  objection(p, task, r) {
    const sim = this.sim, o = sim.officerOf(p);
    sim.send({ from: o, unit: p.id, kind: 'objection', urgent: true, expire: 30, toPlayer: true, text: `${o.short} возражает: ${r.text}`, options: r.options });
  }

  supply(s) {
    const sim = this.sim, h = sim.holderOf(s);
    if (!h) return { ok: false, text: 'Орлов: «Снабжать некого.»' };
    if (sim.depot.ammo < 1) return { ok: false, text: 'Дьяков: «Нечего везти, капитан. Склад пуст.»' };
    const n = sim.depot.ammo >= 2 && h.ammo < 2.5 ? 2 : 1;
    sim.sendAmmo(h, n);
    if (sim.depot.food > 0.4) h.morale = Math.min(100, h.morale + 1.5);
    return { ok: true, text: `Дьяков: «Отправил на ${SECTORS[s].gen} участок ${n === 2 ? 'два боекомплекта' : 'боекомплект'} и сухой паёк. Подносчики будут минут через тридцать.»` };
  }

  fortify(s) {
    const sim = this.sim, sec = sim.sectors[s];
    if (sec.held === 'lost') return { ok: false, text: 'Лучко: «Туда не пройти, капитан.»' };
    const tasks = sim.engTasks().filter((t) => t.sector === s);
    const t = sec.fort > 70 && tasks.find((x) => x.type === 'mines') || tasks.find((x) => x.type === 'fort');
    if (!t) return { ok: false, text: 'Лучко: «Там всё, что можно, уже сделано.»' };
    const r = sim.engAssign(t);
    return { ok: true, text: `Лучко: «${r.text}»` };
  }

  /** Удерживать штаб: резерв стягивается к КП, комендантское отделение — к бою. */
  holdHQ() {
    const sim = this.sim;
    this.hqHold = !this.hqHold;
    if (!this.hqHold) return { ok: true, text: 'Орлов: «Понял. Резерв возвращаю в центр обороны.»', after: () => { for (const p of sim.reservePlatoons()) if (p.where.loc === 'hq') sim.applyOrder(p, { task: 'moveRes', loc: 'center' }); } };
    for (const p of sim.reservePlatoons()) if (p.where.loc !== 'hq') sim.applyOrder(p, { task: 'moveRes', loc: 'hq' });
    sim.hq.komendant = Math.max(sim.hq.komendant, 8);
    return { ok: true, text: 'Орлов: «Есть. Резерв занимает оборону у штаба. Комендантское отделение — к бою.»' };
  }

  /** Перераспределить: командир обороны сам решает, где держать резерв. */
  redistribute() {
    const sim = this.sim;
    const res = sim.reservePlatoons();
    if (!res.length) return { ok: false, text: 'Орлов: «Распределять нечего — резерв в деле.»' };
    // угроза по участкам — по тому, что известно штабу
    const threat = (s) => {
      const k = sim.knowledge[s], sec = sim.sectors[s];
      let v = 0;
      if (sec.op) v += 5;
      if (/накаплив|разведка|лично/.test(k.enemy || '') && !/тихо/.test(k.enemy || '')) v += 3;
      if (k.held === 'line2') v += 2;
      const h = sim.holderOf(s); if (h) v += (1 - h.men / h.maxMen) * 2 + (h.fatigue > 65 ? 1 : 0);
      return v;
    };
    const order = ['N', 'E', 'S'].map((s) => [s, threat(s)]).sort((a, b) => b[1] - a[1]);
    const [s, v] = order[0];
    const lost = SECTOR_IDS.some((x) => sim.sectors[x].held === 'lost');
    // осмотрительно: к участку — только при явной угрозе; иначе резерв прикрывает центр и штаб
    const loc = sim.hq.pushOp || this.hqHold || lost ? 'hq' : v >= 5 ? 'near' + s : 'center';
    const p = res[0];
    if (p.where.loc === loc) return { ok: true, text: `Орлов: «Резерв уже там, где нужен: ${RES_LOCS[loc].name}.»` };
    sim.applyOrder(p, { task: 'moveRes', loc });
    return { ok: true, text: `Орлов: «${lost ? 'Есть прорыв — резерв держу у штаба.' : v >= 5 ? `Больше всего беспокоит ${SECTORS[s].name.toLowerCase()} участок.` : 'Явной угрозы нет — держу резерв в центре.'} Переставляю ${p.name.replace('взвод', 'взвод')} — ${RES_LOCS[loc].name}.»` };
  }

  /** Запросить помощь у армии: сброс снабжения или артналёт. Раз в сутки каждое. */
  requestHelp(kind, s) {
    const sim = this.sim, day = Math.floor(sim.t / 1440);
    const key = kind + day;
    if (this.helpUsed[key]) return { ok: false, text: '«Берег»: «Цитадель», сегодня больше не можем. Держитесь.»' };
    this.helpUsed[key] = true;
    sim.hq.pelengRisk += 0.4;
    if (kind === 'airdrop') {
      const h = (sim.t % 1440) / 60;
      const when = Math.floor(sim.t / 1440) * 1440 + (h < 1 ? 0 : 1440) + rnd(90, 180);
      sim.airdrop = { t: when, done: false };
      return { ok: true, text: `«Берег»: «Сброс будет ночью, около ${fmtTime(when).hm}. Обозначьте площадку.»` };
    }
    // артналёт армейской артиллерии по скоплению противника
    const plan = sim.enemy.plan.find((x) => x.prepped && !x.started && (!s || x.target === s));
    const target = plan ? plan.target : s || pick(['N', 'E', 'S']);
    sim.enemy.pool = Math.max(0, sim.enemy.pool - 35);
    if (plan) { plan.str *= 0.75; sim.enemy.log(`Армейская артиллерия накрыла скопление перед ${SECTORS[target].ins} сектором.`); }
    sim.enemy.disrupt(target);
    sim.stats.enemyKilled += plan ? 12 : 5;
    for (let i = 0; i < 6; i++) sim.fx.push({ type: 'friendlyArty', sector: target, delay: 2 + i * 0.7 });
    return { ok: true, text: `«Берег»: «Даём огонь по ${SECTORS[target].gen} направлению. Пять минут.»${plan ? '' : ' Скоплений там не видно — бьют наугад.'}` };
  }

  // ---------- совещание командиров ----------
  callMeeting(byPlayer) {
    const sim = this.sim;
    if (this.meeting) return { ok: false, text: 'Орлов: «Командиры уже собраны.»' };
    const who = Object.values(sim.officers).filter((o) => {
      if (!o.alive || o.inHQ) return false;
      const p = sim.platoonOf(o);
      return p && p.men > 0 && p.where.type !== 'move' && !(p.where.s && sim.sectors[p.where.s].op);
    });
    if (!who.length) return { ok: false, text: 'Орлов: «Собрать некого — все в бою.»' };
    for (const o of who) o.atMeeting = true;
    this.meeting = { until: sim.t + 40, who: who.map((o) => o.id), byPlayer };
    this.events.push({ type: 'meeting', t: sim.t });
    sim.staff.note('Орлов', `Командиры собираются в командирском блиндаже (${who.map((o) => o.short).join(', ')}).`);
    return { ok: true, text: `Орлов: «Собираю командиров в командирском блиндаже. Минут через десять все будут.»` };
  }

  endMeeting() {
    const sim = this.sim, m = this.meeting;
    this.meeting = null;
    const lines = [];
    for (const id of m.who) {
      const o = sim.officers[id];
      if (!o) continue;
      o.atMeeting = false;
      if (!o.alive) continue;
      const p = sim.platoonOf(o);
      if (!p) continue;
      o.coordUntil = sim.t + 360;           // соседи договорились — помогают друг другу охотнее
      sim.trust(o, 2);
      sim.snapshot(p, 'совещание');
      if (p.where.s) sim.observe(p.where.s);
      lines.push(`${o.short}: ${sim.platoonTruth(p, o)}`);
    }
    sim.staff.note('Орлов', `Итоги совещания. ${lines.join(' ')}`);
    this.lastMeeting = { t: sim.t, lines };
  }

  /** Короткая сводка угроз для экрана командования. */
  threats() {
    const sim = this.sim, out = [];
    if (sim.hq.pushOp) out.push({ w: 9, t: sim.hq.pushOp.phase === 'active' ? 'Бой у штаба!' : `Противник готовит удар по штабу из ${SECTORS[sim.hq.pushOp.from].gen} сектора` });
    for (const s of SECTOR_IDS) {
      const k = sim.knowledge[s], sec = sim.sectors[s];
      if (k.held === 'lost') out.push({ w: 8, t: `${SECTORS[s].name} участок потерян` });
      else if (k.combat) out.push({ w: 7, t: `${SECTORS[s].name}: бой${k.enemy && !/тихо/.test(k.enemy) ? ' — ' + k.enemy : ''}` });
      else if (k.enemy && /накаплив|разведк/.test(k.enemy)) out.push({ w: 5, t: `${SECTORS[s].name}: противник накапливается (${k.enemy.replace(/ \(.*\)/, '')})` });
      if (k.held === 'line2' && !k.combat) out.push({ w: 4, t: `${SECTORS[s].name}: держим только запасную позицию` });
      if (k.line === 'cut' && sec.held !== 'lost') out.push({ w: 2, t: `${SECTORS[s].name}: нет телефонной связи` });
      const h = sim.holderOf(s);
      if (h && h.known && h.known.ammo < 1.3) out.push({ w: 4, t: `${SECTORS[s].name}: заканчиваются боеприпасы` });
      if (h && h.known && h.known.fatigue > 70) out.push({ w: 2, t: `${SECTORS[s].name}: люди вымотаны` });
    }
    if (sim.depot.ammo < 3) out.push({ w: 3, t: 'Склад: патронов почти нет' });
    if (sim.med.light + sim.med.severe > 24) out.push({ w: 2, t: 'Медпункт переполнен' });
    return out.sort((a, b) => b.w - a.w);
  }
}

const SECTOR_POS_DUG = { N: 'dugN', E: 'dugE', S: 'dugS', W: 'dugW' };
