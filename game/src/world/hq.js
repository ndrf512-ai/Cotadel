// Главный блиндаж: геометрия, реквизит, свет, внешний вид через амбразуру.
import * as THREE from 'three';
import { box, cyl, plane, M } from '../engine/geo.js';
import { mat } from '../engine/ps1.js';
import { toTex } from '../engine/textures.js';

const H = 2.3; // высота потолка

export function buildHQ(scene, tex, lights) {
  const W = { interact: [], solids: [], walk: [], refs: {} };
  const root = new THREE.Group(); scene.add(root);

  const mPl = M('planks', { map: tex.planks });
  const mPlV = M('planksV', { map: tex.planksV });
  const mEarth = M('earth', { map: tex.earth });
  const mDark = M('dark', { color: 0x1a1612 });
  const mWood = M('wood', { map: tex.planks, color: 0xc0a080 });
  const mLog = M('log', { map: tex.planksV, color: 0x8a7458 });
  const mMetal = M('metal', { map: tex.metal });
  const mMetalD = M('metalD', { map: tex.metalDark });
  const mCrate = M('crate', { map: tex.crate });
  const mBag = M('bag', { map: tex.sandbag });
  const mCloth = M('cloth', { map: tex.tarp });
  const mBlanket = M('blanket', { map: tex.blanket });
  const mPaper = M('paper', { map: tex.doc });

  // ---- помещения: пол, стены, потолок ----
  function room(x0, x1, z0, z1, gaps = {}) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
    box(root, w, 0.1, d, cx, -0.05, cz, mPl, { seg: 0.7 });
    box(root, w, 0.1, d, cx, H + 0.05, cz, mPlV, { seg: 0.7 });
    // балки потолка
    for (let x = x0 + 0.5; x < x1; x += 1.0) cyl(root, 0.11, 0.11, d, 5, x, H - 0.08, cz, mLog, { rx: Math.PI / 2 });
    // стены с проёмами: gaps[side] = [[a,b,yTop?]]
    const wall = (side) => {
      const horiz = side === 'n' || side === 's';
      const a0 = horiz ? x0 : z0, a1 = horiz ? x1 : z1;
      const fixed = { n: z0, s: z1, w: x0, e: x1 }[side];
      const list = (gaps[side] || []).slice().sort((p, q) => p[0] - q[0]);
      let cur = a0;
      const seg = (a, b, y0 = 0, y1 = H) => {
        if (b - a < 0.01) return;
        const m = (a + b) / 2, len = b - a, hh = y1 - y0;
        const mesh = horiz ? box(root, len, hh, 0.12, m, y0 + hh / 2, fixed, mPlV, { seg: 0.8 }) : box(root, 0.12, hh, len, fixed, y0 + hh / 2, m, mPlV, { seg: 0.8 });
        if (y0 < 0.5) W.solids.push(horiz ? [a, b, fixed - 0.08, fixed + 0.08] : [fixed - 0.08, fixed + 0.08, a, b]);
        return mesh;
      };
      for (const g of list) {
        seg(cur, g[0]);
        if (g[2] !== undefined) { seg(g[0], g[1], 0, g[2]); if (g[3] !== undefined) seg(g[0], g[1], g[3], H); } // окно: низ и верх
        else seg(g[0], g[1], 2.0, H); // дверь: перемычка
        cur = g[1];
      }
      seg(cur, a1);
      // стойки по углам
      for (const a of [a0, a1]) horiz ? cyl(root, 0.08, 0.08, H, 5, a, H / 2, fixed, mLog) : cyl(root, 0.08, 0.08, H, 5, fixed, H / 2, a, mLog);
    };
    for (const s of ['n', 's', 'w', 'e']) if (gaps[s] !== null) wall(s);
  }

  // Комната командира
  room(-3, 3, -4, 0, { n: [[0.6, 1.6, 1.35, 1.65]], e: [[-2.8, -1.6]], s: [[-0.7, 0.7]] });
  // Узел связи
  room(3, 6, -4, -1, { w: null, s: [] });
  // стена между КП и связью уже есть (e). Узел связи: своя западная стена не нужна.
  // Предбанник
  room(-3, 3, 0, 3, { n: null, w: [[1.2, 2.4]] });


  // ---- стол с картой ----
  const table = new THREE.Group(); table.position.set(0, 0, -2); root.add(table);
  box(table, 1.7, 0.08, 1.1, 0, 0.84, 0, mWood);
  for (const [x, z] of [[-0.75, -0.45], [0.75, -0.45], [-0.75, 0.45], [0.75, 0.45]]) box(table, 0.08, 0.84, 0.08, x, 0.42, z, mLog);
  const mapCanvas = document.createElement('canvas'); mapCanvas.width = 256; mapCanvas.height = 192;
  const mapTex = toTex(mapCanvas, false);
  const mapMesh = plane(table, 1.4, 1.05, 0, 0.885, 0, mat({ map: mapTex }), { rx: -Math.PI / 2, sx: 4, sy: 3 });
  W.refs.mapCanvas = mapCanvas; W.refs.mapTex = mapTex;
  W.solids.push([-0.9, 0.9, -2.6, -1.4]);
  addI(W, mapMesh, 'map', 'Карта обстановки');
  // телефон
  const phone = new THREE.Group(); phone.position.set(0.62, 0.88, -1.62); root.add(phone);
  box(phone, 0.26, 0.16, 0.2, 0, 0.08, 0, M('phoneBox', { map: tex.radio, color: 0x8a8a70 }));
  const handset = box(phone, 0.24, 0.05, 0.06, 0, 0.19, 0.02, mMetalD);
  const phoneLamp = box(phone, 0.04, 0.04, 0.02, 0.09, 0.11, 0.105, mat({ color: 0x220000, emissive: 0x000000 }));
  W.refs.phoneLamp = phoneLamp; W.refs.handset = handset;
  addI(W, phone, 'phone', 'Телефон', 0.25);
  // журнал, папка донесений, лампа, кружка
  const journal = box(root, 0.3, 0.04, 0.22, -0.58, 0.9, -1.62, M('journal', { color: 0x5a3a28 }));
  box(root, 0.27, 0.01, 0.2, -0.58, 0.925, -1.62, mPaper);
  addI(W, journal, 'journal', 'Журнал боевых действий', 0.12);
  const folder = box(root, 0.26, 0.03, 0.34, -0.55, 0.9, -2.35, M('folder', { color: 0x7a6a40 }));
  addI(W, folder, 'folder', 'Папка донесений', 0.12);
  cyl(root, 0.04, 0.035, 0.09, 6, 0.35, 0.93, -2.4, M('mug', { color: 0x5a6a5a }));
  // подвесная лампа над столом
  const lampG = new THREE.Group(); lampG.position.set(0, H - 0.1, -2); root.add(lampG);
  cyl(lampG, 0.005, 0.005, 0.5, 3, 0, -0.25, 0, mDark);
  cyl(lampG, 0.07, 0.1, 0.14, 6, 0, -0.55, 0, mMetal);
  const glass = cyl(lampG, 0.06, 0.06, 0.12, 6, 0, -0.68, 0, mat({ color: 0xffd080, emissive: 0xffb050 }));
  W.refs.lampG = lampG; W.refs.lampGlass = glass;
  W.refs.lamp = lights.add(new THREE.Vector3(0, 1.55, -2), 0xffb060, 6.5, 1.25);
  W.refs.lamp.flicker = 0.08;

  // ---- койка ----
  box(root, 0.9, 0.35, 1.9, -2.45, 0.25, -2.95, mWood);
  box(root, 0.85, 0.1, 1.85, -2.45, 0.47, -2.95, mBlanket);
  box(root, 0.5, 0.1, 0.3, -2.45, 0.56, -3.65, M('pillow', { color: 0x9a9080 }));
  const cot = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 1.9), mDark); cot.visible = false; cot.position.set(-2.45, 0.4, -2.95); root.add(cot);
  addI(W, cot, 'cot', 'Койка');
  W.solids.push([-3, -1.95, -4, -1.95]);
  // шинель на гвозде
  box(root, 0.5, 1.0, 0.1, -1.6, 1.5, -3.9, M('coat', { map: tex.cloth, color: 0x9a9070 }));

  // ---- часы ----
  const clock = new THREE.Group(); clock.position.set(-0.9, 1.75, -3.92); root.add(clock);
  box(clock, 0.36, 0.36, 0.06, 0, 0, 0, M('clockBox', { color: 0x4a3420 }));
  plane(clock, 0.3, 0.3, 0, 0, 0.032, mat({ map: tex.clock }), { sx: 1, sy: 1 });
  const hHand = new THREE.Group(); hHand.position.z = 0.04; clock.add(hHand);
  box(hHand, 0.018, 0.08, 0.01, 0, 0.04, 0, mDark);
  const mHand = new THREE.Group(); mHand.position.z = 0.045; clock.add(mHand);
  box(mHand, 0.012, 0.12, 0.01, 0, 0.06, 0, mDark);
  W.refs.hHand = hHand; W.refs.mHand = mHand;
  addI(W, clock, 'clock', 'Часы', 0.2);

  // ---- боковой стол: ведомость, личные дела ----
  box(root, 1.0, 0.06, 0.6, 2.3, 0.8, -3.45, mWood);
  for (const [x, z] of [[1.85, -3.7], [2.75, -3.7], [1.85, -3.2], [2.75, -3.2]]) box(root, 0.06, 0.8, 0.06, x, 0.4, z, mLog);
  const ledger = box(root, 0.28, 0.03, 0.2, 2.05, 0.845, -3.4, M('ledger', { color: 0x4a5a3a }));
  addI(W, ledger, 'ledger', 'Ведомость снабжения', 0.1);
  const files = box(root, 0.3, 0.12, 0.24, 2.55, 0.89, -3.45, M('files', { color: 0x8a7a50 }));
  addI(W, files, 'files', 'Личные дела командиров', 0.1);
  W.solids.push([1.75, 2.85, -4, -3.1]);
  // сейф
  const safe = box(root, 0.55, 0.7, 0.5, -2.65, 0.35, -0.7, mMetalD);
  box(root, 0.05, 0.08, 0.02, -2.38, 0.42, -0.45, mMetal);
  addI(W, safe, 'safe', 'Сейф');
  W.solids.push([-3, -2.3, -1.0, -0.4]);
  // ящики, винтовки
  box(root, 0.6, 0.4, 0.4, 2.55, 0.2, -0.45, mCrate);
  box(root, 0.6, 0.4, 0.4, 2.55, 0.6, -0.45, mCrate, { ry: 0.1 });
  W.solids.push([2.2, 3, -0.7, -0.2]);
  for (let i = 0; i < 3; i++) box(root, 0.04, 1.1, 0.06, -1.3 + i * 0.12, 0.55, -0.08, M('rifle', { color: 0x3a2a1a }), { rx: 0.12 });
  // карта секторов на стене
  const wallMapC = document.createElement('canvas'); wallMapC.width = 64; wallMapC.height = 48;
  W.refs.wallMapC = wallMapC;
  const wmTex = toTex(wallMapC, false);
  plane(root, 0.9, 0.68, 2.92, 1.5, -2.2 + 0.0, mat({ map: wmTex }), { ry: -Math.PI / 2, sx: 1, sy: 1 });
  W.refs.wallMapTex = wmTex;

  // ---- узел связи ----
  box(root, 0.75, 0.06, 2.4, 5.55, 0.8, -2.55, mWood);
  for (const z of [-3.6, -1.5]) { box(root, 0.06, 0.8, 0.06, 5.25, 0.4, z, mLog); box(root, 0.06, 0.8, 0.06, 5.85, 0.4, z, mLog); }
  const radio = new THREE.Group(); radio.position.set(5.6, 0.83, -3.2); root.add(radio);
  box(radio, 0.5, 0.36, 0.34, 0, 0.18, 0, M('radioBox', { map: tex.radio }));
  for (let i = 0; i < 3; i++) cyl(radio, 0.03, 0.03, 0.03, 6, -0.12 + i * 0.12, 0.2, -0.18, mDark, { rx: Math.PI / 2 });
  const radioLamp = box(radio, 0.05, 0.03, 0.02, 0.17, 0.3, -0.175, mat({ color: 0x102000, emissive: 0x000000 }));
  box(radio, 0.02, 0.6, 0.02, 0.2, 0.6, 0.1, mMetal);
  W.refs.radioLamp = radioLamp;
  addI(W, radio, 'radio', 'Рация', 0.25);
  const sw = new THREE.Group(); sw.position.set(5.6, 0.83, -2.1); root.add(sw);
  box(sw, 0.45, 0.4, 0.3, 0, 0.2, 0, M('switch', { color: 0x3a3428 }));
  const swLamps = [];
  for (let i = 0; i < 6; i++) swLamps.push(box(sw, 0.04, 0.04, 0.02, -0.15 + (i % 3) * 0.15, 0.3 - Math.floor(i / 3) * 0.12, -0.155, mat({ color: 0x302010, emissive: 0 })));
  W.refs.swLamps = swLamps;
  W.solids.push([5.15, 6, -4, -1.2]);
  // табуреты связистов
  box(root, 0.35, 0.45, 0.35, 4.85, 0.22, -2.1, mWood);
  box(root, 0.35, 0.45, 0.35, 4.85, 0.22, -3.2, mWood);
  W.solids.push([4.6, 5.1, -3.45, -1.85]);
  W.refs.commLamp = lights.add(new THREE.Vector3(4.6, 1.9, -2.5), 0xffaa60, 4.2, 0.75);
  W.refs.commLamp.flicker = 0.12;
  cyl(root, 0.06, 0.08, 0.12, 6, 4.6, 2.05, -2.5, mat({ color: 0xffd080, emissive: 0xd09040 }));
  // плакат/бумаги на стене связи
  plane(root, 0.4, 0.5, 5.94, 1.5, -3.0, mat({ map: tex.doc }), { ry: -Math.PI / 2, sx: 1, sy: 1 });

  // ---- предбанник ----
  box(root, 0.5, 0.45, 2.3, 2.7, 0.22, 1.6, mWood); // скамья
  W.solids.push([2.4, 3, 0.4, 2.8]);
  // печка-буржуйка
  cyl(root, 0.25, 0.25, 0.55, 7, -2.3, 0.3, 2.45, mMetalD);
  cyl(root, 0.05, 0.05, 1.8, 5, -2.3, 1.45, 2.45, mMetalD);
  const stoveGlow = box(root, 0.16, 0.06, 0.02, -2.3, 0.28, 2.21, mat({ color: 0x401000, emissive: 0xc04010 }));
  W.refs.stoveGlow = stoveGlow;
  W.refs.stove = lights.add(new THREE.Vector3(-2.2, 0.5, 2.1), 0xff5020, 2.6, 0.7);
  W.refs.stove.flicker = 0.35;
  W.solids.push([-2.6, -2.0, 2.25, 3]);
  W.refs.anteLamp = lights.add(new THREE.Vector3(0, 1.9, 1.5), 0xffa050, 3.6, 0.5);
  W.refs.anteLamp.flicker = 0.1;
  // занавес между предбанником и КП
  const curtain = plane(root, 0.65, 1.9, -0.37, 1.0, 0.02, mat({ map: tex.tarp, side: THREE.DoubleSide }), { sx: 1, sy: 2 });
  curtain.rotation.y = 0.4; curtain.position.x = -0.85;
  // дверь
  const door = new THREE.Group(); door.position.set(-3.0, 0, 1.2); root.add(door);
  box(door, 0.08, 2.0, 1.2, 0, 1.0, 0.6, mPlV);
  box(door, 0.1, 0.1, 0.1, 0.06, 1.0, 1.05, mMetal);
  door.rotation.y = 1.45;
  W.refs.door = door;

  furnish(root, W, lights, tex, { mWood, mLog, mDark, mMetal, mMetalD, mCrate, mPaper, mBlanket, mCloth });

  // ---- амбразура: мешки на подоконнике, насыпь на крыше ----
  box(root, 1.2, 0.18, 0.5, 1.1, 1.26, -4.3, mBag);
  const emb = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.4, 0.2), mDark); emb.visible = false; emb.position.set(1.1, 1.5, -3.95); root.add(emb);
  addI(W, emb, 'embrasure', 'Амбразура');
  box(root, 9.6, 0.5, 7.6, 1.5, H + 0.35, -0.5, M('roofEarth', { map: tex.earth, outdoor: true }), { seg: 0.3 });
  // глухой земляной массив в «пустом» углу котлована штаба
  box(root, 3.0, H + 0.1, 4.0, 4.5, (H + 0.1) / 2, 1.0, M('roofEarth', { map: tex.earth, outdoor: true }), { seg: 0.3 });
  for (let i = 0; i < 9; i++) box(root, 0.9, 0.3, 0.5, -2.6 + i * 1.05, H + 0.75, -4.1, mBag, { ry: (i % 3) * 0.05 });
  // ---- пыль ----
  const dustN = 120;
  const dg = new THREE.BufferGeometry();
  const dp = new Float32Array(dustN * 3);
  for (let i = 0; i < dustN; i++) { dp[i * 3] = (Math.random() - 0.5) * 5; dp[i * 3 + 1] = -10; dp[i * 3 + 2] = -2 + (Math.random() - 0.5) * 3.5; }
  dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
  const dust = new THREE.Points(dg, new THREE.PointsMaterial({ color: 0x8a7a5a, size: 2, sizeAttenuation: false }));
  root.add(dust);
  W.refs.dust = { pts: dust, pos: dp, vel: new Float32Array(dustN), n: dustN };

  // невидимые зоны для NPC
  W.refs.spots = {
    door: new THREE.Vector3(-2.4, 0, 1.8),
    outside: new THREE.Vector3(-9.5, 1.2, 1.8),
    visitor: new THREE.Vector3(-0.5, 0, -0.95),
    visitor2: new THREE.Vector3(0.4, 0, -0.85),
    anteMid: new THREE.Vector3(0, 0, 1.4),
    curtain: new THREE.Vector3(0, 0, 0.3),
    olya: new THREE.Vector3(4.85, 0, -2.1),
    radioOp: new THREE.Vector3(4.85, 0, -3.2),
    orlov: new THREE.Vector3(-1.0, 0, 2.05),
    orlovMap: new THREE.Vector3(-0.95, 0, -2.0),
    clerk: new THREE.Vector3(1.0, 0, 2.05),
    gusev: new THREE.Vector3(-1.4, 0, 2.2),
    wounded: [[-1.6, 0.9], [-0.6, 0.9], [0.4, 0.9], [1.4, 0.9], [-1.6, 2.2], [0.4, 2.2]],
  };
  return W;
}

