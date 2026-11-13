// Наполнение территории: у каждой зоны свой характер. Всё сливается в общие меши (Batch).
import * as THREE from 'three';
import { TRENCHES, DUGOUTS, SPOTS, SECTOR_POS, baseGround, floorAt, carve, inHole, polar, HQ_GROUND, R_SECOND, R_FRONT } from './layout.js';
import { M } from '../engine/geo.js';
import { mat } from '../engine/ps1.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const G0 = HQ_GROUND;

export function decorate(B, T, lights, tex, mats) {
  Object.assign(mats, {
    barrel: M('p_barrel', { map: tex.metal, color: 0x7a7458, outdoor: true }),
    barrelR: M('p_barrelR', { map: tex.metal, color: 0x8a5a3a, outdoor: true }),
    white: M('p_white', { color: 0xc8c4b4, outdoor: true }),
    red: M('p_red', { color: 0x8a2018, outdoor: true }),
    iron: M('p_iron', { map: tex.metalDark, outdoor: true }),
    cable: M('p_cable', { color: 0x1a1a18, outdoor: true }),
    brass: M('p_brass', { color: 0x9a8040, outdoor: true }),
    canvas: M('p_canvas', { map: tex.tarp, color: 0xb0a888, outdoor: true }),
    green: M('p_green', { color: 0x4a5a3a, outdoor: true }),
  });
  const barrel = (x, z, k = 'barrel', tip = false) => B.add(k, new THREE.CylinderGeometry(0.3, 0.3, 0.85, 8), x, baseGround(x, z) + (tip ? 0.3 : 0.42), z, rnd(0, 3), tip ? Math.PI / 2 : 0);
  const crate = (x, z, y = 0, ry = rnd(0, 0.4)) => B.box('crate', 0.7, 0.4, 0.45, x, floorAt(x, z) + 0.2 + y, z, ry);
  const solid = (x, z, r = 0.4) => T.solids.push([x - r, x + r, z - r, z + r]);

  // ---------- штабной двор: генератор, полевая кухня, бочки ----------
  {
    const [x, z] = SPOTS.generator;
    B.box('iron', 1.3, 0.8, 0.8, x, G0 + 0.45, z);          // генератор
    B.box('iron', 0.4, 0.4, 0.5, x + 0.85, G0 + 0.3, z);
    B.add('iron', new THREE.CylinderGeometry(0.06, 0.06, 1.2, 5), x - 0.4, G0 + 1.25, z);
    B.box('log', 1.8, 0.1, 1.2, x, G0 + 1.4, z);              // навес
    for (const [dx, dz] of [[-0.85, -0.55], [0.85, -0.55], [-0.85, 0.55], [0.85, 0.55]]) B.box('log', 0.08, 1.4, 0.08, x + dx, G0 + 0.7, z + dz);
    T.solids.push([x - 0.9, x + 1.1, z - 0.6, z + 0.6]);
    T.dynamic.generator = { x, z };
    // кабель от генератора к штабу
    B.box('cable', 4.5, 0.03, 0.03, x + 2.3, G0 + 0.03, z + 1.2, -0.5);
    barrel(x - 1.6, z + 0.6); barrel(x - 1.6, z - 0.2, 'barrelR'); barrel(x - 2.2, z + 0.3, 'barrel', true);
    solid(x - 1.8, z + 0.2, 0.7);
  }
  {
    // полевая кухня у резерва
    const [x, z] = SPOTS.kitchen;
    B.add('iron', new THREE.CylinderGeometry(0.45, 0.45, 0.8, 8), x, G0 + 0.85, z, 0, 0, Math.PI / 2);
    B.add('iron', new THREE.CylinderGeometry(0.06, 0.06, 1.0, 5), x - 0.3, G0 + 1.55, z);
    for (const dx of [-0.8, 0.8]) B.add('log', new THREE.CylinderGeometry(0.3, 0.3, 0.08, 8), x + dx * 0.9, G0 + 0.3, z, 0, Math.PI / 2);
    B.box('log', 2.0, 0.1, 0.1, x, G0 + 0.3, z + 0.6);
    solid(x, z, 1.0);
    T.dynamic.kitchen = { x, z };
    const l = lights.add(new THREE.Vector3(x, G0 + 0.6, z + 0.5), 0xff7030, 3, 0.6); l.flicker = 0.3;
    // столы и скамьи
    for (const dz of [2.2, 3.9]) {
      B.box('planks', 2.4, 0.06, 0.7, x + 3.5, G0 + 0.75, z + dz);
      for (const dx of [-1.1, 1.1]) B.box('log', 0.08, 0.75, 0.6, x + 3.5 + dx, G0 + 0.37, z + dz);
      for (const s of [-0.6, 0.6]) B.box('planks', 2.2, 0.06, 0.3, x + 3.5, G0 + 0.45, z + dz + s);
      T.solids.push([x + 2.2, x + 4.8, z + dz - 0.4, z + dz + 0.4]);
      B.add('iron', new THREE.CylinderGeometry(0.06, 0.05, 0.08, 6), x + 3 + dz * 0.1, G0 + 0.82, z + dz);
    }
  }
  // ---------- медпункт ----------
  {
    const md = DUGOUTS.find((d) => d.id === 'med');
    const [x0, , z0, z1] = md.rect;
    // флаг с красным крестом
    B.box('post', 0.07, 3.2, 0.07, x0 - 0.6, G0 + 1.6, z0 - 0.4);
    B.box('white', 0.03, 0.6, 0.9, x0 - 0.6, G0 + 2.8, z0 + 0.05);
    B.box('red', 0.035, 0.45, 0.14, x0 - 0.6, G0 + 2.8, z0 + 0.05); B.box('red', 0.035, 0.14, 0.45, x0 - 0.6, G0 + 2.8, z0 + 0.05);
    // носилки и вёдра у входа
    for (let i = 0; i < 2; i++) {
      const sx = x0 - 1.4, sz = i ? z1 - 0.2 : z0 + 0.2; // по краям, проход к двери свободен
      B.box('canvas', 0.6, 0.05, 1.9, sx, G0 + 0.18, sz);
      for (const dx of [-0.32, 0.32]) B.box('log', 0.05, 0.05, 2.3, sx + dx, G0 + 0.17, sz);
      T.solids.push([sx - 0.4, sx + 0.4, sz - 1.1, sz + 1.1]);
    }
    B.add('iron', new THREE.CylinderGeometry(0.15, 0.12, 0.3, 7), x0 - 1.0, G0 + 0.15, z1 - 0.2);
    B.add('iron', new THREE.CylinderGeometry(0.15, 0.12, 0.3, 7), x0 - 0.7, G0 + 0.15, z1 + 0.2);
    // верёвка с бинтами
    B.box('post', 0.06, 1.8, 0.06, md.rect[1] + 0.8, G0 + 0.9, z0 - 0.6);
    B.box('post', 0.06, 1.8, 0.06, md.rect[1] + 0.8, G0 + 0.9, z1 + 0.6);
    B.box('cable', 0.02, 0.02, z1 - z0 + 1.2, md.rect[1] + 0.8, G0 + 1.75, (z0 + z1) / 2);
    for (let i = 0; i < 7; i++) B.box('white', 0.02, rnd(0.3, 0.6), 0.25, md.rect[1] + 0.8, G0 + 1.45, z0 - 0.2 + i * 0.85);
  }
  // ---------- склад ----------
  {
    const [x, z] = SPOTS.depot;
    for (let i = 0; i < 6; i++) barrel(x + 3.8 + (i % 2) * 0.65, z - 1.8 + Math.floor(i / 2) * 0.7, i % 3 ? 'barrel' : 'barrelR');
    T.solids.push([x + 3.4, x + 4.8, z - 2.2, z + 0.4]);
    crate(x + 1.2, z + 2.6, 0, 0.3); crate(x + 1.3, z + 2.6, 0.4, 0.5);
    B.box('planks', 0.8, 0.5, 0.05, x - 3.6, G0 + 0.25, z + 1); // открытый ящик
    B.box('iron', 0.5, 0.9, 0.5, x - 3.5, G0 + 0.45, z - 1.6); // весы
    B.box('iron', 0.7, 0.05, 0.6, x - 3.5, G0 + 0.92, z - 1.6);
    T.solids.push([x - 3.9, x - 3.1, z - 2.0, z - 1.2]);
    for (let i = 0; i < 10; i++) B.box('brass', 0.03, 0.1, 0.03, x + rnd(-2, 2), G0 + 0.05, z + rnd(1, 2.4), 0, rnd(0, 1.5)); // гильзы
  }
  // ---------- инженерный двор ----------
  {
    const [x, z] = SPOTS.engYard;
    for (let i = 0; i < 4; i++) B.box('planks', 2.6, 0.05, 0.3, x - 1, G0 + 0.03 + i * 0.05, z + 2.6 + (i % 2) * 0.05, 0.05 * i);
    B.box('bag', 0.5, 0.3, 0.4, x + 3.2, G0 + 0.15, z + 1.4);
    for (let i = 0; i < 3; i++) { B.box('log', 0.04, 1.0, 0.04, x + 3.6 + i * 0.25, G0 + 0.5, z - 2.5, 0, 0.15); B.box('iron', 0.18, 0.22, 0.02, x + 3.6 + i * 0.25, G0 + 0.08, z - 2.45); }
    B.add('cable', new THREE.TorusGeometry(0.35, 0.08, 4, 8), x + 2.4, G0 + 0.08, z + 2.5, 0, Math.PI / 2); // катушка проволоки
    barrel(x + 3.6, z + 0.2);
    T.solids.push([x + 3.1, x + 4.2, z - 0.3, z + 1.8]);
  }
  // ---------- линии связи на кольях вдоль ходов сообщения ----------
  for (const id of ['cN', 'cE', 'cS', 'cW']) {
    const tr = TRENCHES.find((t) => t.id === id);
    const p = tr.pts;
    let prev = null;
    for (let i = 0; i < p.length - 1; i++) {
      const [ax, az] = p[i], [bx, bz] = p[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const nx = (bz - az) / len, nz = -(bx - ax) / len;
      for (let d = 0; d < len; d += 6) {
        const x = ax + (bx - ax) * d / len + nx * 2.4, z = az + (bz - az) * d / len + nz * 2.4;
        if (inHole(x, z) || carve(x, z) > 0.2) continue;
        const y = baseGround(x, z);
        B.box('post', 0.07, 1.3, 0.07, x, y + 0.65, z);
        if (prev) {
          const cl = Math.hypot(x - prev[0], z - prev[2]);
          B.box('cable', 0.02, 0.02, cl, (x + prev[0]) / 2, (y + prev[1]) / 2 + 1.15, (z + prev[2]) / 2, Math.atan2(x - prev[0], z - prev[2]));
        }
        prev = [x, y, z];
      }
    }
  }
  // ---------- передовая: суровая, побитая ----------
  for (const s of ['N', 'E', 'S', 'W']) {
    const sp = SECTOR_POS[s];
    const out = sp.outward;
    sp.line1.forEach(([x, z], i) => {
      // ниша с патронами и гранатами, лопата
      if (i % 2 === 0) {
        const nx = x - out[0] * 0.75, nz = z - out[1] * 0.75;
        B.box('crate', 0.45, 0.3, 0.3, nx, floorAt(nx, nz) + 0.15, nz, Math.atan2(out[0], out[1]));
      }
      if (i % 3 === 1) B.box('post', 0.04, 1.1, 0.04, x + out[0] * 0.7, floorAt(x, z) + 0.6, z + out[1] * 0.7, 0, 0.3, 0.2);
      if (i % 4 === 2 && s !== 'W') { // перископ над бруствером
        const px = x + out[0] * 0.8, pz = z + out[1] * 0.8;
        B.box('iron', 0.08, 1.6, 0.06, px, floorAt(px, pz) + 0.8, pz);
      }
      // гильзы
      for (let k = 0; k < 3; k++) B.box('brass', 0.03, 0.08, 0.03, x + rnd(-0.6, 0.6), floorAt(x, z) + 0.06, z + rnd(-0.6, 0.6), 0, rnd(0, 1.5));
    });
    // воронки и обломки вдоль позиций
    for (let k = 0; k < 9; k++) {
      const [x, z] = polar(rnd(R_SECOND + 5, R_FRONT + 4), { N: 0, E: 90, S: 180, W: 270 }[s] + rnd(-40, 40));
      if (carve(x, z) > 0.2 || inHole(x, z)) continue;
      const y = baseGround(x, z);
      B.add('earth', new THREE.CylinderGeometry(rnd(0.9, 1.6), rnd(1.4, 2.2), 0.3, 7), x, y - 0.08, z);
      B.add('dark', new THREE.CircleGeometry(rnd(0.6, 1.0), 7).rotateX(-Math.PI / 2), x, y + 0.08, z);
      B.box('planksV', rnd(0.8, 1.6), 0.06, 0.25, x + rnd(-1.5, 1.5), y + 0.05, z + rnd(-1.5, 1.5), rnd(0, 3), 1, rnd(-0.2, 0.2));
    }
    // разбитый участок обшивки
    const [bx, bz] = sp.line1[1];
    B.box('planksV', 1.4, 0.06, 0.3, bx + 0.5, floorAt(bx, bz) + 0.1, bz + 0.3, 0.7, 1, 0.3);
  }
  // ---------- места отдыха у блиндажей ----------
  for (const d of DUGOUTS) {
    if (!d.unitSector) continue;
    const door = { w: [d.rect[0] - 0.4, (d.rect[2] + d.rect[3]) / 2], e: [d.rect[1] + 0.4, (d.rect[2] + d.rect[3]) / 2], n: [(d.rect[0] + d.rect[1]) / 2, d.rect[2] - 0.4], s: [(d.rect[0] + d.rect[1]) / 2, d.rect[3] + 0.4] }[d.door];
    const [cx, cz] = d.center;
    // котелок и ящик-табурет внутри у входа
    B.box('crate', 0.45, 0.35, 0.35, cx + (door[0] - cx) * 0.5 + 0.5, d.floor + 0.17, cz + (door[1] - cz) * 0.5 + 0.3);
    // на крыше блиндажа — мешки и труба
    B.add('iron', new THREE.CylinderGeometry(0.06, 0.06, 0.9, 5), cx + 0.8, d.floor + 2.15 + 0.6, cz - 0.4);
    B.box('bag', 0.8, 0.28, 0.45, cx - 0.6, d.floor + 2.15 + 0.6, cz + 0.6, 0.4);
    // табличка
  }
  // ---------- тыл: бочки с водой, тележка, бельё ----------
  barrel(-3, 6.5); barrel(-2.4, 6.9, 'barrel'); solid(-2.7, 6.7, 0.75);
  {
    const [x, z] = [4, -12.5];
    B.box('planks', 1.2, 0.08, 2.0, x, G0 + 0.55, z, 0.2);
    B.add('log', new THREE.CylinderGeometry(0.45, 0.45, 0.08, 8), x - 0.7, G0 + 0.45, z + 0.3, 0.2, 0, Math.PI / 2);
    B.add('log', new THREE.CylinderGeometry(0.45, 0.45, 0.08, 8), x + 0.6, G0 + 0.45, z + 0.55, 0.2, 0, Math.PI / 2);
    T.solids.push([x - 0.8, x + 0.8, z - 1.1, z + 1.1]);
    crate(x, z + 0.1, 0.35, 0.2);
  }
  // мешки с песком — дополнительные укрытия в тылу
  for (const [x, z, ry] of [[-9, -12, 0.3], [9, 13, -0.4], [-14, 3.5, 1.4], [14, -3, 1.6]]) {
    for (let i = 0; i < 3; i++) { B.box('bag', 1.0, 0.32, 0.5, x + Math.cos(ry) * (i - 1) * 1.0, baseGround(x, z) + 0.16, z - Math.sin(ry) * (i - 1) * 1.0, ry); B.box('bag', 0.9, 0.3, 0.5, x + Math.cos(ry) * (i - 1) * 1.0, baseGround(x, z) + 0.46, z - Math.sin(ry) * (i - 1) * 1.0, ry + 0.05); }
    T.solids.push([x - 1.6, x + 1.6, z - 1.6, z + 1.6].map((v, i) => i < 2 ? x + (i ? 1 : -1) * (Math.abs(Math.cos(ry)) * 1.5 + 0.3) : z + (i === 3 ? 1 : -1) * (Math.abs(Math.sin(ry)) * 1.5 + 0.3)));
  }
  // фонари на столбах вдоль тыловых троп
  for (const [x, z] of [[-9.5, 4], [11.5, 2.5], [-8.5, -9.5], [4, -10], [-2.5, 9]]) {
    B.box('post', 0.08, 2.2, 0.08, x, G0 + 1.1, z);
    B.box('iron', 0.18, 0.22, 0.18, x + 0.2, G0 + 2.0, z);
    const l = lights.add(new THREE.Vector3(x + 0.2, G0 + 1.9, z), 0xffb060, 5, 0.55); l.flicker = 0.12; l.night = true;
    (T.dynamic.lanterns = T.dynamic.lanterns || []).push(l);
    solid(x, z, 0.15);
  }
}
