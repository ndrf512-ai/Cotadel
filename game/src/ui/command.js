// Экран «Командование» — единое место управления обороной.
// Сначала обстановка (где наши, где противник, угрозы, задачи), затем решения.
// Капитан ставит задачи участкам; Орлов передаёт их по цепочке, командиры исполняют сами.
import { SECTORS, SECTOR_IDS, RES_LOCS, fmtTime } from '../sim/data.js';
import { ammoWords } from '../sim/lines.js';
import { TASKS } from '../sim/chain.js';
import { shorten } from '../sim/staff.js';
import { drawMap } from '../world/mapdraw.js';
import { esc } from './ui.js';

const hang = { label: 'Закрыть', fn: () => undefined, cls: 'back' };

export class Command {
  constructor(menus, game) { this.m = menus; this.g = game; }
  get sim() { return this.g.sim; }
  back(label = 'К обстановке') { return { label, fn: () => this.page(), cls: 'back' }; }

  // ---------- обстановка ----------
  sectorLine(s) {
    const sim = this.sim, k = sim.knowledge[s], sec = sim.sectors[s];
    const h = sim.holderOf(s);
    const o = h && sim.officerOf(h);
    const q = sim.chain.pending(s);
    const task = sim.chain.task[s];
    const lvl = k.held === 'lost' ? 'lost' : k.combat ? 'fight' : /накаплив|разведк/.test(k.enemy || '') && !/тихо/.test(k.enemy || '') ? 'warn' : 'calm';
    const pos = k.held === 'lost' ? 'ПОТЕРЯН' : k.held === 'line2' ? 'запасная позиция' : 'первая линия';
    const who = h ? `${o ? o.short : 'без командира'} · ${h.call}` : '—';
    const tsk = q ? `<i>передаётся ${esc(q.via)}: ${esc(TASKS[q.task].label.toLowerCase())}</i>` : k.held === 'lost' ? 'противник на позициях' : esc(TASKS[task].label);
    const kn = h && h.known;
    const men = kn ? `${kn.men} чел.` : '?';
    const ammo = kn ? (kn.ammo < 1.3 ? '<b>патроны на исходе</b>' : kn.ammo < 2.5 ? 'патронов мало' : 'патронов хватает') : '';
    const enemy = (k.enemy || 'нет сведений').replace(/ \(.*\)/, '');
    const line = sec.line === 'cut' && k.line === 'cut' ? ' · <b>нет связи</b>' : '';
    return `<tr class="sit-${lvl}"><td><b>${SECTORS[s].name}</b><br><small>${esc(who)}</small></td><td>${pos}<br><small>${tsk}</small></td><td>${esc(enemy)}<br><small>доклад ${fmtTime(k.t).hm}${line}</small></td><td>${men}<br><small>${ammo}</small></td></tr>`;
  }

  situationHtml() {
    const sim = this.sim;
    const c = document.createElement('canvas'); c.width = 220; c.height = 220;
    try { drawMap(c, sim, false, this.g.player ? { x: this.g.player.x, z: this.g.player.z, yaw: 0 } : null); } catch (e) { /* карта не обязательна */ }
    const thr = sim.chain.threats().slice(0, 4);
    const res = sim.reservePlatoons();
    const moving = Object.values(sim.platoons).filter((p) => p.where.type === 'move' && p.men > 0);
    const meet = sim.chain.meeting ? `<div class="sit-note">Командиры на совещании в командирском блиндаже до ${fmtTime(sim.chain.meeting.until).hm}.</div>` : '';
    const recent = sim.staff.digest.slice(-3).reverse().map((d) => `${fmtTime(d.t).hm} ${esc(d.from)}: ${esc(shorten(d.text, 100))}`).join('<br>');
    return `<div class="sit">
      <div class="sit-top"><img class="sit-map" src="${c.toDataURL()}" alt="">
      <div class="sit-side"><div class="sit-thr">${thr.length ? thr.map((x) => `<div class="${x.w >= 7 ? 'hot' : x.w >= 4 ? 'warn' : ''}">${x.w >= 7 ? '▲' : '•'} ${esc(x.t)}</div>`).join('') : '<div>Явных угроз нет. Командиры несут службу.</div>'}</div>
      <div class="sit-note">Резерв: ${res.length ? res.map((p) => `${esc(p.call)} (${p.known ? p.known.men + ' чел., ' : ''}${RES_LOCS[p.where.loc].short})`).join(', ') : '<b>нет</b>'}${moving.length ? '<br>В движении: ' + moving.map((p) => `${esc(p.call)} → ${p.where.to.sector ? SECTORS[p.where.to.sector].name.toLowerCase() : RES_LOCS[p.where.to.loc || 'center'].short} к ${fmtTime(p.where.eta).hm}`).join(', ') : ''}${sim.chain.hqHold ? '<br><b>Резерв держит оборону штаба</b>' : ''}</div>
      ${meet}
      ${recent ? `<div class="sit-log">${recent}</div>` : ''}</div></div>
      <table class="sit-tab">${SECTOR_IDS.map((s) => this.sectorLine(s)).join('')}</table>
    </div>`;
  }

