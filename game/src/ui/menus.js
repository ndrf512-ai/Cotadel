// Взаимодействие с предметами и людьми штаба: телефон, рация, карта, бумаги, выходы.
import { SECTORS, SECTOR_IDS, RES_LOCS, STAFF, fmtTime } from '../sim/data.js';
import { ammoWords, fatigueWords, moraleWords, orderText, cap, pick, n1 } from '../sim/lines.js';
import { radioMenu } from '../sim/director.js';
import { drawMap } from '../world/mapdraw.js';
import { esc } from './ui.js';
import { DELEG_INFO, shorten } from '../sim/staff.js';

const back = (fn, label = 'Назад') => ({ label, fn, cls: 'back' });
const hang = { label: 'Отбой', fn: () => undefined, cls: 'back' };

export class Menus {
  constructor(game) { this.g = game; }
  get sim() { return this.g.sim; }
  hdr(l) { return [l, this.sim.time.full]; }

  /** Превращает варианты из симуляции в варианты интерфейса (рекурсивно). */
  wrap(opts, fallback = hang) {
    const list = (opts || []).map((o) => ({
      label: o.label, disabled: o.disabled, cls: o.cls,
      fn: () => {
        const r = o.fn();
        if (!r || (!r.text && !r.options)) return undefined;
        return { text: r.text, options: r.options ? this.wrap(r.options) : [fallback] };
      },
    }));
    return list;
  }

  // ---------- сообщения ----------
  msgPage(m, label) {
    const sim = this.sim;
    sim.receive(m);
    const chan = { phone: 'Телефонограмма', radio: 'Радио', courier: 'Донесение со связным', visit: 'Личный доклад', adj: 'Доклад ординарца' }[m.channel] || 'Сообщение';
    return {
      hdr: [label || chan, fmtTime(m.arrive).full],
      who: m.fromFull,
      text: m.text,
      options: this.wrap(m.options),
      stamp: m.urgent ? 'СРОЧНО' : null,
      onClose: () => sim.close(m),
    };
  }

  // ---------- телефон ----------
  phone() {
    const sim = this.sim;
    const ring = sim.ringing();
    if (ring) { this.g.world.handset(true); return this.msgPage(ring); }
    return this.directory();
  }

  directory() {
    const sim = this.sim;
    const opts = [];
    for (const p of Object.values(sim.platoons)) {
      if (p.men <= 0) continue;
      const o = sim.officerOf(p);
      const where = p.where.type === 'sector' ? SECTORS[p.where.s].name.toLowerCase() : p.where.type === 'res' ? 'резерв, ' + RES_LOCS[p.where.loc].short : 'на марше';
      const cut = sim.channelFor(p) === 'courier';
      opts.push({ label: `${p.call} — ${o?.short || '—'} (${where})${cut ? ' — нет связи' : ''}`, fn: () => this.callPlatoon(p) });
    }
    opts.push({ label: `Инженеры — ${STAFF.luchko.short}`, fn: () => this.engineers() });
    opts.push({ label: `Медпункт — ${STAFF.grin.short}`, fn: () => this.medpoint() });
    opts.push({ label: `Склад — ${STAFF.dyakov.short}`, fn: () => this.depot() });
    opts.push(hang);
    return { hdr: this.hdr('Полевой телефон'), who: 'Мирон (коммутатор)', text: '«Слушаю, капитан. Кого дать?»', options: opts, noType: true };
  }

  callPlatoon(p) {
    const sim = this.sim;
    const o = sim.officerOf(p);
    if (!o) return { text: 'Никто не отвечает.' };
    if (sim.channelFor(p) === 'courier' && !(p.where.type === 'res')) {
      return { who: 'Мирон', text: `Линия на ${p.call.toLowerCase()} молчит, капитан. ${p.where.type === 'move' ? 'Они на марше.' : 'Обрыв.'} Отправить связного с приказом? Дойдёт минут за двадцать — если дойдёт.`,
        options: [...this.orderList(p, 'courier'), back(() => this.directory())] };
    }
    const greet = {
      executor: `${o.short} у аппарата.`, initiator: `${o.short}. Слушаю, капитан.`, cautious: `${o.short}… Да, капитан?`,
      natural: `${o.short}. Что случилось?`, veteran: `${o.short}.`, timid: `${o.short} слушает…`,
    }[o.arch];
    const extra = sim.t - o.lastOrderT < 45 ? (o.arch === 'natural' || o.arch === 'initiator' ? ' (в голосе — раздражение)' : '') : '';
    return { who: `${o.name} — ${p.name}`, text: greet + extra, options: [...this.orderList(p, 'phone'), hang], noType: true };
  }

