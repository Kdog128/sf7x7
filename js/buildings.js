// Procedural prewar buildings. Every building is generated from its seed, so no two are alike.
import * as THREE from 'three';
import { MAP, heightAt } from './terrain.js';
import { CELL, CXN, CZN, CH, buildings, chunkBuildings } from './world.js';
import { rng, clamp } from './util.js';

const hx = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const sh = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const P = {
  // painted wood and stucco: muted pastels, the way the city's rowhouses are actually painted
  house: ['#dccdae', '#cbbd92', '#bcc7ab', '#abbfc8', '#d6b3a2', '#cba68f', '#bbacc8', '#e3d9c6', '#a2b9ac', '#d9c48d', '#c79281', '#93a8ba', '#e6d6bf', '#b9a892', '#c9d2c0', '#d8bfc0'].map(hx),
  brick: ['#9a6652', '#8a5a49', '#a67a64', '#7f5e52', '#b08a72', '#96705f', '#9c6a58'].map(hx),
  stone: ['#cfc5ae', '#c2b9a5', '#b8b2a3', '#d8cfbb', '#c7b99f', '#aaa69c', '#bfb399'].map(hx),
  tower: ['#d0c7b3', '#b0aca2', '#c2ad90', '#96796a', '#d9d2c0', '#b8ad99', '#a0a39c', '#c4b89f', '#8a7d72', '#cbbfa5'].map(hx),
  dark: ['#3b3733', '#4a433c', '#55504a'].map(hx),
  roof: ['#7d786f', '#8c867a', '#6f6c66', '#989082', '#807a73'].map(hx),
  pitch: ['#6b584c', '#5a5f62', '#7b6252', '#4e5255', '#8a6854', '#626a5e', '#9c5f48'].map(hx),
  crown: ['#6f9384', '#b08d57', '#4a5057', '#8a9a8f', '#c9c0ad', '#7d6a50'].map(hx),
  awning: ['#3f6a52', '#8a3a36', '#35507a', '#b8923f', '#6a5440', '#9a4f32', '#3f5a62', '#c9b99a', '#7a4a6a'].map(hx),
  shed: ['#8f6a56', '#9a9c92', '#7f8a80', '#aa9a80', '#766a60', '#958068', '#b3ab98', '#6f7f8a'].map(hx),
  metal: ['#9aa0a2', '#838a8c', '#b0aa9c'].map(hx),
  tree: ['#5f7a45', '#6f8a4c', '#4f6b3f', '#7a9052', '#58764a', '#86964f', '#a8913f', '#b8743a', '#4a6340', '#93a25a'].map(hx),
  neon: ['#e8553f', '#f2a83a', '#4fc7c9', '#ea6aa8', '#7fd86b', '#f4e6a6', '#6f93ea', '#f07a3a'].map(hx),
  door: ['#7a2f2a', '#2f4a5a', '#3f5a3f', '#5a3f2a', '#c9a23f', '#2a2a2e', '#6a3f5a', '#b5532f'].map(hx),
  box: ['#9a4a3e', '#44627a', '#b89a4a', '#52705c', '#8a8f92', '#a5633a', '#5a5270', '#cfc9bb'].map(hx),
  car: ['#8c8f8a', '#2f3438', '#d6d2c6', '#6f1f1c', '#24364f', '#4c5a4a', '#a89f8c', '#b9b3a3'].map(hx),
  trunk: hx('#4b3d32'), glassDark: hx('#20262b'), concrete: hx('#aaa69b'), stoneLight: hx('#d8d2c2'), iron: hx('#2e2d2c'), asphalt: hx('#56555a'), tile: hx('#a85f44'),
};

// ---- growable mesh builder -------------------------------------------------------------------
const t = (1 + Math.sqrt(5)) / 2, il = 1 / Math.hypot(1, t);
const ICO_V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((v) => v.map((c) => c * il));
const ICO_F = [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1];

export class MeshBuilder {
  constructor() { this.cap = 0; this.icap = 0; this.n = 0; this.ni = 0; this.w = [0, 0, 0, 0]; this.birth = -100; this.baseY = 0; this.dur = 1.6; this.grow(16384); }
  reset() { this.n = 0; this.ni = 0; }
  grow(cap) {
    const g = (T, k, old) => { const a = new T(cap * k); if (old) a.set(old); return a; };
    this.pos = g(Float32Array, 3, this.pos); this.nrm = g(Int8Array, 3, this.nrm); this.col = g(Uint8Array, 3, this.col);
    this.uv = g(Float32Array, 2, this.uv); this.win = g(Uint8Array, 4, this.win); this.anim = g(Float32Array, 3, this.anim);
    this.cap = cap;
  }
  growI(cap) { const a = new Uint32Array(cap); if (this.idx) a.set(this.idx); this.idx = a; this.icap = cap; }
  v(x, y, z, nx, ny, nz, u, vv, c) {
    const n = this.n; if (n >= this.cap) this.grow(this.cap * 2);
    let o = n * 3; this.pos[o] = x; this.pos[o + 1] = y; this.pos[o + 2] = z;
    this.nrm[o] = nx * 127; this.nrm[o + 1] = ny * 127; this.nrm[o + 2] = nz * 127;
    this.col[o] = c[0] > 255 ? 255 : c[0]; this.col[o + 1] = c[1] > 255 ? 255 : c[1]; this.col[o + 2] = c[2] > 255 ? 255 : c[2];
    o = n * 2; this.uv[o] = u; this.uv[o + 1] = vv; o = n * 3; this.anim[o] = this.birth; this.anim[o + 1] = this.baseY; this.anim[o + 2] = this.dur;
    o = n * 4; const w = this.w; this.win[o] = w[0]; this.win[o + 1] = w[1]; this.win[o + 2] = w[2]; this.win[o + 3] = w[3];
    this.n = n + 1; return n;
  }
  tri(a, b, c) { if (this.ni + 3 > this.icap) this.growI(Math.max(32768, this.icap * 2)); this.idx[this.ni++] = a; this.idx[this.ni++] = b; this.idx[this.ni++] = c; }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
  toGeometry() {
    const g = new THREE.BufferGeometry(), n = this.n;
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.slice(0, n * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nrm.slice(0, n * 3), 3, true));
    g.setAttribute('color', new THREE.BufferAttribute(this.col.slice(0, n * 3), 3, true));
    g.setAttribute('aUv', new THREE.BufferAttribute(this.uv.slice(0, n * 2), 2));
    g.setAttribute('aWin', new THREE.BufferAttribute(this.win.slice(0, n * 4), 4, true));
    g.setAttribute('aAnim', new THREE.BufferAttribute(this.anim.slice(0, n * 3), 3));
    g.setIndex(new THREE.BufferAttribute(this.idx.slice(0, this.ni), 1));
    g.computeBoundingSphere();
    return g;
  }
}

