// Сохранение партии: состояние симуляции целиком (граф объектов с общими ссылками),
// без замыканий (варианты ответов в сообщениях) и без чисто визуальных очередей.
import { Sim } from './sim.js';
import { Director } from './director.js';

const KEY = 'citadel.save.v13';
const VERSION = 13;
const SKIP = new Set(['sim', 'inbox', 'fx', 'subtitle', 'events']);

function encode(root) {
  const ids = new Map();
  let n = 0;
  const enc = (v) => {
    if (typeof v === 'function') return undefined;
    if (v === null || typeof v !== 'object') return typeof v === 'number' && !Number.isFinite(v) ? { $num: String(v) } : v;
    if (v instanceof Set) return { $set: [...v].map(enc) };
    if (ids.has(v)) return { $ref: ids.get(v) };
    const id = ++n; ids.set(v, id);
    if (Array.isArray(v)) return { $id: id, $arr: v.map((x) => { const e = enc(x); return e === undefined ? null : e; }) };
    const o = { $id: id };
    for (const k of Object.keys(v)) {
      if (SKIP.has(k)) continue;
      const e = enc(v[k]);
      if (e !== undefined) o[k] = e;
    }
    return o;
  };
  return enc(root);
}

function decode(data) {
  const objs = new Map();
  const dec = (v) => {
    if (v === null || typeof v !== 'object') return v;
    if (v.$num !== undefined) return Number(v.$num);
    if (v.$set) return new Set(v.$set.map(dec));
    if (v.$ref !== undefined) return objs.get(v.$ref);
    if (v.$arr) { const a = []; objs.set(v.$id, a); for (const x of v.$arr) a.push(dec(x)); return a; }
    const o = {}; objs.set(v.$id, o);
    for (const k of Object.keys(v)) if (k !== '$id') o[k] = dec(v[k]);
    return o;
  };
  return dec(data);
}

const store = () => { try { return window.localStorage; } catch (e) { return null; } };

export function hasSave() {
  const s = store();
  try { const raw = s && s.getItem(KEY); if (!raw) return null; const d = JSON.parse(raw); return d.v === VERSION ? d.meta : null; } catch (e) { return null; }
}

export function saveGame(sim, director, player) {
  const s = store();
  if (!s || !sim || sim.over) return false;
  try {
    const { enemy, staff, chain, ...rest } = sim;
    const graph = { state: rest, enemy: { ...enemy }, staff: { ...staff }, chain: { ...chain }, director: { done: director.done } };
    const d = { v: VERSION, meta: { t: sim.t, at: Date.now() }, player, data: encode(graph) };
    s.setItem(KEY, JSON.stringify(d));
    return true;
  } catch (e) { console.warn('save failed', e); return false; }
}

export function loadGame() {
  const s = store();
  if (!s) return null;
  let d;
  try { d = JSON.parse(s.getItem(KEY)); } catch (e) { return null; }
  if (!d || d.v !== VERSION) return null;
  const g = decode(d.data);
  const sim = new Sim();
  for (const k of Object.keys(g.state)) sim[k] = g.state[k];
  Object.assign(sim.enemy, g.enemy);
  Object.assign(sim.staff, g.staff);
  Object.assign(sim.chain, g.chain);
  sim.inbox = []; sim.fx = []; sim.subtitle = null; sim.chain.events = [];
  // ответы, которых ждали, сгорели вместе с бумагами — люди действуют сами
  for (const o of Object.values(sim.officers)) { o.waitingAnswer = null; o.inHQ = false; }
  const director = new Director(sim);
  director.done = g.director.done instanceof Set ? g.director.done : new Set();
  return { sim, director, player: d.player };
}

export function clearSave() { const s = store(); try { s && s.removeItem(KEY); } catch (e) { /* нет хранилища */ } }
