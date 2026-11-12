// Режиссёр событий: сюжет кампании, личные истории и моральные дилеммы.
import { SECTORS, SECTOR_IDS, fmtTime, START_T } from './data.js';
import { pick, strengthWords, n1 } from './lines.js';

const D = (day, h, m = 0) => (day - 1) * 1440 + h * 60 + m;
const chance = (p) => Math.random() < p;
const rnd = (a, b) => a + Math.random() * (b - a);

export class Director {
  constructor(sim) {
    this.sim = sim;
    this.done = new Set();
    this.events = [
      { id: 'brief', t: START_T + 1, fn: () => this.briefing() },
      { id: 'ledger1', t: START_T + 25, fn: () => this.ledger() },
      { id: 'army1', t: D(1, 18, 30), fn: () => this.armyFirst() },
      { id: 'ledger2', t: D(2, 8, 0), fn: () => this.ledger() },
      { id: 'letter', t: D(2, 11, 20), fn: () => this.letter() },
      { id: 'deserter', t: D(2, 15, 10), fn: () => this.deserter() },
      { id: 'delay', t: D(2, 20, 10), fn: () => this.delay() },
      { id: 'ledger3', t: D(3, 7, 0), fn: () => this.ledger() },
      { id: 'speaker', t: D(3, 8, 20), fn: () => this.loudspeaker() },
      { id: 'cannon', t: D(3, 12, 0), fn: () => this.cannonade() },
      { id: 'lieTruth', t: D(3, 16, 5), fn: () => this.lieReveal() },
    ];
  }

  tick() {
    const t = this.sim.t;
    for (const e of this.events) if (!this.done.has(e.id) && t >= e.t) { this.done.add(e.id); e.fn(); }
    if (this.sim.hq.pelengRisk > 0) this.sim.hq.pelengRisk = Math.max(0, this.sim.hq.pelengRisk - 0.002);
  }

  briefing() {
    const sim = this.sim;
    sim.notes.push({ t: sim.t, title: 'Приказ командира полка', secret: true, text:
      'Командиру гарнизона «Цитадель».\n\nКольцо окружения замкнуто в 06:40. Гарнизону — удерживать высоту и узел дорог до подхода деблокирующей группы.\nСрок — до 16:00 послезавтра.\nОтход без приказа запрещаю.\n\nСигналы: зелёная ракета — «иду на помощь», красная — «прорыв», две белых — «нужны боеприпасы».\nПозывной штаба армии — «Берег». Ваш — «Цитадель». Работать на рации кратко — пеленгуют.' });
    sim.adj('Капитан, приказ из полка — в сейфе. Карта на столе, телефон — там же. Командиры на местах: Коваль — север, Ярцев — восток, Сомов — юг, Кравец с разведчиками на болоте. Байрамов в резерве, в центре.');
  }

  ledger() {
    const sim = this.sim;
    sim.ledger = { t: sim.t, ...sim.depot };
    const d = sim.depot;
    sim.staffMsg('dyakov', `Капитан, Дьяков. Ведомость на ${sim.time.hm}: патронов — ${n1(d.ammo)} бк, медикаментов — ${Math.round(d.meds)} уп., продуктов — на ${(d.food * 24).toFixed(0)} ч, воды — на ${(d.water * 24).toFixed(0)} ч, материалов — ${Math.round(d.mat)}. Ведомость у вас на столе.`, [
      { label: 'Понял. Урезать паёк вдвое.', fn: () => { d.ration = 0.5; for (const p of Object.values(sim.platoons)) p.morale -= 3; return { text: 'Есть. Люди не обрадуются.' }; } },
      { label: 'Понял. Паёк — полный.', fn: () => { d.ration = 1; return { text: 'Есть.' }; } },
    ]);
  }

  armyFirst() {
    this.sim.send({ fromName: 'Берег', from: { short: 'Берег', name: 'Штаб армии «Берег»' }, channel: 'radio', kind: 'army', expire: 60,
      text: '«Цитадель», я «Берег». Деблокирующая группа сосредотачивается. Срок прежний — шестнадцать ноль-ноль послезавтра. Ночью возможен сброс — запрашивайте. Держитесь. Конец связи.',
      options: [{ label: '«Берег», я «Цитадель». Понял вас.', fn: () => ({}) }] });
  }

