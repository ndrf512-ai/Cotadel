// Укрепрайон целиком: рельеф с траншеями, блиндажи, тыл, проволока, указатели.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { boxGeo, M } from '../engine/geo.js';
import { mat } from '../engine/ps1.js';
import { toTex } from '../engine/textures.js';
import { decorate } from './props.js';
import {
  TRENCHES, DUGOUTS, SPOTS, SIGNS, SECTOR_POS, GRID, GRID_N, HQ_RECT, FLAT_R, HQ_GROUND,
  heights, baseGround, carve, terrainAt, floorAt, inHole, polar, R_WIRE,
} from './layout.js';

const rnd = (a, b) => a + Math.random() * (b - a);

/** Сборщик статической геометрии: всё одного материала сливается в один меш. */
class Batch {
  constructor() { this.groups = new Map(); }
  add(key, geo, x, y, z, ry = 0, rx = 0, rz = 0) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(1, 1, 1));
    const g = geo.clone().applyMatrix4(m);
    if (!this.groups.has(key)) this.groups.set(key, []);
    this.groups.get(key).push(g);
  }
  box(key, w, h, d, x, y, z, ry = 0, tile = 1, rx = 0, rz = 0) { this.add(key, boxGeo(w, h, d, tile), x, y, z, ry, rx, rz); }
  flush(parent, mats) {
    for (const [k, list] of this.groups) {
      const g = mergeGeometries(list.map((x) => (x.index ? x.toNonIndexed() : x)));
      parent.add(new THREE.Mesh(g, mats[k]));
    }
  }
}

