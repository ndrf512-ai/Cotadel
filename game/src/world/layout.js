// Единый план укрепрайона. Из него строится 3D-мир, карта окопов и маршруты людей.
// Координаты в метрах: штаб в начале координат, север = -z, восток = +x.

export const FLAT_R = 17;       // ровная площадка вокруг штаба (тыл)
export const HQ_GROUND = 1.2;   // уровень земли у штаба (пол штаба — 0)
export const R_SECOND = 26;     // вторая линия
export const R_DUG = 33;        // взводные блиндажи
export const R_FRONT = 42;      // первая линия
export const R_WIRE = 47;       // проволока
export const BOUND_R = 50;      // дальше — ничейная земля
export const R_EDGE = 44;       // перегиб ската
const DEG = Math.PI / 180;

export const polar = (r, th) => [r * Math.sin(th * DEG), -r * Math.cos(th * DEG)];

// детерминированный «случай»: траншеи всегда одинаковые, карта совпадает с местностью
let SEED = 20240611;
const srnd = () => ((SEED = (SEED * 16807) % 2147483647) / 2147483647);
const sr = (a, b) => a + (b - a) * srnd();

/** Неровная линия траншеи: изломы, ширина и глубина меняются; иногда — расширение-ниша. */
function arc(r, a0, a1, step, depth, rough = 1) {
  const pts = [];
  for (let a = a0; a <= a1 + 0.001; a += step) {
    const aa = a + (a > a0 && a < a1 ? sr(-1.5, 1.5) * rough : 0);
    const [x, z] = polar(r + sr(-1.3, 1.3) * rough, aa);
    const wide = srnd() < 0.18;
    pts.push([x, z, depth + sr(-0.12, 0.1), wide ? sr(1.35, 1.6) : sr(0.8, 1.1)]);
  }
  return pts;
}
function radial(th, list) {
  return list.map(([r, d, exact], i) => {
    const off = exact || i === 0 || i === list.length - 1 ? 0 : sr(-1.1, 1.1);
    const [x, z] = polar(r, th + (r > 0 ? off / r * 57.3 : 0));
    return [x, z, d, i === 0 ? 1 : sr(0.8, 1.05)];
  });
}
/** Тупиковая «сапа» от первой линии вперёд — пулемётный окоп или пост. */
function sap(r, a, len, depth) {
  const [x0, z0] = polar(r, a), [x1, z1] = polar(r + len * 0.55, a + sr(-4, 4)), [x2, z2] = polar(r + len, a + sr(-6, 6));
  return [[x0, z0, depth, 0.9], [x1, z1, depth, 0.8], [x2, z2, depth - 0.15, 1.3]];
}

