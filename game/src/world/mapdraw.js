// Карта окопов: рисуется по реальной геометрии укрепрайона (layout.js).
// Обстановка (противник, положение взводов) — только по докладам, с временем доклада.
import { SECTORS, SECTOR_IDS, fmtTime } from '../sim/data.js';
import { TRENCHES, DUGOUTS, SPOTS, SECTOR_POS, HQ_RECT, polar, R_WIRE } from './layout.js';

const EXT = 60; // метров от центра до края карты

let paperNoise = null;
function noise(w, h) {
  if (paperNoise && paperNoise.width === w && paperNoise.height === h) return paperNoise;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); const img = x.createImageData(w, h);
  let s = 7;
  for (let i = 0; i < w * h; i++) {
    s = (s * 16807) % 2147483647; const k = (s / 2147483647) * 20 - 10;
    img.data[i * 4] = 200 + k; img.data[i * 4 + 1] = 190 + k; img.data[i * 4 + 2] = 156 + k * 0.8; img.data[i * 4 + 3] = 255;
  }
  x.putImageData(img, 0, 0); paperNoise = c; return c;
}

export function drawMap(canvas, sim, big = false, player = null) {
  const w = canvas.width, h = canvas.height, x = canvas.getContext('2d');
  const sc = Math.min(w, h) / (EXT * 2);
  const P = (px, pz) => [w / 2 + px * sc, h / 2 + pz * sc];
  const fs = big ? 12 : 6, lw = big ? 1 : 0.6;
  x.imageSmoothingEnabled = false;
  x.drawImage(noise(w, h), 0, 0);
  // рельеф: горизонтали высоты
  x.strokeStyle = 'rgba(120,96,60,.35)'; x.lineWidth = lw;
  for (const r of [17, 26, 35, 44, 53]) { x.beginPath(); const [cx, cy] = P(0, 0); x.arc(cx, cy, r * sc, 0, Math.PI * 2); x.stroke(); }
  // болото
  x.fillStyle = 'rgba(70,96,86,.5)';
  for (let i = 0; i < 70; i++) { const [u, v] = P(-80 + (i * 37 % 44), -40 + (i * 53 % 80)); x.fillRect(u, v, big ? 7 : 3, 1); }
  // дорога на юг
  x.strokeStyle = 'rgba(100,80,56,.55)'; x.lineWidth = big ? 2 : 1;
  { const [a, b] = P(...polar(18, 185)); const [c, d] = P(...polar(70, 185)); x.beginPath(); x.moveTo(a, b); x.lineTo(c, d); x.stroke(); }
  // кладбище
  x.fillStyle = 'rgba(60,50,40,.6)';
  for (let i = 0; i < 8; i++) { const [u, v] = P(...polar(30 + (i % 3) * 3, 72 + i * 4)); x.fillRect(u, v - 2, 1, big ? 6 : 3); x.fillRect(u - 1, v - 1, big ? 3 : 2, 1); }
  // проволока
  x.strokeStyle = 'rgba(40,36,30,.6)'; x.lineWidth = lw;
  for (const [a0, a1] of [[-50, 50], [45, 135], [135, 225]]) {
    for (let a = a0; a < a1; a += 4) { const [u, v] = P(...polar(R_WIRE, a)); x.beginPath(); x.moveTo(u - 2, v - 2); x.lineTo(u + 2, v + 2); x.moveTo(u + 2, v - 2); x.lineTo(u - 2, v + 2); x.stroke(); }
  }
  // траншеи — реальная геометрия
  for (const tr of TRENCHES) {
    x.strokeStyle = tr.kind === 'front' ? '#2a2620' : tr.kind === 'second' ? '#3a342a' : '#5a5040';
    x.lineWidth = (tr.kind === 'front' ? 3 : tr.kind === 'second' ? 2.4 : 1.8) * (big ? 1.4 : 0.6);
    x.beginPath();
    tr.pts.forEach((p, i) => { const [u, v] = P(p[0], p[1]); i ? x.lineTo(u, v) : x.moveTo(u, v); });
    x.stroke();
  }
  // постройки
  const rect = (r, fill, label) => {
    const [a, b] = P(r[0], r[2]); const [c, d] = P(r[1], r[3]);
    x.fillStyle = fill; x.fillRect(a, b, c - a, d - b); x.strokeStyle = '#2a2620'; x.lineWidth = lw; x.strokeRect(a, b, c - a, d - b);
    if (label && big) { x.fillStyle = '#2a2620'; x.font = `${fs - 2}px monospace`; x.textAlign = 'center'; x.fillText(label, (a + c) / 2, d + fs); }
  };
  rect(HQ_RECT, '#4a4032', null);
  for (const d of DUGOUTS) rect(d.rect, d.role === 'med' ? '#c8b8a0' : '#7a6a50', d.role === 'med' ? 'медпункт' : d.role === 'reserve' ? 'резерв' : d.unitSector === 'W' ? 'застава' : `блиндаж ${({ N: 1, E: 2, S: 3 })[d.unitSector]} вз.`);
  { const [u, v] = P(...SPOTS.depot); x.strokeStyle = '#2a2620'; x.strokeRect(u - 3 * sc, v - 2.5 * sc, 6 * sc, 5 * sc); if (big) { x.fillStyle = '#2a2620'; x.font = `${fs - 2}px monospace`; x.textAlign = 'center'; x.fillText('склад', u, v + 4 * sc + fs); } }
  { const [u, v] = P(...SPOTS.engYard); x.fillStyle = '#6a5a40'; for (let i = 0; i < 3; i++) x.fillRect(u - 3 * sc, v - 1.5 * sc + i * sc, 4 * sc, sc * 0.6); if (big) { x.fillStyle = '#2a2620'; x.font = `${fs - 2}px monospace`; x.textAlign = 'center'; x.fillText('инженеры', u, v + 3 * sc + fs); } }
  // НП и пулемёты
  { const [u, v] = P(...SPOTS.np); x.strokeStyle = '#2a2620'; x.beginPath(); x.arc(u, v, big ? 5 : 2.5, 0, 7); x.stroke(); if (big) { x.fillStyle = '#2a2620'; x.font = `${fs - 2}px monospace`; x.fillText('НП', u + 10, v - 6); } }
  for (const s of ['N', 'E', 'S']) for (const [mx, mz] of SECTOR_POS[s].mg) {
    const [u, v] = P(mx, mz); x.fillStyle = '#2a2620'; x.beginPath(); x.arc(u, v, big ? 3.5 : 1.8, 0, 7); x.fill();
    const o = SECTOR_POS[s].outward; x.strokeStyle = '#2a2620'; x.beginPath(); x.moveTo(u, v); x.lineTo(u + o[0] * (big ? 12 : 5), v + o[1] * (big ? 12 : 5)); x.stroke();
  }
  // позиции резерва
  for (const [k, [rx, rz]] of Object.entries(SPOTS.res)) { const [u, v] = P(rx, rz); x.strokeStyle = 'rgba(42,58,122,.5)'; x.setLineDash([2, 2]); x.strokeRect(u - (big ? 6 : 3), v - (big ? 4 : 2), big ? 12 : 6, big ? 8 : 4); x.setLineDash([]); }

  // --- обстановка по докладам ---
  for (const s of SECTOR_IDS) {
    const k = sim.knowledge[s];
    const sp = SECTOR_POS[s];
    const mid = sp.line1[Math.floor(sp.line1.length / 2)];
    const [lx, ly] = P(...polar(s === 'E' || s === 'W' ? 52 : 55, { N: 0, E: 90, S: 180, W: 270 }[s]));
    x.fillStyle = '#2a2620'; x.font = `bold ${fs}px monospace`; x.textAlign = 'center';
    x.fillText(SECTORS[s].name.toUpperCase(), lx, ly - (big ? 6 : 2));
    x.font = `${big ? 10 : 5}px monospace`; x.fillStyle = '#5b5244';
    x.fillText(`доклад ${fmtTime(k.t).hm}${sim.t - k.t > 120 ? ' (устар.)' : ''}`, lx, ly + (big ? 7 : 4));
    if (k.line === 'cut') { x.fillStyle = '#8a2018'; x.fillText('✕ нет связи', lx, ly + (big ? 18 : 9)); }
    if (k.held === 'lost') {
      x.strokeStyle = 'rgba(140,30,20,.75)'; x.lineWidth = big ? 1.5 : 1;
      for (const [px, pz] of sp.line1) { const [u, v] = P(px, pz); x.beginPath(); x.moveTo(u - 5, v - 5); x.lineTo(u + 5, v + 5); x.stroke(); }
    }
    const our = k.our ? sim.platoons[k.our] : null;
    if (our && k.held !== 'lost') {
      const line = k.held === 'line2' ? sp.line2 : sp.line1;
      const q = line[Math.floor(line.length / 2)];
      const [u, v] = P(q[0] - sp.outward[0] * 5, q[1] - sp.outward[1] * 5);
      unit(x, u, v, our, big);
    }
    if (k.enemy && !/тихо|нет данных|отбита/.test(k.enemy)) {
      const o = sp.outward;
      const [a, b] = P(mid[0] + o[0] * 22, mid[1] + o[1] * 22), [c, d] = P(mid[0] + o[0] * 8, mid[1] + o[1] * 8);
      arrow(x, a, b, c, d, big);
      x.fillStyle = '#8a2018'; x.font = `${big ? 10 : 5}px monospace`; x.textAlign = 'center';
      x.fillText(k.enemy, a + (s === 'E' ? -10 : s === 'W' ? 10 : 0), b + (s === 'N' ? -4 : big ? 12 : 6));
    }
    if (k.combat) { const [u, v] = P(mid[0], mid[1]); x.fillStyle = '#b02010'; star(x, u, v, big ? 7 : 3); }
  }
  for (const p of Object.values(sim.platoons)) {
    if (p.men <= 0) continue;
    if (p.where.type === 'res') { const [u, v] = P(...SPOTS.res[p.where.loc]); unit(x, u, v, p, big, true); }
    if (p.where.type === 'move') {
      const to = p.where.to;
      const dst = to.sector ? SECTOR_POS[to.sector].dug.center : SPOTS.res[to.loc] || SPOTS.res.center;
      const [u, v] = P(...dst); x.fillStyle = '#2a3a7a'; x.font = `${big ? 10 : 5}px monospace`; x.textAlign = 'center';
      x.fillText(`${p.call} → ${fmtTime(p.where.eta).hm}`, u, v - (big ? 10 : 5));
    }
  }
  if (sim.hq.stage >= 3) { const [u, v] = P(1.5, -0.5); x.strokeStyle = '#8a2018'; x.lineWidth = 2; x.beginPath(); x.arc(u, v, big ? 24 : 10, 0, 7); x.stroke(); }
  // «вы здесь»
  if (player) {
    const [u, v] = P(player.x, player.z);
    x.fillStyle = '#b02010'; x.beginPath();
    const a = player.yaw;
    x.moveTo(u - Math.sin(a) * 9, v - Math.cos(a) * 9);
    x.lineTo(u - Math.sin(a + 2.5) * 6, v - Math.cos(a + 2.5) * 6);
    x.lineTo(u - Math.sin(a - 2.5) * 6, v - Math.cos(a - 2.5) * 6);
    x.closePath(); x.fill();
    x.font = `${fs}px monospace`; x.textAlign = 'left'; x.fillText('вы здесь', u + 9, v + 4);
  }
  // роза ветров
  x.fillStyle = '#2a2620'; x.font = `bold ${fs}px monospace`; x.textAlign = 'center';
  x.fillText('С', w - (big ? 20 : 9), big ? 18 : 8); x.fillText('↑', w - (big ? 20 : 9), big ? 32 : 15);
}