export function buildTerritory(scene, tex, lights, W) {
  const root = new THREE.Group(); scene.add(root);
  if (W && W.refs.wallMapTex) tex = { ...tex, map: W.refs.wallMapTex };
  const mats = {
    planks: M('t_planks', { map: tex.planks, outdoor: true }),
    planksV: M('t_planksV', { map: tex.planksV, outdoor: true }),
    log: M('t_log', { map: tex.planksV, color: 0x8a7458, outdoor: true }),
    bag: M('t_bag', { map: tex.sandbag, outdoor: true }),
    earth: M('t_earth', { map: tex.earth, outdoor: true }),
    crate: M('t_crate', { map: tex.crate, outdoor: true }),
    post: M('t_post', { color: 0x4a3a28, outdoor: true }),
    wire: M('t_wire', { map: tex.wire, outdoor: true, side: THREE.DoubleSide }),
    dark: M('t_dark', { color: 0x1c1a16, outdoor: true }),
    birch: M('t_birch', { color: 0x9a968a, outdoor: true }),
    burnt: M('t_burnt', { color: 0x2a2620, outdoor: true }),
    crown: M('t_crown', { color: 0x5a6644, outdoor: true }),
    reed: M('t_reed', { color: 0x6a6a40, outdoor: true, side: THREE.DoubleSide }),
    water: M('t_water', { color: 0x2a3634, outdoor: true }),
    tarp: M('t_tarp', { map: tex.tarp, outdoor: true }),
    // интерьеры блиндажей
    iPlanks: M('i_planks', { map: tex.planks }),
    iPlanksV: M('i_planksV', { map: tex.planksV }),
    iLog: M('i_log', { map: tex.planksV, color: 0x8a7458 }),
    iWood: M('i_wood', { map: tex.planks, color: 0xc0a080 }),
    iBlanket: M('i_blanket', { map: tex.blanket }),
    iCrate: M('i_crate', { map: tex.crate }),
    iMetal: M('i_metal', { map: tex.metalDark }),
    iWhite: M('i_white', { color: 0xb8b4a4 }),
  };
  const B = new Batch();
  const T = { interact: [], solids: [], dynamic: {}, dugouts: {}, lights: [] };

  // ---------- рельеф ----------
  buildGround(root, tex);

  // ---------- траншеи: настил, обшивка, бруствер ----------
  const trenchLines = TRENCHES.map((t) => t.pts);
  const nearOther = (x, z, self, r) => {
    for (const tr of TRENCHES) {
      if (tr === self) continue;
      const p = tr.pts;
      for (let i = 0; i < p.length - 1; i++) {
        const ax = p[i][0], az = p[i][1], bx = p[i + 1][0], bz = p[i + 1][1];
        const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
        let t = ((x - ax) * dx + (z - az) * dz) / l2; t = Math.max(0, Math.min(1, t));
        if (Math.hypot(x - ax - dx * t, z - az - dz * t) < r) return true;
      }
    }
    return !!inHole(x, z);
  };
  let tseed = 777;
  const trnd = () => ((tseed = (tseed * 16807) % 2147483647) / 2147483647);
  const STYLES = ['planks', 'planks', 'wattle', 'bags', 'logs', 'bare'];
  for (const tr of TRENCHES) {
    const p = tr.pts;
    for (let i = 0; i < p.length - 1; i++) {
      const [ax, az, ad, aw = 1] = p[i], [bx, bz, bd, bw = 1] = p[i + 1];
      // каждый участок укрепляли по-своему и в разное время
      const style = tr.kind === 'stub' ? 'planks' : STYLES[(trnd() * STYLES.length) | 0];
      const damaged = trnd() < 0.22;
      const len = Math.hypot(bx - ax, bz - az);
      const ang = Math.atan2(bx - ax, bz - az);
      const nx = Math.cos(ang), nz = -Math.sin(ang); // нормаль к оси
      const n = Math.max(1, Math.round(len / 1.0));
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
        const depth = ad + (bd - ad) * t;
        const wd = (aw + (bw - aw) * t) * 0.9;
        if (inHole(x, z)) continue;
        const fl = floorAt(x, z);
        // настил
        if (depth > 0.3 && !(damaged && k % 3 === 1)) B.box('planks', 0.55 + wd * 0.2, 0.05, len / n * 0.9, x, fl + 0.03, z, ang + (trnd() - 0.5) * 0.08, 1);
        if (depth < 0.6) continue;
        // обшивка стенок
        for (const side of [-1, 1]) {
          const off = wd + 0.05;
          const sx = x + nx * off * side, sz = z + nz * off * side;
          if (nearOther(sx, sz, tr, 1.7)) continue;
          const top = baseGround(sx, sz);
          const h = Math.max(0.3, top - fl - 0.02);
          const L = len / n;
          if (damaged && k % 2 === 0) { // обвалившийся участок: доски лежат на дне
            B.box('planksV', 0.06, h * 0.7, L * 0.8, sx - nx * side * 0.35, fl + 0.2, sz - nz * side * 0.35, ang + 0.2, 1, 0, side * 1.1);
            continue;
          }
          if (style === 'planks') {
            B.box('planksV', 0.06, h, L, sx, fl + h / 2, sz, ang, 1);
            if (k % 2 === 0) B.box('log', 0.1, h + 0.15, 0.1, sx + nx * side * 0.06, fl + (h + 0.15) / 2, sz + nz * side * 0.06, ang);
          } else if (style === 'wattle') { // плетень из прутьев
            for (let q = 0; q < 4; q++) B.box('post', 0.04, h + 0.1, 0.04, sx + Math.sin(ang) * (q - 1.5) * L / 4, fl + h / 2, sz + Math.cos(ang) * (q - 1.5) * L / 4);
            B.box('earth', 0.05, h * 0.9, L, sx + nx * side * 0.03, fl + h * 0.45, sz + nz * side * 0.03, ang, 1);
            B.box('post', 0.03, 0.03, L, sx, fl + h * 0.35, sz, ang); B.box('post', 0.03, 0.03, L, sx, fl + h * 0.7, sz, ang);
          } else if (style === 'bags') { // стенка из мешков
            const rows = Math.max(1, Math.round(h / 0.3));
            for (let q = 0; q < rows; q++) B.box('bag', L * 0.95, 0.28, 0.4, sx + nx * side * 0.12, fl + 0.14 + q * 0.29, sz + nz * side * 0.12, ang + (q % 2) * 0.04, 1);
          } else if (style === 'logs') { // горизонтальные брёвна
            const rows = Math.max(1, Math.round(h / 0.22));
            for (let q = 0; q < rows; q++) B.add('log', new THREE.CylinderGeometry(0.1, 0.1, L, 5), sx + nx * side * 0.05, fl + 0.1 + q * 0.21, sz + nz * side * 0.05, ang, Math.PI / 2);
          } else if (k % 2 === 0) { // голая земля, только колья
            B.box('post', 0.08, h + 0.1, 0.08, sx, fl + h / 2, sz);
          }
        }
        // бруствер из мешков на первой линии — на стороне противника
        if (tr.kind === 'front' || tr.kind === 'sap') {
          const out = Math.hypot(x + nx, z + nz) > Math.hypot(x, z) ? 1 : -1;
          const px = x + nx * (wd + 1.0) * out, pz = z + nz * (wd + 1.0) * out;
          if (!nearOther(px, pz, tr, 1.9)) {
            const g = baseGround(px, pz);
            if (k % 3 !== 1) B.box('bag', len / n, 0.3, 0.55, px, g + 0.15, pz, ang, 1); // в разрывах — бойницы
          }
        }
      }
    }
  }

  // ---------- блиндажи ----------
  for (const d of DUGOUTS) T.dugouts[d.id] = buildDugout(root, B, mats, d, T, lights, tex);

  // ---------- пулемётные гнёзда ----------
  T.dynamic.mg = {};
  for (const s of ['N', 'E', 'S']) {
    T.dynamic.mg[s] = [];
    for (const [x, z] of SECTOR_POS[s].mg) {
      const out = SECTOR_POS[s].outward;
      const fl = floorAt(x, z);
      const g = new THREE.Group(); g.position.set(x + out[0] * 0.6, fl + 1.25, z + out[1] * 0.6);
      g.rotation.y = Math.atan2(out[0], out[1]);
      const mg = new THREE.Mesh(boxGeo(0.12, 0.14, 1.1), M('mg', { color: 0x2a2c28, outdoor: true })); mg.position.set(0, 0.15, 0.2); g.add(mg);
      const shield = new THREE.Mesh(boxGeo(0.6, 0.45, 0.04), M('mgShield', { color: 0x4a5040, outdoor: true })); shield.position.set(0, 0.25, 0.25); g.add(shield);
      const legs = new THREE.Mesh(boxGeo(0.5, 0.08, 0.5), M('mg', {})); legs.position.y = 0.0; g.add(legs);
      root.add(g);
      T.dynamic.mg[s].push(g);
      // гнездо: мешки полукругом
      for (let i = -2; i <= 2; i++) {
        const a = Math.atan2(out[0], out[1]) + i * 0.45;
        const bx = x + Math.sin(a) * 1.8, bz = z + Math.cos(a) * 1.8;
        B.box('bag', 1.0, 0.35, 0.5, bx, baseGround(bx, bz) + 0.18, bz, a + Math.PI / 2, 1);
        B.box('bag', 0.9, 0.32, 0.5, bx, baseGround(bx, bz) + 0.5, bz, a + Math.PI / 2 + 0.05, 1);
      }
    }
  }

  // ---------- НП ----------
  {
    const [x, z] = SPOTS.np;
    const fl = floorAt(x, z);
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; B.box('bag', 1.0, 0.4, 0.5, x + Math.sin(a) * 1.3, baseGround(x, z) + 0.2, z + Math.cos(a) * 1.3, a + Math.PI / 2, 1); }
    const bino = new THREE.Mesh(boxGeo(0.25, 0.12, 0.2), M('bino', { color: 0x2a2c28, outdoor: true }));
    bino.position.set(x, fl + 1.45, z); root.add(bino);
    tag(bino, { id: 'binoculars', label: 'НП «Берёзы» — бинокль' }); T.interact.push(bino);
  }

  // ---------- склад ----------
  {
    const [x, z] = SPOTS.depot;
    for (const [px, pz] of [[-3, -2.5], [3, -2.5], [-3, 2.5], [3, 2.5]]) { B.box('log', 0.15, 2.4, 0.15, x + px, HQ_GROUND + 1.2, z + pz); T.solids.push([x + px - 0.1, x + px + 0.1, z + pz - 0.1, z + pz + 0.1]); }
    B.box('tarp', 6.6, 0.08, 5.6, x, HQ_GROUND + 2.45, z, 0, 2);
    const crates = new THREE.Group(); root.add(crates);
    for (let i = 0; i < 18; i++) {
      const c = new THREE.Mesh(boxGeo(0.7, 0.4, 0.45), mats.crate);
      c.position.set(x - 2.2 + (i % 6) * 0.78, HQ_GROUND + 0.2 + Math.floor(i / 12) * 0.42, z - 1.6 + (Math.floor(i / 6) % 2) * 0.55);
      crates.add(c);
    }
    T.solids.push([x - 2.6, x + 2.4, z - 2, z - 0.6]);
    const sacks = new THREE.Group(); root.add(sacks);
    for (let i = 0; i < 8; i++) { const sk = new THREE.Mesh(boxGeo(0.6, 0.35, 0.4), mats.bag); sk.position.set(x - 2 + (i % 4) * 0.7, HQ_GROUND + 0.18 + Math.floor(i / 4) * 0.36, z + 1.8); sacks.add(sk); }
    T.solids.push([x - 2.4, x + 0.8, z + 1.5, z + 2.1]);
    T.dynamic.depotCrates = crates.children; T.dynamic.depotSacks = sacks.children;
    const hit = new THREE.Mesh(new THREE.BoxGeometry(5, 1, 1.2), mats.dark); hit.visible = false; hit.position.set(x, HQ_GROUND + 0.5, z - 1.3); root.add(hit);
    tag(hit, { id: 'depotStock', label: 'Склад: ящики и мешки' }); T.interact.push(hit);
    const lamp = lights.add(new THREE.Vector3(x, HQ_GROUND + 2.1, z), 0xffb060, 5, 0.7); lamp.flicker = 0.1;
  }

  // ---------- инженерный двор ----------
  {
    const [x, z] = SPOTS.engYard;
    const logs = new THREE.Group(); root.add(logs);
    for (let i = 0; i < 12; i++) {
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 3.5, 5), mats.log);
      l.rotation.z = Math.PI / 2; l.position.set(x - 1, HQ_GROUND + 0.13 + Math.floor(i / 4) * 0.25, z - 1.5 + (i % 4) * 0.27); logs.add(l);
    }
    T.dynamic.engLogs = logs.children;
    T.solids.push([x - 2.8, x + 0.8, z - 1.8, z - 0.3]);
    B.box('planks', 1.6, 0.08, 0.5, x + 1.8, HQ_GROUND + 0.75, z + 1.2);
    for (const dx of [-0.6, 0.6]) B.box('log', 0.08, 0.75, 0.4, x + 1.8 + dx, HQ_GROUND + 0.37, z + 1.2);
    B.box('bag', 1.2, 0.5, 0.8, x + 2.5, HQ_GROUND + 0.25, z - 1.2);
  }

  // ---------- костёр резерва ----------
  {
    const [x, z] = SPOTS.campfire;
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.4; B.add('log', new THREE.CylinderGeometry(0.15, 0.15, 1.6, 5), x + Math.sin(a) * 1.4, HQ_GROUND + 0.15, z + Math.cos(a) * 1.4, a, 0, Math.PI / 2); }
    const fire = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.5, 5), mat({ color: 0, emissive: 0xff7020, outdoor: true }));
    fire.position.set(x, HQ_GROUND + 0.25, z); root.add(fire);
    T.dynamic.fire = fire;
    const l = lights.add(new THREE.Vector3(x, HQ_GROUND + 0.8, z), 0xff8030, 7, 1.0); l.flicker = 0.35;
    T.dynamic.fireLight = l;
  }

  // ---------- проволока, камыш, ничейная земля ----------
  for (const [a0, a1] of [[-52, 52], [45, 135], [135, 228]]) {
    for (let a = a0; a < a1; a += 3.5) {
      const [x, z] = polar(R_WIRE + Math.sin(a) * 0.8, a);
      const [x2, z2] = polar(R_WIRE + Math.sin(a + 3.5) * 0.8, a + 3.5);
      const g = baseGround(x, z);
      B.box('post', 0.08, 1.2, 0.08, x, g + 0.5, z, 0, 1, 0.1 * Math.sin(a), 0);
      const len = Math.hypot(x2 - x, z2 - z);
      const pl = new THREE.PlaneGeometry(len, 0.9);
      const uv = pl.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * len / 2);
      B.add('wire', pl, (x + x2) / 2, g + 0.5, (z + z2) / 2, Math.atan2(x2 - x, z2 - z) + Math.PI / 2);
    }
  }
  for (let i = 0; i < 260; i++) {
    const x = rnd(-58, -28), z = rnd(-30, 30);
    if (carve(x, z) > 0.2 || inHole(x, z)) continue;
    B.add('reed', new THREE.PlaneGeometry(0.6, rnd(1.2, 2)), x, baseGround(x, z) + 0.7, z, rnd(0, 3));
  }
  for (let i = 0; i < 14; i++) {
    const x = rnd(-56, -34), z = rnd(-28, 28);
    if (carve(x, z) > 0.1 || inHole(x, z)) continue;
    B.add('water', new THREE.CircleGeometry(rnd(1.5, 3.5), 7).rotateX(-Math.PI / 2), x, baseGround(x, z) + 0.04, z);
  }
  for (let i = 0; i < 70; i++) {
    const a = rnd(-60, 230), r = rnd(R_WIRE + 3, 95);
    const [x, z] = polar(r, a);
    B.add('earth', new THREE.CylinderGeometry(rnd(1, 2.4), rnd(1.5, 3), 0.25, 7), x, baseGround(x, z) - 0.05, z);
  }
  for (let i = 0; i < 45; i++) {
    const a = rnd(0, 360), r = rnd(54, 120);
    const [x, z] = polar(r, a);
    const burned = Math.random() < 0.55, h = burned ? rnd(1, 3.5) : rnd(5, 9);
    B.add(burned ? 'burnt' : 'birch', new THREE.CylinderGeometry(0.12, 0.2, h, 5), x, baseGround(x, z) + h / 2 - 0.2, z);
    if (!burned) B.add('crown', new THREE.IcosahedronGeometry(rnd(1.3, 2.3), 0), x, baseGround(x, z) + h - 0.4, z);
  }
  // березняк на высоте у северного сектора
  for (let i = 0; i < 12; i++) {
    const [x, z] = polar(rnd(29, 38), rnd(-35, 35));
    if (carve(x, z) > 0.05 || inHole(x, z)) continue;
    const h = rnd(4, 7);
    B.add('birch', new THREE.CylinderGeometry(0.1, 0.16, h, 5), x, baseGround(x, z) + h / 2 - 0.2, z);
    B.add('crown', new THREE.IcosahedronGeometry(rnd(1.0, 1.8), 0), x, baseGround(x, z) + h - 0.3, z);
    T.solids.push([x - 0.25, x + 0.25, z - 0.25, z + 0.25]);
  }
  // окопы противника вдали (силуэты)
  for (let a = -60; a < 240; a += 6) {
    const [x, z] = polar(88, a);
    B.box('earth', 6, 0.8, 1.5, x, baseGround(x, z) + 0.2, z, a * Math.PI / 180 + Math.PI / 2, 2);
  }
  // кладбище на востоке (кресты)
  for (let i = 0; i < 14; i++) {
    const [x, z] = polar(rnd(29, 38), rnd(65, 115));
    if (carve(x, z) > 0.05 || inHole(x, z)) continue;
    const g = baseGround(x, z);
    B.box('post', 0.08, 0.9, 0.08, x, g + 0.45, z); B.box('post', 0.45, 0.07, 0.07, x, g + 0.7, z);
  }
  // дорога на юг: колеи
  for (let r = 18; r < 120; r += 2) {
    const [x, z] = polar(r, 185);
    if (carve(x, z) > 0.1) continue;
    B.box('earth', 0.4, 0.05, 2, x - 0.8, baseGround(x, z) + 0.01, z); B.box('earth', 0.4, 0.05, 2, x + 0.8, baseGround(x, z) + 0.01, z);
  }

  // ---------- указатели ----------
  for (const s of SIGNS) {
    const [x, z] = s.at;
    const g = floorAt(x, z);
    B.box('post', 0.1, 1.9, 0.1, x, g + 0.95, z);
    const c = document.createElement('canvas'); c.width = 64; c.height = 24;
    const cx = c.getContext('2d');
    cx.fillStyle = '#7a6448'; cx.fillRect(0, 0, 64, 24);
    cx.fillStyle = '#e8dcc0'; cx.font = 'bold 9px monospace'; cx.textAlign = 'center';
    cx.fillText(s.text[0], 32, 10); cx.font = '8px monospace'; cx.fillText(s.text[1], 32, 20);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.42), mat({ map: toTex(c, false), outdoor: true, side: THREE.DoubleSide }));
    board.position.set(x, g + 1.7, z); board.rotation.y = -s.face * Math.PI / 180 + Math.PI;
    root.add(board);
  }

  // ---------- небо ----------
  const sky = new THREE.Mesh(new THREE.SphereGeometry(160, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), mat({ map: tex.sky, outdoor: true, side: THREE.BackSide }));
  sky.position.y = -20; root.add(sky);

  decorate(B, T, lights, tex, mats);
  B.flush(root, mats);
  return T;
}