  orderList(p, via) {
    const sim = this.sim;
    return sim.ordersFor(p).filter((t) => !(via === 'courier' && t.task === 'report')).map((t) => ({ label: t.label, fn: () => this.orderParams(p, { task: t.task }, t.params || [], via) }));
  }

  orderParams(p, ord, params, via) {
    const sim = this.sim;
    const rest = params.slice(1);
    const nextP = (patch) => () => this.orderParams(p, { ...ord, ...patch }, rest, via);
    const head = `Приказ: ${orderText({ ...ord, sector: ord.sector || 'N', locName: ord.locName || '' }).split(',')[0]}`;
    if (!params.length) return this.confirmOrder(p, ord, via);
    const k = params[0];
    if (k === 'sector' || k === 'lostSector' || k === 'sectorAny') {
      const list = SECTOR_IDS.filter((s) => k === 'sectorAny' ? true : k === 'lostSector' ? sim.sectors[s].held === 'lost' : sim.sectors[s].held !== 'lost')
        .filter((s) => !(ord.task === 'relieve' && !sim.holderOf(s)));
      if (!list.length) return { text: k === 'lostSector' ? 'Потерянных секторов нет.' : 'Некуда.', options: [back(() => this.backTo(p, via))] };
      return { text: 'Куда?', options: [...list.map((s) => {
        const h = sim.holderOf(s);
        const eta = p.where.type === 'res' ? RES_LOCS[p.where.loc].t[s] : null;
        return { label: `${SECTORS[s].name} (${SECTORS[s].loc})${h && ord.task === 'relieve' ? ' — сменить ' + h.call.toLowerCase() : ''}${eta ? ` ~${eta} мин` : ''}`, fn: nextP({ sector: s }) };
      }), back(() => this.backTo(p, via))], noType: true };
    }
    if (k === 'loc') {
      return { text: 'Где держать резерв?', options: [...Object.entries(RES_LOCS).filter(([id]) => !(p.where.type === 'res' && p.where.loc === id)).map(([id, l]) => ({
        label: `${cap(l.name)} — до С ${l.t.N} / В ${l.t.E} / Ю ${l.t.S} / З ${l.t.W} мин`, fn: nextP({ loc: id, locName: l.name }),
      })), back(() => this.backTo(p, via))], noType: true };
    }
    if (k === 'priority') {
      return { text: `${head}. Как держать?`, options: [
        { label: 'Любой ценой', fn: nextP({ priority: 'hold' }) },
        { label: 'Сберегая людей', fn: nextP({ priority: 'people' }) },
        { label: 'Не уточнять', fn: nextP({ priority: null }) },
      ], noType: true };
    }
    if (k === 'freedom') {
      return { text: 'Свобода действий?', options: [
        { label: 'Действовать по обстановке', fn: nextP({ freedom: 'free' }) },
        { label: 'Строго по приказу', fn: nextP({ freedom: 'strict' }) },
        { label: 'Не уточнять', fn: nextP({ freedom: null }) },
      ], noType: true };
    }
    return this.confirmOrder(p, ord, via);
  }

  confirmOrder(p, ord, via) {
    const sim = this.sim;
    if (via === 'courier') {
      const eta = sim.courierOrder(p, ord);
      return { who: 'Мирон', text: `Связной ушёл. Приказ: «${orderText(ord)}». Ожидаемое время доставки — ${fmtTime(eta).hm}.`, options: [hang] };
    }
    const r = sim.issueOrder(p, ord, via === 'person' ? 'person' : 'phone');
    if (ord.task === 'report') return undefined; // доклад придёт звонком
    const opts = [];
    if (r.retry) opts.push({ label: 'Повторить приказ', fn: () => this.confirmOrder(p, ord, via) });
    if (r.options) opts.push(...this.wrap(r.options));
    opts.push({ label: 'Ещё приказ', fn: () => this.backTo(p, via), cls: 'back' });
    opts.push(hang);
    return { text: r.text || 'Есть.', options: opts };
  }

  // ---------- службы ----------
  engineers() {
    const sim = this.sim, e = sim.eng;
    const now = e.task ? `Сейчас: ${e.task.label.toLowerCase()} — готово примерно на ${Math.round(e.task.progress * 100)}%.` : 'Сейчас взвод без задачи.';
    const opts = sim.engTasks().map((t) => ({ label: `${t.label} (~${Math.round(t.dur / 60)} ч, мат. ${t.mat})`, fn: () => ({ text: sim.engAssign(t).text }) }));
    if (!sim.flags.engInf) opts.push({ label: 'Инженеров — в оборону штаба, как пехоту', fn: () => { sim.flags.engInf = true; sim.eng.task = null; return { text: 'Поняла. Сапёры с карабинами — у хода сообщения. Работы встают, капитан.' }; } });
    else opts.push({ label: 'Вернуть инженеров к работам', fn: () => { sim.flags.engInf = false; return { text: 'Есть. Возвращаю людей.' }; } });
    opts.push(hang);
    return { hdr: this.hdr('Инженерный взвод'), who: STAFF.luchko.name, text: `Лучко слушает. ${now} Людей — ${e.men}. Материалов на складе — ${Math.floor(sim.depot.mat)}.`, options: opts };
  }