// ---- primitives (world space) ----------------------------------------------------------------
// W = { bay, fh, base, ww, wh, style, seed } or null. mask: bit per world face N,E,S,W that gets windows.
const NOWIN = [0, 0, 0, 0];
function setWin(m, W) { if (W) { m.w[0] = W.ww * 255; m.w[1] = W.wh * 255; m.w[2] = W.style; m.w[3] = W.seed; } else { m.w[0] = m.w[1] = m.w[2] = m.w[3] = 0; } }
function wall(m, ax, az, bx, bz, y0, y1, nx, nz, c, W) {
  const len = Math.abs(bx - ax) + Math.abs(bz - az);
  let u1 = 0, v0 = 0, v1 = 0;
  if (W) { u1 = Math.max(1, Math.round(len / W.bay)); v0 = (y0 - W.base) / W.fh; v1 = (y1 - W.base) / W.fh; }
  const a = m.v(ax, y0, az, nx, 0, nz, 0, v0, c), b = m.v(bx, y0, bz, nx, 0, nz, u1, v0, c);
  const cc = m.v(bx, y1, bz, nx, 0, nz, u1, v1, c), d = m.v(ax, y1, az, nx, 0, nz, 0, v1, c);
  m.quad(a, b, cc, d);
}
function box(m, x0, z0, x1, z1, y0, y1, wc, rc, W = null, mask = 15) {
  if (x1 < x0) { const s = x0; x0 = x1; x1 = s; } if (z1 < z0) { const s = z0; z0 = z1; z1 = s; }
  setWin(m, mask & 1 ? W : null); wall(m, x1, z0, x0, z0, y0, y1, 0, -1, wc, mask & 1 ? W : null);
  setWin(m, mask & 2 ? W : null); wall(m, x1, z1, x1, z0, y0, y1, 1, 0, wc, mask & 2 ? W : null);
  setWin(m, mask & 4 ? W : null); wall(m, x0, z1, x1, z1, y0, y1, 0, 1, wc, mask & 4 ? W : null);
  setWin(m, mask & 8 ? W : null); wall(m, x0, z0, x0, z1, y0, y1, -1, 0, wc, mask & 8 ? W : null);
  if (rc) {
    setWin(m, null);
    const a = m.v(x0, y1, z1, 0, 1, 0, 0, 0, rc), b = m.v(x1, y1, z1, 0, 1, 0, 0, 0, rc), c = m.v(x1, y1, z0, 0, 1, 0, 0, 0, rc), d = m.v(x0, y1, z0, 0, 1, 0, 0, 0, rc);
    m.quad(a, b, c, d);
  }
}
// Hip roof (pyramid when square). ridge: 'x' | 'z' | null = along the longer side. gable=true makes the short ends vertical.
function roof(m, x0, z0, x1, z1, y0, h, rc, wc, gable = false, ridge = null) {
  setWin(m, null);
  const dx = x1 - x0, dz = z1 - z0, alongX = ridge ? ridge === 'x' : dx >= dz;
  const half = (alongX ? dz : dx) / 2, inset = gable ? 0 : Math.min(half, (alongX ? dx : dz) / 2);
  const y1 = y0 + h, l = Math.hypot(h, half), ny = half / l, ns = h / l;
  if (alongX) {
    const zc = (z0 + z1) / 2, ra = x0 + inset, rb = x1 - inset;
    let a = m.v(x1, y0, z0, 0, ny, -ns, 0, 0, rc), b = m.v(x0, y0, z0, 0, ny, -ns, 0, 0, rc), c = m.v(ra, y1, zc, 0, ny, -ns, 0, 0, rc), d = m.v(rb, y1, zc, 0, ny, -ns, 0, 0, rc); m.quad(a, b, c, d);
    a = m.v(x0, y0, z1, 0, ny, ns, 0, 0, rc); b = m.v(x1, y0, z1, 0, ny, ns, 0, 0, rc); c = m.v(rb, y1, zc, 0, ny, ns, 0, 0, rc); d = m.v(ra, y1, zc, 0, ny, ns, 0, 0, rc); m.quad(a, b, c, d);
    const ec = gable ? wc : rc, li = Math.hypot(h, inset) || 1, ey = gable ? 0 : inset / li, ex = gable ? 1 : h / li;
    a = m.v(x0, y0, z0, -ex, ey, 0, 0, 0, ec); b = m.v(x0, y0, z1, -ex, ey, 0, 0, 0, ec); c = m.v(ra, y1, zc, -ex, ey, 0, 0, 0, ec); m.tri(a, b, c);
    a = m.v(x1, y0, z1, ex, ey, 0, 0, 0, ec); b = m.v(x1, y0, z0, ex, ey, 0, 0, 0, ec); c = m.v(rb, y1, zc, ex, ey, 0, 0, 0, ec); m.tri(a, b, c);
  } else {
    const xc = (x0 + x1) / 2, ra = z0 + inset, rb = z1 - inset;
    let a = m.v(x0, y0, z0, -ns, ny, 0, 0, 0, rc), b = m.v(x0, y0, z1, -ns, ny, 0, 0, 0, rc), c = m.v(xc, y1, rb, -ns, ny, 0, 0, 0, rc), d = m.v(xc, y1, ra, -ns, ny, 0, 0, 0, rc); m.quad(a, b, c, d);
    a = m.v(x1, y0, z1, ns, ny, 0, 0, 0, rc); b = m.v(x1, y0, z0, ns, ny, 0, 0, 0, rc); c = m.v(xc, y1, ra, ns, ny, 0, 0, 0, rc); d = m.v(xc, y1, rb, ns, ny, 0, 0, 0, rc); m.quad(a, b, c, d);
    const ec = gable ? wc : rc, li = Math.hypot(h, inset) || 1, ey = gable ? 0 : inset / li, ez = gable ? 1 : h / li;
    a = m.v(x1, y0, z0, 0, ey, -ez, 0, 0, ec); b = m.v(x0, y0, z0, 0, ey, -ez, 0, 0, ec); c = m.v(xc, y1, ra, 0, ey, -ez, 0, 0, ec); m.tri(a, b, c);
    a = m.v(x0, y0, z1, 0, ey, ez, 0, 0, ec); b = m.v(x1, y0, z1, 0, ey, ez, 0, 0, ec); c = m.v(xc, y1, rb, 0, ey, ez, 0, 0, ec); m.tri(a, b, c);
  }
}
function cyl(m, cx, cz, r0, r1, y0, y1, c, sides = 8, cap = true) {
  setWin(m, null);
  const base = m.n;
  for (let i = 0; i <= sides; i++) {
    const a = (i / sides) * Math.PI * 2, cs = Math.cos(a), sn = Math.sin(a);
    m.v(cx + cs * r0, y0, cz + sn * r0, cs, 0, sn, 0, 0, c); m.v(cx + cs * r1, y1, cz + sn * r1, cs, 0, sn, 0, 0, c);
  }
  for (let i = 0; i < sides; i++) { const a = base + i * 2; m.tri(a, a + 1, a + 3); m.tri(a, a + 3, a + 2); }
  if (cap && r1 > 0.01) {
    const c0 = m.v(cx, y1, cz, 0, 1, 0, 0, 0, sh(c, 0.85)), b2 = m.n;
    for (let i = 0; i <= sides; i++) { const a = (i / sides) * Math.PI * 2; m.v(cx + Math.cos(a) * r1, y1, cz + Math.sin(a) * r1, 0, 1, 0, 0, 0, sh(c, 0.85)); }
    for (let i = 0; i < sides; i++) m.tri(c0, b2 + i + 1, b2 + i);
  }
}
function blob(m, cx, cy, cz, rx, ry, c, leaf = false) {
  setWin(m, null); if (leaf) m.w[3] = 255; // foliage marker: floodlights skip it
  const base = m.n;
  for (const v of ICO_V) m.v(cx + v[0] * rx, cy + v[1] * ry, cz + v[2] * rx, v[0], v[1], v[2], 0, 0, sh(c, 0.8 + 0.3 * v[1]));
  for (let i = 0; i < 60; i += 3) m.tri(base + ICO_F[i], base + ICO_F[i + 1], base + ICO_F[i + 2]);
}
// A crown of three overlapping lumps reads as foliage; a single one reads as a ball on a stick.
export function tree(m, x, z, y, h, r, c) {
  box(m, x - 0.18, z - 0.18, x + 0.18, z + 0.18, y - 0.5, y + h * 0.45, P.trunk, null);
  const k = (Math.abs(x * 13.7 + z * 7.3) % 1), a = k * 6.283, ox = Math.cos(a) * r * 0.55, oz = Math.sin(a) * r * 0.55;
  blob(m, x, y + h * 0.66, z, r * 1.0, h * 0.36, c, true);
  blob(m, x + ox, y + h * 0.54, z + oz, r * 0.78, h * 0.26, sh(c, 0.9), true);
  blob(m, x - ox * 0.8, y + h * 0.6, z - oz * 0.8, r * 0.7, h * 0.24, sh(c, 1.08), true);
}
export const TREE_COLORS = P.tree;