function tag(o, data) { o.traverse((c) => { c.userData.interact = data; }); }

// ---------------- рельеф ----------------
function buildGround(root, tex) {
  const H = heights();
  const pos = [], col = [], uv = [], idx = [];
  const N = GRID_N;
  const vid = new Int32Array(N * N).fill(-1);
  const cg = new THREE.Color(0.95, 1.0, 0.85), ce = new THREE.Color(0.85, 0.68, 0.5), cm = new THREE.Color(0.9, 0.82, 0.68), cs = new THREE.Color(0.55, 0.68, 0.6);
  const c = new THREE.Color();
  const vert = (i, j) => {
    const k = j * N + i;
    if (vid[k] >= 0) return vid[k];
    const x = GRID.min + i * GRID.step, z = GRID.min + j * GRID.step;
    const h = H[k];
    pos.push(x, h, z); uv.push(x / 3, z / 3);
    const cv = baseGround(x, z) - h;
    const r = Math.hypot(x, z);
    c.copy(r < FLAT_R + 2 ? cm : cg);
    if (x < -27) c.lerp(cs, Math.min(1, (-27 - x) / 6));
    if (cv > 0.15) c.lerp(ce, Math.min(1, cv / 0.8));
    const n = 0.92 + ((x * 7 + z * 13) % 5) * 0.02;
    col.push(c.r * n, c.g * n, c.b * n);
    vid[k] = pos.length / 3 - 1;
    return vid[k];
  };
  const holeCell = (x, z) => !!inHole(x + 0.5, z + 0.5);
  for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
    const x = GRID.min + i * GRID.step, z = GRID.min + j * GRID.step;
    if (holeCell(x, z)) continue;
    const a = vert(i, j), b = vert(i + 1, j), cc = vert(i, j + 1), d = vert(i + 1, j + 1);
    idx.push(a, cc, b, b, cc, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const m = mat({ map: tex.grass, outdoor: true, vcolor: true });
  root.add(new THREE.Mesh(g, m));
  // дальнее кольцо (грубая сетка)
  const S = 6, R0 = -144, n2 = 49;
  const p2 = [], c2 = [], u2 = [], i2 = [];
  for (let j = 0; j < n2; j++) for (let i = 0; i < n2; i++) {
    const x = R0 + i * S, z = R0 + j * S;
    p2.push(x, baseGround(x, z), z); u2.push(x / 3, z / 3);
    const k = x < -27 ? 0.75 : 1; c2.push(0.9 * k, 0.95, 0.8 * k);
  }
  for (let j = 0; j < n2 - 1; j++) for (let i = 0; i < n2 - 1; i++) {
    const x = R0 + i * S, z = R0 + j * S;
    if (x >= GRID.min && x + S <= GRID.max && z >= GRID.min && z + S <= GRID.max) continue;
    const a = j * n2 + i;
    i2.push(a, a + n2, a + 1, a + 1, a + n2, a + n2 + 1);
  }
  const g2 = new THREE.BufferGeometry();
  g2.setAttribute('position', new THREE.Float32BufferAttribute(p2, 3));
  g2.setAttribute('color', new THREE.Float32BufferAttribute(c2, 3));
  g2.setAttribute('uv', new THREE.Float32BufferAttribute(u2, 2));
  g2.setIndex(i2); g2.computeVertexNormals();
  const outer = new THREE.Mesh(g2, m); outer.position.y = -0.02; root.add(outer);
}

// ---------------- блиндаж ----------------
function buildDugout(root, B, mats, d, T, lights, tex) {
  const [x0, x1, z0, z1] = d.rect;
  const fl = d.floor, H = 2.15;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, dd = z1 - z0;
  const ref = { d, spots: {}, bunks: [], crates: [], wounded: [] };
  B.box('iPlanks', w, 0.08, dd, cx, fl - 0.04, cz, 0, 1);
  B.box('iPlanksV', w, 0.08, dd, cx, fl + H + 0.04, cz, 0, 1);
  // земляная насыпь на крыше
  B.box('earth', w + 0.8, 0.5, dd + 0.8, cx, fl + H + 0.33, cz, 0, 2);
  for (let x = x0 + 0.6; x < x1; x += 0.9) B.add('iLog', new THREE.CylinderGeometry(0.09, 0.09, dd, 5), x, fl + H - 0.08, cz, 0, Math.PI / 2);
  const walls = { n: [x0, x1, z0, 'h'], s: [x0, x1, z1, 'h'], w: [z0, z1, x0, 'v'], e: [z0, z1, x1, 'v'] };
  for (const [side, [a0, a1, f, o]] of Object.entries(walls)) {
    const parts = [];
    if (side === d.door) { const m = (a0 + a1) / 2; parts.push([a0, m - 0.6], [m + 0.6, a1]); B.box('iPlanksV', o === 'h' ? 1.2 : 0.12, H - 1.9, o === 'h' ? 0.12 : 1.2, o === 'h' ? m : f, fl + 1.9 + (H - 1.9) / 2, o === 'h' ? f : m); }
    else parts.push([a0, a1]);
    for (const [a, b] of parts) {
      const len = b - a, m = (a + b) / 2;
      if (o === 'h') { B.box('iPlanksV', len, H, 0.12, m, fl + H / 2, f, 0, 1); B.box('planksV', len, H, 0.1, m, fl + H / 2, f + (side === 'n' ? -0.1 : 0.1), 0, 1); T.solids.push([a, b, f - 0.08, f + 0.08]); }
      else { B.box('iPlanksV', 0.12, H, len, f, fl + H / 2, m, 0, 1); B.box('planksV', 0.1, H, len, f + (side === 'w' ? -0.1 : 0.1), fl + H / 2, m, 0, 1); T.solids.push([f - 0.08, f + 0.08, a, b]); }
    }
  }
  // интерьер: нары вдоль дальней стены
  const doorAxis = d.door === 'n' || d.door === 's' ? 'z' : 'x';
  const far = { n: [cx, z1 - 0.5], s: [cx, z0 + 0.5], w: [x1 - 0.5, cz], e: [x0 + 0.5, cz] }[d.door];
  const along = doorAxis === 'z' ? [1, 0] : [0, 1];
  const nb = d.role === 'med' ? 5 : d.role === 'command' ? 0 : 4;
  for (let i = 0; i < nb; i++) {
    const t = (i - (nb - 1) / 2) * 1.0;
    const bx = far[0] + along[0] * t, bz = far[1] + along[1] * t;
    const rot = doorAxis === 'z' ? 0 : Math.PI / 2;
    B.box('iWood', 0.85, 0.4, 0.95, bx, fl + 0.2, bz, rot);
    B.box('iBlanket', 0.8, 0.08, 0.9, bx, fl + 0.44, bz, rot);
    ref.bunks.push([bx, fl + 0.5, bz, rot]);
  }
  const bunkSolid = doorAxis === 'z' ? [x0, x1, far[1] - 0.55, far[1] + 0.55] : [far[0] - 0.55, far[0] + 0.55, z0, z1];
  if (nb) T.solids.push(bunkSolid); // нары
  // стол и телефон
  const side = { n: [x0 + 0.55, cz + 0.4], s: [x1 - 0.55, cz - 0.4], w: [cx, z0 + 0.55], e: [cx, z1 - 0.55] }[d.door];
  B.box('iWood', 0.9, 0.06, 0.6, side[0], fl + 0.75, side[1]);
  B.box('iLog', 0.08, 0.75, 0.08, side[0], fl + 0.37, side[1]);
  T.solids.push([side[0] - 0.5, side[0] + 0.5, side[1] - 0.35, side[1] + 0.35]);
  if (d.role !== 'reserve') {
    const ph = new THREE.Mesh(boxGeo(0.24, 0.15, 0.18), M('fphone', { map: tex.radio, color: 0x8a8a70 }));
    ph.position.set(side[0] + 0.2, fl + 0.86, side[1]); root.add(ph);
    tag(ph, { id: 'fieldphone', label: 'Полевой телефон — связь со штабом', dug: d.id }); T.interact.push(ph);
  }
  // ящики с патронами (видимое количество = реальный запас)
  const cr = { n: [x1 - 0.5, z0 + 0.5], s: [x0 + 0.5, z1 - 0.5], w: [x0 + 0.5, z0 + 0.5], e: [x1 - 0.5, z1 - 0.5] }[d.door];
  if (d.role !== 'med' && d.role !== 'command') for (let i = 0; i < 6; i++) {
    const c = new THREE.Mesh(boxGeo(0.6, 0.3, 0.4), mats.iCrate);
    c.position.set(cr[0] + (i % 2 ? 0 : 0) , fl + 0.15 + Math.floor(i / 2) * 0.31, cr[1] + (i % 2) * (d.door === 'n' || d.door === 'w' ? 0.45 : -0.45) * (doorAxis === 'z' ? 0 : 1));
    if (doorAxis === 'z') c.position.x += (i % 2) * (d.door === 'n' ? -0.65 : 0.65);
    root.add(c); ref.crates.push(c);
  }
  if (d.role === 'med') {
    B.box('iWhite', 1.8, 0.8, 0.7, side[0], fl + 0.4, side[1] + 0.9); // операционный стол
    const cab = new THREE.Mesh(boxGeo(0.7, 1.4, 0.4), mats.iMetal); cab.position.set(cr[0], fl + 0.7, cr[1]); root.add(cab);
    tag(cab, { id: 'medcab', label: 'Шкаф с медикаментами' }); T.interact.push(cab);
    T.solids.push([cr[0] - 0.4, cr[0] + 0.4, cr[1] - 0.3, cr[1] + 0.3]);
  }
  themeProps(root, B, d, fl, H, lights, tex, T, doorAxis);
  const lamp = lights.add(new THREE.Vector3(cx, fl + 1.8, cz), 0xffa050, 5.5, 1.35); lamp.flicker = 0.12;
  ref.lamp = lamp;
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.12, 6), mat({ color: 0xffd080, emissive: 0xd09040 }));
  glass.position.set(cx, fl + 1.85, cz); root.add(glass);
  ref.spots.officer = [side[0] + (doorAxis === 'z' ? 0.6 : 0), fl, side[1] + (doorAxis === 'z' ? 0 : 0.6)];
  ref.spots.center = [cx, fl, cz];
  ref.spots.door = { w: [x0 - 0.9, cz], e: [x1 + 0.9, cz], n: [cx, z0 - 0.9], s: [cx, z1 + 0.9] }[d.door];
  if (d.role === 'command') {
    // места вокруг стола совещаний: [x, z, лицом_к]; проход вокруг стола — со стороны скамьи
    const away = d.door === 'n' ? 1 : -1, tz = cz + 0.2 * away;
    const doorFace = away > 0 ? 0 : Math.PI, farFace = away > 0 ? Math.PI : 0;
    const benchSide = side[0] < cx ? 1 : -1;
    ref.spots.meet = [[cx - 0.7, tz - 0.95 * away, doorFace], [cx + 0.7, tz - 0.95 * away, doorFace], [cx - 0.7, tz + 0.95 * away, farFace], [cx + 0.7, tz + 0.95 * away, farFace], [cx + 1.5 * benchSide, tz, benchSide > 0 ? -Math.PI / 2 : Math.PI / 2], [cx, tz - 1.05 * away, doorFace]];
    const wx = cx + 1.75 * benchSide;
    ref.spots.walk = { near: [wx, tz - 1.2 * away], far: [wx, tz + 1.0 * away], tz, away };
  }
  // табличка у входа
  return ref;
}