  medpoint() {
    const sim = this.sim, m = sim.med;
    const load = m.light + m.severe;
    const tone = load > 26 ? 'Голос сорван.' : load > 15 ? 'Говорит устало.' : '';
    const text = `Гриневич. ${tone} Раненых — ${load}: тяжёлых ${m.severe}, остальные лёгкие. Медикаментов — ${sim.depot.meds < 1 ? 'почти нет' : sim.depot.meds < 4 ? 'мало' : 'пока есть'}. Умерло у меня — ${m.dead}. Вернул в строй — ${m.returned}. Приоритет сейчас: ${m.priority === 'return' ? 'возвращать в строй' : 'спасать тяжёлых'}.`;
    return { hdr: this.hdr('Медпункт'), who: STAFF.grin.name, text, options: [
      { label: 'Приоритет — вернуть людей в строй.', fn: () => { m.priority = 'return'; return { text: 'Понял. Тяжёлым придётся ждать.' }; } },
      { label: 'Приоритет — спасать тяжёлых.', fn: () => { m.priority = 'severe'; return { text: 'Понял. Спасибо.' }; } },
      hang,
    ] };
  }

  depot() {
    const sim = this.sim, d = sim.depot;
    sim.ledger = { t: sim.t, ...d };
    const text = `Дьяков. Патронов — ${n1(d.ammo)} бк, медикаментов — ${Math.round(d.meds)} уп., продуктов — на ${(d.food * 24).toFixed(0)} ч, воды — на ${(d.water * 24).toFixed(0)} ч${d.well ? '' : ' (колодец разбит)'}, материалов — ${Math.floor(d.mat)}. Паёк — ${d.ration < 1 ? 'урезанный' : 'полный'}.`;
    const opts = [
      { label: 'Выслать патроны во взвод…', fn: () => this.ammoPick() },
      { label: d.ration < 1 ? 'Вернуть полный паёк' : 'Урезать паёк вдвое', fn: () => { d.ration = d.ration < 1 ? 1 : 0.5; for (const p of Object.values(sim.platoons)) p.morale += d.ration < 1 ? -3 : 2; return { text: 'Есть.' }; } },
    ];
    if (!sim.flags.stash) opts.push({ label: '«Дьяков, а что у тебя в дальнем углу?»', fn: () => {
      sim.flags.stash = true; d.ammo += 2; d.food += 0.3; d.meds += 1;
      return { text: '…Пауза. «Ну… есть немного. На чёрный день держал. Два ящика патронов, консервы, бинты. Считайте, что он настал.»' };
    } });
    opts.push(hang);
    return { hdr: this.hdr('Склад'), who: STAFF.dyakov.name, text, options: opts };
  }

  ammoPick() {
    const sim = this.sim;
    const opts = Object.values(sim.platoons).filter((p) => p.men > 0 && p.where.type !== 'move').map((p) => ({
      label: `${p.name} (${sim.officerOf(p)?.short})`, fn: () => ({ text: 'Сколько?', options: [
        { label: 'Один боекомплект', disabled: sim.depot.ammo < 1, fn: () => { sim.sendAmmo(p, 1); return { text: 'Подносчики вышли. Минут через тридцать будут.' }; } },
        { label: 'Два боекомплекта', disabled: sim.depot.ammo < 2, fn: () => { sim.sendAmmo(p, 2); return { text: 'Подносчики вышли. Минут через тридцать будут.' }; } },
        back(() => this.ammoPick()),
      ] }),
    }));
    return { text: `Кому? На складе — ${n1(sim.depot.ammo)} бк.`, options: [...opts, back(() => this.depot())] };
  }

  // ---------- рация ----------
  radio() {
    const sim = this.sim;
    const m = sim.pending('radio')[0];
    if (m) return this.msgPage(m, 'Радио');
    const opts = radioMenu(sim).map((o) => ({ label: o.label, fn: () => { this.g.audio.radio(1.2); const r = o.fn(); return { text: r.text, options: [back(() => this.radio(), 'Ещё'), hang] }; } }));
    opts.push(hang);
    return { hdr: this.hdr('Рация'), who: 'Мирон', text: 'Мирон крутит верньер. «На связи “Берег”. Только недолго, капитан, — пеленгуют.»', options: opts };
  }