function addI(W, obj, id, label, pad = 0) {
  obj.userData.interact = { id, label };
  obj.traverse?.((c) => { c.userData.interact = { id, label }; });
  W.interact.push(obj);
}

/** Обустройство штаба: мебель, лампы, бумаги, быт. */
function furnish(root, W, lights, tex, m) {
  const mLamp = mat({ color: 0xffd080, emissive: 0xe0a050 });
  const mGreen = M('greenShade', { color: 0x2e4a30 });
  const mBinder = [M('b1', { color: 0x5a3a28 }), M('b2', { color: 0x3a4a5a }), M('b3', { color: 0x6a5a30 })];
  const desk = (x, z, label) => {
    box(root, 1.2, 0.06, 0.6, x, 0.76, z, m.mWood);
    for (const [dx, dz] of [[-0.55, -0.25], [0.55, -0.25], [-0.55, 0.25], [0.55, 0.25]]) box(root, 0.06, 0.76, 0.06, x + dx, 0.38, z + dz, m.mLog);
    box(root, 0.36, 0.42, 0.36, x, 0.21, z - 0.55, m.mWood); // табурет
    W.solids.push([x - 0.65, x + 0.65, z - 0.32, z + 0.32]);
  };
  // стол начальника штаба (предбанник), с лампой под зелёным абажуром
  desk(-1.0, 2.6);
  for (let i = 0; i < 5; i++) box(root, 0.22, 0.01, 0.3, -1.25 + i * 0.05, 0.8 + i * 0.006, 2.55 + (i % 2) * 0.03, m.mPaper, { ry: i * 0.12 });
  cyl(root, 0.03, 0.03, 0.25, 5, -0.6, 0.92, 2.75, m.mMetalD);
  cyl(root, 0.04, 0.11, 0.1, 6, -0.6, 1.07, 2.75, mGreen);
  box(root, 0.06, 0.04, 0.06, -0.6, 1.0, 2.75, mLamp);
  const l1 = lights.add(new THREE.Vector3(-0.6, 1.0, 2.6), 0xffc070, 2.6, 0.75); l1.flicker = 0.05;
  cyl(root, 0.035, 0.03, 0.08, 6, -1.45, 0.83, 2.45, M('mug', { color: 0x5a6a5a }));
  const orlovDesk = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.3, 0.6), m.mDark); orlovDesk.visible = false; orlovDesk.position.set(-1.0, 0.9, 2.6); root.add(orlovDesk);
  // стол писаря с пишущей машинкой
  desk(1.0, 2.6);
  box(root, 0.36, 0.12, 0.3, 1.0, 0.85, 2.6, m.mMetalD);
  box(root, 0.3, 0.12, 0.02, 1.0, 0.96, 2.72, m.mPaper, { rx: -0.3 });
  box(root, 0.25, 0.08, 0.32, 1.45, 0.83, 2.55, mBinder[1]);
  const l2 = lights.add(new THREE.Vector3(1.3, 1.1, 2.6), 0xffb060, 2.2, 0.5); l2.flicker = 0.08;
  cyl(root, 0.04, 0.05, 0.12, 6, 1.35, 0.85, 2.75, mLamp);
  // полка с папками над койкой
  box(root, 1.0, 0.04, 0.25, -2.4, 1.55, -3.85, m.mWood);
  box(root, 1.0, 0.04, 0.25, -2.4, 1.9, -3.85, m.mWood);
  for (let i = 0; i < 8; i++) box(root, 0.07, 0.28, 0.2, -2.8 + i * 0.1, 1.71, -3.85, mBinder[i % 3], { rz: i === 7 ? 0.3 : 0 });
  for (let i = 0; i < 5; i++) box(root, 0.08, 0.25, 0.2, -2.75 + i * 0.12, 2.04, -3.85, mBinder[(i + 1) % 3]);
  // доска личного состава на западной стене
  const bc = document.createElement('canvas'); bc.width = 48; bc.height = 32;
  const bx = bc.getContext('2d');
  bx.fillStyle = '#3a3226'; bx.fillRect(0, 0, 48, 32);
  bx.fillStyle = '#d8d0b8';
  for (let r = 0; r < 5; r++) { bx.fillRect(3, 4 + r * 5, 10, 3); bx.fillRect(16, 4 + r * 5, 14, 3); bx.fillStyle = r % 2 ? '#c06040' : '#d8d0b8'; bx.fillRect(33, 4 + r * 5, 4, 3); bx.fillStyle = '#d8d0b8'; }
  const board = plane(root, 1.1, 0.75, -2.93, 1.45, -1.6, mat({ map: toTex(bc, false) }), { ry: Math.PI / 2, sx: 1, sy: 1 });
  box(root, 0.04, 0.8, 1.16, -2.95, 1.45, -1.6, m.mLog);
  board.userData.interact = { id: 'personnel', label: 'Доска личного состава' }; W.interact.push(board);
  // табуреты у стола с картой
  box(root, 0.34, 0.42, 0.34, 0.95, 0.21, -2.95, m.mWood);
  box(root, 0.34, 0.42, 0.34, -1.05, 0.21, -1.15, m.mWood);
  // карандаши, линейка, бумаги на карте
  box(root, 0.3, 0.005, 0.03, 0.25, 0.892, -1.75, M('ruler', { color: 0xc0a060 }), { ry: 0.4 });
  for (let i = 0; i < 3; i++) box(root, 0.12, 0.012, 0.012, -0.2 + i * 0.05, 0.895, -2.35, M('pencil', { color: [0x8a2018, 0x2a3a7a, 0x3a3a30][i] }), { ry: i * 0.5 });
  box(root, 0.2, 0.01, 0.26, 0.55, 0.893, -2.3, m.mPaper, { ry: -0.2 });
  // личные вещи на боковом столе: фотография, бритва, кружка, лампа
  box(root, 0.1, 0.13, 0.02, 2.7, 0.9, -3.65, M('frame', { color: 0x3a2a1a }), { rx: -0.2 });
  box(root, 0.08, 0.1, 0.005, 2.7, 0.9, -3.638, M('photo', { color: 0xb0a890 }), { rx: -0.2 });
  cyl(root, 0.035, 0.03, 0.08, 6, 2.2, 0.87, -3.25, M('mug2', { color: 0x6a5a4a }));
  const l3 = lights.add(new THREE.Vector3(2.3, 1.15, -3.4), 0xffb868, 2.2, 0.55); l3.flicker = 0.06;
  cyl(root, 0.06, 0.05, 0.14, 6, 2.0, 0.9, -3.6, mLamp);
  box(root, 0.18, 0.24, 0.01, 2.2, 1.55, -3.93, M('mirror', { color: 0x8a9a9a }));
  // вешалка с шинелями и каской у двери
  box(root, 0.6, 0.05, 0.05, -2.92, 1.75, 0.6, m.mLog, { ry: Math.PI / 2 });
  box(root, 0.08, 0.9, 0.42, -2.82, 1.3, 0.45, M('coat2', { map: tex.cloth, color: 0x8a8068 }));
  const helm = new THREE.Mesh(new THREE.SphereGeometry(0.15, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2), M('helmHook', { color: 0x4c5440 }));
  helm.position.set(-2.85, 1.68, 0.85); root.add(helm);
  // чайник на печке, дрова
  cyl(root, 0.1, 0.12, 0.14, 7, -2.3, 0.65, 2.45, m.mMetal);
  for (let i = 0; i < 5; i++) cyl(root, 0.05, 0.05, 0.5, 5, -2.75 + (i % 3) * 0.1, 0.05 + Math.floor(i / 3) * 0.1, 1.85, m.mLog, { rz: Math.PI / 2 });
  // половик в комнате командира
  box(root, 1.4, 0.01, 0.9, 0.2, 0.01, -0.9, m.mBlanket);
  // кабели вдоль стен (от коммутатора)
  const mCable = M('cable', { color: 0x1a1a18 });
  box(root, 0.02, 0.02, 3.0, 5.95, 2.0, -2.5, mCable);
  box(root, 3.0, 0.02, 0.02, 1.5, 2.05, -3.94, mCable);
  box(root, 0.02, 0.02, 3.6, 2.95, 2.05, -2.2, mCable);
  // ящики в углу комнаты командира и патронные цинки
  box(root, 0.5, 0.25, 0.3, 2.6, 1.0, -0.45, m.mCrate, { ry: 0.3 });
  // плакат и график дежурств в предбаннике
  plane(root, 0.5, 0.65, 0.0, 1.5, 2.94, mat({ map: tex.doc }), { ry: Math.PI, sx: 1, sy: 1 });
  plane(root, 0.4, 0.5, 2.94, 1.5, 0.9, mat({ map: tex.doc }), { ry: -Math.PI / 2, sx: 1, sy: 1 });
  // морзянка и вторая рация
  box(root, 0.12, 0.03, 0.08, 5.35, 0.85, -2.85, m.mMetalD);
  box(root, 0.3, 0.25, 0.25, 5.65, 0.96, -3.7, M('radio2', { map: tex.radio, color: 0x9a9a80 }));
}