// ---- lot frame: local (lx across the frontage, lz back from the street) -> world ----------------
function frame(b) {
  const wx = b.w * CELL, wz = b.d * CELL, x0 = MAP.minX + b.i * CELL, z0 = MAP.minZ + b.j * CELL, f = b.front & 3;
  const cx = x0 + wx / 2, cz = z0 + wz / 2, W = f & 1 ? wz : wx, D = f & 1 ? wx : wz;
  const cs = [1, 0, -1, 0][f], sn = [0, 1, 0, -1][f];
  const X = (lx, lz) => cx + cs * (lx - W / 2) - sn * (lz - D / 2), Z = (lx, lz) => cz + sn * (lx - W / 2) + cs * (lz - D / 2);
  const rot = (mask) => ((mask << f) | (mask >> (4 - f))) & 15;
  let lo = 1e9, hi = -1e9;
  for (const [px, pz] of [[x0, z0], [x0 + wx, z0], [x0, z0 + wz], [x0 + wx, z0 + wz], [cx, cz]]) { const h = heightAt(px, pz); lo = Math.min(lo, h); hi = Math.max(hi, h); }
  const fy = (heightAt(X(0, 0), Z(0, 0)) + heightAt(X(W, 0), Z(W, 0))) / 2; // street-side elevation
  return { W, D, X, Z, rot, f, lo, baseY: Math.max(fy, lo + (hi - lo) * 0.6) + 0.25, alongX: !(f & 1), cs, sn };
}
export const lotBase = (b) => frame(b).baseY;
// local box helper
function lbox(m, F, lx0, lz0, lx1, lz1, y0, y1, wc, rc, W, mask = 15) {
  box(m, F.X(lx0, lz0), F.Z(lx0, lz0), F.X(lx1, lz1), F.Z(lx1, lz1), y0, y1, wc, rc, W, F.rot(mask));
}
function lroof(m, F, lx0, lz0, lx1, lz1, y0, h, rc, wc, gable, ridgeLocal) {
  let xa = F.X(lx0, lz0), za = F.Z(lx0, lz0), xb = F.X(lx1, lz1), zb = F.Z(lx1, lz1);
  if (xb < xa) { const s = xa; xa = xb; xb = s; } if (zb < za) { const s = za; za = zb; zb = s; }
  const ridge = ridgeLocal ? ((ridgeLocal === 'x') === F.alongX ? 'x' : 'z') : null;
  roof(m, xa, za, xb, zb, y0, h, rc, wc, gable, ridge);
}
const lcyl = (m, F, lx, lz, r0, r1, y0, y1, c, sides, cap) => cyl(m, F.X(lx, lz), F.Z(lx, lz), r0, r1, y0, y1, c, sides, cap);
const ltree = (m, F, lx, lz, h, r, c) => { const x = F.X(lx, lz), z = F.Z(lx, lz); tree(m, x, z, heightAt(x, z), h, r, c); };
// Prism over a convex local footprint. pts run front-right, front-left, back-left, back-right (the same sense as lbox).
// open: leave out the wall from the last point back to the first (for bays that sit against a facade).
function lpoly(m, F, pts, y0, y1, wc, rc, W = null, open = false) {
  const n = pts.length, wx = pts.map((p) => F.X(p[0], p[1])), wz = pts.map((p) => F.Z(p[0], p[1]));
  for (let i = 0; i < (open ? n - 1 : n); i++) {
    const j = (i + 1) % n, dx = wx[j] - wx[i], dz = wz[j] - wz[i], len = Math.hypot(dx, dz); if (len < 0.01) continue;
    const nx = -dz / len, nz = dx / len; let u1 = 0, v0 = 0, v1 = 0;
    setWin(m, W); if (W) { u1 = Math.max(1, Math.round(len / W.bay)); v0 = (y0 - W.base) / W.fh; v1 = (y1 - W.base) / W.fh; }
    const a = m.v(wx[i], y0, wz[i], nx, 0, nz, 0, v0, wc), b = m.v(wx[j], y0, wz[j], nx, 0, nz, u1, v0, wc), c = m.v(wx[j], y1, wz[j], nx, 0, nz, u1, v1, wc), d = m.v(wx[i], y1, wz[i], nx, 0, nz, 0, v1, wc);
    m.quad(a, b, c, d);
  }
  if (rc) { setWin(m, null); const b0 = m.n; for (let i = 0; i < n; i++) m.v(wx[i], y1, wz[i], 0, 1, 0, 0, 0, rc); for (let i = 1; i + 1 < n; i++) m.tri(b0, b0 + i + 1, b0 + i); }
}
// Curved roof over a local rectangle: the arc runs across lx when along is 'z' (ridge front to back), across lz otherwise.
function lbarrel(m, F, lx0, lz0, lx1, lz1, y0, rise, rc, wc, along = 'z', seg = 6) {
  setWin(m, null);
  const P2 = (u, v) => (along === 'z' ? [lx0 + (lx1 - lx0) * u, lz0 + (lz1 - lz0) * v] : [lx0 + (lx1 - lx0) * v, lz0 + (lz1 - lz0) * u]);
  const span = along === 'z' ? lx1 - lx0 : lz1 - lz0, ring = [];
  for (let k = 0; k <= seg; k++) { const t = k / seg, a = Math.PI * t; ring.push([t, y0 + Math.sin(a) * rise, -Math.cos(a) * rise * 2 / span, Math.sin(a)]); }
  for (let k = 0; k < seg; k++) {
    const A = ring[k], B = ring[k + 1], p00 = P2(A[0], 0), p01 = P2(A[0], 1), p10 = P2(B[0], 0), p11 = P2(B[0], 1);
    const lnx = (A[2] + B[2]) / 2, lny = (A[3] + B[3]) / 2 + 0.2, ll2 = Math.hypot(lnx, lny), ax = along === 'z' ? lnx / ll2 : 0, az = along === 'z' ? 0 : lnx / ll2;
    const nx = F.cs * ax - F.sn * az, nz = F.sn * ax + F.cs * az, ny = lny / ll2;
    const a = m.v(F.X(...p00), A[1], F.Z(...p00), nx, ny, nz, 0, 0, rc), b = m.v(F.X(...p01), A[1], F.Z(...p01), nx, ny, nz, 0, 0, rc), c = m.v(F.X(...p11), B[1], F.Z(...p11), nx, ny, nz, 0, 0, rc), d = m.v(F.X(...p10), B[1], F.Z(...p10), nx, ny, nz, 0, 0, rc);
    m.quad(a, b, c, d); m.quad(d, c, b, a);
  }
  for (const v of [0, 1]) { // end walls
    const lnz = v ? 1 : -1, ax = along === 'z' ? 0 : lnz, az = along === 'z' ? lnz : 0, nx = F.cs * ax - F.sn * az, nz = F.sn * ax + F.cs * az, b0 = m.n;
    for (const R of ring) { const p = P2(R[0], v); m.v(F.X(...p), R[1], F.Z(...p), nx, 0, nz, 0, 0, wc); }
    for (let k = 1; k + 1 < ring.length; k++) { m.tri(b0, b0 + k, b0 + k + 1); m.tri(b0, b0 + k + 1, b0 + k); }
  }
}

// window styles: bits 0-1 lighting profile (0 home, 1 office, 2 shop, 3 industry), 8 storefront, 16 deco piers, 32 self-lit (signs, lamps), 64 floodlit
const ST = { home: 0, office: 1, shop: 2, ind: 3, front: 8, deco: 16, glow: 32, flood: 64 };

function roofClutter(m, F, r, lx0, lz0, lx1, lz1, y, amount, roofC) {
  const w = lx1 - lx0, d = lz1 - lz0; if (w < 5 || d < 5) return;
  for (let k = 0; k < amount; k++) {
    const kind = r(), px = lx0 + 1.5 + r() * (w - 3), pz = lz0 + 1.5 + r() * (d - 3);
    if (kind < 0.3) { const s = 1.2 + r() * 1.6; lbox(m, F, px - s, pz - s * 0.7, px + s, pz + s * 0.7, y, y + 2.2 + r() * 1.4, sh(roofC, 1.35), sh(roofC, 0.9)); }
    else if (kind < 0.42 && w > 8) { // water tank on a stand
      const rr = 1.3 + r() * 0.5; lbox(m, F, px - rr * 0.7, pz - rr * 0.7, px + rr * 0.7, pz + rr * 0.7, y, y + 1.8, P.dark[0], null);
      lcyl(m, F, px, pz, rr, rr, y + 1.8, y + 4.6, hx('#6a5546'), 8, false); lcyl(m, F, px, pz, rr * 1.05, 0, y + 4.6, y + 5.7, hx('#4c423a'), 8, false);
    } else if (kind < 0.8) { const s = 0.7 + r() * 0.8; lbox(m, F, px - s, pz - s, px + s, pz + s, y, y + 0.9 + r() * 0.6, P.metal[r.int(0, 2)], P.metal[0]); }
    else { lbox(m, F, px - 0.4, pz - 0.4, px + 0.4, pz + 0.4, y, y + 1.6 + r() * 1.2, P.brick[r.int(0, 6)], P.dark[0]); }
  }
}
function cornice(m, F, lx0, lz0, lx1, lz1, y, h, c, out = 0.35, top = null) { lbox(m, F, lx0 - out, lz0 - out, lx1 + out, lz1 + out, y, y + h, c, top || sh(c, 0.7)); }