  // ---------- бумаги ----------
  journal() {
    const sim = this.sim;
    const rows = sim.log.slice(-60).reverse().map((l) => `<tr><td style="white-space:nowrap">${fmtTime(l.t).hm}</td><td><b>${esc(l.from)}</b>: ${esc(l.text)}</td></tr>`).join('');
    return { hdr: this.hdr('Журнал боевых действий'), html: `<table>${rows || '<tr><td>Записей нет.</td></tr>'}</table>`, options: [] };
  }

  folder() {
    const sim = this.sim;
    if (!sim.notes.length) return { hdr: this.hdr('Папка донесений'), text: 'Пусто.', options: [] };
    return { hdr: this.hdr('Папка донесений'), text: 'Письменные донесения:', options: [...sim.notes.slice().reverse().map((n) => ({ label: `${fmtTime(n.t).hm} — ${n.title}`, fn: () => ({ hdr: this.hdr(n.title), text: n.text, options: [back(() => this.folder()), hang] }) })), hang], noType: true };
  }

  ledger() {
    const l = this.sim.ledger;
    return { hdr: ['Ведомость снабжения', `на ${fmtTime(l.t).full}`], who: 'Заполнено рукой старшины Дьякова', noType: true, html: `<table>
      <tr><td>Патроны (боекомплекты)</td><td>${n1(l.ammo)}</td></tr>
      <tr><td>Медикаменты (уп.)</td><td>${Math.round(l.meds)}</td></tr>
      <tr><td>Продукты (часов)</td><td>${(l.food * 24).toFixed(0)}</td></tr>
      <tr><td>Вода (часов)</td><td>${(l.water * 24).toFixed(0)}</td></tr>
      <tr><td>Инженерные материалы</td><td>${Math.floor(l.mat)}</td></tr></table>
      <p style="font-size:12px;opacity:.7">Сведения на момент записи. Свежие — у старшины по телефону.</p>`, options: [] };
  }

  files() {
    const sim = this.sim;
    const opts = Object.values(sim.officers).filter((o) => !o.removed).map((o) => ({ label: `${o.name}${o.alive ? '' : ' †'}`, fn: () => this.dossier(o) }));
    opts.push(hang);
    return { hdr: this.hdr('Личные дела'), text: 'Папки с фотокарточками. На полях — пометки карандашом.', options: opts, noType: true };
  }

  dossier(o) {
    const sim = this.sim;
    const p = sim.platoonOf(o);
    const notes = [];
    if (!o.alive) notes.push('Погиб.');
    else {
      notes.push(o.trust > 70 ? 'Верит вам.' : o.trust > 50 ? 'Относится к вам ровно, с уважением.' : o.trust > 30 ? 'Держится настороженно.' : 'Не доверяет вам. Доклады стоит перепроверять.');
      notes.push(o.autonomy > 65 ? 'Действует самостоятельно, звонит редко.' : o.autonomy > 35 ? 'Принимает решения по обстановке.' : 'Звонит по каждому поводу, ждёт команды.');
      if (o.stress > 60) notes.push('Издёрган. Голос срывается.');
      if (o.grudge > 0) notes.push('Затаил обиду.');
      if (o.promise) notes.push(`Ему обещана смена до ${fmtTime(o.promise.until).hm}.`);
    }
    const mem = o.memory.slice(-4).map((m) => `— ${fmtTime(m.t).hm}: ${m.text}`).join('\n');
    return { hdr: this.hdr('Личное дело'), who: o.name, text: `${p ? p.name + '. ' : ''}${o.bio}${o.replaced ? `\nПринял командование после: ${o.replaced}.` : ''}\n\nЗаметки ординарца: ${notes.join(' ')}${mem ? `\n\nЗапомнилось ему:\n${mem}` : ''}`, options: [back(() => this.files()), hang] };
  }

  safe() {
    const sim = this.sim;
    const secret = sim.notes.filter((n) => n.secret);
    const opts = secret.map((n) => ({ label: n.title, fn: () => ({ hdr: this.hdr(n.title), text: n.text, stamp: 'СЕКРЕТНО', options: [back(() => this.safe()), hang] }) }));
    if (sim.hq.docsReady && !sim.hq.docsBurned) opts.push({ label: 'Сжечь шифры и документы', fn: () => { sim.hq.docsBurned = true; return { text: 'Бумага корчится в печке. Теперь назад дороги нет.' }; } });
    opts.push(hang);
    return { hdr: this.hdr('Сейф'), text: `Ключ — у вас на шее. Срок деблокады по последним данным: ${fmtTime(sim.knownRelief || sim.reliefT).full}.`, options: opts, noType: true };
  }