function unit(x, u, v, p, big, res = false) {
  const W = big ? 26 : 11, H = big ? 15 : 7;
  x.fillStyle = res ? 'rgba(42,58,122,.15)' : 'rgba(42,58,122,.3)'; x.strokeStyle = '#2a3a7a'; x.lineWidth = big ? 2 : 1;
  x.fillRect(u - W / 2, v - H / 2, W, H); x.strokeRect(u - W / 2, v - H / 2, W, H);
  x.beginPath(); x.moveTo(u - W / 2, v - H / 2); x.lineTo(u + W / 2, v + H / 2); x.moveTo(u + W / 2, v - H / 2); x.lineTo(u - W / 2, v + H / 2); x.stroke();
  x.fillStyle = '#1a2450'; x.font = `bold ${big ? 11 : 6}px monospace`; x.textAlign = 'center';
  x.fillText(p.id === 'pw' ? 'Заст.' : p.id.slice(1), u, v - H / 2 - 2);
}
function arrow(x, x0, y0, x1, y1, big) {
  x.strokeStyle = '#8a2018'; x.lineWidth = big ? 3 : 1.5;
  x.beginPath(); x.moveTo(x0, y0); x.lineTo(x1, y1); x.stroke();
  const a = Math.atan2(y1 - y0, x1 - x0), L = big ? 9 : 4;
  x.beginPath(); x.moveTo(x1, y1); x.lineTo(x1 - Math.cos(a - 0.5) * L, y1 - Math.sin(a - 0.5) * L); x.moveTo(x1, y1); x.lineTo(x1 - Math.cos(a + 0.5) * L, y1 - Math.sin(a + 0.5) * L); x.stroke();
}
function star(x, u, v, r) {
  x.beginPath();
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2, rr = i % 2 ? r / 2 : r; x.lineTo(u + Math.cos(a) * rr, v + Math.sin(a) * rr); }
  x.closePath(); x.fill();
}

export function drawWallMap(c) {
  const x = c.getContext('2d'), w = c.width, h = c.height;
  x.fillStyle = '#c6bb98'; x.fillRect(0, 0, w, h);
  const sc = Math.min(w, h) / 170;
  x.strokeStyle = '#3a3428'; x.lineWidth = 1;
  for (const tr of TRENCHES) { x.beginPath(); tr.pts.forEach((p, i) => { const u = w / 2 + p[0] * sc, v = h / 2 + p[1] * sc; i ? x.lineTo(u, v) : x.moveTo(u, v); }); x.stroke(); }
  x.fillStyle = '#8a2018'; x.fillRect(w / 2 - 1, h / 2 - 1, 3, 3);
}
