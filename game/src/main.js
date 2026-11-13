// «Цитадель» 1.0.1 — точка входа: мир, игрок, время, связь мира и симуляции.
import * as THREE from 'three';
import { G, Lights } from './engine/ps1.js';
import { makeTextures } from './engine/textures.js';
import { Audio } from './engine/audio.js';
import { Input } from './engine/input.js';
import { buildHQ } from './world/hq.js';
import { buildTerritory } from './world/territory.js';
import { Life } from './world/life.js';
import { Battle } from './world/battle.js';
import { Army } from './world/army.js';
import { drawMap, drawWallMap } from './world/mapdraw.js';
import { floorAt, zoneAt, BOUND_R, baseGround as terrainTop, carve, SPOTS } from './world/layout.js';
import { Sim } from './sim/sim.js';
import { Director } from './sim/director.js';
import { UI } from './ui/ui.js';
import { Menus } from './ui/menus.js';
import { Command } from './ui/command.js';
import { changelogHtml, VERSION, UPDATE } from './ui/changelog.js';
import { saveGame, loadGame, hasSave, clearSave } from './sim/save.js';
import { SECTORS, fmtTime } from './sim/data.js';

const BASE_RATE = 0.5;      // игровых минут в секунду (1 мин = 2 с)
const PAPER_RATE = 0.15;    // пока читаете бумагу, время почти стоит
const FF_RATE = 10;
const SLEEP_RATE = 24;
const EYE = 1.62;

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.setClearColor(0x050505);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, 4 / 3, 0.1, 170);

function resize() {
  const aspect = innerWidth / innerHeight;
  const h = 270, w = Math.round(h * aspect);
  renderer.setSize(w, h, false);
  camera.aspect = aspect; camera.updateProjectionMatrix();
  G.uSnap.value.set(w, h);
}
addEventListener('resize', resize);
resize();

const tex = makeTextures();
const lights = new Lights();
const audio = new Audio();
const input = new Input(canvas);
const ui = new UI(audio);
const W = buildHQ(scene, tex, lights);
const T = buildTerritory(scene, tex, lights, W);
const life = new Life(scene, W, T, lights, audio);
const battle = new Battle(scene, audio, life);
const army = new Army(life, battle, T, audio);
life.army = army; battle.army = army; life.officerNpc = army.officerNpc;
drawWallMap(W.refs.wallMapC); W.refs.wallMapTex.needsUpdate = true;
const solids = [...W.solids, ...T.solids];
// точка появления — гарантированно свободная: ищем ближайшее место без предметов
(() => {
  const sp = W.refs.spots.start;
  const free = (x, z) => !solids.some(([x0, x1, z0, z1]) => x > x0 - 0.35 && x < x1 + 0.35 && z > z0 - 0.35 && z < z1 + 0.35);
  if (free(sp.x, sp.z)) return;
  for (let r = 0.2; r < 3; r += 0.2) for (let a = 0; a < 6.28; a += 0.4) { const x = sp.x + Math.cos(a) * r, z = sp.z + Math.sin(a) * r; if (free(x, z)) { sp.x = x; sp.z = z; return; } }
})();
const interactables = [...W.interact, ...T.interact];

const game = {
  sim: null, director: null, ui, audio, world: { handset: () => {}, officerPos: (id) => { const n = life.officerNpc[id]; return n && n.root.visible ? n.root.position : null; } },
  ff: null, paused: false, started: false,
  fastForward(min) { this.ff = { until: this.sim.t + min }; },
  sleep(h) { this.sim.sleep(h); },
};
const menus = new Menus(game);
const command = new Command(menus, game);
menus.command = command; game.army = army;

// ----- игрок -----
const player = new THREE.Vector3(W.refs.spots.start.x, EYE, W.refs.spots.start.z);
game.player = player;
let yaw = Math.PI / 2, pitch = -0.1, bob = 0, stepAcc = 0, zoom = 0, eyeY = EYE, zone = 'hq', lastObserve = {};
const R = 0.28;