// ---- design: decide the headline numbers from the seed (used for capacity before any mesh exists) ----
const FLOORS = { // [zone][level-1] = [min, max]
  1: [[2, 2], [3, 3]], 2: [[3, 4], [4, 6], [5, 7], [9, 15], [16, 28]], 3: [[1, 2], [2, 3]], 4: [[3, 6], [5, 7], [9, 16], [16, 26], [26, 38]],
  5: [[2, 4], [4, 7]], 6: [[4, 8], [8, 14], [16, 28], [28, 44], [44, 70]], 7: [[1, 1], [1, 2]], 8: [[1, 2], [2, 4], [3, 6]],
  9: [[2, 4], [4, 8], [8, 16], [16, 30], [30, 58]], 10: [[1, 3], [3, 6], [6, 12], [10, 20]], 11: [[3, 4], [4, 6], [6, 7], [10, 20]], 12: [[1, 1], [1, 2], [2, 3]],
};
export const MAX_LEVEL = { 1: 2, 2: 5, 3: 2, 4: 5, 5: 2, 6: 5, 7: 2, 8: 3, 9: 5, 10: 4, 11: 4, 12: 3 };
// hooks filled in by structures.js: special structures and per-building styles
export const ext = { emitSpecial: null, styles: [], business: null };
export const constructionTime = (h) => clamp(h * 0.16, 1.6, 18);
const pickName = (r, a, b) => `${r.pick(a)} ${r.pick(b)}`;
const N1 = ['Pacific', 'Golden Gate', 'Bay', 'Sutro', 'Mission', 'Portola', 'Sierra', 'Embarcadero', 'Presidio', 'Alta', 'Yerba Buena', 'Fillmore', 'Hyde', 'Larkin', 'Balboa', 'Noriega', 'Clement', 'Dolores', 'Valencia', 'Kearny', 'Montgomery', 'Sansome', 'Folsom', 'Brannan', 'Geary', 'Taraval', 'Irving', 'Judah', 'Castro', 'Hayes'];
export function design(b) {
  if (b.sp) return {};
  const r = rng(b.seed * 2654435761 + b.level * 97), z = b.zone, lv = clamp(b.level, 1, MAX_LEVEL[z]);
  const lotW = Math.min(b.w, b.d) * CELL, area = b.w * b.d * CELL * CELL;
  let [lo, hi] = FLOORS[z][lv - 1];
  let floors = r.int(lo, hi);
  const fh = z === 6 || z === 9 ? r.range(3.5, 3.9) : z === 7 || z === 8 || z === 12 ? r.range(4.2, 5.2) : z >= 3 ? r.range(3.4, 3.8) : r.range(3.0, 3.4);
  if (b.st === 8 && lv >= 4) floors = Math.round(floors * 1.5); // megatowers of the future
  if (b.fc) floors = Math.min(floors, Math.max(b.fc, lo > 6 ? 6 : 1));
  floors = Math.max(lo > 6 ? 6 : 1, Math.min(floors, Math.floor((lotW * 7.5) / fh))); // slenderness cap
  let variant = r.int(0, 99), label, cov = 0.7, per = 40;
  if (z === 1) {
    const row = Math.min(b.w, b.d) === 1 || (b.front & 1 ? b.d : b.w) === 1;
    variant = row ? (b.st === 2 ? [2, 2, 6, 6, 1] : b.st === 1 ? [0, 0, 1, 5, 5] : [0, 1, 2, 5, 6])[variant % 5] : 3 + (variant % 2); // the neighbourhood style leans the mix
    label = ['Victorian rowhouse', 'Edwardian flats', 'Stucco rowhouse', 'Detached house', 'Shingle house', 'Italianate rowhouse', 'Marina-style house'][variant]; cov = row ? 0.6 : 0.34; per = 66;
  } else if (z === 2) { label = floors <= 4 ? 'Bay-window flats' : floors <= 7 ? 'Apartment building' : floors <= 15 ? 'Apartment house' : 'Apartment tower'; cov = floors > 14 ? 0.55 : 0.68; per = 58; }
  else if (z === 3) { label = b.w * b.d >= 6 ? 'Shopfront row' : floors > 1 ? 'Shop with flats' : 'Corner store'; cov = 0.8; per = 55; }
  else if (z === 4) { label = floors <= 7 ? 'Department store' : floors <= 14 ? 'Hotel' : 'Hotel tower'; cov = floors > 12 ? 0.6 : 0.82; per = 50; }
  else if (z === 5) { label = floors <= 3 ? 'Office building' : 'Office block'; cov = 0.75; per = 30; }
  else if (z === 6) { label = floors <= 10 ? 'Office block' : floors <= 28 ? 'Art deco office tower' : 'Art deco skyscraper'; cov = floors > 28 ? 0.5 : floors > 12 ? 0.6 : 0.8; per = 30; }
  else if (z === 7) { label = variant < 50 ? 'Workshop' : 'Warehouse'; cov = 0.7; per = 90; }
  else if (z === 9) { label = floors <= 4 ? 'Startup loft' : floors <= 12 ? 'Tech office' : floors <= 30 ? 'Tech tower' : 'Tech headquarters tower'; cov = floors > 28 ? 0.5 : 0.7; per = 22; }
  else if (z === 10) { label = floors <= 3 ? 'Restaurants and galleries' : floors <= 8 ? 'Boutique hotel' : 'Resort hotel'; cov = 0.72; per = 46; }
  else if (z === 11) { label = floors <= 7 ? 'Flats over shops' : 'Mixed-use block'; cov = 0.7; per = 60; }
  else if (z === 12) { label = variant < 40 ? 'Pier shed' : variant < 75 ? 'Container yard' : 'Ship repair'; cov = 0.6; per = 110; floors = Math.min(floors, 3); }
  else { label = lv >= 2 && variant < 60 ? 'Mill' : 'Factory'; cov = 0.6; per = 80; floors = Math.min(floors, 6); }
  const kind = ext.kind ? ext.kind(b, floors) : null; // shops and industry come in several kinds with their own shape
  if (kind) { label = kind.label; if (kind.floors) floors = Math.min(floors, kind.floors); if (kind.cov) cov = kind.cov; }
  const fa = area * cov * floors, cap = Math.max(1, Math.round(fa / per));
  const nr = rng(b.seed + 77);
  let name = '';
  if (z === 2 && floors > 6) name = pickName(nr, N1, ['Arms', 'Court', 'Apartments', 'Towers', 'Terrace', 'House', 'Manor']);
  else if (z === 4) name = pickName(nr, N1, floors > 7 ? ['Hotel', 'Plaza Hotel', 'Grand'] : ['Emporium', 'Department Store', 'Arcade']);
  else if (z === 6 && floors > 10) name = pickName(nr, N1, ['Building', 'Tower', 'Trust Building', 'Exchange', 'Mutual Building', 'Telephone Building']);
  else if (kind && kind.names) name = pickName(nr, N1, kind.names);
  else if (z === 8) name = pickName(nr, N1, ['Iron Works', 'Cannery', 'Sugar Refinery', 'Brewery', 'Foundry', 'Ship Supply']);
  else if (z === 9 && floors > 12) name = pickName(nr, N1, ['Labs', 'Systems', 'Center', 'Campus', 'Tower']);
  else if (z === 10 && floors > 3) name = pickName(nr, N1, ['Inn', 'Hotel', 'Resort', 'House']);
  if (ext.business && (z === 3 || z === 10 || z === 11) && !name) name = ext.business(b, nr) || '';
  const mixed = z === 11;
  return { floors, fh, variant, label, name, res: z <= 2 ? cap : mixed ? Math.round(cap * 0.82) : 0, jobs: z > 2 ? (mixed ? Math.max(1, Math.round(cap * 0.2)) : cap) : 0, height: floors * fh + (z >= 3 && z <= 6 ? 1.2 : 0.4) };
}

// ---- emitters ----------------------------------------------------------------------------------
function yardTrees(m, F, r, lx0, lz0, lx1, lz1, n) {
  for (let k = 0; k < n; k++) { const h = r.range(5, 9); ltree(m, F, r.range(lx0, lx1), r.range(lz0, lz1), h, h * r.range(0.3, 0.42), r.pick(P.tree)); }
}