  // ---------- время ----------
  clock() {
    const sim = this.sim;
    const busy = !!sim.ringing();
    return { hdr: ['Часы', ''], text: `${sim.time.full}.${sim.reliefT - sim.t < 600 ? '' : ''}`, noType: true, options: [
      { label: 'Ждать 15 минут', disabled: busy, fn: () => { this.g.fastForward(15); return undefined; } },
      { label: 'Ждать час', disabled: busy, fn: () => { this.g.fastForward(60); return undefined; } },
      { label: 'Ждать до первого доклада', disabled: busy, fn: () => { this.g.fastForward(600); return undefined; } },
      hang,
    ] };
  }

  cot() {
    const c = this.sim.captain;
    const t = c.fatigue < 25 ? 'Вы не устали. Сон не идёт.' : c.fatigue < 60 ? 'Можно прилечь. Гусев разбудит, если что.' : 'Глаза слипаются. Буквы в донесениях плывут.';
    return { hdr: ['Койка', ''], text: t, noType: true, options: [
      { label: 'Поспать 2 часа', disabled: c.fatigue < 25, fn: () => { this.g.sleep(2); return undefined; } },
      { label: 'Поспать 4 часа', disabled: c.fatigue < 40, fn: () => { this.g.sleep(4); return undefined; } },
      hang,
    ] };
  }

  // ---------- люди ----------
  olya() {
    const sim = this.sim;
    const lines = SECTOR_IDS.map((s) => `${SECTORS[s].name}: ${sim.sectors[s].held === 'lost' ? 'линии нет' : sim.sectors[s].line === 'cut' ? 'обрыв, линейщики работают' : 'связь есть'}`).join('\n');
    const opts = SECTOR_IDS.filter((s) => sim.sectors[s].line === 'cut' && sim.sectors[s].held !== 'lost').map((s) => ({ label: `Чинить в первую очередь: ${SECTORS[s].name.toLowerCase()}`, fn: () => { sim.sectors[s].repairEta = Math.min(sim.sectors[s].repairEta || 9e9, sim.t + 12 + Math.random() * 10); return { text: 'Есть. Отправлю туда Сашку с катушкой.' }; } }));
    const missed = sim.log.filter((l) => l.kind === 'missed').slice(-5).map((l) => `${fmtTime(l.t).hm} — ${l.text}`).join('\n');
    opts.push({ label: 'Кто звонил, пока меня не было?', fn: () => ({ text: missed || 'Никто, капитан.' }) });
    opts.push(hang);
    return { hdr: this.hdr('Узел связи'), who: 'Сержант Оля Мирон', text: `Состояние линий:\n${lines}`, options: opts, noType: true };
  }

  gusev() {
    const sim = this.sim;
    const m = sim.pending('adj')[0];
    if (m) return this.msgPage(m, 'Ординарец');
    const recent = sim.log.slice(-5).reverse().map((l) => `${fmtTime(l.t).hm} ${l.from}: ${l.text}`).join('\n');
    return { hdr: this.hdr('Ординарец'), who: 'Лёшка Гусев', text: sim.captain.fatigue > 70 ? '«Капитан, вы бы прилегли. На вас лица нет.»' : '«Слушаю, капитан.»', options: [
      { label: 'Что нового?', fn: () => ({ text: recent || 'Тихо пока.' }) },
      { label: 'Сделай чаю, Лёша.', fn: () => { sim.update(5); sim.captain.fatigue = Math.max(0, sim.captain.fatigue - 7); return { text: 'Кружка обжигает пальцы. Чай пахнет дымом. Немного легче.' }; } },
      hang,
    ] };
  }

  wounded() {
    return { hdr: ['Предбанник', ''], text: pick(['Раненый открывает глаза: «Капитан… мы держимся?»', 'Боец с перевязанной головой пытается встать, когда вы подходите.', 'Кто-то тихо просит пить.']), options: [
      { label: '«Держимся, браток.»', fn: () => undefined },
      { label: 'Дать воды из своей фляги.', fn: () => { this.sim.depot.water = Math.max(0, this.sim.depot.water - 0.01); return { text: 'Он пьёт жадно, потом засыпает.' }; } },
    ] };
  }

  backTo(p, via) { return via === 'person' ? this.officerField(this.sim.officerOf(p)) : this.callPlatoon(p); }