/** Индивидуальное убранство блиндажа — по характеру хозяина и назначению. */
function themeProps(root, B, d, fl, H, lights, tex, T, doorAxis) {
  const [x0, x1, z0, z1] = d.rect;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  // стена напротив стола
  const opp = { n: [cx + 0.6, z1 - 0.5], s: [cx - 0.6, z0 + 0.5], w: [cx - 0.3, z1 - 0.45], e: [cx + 0.3, z0 + 0.45] }[d.door];
  const wd = doorAxis === 'x' ? [1, 0] : [0, 1];
  const ry = doorAxis === 'x' ? 0 : Math.PI / 2;
  const at = (k) => [opp[0] + wd[0] * k, opp[1] + wd[1] * k];
  const wallSide = { n: 1, s: -1, w: 1, e: -1 }[d.door];
  const wallPos = doorAxis === 'x' ? [cx, (wallSide > 0 ? z1 : z0) - wallSide * 0.07] : [(wallSide > 0 ? x1 : x0) - wallSide * 0.07, cz];
  const mk = (k, o) => M(k, o);
  const paper = mk('t_paper', { map: tex.doc });
  const shelf = (k, y) => { const [x, z] = at(k); B.box('iWood', doorAxis === 'x' ? 1.0 : 0.25, 0.04, doorAxis === 'x' ? 0.25 : 1.0, x, fl + y, z); };
  const add = (geo, m, k, y, rot = 0) => { const [x, z] = at(k); const o = new THREE.Mesh(geo, m); o.position.set(x, fl + y, z); o.rotation.y = rot; root.add(o); return o; };
  const solidAt = (k, r = 0.35) => { const [x, z] = at(k); T.solids.push([x - r, x + r, z - r, z + r]); };
  switch (d.theme) {
    case 'orderly': // Коваль: всё по линейке
      for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(0.05, 1.15, 0.07), mk('t_rifle', { color: 0x4a3a2a }), -0.6 + i * 0.16, 0.6);
      B.box('iWood', 0.8, 0.08, 0.2, at(-0.36)[0], fl + 0.95, at(-0.36)[1], ry);
      shelf(0.8, 1.3); for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(0.16, 0.12, 0.2), mk('t_box', { color: 0x5a6040 }), 0.5 + i * 0.2, 1.38);
      add(new THREE.PlaneGeometry(0.7, 0.5), paper, 0.1, 1.55, doorAxis === 'x' ? (wallSide > 0 ? Math.PI : 0) : (wallSide > 0 ? -Math.PI / 2 : Math.PI / 2));
      solidAt(-0.36, 0.5);
      break;
    case 'trophy': // Ярцев: трофеи и беспорядок
      for (let i = 0; i < 3; i++) add(new THREE.SphereGeometry(0.15, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2), mk('t_ehelm', { color: 0x5a5c58 }), -0.6 + i * 0.35, 1.32);
      shelf(-0.25, 1.25);
      add(new THREE.BoxGeometry(0.6, 0.4, 0.4), mk('i_crate', { map: tex.crate }), 0.6, 0.2, 0.3);
      add(new THREE.BoxGeometry(0.12, 0.14, 1.0), mk('t_mg', { color: 0x2a2c28 }), 0.6, 0.48, 0.3);
      for (let i = 0; i < 3; i++) add(new THREE.CylinderGeometry(0.04, 0.05, 0.25, 6), mk('t_bottle', { color: 0x2a4a30 }), -0.2 + i * 0.12, 0.13, i);
      solidAt(0.6, 0.45);
      break;
    case 'homely': { // Сомов: книги, чайник, письма, фотографии
      shelf(-0.4, 1.2); shelf(-0.4, 1.55);
      for (let i = 0; i < 9; i++) add(new THREE.BoxGeometry(0.06, 0.24, 0.18), mk('t_book' + (i % 3), { color: [0x6a3a28, 0x3a4a6a, 0x5a5a30][i % 3] }), -0.8 + i * 0.09, 1.34 + (i > 5 ? 0.35 : 0));
      add(new THREE.CylinderGeometry(0.22, 0.24, 0.5, 7), mk('i_metal', { map: tex.metalDark }), 0.65, 0.25);
      add(new THREE.CylinderGeometry(0.09, 0.11, 0.13, 7), mk('t_kettle', { color: 0x7a7458 }), 0.65, 0.57);
      const [sx, sz] = at(0.65);
      const l = lights.add(new THREE.Vector3(sx, fl + 0.4, sz), 0xff6020, 2.2, 0.55); l.flicker = 0.3;
      for (let i = 0; i < 3; i++) add(new THREE.BoxGeometry(0.1, 0.13, 0.015), mk('t_photo', { color: 0xb0a890 }), -0.9 + i * 0.25, 1.8);
      add(new THREE.BoxGeometry(0.2, 0.01, 0.14), paper, 0.1, 0.02, 0.4);
      solidAt(0.65, 0.35);
      break;
    }
    case 'scout': // Кравец: плащ-палатки, бинокль, карта
      for (let i = 0; i < 2; i++) add(new THREE.BoxGeometry(0.08, 1.1, 0.5), mk('t_camo', { map: tex.tarp, color: 0x6a7a50 }), -0.5 + i * 0.6, 1.2);
      add(new THREE.BoxGeometry(0.2, 0.08, 0.12), mk('t_bino', { color: 0x2a2c28 }), 0.6, 0.8);
      B.box('iWood', 0.6, 0.05, 0.4, at(0.6)[0], fl + 0.74, at(0.6)[1], ry);
      add(new THREE.BoxGeometry(0.4, 0.005, 0.3), paper, 0.6, 0.78, 0.2);
      solidAt(0.6, 0.35);
      break;
    case 'barracks': { // резерв: печка, сушатся портянки, котелки
      add(new THREE.CylinderGeometry(0.24, 0.24, 0.55, 7), mk('i_metal', { map: tex.metalDark }), 0, 0.28);
      const [sx, sz] = at(0);
      const l = lights.add(new THREE.Vector3(sx, fl + 0.45, sz), 0xff5020, 2.4, 0.6); l.flicker = 0.35;
      for (let i = 0; i < 5; i++) add(new THREE.BoxGeometry(0.03, 0.3, 0.12), mk('t_cloth', { color: 0x9a9070 }), -0.8 + i * 0.4, 1.65);
      for (let i = 0; i < 4; i++) add(new THREE.CylinderGeometry(0.07, 0.06, 0.1, 6), mk('t_tin', { color: 0x5a5c50 }), 0.5 + i * 0.13, 0.05);
      solidAt(0, 0.35);
      break;
    }
    case 'command': { // командирский блиндаж: стол совещаний с картой, скамья, карта на стене
      const away = d.door === 'n' ? 1 : -1;            // от двери вглубь
      const tz = cz + 0.2 * away, farZ = away > 0 ? z1 : z0;
      const tw = 2.2, td = 1.1, ty = 0.78;
      B.box('iWood', tw, 0.07, td, cx, fl + ty, tz);
      for (const [lx, lz] of [[-1, -0.45], [1, -0.45], [-1, 0.45], [1, 0.45]]) B.box('iLog', 0.08, ty, 0.08, cx + lx, fl + ty / 2, tz + lz);
      const map = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.01, 0.9), mk('t_cmdmap', { map: tex.map || tex.doc }));
      map.position.set(cx, fl + ty + 0.045, tz); root.add(map);
      tag(map, { id: 'meeting', label: 'Стол совещаний — карта обороны' }); T.interact.push(map);
      for (let i = 0; i < 5; i++) { const f = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.12, 4), mk('t_flagpin' + (i % 2), { color: i % 2 ? 0x8a2a20 : 0x2a3a6a })); f.position.set(cx - 0.7 + i * 0.35, fl + ty + 0.11, tz + (i % 2 ? 0.2 : -0.15)); root.add(f); }
      T.solids.push([cx - tw / 2 - 0.05, cx + tw / 2 + 0.05, tz - td / 2 - 0.05, tz + td / 2 + 0.05]);
      // скамья — у стены напротив столика с телефоном
      const sideX = { n: x0 + 0.55, s: x1 - 0.55 }[d.door] ?? cx;
      const benchX = sideX < cx ? x1 - 0.3 : x0 + 0.3;
      B.box('iWood', 0.32, 0.06, 2.4, benchX, fl + 0.45, cz);
      for (const dz of [-1.0, 1.0]) B.box('iLog', 0.08, 0.45, 0.08, benchX, fl + 0.22, cz + dz);
      T.solids.push([benchX - 0.2, benchX + 0.2, cz - 1.25, cz + 1.25]);
      // карта на дальней стене и доска донесений
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.0), mk('t_wallmap', { map: tex.map || tex.doc }));
      wall.position.set(cx + 0.6, fl + 1.45, farZ - away * 0.09); wall.rotation.y = away > 0 ? Math.PI : 0; root.add(wall);
      for (let i = 0; i < 4; i++) { const pp = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.26), paper); pp.position.set(x0 + 0.6 + i * 0.27, fl + 1.5 + (i % 2) * 0.1, farZ - away * 0.09); pp.rotation.y = away > 0 ? Math.PI : 0; root.add(pp); }
      const l2 = lights.add(new THREE.Vector3(cx, fl + 1.75, tz), 0xffb060, 4.5, 1.1); l2.flicker = 0.1;
      break;
    }
    case 'med': // медпункт: ширма, бутыли, вёдра
      add(new THREE.BoxGeometry(doorAxis === 'x' ? 1.4 : 0.04, 1.6, doorAxis === 'x' ? 0.04 : 1.4), mk('i_white', { color: 0xb8b4a4 }), -0.4, 0.8);
      shelf(0.8, 1.2);
      for (let i = 0; i < 6; i++) add(new THREE.CylinderGeometry(0.04, 0.05, 0.18, 6), mk('t_vial', { color: i % 2 ? 0x6a5030 : 0x3a5a5a }), 0.5 + i * 0.12, 1.31);
      for (let i = 0; i < 2; i++) add(new THREE.CylinderGeometry(0.14, 0.11, 0.28, 7), mk('i_metal', { map: tex.metalDark }), 0.6 + i * 0.35, 0.14);
      solidAt(-0.4, 0.5);
      break;
  }
}