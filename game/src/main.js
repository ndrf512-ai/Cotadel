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
import { drawMap, drawWallMap } from './world/mapdraw.js';
import { floorAt, zoneAt, BOUND_R, baseGround as terrainTop, carve, SPOTS } from './world/layout.js';
import { Sim } from './sim/sim.js';
import { Director } from './sim/director.js';
import { UI } from './ui/ui.js';
import { Menus } from './ui/menus.js';
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
drawWallMap(W.refs.wallMapC); W.refs.wallMapTex.needsUpdate = true;
const solids = [...W.solids, ...T.solids];
const interactables = [...W.interact, ...T.interact];

const game = {
  sim: null, director: null, ui, audio, world: { handset: () => {}, officerPos: (id) => { const n = life.officerNpc[id]; return n && n.root.visible ? n.root.position : null; } },
  ff: null, paused: false, started: false,
  fastForward(min) { this.ff = { until: this.sim.t + min }; },
  sleep(h) { this.sim.sleep(h); },
};
const menus = new Menus(game);

// ----- игрок -----
const player = new THREE.Vector3(0.2, EYE, -0.6);
let yaw = 0, pitch = -0.1, bob = 0, stepAcc = 0, zoom = 0, eyeY = EYE, zone = 'hq', lastObserve = {};
const R = 0.28;

function blockedBySolid(x, z) {
  for (const [x0, x1, z0, z1] of solids) if (x > x0 - R && x < x1 + R && z > z0 - R && z < z1 + R) return true;
  return false;
}
let blockMsgT = 0;
function canStep(fx, fz, tx, tz) {
  if (Math.hypot(tx, tz) > BOUND_R) { hint('Дальше — проволока и ничейная земля.'); return false; }
  if (blockedBySolid(tx, tz)) return false;
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
    case 'personnel': page = menus.personnel(); break;
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
    pauseSheet.innerHTML = `<div class="hdr"><span>Пауза</span><span>${s ? s.time.full : ''}</span></div>
      <div class="txt">Вы — командир гарнизона и можете ходить по всей своей обороне: траншеи, блиндажи взводов, медпункт, склад, инженеры, НП.\n\n<b>В штабе</b>: начальник штаба Орлов (сводка, решения, поручения), телефон и рация, карта, бумаги, часы, койка.\n<b>На позициях</b>: говорите с командирами и бойцами, смотрите сами. В блиндажах есть полевые телефоны.\n<b>Планшет с картой</b>: клавиша M или кнопка «КАРТА».\n\nКомандиры и штаб работают без вас. Если что-то срочное — пришлют посыльного.</div>
      <div class="opts"><button id="pz-go">Продолжить</button><button id="pz-new" class="back">Начать заново</button></div>`;
    pauseSheet.querySelector('#pz-go').onclick = () => setPause(false);
    pauseSheet.querySelector('#pz-new').onclick = () => location.reload();
  } else {
    audio.resume();
    if (!input.touch && !ui.isOpen) canvas.requestPointerLock?.();
  }
}
window.__appPause = () => { if (game.started && !game.paused && !game.sim?.over) setPause(true); };
window.__appResume = () => {};
window.__appBack = () => { if (!game.started) return; if (ui.isOpen) ui.close(); else setPause(!game.paused); };
document.addEventListener('visibilitychange', () => { if (document.hidden) window.__appPause(); });
let mapKey = false, staffKey = false;
addEventListener('keydown', (e) => { if (e.code === 'KeyM') mapKey = true; if (e.code === 'KeyP') staffKey = true; });
document.getElementById('staffbtn')?.addEventListener('touchstart', (e) => { staffKey = true; e.preventDefault(); e.stopPropagation(); });
document.getElementById('mapbtn')?.addEventListener('touchstart', (e) => { mapKey = true; e.preventDefault(); e.stopPropagation(); });

// ----- старт -----
document.getElementById('startbtn').addEventListener('click', () => {
  audio.start(); audio.resume();
  document.getElementById('title').style.display = 'none';
  game.sim = new Sim();
  game.director = new Director(game.sim);
  game.started = true;
  if (!input.touch) canvas.requestPointerLock?.();
  ui.fade(true); setTimeout(() => ui.fade(false), 100);
});

// ----- конец -----
let ended = false;
function showEnd() {
  ended = true; input.release(); audio.ringStop();
  const sim = game.sim;
  const title = sim.over === 'victory' ? 'ДОНЕСЕНИЕ: ГАРНИЗОН УДЕРЖАЛ РУБЕЖ' : 'ДОНЕСЕНИЕ: ШТАБ ГАРНИЗОНА ПОТЕРЯН';
  ui.open({ hdr: ['Итоговый рапорт', fmtTime(sim.t).full], who: title, stamp: sim.over === 'victory' ? 'ДЕБЛОКАДА' : 'ПОТЕРЯН', text: sim.report_summary(),
    options: [{ label: 'Начать заново', fn: () => { location.reload(); return { keep: true }; } }] });
}

// ----- цикл -----
const clock = new THREE.Clock();
let mapTimer = 0, ringing = false, radioTimer = 0, lastAdj = null, time = 0, wasAsleep = false;

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
  time += dt;
  G.uTime.value = time;
  const sim = game.sim;

  if (game.started && !game.paused && sim && !ended) {
    if (input.consumeMenu()) { if (ui.isOpen) ui.close(); else setPause(true); }
    if (mapKey) { mapKey = false; if (ui.isOpen && ui.page && ui.page.hdr && ui.page.hdr[0] === 'Планшет') ui.close(); else if (!ui.isOpen) openPage(menus.pocketMap(mapPlayer())); }
    if (staffKey) { staffKey = false; if (!ui.isOpen) openPage(menus.personnel()); }
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
    camera.position.lerp(new THREE.Vector3(1.1, 1.5, -3.75), Math.min(1, dt * 5));
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
window.__dbg = { battle, renderer, game, act, menus, openPage, player, life, setYaw: (y, p) => { yaw = y; pitch = p; } };

camera.position.copy(player);
frame();