  /** Главный экран. */
  page(flash) {
    const sim = this.sim;
    // простые доклады без вопросов принимаются сразу
    for (const m of sim.pending('phone')) if ((m.options || []).length <= 1) { sim.receive(m); m.options?.[0]?.fn(); sim.close(m); flash = flash || `${m.fromName}: ${shorten(m.text, 160)}`; }
    const opts = [];
    const pend = sim.staff.pendingDecisions().filter((m) => m.channel !== 'visit').slice(0, 3);
    if (pend.length) opts.push({ header: `Требуют вашего решения: ${sim.staff.pendingDecisions().length}`, hot: true });
    for (const m of pend) {
      opts.push({ header: `${m.fromName}: ${shorten(m.text, 150)}`, hot: m.urgent });
      for (const o of m.options || []) opts.push({ label: o.label, small: true, disabled: o.disabled, fn: () => {
        sim.receive(m);
        const r = o.fn();
        sim.close(m);
        if (r && r.options) return { text: r.text, options: [...this.m.wrap(r.options, this.back()), this.back()] };
        return this.page(`${m.fromName}: ${r && r.text ? r.text : 'Принято.'}`);
      } });
    }
    for (const s of SECTOR_IDS) {
      const sec = sim.sectors[s], k = sim.knowledge[s];
      const task = sim.chain.task[s];
      const h = sim.holderOf(s);
      opts.push({ header: `${SECTORS[s].name} участок` });
      if (sec.held === 'lost') {
        opts.push({ label: 'Вернуть участок', small: true, fn: () => this.order(s, 'retake') });
      } else if (k.combat || sec.op) {
        opts.push({ label: 'Усилить резервом', small: true, disabled: !sim.chain.bestReserve(s), fn: () => this.order(s, 'reinforce') });
        if (sec.held === 'line1') opts.push({ label: 'Отойти на запасную', small: true, fn: () => this.order(s, 'withdraw') });
        else opts.push({ label: 'Вернуть первую линию', small: true, fn: () => this.order(s, 'retake') });
        if (h && h.known && h.known.ammo < 2.5) opts.push({ label: 'Патроны', small: true, fn: () => this.order(s, 'supply') });
      } else {
        if (task !== 'hold') opts.push({ label: 'Держать', small: true, fn: () => this.order(s, 'hold') });
        if (task !== 'observe') opts.push({ label: 'Наблюдать', small: true, fn: () => this.order(s, 'observe') });
        if (task !== 'prepare') opts.push({ label: 'К бою', small: true, fn: () => this.order(s, 'prepare') });
        opts.push({ label: 'Усилить', small: true, disabled: !sim.chain.bestReserve(s), fn: () => this.order(s, 'reinforce') });
      }
      opts.push({ label: 'Ещё…', small: true, fn: () => this.sector(s) });
    }
    opts.push({ header: 'Оборона в целом' });
    opts.push({ label: 'Перераспределить резерв', small: true, fn: () => this.global(sim.chain.redistribute()) });
    opts.push({ label: sim.chain.hqHold ? 'Снять оборону штаба' : 'Удерживать штаб', small: true, fn: () => this.global(sim.chain.holdHQ()) });
    opts.push({ label: 'Запросить помощь…', small: true, fn: () => this.help() });
    opts.push({ label: sim.chain.meeting ? 'Совещание идёт' : 'Собрать командиров', small: true, disabled: !!sim.chain.meeting, fn: () => this.global(sim.chain.callMeeting(true)) });
    opts.push({ label: 'Личный состав', small: true, fn: () => this.m.personnel() });
    opts.push({ label: 'Поручения штабу', small: true, fn: () => this.m.delegPage() });
    opts.push(hang);
    return { hdr: ['Командование', sim.time.full], flash, noType: true, panel: true, html: this.situationHtml(), text: '', options: opts };
  }

  order(s, task) {
    const sim = this.sim;
    const r = sim.chain.order(s, task);
    sim.say(r.text.replace(/^([^:]+): «?(.*?)»?$/, '$2'), r.text.split(':')[0], 4);
    return this.page(r.text);
  }

  global(r) {
    if (r.after) r.after();
    this.sim.say(r.text.replace(/^([^:]+): «?(.*?)»?$/, '$2'), r.text.split(':')[0], 4);
    return this.page(r.text);
  }