function emitRowhouse(m, F, b, s, r) {
  const { W, D } = F, y = F.baseY, wall = r.pick(P.house), trim = mixc(wall, [235, 230, 218], 0.6), roofC = r.pick(P.roof);
  const set = r.range(1.6, 3.2), depth = Math.min(D - set - 3.5, r.range(10.5, 13.5) + (D > 20 ? 2 : 0));
  const lx0 = 0.12, lx1 = W - 0.12, z0 = set, z1 = set + depth, garage = s.variant === 2 || r.chance(0.35) ? 2.5 : r.range(0.6, 1.4);
  const top = y + garage + s.floors * s.fh, bays = W > 12 ? 3 : 2;
  const Wn = { bay: (lx1 - lx0) / bays, fh: s.fh, base: y + garage, ww: 0.46, wh: 0.56, style: ST.home, seed: b.seed & 255 };
  lbox(m, F, lx0, z0, lx1, z1, F.lo - 1, y + garage, sh(wall, 0.82), null, { ...Wn, bay: lx1 - lx0, fh: garage, base: y, ww: 0.42, wh: 0.72, style: ST.home | ST.front }, garage > 2 ? 1 : 0);
  if (s.variant === 0) { // Victorian: gable to the street, full-height bay window
    lbox(m, F, lx0, z0, lx1, z1, y + garage, top, wall, null, Wn, 5);
    lroof(m, F, lx0 - 0.25, z0 - 0.3, lx1 + 0.25, z1, top, 2.2 + r() * 1.2, r.pick(P.pitch), trim, true, 'z');
    const bw = (lx1 - lx0) * 0.44, bx = r.chance(0.5) ? lx0 + 0.3 : lx1 - 0.3 - bw;
    lbox(m, F, bx, z0 - 0.85, bx + bw, z0, y + garage, top - 0.3, trim, sh(roofC, 1.1), { ...Wn, bay: bw / 2, ww: 0.62, wh: 0.62 }, 1);
    lbox(m, F, lx0, z0 - 0.3, lx1, z0, top - 0.5, top, trim, trim);
  } else if (s.variant === 1) { // Edwardian: flat roof, heavy cornice, angled bay pair
    lbox(m, F, lx0, z0, lx1, z1, y + garage, top, wall, roofC, Wn, 5);
    const bw = (lx1 - lx0) * 0.36;
    for (const bx of [lx0 + 0.35, lx1 - 0.35 - bw]) lbox(m, F, bx, z0 - 0.7, bx + bw, z0, y + garage + 0.2, top - 0.6, wall, sh(roofC, 1.1), { ...Wn, bay: bw, ww: 0.66, wh: 0.6 }, 1);
    lbox(m, F, lx0 - 0.1, z0 - 0.95, lx1 + 0.1, z0 + 0.2, top - 0.2, top + 0.55, trim, sh(trim, 0.8));
    roofClutter(m, F, r, lx0, z0 + 2, lx1, z1, top, 1, roofC);
  } else { // stucco: garage below, mission parapet
    lbox(m, F, lx0, z0, lx1, z1, y + garage, top, wall, roofC, { ...Wn, ww: 0.6, wh: 0.5 }, 5);
    lbox(m, F, lx0, z0 - 0.15, lx1, z0 + 0.4, top, top + 0.7, wall, sh(wall, 0.8));
    lbox(m, F, lx0 + (lx1 - lx0) * 0.3, z0 - 0.15, lx1 - (lx1 - lx0) * 0.3, z0 + 0.4, top + 0.7, top + 1.15, wall, sh(wall, 0.8));
    lroof(m, F, lx0, z0 - 0.5, lx1, z0 + 1.0, y + garage + s.fh * 0.98, 0.5, hx('#9a5a44'), wall, false, 'x');
  }
  lbox(m, F, W * 0.5 - 0.9, z0 - set * 0.8, W * 0.5 + 0.9, z0, F.lo - 0.5, y + garage * (garage > 2 ? 0.25 : 0.9), P.concrete, P.concrete); // stoop
  if (D - z1 > 5 && r.chance(0.55)) yardTrees(m, F, r, 2, z1 + 2.5, W - 2, D - 1.5, 1);
}

function emitHouse(m, F, b, s, r) {
  const { W, D } = F, y = F.baseY + 0.5, wall = r.pick(P.house), trim = mixc(wall, [235, 230, 218], 0.55), rc = r.pick(P.pitch);
  const w = Math.min(W - 4, r.range(9, 12)), d = Math.min(D - 7, r.range(8.5, 11.5)), lx0 = (W - w) * r.range(0.3, 0.7), z0 = r.range(3, 4.5);
  const top = y + s.floors * s.fh, Wn = { bay: 3.2, fh: s.fh, base: y, ww: 0.42, wh: 0.52, style: ST.home, seed: b.seed & 255 };
  lbox(m, F, lx0, z0, lx0 + w, z0 + d, F.lo - 1, top, wall, null, Wn);
  lroof(m, F, lx0 - 0.4, z0 - 0.4, lx0 + w + 0.4, z0 + d + 0.4, top, r.range(2.4, 3.6), rc, trim, s.variant === 4, null);
  if (r.chance(0.7)) { // side wing or garage
    const ww = Math.min(4.5, W - (lx0 + w) - 0.8);
    if (ww > 2.8) { lbox(m, F, lx0 + w, z0 + 2, lx0 + w + ww, z0 + d - 1, F.lo - 1, y + s.fh, wall, null, { ...Wn, bay: ww, ww: 0.6 }, 1); lroof(m, F, lx0 + w - 0.2, z0 + 1.7, lx0 + w + ww + 0.3, z0 + d - 0.7, y + s.fh, 1.4, rc, trim, false, 'z'); }
  }
  lbox(m, F, lx0 + w * 0.3, z0 - 1.6, lx0 + w * 0.7, z0, y - 0.6, y + 2.7, trim, sh(rc, 1.1)); // porch
  lbox(m, F, lx0 + w * 0.75, z0 + d * 0.4, lx0 + w * 0.75 + 0.8, z0 + d * 0.4 + 0.8, top, top + r.range(3, 4.2), r.pick(P.brick), P.dark[0]);
  yardTrees(m, F, r, 1.5, z0 + d + 1.5, W - 1.5, D - 1.5, r.int(1, 2));
  if (r.chance(0.5)) yardTrees(m, F, r, 1.2, 1.2, W - 1.2, 2.4, 1);
}

// Stacked tiers with setbacks: the shared body for apartments, hotels, offices and towers.
function emitTiers(m, F, b, s, r, o) {
  const { W, D } = F, y = F.baseY, seed = b.seed & 255;
  const mx = o.margin ?? 0.4, lx0 = mx, lx1 = W - mx, z0 = o.front ?? 0.6, z1 = D - (o.rear ?? 1.0);
  const gh = o.gh, wall = o.wall, base = o.base || wall, roofC = o.roof, trim = o.trim || mixc(wall, [225, 220, 208], 0.5);
  const bayT = o.bay, Wg = { bay: bayT * 1.6, fh: gh, base: y, ww: 0.8, wh: 0.7, style: o.gstyle, seed };
  lbox(m, F, lx0, z0, lx1, z1, F.lo - 1.5, y + gh, base, null, Wg);
  lbox(m, F, lx0 - 0.15, z0 - 0.15, lx1 + 0.15, z1 + 0.15, y + gh, y + gh + 0.45, trim, sh(trim, 0.8));
  let yb = y + gh + 0.45, a0 = lx0, a1 = lx1, c0 = z0, c1 = z1, left = s.floors - 1;
  const tiers = o.tiers; // [{floors, inset}]
  const Wn = { bay: bayT, fh: s.fh, base: yb, ww: o.ww, wh: o.wh, style: o.style, seed };
  for (let k = 0; k < tiers.length && left > 0; k++) {
    const tk = tiers[k], n = k === tiers.length - 1 ? left : Math.min(left, tk.floors);
    if (k > 0) {
      const ins = tk.inset, nb = Math.max(1, Math.round(ins / bayT)) * bayT;
      if (a1 - a0 - 2 * nb >= o.minW) { a0 += nb; a1 -= nb; }
      if (c1 - c0 - 2 * nb >= o.minW) { c0 += tk.frontOnly ? nb * 0.6 : nb; c1 -= nb; }
    }
    const yt = yb + n * s.fh, wc = k === 0 && o.base && tiers.length > 1 && n <= 4 ? base : wall;
    if (o.court && k === 0 && a1 - a0 > 19 && c1 - c0 > 15) { // light court facing the street
      const cw = Math.min(8, (a1 - a0) * 0.3), cd = (c1 - c0) * 0.45, cx = (a0 + a1) / 2;
      lbox(m, F, a0, c0 + cd, a1, c1, yb, yt, wc, roofC, Wn);
      lbox(m, F, a0, c0, cx - cw / 2, c0 + cd, yb, yt, wc, roofC, Wn, 11); lbox(m, F, cx + cw / 2, c0, a1, c0 + cd, yb, yt, wc, roofC, Wn, 11);
    } else lbox(m, F, a0, c0, a1, c1, yb, yt, wc, roofC, Wn);
    if (o.corners && k > 0 && a1 - a0 > 10) { // deco corner piers that rise past the roofline
      const p = 0.9, e = 0.25;
      for (const [px, pz] of [[a0, c0], [a1, c0], [a0, c1], [a1, c1]]) lbox(m, F, px - p / 2 - (px === a0 ? e : -e) * 0, pz - p / 2, px + p / 2, pz + p / 2, yb, yt + 1.3, trim, sh(trim, 0.8));
    }
    if (k < tiers.length - 1 && left - n > 0) { cornice(m, F, a0, c0, a1, c1, yt, 0.5, trim, 0.2, roofC); if (r.chance(0.5)) roofClutter(m, F, r, a0, c0, a1, c1, yt, 1, roofC); }
    yb = yt; left -= n;
  }
  crown(m, F, b, r, o.crown, a0, c0, a1, c1, yb, { wall, trim, roofC, fh: s.fh, seed, bay: bayT });
  return yb;
}

