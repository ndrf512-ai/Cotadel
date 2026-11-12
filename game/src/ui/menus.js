// Взаимодействие с предметами и людьми штаба: телефон, рация, карта, бумаги, выходы.
import { SECTORS, SECTOR_IDS, RES_LOCS, STAFF, fmtTime } from '../sim/data.js';
import { ammoWords, fatigueWords, moraleWords, orderText, cap, pick, n1 } from '../sim/lines.js';
import { radioMenu } from '../sim/director.js';
import { drawMap } from '../world/mapdraw.js';
import { esc } from './ui.js';

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
      if (!list.length) return { text: k === 'lostSector' ? 'Потерянных секторов нет.' : 'Некуда.', options: [back(() => this.callPlatoon(p))] };
      return { text: 'Куда?', options: [...list.map((s) => {
        const h = sim.holderOf(s);
        const eta = p.where.type === 'res' ? RES_LOCS[p.where.loc].t[s] : null;
        return { label: `${SECTORS[s].name} (${SECTORS[s].loc})${h && ord.task === 'relieve' ? ' — сменить ' + h.call.toLowerCase() : ''}${eta ? ` ~${eta} мин` : ''}`, fn: nextP({ sector: s }) };
      }), back(() => this.callPlatoon(p))], noType: true };
    }
    if (k === 'loc') {
      return { text: 'Где держать резерв?', options: [...Object.entries(RES_LOCS).filter(([id]) => !(p.where.type === 'res' && p.where.loc === id)).map(([id, l]) => ({
        label: `${cap(l.name)} — до С ${l.t.N} / В ${l.t.E} / Ю ${l.t.S} / З ${l.t.W} мин`, fn: nextP({ loc: id, locName: l.name }),
      })), back(() => this.callPlatoon(p))], noType: true };
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
    const r = sim.issueOrder(p, ord, 'phone');
    if (ord.task === 'report') return undefined; // доклад придёт звонком
    const opts = [];
    if (r.retry) opts.push({ label: 'Повторить приказ', fn: () => this.confirmOrder(p, ord, via) });
    if (r.options) opts.push(...this.wrap(r.options));
    opts.push({ label: 'Ещё приказ', fn: () => this.callPlatoon(p), cls: 'back' });
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

  map() {
    const sim = this.sim;
    const c = document.createElement('canvas'); c.width = 640; c.height = 480;
    drawMap(c, sim, true);
    const url = c.toDataURL();
    const rows = SECTOR_IDS.map((s) => {
      const k = sim.knowledge[s];
      const p = k.our ? sim.platoons[k.our] : null;
      return `<tr><td>${SECTORS[s].name}</td><td>${fmtTime(k.t).hm}</td><td>${k.held === 'lost' ? '<span style="color:#8a2018">ПОТЕРЯН</span>' : k.held === 'line2' ? 'вторая линия' : 'первая линия'}${p ? ', ' + p.call.toLowerCase() : ''}</td><td>${esc(k.enemy || '')}</td></tr>`;
    }).join('');
    return { hdr: ['Карта обстановки', sim.time.full], noType: true,
      html: `<img src="${url}" style="width:100%;image-rendering:pixelated;border:1px solid #7a6f58;display:block"><table style="margin-top:8px"><tr><td>Сектор</td><td>Доклад</td><td>Положение</td><td>Противник</td></tr>${rows}</table><p style="font-size:12px;opacity:.7">На карте — только то, что доложено. Время у каждой пометки — время доклада.</p>`,
      options: [] };
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

  // ---------- выход ----------
  door() {
    const sim = this.sim;
    const opts = [];
    for (const p of Object.values(sim.platoons)) {
      if (p.men <= 0 || p.where.type === 'move') continue;
      const s = p.where.type === 'sector' ? p.where.s : null;
      const eta = s ? RES_LOCS.hq.t[s] : p.where.loc === 'hq' ? 2 : 12;
      opts.push({ label: `Пойти в ${p.name.replace('взвод', 'взвод')} — ${sim.officerOf(p)?.short} (~${eta} мин в одну сторону)`, fn: () => { this.g.goOut(eta, () => this.visitPlatoon(p, eta)); return undefined; } });
    }
    opts.push({ label: 'В медпункт (~5 мин)', fn: () => { this.g.goOut(5, () => this.visitMed()); return undefined; } });
    opts.push({ label: 'На склад (~6 мин)', fn: () => { this.g.goOut(6, () => this.visitDepot()); return undefined; } });
    opts.push({ label: 'Выглянуть в траншею (~3 мин)', fn: () => { this.g.goOut(2, () => this.trench()); return undefined; } });
    opts.push(back(() => undefined, 'Остаться в штабе'));
    return { hdr: this.hdr('Выход'), text: 'Пока вас нет — звонки остаются без ответа.', options: opts, noType: true };
  }

  returnOpt(min) { return { label: 'Возвращаться в штаб', fn: () => { this.g.comeBack(min); return undefined; }, cls: 'back' }; }

  visitPlatoon(p, eta) {
    const sim = this.sim, o = sim.officerOf(p);
    sim.stats.visits++;
    const fresh = sim.t - (p.lastVisit || -9999) > 360;
    if (fresh) { p.lastVisit = sim.t; p.morale = Math.min(100, p.morale + 6); if (o) sim.trust(o, 5, 'капитан сам пришёл к нам на позиции'); }
    const sec = p.where.type === 'sector' ? sim.sectors[p.where.s] : null;
    const scene = [];
    scene.push(sec ? `Блиндаж ${p.name.replace('взвод', 'взвода')}. ${sec.op ? 'Наверху — стрельба, с потолка сыплется.' : pick(['Тихо. Кто-то спит прямо на ящиках.', 'Коптилка, махорочный дым, сырость.', 'В углу кипит котелок. Пахнет мокрой шинелью.'])}` : `Резерв, ${RES_LOCS[p.where.loc].name}. Люди сидят в щелях, курят в рукав.`);
    scene.push(p.ammo < 1.5 ? 'Ящики из-под патронов пусты, их пустили на дрова.' : 'Ящики с патронами вдоль стены.');
    scene.push(p.fatigue > 70 ? 'Бойцы спят сидя, с винтовками в обнимку. Двое не проснулись, когда вы вошли.' : p.fatigue > 45 ? 'Лица серые, глаза красные.' : 'Люди бодры, при вашем появлении встают.');
    if (p.wounded > 0 && sec) scene.push('На нарах — раненые, ждут, когда отнесут в медпункт.');
    if (o) scene.push(`\n${o.short}: «${o.trust > 60 ? 'Рад вас видеть, капитан.' : o.trust > 35 ? 'Капитан.' : 'Пришли проверить?'}»`);
    scene.push(`\n${sim.platoonTruth(p, o)}`);
    const opts = [
      { label: 'Поговорить с бойцами (15 мин)', fn: () => { sim.update(15); p.morale = Math.min(100, p.morale + 5); return { text: pick(['Спрашивают про деблокаду. Про письма. Про кухню. Отвечаете, как можете. Кто-то смеётся — впервые за сутки.', 'Молодой боец показывает фотографию матери. Вы киваете. Он долго смотрит вам вслед.']), options: [back(() => this.visitPlatoon(p, eta)), this.returnOpt(eta)] }; } },
    ];
    if (o) {
      for (const t of sim.officerTalkOptions(o).slice(0, 4)) opts.push({ label: t.label, fn: () => { const r = t.fn(); return { text: r.text, options: [back(() => this.visitPlatoon(p, eta)), this.returnOpt(eta)] }; } });
      if (sec && !o.promise) opts.push({ label: 'Пообещать смену через 4 часа', fn: () => { o.promise = { what: 'relief', until: sim.t + 240 + eta }; sim.trust(o, 2); return { text: 'Он кивает. «Передам людям. Они будут ждать, капитан.»', options: [this.returnOpt(eta)] }; } });
    }
    opts.push(this.returnOpt(eta));
    return { hdr: [p.name, sim.time.full], text: scene.join(' '), options: opts };
  }

  visitMed() {
    const sim = this.sim, m = sim.med;
    const load = m.light + m.severe;
    const text = `Медпункт. ${load > 26 ? 'Раненые лежат в проходах, на полу, на шинелях. Стоны.' : load > 12 ? 'Все нары заняты.' : 'Полутемно, пахнет карболкой.'} Гриневич в фартуке, рукава закатаны. Тяжёлых — ${m.severe}, лёгких — ${m.light}. ${sim.depot.meds < 2 ? 'Бинты стирают и сушат над печкой.' : ''}`;
    return { hdr: ['Медпункт', sim.time.full], text, options: [
      { label: 'Обойти раненых (10 мин)', fn: () => { sim.update(10); for (const p of Object.values(sim.platoons)) p.morale = Math.min(100, p.morale + 1.5); return { text: 'Кто-то хватает вас за рукав: «Капитан, мы удержимся?» Вы отвечаете «да». Слух об этом к вечеру разойдётся по взводам.', options: [this.returnOpt(5)] }; } },
      { label: 'Приоритет: возвращать в строй', fn: () => { m.priority = 'return'; return { text: 'Гриневич молча кивает.', options: [this.returnOpt(5)] }; } },
      { label: 'Приоритет: спасать тяжёлых', fn: () => { m.priority = 'severe'; return { text: '«Спасибо, капитан.»', options: [this.returnOpt(5)] }; } },
      this.returnOpt(5),
    ] };
  }

  visitDepot() {
    const r = this.depot();
    r.hdr = ['Склад', this.sim.time.full];
    r.who = 'Старшина Дьяков — лично';
    r.options = r.options.filter((o) => o !== hang);
    r.options.push(this.returnOpt(6));
    return r;
  }

  trench() {
    const sim = this.sim;
    const lines = [];
    for (const s of SECTOR_IDS) {
      const sec = sim.sectors[s];
      const dir = { N: 'На севере', E: 'На востоке', S: 'На юге', W: 'На западе, над болотом' }[s];
      if (sec.op && sec.op.phase === 'active') lines.push(`${dir} — ${sec.op.str > 120 ? 'сплошной треск пулемётов, разрывы, зарево' : 'частая винтовочная стрельба'}.`);
      else if (sec.op && sec.op.phase === 'arty') lines.push(`${dir} — земля ходит ходуном: артподготовка.`);
      else if (sec.held === 'lost') lines.push(`${dir} — чужие ракеты. Там уже не наши.`);
      else if (sec.shelledUntil > sim.t) lines.push(`${dir} — редкие разрывы.`);
      else lines.push(`${dir} — тихо.`);
    }
    const sky = sim.night > 0.5 ? 'Ночь. Над нейтральной полосой висят осветительные ракеты.' : 'Серое небо, низкий туман.';
    return { hdr: ['Траншея у штаба', sim.time.full], text: `${sky}\n\n${lines.join('\n')}`, options: [this.returnOpt(2)] };
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
}