  // ---------- участок подробно ----------
  sector(s, flash) {
    const sim = this.sim, sec = sim.sectors[s], k = sim.knowledge[s];
    const h = sim.holderOf(s), o = h && sim.officerOf(h);
    const army = this.g.army;
    const sq = h && army ? army.summary(h.id) : null;
    const kn = h && h.known;
    const lines = [
      `Командир: ${o ? `${o.name} (${this.m.archWord(o)})` : '—'}`,
      h ? `Подразделение: ${h.name}${kn ? ` — ${kn.men} чел., ${ammoWords(kn.ammo, 'x')}` : ''}` : 'Наших на участке нет.',
      `Положение: ${sec.held === 'lost' ? 'участок потерян' : sec.held === 'line2' ? 'держим запасную позицию' : 'держим первую линию'}; укрепления ${sec.fort > 70 ? 'крепкие' : sec.fort > 40 ? 'терпимые' : 'слабые'}${sec.mines ? ', есть минное поле' : ''}.`,
      `Задача: ${TASKS[sim.chain.task[s]].label.toLowerCase()}${sim.chain.pending(s) ? ` (новая передаётся ${sim.chain.pending(s).via})` : ''}.`,
      `Противник: ${k.enemy || 'нет сведений'} (доклад ${fmtTime(k.t).hm}).`,
      sq ? `Отделения: ${sq.map((x) => `${x.name} — ${x.ok ? x.where : 'выбыло'}`).join('; ')}.` : '',
      `Связь: ${sec.line === 'cut' ? 'телефон оборван — приказы только связным' : 'телефон'}.`,
    ].filter(Boolean).join('\n');
    const cur = sim.chain.task[s];
    const T = (task, label, dis) => ({ label: (['hold', 'observe', 'prepare', 'withdraw'].includes(task) && cur === task ? '● ' : '') + (label || TASKS[task].label), small: true, disabled: dis || (['hold', 'observe', 'prepare'].includes(task) && cur === task), fn: () => { const r = sim.chain.order(s, task); sim.say(r.text.replace(/^([^:]+): «?(.*?)»?$/, '$2'), r.text.split(':')[0], 4); return this.sector(s, r.text); } });
    const lost = sec.held === 'lost';
    const opts = [
      { header: 'Задача участку' },
      T('hold', null, lost), T('observe', null, lost), T('prepare', null, lost),
      T('withdraw', null, lost || sec.held !== 'line1'),
      T('retake', lost ? 'Вернуть участок контратакой' : 'Вернуть первую линию', !lost && sec.held !== 'line2'),
      { header: 'Силы и средства' },
      T('reinforce', 'Отправить резерв', !sim.chain.bestReserve(s)),
      T('relieve', 'Сменить подразделение', lost || !h),
      T('supply', 'Отправить снабжение', lost || !h),
      T('fortify', 'Подготовить оборону (сапёры)', lost),
      { label: 'Артналёт перед участком', small: true, fn: () => { const r = sim.chain.requestHelp('arty', s); return this.sector(s, r.text); } },
    ];
    if (h && o && o.alive) {
      opts.push({ header: 'Командир участка' });
      opts.push({ label: 'Запросить доклад', small: true, disabled: sec.line === 'cut', fn: () => { sim.statusReport(o, h, true); const m = [...sim.inbox].reverse().find((x) => x.unit === h.id && x.kind === 'status'); if (m) { m.arrive = sim.t; m.routed = true; m.route = 'player'; sim.receive(m); sim.close(m); } return this.sector(s, m ? `${o.short}: ${m.text}` : `${o.short} не отвечает.`); } });
      opts.push({ label: 'Карточка взвода, полномочия, смена командира', small: true, fn: () => this.m.unitCard(h) });
    }
    opts.push(this.back());
    return { hdr: [`${SECTORS[s].name} участок`, sim.time.full], flash, noType: true, panel: true, text: lines, options: opts };
  }

  // ---------- помощь армии ----------
  help() {
    const sim = this.sim, day = Math.floor(sim.t / 1440);
    const used = (k) => sim.chain.helpUsed[k + day];
    return { hdr: ['Запрос помощи', sim.time.full], noType: true, panel: true,
      text: 'Связь с армией — по рации, через «Берег». Каждая просьба раз в сутки, и каждый выход в эфир помогает противнику запеленговать штаб.',
      options: [
        { label: 'Артналёт по скоплению противника', disabled: used('arty'), fn: () => this.global(sim.chain.requestHelp('arty')) },
        { label: 'Сброс боеприпасов и продовольствия', disabled: used('airdrop'), fn: () => this.global(sim.chain.requestHelp('airdrop')) },
        this.back(),
      ] };
  }

  // ---------- стол совещаний ----------
  meeting() {
    const sim = this.sim, m = sim.chain.meeting;
    const last = sim.chain.lastMeeting;
    let text;
    if (m) {
      const who = m.who.map((id) => sim.officers[id]).filter(Boolean).map((o) => o.short).join(', ');
      text = `Идёт совещание: ${who}. Командиры сверяют обстановку, договариваются о взаимодействии соседей и распределении резерва. Закончат к ${fmtTime(m.until).hm}.`;
    } else if (last && sim.t - last.t < 360) text = `Итоги совещания ${fmtTime(last.t).hm}:\n${last.lines.join('\n')}`;
    else text = 'Стол совещаний. На карте — позиции участков, флажки отделений, карандашные пометки Орлова. Совещания проходят утром и вечером, если тихо; можно собрать командиров и сейчас.';
    return { hdr: ['Командирский блиндаж', sim.time.full], noType: true, panel: true, text, html: this.situationHtml(), options: [
      { label: 'Собрать командиров', disabled: !!m, fn: () => this.global(sim.chain.callMeeting(true)) },
      { label: 'Командование', fn: () => this.page() },
      hang,
    ] };
  }
}