function crown(m, F, b, r, kind, a0, c0, a1, c1, y, o) {
  const w = a1 - a0, d = c1 - c0, cx = (a0 + a1) / 2, cz = (c0 + c1) / 2, cc = r.pick(P.crown), flood = { bay: 1, fh: 1, base: 0, ww: 0, wh: 0, style: ST.flood, seed: o.seed };
  if (kind === 'flat') { cornice(m, F, a0, c0, a1, c1, y, 0.7, o.trim, 0.3, o.roofC); roofClutter(m, F, r, a0 + 0.5, c0 + 0.5, a1 - 0.5, c1 - 0.5, y, Math.min(5, 1 + Math.floor((w * d) / 110)), o.roofC); return; }
  if (kind === 'parapet') { lbox(m, F, a0, c0, a1, c1, y, y + 0.9, o.wall, null); lbox(m, F, a0 + 0.35, c0 + 0.35, a1 - 0.35, c1 - 0.35, y + 0.2, y + 0.3, o.roofC, o.roofC); roofClutter(m, F, r, a0 + 1, c0 + 1, a1 - 1, c1 - 1, y + 0.3, Math.min(4, 1 + Math.floor((w * d) / 150)), o.roofC); return; }
  if (kind === 'hip') { cornice(m, F, a0, c0, a1, c1, y, 0.6, o.trim, 0.4); lroof(m, F, a0 - 0.2, c0 - 0.2, a1 + 0.2, c1 + 0.2, y + 0.6, Math.min(w, d) * r.range(0.3, 0.5), cc, cc, false, null); return; }
  if (kind === 'mansard') {
    cornice(m, F, a0, c0, a1, c1, y, 0.6, o.trim, 0.4);
    const h = o.fh * 1.6; lbox(m, F, a0 + 0.8, c0 + 0.8, a1 - 0.8, c1 - 0.8, y + 0.6, y + 0.6 + h, cc, sh(cc, 0.8), { bay: o.bay, fh: h, base: y + 0.6, ww: 0.3, wh: 0.4, style: ST.home, seed: o.seed });
    roofClutter(m, F, r, a0 + 2, c0 + 2, a1 - 2, c1 - 2, y + 0.6 + h, 2, o.roofC); return;
  }
  // stepped deco crowns: shrinking floodlit blocks, then a cap
  const steps = kind === 'spire' ? r.int(3, 4) : r.int(2, 3);
  let x0 = a0, x1 = a1, z0 = c0, z1 = c1, yy = y;
  cornice(m, F, a0, c0, a1, c1, y, 0.5, o.trim, 0.15, o.roofC);
  for (let k = 0; k < steps; k++) {
    const ins = Math.max(0.8, Math.min(x1 - x0, z1 - z0) * (kind === 'spire' ? 0.16 : 0.13));
    x0 += ins; x1 -= ins; z0 += ins; z1 -= ins; if (x1 - x0 < 2.2 || z1 - z0 < 2.2) break;
    const h = o.fh * (kind === 'spire' ? r.range(1.4, 2.4) : r.range(1.0, 1.7));
    lbox(m, F, x0, z0, x1, z1, yy, yy + h, k % 2 ? o.trim : o.wall, o.roofC, { bay: Math.max(1.6, o.bay * 0.8), fh: h, base: yy, ww: 0.34, wh: 0.74, style: ST.office | ST.deco | ST.flood, seed: o.seed });
    yy += h;
  }
  const rw = Math.min(x1 - x0, z1 - z0);
  if (kind === 'ziggurat') { lroof(m, F, x0, z0, x1, z1, yy, rw * 0.45, cc, cc, false, null); lbox(m, F, cx - 0.18, cz - 0.18, cx + 0.18, cz + 0.18, yy, yy + rw * 0.45 + r.range(5, 10), P.metal[0], null, flood); }
  else if (kind === 'lantern') {
    lcyl(m, F, cx, cz, rw * 0.36, rw * 0.36, yy, yy + o.fh * 1.8, o.trim, 8, false); setWin(m, null);
    lcyl(m, F, cx, cz, rw * 0.42, 0, yy + o.fh * 1.8, yy + o.fh * 1.8 + rw * 0.8, cc, 8, false);
    lbox(m, F, cx - 0.15, cz - 0.15, cx + 0.15, cz + 0.15, yy + o.fh * 1.8 + rw * 0.7, yy + o.fh * 1.8 + rw * 0.8 + 5, P.metal[0], null);
  } else { // spire
    const h = rw * r.range(1.6, 2.6);
    lcyl(m, F, cx, cz, rw * 0.5, rw * 0.06, yy, yy + h, cc, 4, false);
    lbox(m, F, cx - 0.14, cz - 0.14, cx + 0.14, cz + 0.14, yy + h * 0.9, yy + h + r.range(8, 16), P.metal[0], null, flood);
  }
}

