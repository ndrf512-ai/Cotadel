// «Цитадель» — точка входа: рендер, игрок, время, связь мира и симуляции.
import * as THREE from 'three';
import { G, Lights } from './engine/ps1.js';
import { makeTextures } from './engine/textures.js';
import { Audio } from './engine/audio.js';
import { Input } from './engine/input.js';
import { buildHQ } from './world/hq.js';
import { Life } from './world/life.js';
import { drawMap, drawWallMap } from './world/mapdraw.js';
import { Sim } from './sim/sim.js';
import { Director } from './sim/director.js';
import { UI } from './ui/ui.js';
import { Menus } from './ui/menus.js';
import { fmtTime } from './sim/data.js';

const BASE_RATE = 0.5;      // игровых минут в секунду (1 мин = 2 с)
const PAPER_RATE = 0.15;    // пока читаете бумагу, время почти стоит
const FF_RATE = 10;
const SLEEP_RATE = 24;

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'low-power' });
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.setClearColor(0x050505);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(68, 4 / 3, 0.05, 140);

function resize() {
  const aspect = innerWidth / innerHeight;
  const h = 240, w = Math.round(h * aspect);
  renderer.setSize(w, h, false);
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  G.uSnap.value.set(w * 0.6, h * 0.6);
}
addEventListener('resize', resize);
resize();

const tex = makeTextures();
const lights = new Lights();
const audio = new Audio();
const input = new Input(canvas);
const ui = new UI(audio);
const W = buildHQ(scene, tex, lights);
const life = new Life(scene, tex, W, lights, audio);
drawWallMap(W.refs.wallMapC); W.refs.wallMapTex.needsUpdate = true;

const game = {
  sim: null, director: null, ui, audio, world: { handset: (v) => { handsetUp = v; } },
  ff: null, paused: false, started: false, outside: false,
  fastForward(min) { this.ff = { until: this.sim.t + min }; },
  sleep(h) { this.sim.sleep(h); },
  goOut(min, cb) {
    this.outside = true; ui.fade(true);
    setTimeout(() => { this.sim.update(min); ui.fade(false); this.director.tick(); ui.open({ ...cb(), onClose: () => this.comeBackIfOut(min) }); }, 650);
  },
  comeBack(min) {
    this.outside = false; ui.fade(true);
    setTimeout(() => {
      this.sim.update(min); this.director.tick();
      player.set(-2.2, 1.62, 1.8); yaw = -Math.PI / 2; pitch = 0;
      ui.fade(false); audio.door();
    }, 650);
  },
  comeBackIfOut(min) { if (this.outside) this.comeBack(min); },
};
const menus = new Menus(game);
let handsetUp = false;

// ----- игрок -----
const player = new THREE.Vector3(0, 1.62, -0.6);
let yaw = 0, pitch = -0.15, bob = 0, stepAcc = 0, zoom = 0;
const R = 0.22;
function walkable(x, z) {
  const inWalk = W.walk.some(([x0, x1, z0, z1]) => x >= x0 + R * 0.4 && x <= x1 - R * 0.4 && z >= z0 + R * 0.4 && z <= z1 - R * 0.4);
  if (!inWalk) return false;
  return !W.solids.some(([x0, x1, z0, z1]) => x > x0 - R && x < x1 + R && z > z0 - R && z < z1 + R);
}

const ray = new THREE.Raycaster();
ray.far = 2.3;
let hover = null;

function pickInteract() {
  ray.setFromCamera({ x: 0, y: 0 }, camera);
  const objs = [...W.interact, ...life.interactables()];
  const hits = ray.intersectObjects(objs, true);
  for (const h of hits) {
    let o = h.object;
    while (o && !o.userData.interact) o = o.parent;
    if (o && o.userData.interact) return o.userData.interact;
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
    case 'map': page = menus.map(); break;
    case 'journal': page = menus.journal(); break;
    case 'folder': page = menus.folder(); break;
    case 'ledger': page = menus.ledger(); break;
    case 'files': page = menus.files(); break;
    case 'safe': page = menus.safe(); break;
    case 'clock': page = menus.clock(); break;
    case 'cot': page = menus.cot(); break;
    case 'door': page = menus.door(); break;
    case 'olya': page = menus.olya(); break;
    case 'gusev': page = menus.gusev(); break;
    case 'wounded': page = menus.wounded(); break;
    case 'embrasure': zoom = zoom ? 0 : 1; return;
    case 'visitor': {
      const m = sim.inbox.find((x) => x.id === it.msg);
      if (m) page = menus.msgPage(m);
      break;
    }
  }
  if (!page) return;
  openPage(page);
}

function openPage(page) {
  input.release();
  const prev = page.onClose;
  ui.open({ ...page, onClose: () => { prev && prev(); handsetUp = false; if (!input.touch && game.started && !game.paused) canvas.requestPointerLock?.(); } });
}