// ---------------- траншеи ----------------
// kind: front — первая линия, second — вторая, comm — ход сообщения, sap — тупик вперёд, stub — вход в блиндаж
const F = R_FRONT, S2 = R_SECOND, D = R_DUG;
export const TRENCHES = [
  { id: 'N1', kind: 'front', sector: 'N', pts: arc(F, -42, 42, 7, 1.3) },
  { id: 'E1', kind: 'front', sector: 'E', pts: arc(F, 52, 128, 7, 1.3) },
  { id: 'S1', kind: 'front', sector: 'S', pts: arc(F, 140, 220, 7, 1.3) },
  { id: 'W1', kind: 'front', sector: 'W', pts: arc(F - 3, 250, 290, 8, 1.0, 1.4) },
  { id: 'R2', kind: 'second', sector: null, pts: arc(S2, -70, 250, 10, 1.45, 0.8) },
  { id: 'cN', kind: 'comm', sector: 'N', pts: radial(0, [[10, 0], [14, 1.4], [S2, 1.45, 1], [30, 1.45], [D, 1.45, 1], [37, 1.4], [F, 1.3, 1]]) },
  { id: 'cE', kind: 'comm', sector: 'E', pts: radial(90, [[10, 0], [14, 1.4], [S2, 1.45, 1], [30, 1.45], [D, 1.45, 1], [37, 1.4], [F, 1.3, 1]]) },
  { id: 'cS', kind: 'comm', sector: 'S', pts: radial(180, [[10, 0], [14, 1.4], [S2, 1.45, 1], [30, 1.45], [D, 1.45, 1], [37, 1.4], [F, 1.3, 1]]) },
  { id: 'cW', kind: 'comm', sector: 'W', pts: radial(270, [[10, 0], [15, 0.95], [22, 1.0], [28, 1.0], [D, 1.0, 1], [F - 3, 1.0, 1]]) },
  { id: 'xN1', kind: 'comm', sector: 'N', pts: [[...polar(F, -42), 1.3, 1], [...polar(34, -46), 1.4, 0.9], [...polar(S2, -50), 1.45, 1]] },
  { id: 'xN2', kind: 'comm', sector: 'N', pts: [[...polar(F, 42), 1.3, 1], [...polar(34, 46), 1.4, 0.9], [...polar(S2, 50), 1.45, 1]] },
  { id: 'xE2', kind: 'comm', sector: 'E', pts: [[...polar(F, 128), 1.3, 1], [...polar(34, 131), 1.4, 0.9], [...polar(S2, 130), 1.45, 1]] },
  { id: 'xS1', kind: 'comm', sector: 'S', pts: [[...polar(F, 140), 1.3, 1], [...polar(34, 137), 1.4, 0.9], [...polar(S2, 140), 1.45, 1]] },
  { id: 'xS2', kind: 'comm', sector: 'S', pts: [[...polar(F, 220), 1.3, 1], [...polar(34, 225), 1.4, 0.9], [...polar(S2, 230), 1.45, 1]] },
  { id: 'sN1', kind: 'sap', sector: 'N', pts: sap(F, -20, 4.5, 1.2) },
  { id: 'sN2', kind: 'sap', sector: 'N', pts: sap(F, 22, 3.5, 1.2) },
  { id: 'sE1', kind: 'sap', sector: 'E', pts: sap(F, 74, 4, 1.2) },
  { id: 'sS1', kind: 'sap', sector: 'S', pts: sap(F, 196, 4, 1.2) },
  { id: 'ramp', kind: 'comm', sector: null, pts: [[-4.0, 1.8, 1.2, 0.9], [-7, 1.8, 0.6, 0.9], [-10.5, 1.8, 0, 1]] },
  // входы во взводные блиндажи
  { id: 'dN', kind: 'stub', pts: [[0, -D, 1.45, 0.8], [2.8, -D, 1.45, 0.8]] },
  { id: 'dE', kind: 'stub', pts: [[D, 0, 1.45, 0.8], [D, 2.8, 1.45, 0.8]] },
  { id: 'dS', kind: 'stub', pts: [[0, D, 1.45, 0.8], [-2.8, D, 1.45, 0.8]] },
  { id: 'dW', kind: 'stub', pts: [[-D, 0, 1.0, 0.8], [-D, -2.8, 1.0, 0.8]] },
];

// ---------------- рельеф ----------------
export function baseGround(x, z) {
  const r = Math.hypot(x, z);
  let h = HQ_GROUND;
  if (r > FLAT_R) {
    const d = Math.min(r, R_EDGE) - FLAT_R;
    h -= d * d * 0.0011;
    if (r > R_EDGE) h -= (r - R_EDGE) * 0.03; // за передним краем — пологий скат, поле видно из траншеи
    h += (Math.sin(x * 0.13) + Math.cos(z * 0.11)) * 0.25 * Math.min(1, d / 10);
  }
  if (x < -26) h -= 0.5 * Math.min(1, (-26 - x) / 7); // болото на западе
  return h;
}

function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz || 1;
  let t = ((px - ax) * dx + (pz - az) * dz) / l2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + dx * t, cz = az + dz * t;
  return [Math.hypot(px - cx, pz - cz), t];
}

/** Насколько точка «вырыта» траншеями (глубина). */
export function carve(x, z) {
  let best = 0;
  for (const tr of TRENCHES) {
    const p = tr.pts;
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1];
      if (Math.abs(x - a[0]) > 12 && Math.abs(x - b[0]) > 12) continue;
      if (Math.abs(z - a[1]) > 12 && Math.abs(z - b[1]) > 12) continue;
      const [d, t] = segDist(x, z, a[0], a[1], b[0], b[1]);
      const wd = ((a[3] ?? 1) + ((b[3] ?? 1) - (a[3] ?? 1)) * t) * 0.9;
      if (d > wd + 1.0) continue;
      const depth = a[2] + (b[2] - a[2]) * t;
      const k = d <= wd ? 1 : 1 - (d - wd) / 1.0;
      const c = depth * k * k * (3 - 2 * k);
      if (c > best) best = c;
    }
  }
  return best;
}

