// Помощники для low-poly геометрии с UV, привязанными к мировому масштабу.
import * as THREE from 'three';
import { mat } from './ps1.js';

/** Box с UV в метрах (texel density: 1 повтор текстуры на `tile` метров). */
export function boxGeo(w, h, d, tile = 1, seg = 1) {
  const g = new THREE.BoxGeometry(w, h, d, Math.max(1, Math.round(w * seg)), Math.max(1, Math.round(h * seg)), Math.max(1, Math.round(d * seg)));
  const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i));
    let u, v;
    if (nx > 0.5) { u = z; v = y; } else if (ny > 0.5) { u = x; v = z; } else { u = x; v = y; }
    uv.setXY(i, u / tile, v / tile);
  }
  return g;
}

export function box(parent, w, h, d, x, y, z, m, opts = {}) {
  const mesh = new THREE.Mesh(boxGeo(w, h, d, opts.tile ?? 1, opts.seg ?? 1), m);
  mesh.position.set(x, y, z);
  if (opts.ry) mesh.rotation.y = opts.ry;
  if (opts.rx) mesh.rotation.x = opts.rx;
  if (opts.rz) mesh.rotation.z = opts.rz;
  parent.add(mesh);
  return mesh;
}

export function cyl(parent, rt, rb, h, seg, x, y, z, m, opts = {}) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg, 1, !!opts.open), m);
  mesh.position.set(x, y, z);
  if (opts.rx) mesh.rotation.x = opts.rx;
  if (opts.rz) mesh.rotation.z = opts.rz;
  parent.add(mesh);
  return mesh;
}

export function plane(parent, w, h, x, y, z, m, opts = {}) {
  const g = new THREE.PlaneGeometry(w, h, opts.sx ?? Math.max(1, Math.round(w / 2)), opts.sy ?? Math.max(1, Math.round(h / 2)));
  if (opts.tile) {
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / opts.tile, uv.getY(i) * h / opts.tile);
  }
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(x, y, z);
  if (opts.rx !== undefined) mesh.rotation.x = opts.rx;
  if (opts.ry !== undefined) mesh.rotation.y = opts.ry;
  parent.add(mesh);
  return mesh;
}

/** Кеш материалов по ключу, чтобы не плодить шейдерные программы. */
const cache = new Map();
export function M(key, o) {
  if (!cache.has(key)) cache.set(key, mat(o));
  return cache.get(key);
}