  letter() {
    const sim = this.sim;
    const o = Object.values(sim.officers).find((x) => x.alive && x.id === 'somov') || Object.values(sim.officers).find((x) => x.alive);
    sim.adj(`Капитан, со сбросом пришла почта. Есть письмо ${o.short}. Передать сейчас или после боя?`);
    sim.send({ fromName: 'Гусев', from: { short: 'Гусев', name: 'Ординарец Гусев' }, channel: 'adj', kind: 'letter', expire: 90,
      text: `Письмо для ${o.short}. Конверт с чёрной каймой — похоже, из дома недобрые вести.`,
      options: [
        { label: 'Передать сейчас.', fn: () => { o.stress += 25; sim.trust(o, 3); return { text: 'Отнёс. Говорят, он долго сидел один в блиндаже.' }; } },
        { label: 'Придержать до конца осады.', fn: () => { sim.flags.heldLetter = o.id; return { text: 'Положил в сейф. Под приказ.' }; } },
      ] });
  }

  deserter() {
    const sim = this.sim;
    const ps = Object.values(sim.platoons).filter((p) => p.men > 5 && !p.small).sort((a, b) => a.morale - b.morale);
    const p = ps[0]; if (!p) return;
    const o = sim.officerOf(p);
    sim.send({ fromName: 'Гусев', from: { short: 'Гусев', name: 'Ординарец Гусев' }, channel: 'adj', kind: 'deserter', expire: 90,
      text: `Капитан, из ${p.name.replace('взвод', 'взвода')} задержали бойца — шёл к болоту, без оружия. Восемнадцать лет. ${o?.short} просит решить вам.`,
      options: [
        { label: 'Под трибунал. Перед строем.', fn: () => { for (const x of Object.values(sim.platoons)) x.morale -= 4; p.morale -= 6; if (o) sim.trust(o, o.arch === 'executor' ? 3 : -5, 'расстрел перед строем'); sim.captain.authority += 4; return { text: 'Есть. — Гусев отводит глаза.' }; } },
        { label: 'Вернуть во взвод. Командир за него отвечает.', fn: () => { if (o) sim.trust(o, 4, 'капитан пощадил нашего мальчишку'); p.morale += 3; p.men += 1; return { text: 'Есть. Говорят, парень плакал.' }; } },
        { label: 'В комендантское отделение, под присмотр.', fn: () => { sim.hq.komendant += 1; return { text: 'Есть. Будет таскать ящики при штабе.' }; } },
      ] });
  }

  delay() {
    const sim = this.sim;
    sim.reliefT += 240;
    sim.send({ fromName: 'Берег', from: { short: 'Берег', name: 'Штаб армии «Берег»' }, channel: 'radio', kind: 'army', expire: 90,
      text: '«Цитадель», я «Берег». Деблокирующая группа встретила сильное сопротивление. Новый срок — двадцать ноль-ноль послезавтра. Повторяю: двадцать ноль-ноль. Держитесь.',
      options: [
        { label: 'Сообщить гарнизону правду.', fn: () => { for (const p of Object.values(sim.platoons)) p.morale -= 6; for (const o of Object.values(sim.officers)) if (o.alive) sim.trust(o, 3); return { text: 'Мирон передаёт по линиям. В трубке — тишина. Потом кто-то матерится.' }; } },
        { label: 'Пока не говорить. Срок прежний.', fn: () => { sim.flags.lied = true; return { text: 'Мирон молча кивает. Новый срок знаете только вы и она.' }; } },
        { label: 'Сказать, что помощь уже близко.', fn: () => { sim.flags.lied = true; for (const p of Object.values(sim.platoons)) p.morale += 5; return { text: 'В трубке слышно, как на позиции кричат «ура».' }; } },
      ] });
  }