// ---------------- постройки ----------------
// sunk: пол ниже земли (вход из траншеи); ground: на поверхности
export const HQ_RECT = [-4, 6, -5, 4];
export const DUGOUTS = [
  { id: 'dugN', unitSector: 'N', theme: 'orderly', rect: [2, 7, -35, -31], door: 'w', depth: 1.45, name: 'Блиндаж 1-го взвода' },
  { id: 'dugE', unitSector: 'E', theme: 'trophy', rect: [31, 35, 2, 7], door: 'n', depth: 1.45, name: 'Блиндаж 2-го взвода' },
  { id: 'dugS', unitSector: 'S', theme: 'homely', rect: [-7, -2, 31, 35], door: 'e', depth: 1.45, name: 'Блиндаж 3-го взвода' },
  { id: 'dugW', unitSector: 'W', theme: 'scout', rect: [-35, -31, -7, -2], door: 's', depth: 1.0, name: 'Землянка заставы «Запад»' },
  { id: 'dugR', role: 'reserve', theme: 'barracks', rect: [-15, -10, 6, 10], door: 'e', ground: true, name: 'Укрытие резерва' },
  { id: 'med', role: 'med', theme: 'med', rect: [8, 14, 4, 9], door: 'w', ground: true, name: 'Медпункт' },
];
for (const d of DUGOUTS) {
  const cx = (d.rect[0] + d.rect[1]) / 2, cz = (d.rect[2] + d.rect[3]) / 2;
  d.center = [cx, cz];
  d.floor = d.ground ? HQ_GROUND + 0.02 : baseGround(cx, cz) - d.depth;
}

export const SPOTS = {
  depot: [-12.5, -7],
  engYard: [11, -10],
  hqDoorIn: [-3.2, 1.8],
  hqDoorOut: [-10.5, 1.8],
  np: (() => { const p = TRENCHES.find((t) => t.id === 'sN1').pts[2]; return [p[0], p[1]]; })(),
  res: { hq: [-6, -10], center: [-5, 10.5], nearN: [-4, -20], nearE: [20, 4], nearS: [4, 20] },
  campfire: [-5.5, 12],
  generator: [-7.4, -2.8],
  kitchen: [1.5, 12.5],
};

// ---------------- карта высот (сетка 1 м) ----------------
export const GRID = { min: -54, max: 54, step: 1 };
const N = (GRID.max - GRID.min) / GRID.step + 1;
let HEIGHTS = null;
export function heights() {
  if (HEIGHTS) return HEIGHTS;
  HEIGHTS = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = GRID.min + i * GRID.step, z = GRID.min + j * GRID.step;
    HEIGHTS[j * N + i] = baseGround(x, z) - carve(x, z);
  }
  return HEIGHTS;
}
export const GRID_N = N;

function inRect(x, z, r, pad = 0) { return x > r[0] - pad && x < r[1] + pad && z > r[2] - pad && z < r[3] + pad; }
export function inHole(x, z) {
  if (inRect(x, z, HQ_RECT)) return { floor: 0, id: 'hq' };
  for (const d of DUGOUTS) if (inRect(x, z, d.rect)) return { floor: d.floor, id: d.id };
  return null;
}