  // ---------- лично на позиции ----------
  officerField(o) {
    const sim = this.sim;
    if (!o || !o.alive) return { text: 'Никого.', options: [] };
    const p = sim.platoonOf(o);
    const s = p.where.type === 'sector' ? p.where.s : null;
    if (s) sim.observe(s);
    if (sim.t - (p.lastVisit || -9999) > 360) {
      p.lastVisit = sim.t; sim.stats.visits++;
      p.morale = Math.min(100, p.morale + 6);
      sim.trust(o, 5, 'капитан сам пришёл к нам на позиции');
    }
    const greet = o.trust > 60 ? 'Рад вас видеть, капитан.' : o.trust > 35 ? 'Капитан.' : 'Пришли проверить?';
    const pend = sim.inbox.filter((m) => m.route === 'player' && !m.done && m.unit === p.id && sim.t >= m.arrive);
    const opts = pend.map((m) => ({ label: `Выслушать доклад: ${shorten(m.text, 50)}`, fn: () => this.msgPage(m, 'Доклад лично') }));
    opts.push({ label: 'Что у вас происходит?', fn: () => ({ text: this.situation(p, o), options: [back(() => this.officerField(o)), hang] }) });
    opts.push({ label: 'Приказ…', fn: () => ({ text: 'Слушаю.', options: [...this.orderList(p, 'person'), back(() => this.officerField(o))], noType: true }) });
    for (const t of sim.officerTalkOptions(o).slice(0, 4)) opts.push({ label: t.label, fn: () => { const r = t.fn(); return { text: r.text, options: [back(() => this.officerField(o)), hang] }; } });
    if (s && !o.promise) opts.push({ label: 'Пообещать смену через 4 часа', fn: () => { o.promise = { what: 'relief', until: sim.t + 240 }; sim.trust(o, 2); return { text: '«Передам людям. Они будут ждать, капитан.»' }; } });
    opts.push(hang);
    return { hdr: [p.name + (s ? ` — ${SECTORS[s].name.toLowerCase()} участок` : ''), sim.time.full], who: o.name, text: greet, options: opts, noType: true };
  }

  situation(p, o) {
    const sim = this.sim;
    const s = p.where.type === 'sector' ? p.where.s : null;
    const l = [];
    if (s) {
      const sec = sim.sectors[s];
      const op = sec.op;
      if (op && op.phase === 'active') l.push(`Бой. Лезут ${({ executor: 'по-прежнему', cautious: 'со всех сторон', initiator: 'нагло' })[o.arch] || ''}, по-моему — ${pick(['больше роты', 'около роты', 'не меньше двух взводов'])}.`);
      else if (op && op.phase === 'arty') l.push('Артподготовка. Сейчас пойдут.');
      else if (sim.enemy.visibleNear(s)) l.push('Перед нами накапливаются. Ночью слышно, как подтягиваются.');
      else l.push(pick(['Сейчас тихо. Постреливают для порядка.', 'Тихо. Слишком тихо, если честно.']));
      l.push(`Держим ${sec.held === 'line1' ? 'первую траншею' : 'вторую линию'}. Укрепления ${sec.fort > 60 ? 'держатся' : sec.fort > 35 ? 'побиты' : 'почти разрушены'}. Связь со штабом ${sec.line === 'cut' ? 'порвана' : 'есть'}.`);
    }
    l.push(sim.platoonTruth(p, o));
    if (p.order.priority === 'hold') l.push('Приказ — держаться любой ценой. Помню.');
    if (o.promise) l.push(`Вы обещали смену к ${fmtTime(o.promise.until).hm}.`);
    return l.join(' ');
  }