function emitApartment(m, F, b, s, r) {
  const f = s.floors, { W, D } = F, brick = r.chance(f > 12 ? 0.2 : 0.3), wall = brick ? r.pick(P.brick) : f > 12 ? r.pick(P.tower) : r.pick(P.stone);
  const shops = r.chance(0.3), tiers = [];
  if (f <= 9) tiers.push({ floors: f });
  else if (f <= 16) tiers.push({ floors: Math.round(f * 0.7) }, { floors: 99, inset: 3, frontOnly: r.chance(0.5) });
  else tiers.push({ floors: Math.round(f * 0.42) }, { floors: Math.round(f * 0.32), inset: 3.2 }, { floors: 99, inset: 3.2 });
  emitTiers(m, F, b, s, r, {
    gh: shops ? 4.3 : s.fh * 1.1, wall, base: f > 5 ? r.pick(P.stone) : null, roof: r.pick(P.roof), bay: r.range(2.7, 3.4), ww: 0.42, wh: 0.55,
    style: ST.home, gstyle: shops ? ST.shop | ST.front : ST.home, tiers, court: r.chance(0.6), minW: 9, front: D > 20 ? 1.5 : 0.5, rear: D > 20 ? 4 : 1.2, margin: W > 20 ? 1 : 0.3,
    crown: f > 22 ? r.pick(['hip', 'lantern', 'mansard']) : f > 12 ? r.pick(['hip', 'mansard', 'flat']) : r.pick(['flat', 'parapet', 'flat']),
  });
  if (D > 20 && r.chance(0.6)) yardTrees(m, F, r, 2, D - 3, W - 2, D - 1.2, r.int(1, 2));
}
function emitHotel(m, F, b, s, r) {
  const f = s.floors, wall = f <= 7 ? r.pick(P.stone) : r.chance(0.5) ? r.pick(P.brick) : r.pick(P.tower), tiers = [];
  if (f <= 8) tiers.push({ floors: f });
  else if (f <= 14) tiers.push({ floors: Math.round(f * 0.6) }, { floors: 99, inset: 3.5 });
  else tiers.push({ floors: Math.round(f * 0.35) }, { floors: Math.round(f * 0.4), inset: 3.5 }, { floors: 99, inset: 3 });
  const top = emitTiers(m, F, b, s, r, {
    gh: 5, wall, base: r.pick(P.stone), roof: r.pick(P.roof), bay: f <= 7 ? r.range(3.6, 4.6) : r.range(2.8, 3.4), ww: f <= 7 ? 0.62 : 0.44, wh: f <= 7 ? 0.66 : 0.56,
    style: f <= 7 ? ST.shop : ST.home, gstyle: ST.shop | ST.front, tiers, minW: 10, front: 0.4, rear: 0.8, margin: 0.3,
    crown: f > 14 ? r.pick(['mansard', 'hip', 'ziggurat']) : f > 7 ? r.pick(['mansard', 'flat', 'hip']) : r.pick(['parapet', 'flat']),
  });
  const aw = r.pick(P.awning); lbox(m, F, F.W * 0.3, -0.9, F.W * 0.7, 0.5, F.baseY + 3.6, F.baseY + 4.0, aw, sh(aw, 0.8)); // marquee
  if (r.chance(0.6)) { const nc = r.pick(P.neon), sx = F.W * r.range(0.12, 0.88); lbox(m, F, sx - 0.2, -0.9, sx + 0.2, 0.3, F.baseY + 6, F.baseY + 6 + Math.min(14, f * 1.6), nc, sh(nc, 0.7), { bay: 1, fh: 1, base: 0, ww: 0, wh: 0, style: ST.glow, seed: 1 }); } // blade sign
  if (f > 7 && r.chance(0.6)) lbox(m, F, F.W * 0.2, 1.6, F.W * 0.8, 1.9, top + 2.2, top + 4.6, P.dark[0], null, { bay: 1, fh: 1, base: 0, ww: 0, wh: 0, style: ST.flood, seed: 1 }); // roof sign
}
function emitOffice(m, F, b, s, r) {
  const f = s.floors, deco = b.zone === 6, wall = deco ? r.pick(P.tower) : r.chance(0.5) ? r.pick(P.stone) : r.pick(P.brick), tiers = [];
  const minDim = Math.min(F.W, F.D);
  if (f <= 11) tiers.push({ floors: f });
  else if (f <= 20) tiers.push({ floors: Math.round(f * r.range(0.5, 0.65)) }, { floors: 99, inset: minDim * 0.12 });
  else if (f <= 34) tiers.push({ floors: Math.round(f * 0.34) }, { floors: Math.round(f * 0.3), inset: minDim * 0.1 }, { floors: 99, inset: minDim * 0.1 });
  else tiers.push({ floors: Math.round(f * 0.22) }, { floors: Math.round(f * 0.24), inset: minDim * 0.09 }, { floors: Math.round(f * 0.24), inset: minDim * 0.08 }, { floors: 99, inset: minDim * 0.08 });
  const dark = deco && r.chance(0.15);
  emitTiers(m, F, b, s, r, {
    gh: deco ? 5.4 : 4.4, wall: dark ? r.pick(P.dark) : wall, base: deco ? (dark ? hx('#2a2826') : r.pick(P.stone)) : null, trim: dark ? hx('#b08d57') : undefined,
    roof: r.pick(P.roof), bay: deco ? r.range(1.9, 2.6) : r.range(2.8, 3.6), ww: deco ? r.range(0.5, 0.62) : 0.5, wh: deco ? 0.6 : 0.58,
    style: ST.office | (deco && f > 8 ? ST.deco : 0), gstyle: (r.chance(0.5) ? ST.shop : ST.office) | ST.front, tiers, minW: 8, front: 0.4, rear: 0.6, margin: 0.3,
    corners: deco && f > 14, crown: f > 30 ? r.pick(['spire', 'ziggurat', 'lantern', 'spire']) : f > 16 ? r.pick(['ziggurat', 'lantern', 'hip', 'flat']) : f > 8 ? r.pick(['flat', 'parapet', 'ziggurat']) : r.pick(['flat', 'parapet']),
  });
}
function emitShops(m, F, b, s, r) {
  const { W, D } = F, y = F.baseY, n = Math.max(1, Math.round(W / r.range(6.5, 9))), uw = (W - 0.3) / n, seed = b.seed & 255;
  for (let k = 0; k < n; k++) {
    const a0 = 0.15 + k * uw, a1 = a0 + uw - 0.06, fl = Math.max(1, s.floors - (r.chance(0.3) ? 1 : 0)), wall = r.chance(0.6) ? r.pick(P.brick) : r.pick(P.house), rc = r.pick(P.roof);
    const z0 = 0.3, z1 = D - r.range(0.6, D > 14 ? 5 : 1.5), gh = 4.1, top = y + gh + (fl - 1) * s.fh, aw = r.pick(P.awning), trim = mixc(wall, [228, 222, 210], 0.5);
    lbox(m, F, a0, z0, a1, z1, F.lo - 1, y + gh, sh(wall, 0.9), fl === 1 ? rc : null, { bay: uw, fh: gh, base: y, ww: 0.84, wh: 0.62, style: ST.shop | ST.front, seed: seed + k * 31 }, 1);
    lbox(m, F, a0 + 0.2, z0 - 1.1, a1 - 0.2, z0, y + 2.9, y + 3.15, aw, sh(aw, 0.75));
    lbox(m, F, a0, z0 - 0.12, a1, z0, y + 3.3, y + gh, sh(aw, 0.6), null);
    if (fl > 1) lbox(m, F, a0, z0, a1, z1, y + gh, top, wall, rc, { bay: uw / (uw > 7 ? 3 : 2), fh: s.fh, base: y + gh, ww: 0.46, wh: 0.56, style: ST.home, seed: seed + k * 31 }, 5);
    lbox(m, F, a0, z0 - 0.2, a1, z0 + 0.35, top, top + r.range(0.5, 1.1), trim, sh(trim, 0.8));
    if (r.chance(0.5)) roofClutter(m, F, r, a0, z0 + 1, a1, z1, top, 1, rc);
  }
}
function emitIndustry(m, F, b, s, r) {
  const { W, D } = F, y = F.baseY, big = b.zone === 8, wall = r.chance(0.6) ? r.pick(P.brick) : r.pick(P.shed), rc = r.pick(P.roof), seed = b.seed & 255;
  const Wn = { bay: r.range(4, 5.5), fh: s.fh, base: y, ww: 0.78, wh: 0.6, style: ST.ind, seed };
  const yard = big ? r.range(3, 7) : r.range(1.5, 4), a0 = 0.8, a1 = W - 0.8, z0 = yard, z1 = D - 1;
  const mill = big && b.level >= 2 && s.variant < 60, split = mill ? a0 + (a1 - a0) * r.range(0.4, 0.55) : a1;
  if (mill) { // multi-storey brick mill block beside the shed
    const top = y + s.floors * s.fh; lbox(m, F, split + 0.6, z0, a1, z1, F.lo - 1, top, wall, rc, Wn);
    cornice(m, F, split + 0.6, z0, a1, z1, top, 0.5, sh(wall, 1.15), 0.2); roofClutter(m, F, r, split + 1.5, z0 + 1, a1 - 1, z1 - 1, top + 0.5, 3, rc);
  }
  const sh1 = y + (mill ? s.fh * 1.4 : s.floors * s.fh), n = Math.max(1, Math.round((split - a0) / r.range(7, 10))), bw = (split - a0) / n, saw = s.variant % 3;
  lbox(m, F, a0, z0, split, z1, F.lo - 1, sh1, wall, saw === 2 ? rc : null, Wn);
  if (saw < 2) for (let k = 0; k < n; k++) lroof(m, F, a0 + k * bw, z0, a0 + (k + 1) * bw, z1, sh1, saw === 0 ? bw * 0.28 : bw * 0.2, r.pick(P.metal), wall, true, 'z');
  else roofClutter(m, F, r, a0 + 1, z0 + 1, split - 1, z1 - 1, sh1, 3, rc);
  const stacks = big ? r.int(1, b.level + 1) : r.chance(0.35) ? 1 : 0;
  for (let k = 0; k < stacks; k++) {
    const px = a0 + 2 + r() * (a1 - a0 - 4), pz = z1 - 2 - r() * Math.min(6, z1 - z0 - 4), h = big ? r.range(26, 46) : r.range(12, 18), rr = big ? r.range(1.2, 1.7) : 0.7;
    lcyl(m, F, px, pz, rr, rr * 0.62, sh1 - 0.5, y + h, r.pick(P.brick), 8, false); lcyl(m, F, px, pz, rr * 0.7, rr * 0.7, y + h, y + h + 1.2, P.dark[0], 8, true);
  }
  if (big && yard > 4) for (let k = 0, nk = r.int(1, 3); k < nk; k++) { // tanks in the yard
    const rr = r.range(2, 3), px = a0 + rr + k * (rr * 2.4), h = r.range(4, 7); if (px + rr > a1) break;
    lcyl(m, F, px, yard * 0.5, rr, rr, y - 0.5, y + h, P.metal[r.int(0, 2)], 10, false); lcyl(m, F, px, yard * 0.5, rr, rr * 0.2, y + h, y + h + 0.9, P.metal[1], 10, true);
  }
  const aw = P.metal[1]; lbox(m, F, a0 + 1, z0 - 1.6, Math.min(split, a0 + 9), z0, y + 3.2, y + 3.45, aw, sh(aw, 0.8)); // loading dock canopy
}

export function emitBuilding(m, b) {
  const F = frame(b), s = b, r = rng(b.seed * 40503 + b.level * 7 + 13);
  m.birth = b.birth ?? -100; m.baseY = F.lo - 1.5; m.dur = m.birth > 0 ? constructionTime(b.height || 8) : 1.6;
  b.baseY = F.baseY; b.topY = F.baseY + (b.height || 6);
  if (b.sp) { if (ext.emitSpecial) ext.emitSpecial(m, F, b, r); m.dur = 1.6; return; }
  const st = ext.styles[b.st | 0], n0 = m.n; let saved = null;
  if (st && st.pal) { saved = {}; if (!st.fit) { st.fit = {}; for (const k in st.pal) { const src = st.pal[k], n = Math.max(src.length, P[k] ? P[k].length : 0); st.fit[k] = Array.from({ length: n }, (_, q) => src[q % src.length]); } } for (const k in st.pal) { saved[k] = P[k]; P[k] = st.fit[k]; } } // style palettes are cycled to the length the emitters index into
  if (!(ext.emit && ext.emit(m, F, b, s, r))) switch (b.zone) {
    case 1: s.variant < 3 ? emitRowhouse(m, F, b, s, r) : emitHouse(m, F, b, s, r); break;
    case 2: case 11: emitApartment(m, F, b, s, r); break;
    case 3: emitShops(m, F, b, s, r); break;
    case 4: emitHotel(m, F, b, s, r); break;
    case 10: s.floors <= 3 ? emitShops(m, F, b, s, r) : emitHotel(m, F, b, s, r); break;
    case 5: case 6: case 9: emitOffice(m, F, b, s, r); break;
    default: emitIndustry(m, F, b, s, r);
  }
  if (saved) for (const k in saved) P[k] = saved[k];
  if (st && st.glass) for (let n = n0; n < m.n; n++) { // curtain walls: wide glass, no deco piers
    const o = n * 4; if (m.win[o] > 3 && !(m.win[o + 2] & 8)) { m.win[o] = Math.max(m.win[o], st.glass * 255); m.win[o + 1] = Math.max(m.win[o + 1], 199); m.win[o + 2] &= ~16; }
  }
  if (b.vac) for (let n = n0; n < m.n; n++) { const o = n * 4; if (m.win[o] > 3) m.win[o + 2] = (m.win[o + 2] & ~3) | 3; } // vacant floors stay dark like a warehouse at night
  if (st && st.extra) st.extra(m, F, b, r);
  if (b.sign) ext.sign && ext.sign(m, F, b);
  m.dur = 1.6;
}
export const prim = { box, roof, cyl, blob, tree, lbox, lroof, lcyl, ltree, lpoly, lbarrel, cornice, roofClutter, yardTrees, frame, P, ST, hx, sh, mixc, setWin };

