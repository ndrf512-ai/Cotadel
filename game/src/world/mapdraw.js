// Штабная карта: рисуется ТОЛЬКО по тому, что известно капитану (доклады с отметкой времени).
import { SECTORS, SECTOR_IDS, RES_LOCS, fmtTime } from '../sim/data.js';

const POS = {
  N: { l1: [0.5, 0.17], l2: [0.5, 0.31], lbl: [0.5, 0.06] },
  E: { l1: [0.86, 0.5], l2: [0.72, 0.52], lbl: [0.9, 0.36] },
  S: { l1: [0.5, 0.9], l2: [0.5, 0.77], lbl: [0.5, 0.98] },
  W: { l1: [0.13, 0.55], l2: [0.27, 0.55], lbl: [0.1, 0.4] },
};
const RES = { hq: [0.5, 0.56], center: [0.52, 0.46], nearN: [0.44, 0.37], nearE: [0.66, 0.44], nearS: [0.56, 0.68] };
export const HQ_POS = [0.5, 0.56];

let paperNoise = null;
function noise(w, h) {
  if (paperNoise && paperNoise.width === w) return paperNoise;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  const img = x.createImageData(w, h);
  let s = 7;
  for (let i = 0; i < w * h; i++) {
    s = (s * 16807) % 2147483647;
    const k = (s / 2147483647) * 22 - 11;
    img.data[i * 4] = 200 + k; img.data[i * 4 + 1] = 190 + k; img.data[i * 4 + 2] = 156 + k * 0.8; img.data[i * 4 + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  paperNoise = c;
  return c;
}

export function drawMap(canvas, sim, big = false) {
  const w = canvas.width, h = canvas.height, x = canvas.getContext('2d');
  const P = ([u, v]) => [u * w, v * h];
  const fs = big ? 13 : 7;
  x.imageSmoothingEnabled = false;
  x.drawImage(noise(w, h), 0, 0);
  x.lineWidth = big ? 1.5 : 1;
  // рельеф: горизонтали высоты
  x.strokeStyle = 'rgba(110,90,60,.45)';
  for (let r = 1; r <= 4; r++) { x.beginPath(); x.ellipse(w * 0.5, h * 0.53, w * 0.09 * r, h * 0.11 * r, 0, 0, Math.PI * 2); x.stroke(); }
  // болото на западе
  x.fillStyle = 'rgba(70,90,80,.55)';
  for (let i = 0; i < 40; i++) { const u = 0.02 + (i * 37 % 100) / 100 * 0.18, v = 0.35 + (i * 53 % 100) / 100 * 0.4; x.fillRect(u * w, v * h, big ? 8 : 4, 1); }
  // дорога на юг
  x.strokeStyle = 'rgba(90,70,50,.6)';
  x.beginPath(); x.moveTo(w * 0.48, h * 0.6); x.lineTo(w * 0.45, h); x.moveTo(w * 0.52, h * 0.6); x.lineTo(w * 0.55, h); x.stroke();
  // кладбище на востоке
  x.fillStyle = 'rgba(60,50,40,.6)';
  for (let i = 0; i < 9; i++) { const [u, v] = P([0.85 + (i % 3) * 0.03, 0.56 + Math.floor(i / 3) * 0.04]); x.fillRect(u, v - (big ? 4 : 2), 1, big ? 8 : 4); x.fillRect(u - (big ? 2 : 1), v - (big ? 2 : 1), big ? 5 : 3, 1); }
  // берёзы на севере
  for (let i = 0; i < 10; i++) { const [u, v] = P([0.35 + i * 0.03, 0.09 + (i % 2) * 0.02]); x.beginPath(); x.arc(u, v, big ? 3 : 1.5, 0, 7); x.stroke(); }

  // линии обороны и сектора
  for (const s of SECTOR_IDS) {
    const k = sim.knowledge[s];
    const p = POS[s];
    const [a, b] = P(p.l1), [c, d] = P(p.l2);
    const horiz = s === 'N' || s === 'S';
    const L = big ? 70 : 28;
    x.strokeStyle = 'rgba(40,40,40,.7)';
    x.setLineDash([big ? 6 : 3, big ? 4 : 2]);
    x.beginPath();
    if (horiz) { x.moveTo(a - L, b); x.lineTo(a + L, b); x.moveTo(c - L * 0.7, d); x.lineTo(c + L * 0.7, d); }
    else { x.moveTo(a, b - L); x.lineTo(a, b + L); x.moveTo(c, d - L * 0.7); x.lineTo(c, d + L * 0.7); }
    x.stroke(); x.setLineDash([]);
    // подпись сектора
    const [lx, ly] = P(p.lbl);
    x.fillStyle = '#2a2620'; x.font = `${fs}px monospace`; x.textAlign = 'center';
    x.fillText(SECTORS[s].name.toUpperCase(), lx, ly);
    // потерян
    if (k.held === 'lost') {
      x.strokeStyle = 'rgba(140,30,20,.75)';
      const [u, v] = P(p.l2);
      for (let i = -4; i <= 4; i++) { x.beginPath(); x.moveTo(u + i * (big ? 10 : 4) - (big ? 30 : 12), v - (big ? 30 : 12)); x.lineTo(u + i * (big ? 10 : 4) + (big ? 30 : 12), v + (big ? 30 : 12)); x.stroke(); }
    }
    // наш взвод (по последнему докладу)
    const our = k.our ? sim.platoons[k.our] : null;
    if (our && k.held !== 'lost') {
      const [u, v] = P(k.held === 'line2' ? p.l2 : p.l1);
      unit(x, u, v, our, big);
    }
    // противник
    if (k.enemy && k.enemy !== 'тихо' && k.enemy !== 'нет данных' && !k.enemy.includes('отбита')) {
      const out = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] }[s];
      const [u, v] = P(p.l1);
      const off = big ? 40 : 16;
      arrow(x, u + out[0] * off * 1.6, v + out[1] * off * 1.2, u + out[0] * off * 0.3, v + out[1] * off * 0.3, big);
      x.fillStyle = '#8a2018'; x.font = `${big ? 11 : 6}px monospace`;
      x.fillText(k.enemy, u + out[0] * off * 1.3, v + out[1] * off * 1.6 + (s === 'N' ? -2 : big ? 12 : 6));
    }
    if (k.combat) { x.fillStyle = '#b02010'; const [u, v] = P(k.held === 'line2' ? p.l2 : p.l1); star(x, u + (big ? 22 : 9), v - (big ? 14 : 6), big ? 7 : 3); }
    // время доклада и связь
    x.fillStyle = '#5b5244'; x.font = `${big ? 11 : 6}px monospace`;
    const [tx, ty] = P(p.lbl);
    const age = sim.t - k.t;
    x.fillText(`${fmtTime(k.t).hm}${age > 120 ? ' (устар.)' : ''}`, tx, ty + (big ? 14 : 7));
    if (k.line === 'cut') { x.fillStyle = '#8a2018'; x.fillText('✕ нет связи', tx, ty + (big ? 27 : 13)); }
  }
  // резерв — его положение капитан знает, т. к. сам отдавал приказы
  for (const p of Object.values(sim.platoons)) {
    if (p.men <= 0) continue;
    if (p.where.type === 'res') { const [u, v] = P(RES[p.where.loc]); unit(x, u, v, p, big, true); }
    if (p.where.type === 'move') {
      const to = p.where.to;
      const dst = to.sector ? POS[to.sector].l2 : RES[to.loc] || RES.center;
      const [u, v] = P(dst);
      x.strokeStyle = '#2a3a7a'; x.setLineDash([2, 2]);
      const [hx, hy] = P(HQ_POS); x.beginPath(); x.moveTo(hx, hy); x.lineTo(u, v); x.stroke(); x.setLineDash([]);
      x.fillStyle = '#2a3a7a'; x.font = `${big ? 11 : 6}px monospace`;
      x.fillText(`${p.call} → ${fmtTime(p.where.eta).hm}`, u, v - (big ? 12 : 6));
    }
  }
  // штаб
  const [hx, hy] = P(HQ_POS);
  x.fillStyle = '#2a2620'; x.fillRect(hx - (big ? 6 : 3), hy - (big ? 6 : 3), big ? 12 : 6, big ? 12 : 6);
  x.fillStyle = '#8a2018'; x.fillRect(hx - (big ? 1 : 0), hy - (big ? 16 : 8), big ? 2 : 1, big ? 10 : 5);
  x.fillRect(hx, hy - (big ? 16 : 8), big ? 8 : 4, big ? 5 : 3);
  if (sim.hq.stage >= 3) { x.strokeStyle = '#8a2018'; x.lineWidth = 2; x.beginPath(); x.arc(hx, hy, big ? 26 : 11, 0, 7); x.stroke(); }
}