  soldier(d) {
    const sim = this.sim;
    const p = d.unit ? sim.P(d.unit) : null;
    let text;
    const r = d.role;
    if (r === 'carrier') text = `«Патроны несём, товарищ капитан. ${p ? p.name + ', ' : ''}старшина приказал. Ящик тяжёлый, а траншея узкая.»`;
    else if (r === 'medic') text = `«Раненого в медпункт. Там уже человек ${sim.med.light + sim.med.severe} лежит, доктор с ног валится.»`;
    else if (r === 'signal') { const cut = SECTOR_IDS.filter((x) => sim.sectors[x].line === 'cut').map((x) => SECTORS[x].gen); text = cut.length ? `«Обрыв на ${cut[0]} участке. Ищу, где снарядом порвало. Скоро дам связь.»` : '«Линию проверяю.»'; }
    else if (r === 'eng') text = sim.eng.task ? `«${cap(sim.eng.task.label)}. Лучко сказала — к ночи кончить.»` : '«Брёвна сортируем. Задания пока нет.»';
    else if (r === 'march') text = p ? `«${p.name}, идём, куда приказано. ${p.where.to?.task === 'relieve' ? 'Сменять ребят.' : 'На усиление.'}»` : '«Идём.»';
    else if (r === 'depot') text = `«Ящики таскаю. Патронов на складе — ${sim.depot.ammo < 3 ? 'кот наплакал' : 'пока есть'}.»`;
    else if (p) {
      const sec = p.where.type === 'sector' ? sim.sectors[p.where.s] : null;
      if (sec && sec.op && sec.op.phase === 'active') text = pick(['«Лезут, товарищ капитан! Пригнитесь!»', '«Патроны! Кто-нибудь, патроны!»', '«Держимся! Держимся!»']);
      else if (p.ammo < 1) text = '«Патронов по обойме на брата. Если полезут — в штыки пойдём.»';
      else if (p.fatigue > 70) text = '«Третьи сутки не спим, товарищ капитан. Глаза сами закрываются.»';
      else if (sim.depot.food <= 0) text = '«Кухни второй день нет. Сухари кончились.»';
      else if (p.morale < 35) text = '«Говорят, помощи не будет… Это правда?»';
      else if (p.where.type === 'res') text = pick(['«Отдыхаем, пока дают. Скажут — пойдём.»', '«Байрамов говорит — нас берегут на самый крайний случай.»']);
      else text = pick([`«Тихо пока. ${sim.officerOf(p)?.short || 'Командир'} велел глядеть в оба.»`, '«Ночью они там что-то копали. Слышно было.»', '«Письмо бы домой отправить… Когда почта будет?»']);
    } else text = pick(['«Здравия желаю, товарищ капитан.»', '«Иду на склад, товарищ капитан.»']);
    const opts = [];
    if (p && !d.cheered) opts.push({ label: '«Держитесь, ребята. Мы удержим.»', fn: () => { d.cheered = true; if (sim.t - (p.cheerT || -999) > 60) { p.cheerT = sim.t; p.morale = Math.min(100, p.morale + 2); } return { text: '«Есть держаться!» — он выпрямляется.' }; } });
    opts.push(hang);
    return { hdr: ['Разговор', sim.time.full], who: d.label, text, options: opts };
  }

  // ---------- штаб помощников ----------
  staffNpc(who) {
    if (who === 'orlov') return this.orlov();
    if (who === 'olya') return this.olya();
    if (who === 'gusev') return this.gusev();
    if (who === 'dyakov') return this.withDeleg(this.depot(), ['ammo']);
    if (who === 'grin') return this.medpoint();
    if (who === 'luchko') return this.withDeleg(this.engineers(), ['engAuto']);
    return null;
  }

  withDeleg(page, keys) {
    const opts = page.options.filter((o) => o !== hang);
    for (const k of keys) opts.push({ label: `Поручение: ${DELEG_INFO[k].title.toLowerCase()} — ${DELEG_INFO[k].opts[this.sim.staff.deleg[k]].toLowerCase()}`, fn: () => this.delegOne(k, () => this.staffNpc(DELEG_INFO[k].who === 'Дьяков' ? 'dyakov' : 'luchko')) });
    opts.push(hang);
    return { ...page, options: opts };
  }

  orlov() {
    const sim = this.sim, st = sim.staff;
    const pend = st.pendingDecisions();
    const fresh = st.digest.filter((d) => d.t > st.lastBrief).slice(-7);
    st.lastBrief = sim.t;
    let text = pend.length ? `Капитан, ждут вашего решения: ${pend.length}.` : 'Капитан, срочных вопросов нет.';
    if (fresh.length) text += `\n\nПока вас не было:\n${fresh.map((d) => `${fmtTime(d.t).hm} ${d.from}: ${shorten(d.text, 90)}`).join('\n')}`;
    else text += '\nНовых докладов нет.';
    const opts = pend.slice(0, 6).map((m) => ({ label: `${m.fromName}: ${shorten(m.text, 46)}`, fn: () => this.msgPage(m) }));
    opts.push({ label: 'Обстановка по участкам', fn: () => ({ text: this.sectorSummary(), options: [back(() => this.orlov()), hang] }) });
    opts.push({ label: 'Поручения штабу…', fn: () => this.delegPage() });
    opts.push({ label: `Особый контроль за участком${st.deleg.watch ? ': ' + SECTORS[st.deleg.watch].name.toLowerCase() : ''}`, fn: () => ({ text: 'За каким участком следить особо? Доклады оттуда — сразу вам, где бы вы ни были.', options: [...SECTOR_IDS.map((s) => ({ label: SECTORS[s].name, fn: () => { st.deleg.watch = s; return { text: `Есть. ${SECTORS[s].name} — на особом контроле.` }; } })), { label: 'Снять контроль', fn: () => { st.deleg.watch = null; return { text: 'Есть.' }; } }, back(() => this.orlov())] }) });
    opts.push(hang);
    return { hdr: this.hdr('Начальник штаба'), who: 'Старший лейтенант Михаил Орлов', text, options: opts };
  }