function blockedBySolid(x, z) {
  for (const [x0, x1, z0, z1] of solids) if (x > x0 - R && x < x1 + R && z > z0 - R && z < z1 + R) return true;
  return false;
}
let blockMsgT = 0;
function canStep(fx, fz, tx, tz) {
  if (Math.hypot(tx, tz) > BOUND_R) { hint('Дальше — проволока и ничейная земля.'); return false; }
  // если игрок всё же оказался внутри предмета — дать выйти (не держать на месте)
  if (blockedBySolid(tx, tz) && !blockedBySolid(fx, fz)) return false;
  const zn = zoneAt(tx, tz);
  if (game.sim && SECTORS[zn] && Math.hypot(tx, tz) > 44 && game.sim.sectors[zn].held === 'lost') { hint('Там противник. Туда нельзя.'); return false; }
  // крутизна: смотрим на 0,35 м вперёд
  const dx = tx - fx, dz = tz - fz, l = Math.hypot(dx, dz) || 1;
  const here = floorAt(fx, fz);
  const ahead = floorAt(fx + dx / l * 0.35, fz + dz / l * 0.35);
  if (ahead - here > 0.42) return false;
  return true;
}
function hint(t) { if (performance.now() > blockMsgT && game.sim) { blockMsgT = performance.now() + 3000; game.sim.say(t, null, 2.5); } }

const ray = new THREE.Raycaster(); ray.far = 2.6;
let hover = null;
function pickInteract() {
  ray.setFromCamera({ x: 0, y: 0 }, camera);
  const hits = ray.intersectObjects([...interactables, ...life.interactables()], true);
  for (const h of hits) {
    let o = h.object;
    while (o && !o.userData.interact) o = o.parent;
    if (o && o.userData.interact) return o.userData.interact;
    if (h.object.material && !h.object.material.transparent) break;
  }
  return null;
}

function act(it) {
  if (!it) return;
  const sim = game.sim;
  let page = null;
  switch (it.id) {
    case 'phone': page = menus.phone(); audio.ringStop(); break;
    case 'radio': page = menus.radio(); audio.radio(0.4); break;
    case 'map': page = menus.pocketMap(mapPlayer()); break;
    case 'journal': page = menus.journal(); break;
    case 'folder': page = menus.folder(); break;
    case 'ledger': page = menus.ledger(); break;
    case 'files': page = menus.files(); break;
    case 'safe': page = menus.safe(); break;
    case 'clock': page = menus.clock(); break;
    case 'cot': page = menus.cot(); break;
    case 'wounded': page = menus.wounded(); break;
    case 'embrasure': zoom = zoom ? 0 : 1; return;
    case 'staff': page = menus.staffNpc(it.who); break;
    case 'officer': page = menus.officerField(sim.officers[it.oid]); break;
    case 'soldier': page = menus.soldier(it); break;
    case 'fieldphone': page = menus.fieldPhone(); break;
    case 'personnel': page = command.page(); break;
    case 'meeting': page = command.meeting(); break;
    case 'gramophone': { const on = audio.gramophone(); sim.say(on ? 'Патефон зашипел, потом заиграл вальс. В штабе стало тише.' : 'Вы снимаете иглу с пластинки.', null, 4); if (on) sim.captain.fatigue = Math.max(0, sim.captain.fatigue - 3); return; }
    case 'photo': page = menus.photo(); break;
    case 'books': page = menus.books(); break;
    case 'samovar': page = menus.samovar(); break;
    case 'depotStock': page = menus.depotStock(); break;
    case 'medcab': page = menus.medcab(); break;
    case 'binoculars': page = menus.binoculars(); break;
    case 'enemy': sim.say('Противник. Не высовывайтесь, капитан!', null, 3); return;
    case 'visitor': case 'runner': {
      const m = sim.inbox.find((x) => x.id === it.msg);
      if (m) page = menus.msgPage(m, it.id === 'runner' ? 'Посыльный' : undefined);
      break;
    }
  }
  if (page) openPage(page);
}