export function terrainAt(x, z) {
  const H = heights();
  const fx = (x - GRID.min) / GRID.step, fz = (z - GRID.min) / GRID.step;
  if (fx < 0 || fz < 0 || fx >= N - 1 || fz >= N - 1) return baseGround(x, z);
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
  const a = H[j * N + i], b = H[j * N + i + 1], c = H[(j + 1) * N + i], d = H[(j + 1) * N + i + 1];
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

/** Высота пола, по которому ходят люди. */
export function floorAt(x, z) {
  const h = inHole(x, z);
  return h ? h.floor : terrainAt(x, z);
}

export function sectorOfAngle(x, z) {
  let a = Math.atan2(x, -z) / DEG; // 0 = север, по часовой
  if (a < 0) a += 360;
  if (a >= 315 || a < 45) return 'N';
  if (a < 135) return 'E';
  if (a < 225) return 'S';
  return 'W';
}

/** Зона, в которой находится точка: hq, dug:<id>, rear, или сектор. */
export function zoneAt(x, z) {
  const h = inHole(x, z);
  if (h) return h.id === 'hq' ? 'hq' : 'dug:' + h.id;
  const r = Math.hypot(x, z);
  if (r < 20) return 'rear';
  return sectorOfAngle(x, z);
}

// ---------------- позиции подразделений ----------------
const front = Object.fromEntries(TRENCHES.filter((t) => t.kind === 'front').map((t) => [t.sector, t]));
const ring = TRENCHES.find((t) => t.id === 'R2');
const SECTOR_ANG = { N: 0, E: 90, S: 180, W: 270 };

function ringSpots(s) {
  const a0 = SECTOR_ANG[s];
  return ring.pts.filter((p) => {
    let a = Math.atan2(p[0], -p[1]) / DEG; if (a < 0) a += 360;
    let d = Math.abs(a - a0); if (d > 180) d = 360 - d;
    return d <= 36;
  });
}

export const SECTOR_POS = {};
for (const s of ['N', 'E', 'S', 'W']) {
  const f = front[s].pts;
  const dug = DUGOUTS.find((d) => d.unitSector === s);
  SECTOR_POS[s] = {
    line1: f.map((p) => [p[0], p[1]]),
    line2: (s === 'W' ? TRENCHES.find((t) => t.id === 'cW').pts.slice(2, 4) : ringSpots(s)).map((p) => [p[0], p[1]]),
    mg: s === 'W' ? [] : [[f[2][0], f[2][1]], [f[f.length - 3][0], f[f.length - 3][1]]],
    dug,
    officer: [dug.center[0], dug.center[1]],
    outward: polar(1, SECTOR_ANG[s]),
  };
}

// ---------------- указатели ----------------
export const SIGNS = [
  { at: polar(11.5, 8), text: ['1 ВЗВОД ↑', 'СЕВЕР'], face: 0 },
  { at: polar(11.5, 98), text: ['2 ВЗВОД →', 'ВОСТОК'], face: 90 },
  { at: polar(11.5, 172), text: ['3 ВЗВОД ↓', 'ЮГ'], face: 180 },
  { at: polar(11.5, 262), text: ['ЗАСТАВА', 'БОЛОТО'], face: 270 },
  { at: [-11.5, 0], text: ['ШТАБ', '← ВХОД'], face: 270 },
  { at: [7, 2.8], text: ['МЕДПУНКТ', '+'], face: 45 },
  { at: [-9.5, -4], text: ['СКЛАД', ''], face: 300 },
  { at: [-8.5, 5], text: ['РЕЗЕРВ', ''], face: 250 },
  { at: polar(R_SECOND + 2.5, 8), text: ['ВТОРАЯ', 'ЛИНИЯ'], face: 0 },
  { at: polar(R_SECOND + 2.5, 98), text: ['ВТОРАЯ', 'ЛИНИЯ'], face: 90 },
  { at: polar(R_SECOND + 2.5, 172), text: ['ВТОРАЯ', 'ЛИНИЯ'], face: 180 },
];

// ---------------- граф маршрутов ----------------
export function buildNav() {
  const nodes = [], edges = [];
  const add = (x, z, tag) => { nodes.push({ x, z, tag, n: [] }); return nodes.length - 1; };
  const link = (a, b) => { if (a === b) return; const d = Math.hypot(nodes[a].x - nodes[b].x, nodes[a].z - nodes[b].z); nodes[a].n.push([b, d]); nodes[b].n.push([a, d]); };
  const trIdx = [];
  for (const tr of TRENCHES) {
    const ids = tr.pts.map((p) => add(p[0], p[1], tr.id));
    for (let i = 0; i < ids.length - 1; i++) link(ids[i], ids[i + 1]);
    trIdx.push(ids);
  }
  // стыки траншей
  for (let a = 0; a < trIdx.length; a++) for (let b = a + 1; b < trIdx.length; b++) {
    for (const i of trIdx[a]) for (const j of trIdx[b]) {
      if (Math.hypot(nodes[i].x - nodes[j].x, nodes[i].z - nodes[j].z) < 3.6) link(i, j);
    }
  }
  // тыловые точки на поверхности
  const rear = [];
  const R = (x, z, tag) => { const i = add(x, z, tag); rear.push(i); return i; };
  const doorOut = R(...SPOTS.hqDoorOut, 'hqOut');
  const doorIn = add(...SPOTS.hqDoorIn, 'hqIn');
  link(doorIn, trIdx[TRENCHES.findIndex((t) => t.id === 'ramp')][0]);
  link(doorOut, trIdx[TRENCHES.findIndex((t) => t.id === 'ramp')][2]);
  const inside = add(0.3, -0.9, 'hqTable'); link(inside, add(0, 1.4, 'hqAnte')); link(nodes.length - 1, doorIn);
  R(...SPOTS.depot, 'depot'); R(...SPOTS.engYard, 'eng');
  for (const [k, v] of Object.entries(SPOTS.res)) R(v[0], v[1], 'res:' + k);
  R(-7, 6, 'mid1'); R(7, -7, 'mid2'); R(5, 9, 'mid3'); R(-8, -7.5, 'mid4'); R(...SPOTS.kitchen, 'kitchen'); R(...SPOTS.generator, 'gen');
  for (const d of DUGOUTS) {
    const [cx, cz] = d.center;
    const di = add(cx, cz, 'in:' + d.id);
    const off = { w: [d.rect[0] - 1.6, cz], e: [d.rect[1] + 1.6, cz], n: [cx, d.rect[2] - 1.6], s: [cx, d.rect[3] + 1.6] }[d.door];
    const dn = d.ground ? R(off[0], off[1], 'door:' + d.id) : add(off[0], off[1], 'door:' + d.id);
    link(di, dn);
    if (!d.ground) {
      // ближайшая точка траншеи
      let best = -1, bd = 1e9;
      nodes.forEach((n, i) => { if (i === dn || i === di || n.tag.startsWith('in:') || n.tag.startsWith('door:')) return; const dd = Math.hypot(n.x - off[0], n.z - off[1]); if (dd < bd) { bd = dd; best = i; } });
      link(dn, best);
    }
  }
  // головы ходов сообщения соединены с тылом
  for (const id of ['cN', 'cE', 'cS', 'cW']) rear.push(trIdx[TRENCHES.findIndex((t) => t.id === id)][0]);
  for (const a of rear) for (const b of rear) if (a < b && Math.hypot(nodes[a].x - nodes[b].x, nodes[a].z - nodes[b].z) < 16) link(a, b);
  // точки резерва за пределами плоского тыла — к ближайшим узлам
  for (const k of ['nearN', 'nearE', 'nearS']) {
    const i = nodes.findIndex((n) => n.tag === 'res:' + k);
    const c = nodes.map((n, j) => [j, Math.hypot(n.x - nodes[i].x, n.z - nodes[i].z)]).filter(([j, d]) => j !== i && d < 14 && !nodes[j].tag.startsWith('in:')).sort((a, b) => a[1] - b[1]).slice(0, 2);
    for (const [j] of c) link(i, j);
  }
  return { nodes };
}

export function nearestNode(nav, x, z, filter) {
  let best = 0, bd = 1e9;
  nav.nodes.forEach((n, i) => { if (filter && !filter(n)) return; const d = (n.x - x) ** 2 + (n.z - z) ** 2; if (d < bd) { bd = d; best = i; } });
  return best;
}

export function findPath(nav, from, to) {
  const n = nav.nodes.length;
  const dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), done = new Uint8Array(n);
  dist[from] = 0;
  for (let k = 0; k < n; k++) {
    let u = -1, ud = Infinity;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < ud) { ud = dist[i]; u = i; }
    if (u < 0 || u === to) break;
    done[u] = 1;
    for (const [v, w] of nav.nodes[u].n) if (dist[u] + w < dist[v]) { dist[v] = dist[u] + w; prev[v] = u; }
  }
  const path = [];
  for (let c = to; c >= 0; c = prev[c]) path.unshift(nav.nodes[c]);
  return path[0] === nav.nodes[from] ? path : [nav.nodes[from], nav.nodes[to]];
}