  sectorSummary() {
    const sim = this.sim;
    return SECTOR_IDS.map((s) => {
      const k = sim.knowledge[s]; const p = k.our ? sim.platoons[k.our] : null;
      return `${SECTORS[s].name} (доклад ${fmtTime(k.t).hm}): ${k.held === 'lost' ? 'ПОТЕРЯН' : k.held === 'line2' ? 'вторая линия' : 'первая линия'}${p ? ', ' + p.call.toLowerCase() : ''}; противник — ${k.enemy}; связь — ${k.line === 'cut' ? 'нет' : 'есть'}.`;
    }).join('\n') + `\n\nРезерв: ${sim.reservePlatoons().map((p) => `${p.call} (${RES_LOCS[p.where.loc].short})`).join(', ') || 'нет'}.`;
  }

  delegPage() {
    const sim = this.sim, D = sim.staff.deleg;
    const opts = Object.entries(DELEG_INFO).map(([k, v]) => ({ label: `${v.who}: ${v.title.toLowerCase()} — ${v.opts[D[k]].toLowerCase()}`, fn: () => this.delegOne(k, () => this.delegPage()) }));
    opts.push(back(() => this.orlov()));
    return { hdr: this.hdr('Поручения'), text: 'Что поручить штабу? Помощники работают сами, но ошибаются: Орлов верит докладам на слово, Дьяков не всё замечает вовремя.', options: opts, noType: true };
  }

  delegOne(k, ret) {
    const sim = this.sim, v = DELEG_INFO[k];
    return { text: `${v.title}:`, options: [...Object.entries(v.opts).map(([val, label]) => ({ label: (sim.staff.deleg[k] === val ? '● ' : '○ ') + label, fn: () => {
      sim.staff.deleg[k] = val;
      return { text: `${v.who}: «Есть. ${label}.»`, options: [back(ret, 'Ещё поручение'), hang] };
    } })), back(ret)], noType: true };
  }

  fieldPhone() {
    return { hdr: this.hdr('Полевой телефон'), who: 'Мирон (коммутатор)', text: '«Штаб слушает.»', options: [
      { label: 'Начальника штаба — доклад', fn: () => this.orlov() },
      { label: 'Соединить с…', fn: () => this.directory() },
      hang,
    ], noType: true };
  }

  depotStock() {
    const sim = this.sim, d = sim.depot;
    sim.ledger = { t: sim.t, ...d };
    return { hdr: ['Склад', sim.time.full], text: `Вы пересчитываете сами. Ящиков с патронами — ${Math.ceil(d.ammo)}. Мешков с продуктами — ${Math.ceil(d.food * 3)}. Бочки с водой — ${d.water > 1 ? 'полные' : d.water > 0.3 ? 'наполовину' : 'почти пустые'}. Брёвен и досок — ${Math.floor(d.mat)}.`, options: [] };
  }

  medcab() {
    const m = this.sim.depot.meds;
    return { hdr: ['Медпункт', this.sim.time.full], text: m < 1 ? 'Полки пусты. Бинты стирают и сушат над печкой.' : m < 4 ? `Несколько пачек бинтов, пузырьки на донышке. Упаковок — ${Math.round(m)}.` : `Упаковок медикаментов — ${Math.round(m)}.`, options: [] };
  }

  binoculars() {
    const sim = this.sim;
    const n = sim.night > 0.5;
    const plan = sim.enemy.plan.find((x) => x.prepped && !x.started && x.target === 'N');
    const op = sim.sectors.N.op;
    let t = n ? 'Ночь. Видно только, когда висит ракета. ' : 'Серое поле, проволока, воронки, берёзы. ';
    if (op && op.phase === 'active') t += 'Цепи противника перебежками идут к проволоке. Много.';
    else if (plan && (!n || Math.random() < 0.4)) t += `В лощине движение: ${plan.signals === 'loud' ? 'ходят открыто, курят, подвозят ящики' : 'кто-то короткими перебежками, без шума'}. Похоже — ${plan.str > 150 ? 'не меньше роты' : 'взвод-два'}.`;
    else t += 'Движения не видно. Дымок над их окопами — кухня.';
    sim.observe('N');
    return { hdr: ['НП «Берёзы»', sim.time.full], text: t, options: [] };
  }

  pocketMap(player) {
    const sim = this.sim;
    const c = document.createElement('canvas'); c.width = 600; c.height = 600;
    drawMap(c, sim, true, player);
    return { hdr: ['Планшет', sim.time.full], noType: true,
      html: `<img src="${c.toDataURL()}" style="width:auto;max-width:100%;max-height:70vh;image-rendering:pixelated;border:1px solid #7a6f58;display:block;margin:0 auto">
      <p style="font-size:12px;opacity:.7">Траншеи, блиндажи и позиции — как есть на местности. Обстановка — только по докладам и вашим личным наблюдениям, со временем доклада.</p>`, options: [] };
  }
}