function mapPlayer() { return { x: player.x, z: player.z, yaw }; }

function openPage(page) {
  input.release();
  const prev = page.onClose;
  ui.open({ ...page, onClose: () => { prev && prev(); if (!input.touch && game.started && !game.paused) canvas.requestPointerLock?.(); } });
}

// ----- пауза -----
const pauseEl = document.getElementById('pause');
const pauseSheet = document.getElementById('pausesheet');
function setPause(on) {
  game.paused = on;
  pauseEl.classList.toggle('on', on);
  if (on) {
    input.release(); audio.suspend();
    const s = game.sim;
    if (s && !s.over) saveGame(s, game.director, { x: player.x, z: player.z, yaw });
    pauseSheet.innerHTML = `<div class="hdr"><span>Пауза · ${VERSION}</span><span>${s ? s.time.full : ''}</span></div>
      <div class="txt">Вы — командир гарнизона. Вы ставите задачи обороне — Орлов передаёт их командирам участков, те — сержантам, сержанты — бойцам.\n\n<b>Командование</b> (Tab / P, кнопка «КОМАНДОВАНИЕ»): обстановка и приказы. Доступно в штабе, в командирском блиндаже, по полевому телефону в любом блиндаже и рядом с командиром.\n<b>Позиции</b>: обходите траншеи, говорите с командирами и бойцами, смотрите сами.\n<b>Планшет</b>: M или «КАРТА».\n\nВойна идёт и без вас: наблюдатели докладывают сержантам, сержанты — взводным, взводные — в штаб. Срочное принесёт посыльный.\nИгра сохраняется сама.</div>
      <div class="opts"><button id="pz-go">Продолжить</button><button id="pz-news">Что нового в 1.3</button><button id="pz-new" class="back">Новая игра</button></div>`;
    pauseSheet.querySelector('#pz-go').onclick = () => setPause(false);
    pauseSheet.querySelector('#pz-news').onclick = () => { pauseSheet.querySelector('.txt').innerHTML = changelogHtml(); pauseSheet.scrollTop = 0; };
    pauseSheet.querySelector('#pz-new').onclick = () => { if (pauseSheet.dataset.sure) { clearSave(); location.reload(); } else { pauseSheet.dataset.sure = 1; pauseSheet.querySelector('#pz-new').textContent = 'Точно? Партия будет потеряна'; } };
    delete pauseSheet.dataset.sure;
  } else {
    audio.resume();
    if (!input.touch && !ui.isOpen) canvas.requestPointerLock?.();
  }
}
window.__appPause = () => { if (game.started && !game.paused && !game.sim?.over) setPause(true); };
window.__appResume = () => {};
window.__appBack = () => { if (!game.started) return; if (ui.isOpen) ui.close(); else setPause(!game.paused); };
document.addEventListener('visibilitychange', () => { if (document.hidden) { if (game.started && game.sim && !game.sim.over) saveGame(game.sim, game.director, { x: player.x, z: player.z, yaw }); window.__appPause(); } });
addEventListener('pagehide', () => { if (game.started && game.sim && !game.sim.over) saveGame(game.sim, game.director, { x: player.x, z: player.z, yaw }); });
let mapKey = false, staffKey = false, replyKey = false;
addEventListener('keydown', (e) => { if (e.code === 'KeyM') mapKey = true; if (e.code === 'KeyP' || e.code === 'Tab') { staffKey = true; e.preventDefault(); } if (e.code === 'KeyT') replyKey = true; });
document.getElementById('replybtn')?.addEventListener('touchstart', (e) => { replyKey = true; e.preventDefault(); e.stopPropagation(); });
document.getElementById('staffbtn')?.addEventListener('touchstart', (e) => { staffKey = true; e.preventDefault(); e.stopPropagation(); });
document.getElementById('mapbtn')?.addEventListener('touchstart', (e) => { mapKey = true; e.preventDefault(); e.stopPropagation(); });

