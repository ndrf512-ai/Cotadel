// Процедурные пиксельные текстуры низкого разрешения (без внешних ассетов).
import * as THREE from 'three';

let seed = 1337;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const rr = (a, b) => a + (b - a) * rnd();

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

export function toTex(c, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.NoColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

const rgb = (r, g, b) => `rgb(${r | 0},${g | 0},${b | 0})`;

function noise(ctx, w, h, base, amp, size = 1) {
  for (let y = 0; y < h; y += size) for (let x = 0; x < w; x += size) {
    const k = rr(-amp, amp);
    ctx.fillStyle = rgb(base[0] + k, base[1] + k, base[2] + k * 0.8);
    ctx.fillRect(x, y, size, size);
  }
}

function planks(vertical = false) {
  const [c, x] = canvas(64, 64);
  const base = [96, 72, 48];
  noise(x, 64, 64, base, 10);
  for (let i = 0; i < 4; i++) {
    const p = i * 16;
    const shade = rr(-18, 12);
    for (let y = 0; y < 64; y++) for (let k = 1; k < 16; k++) {
      const n = Math.sin((y + i * 9) * 0.6 + k * 0.3) * 6 + rr(-6, 6);
      x.fillStyle = rgb(base[0] + shade + n, base[1] + shade + n * 0.8, base[2] + shade + n * 0.5);
      vertical ? x.fillRect(p + k, y, 1, 1) : x.fillRect(y, p + k, 1, 1);
    }
    x.fillStyle = rgb(38, 28, 18);
    vertical ? x.fillRect(p, 0, 1, 64) : x.fillRect(0, p, 64, 1);
    // гвозди и сучки
    x.fillStyle = rgb(30, 30, 32);
    for (let j = 0; j < 2; j++) {
      const a = (j ? 54 : 8), b = p + 8;
      vertical ? x.fillRect(b, a, 1, 1) : x.fillRect(a, b, 1, 1);
    }
    if (rnd() < 0.7) {
      x.fillStyle = rgb(62, 44, 28);
      const kx = rr(4, 58) | 0, ky = p + 5 + (rr(0, 6) | 0);
      vertical ? x.fillRect(ky, kx, 3, 2) : x.fillRect(kx, ky, 3, 2);
    }
  }
  return toTex(c);
}

function earth() {
  const [c, x] = canvas(64, 64);
  noise(x, 64, 64, [70, 60, 44], 14, 1);
  for (let i = 0; i < 40; i++) {
    x.fillStyle = rgb(rr(40, 55), rr(36, 46), rr(28, 34));
    x.fillRect(rr(0, 64), rr(0, 64), rr(1, 4), rr(1, 3));
  }
  for (let i = 0; i < 14; i++) {
    x.fillStyle = rgb(rr(100, 120), rr(96, 108), rr(84, 92));
    x.fillRect(rr(0, 64), rr(0, 64), 2, 2);
  }
  return toTex(c);
}

function grass() {
  const [c, x] = canvas(64, 64);
  noise(x, 64, 64, [58, 62, 42], 10, 2);
  for (let i = 0; i < 160; i++) {
    x.fillStyle = rgb(rr(66, 86), rr(70, 90), rr(40, 52));
    x.fillRect(rr(0, 64), rr(0, 64), 1, rr(1, 3));
  }
  for (let i = 0; i < 25; i++) {
    x.fillStyle = rgb(rr(70, 80), rr(60, 66), rr(44, 50));
    x.fillRect(rr(0, 64), rr(0, 64), rr(2, 6), rr(2, 4));
  }
  return toTex(c);
}

function sandbag() {
  const [c, x] = canvas(64, 32);
  noise(x, 64, 32, [120, 108, 80], 8);
  for (let row = 0; row < 2; row++) for (let i = -1; i < 3; i++) {
    const ox = i * 32 + (row ? 16 : 0), oy = row * 16;
    x.fillStyle = rgb(70, 62, 46);
    x.fillRect(ox, oy + 15, 32, 1);
    x.fillRect(ox + 31, oy, 1, 16);
    x.fillStyle = rgb(140, 128, 98);
    x.fillRect(ox + 2, oy + 2, 26, 2);
    x.fillStyle = rgb(100, 90, 66);
    x.fillRect(ox + 4, oy + 8, 1, 4);
    x.fillRect(ox + 24, oy + 7, 1, 5);
  }
  return toTex(c);
}

function metal(base = [70, 74, 66]) {
  const [c, x] = canvas(32, 32);
  noise(x, 32, 32, base, 6);
  x.fillStyle = rgb(base[0] - 25, base[1] - 25, base[2] - 25);
  x.fillRect(0, 0, 32, 1); x.fillRect(0, 31, 32, 1);
  for (let i = 0; i < 6; i++) {
    x.fillStyle = rgb(110, 70, 40);
    x.fillRect(rr(0, 32), rr(0, 32), rr(1, 3), 1);
  }
  return toTex(c);
}

function cloth(base, stripes = false) {
  const [c, x] = canvas(32, 32);
  noise(x, 32, 32, base, 7);
  if (stripes) {
    x.fillStyle = rgb(base[0] - 20, base[1] - 20, base[2] - 20);
    for (let i = 0; i < 32; i += 6) x.fillRect(0, i, 32, 1);
  }
  return toTex(c);
}

function uniform() {
  const [c, x] = canvas(32, 32);
  noise(x, 32, 32, [92, 90, 62], 6);
  x.fillStyle = rgb(60, 58, 40);
  x.fillRect(15, 0, 1, 32); // планка
  x.fillStyle = rgb(130, 120, 80);
  x.fillRect(14, 6, 1, 1); x.fillRect(14, 12, 1, 1); x.fillRect(14, 18, 1, 1);
  x.fillStyle = rgb(52, 40, 28);
  x.fillRect(0, 24, 32, 3); // ремень
  x.fillStyle = rgb(150, 130, 70);
  x.fillRect(14, 24, 3, 3);
  return toTex(c, false);
}

function face(beard = false, pale = false) {
  const [c, x] = canvas(16, 16);
  const s = pale ? [168, 140, 118] : [170, 128, 98];
  noise(x, 16, 16, s, 5);
  x.fillStyle = rgb(40, 30, 24);
  x.fillRect(4, 6, 2, 1); x.fillRect(10, 6, 2, 1);
  x.fillStyle = rgb(20, 18, 16);
  x.fillRect(4, 7, 2, 1); x.fillRect(10, 7, 2, 1);
  x.fillStyle = rgb(130, 92, 70);
  x.fillRect(7, 8, 2, 3);
  x.fillStyle = rgb(100, 60, 50);
  x.fillRect(6, 12, 4, 1);
  if (beard) {
    x.fillStyle = rgb(70, 56, 44);
    x.fillRect(3, 11, 10, 5); x.fillStyle = rgb(100, 60, 50); x.fillRect(6, 12, 4, 1);
  }
  return toTex(c, false);
}

function mapPaper() {
  const [c, x] = canvas(32, 32);
  noise(x, 32, 32, [196, 186, 152], 8);
  return toTex(c);
}

function wallpaperDoc() {
  const [c, x] = canvas(32, 32);
  noise(x, 32, 32, [200, 190, 160], 6);
  x.fillStyle = rgb(80, 76, 66);
  for (let i = 5; i < 30; i += 3) x.fillRect(3, i, rr(14, 26), 1);
  return toTex(c, false);
}

function blanket() {
  const [c, x] = canvas(32, 32);
  noise(x, 32, 32, [70, 64, 52], 6);
  x.fillStyle = rgb(110, 30, 24);
  x.fillRect(0, 5, 32, 2); x.fillRect(0, 25, 32, 2);
  return toTex(c);
}

function wire() {
  const [c, x] = canvas(32, 32);
  x.clearRect(0, 0, 32, 32);
  x.fillStyle = rgb(60, 56, 50);
  for (let i = 0; i < 32; i++) {
    x.fillRect(i, 8 + Math.round(Math.sin(i * 0.6) * 2), 1, 1);
    x.fillRect(i, 22 + Math.round(Math.cos(i * 0.5) * 2), 1, 1);
    if (i % 6 === 0) { x.fillRect(i - 1, 7, 3, 3); x.fillRect(i + 2, 21, 3, 3); }
  }
  for (let i = 0; i < 32; i += 4) x.fillRect(i + (i % 8 ? 0 : 2), 12 + (i % 3) * 3, 1, 1);
  return toTex(c);
}

function sky() {
  const [c, x] = canvas(8, 8);
  x.fillStyle = '#fff'; x.fillRect(0, 0, 8, 8);
  return toTex(c);
}

function clockFace() {
  const [c, x] = canvas(32, 32);
  x.fillStyle = rgb(200, 192, 168); x.fillRect(0, 0, 32, 32);
  x.fillStyle = rgb(40, 36, 30);
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2;
    x.fillRect(16 + Math.sin(a) * 13 - 1, 16 - Math.cos(a) * 13 - 1, i % 3 ? 1 : 2, i % 3 ? 1 : 2);
  }
  return toTex(c, false);
}

function crate() {
  const [c, x] = canvas(32, 32);
  noise(x, 32, 32, [84, 90, 60], 7);
  x.fillStyle = rgb(50, 54, 36);
  x.fillRect(0, 0, 32, 2); x.fillRect(0, 30, 32, 2); x.fillRect(0, 0, 2, 32); x.fillRect(30, 0, 2, 32);
  x.fillStyle = rgb(200, 190, 150);
  x.fillRect(8, 12, 16, 1); x.fillRect(10, 15, 12, 1); x.fillRect(9, 18, 14, 1);
  return toTex(c);
}

export function makeTextures() {
  seed = 1337;
  return {
    planks: planks(), planksV: planks(true), earth: earth(), grass: grass(), sandbag: sandbag(),
    metal: metal(), metalDark: metal([46, 50, 44]), radio: metal([66, 72, 58]),
    cloth: cloth([80, 76, 60]), tarp: cloth([74, 80, 56], true), blanket: blanket(),
    uniform: uniform(), face: face(), faceBeard: face(true), facePale: face(false, true),
    paper: mapPaper(), doc: wallpaperDoc(), wire: wire(), sky: sky(), clock: clockFace(), crate: crate(),
  };
}