  lieReveal() {
    const sim = this.sim;
    if (!sim.flags.lied) return;
    for (const p of Object.values(sim.platoons)) p.morale -= 10;
    for (const o of Object.values(sim.officers)) if (o.alive) sim.trust(o, -8, 'капитан скрыл перенос срока');
    sim.adj('Капитан… шестнадцать ноль-ноль. Помощи нет. На позициях спрашивают, что случилось. Им… им кто-то сказал про новый срок.');
  }

  loudspeaker() {
    const sim = this.sim;
    sim.adj('Слышите? Громкоговоритель. Предлагают сдаться — обещают хлеб и жизнь.');
    sim.send({ fromName: 'Гусев', from: { short: 'Гусев', name: 'Ординарец Гусев' }, channel: 'adj', kind: 'speaker', expire: 40,
      text: 'Громкоговоритель с той стороны работает уже десять минут. В блиндажах слушают.',
      options: [
        { label: 'Миномётам — накрыть громкоговоритель.', fn: () => { sim.depot.ammo = Math.max(0, sim.depot.ammo - 0.3); for (const p of Object.values(sim.platoons)) p.morale += 4; return { text: 'Три разрыва — и тишина. На позициях смеются.' }; } },
        { label: 'Приказать командирам: не слушать, заткнуть уши.', fn: () => { for (const p of Object.values(sim.platoons)) if (p.morale < 30) { p.men -= 1; } return { text: 'Приказ передан. Кто-то, говорят, всё-таки ушёл.' }; } },
      ] });
  }

  cannonade() {
    const sim = this.sim;
    for (const p of Object.values(sim.platoons)) p.morale += 6;
    sim.adj('Капитан! Слышите — на востоке? Это наши. Канонада. Далеко ещё, но это наши!');
  }
}

/** Рация: связь со штабом армии и эфиром. */
export function radioMenu(sim) {
  const o = [];
  const h = (sim.t % 1440) / 60;
  o.push({ label: 'Доложить обстановку «Берегу».', fn: () => {
    sim.hq.pelengRisk += 0.35;
    const lost = SECTOR_IDS.filter((s) => sim.sectors[s].held === 'lost').length;
    return { text: `«Берег»: «Цитадель», вас понял. ${lost ? 'Держитесь, сколько сможете. Помощь идёт.' : 'Молодцы. Держитесь.'} Конец связи.` };
  } });
  if (!sim.airdrop || sim.airdrop.done) {
    o.push({ label: 'Запросить сброс снабжения на ночь.', fn: () => {
      sim.hq.pelengRisk += 0.35;
      const day = Math.floor(sim.t / 1440);
      let when = day * 1440 + 24 * 60 + rnd(90, 180);
      if (h < 1) when = day * 1440 + rnd(90, 180);
      sim.airdrop = { t: when, done: false };
      return { text: `«Берег»: Сброс будет ночью, около ${fmtTime(when).hm}. Обозначьте площадку тремя кострами. Конец связи.` };
    } });
  }
  o.push({ label: 'Запросить сведения о деблокаде.', fn: () => {
    sim.hq.pelengRisk += 0.25;
    return { text: `«Берег»: Срок — ${fmtTime(sim.reliefT).full}. Пока без изменений. Конец связи.` };
  } });
  o.push({ label: 'Слушать эфир противника.', fn: () => {
    sim.hq.pelengRisk += 0.15;
    const next = sim.enemy.nextMajor();
    if (!next || chance(0.4)) return { text: 'Треск, обрывки чужой речи, цифры. Ничего не разобрать.' };
    const trueDir = next.target && SECTORS[next.target] ? next.target : null;
    const dir = trueDir && chance(0.7) ? trueDir : pick(SECTOR_IDS);
    sim.addLog('Эфир', `Перехват: упоминание «${SECTORS[dir].loc}» и время ≈ ${fmtTime(next.t).hm}.`);
    return { text: `Мирон переводит обрывки: «…${SECTORS[dir].loc}… ${fmtTime(next.t + rnd(-40, 40)).hm}… ждать сигнала…» Больше ничего.` };
  } });
  return o;
}