function unit(x, u, v, p, big, res = false) {
  const W = big ? 30 : 13, H = big ? 18 : 8;
  x.fillStyle = res ? 'rgba(42,58,122,.15)' : 'rgba(42,58,122,.25)';
  x.strokeStyle = '#2a3a7a'; x.lineWidth = big ? 2 : 1;
  x.fillRect(u - W / 2, v - H / 2, W, H); x.strokeRect(u - W / 2, v - H / 2, W, H);
  x.beginPath(); x.moveTo(u - W / 2, v - H / 2); x.lineTo(u + W / 2, v + H / 2); x.moveTo(u + W / 2, v - H / 2); x.lineTo(u - W / 2, v + H / 2); x.stroke();
  x.fillStyle = '#1a2450'; x.font = `bold ${big ? 12 : 6}px monospace`; x.textAlign = 'center';
  x.fillText(p.id === 'pw' ? 'З' : p.id.slice(1), u, v + (big ? -12 : -5));
}

function arrow(x, x0, y0, x1, y1, big) {
  x.strokeStyle = '#8a2018'; x.lineWidth = big ? 3 : 1.5;
  x.beginPath(); x.moveTo(x0, y0); x.lineTo(x1, y1); x.stroke();
  const a = Math.atan2(y1 - y0, x1 - x0), L = big ? 10 : 4;
  x.beginPath(); x.moveTo(x1, y1); x.lineTo(x1 - Math.cos(a - 0.5) * L, y1 - Math.sin(a - 0.5) * L);
  x.moveTo(x1, y1); x.lineTo(x1 - Math.cos(a + 0.5) * L, y1 - Math.sin(a + 0.5) * L); x.stroke();
}