// ----- пауза -----
const pauseEl = document.getElementById('pause');
const pauseSheet = document.getElementById('pausesheet');
function setPause(on) {
  game.paused = on;
  pauseEl.classList.toggle('on', on);
  if (on) {
    input.release();
    audio.suspend();
    const s = game.sim;
    pauseSheet.innerHTML = `<div class="hdr"><span>Пауза</span><span>${s ? s.time.full : ''}</span></div>
      <div class="txt">Вы — командир гарнизона. Подходите к предметам и людям: <b>телефон</b> и <b>рация</b> — связь; <b>карта</b> — только доложенное; <b>журнал</b>, <b>папка донесений</b>, <b>ведомость</b>, <b>личные дела</b> — бумаги; <b>часы</b> — ждать; <b>койка</b> — спать; <b>дверь</b> — выйти к людям.\n\nКомандиры действуют сами. Ваше дело — решать, доверять и отвечать за последствия. Продержитесь до деблокады.</div>
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
window.__appBack = () => {
  if (!game.started) return;
  if (ui.isOpen) ui.close();
  else setPause(!game.paused);
};
document.addEventListener('visibilitychange', () => { if (document.hidden) window.__appPause(); });

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
  ended = true;
  input.release();
  audio.ringStop();
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
    // время
    let rate = BASE_RATE;
    if (ui.isOpen) rate = PAPER_RATE;
    if (game.ff && !ui.isOpen) {
      rate = FF_RATE;
      if (sim.t >= game.ff.until || sim.ringing() || sim.pending('radio').length || sim.pending('adj').length || sim.pending('visit').length || sim.pending('courier').length) game.ff = null;
    }
    if (sim.captain.asleep) {
      rate = SLEEP_RATE;
      const urgent = sim.inbox.find((m) => m.urgent && sim.t >= m.arrive) || sim.pending('visit').length || sim.hq.stage >= 3;
      if (urgent) sim.wake('Гусев трясёт вас за плечо: «Капитан! Капитан, проснитесь!»');
    }
    if (!game.outside) { sim.update(rate * dt); game.director.tick(); }
    if (sim.captain.asleep !== wasAsleep) { wasAsleep = sim.captain.asleep; ui.fade(wasAsleep); }
    if (sim.over) { showEnd(); }

    // звонок
    const ring = sim.ringing();
    if (ring && !ui.isOpen && !sim.captain.asleep) { if (!ringing) { audio.ringStart(); ringing = true; } }
    else if (ringing) { audio.ringStop(); ringing = false; }
    radioTimer -= dt;
    if (sim.pending('radio').length && radioTimer <= 0) { audio.radio(0.5); radioTimer = 3.5; }
    const adj = sim.pending('adj')[0];
    if (adj && adj !== lastAdj) { lastAdj = adj; sim.say('Капитан, разрешите доложить…', 'Гусев', 4); }

    // управление
    if (!ui.isOpen) {
      input.enabled = true;
      const l = input.consumeLook();
      yaw -= l.x; pitch = Math.max(-1.3, Math.min(1.2, pitch - l.y));
      const a = input.axes();
      if (Math.abs(a.x) + Math.abs(a.y) > 0.05) zoom = 0;
      const sp = 1.7 * dt;
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      const rx = Math.cos(yaw), rz = -Math.sin(yaw);
      const mx = (fx * -a.y + rx * a.x) * sp, mz = (fz * -a.y + rz * a.x) * sp;
      if (walkable(player.x + mx, player.z)) player.x += mx;
      if (walkable(player.x, player.z + mz)) player.z += mz;
      const moving = Math.hypot(mx, mz) > 0.0005;
      if (moving) { bob += dt * 9; stepAcc += Math.hypot(mx, mz); if (stepAcc > 0.7) { stepAcc = 0; audio.step(); } }
      hover = pickInteract();
      const label = hover ? hover.label + (hover.id === 'phone' && ring ? ' — звонит!' : hover.id === 'radio' && sim.pending('radio').length ? ' — вызов!' : '') : '';
      ui.prompt(label, !!hover);
      input.setTouchHot(!!hover);
      if (input.consumeAct()) act(hover);
    } else {
      input.enabled = false;
      input.consumeLook(); input.consumeAct();
      ui.prompt('', false);
    }

    life.update(dt, time, sim, camera);
    ui.subs(sim.subtitle);
    // усталость капитана — экран «плывёт»
    G.uWarp.value = Math.max(0, (sim.captain.fatigue - 70) / 30);
    mapTimer -= dt;
    if (mapTimer <= 0) { mapTimer = 1.5; drawMap(W.refs.mapCanvas, sim, false); W.refs.mapTex.needsUpdate = true; }
  } else if (sim && !game.paused) {
    life.update(dt, time, sim, camera);
  }

  // камера
  if (zoom) {
    camera.position.lerp(new THREE.Vector3(1.1, 1.5, -3.75), Math.min(1, dt * 5));
    camera.fov += (38 - camera.fov) * Math.min(1, dt * 5);
    camera.rotation.set(0, 0, 0, 'YXZ');
    camera.rotation.y = Math.max(-0.5, Math.min(0.5, yaw)); camera.rotation.x = Math.max(-0.2, Math.min(0.15, pitch));
  } else {
    camera.fov += (68 - camera.fov) * Math.min(1, dt * 5);
    const bobY = Math.sin(bob) * 0.025;
    const sh = life.shake;
    camera.position.set(player.x + (Math.random() - 0.5) * sh, player.y + bobY + (Math.random() - 0.5) * sh, player.z + (Math.random() - 0.5) * sh);
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
  }
  camera.updateProjectionMatrix();
  lights.sync(time);
  renderer.render(scene, camera);
}

// Отладочный доступ (для автотестов)
window.__dbg = { game, act, menus, openPage, player, setYaw: (y, p) => { yaw = y; pitch = p; } };

// Фоновый вид за титульным экраном
camera.position.copy(player);
frame();