// ---- material ----------------------------------------------------------------------------------
export const buildingUniforms = { uTime: { value: 0 }, uNight: { value: 0 }, uLit: { value: new THREE.Vector4(0, 0, 0, 0) }, uSkyRefl: { value: new THREE.Color(0.5, 0.6, 0.7) }, uGlow: { value: new THREE.Vector3(0.4, 1.6, 1) } }; // uGlow: floodlight gain, sign and lamp gain, window gain
export function makeBuildingMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 });
  mat.onBeforeCompile = (shd) => {
    Object.assign(shd.uniforms, buildingUniforms);
    shd.vertexShader = shd.vertexShader.replace('#include <common>', `#include <common>
      attribute vec2 aUv; attribute vec4 aWin; attribute vec3 aAnim; uniform float uTime; varying vec2 vUv2; varying vec4 vWin;`)
      .replace('#include <color_vertex>', '#include <color_vertex>\nvColor.rgb = pow(vColor.rgb, vec3(2.2));')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      vUv2 = aUv; vWin = aWin;
      float gk = clamp((uTime - aAnim.x) / max(aAnim.z, 0.2), 0.0, 1.0); gk = 1.0 - (1.0 - gk) * (1.0 - gk);
      transformed.y = aAnim.y + (transformed.y - aAnim.y) * gk;`);
    shd.fragmentShader = shd.fragmentShader.replace('#include <common>', `#include <common>
      varying vec2 vUv2; varying vec4 vWin; uniform float uNight; uniform vec4 uLit; uniform vec3 uSkyRefl; uniform vec3 uGlow;
      float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      // box-filtered pulse train: window of width w starting at offset o in each unit cell
      float pint(float x, float o, float w){ return floor(x) * w + clamp(fract(x) - o, 0.0, w); }
      float pulse(float x, float o, float w, float fw){ return (pint(x + 0.5 * fw, o, w) - pint(x - 0.5 * fw, o, w)) / fw; }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      {
        float style = floor(vWin.z * 255.0 + 0.5);
        float prof = mod(style, 4.0), front = mod(floor(style / 8.0), 2.0), deco = mod(floor(style / 16.0), 2.0), flood = mod(floor(style / 64.0), 2.0);
        if (flood > 0.5) totalEmissiveRadiance += diffuseColor.rgb * uNight * uGlow.x;
        if (mod(floor(style / 32.0), 2.0) > 0.5) totalEmissiveRadiance += diffuseColor.rgb * (0.08 + uNight * uGlow.y);
        if (vWin.x > 0.004 && vUv2.y > 0.0) {
          vec2 fw = max(fwidth(vUv2), vec2(1e-4));
          float ww = vWin.x, wh = vWin.y, sill = front > 0.5 ? 0.06 : (1.0 - wh) * 0.42;
          float mx = pulse(vUv2.x, (1.0 - ww) * 0.5, ww, fw.x), my = pulse(vUv2.y, sill, wh, fw.y);
          float mask = mx * my, lod = smoothstep(0.3, 1.1, max(fw.x, fw.y));
          vec2 cell = floor(vUv2); float seed = floor(vWin.w * 255.0 + 0.5);
          float course = pulse(vUv2.y, 0.0, 0.07, fw.y) * (1.0 - lod);
          diffuseColor.rgb *= 1.0 - 0.16 * course;
          diffuseColor.rgb *= 0.94 + 0.12 * h21(vec2(cell.y, seed + 3.0)) * (1.0 - lod);        // slight tone shift per storey
          diffuseColor.rgb *= mix(0.78, 1.0, smoothstep(0.0, 2.2, vUv2.y));                      // grime near the pavement
          if (deco > 0.5) diffuseColor.rgb *= mix(1.0, 0.6, mx * (1.0 - my));   // dark spandrels between piers
          float rv = pulse(vUv2.x, (1.0 - ww) * 0.5 - 0.035, ww + 0.07, fw.x) * pulse(vUv2.y, sill - 0.045, wh + 0.09, fw.y);
          diffuseColor.rgb *= 1.0 - 0.38 * rv * (1.0 - lod);                                     // shadowed reveal around the glass
          float r1 = h21(cell + seed * vec2(0.731, 1.371)), r2 = h21(cell.yx * 1.7 + seed), fr = h21(vec2(cell.y * 3.1 + 0.5, seed));
          float frac = prof < 0.5 ? uLit.x : prof < 1.5 ? uLit.y : prof < 2.5 ? uLit.z : uLit.w;
          if (prof > 0.5 && prof < 1.5) frac *= mix(0.25, 1.9, fr * fr); else frac *= 0.6 + 0.8 * h21(floor(cell / vec2(2.0, 1.0)) + seed);
          if (front > 0.5 && prof > 1.5) frac = max(frac, uLit.z * 1.6);
          frac = clamp(frac, 0.0, 1.0);
          float lit = mix(step(r1, frac), frac, lod);
          vec3 warm = mix(vec3(1.0, 0.72, 0.40), vec3(1.0, 0.86, 0.62), r2);
          vec3 lc = prof < 0.5 ? warm : prof < 1.5 ? mix(vec3(1.0, 0.9, 0.7), vec3(0.8, 0.9, 1.0), step(0.6, r2)) : prof < 2.5 ? vec3(1.0, 0.84, 0.58) : vec3(0.95, 0.9, 0.72);
          lc = mix(lc, vec3(0.45, 0.6, 1.0), step(0.93, r2) * step(prof, 0.5));
          float fres = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
          vec3 glass = mix(vec3(0.035, 0.045, 0.055), uSkyRefl, 0.16 + 0.5 * fres) * (0.75 + 0.5 * r2);
          diffuseColor.rgb = mix(diffuseColor.rgb, glass, mask);
          roughnessFactor = mix(roughnessFactor, 0.12, mask);
          totalEmissiveRadiance += lc * lc * (lit * mask * uNight * (0.35 + 0.75 * r2) * uGlow.z);
          totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.66, 0.36) * (uNight * 0.2 * exp(-max(vUv2.y, 0.0) * 0.5) * (1.0 - mask));   // lamp light spilling up the lowest storeys
        }
      }`);
  };
  return mat;
}

// ---- chunk renderer ----------------------------------------------------------------------------
export class BuildingRenderer {
  constructor(scene) {
    this.scene = scene; this.mat = makeBuildingMaterial(); this.mb = new MeshBuilder();
    this.meshes = new Array(CXN * CZN).fill(null); this.dirty = new Set(); this.verts = 0;
  }
  markDirty(c) { this.dirty.add(c); }
  rebuild(c) {
    const ids = chunkBuildings[c], old = this.meshes[c];
    if (old) { this.verts -= old.geometry.attributes.position.count; this.scene.remove(old); old.geometry.dispose(); this.meshes[c] = null; }
    if (!ids.size) return;
    const mb = this.mb; mb.reset();
    for (const id of ids) emitBuilding(mb, buildings.get(id));
    const mesh = new THREE.Mesh(mb.toGeometry(), this.mat);
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false;
    this.scene.add(mesh); this.meshes[c] = mesh; this.verts += mb.n;
  }
  // Rebuild dirty chunks nearest the focus first, within a time budget.
  update(fx, fz, budgetMs = 7) {
    if (!this.dirty.size) return;
    const t0 = performance.now();
    const list = [...this.dirty];
    if (list.length > 1) {
      const fi = (fx - MAP.minX) / (CELL * CH), fj = (fz - MAP.minZ) / (CELL * CH);
      const dist = (c) => Math.hypot((c % CXN) + 0.5 - fi, Math.floor(c / CXN) + 0.5 - fj);
      list.sort((a, b) => dist(a) - dist(b));
    }
    for (const c of list) { this.rebuild(c); this.dirty.delete(c); if (performance.now() - t0 > budgetMs) break; }
  }
  clear() { for (let c = 0; c < this.meshes.length; c++) if (this.meshes[c]) { this.scene.remove(this.meshes[c]); this.meshes[c].geometry.dispose(); this.meshes[c] = null; } this.dirty.clear(); this.verts = 0; }
}