// ----- старт -----
function beginGame(loaded) {
  audio.start(); audio.resume();
  document.getElementById('title').style.display = 'none';
  if (loaded) {
    game.sim = loaded.sim; game.director = loaded.director;
    if (loaded.player) { player.x = loaded.player.x; player.z = loaded.player.z; yaw = loaded.player.yaw ?? yaw; }
    game.sim.say('Партия восстановлена. Неотвеченные запросы сняты — командиры решили их сами.', null, 5);
  } else {
    clearSave();
    game.sim = new Sim();
    game.director = new Director(game.sim);
  }
  game.started = true;
  if (!input.touch) canvas.requestPointerLock?.();
  ui.fade(true); setTimeout(() => ui.fade(false), 100);
}
document.getElementById('startbtn').addEventListener('click', () => beginGame(null));
{
  const meta = hasSave();
  const cb = document.getElementById('contbtn');
  if (meta && cb) { cb.style.display = ''; cb.textContent = `Продолжить (${fmtTime(meta.t).full})`; cb.addEventListener('click', () => { const l = loadGame(); beginGame(l); }); }
  document.getElementById('newsbtn')?.addEventListener('click', () => { const n = document.getElementById('news'); n.innerHTML = changelogHtml(); n.style.display = n.style.display === 'block' ? 'none' : 'block'; });
  const vl = document.getElementById('verline'); if (vl) vl.textContent = `${VERSION} · ${UPDATE}`;
}

// ----- конец -----
let ended = false;
function showEnd() {
  ended = true; clearSave(); input.release(); audio.ringStop();
  const sim = game.sim;
  const title = sim.over === 'victory' ? 'ДОНЕСЕНИЕ: ГАРНИЗОН УДЕРЖАЛ РУБЕЖ' : 'ДОНЕСЕНИЕ: ШТАБ ГАРНИЗОНА ПОТЕРЯН';
  ui.open({ hdr: ['Итоговый рапорт', fmtTime(sim.t).full], who: title, stamp: sim.over === 'victory' ? 'ДЕБЛОКАДА' : 'ПОТЕРЯН', text: sim.report_summary(),
    options: [{ label: 'Начать заново', fn: () => { location.reload(); return { keep: true }; } }] });
}