function star(x, u, v, r) {
  x.beginPath();
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2, rr = i % 2 ? r / 2 : r; x.lineTo(u + Math.cos(a) * rr, v + Math.sin(a) * rr); }
  x.closePath(); x.fill();
}

/** Схема секторов на стене — статичная. */
export function drawWallMap(c) {
  const x = c.getContext('2d'), w = c.width, h = c.height;
  x.fillStyle = '#c6bb98'; x.fillRect(0, 0, w, h);
  x.strokeStyle = '#3a3428';
  x.strokeRect(2, 2, w - 4, h - 4);
  x.beginPath(); x.arc(w / 2, h / 2, 14, 0, 7); x.stroke();
  x.beginPath(); x.moveTo(w / 2, 4); x.lineTo(w / 2, h - 4); x.moveTo(4, h / 2); x.lineTo(w - 4, h / 2); x.stroke();
  x.fillStyle = '#8a2018'; x.fillRect(w / 2 - 2, h / 2 - 2, 4, 4);
  x.fillStyle = '#2a2620'; x.font = '6px monospace';
  x.fillText('С', w / 2 + 2, 9); x.fillText('Ю', w / 2 + 2, h - 4); x.fillText('В', w - 8, h / 2 - 2); x.fillText('З', 4, h / 2 - 2);
}
