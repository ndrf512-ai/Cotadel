// Прогон кампании без графики: бот-капитан отвечает на сообщения. Проверка ошибок и баланса.
import { Sim } from '../src/sim/sim.js';
import { Director } from '../src/sim/director.js';
import { fmtTime } from '../src/sim/data.js';

const mode = process.argv[2] || 'random'; // random | passive | good
const runs = +(process.argv[3] || 20);
const verbose = process.argv.includes('-v');
globalThis.performance ??= { now: () => Date.now() };

function play(seedMode) {
  const sim = new Sim();
  const dir = new Director(sim);
  let answered = 0;
  for (let i = 0; i < 3 * 1440 && !sim.over; i++) {
    sim.update(1); dir.tick();
    if (verbose && sim.hq.pushOp && sim.hq.pushOp.phase === 'active' && sim.t % 5 === 0) console.log('PUSH', fmtTime(sim.t).hm, 'str', sim.hq.pushOp.str | 0, 'ratio', sim.hq.pushOp.ratio?.toFixed(2), 'threat', sim.hq.threat | 0, 'kom', sim.hq.komendant.toFixed(1), Object.values(sim.platoons).map((p) => p.id + ':' + p.men + ':' + (p.where.type === 'res' ? p.where.loc : p.where.type === 'sector' ? p.where.s : 'mv')).join(' '));
    if (seedMode === 'passive') continue;
    for (const ch of ['phone', 'radio', 'visit', 'courier', 'adj']) {
      for (const m of sim.pending(ch)) {
        if (seedMode === 'random' && Math.random() < 0.3) continue; // часть звонков пропускаем
        sim.receive(m);
        let opts = m.options || [];
        let depth = 0;
        while (opts.length && depth < 3) {
          const o = seedMode === 'good' ? opts[0] : opts[(Math.random() * opts.length) | 0];
          if (o.disabled && (typeof o.disabled === 'function' ? o.disabled() : o.disabled)) break;
          const r = o.fn();
          opts = r && r.options ? r.options : [];
          depth++;
        }
        sim.close(m); answered++;
        if (verbose) console.log(fmtTime(sim.t).hm, m.fromName, '|', m.text.slice(0, 110));
      }
    }
    // «хороший» бот: шлёт патроны, возвращает резерв, закрывает штаб при угрозе
    if (seedMode === 'good' && i % 60 === 0) {
      for (const p of Object.values(sim.platoons)) if (p.ammo < 2 && p.where.type === 'sector' && sim.depot.ammo > 1) sim.sendAmmo(p, 1);
      if (sim.hq.pushOp && !sim.reservePlatoons().length) {
        const sup = Object.values(sim.platoons).find((p) => p.where.type === 'sector' && p.where.role === 'support');
        if (sup) sim.issueOrder(sup, { task: 'returnRes', loc: 'hq' });
      }
      if (!sim.airdrop || sim.airdrop.done) sim.airdrop = { t: sim.t + 300, done: false };
      if (!sim.eng.task) {
        const tasks = sim.engTasks().filter((t) => t.type === 'fort' && t.sector !== 'W').sort((a, b) => sim.sectors[a.sector].fort - sim.sectors[b.sector].fort);
        if (tasks[0] && sim.depot.mat >= tasks[0].mat) sim.engAssign(tasks[0]);
      }
      if (sim.hq.pushOp) for (const p of sim.reservePlatoons()) if (p.where.loc !== 'hq') sim.issueOrder(p, { task: 'moveRes', loc: 'hq' });
      const lost = Object.values(sim.sectors).find((x) => x.held === 'lost');
      if (lost && !sim.hq.pushOp) {
        const r = sim.reservePlatoons().find((p) => p.men > 15);
        if (r && lost.enemyHold < r.men * 2.5) sim.issueOrder(r, { task: 'counterSector', sector: lost.id });
      }
    }
  }
  return { over: sim.over, t: fmtTime(sim.t).full, stage: sim.hq.stage, killed: sim.stats.ourKilled, wounded: sim.stats.ourWounded, enemy: Math.round(sim.stats.enemyKilled), men: Object.values(sim.platoons).map((p) => p.men).join('/'),
    lost: Object.values(sim.sectors).filter((s) => s.held === 'lost').map((s) => s.id).join(''), answered, missed: sim.stats.callsMissed, hist: sim.enemy.history.length, sim };
}

const res = [];
for (let r = 0; r < runs; r++) {
  try { res.push(play(mode)); }
  catch (e) { console.error('CRASH', e); process.exit(1); }
}
const wins = res.filter((r) => r.over === 'victory').length;
console.log(`mode=${mode} runs=${runs} victories=${wins}`);
for (const r of res.slice(0, 8)) console.log(r.over, r.t, 'stage', r.stage, 'KIA', r.killed, 'WIA', r.wounded, 'enemy', r.enemy, 'men', r.men, 'lost', r.lost || '-', 'msgs', r.answered, 'missed', r.missed);
if (verbose) for (const h of res[0].sim.enemy.history) console.log('  ', fmtTime(h.t).full, h.text);