// ----- цикл -----
const clock = new THREE.Clock();
let saveTimer = 60, mapTimer = 0, ringing = false, radioTimer = 0, lastAdj = null, time = 0, wasAsleep = false, lastPend = 0;
const pendEl = document.getElementById('pend');

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
  time += dt;
  G.uTime.value = time;
  const sim = game.sim;

  if (game.started && !game.paused && sim && !ended) {
    if (input.consumeMenu()) { if (ui.isOpen) ui.close(); else setPause(true); }
    if (mapKey) { mapKey = false; if (ui.isOpen && ui.page && ui.page.hdr && ui.page.hdr[0] === 'Планшет') ui.close(); else if (!ui.isOpen) openPage(menus.pocketMap(mapPlayer())); }
    // командование: из штаба, командирского блиндажа, любого блиндажа (полевой телефон) или рядом с командиром
    const nPend = sim.staff.pendingDecisions().length;
    const nearOff = Object.values(life.officerNpc).some((n) => n.root.visible && Math.hypot(n.root.position.x - player.x, n.root.position.z - player.z) < 4);
    const canAnswer = zone === 'hq' || zone.startsWith('dug') || nearOff;
    if (staffKey || replyKey) { staffKey = replyKey = false; if (ui.isOpen && ui.page && ui.page.hdr && ui.page.hdr[0] === 'Командование') ui.close(); else if (!ui.isOpen) { if (canAnswer) openPage(command.page()); else sim.say('Командовать можно из штаба, из командирского блиндажа, по полевому телефону в любом блиндаже или лично через командира. Срочное принесёт посыльный.', null, 5); } }
    pendEl.textContent = nPend ? `☎ ${nPend}${canAnswer ? ' — Tab' : ''}` : '';
    if (nPend > lastPend && zone === 'hq') { const m = sim.staff.pendingDecisions().slice(-1)[0]; if (m) sim.say(`${m.fromName} — ждёт решения. Командование — Tab.`, 'Мирон', 4); }
    lastPend = nPend;
    // время
    let rate = BASE_RATE;
    if (ui.isOpen) rate = PAPER_RATE;
    if (game.ff && !ui.isOpen) {
      rate = FF_RATE;
      if (sim.t >= game.ff.until || sim.ringing() || sim.staff.pendingDecisions().length > (game.ff.pend ?? (game.ff.pend = sim.staff.pendingDecisions().length)) || sim.pending('visit').length || sim.pending('courier').length || sim.pending('adj').length) game.ff = null;
    }
    if (sim.captain.asleep) {
      rate = SLEEP_RATE;
      const urgent = sim.inbox.find((m) => m.urgent && sim.t >= m.arrive && m.route === 'player') || sim.hq.stage >= 3;
      if (urgent) sim.wake('Гусев трясёт вас за плечо: «Капитан! Капитан, проснитесь!»');
    }
    sim.update(rate * dt); game.director.tick();
    saveTimer -= dt; if (saveTimer <= 0 && !ui.isOpen) { saveTimer = 60; saveGame(sim, game.director, { x: player.x, z: player.z, yaw }); }
    if (sim.captain.asleep !== wasAsleep) { wasAsleep = sim.captain.asleep; ui.fade(wasAsleep); }
    if (sim.over) showEnd();

    // где капитан
    const z = zoneAt(player.x, player.z);
    sim.player.x = player.x; sim.player.z = player.z;
    if (z !== zone) {
      const prev = zone; zone = z; sim.player.zone = z;
      if (z === 'hq' && prev !== 'hq') sim.staff.onEnterHQ();
      if (prev === 'hq' && z !== 'hq') audio.door();
    }
    if (SECTORS[z] && Math.hypot(player.x, player.z) > 47 && floorAt(player.x, player.z) > terrainTop(player.x, player.z) - 0.6) hint(sim.night > 0.5 ? 'Капитан, пригнитесь — ракета повиснет, срежут.' : 'Капитан, не ходите поверху — снайпер!');
    if (SECTORS[z] && sim.t - (lastObserve[z] || -99) > 10) { lastObserve[z] = sim.t; if (Math.hypot(player.x, player.z) > 40) sim.observe(z); }

    // звонок слышен только в штабе
    const ring = z === 'hq' ? sim.ringing() : null;
    if (ring && !ui.isOpen && !sim.captain.asleep) { if (!ringing) { audio.ringStart(); ringing = true; } }
    else if (ringing) { audio.ringStop(); ringing = false; }
    radioTimer -= dt;
    if (z === 'hq' && sim.pending('radio').length && radioTimer <= 0) { audio.radio(0.5); radioTimer = 3.5; }
    const adj = sim.pending('adj')[0];
    if (adj && adj !== lastAdj && z === 'hq') { lastAdj = adj; sim.say('Капитан, разрешите доложить…', 'Гусев', 4); }
    // посыльный добежал
    if (life.arrivedRunner && !ui.isOpen) { const m = life.arrivedRunner; life.arrivedRunner = null; if (sim.inbox.includes(m)) openPage(menus.msgPage(m, 'Посыльный')); }

    // управление
    if (!ui.isOpen) {
      input.enabled = true;
      const l = input.consumeLook();
      yaw -= l.x; pitch = Math.max(-1.3, Math.min(1.2, pitch - l.y));
      const a = input.axes();
      if (Math.abs(a.x) + Math.abs(a.y) > 0.05) zoom = 0;
      const run = input.keys.has('ShiftLeft') || input.keys.has('ShiftRight') || Math.hypot(a.x, a.y) > 0.95 && input.touch;
      const sp = (run ? 3.4 : 1.8) * dt;
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
      const mx = (fx * -a.y + rx * a.x) * sp, mz = (fz * -a.y + rz * a.x) * sp;
      if (mx && canStep(player.x, player.z, player.x + mx, player.z)) player.x += mx;
      if (mz && canStep(player.x, player.z, player.x, player.z + mz)) player.z += mz;
      const moving = Math.hypot(mx, mz) > 0.0005;
      if (moving) { bob += dt * (run ? 13 : 9); stepAcc += Math.hypot(mx, mz); if (stepAcc > (run ? 1.0 : 0.7)) { stepAcc = 0; audio.stepOn(surfaceAt(player.x, player.z), run); } }
      hover = pickInteract();
      let label = hover ? hover.label : '';
      if (hover && hover.id === 'phone' && ring) label += ' — звонит!';
      if (hover && hover.id === 'radio' && sim.pending('radio').length) label += ' — вызов!';
      ui.prompt(label, !!hover);
      input.setTouchHot(!!hover);
      if (input.consumeAct()) act(hover);
    } else {
      input.enabled = false; input.consumeLook(); input.consumeAct(); ui.prompt('', false);
    }
    const fl = floorAt(player.x, player.z);
    eyeY += (fl + EYE - eyeY) * Math.min(1, dt * 12);
    player.y = eyeY;

    life.update(dt, time, sim, player);
    army.update(dt, time, sim, player);
    battle.update(dt, time, sim, player);
    // звуковая обстановка по месту
    const inside = zone === 'hq' || zone.startsWith('dug');
    let nearPpl = 99;
    for (const q of life.people) { if (!q.root.visible) continue; const d = Math.hypot(q.root.position.x - player.x, q.root.position.z - player.z); if (d < nearPpl) nearPpl = d; }
    const gen = T.dynamic.generator;
    audio.ambience(dt, { inside, night: sim.night, genDist: Math.hypot(gen.x - player.x, gen.z - player.z), voices: zone === 'hq' ? 0.7 : nearPpl < 7 ? 0.35 : 0, voiceDist: zone === 'hq' ? 0.4 : Math.min(0.9, nearPpl / 8), typing: zone === 'hq' && life.clerk.typing, morse: zone === 'hq' });
    ui.subs(sim.subtitle);
    G.uWarp.value = Math.max(0, (sim.captain.fatigue - 70) / 30);
    mapTimer -= dt;
    if (mapTimer <= 0) { mapTimer = 1.5; drawMap(W.refs.mapCanvas, sim, false); W.refs.mapTex.needsUpdate = true; }
  }

  // камера
  if (zoom) {
    camera.position.lerp(new THREE.Vector3(0.8, 1.5, -4.7), Math.min(1, dt * 5));
    camera.fov += (38 - camera.fov) * Math.min(1, dt * 5);
    camera.rotation.set(Math.max(-0.2, Math.min(0.15, pitch)), Math.max(-0.5, Math.min(0.5, yaw)), 0, 'YXZ');
  } else {
    camera.fov += (72 - camera.fov) * Math.min(1, dt * 5);
    const sh = life.shake;
    camera.position.set(player.x + (Math.random() - 0.5) * sh, player.y + Math.sin(bob) * 0.025 + (Math.random() - 0.5) * sh, player.z + (Math.random() - 0.5) * sh);
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
  }
  camera.updateProjectionMatrix();
  lights.sync(time, camera.position);
  renderer.render(scene, camera);
}

function surfaceAt(x, z) {
  if (zone === 'hq' || zone.startsWith('dug')) return 'wood';
  if (carve(x, z) > 0.5) return 'wood';
  if (x < -38) return 'mud';
  return 'earth';
}

// Отладочный доступ (для автотестов)
window.__dbg = { battle, army, renderer, game, act, menus, openPage, player, life, setYaw: (y, p) => { yaw = y; pitch = p; } };

camera.position.copy(player);
frame();
