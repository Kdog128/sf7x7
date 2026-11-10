// Player-placed structures (parks, services, landmarks, venues, stadiums), building styles by era and
// neighbourhood, and local business names. Everything is emitted into the same merged chunk meshes as zoned buildings.
import { prim, ext } from './buildings.js';
import { heightAt, ll, K } from './terrain.js';
import { roadY } from './roads.js';
import { rng } from './util.js';

const { lbox, lroof, lcyl, ltree, cornice, P, ST, hx, sh, mixc } = prim;
const GLOW = { bay: 1, fh: 1, base: 0, ww: 0, wh: 0, style: 32, seed: 0 };
const win = (b, F, bay, fh, ww, wh, style, base) => ({ bay, fh, base: base ?? F.baseY, ww, wh, style, seed: b.seed & 255 });
const C = {
  stone: hx('#b3ab98'), white: hx('#d6d2c6'), brick: hx('#8a5d4e'), dark: hx('#3a3836'), roof: hx('#4c4945'), conc: hx('#a29e94'), steel: hx('#7d8488'),
  grass: hx('#6f8552'), field: hx('#5f7d48'), sand: hx('#c9b98f'), path: hx('#b9ad92'), pave: hx('#aaa598'), water: hx('#5b7f8c'), wood: hx('#7a6450'),
  orange: hx('#a8442f'), bridge: hx('#b4b8ba'), ochre: hx('#b9987a'), red: hx('#9c2f2a'), blue: hx('#3f6ea8'), gold: hx('#c8a04a'), neonM: hx('#d05aa8'), neonC: hx('#4fb8c8'),
  seat: hx('#52606a'), glass: hx('#6f8088'),
};
// oriented beam between two points (bridge cables, struts)
function beam(m, x0, y0, z0, x1, y1, z1, w, h, c) {
  m.w[0] = m.w[1] = m.w[2] = m.w[3] = 0;
  const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz) || 1, px = (-dz / l) * w * 0.5, pz = (dx / l) * w * 0.5, nx = -dz / l, nz = dx / l;
  const q = (ax, ay, az, bx, by, bz, cx, cy, cz, ex, ey, ez, n0, n1, n2) => { const a = m.v(ax, ay, az, n0, n1, n2, 0, 0, c), b = m.v(bx, by, bz, n0, n1, n2, 0, 0, c), d = m.v(cx, cy, cz, n0, n1, n2, 0, 0, c), e = m.v(ex, ey, ez, n0, n1, n2, 0, 0, c); m.quad(a, b, d, e); };
  q(x0 + px, y0, z0 + pz, x1 + px, y1, z1 + pz, x1 + px, y1 + h, z1 + pz, x0 + px, y0 + h, z0 + pz, nx, 0, nz);
  q(x1 - px, y1, z1 - pz, x0 - px, y0, z0 - pz, x0 - px, y0 + h, z0 - pz, x1 - px, y1 + h, z1 - pz, -nx, 0, -nz);
  q(x0 + px, y0 + h, z0 + pz, x1 + px, y1 + h, z1 + pz, x1 - px, y1 + h, z1 - pz, x0 - px, y0 + h, z0 - pz, 0, 1, 0);
}
// rectangular ring of four slabs (stands, cloisters)
function ring(m, F, x0, z0, x1, z1, t, y0, y1, wc, rc, W, open = 0) {
  if (!(open & 1)) lbox(m, F, x0, z0, x1, z0 + t, y0, y1, wc, rc, W);
  if (!(open & 4)) lbox(m, F, x0, z1 - t, x1, z1, y0, y1, wc, rc, W);
  if (!(open & 8)) lbox(m, F, x0, z0 + t, x0 + t, z1 - t, y0, y1, wc, rc, W);
  if (!(open & 2)) lbox(m, F, x1 - t, z0 + t, x1, z1 - t, y0, y1, wc, rc, W);
}
function bowl(m, F, b, x0, z0, x1, z1, steps, t, h0, dh, wall, open = 0) {
  const W1 = win(b, F, 6, 5, 0.5, 0.5, ST.shop);
  for (let k = 0; k < steps; k++) {
    const o = k * t, y1 = F.baseY + h0 + dh * (steps - k);
    ring(m, F, x0 + o, z0 + o, x1 - o, z1 - o, t, F.lo - 1, y1, k === 0 ? wall : C.seat, sh(C.seat, 0.9 + 0.08 * (k & 1)), k === 0 ? W1 : null, open);
  }
  const o = steps * t;
  lbox(m, F, x0 + o, z0 + o, x1 - o, z1 - o, F.lo - 1, F.baseY + 0.4, C.field, C.field);
}
function mast(m, F, x, z, h) { lcyl(m, F, x, z, 0.7, 0.5, F.baseY, F.baseY + h, C.steel, 6, false); lbox(m, F, x - 3.5, z - 0.6, x + 3.5, z + 0.6, F.baseY + h, F.baseY + h + 3.5, C.white, C.steel, GLOW); }
function scatterTrees(m, F, r, x0, z0, x1, z1, n, hMin = 6, hMax = 11) { for (let k = 0; k < n; k++) { const h = r.range(hMin, hMax); ltree(m, F, r.range(x0, x1), r.range(z0, z1), h, h * r.range(0.3, 0.42), r.pick(P.tree)); } }
const sign = (m, F, x0, z0, x1, z1, y, h, c) => lbox(m, F, x0, z0, x1, z1, y, y + h, c, sh(c, 0.7), GLOW);

// ---- emitters ------------------------------------------------------------------------------------
const E = {
  park(m, F, b, r) {
    const { W, D } = F, y = F.baseY;
    lbox(m, F, W * 0.5 - 1, 0.5, W * 0.5 + 1, D - 0.5, y - 1.5, y + 0.08, C.path, C.path); lbox(m, F, 0.5, D * 0.5 - 1, W - 0.5, D * 0.5 + 1, y - 1.5, y + 0.08, C.path, C.path);
    scatterTrees(m, F, r, 2, 2, W - 2, D - 2, Math.max(2, Math.round((W * D) / 110)));
    if (W > 30 && D > 30) { lcyl(m, F, W * 0.5, D * 0.5, 5, 5, y - 1, y + 0.5, C.stone, 12); lcyl(m, F, W * 0.5, D * 0.5, 4.3, 4.3, y, y + 0.35, C.water, 12); }
    for (let k = 0; k < Math.floor(W / 24); k++) lbox(m, F, 6 + k * 24, D * 0.5 + 1.4, 8 + k * 24, D * 0.5 + 2, y, y + 0.5, C.wood, C.wood);
  },
  plaza(m, F, b, r) {
    const { W, D } = F, y = F.baseY;
    lbox(m, F, 0.3, 0.3, W - 0.3, D - 0.3, F.lo - 1, y + 0.12, C.pave, C.pave); lbox(m, F, 2, 2, W - 2, D - 2, y, y + 0.16, sh(C.pave, 1.08), sh(C.pave, 1.08));
    if (Math.min(W, D) > 20) { lcyl(m, F, W / 2, D / 2, 4.5, 4.5, y, y + 0.7, C.stone, 12); lcyl(m, F, W / 2, D / 2, 3.8, 3.8, y, y + 0.5, C.water, 12); lcyl(m, F, W / 2, D / 2, 0.6, 0.4, y, y + 2.6, C.stone, 8); }
    for (let x = 5; x < W - 4; x += 12) for (const z of [4, D - 4]) { lbox(m, F, x - 1, z - 1, x + 1, z + 1, y, y + 0.7, C.conc, C.grass); ltree(m, F, x, z, 7, 2.6, r.pick(P.tree)); }
  },
  fountain(m, F) { const y = F.baseY, c = F.W / 2; lcyl(m, F, c, c, 6, 6, F.lo - 1, y + 0.7, C.stone, 14); lcyl(m, F, c, c, 5.2, 5.2, y, y + 0.5, C.water, 14); lcyl(m, F, c, c, 0.8, 0.5, y, y + 2.4, C.stone, 8); lcyl(m, F, c, c, 2.2, 2.2, y + 2.4, y + 2.7, C.stone, 10); lcyl(m, F, c, c, 0.3, 0.2, y + 2.7, y + 4, C.stone, 6); },
  bench(m, F) { const y = F.baseY; lbox(m, F, 2, 3.4, 6, 4.2, y, y + 0.5, C.wood, C.wood); lbox(m, F, 2, 4.2, 6, 4.4, y, y + 1, C.wood, C.wood); },
  lamp(m, F) { const y = F.baseY; lcyl(m, F, 4, 4, 0.16, 0.1, y, y + 5, C.dark, 6, false); lbox(m, F, 3.6, 3.6, 4.4, 4.4, y + 5, y + 5.7, hx('#ffe7b0'), C.dark, GLOW); },
  planter(m, F, b, r) { const y = F.baseY; lbox(m, F, 2, 2.6, 6, 5.4, y, y + 0.8, C.conc, C.grass); prim.blob(m, F.X(3.2, 4), y + 1.3, F.Z(3.2, 4), 1.1, 0.8, r.pick(P.tree)); prim.blob(m, F.X(4.9, 4), y + 1.2, F.Z(4.9, 4), 1, 0.7, r.pick(P.tree)); },
  tree(m, F, b, r) { ltree(m, F, 2.6, 3, r.range(7, 10), 3, r.pick(P.tree)); ltree(m, F, 5.6, 5.4, r.range(6, 9), 2.6, r.pick(P.tree)); },

  school(m, F, b) {
    const { W, D } = F, y = F.baseY, wl = C.brick, Wn = win(b, F, 3.2, 3.8, 0.6, 0.6, ST.home);
    lbox(m, F, 2, 3, W - 2, 13, F.lo - 1, y + 8, wl, C.roof, Wn); lbox(m, F, 2, 13, 11, D - 6, F.lo - 1, y + 8, wl, C.roof, Wn); lbox(m, F, W - 11, 13, W - 2, D - 6, F.lo - 1, y + 8, wl, C.roof, Wn);
    cornice(m, F, 2, 3, W - 2, 13, y + 8, 0.5, C.white, 0.3, C.roof); lbox(m, F, W / 2 - 3.5, 1.6, W / 2 + 3.5, 3, y, y + 9.5, C.white, C.roof); lroof(m, F, W / 2 - 4, 1.4, W / 2 + 4, 6, y + 9.5, 2.4, C.roof, C.white, true, 'z');
    lcyl(m, F, 4, 1.5, 0.12, 0.1, y, y + 9, C.steel, 5, false); lbox(m, F, 13, 16, W - 13, D - 4, y - 1, y + 0.1, C.pave, C.pave);
  },
  university(m, F, b, r) {
    const { W, D } = F, y = F.baseY, Wn = win(b, F, 3.4, 4.2, 0.55, 0.65, ST.home), wl = C.stone;
    lbox(m, F, W / 2 - 16, 4, W / 2 + 16, 22, F.lo - 1, y + 17, wl, C.roof, Wn); cornice(m, F, W / 2 - 16, 4, W / 2 + 16, 22, y + 17, 0.8, C.white, 0.5, C.roof);
    lcyl(m, F, W / 2, 13, 7, 7, y + 17, y + 23, C.white, 12, false); lcyl(m, F, W / 2, 13, 7.4, 1, y + 23, y + 30, hx('#6f9384'), 12, false); lcyl(m, F, W / 2, 13, 0.6, 0.3, y + 30, y + 34, C.gold, 6);
    for (let k = 0; k < 6; k++) lcyl(m, F, W / 2 - 10 + k * 4, 3, 0.7, 0.7, y, y + 12, C.white, 8, false);
    lbox(m, F, W / 2 - 12, 1.6, W / 2 + 12, 4, y + 12, y + 14, C.white, C.roof);
    lbox(m, F, 3, 10, 17, D - 8, F.lo - 1, y + 12.6, C.brick, C.roof, Wn); lbox(m, F, W - 17, 10, W - 3, D - 8, F.lo - 1, y + 12.6, C.brick, C.roof, Wn);
    lbox(m, F, 20, D - 20, W - 20, D - 6, F.lo - 1, y + 9, wl, C.roof, Wn); scatterTrees(m, F, r, 20, 26, W - 20, D - 24, 9);
  },
  hospital(m, F, b) {
    const { W, D } = F, y = F.baseY, Wn = win(b, F, 3, 3.8, 0.7, 0.6, ST.office);
    lbox(m, F, 3, 4, W - 3, D - 6, F.lo - 1, y + 9, C.conc, C.roof, Wn); lbox(m, F, 8, 10, W - 8, 26, y + 9, y + 36, C.white, C.roof, Wn); lbox(m, F, 12, 26, 28, D - 10, y + 9, y + 24, C.white, C.roof, Wn);
    sign(m, F, W / 2 - 1, 9.4, W / 2 + 1, 10, y + 29, 5, C.red); sign(m, F, W / 2 - 2.5, 9.4, W / 2 + 2.5, 10, y + 30.5, 2, C.red);
    lbox(m, F, W / 2 - 6, 1, W / 2 + 6, 4, y + 4, y + 4.5, C.white, C.roof); lcyl(m, F, 16, 16, 5, 5, y + 36, y + 36.3, hx('#55606a'), 12);
  },
  police(m, F, b) {
    const { W, D } = F, y = F.baseY, Wn = win(b, F, 3, 3.8, 0.5, 0.6, ST.office);
    lbox(m, F, 2, 3, W - 2, D - 8, F.lo - 1, y + 12, C.stone, C.roof, Wn); cornice(m, F, 2, 3, W - 2, D - 8, y + 12, 0.7, C.white, 0.4, C.roof);
    lbox(m, F, W / 2 - 3, 1.8, W / 2 + 3, 3, y, y + 5, C.white, C.roof); sign(m, F, W / 2 - 0.5, 1.5, W / 2 + 0.5, 1.8, y + 3.4, 1, C.blue); lbox(m, F, 3, D - 7, W - 3, D - 1, y - 1, y + 0.1, C.pave, C.pave);
  },
  fire(m, F, b) {
    const { W, D } = F, y = F.baseY, Wn = win(b, F, 3.2, 4, 0.5, 0.55, ST.home);
    lbox(m, F, 2, 3, W - 2, D - 6, F.lo - 1, y + 9.5, C.brick, C.roof, Wn); cornice(m, F, 2, 3, W - 2, D - 6, y + 9.5, 0.6, C.white, 0.3, C.roof);
    for (let k = 0; k < 3; k++) lbox(m, F, 4.5 + k * 8, 2.7, 10.5 + k * 8, 3.1, y, y + 4.4, C.red, C.red);
    lbox(m, F, W - 8, D - 12, W - 3, D - 7, y, y + 19, C.brick, C.roof, win(b, F, 2.5, 4, 0.3, 0.5, ST.home)); lroof(m, F, W - 8.4, D - 12.4, W - 2.6, D - 6.6, y + 19, 2.5, C.roof, C.brick);
  },

  transamerica(m, F, b) {
    const { W, D } = F, y = F.baseY, H = 260 * K ** 0.3, N = 26, cx = W / 2, cz = D / 2, h0 = W / 2 - 1;
    for (let k = 0; k < N; k++) { const s = h0 * (1 - (k / N) * 0.94), s1 = h0 * (1 - ((k + 1) / N) * 0.94), ya = y + (H * 0.83 * k) / N, yb = y + (H * 0.83 * (k + 1)) / N; lbox(m, F, cx - s, cz - s, cx + s, cz + s, k ? ya : F.lo - 1, yb, C.white, k === N - 1 ? C.white : null, win(b, F, 2.4, (H * 0.83) / 48, 0.5, 0.6, ST.office, y)); void s1; }
    const yw = y + H * 0.5; lbox(m, F, cx - 3, cz - h0 * 0.52, cx + 3, cz - h0 * 0.3, yw, y + H * 0.8, C.white, C.white); lbox(m, F, cx - 3, cz + h0 * 0.3, cx + 3, cz + h0 * 0.52, yw, y + H * 0.8, C.white, C.white);
    lcyl(m, F, cx, cz, h0 * 0.07, 0.2, y + H * 0.83, y + H, hx('#c9ccc8'), 4, false); sign(m, F, cx - 0.5, cz - 0.5, cx + 0.5, cz + 0.5, y + H, 1.5, hx('#ffffff'));
    for (let k = 0; k < 4; k++) { const a = [[2, 2], [W - 2, 2], [2, D - 2], [W - 2, D - 2]][k]; lcyl(m, F, a[0], a[1], 1, 1, y, y + 9, C.white, 6); }
  },
  salesforce(m, F, b) {
    const { W, D } = F, y = F.baseY, H = 326 * K ** 0.3, cx = W / 2, cz = D / 2, h0 = W / 2 - 3, Wn = win(b, F, 1.9, H / 61, 0.9, 0.82, ST.office, y);
    lbox(m, F, cx - h0, cz - h0, cx + h0, cz + h0, F.lo - 1, y + H * 0.7, C.glass, null, Wn);
    for (let k = 0; k < 7; k++) { const s = h0 * (1 - (k + 1) * 0.045), ya = y + H * (0.7 + k * 0.04), yb = ya + H * 0.04; lbox(m, F, cx - s, cz - s, cx + s, cz + s, ya, yb, C.glass, k === 6 ? C.steel : null, k < 5 ? Wn : { ...GLOW }); }
    lbox(m, F, 1, 1, W - 1, D - 1, F.lo - 1, y + 14, sh(C.glass, 1.1), C.grass, win(b, F, 4, 7, 0.9, 0.85, ST.shop | ST.front, y));
  },
  paintedladies(m, F, b, r) {
    const { W, D } = F, y = F.baseY, n = 7, hw = W / n, cols = ['#b9a6c0', '#9db5b0', '#c9b37a', '#b58a7a', '#8fa6bd', '#c7c1ae', '#a7b38f'].map(hx);
    for (let k = 0; k < n; k++) {
      const x0 = k * hw + 0.3, x1 = (k + 1) * hw - 0.3, c = cols[k], yb = y + 1.2 + k * 0.25;
      lbox(m, F, x0, 5, x1, 17, F.lo - 1, yb + 9.6, c, null, win(b, F, 2.4, 3.2, 0.42, 0.62, ST.home, yb)); lroof(m, F, x0 - 0.2, 4.6, x1 + 0.2, 17.2, yb + 9.6, 3.4, C.roof, c, true, 'z');
      lbox(m, F, x0 + 0.5, 3.8, x0 + hw * 0.55, 5, yb, yb + 7.6, mixc(c, [240, 236, 226], 0.4), C.roof, win(b, F, 1.6, 3.2, 0.6, 0.62, ST.home, yb)); lbox(m, F, x1 - 2.6, 2.6, x1 - 0.6, 5, F.lo - 1, yb, C.stone, C.stone);
    }
    scatterTrees(m, F, r, 4, 19, W - 4, D - 1.5, 6, 5, 8);
  },
  coit(m, F) {
    const { W, D } = F, y = F.baseY, cx = W / 2, cz = D / 2;
    lbox(m, F, cx - 9, cz - 9, cx + 9, cz + 9, F.lo - 1, y + 7, C.white, C.white); lcyl(m, F, cx, cz, 5.6, 5.3, y + 7, y + 52, C.white, 16, false);
    lcyl(m, F, cx, cz, 5.9, 5.9, y + 52, y + 54, C.white, 16); lcyl(m, F, cx, cz, 5.0, 5.0, y + 54, y + 60, sh(C.white, 0.8), 16, false); lcyl(m, F, cx, cz, 5.6, 5.6, y + 60, y + 61.5, C.white, 16); lcyl(m, F, cx, cz, 3.6, 3.4, y + 61.5, y + 64, C.white, 12);
  },
  alcatraz(m, F, b) {
    const { W, D } = F, y = F.baseY, Wn = win(b, F, 3, 3.6, 0.4, 0.5, ST.ind);
    lbox(m, F, 8, 12, W - 14, 30, F.lo - 1, y + 12, hx('#c2bcab'), C.roof, Wn); lbox(m, F, W - 30, 30, W - 14, 40, F.lo - 1, y + 9, hx('#b8b0a0'), C.roof, Wn);
    lcyl(m, F, 5, 8, 2.2, 1.6, y, y + 24, C.white, 10, false); lcyl(m, F, 5, 8, 2, 2, y + 24, y + 26.5, hx('#fff2c0'), 8); lcyl(m, F, 5, 8, 2.2, 0.2, y + 26.5, y + 28.5, C.dark, 8, false);
    for (const [ax, az] of [[W - 8, 10], [W - 4, 10], [W - 8, 14], [W - 4, 14]]) lcyl(m, F, ax, az, 0.3, 0.3, y, y + 18, C.steel, 5, false);
    lcyl(m, F, W - 6, 12, 3.6, 3.6, y + 18, y + 24, hx('#8a7a66'), 10); lbox(m, F, 12, 34, 22, 42, F.lo - 1, y + 7, C.conc, C.roof, Wn);
  },
  palace(m, F, b, r) {
    const { W, D } = F, y = F.baseY, cx = W / 2, cz = D * 0.42, c = C.ochre;
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2 + 0.39; lcyl(m, F, cx + Math.cos(a) * 13, cz + Math.sin(a) * 13, 1.5, 1.4, y, y + 22, c, 8, false); }
    lcyl(m, F, cx, cz, 15.5, 15.5, y + 22, y + 27, c, 16, false); lcyl(m, F, cx, cz, 15, 4, y + 27, y + 39, hx('#a8866a'), 16, false); lcyl(m, F, cx, cz, 4, 0.5, y + 39, y + 43, hx('#8f7058'), 10, false);
    for (let k = 0; k <= 16; k++) { const a = Math.PI * (0.08 + (0.84 * k) / 16), px = cx - Math.cos(a) * 30, pz = cz + 4 - Math.sin(a) * 26; lcyl(m, F, px, pz, 1.1, 1, y, y + 14, c, 6, false); lbox(m, F, px - 1.8, pz - 1.8, px + 1.8, pz + 1.8, y + 14, y + 16.5, c, sh(c, 0.8)); }
    lbox(m, F, 8, D - 24, W - 8, D - 4, F.lo - 1, y + 0.05, C.water, C.water); scatterTrees(m, F, r, 3, D - 28, W - 3, D - 2, 8);
  },
  ferry(m, F, b) {
    const { W, D } = F, y = F.baseY, Wn = win(b, F, 4.2, 5, 0.6, 0.72, ST.shop), cx = W / 2;
    lbox(m, F, 1, 3, W - 1, D - 2, F.lo - 1, y + 15, C.stone, C.roof, Wn); cornice(m, F, 1, 3, W - 1, D - 2, y + 15, 0.9, C.white, 0.5, C.roof); lroof(m, F, 3, 6, W - 3, D - 5, y + 15.9, 3, hx('#5d6866'), C.stone);
    lbox(m, F, cx - 5, 5, cx + 5, 15, y + 15, y + 44, C.stone, null, win(b, F, 3.3, 5, 0.4, 0.6, ST.office, y)); cornice(m, F, cx - 5, 5, cx + 5, 15, y + 44, 1, C.white, 0.6);
    lbox(m, F, cx - 4.2, 5.8, cx + 4.2, 14.2, y + 45, y + 55, C.white, C.white); sign(m, F, cx - 2.2, 5.5, cx + 2.2, 5.8, y + 47.5, 4.4, hx('#f3ead0'));
    lbox(m, F, cx - 3.2, 6.8, cx + 3.2, 13.2, y + 55, y + 63, C.stone, C.white); lcyl(m, F, cx, 10, 3, 0.4, y + 63, y + 71, hx('#6f9384'), 8, false); lcyl(m, F, cx, 10, 0.15, 0.1, y + 71, y + 78, C.steel, 5, false);
  },
  ghirardelli(m, F, b) {
    const { W, D } = F, y = F.baseY, Wn = win(b, F, 3.4, 4, 0.5, 0.62, ST.shop), br = hx('#8a5445');
    lbox(m, F, 2, 3, W * 0.45, 20, F.lo - 1, y + 16, br, C.roof, Wn); lbox(m, F, W * 0.55, 3, W - 2, 18, F.lo - 1, y + 12, br, C.roof, Wn); lbox(m, F, 2, D - 18, W - 2, D - 3, F.lo - 1, y + 13, br, C.roof, Wn);
    lbox(m, F, W * 0.45, 3, W * 0.45 + 8, 11, F.lo - 1, y + 26, br, null, win(b, F, 2.6, 4, 0.4, 0.6, ST.home)); lroof(m, F, W * 0.45 - 0.4, 2.6, W * 0.45 + 8.4, 11.4, y + 26, 5, hx('#55605c'), br);
    for (let k = 0; k < 2; k++) lcyl(m, F, W * 0.56 + k * 22, 17, 0.25, 0.25, y + 12, y + 17, C.steel, 5, false);
    sign(m, F, W * 0.55, 16.7, W * 0.55 + 24, 17.2, y + 17, 3.6, hx('#f0d9a0')); lbox(m, F, 8, 22, W - 8, D - 20, y - 1, y + 0.12, C.pave, C.pave);
  },
  conservatory(m, F, b, r) {
    const { W, D } = F, y = F.baseY, cx = W / 2, Wn = win(b, F, 2, 5, 0.86, 0.9, ST.shop);
    lbox(m, F, 4, 10, W - 4, 22, F.lo - 1, y + 6, C.white, null, Wn); lroof(m, F, 4, 10, W - 4, 22, y + 6, 3.2, hx('#c8d2d0'), C.white, false, 'x');
    lcyl(m, F, cx, 16, 10, 10, y, y + 8, C.white, 16, false); lcyl(m, F, cx, 16, 10, 2.4, y + 8, y + 17, hx('#c8d2d0'), 16, false); lcyl(m, F, cx, 16, 2.4, 0.3, y + 17, y + 20.5, C.white, 8, false);
    lbox(m, F, cx - 3, 4, cx + 3, 10, y, y + 6, C.white, hx('#c8d2d0'), Wn); scatterTrees(m, F, r, 3, 24, W - 3, D - 2, 5, 4, 7);
  },
  ballpark(m, F, b, r) {
    const { W, D } = F, y = F.baseY, wall = b.sp === 'oracle' ? hx('#8a5a48') : C.brick;
    bowl(m, F, b, 4, 4, W - 4, D - 4, 4, 9, 4, 5.5, wall, 4);
    const o = 40; lbox(m, F, o + 20, o + 8, W - o - 20, D * 0.5, y + 0.4, y + 0.5, C.sand, C.sand); lbox(m, F, W / 2 - 14, o + 14, W / 2 + 14, D * 0.5 - 6, y + 0.5, y + 0.6, C.field, C.field);
    lbox(m, F, 10, D - 12, W - 10, D - 6, F.lo - 1, y + 7, wall, C.seat, win(b, F, 6, 5, 0.4, 0.5, ST.shop)); sign(m, F, W / 2 - 16, D - 9, W / 2 + 16, D - 8, y + 12, 9, hx('#d8d2bc'));
    for (const [ax, az] of [[8, 8], [W - 8, 8], [8, D * 0.6], [W - 8, D * 0.6]]) mast(m, F, ax, az, 38); void r;
  },
  arena(m, F, b) {
    const { W, D } = F, y = F.baseY, cx = W / 2, cz = D / 2 + 3, R = Math.min(W, D) / 2 - 8;
    lcyl(m, F, cx, cz, R, R, F.lo - 1, y + 22, C.conc, 20, false); lcyl(m, F, cx, cz, R + 1.2, R + 1.2, y + 22, y + 24, C.white, 20, false); lcyl(m, F, cx, cz, R + 1, R * 0.35, y + 24, y + 32, hx('#8f9698'), 20);
    lcyl(m, F, cx, cz, R + 0.4, R + 0.4, y + 6, y + 10, C.glass, 20, false); lbox(m, F, cx - 14, 2, cx + 14, cz - R + 4, F.lo - 1, y + 12, C.glass, C.roof, win(b, F, 3, 6, 0.86, 0.85, ST.shop | ST.front)); sign(m, F, cx - 10, 1.6, cx + 10, 2, y + 12.5, 3.2, hx('#e9dfc0'));
  },
  stadium(m, F, b) {
    const { W, D } = F;
    bowl(m, F, b, 4, 4, W - 4, D - 4, 5, 9, 5, 7, C.conc); lbox(m, F, 4, 4, W - 4, 10, F.baseY + 40, F.baseY + 41.5, C.white, C.steel); lbox(m, F, 4, D - 10, W - 4, D - 4, F.baseY + 40, F.baseY + 41.5, C.white, C.steel);
    for (const [ax, az] of [[6, 6], [W - 6, 6], [6, D - 6], [W - 6, D - 6]]) mast(m, F, ax, az, 52); sign(m, F, W / 2 - 20, 3.4, W / 2 + 20, 4, F.baseY + 30, 8, hx('#d8d2bc'));
  },
  soccer(m, F, b) {
    const { W, D } = F;
    bowl(m, F, b, 4, 4, W - 4, D - 4, 3, 9, 4, 6, C.conc); lbox(m, F, 2, 2, W - 2, 16, F.baseY + 24, F.baseY + 25.2, C.white, C.steel); lbox(m, F, 2, D - 16, W - 2, D - 2, F.baseY + 24, F.baseY + 25.2, C.white, C.steel);
    for (const [ax, az] of [[5, 5], [W - 5, 5], [5, D - 5], [W - 5, D - 5]]) mast(m, F, ax, az, 34);
  },
  tennis(m, F, b) {
    const { W, D } = F, y = F.baseY;
    bowl(m, F, b, 4, 4, 52, 52, 2, 7, 3, 5, C.conc); lbox(m, F, 22, 16, 34, 40, y + 0.4, y + 0.5, C.blue, C.blue);
    for (let k = 0; k < 2; k++) for (let j = 0; j < 2; j++) { const x0 = 58 + k * 18, z0 = 6 + j * 36; if (x0 + 14 > W || z0 + 30 > D) continue; lbox(m, F, x0, z0, x0 + 14, z0 + 30, F.lo - 1, y + 0.1, C.field, hx('#4f7f6a')); lbox(m, F, x0 + 2, z0 + 3, x0 + 12, z0 + 27, y + 0.1, y + 0.16, C.blue, C.blue); }
    lbox(m, F, 6, 56, 50, D - 4, F.lo - 1, y + 7, C.stone, C.roof, win(b, F, 3.5, 3.6, 0.6, 0.6, ST.shop));
  },
  golf(m, F, b, r) {
    const { W, D } = F, y = F.baseY, n = Math.max(3, Math.round((W * D) / 9000));
    for (let k = 0; k < n; k++) { const x = r.range(14, W - 14), z = r.range(14, D - 14); lcyl(m, F, x, z, r.range(9, 15), r.range(9, 15), heightAt(F.X(x, z), F.Z(x, z)) - 1, heightAt(F.X(x, z), F.Z(x, z)) + 0.12, hx('#86a264'), 12); lcyl(m, F, x + 2, z + 1, 0.06, 0.06, y, y + 2.4, C.white, 4, false); const bx = x + r.range(-22, 22), bz = z + r.range(-22, 22); if (bx > 6 && bx < W - 6 && bz > 6 && bz < D - 6) lcyl(m, F, bx, bz, r.range(4, 7), r.range(4, 7), heightAt(F.X(bx, bz), F.Z(bx, bz)) - 1, heightAt(F.X(bx, bz), F.Z(bx, bz)) + 0.1, C.sand, 9); }
    scatterTrees(m, F, r, 3, 3, W - 3, D - 3, Math.round((W * D) / 420), 7, 13); lbox(m, F, 4, 3, 26, 15, F.lo - 1, y + 6, C.white, C.roof, win(b, F, 3, 3.4, 0.6, 0.6, ST.shop)); lroof(m, F, 3.6, 2.6, 26.4, 15.4, y + 6, 3, hx('#5b4a40'), C.white);
  },
  olympic(m, F, b, r) {
    const { W, D } = F, y = F.baseY;
    bowl(m, F, b, 10, 10, 210, D - 10, 5, 9, 5, 7.5, C.white); lbox(m, F, 10, 10, 210, 17, y + 43, y + 44.5, C.white, C.steel); lbox(m, F, 10, D - 17, 210, D - 10, y + 43, y + 44.5, C.white, C.steel);
    lcyl(m, F, 232, 40, 3.2, 1.6, y, y + 46, C.white, 10, false); lcyl(m, F, 232, 40, 4.6, 2, y + 46, y + 49, C.steel, 10, false); lcyl(m, F, 232, 40, 0, 0, y, y, C.steel, 3); sign(m, F, 229.5, 37.5, 234.5, 42.5, y + 49, 6, hx('#ff9a3c'));
    lbox(m, F, 222, 70, W - 8, 150, F.lo - 1, y + 14, C.glass, null, win(b, F, 4, 7, 0.86, 0.85, ST.shop)); lroof(m, F, 222, 70, W - 8, 150, y + 14, 9, C.white, C.glass, false, 'z');
    const rc = ['#3f6ea8', '#c8a04a', '#3a3836', '#4f8a5a', '#9c2f2a'].map(hx); for (let k = 0; k < 5; k++) lcyl(m, F, 236 + k * 13, 176 + (k & 1) * 9, 6.5, 6.5, y - 1, y + 0.2 + k * 0.02, rc[k], 16);
    scatterTrees(m, F, r, 222, 196, W - 8, D - 8, 14);
  },
  f1pit(m, F, b) {
    const { W, D } = F, y = F.baseY;
    lbox(m, F, 2, 9, W - 2, D - 2, F.lo - 1, y + 9, C.white, C.roof, win(b, F, 5, 4.5, 0.82, 0.7, ST.shop | ST.front)); lbox(m, F, 2, 5, W - 2, 9, y + 9, y + 9.5, C.red, C.red);
    for (let k = 0; k < 4; k++) lbox(m, F, 4 + k * 2.2, 2 + k * 0.01, W - 4, 4.2 - k * 0.0, y + k * 0, y + 0.4, C.conc, C.conc); sign(m, F, W / 2 - 8, 8.6, W / 2 + 8, 9, y + 9.6, 2.4, hx('#e9dfc0'));
  },

  superclub(m, F, b) {
    const { W, D } = F, y = F.baseY, neon = b.seed & 1 ? C.neonM : C.neonC;
    lbox(m, F, 2, 3, W - 2, D - 3, F.lo - 1, y + 14, C.dark, C.roof); sign(m, F, 1.8, 2.8, W - 1.8, 3.1, y + 13, 0.6, neon); sign(m, F, 1.8, 2.8, W - 1.8, 3.1, y + 6, 0.35, neon);
    lbox(m, F, W / 2 - 5, 1, W / 2 + 5, 3, y + 3.6, y + 4.1, C.dark, C.dark); sign(m, F, W / 2 - 4, 0.9, W / 2 + 4, 1.1, y + 4.2, 1.6, hx('#f0e6d0')); lbox(m, F, W / 2 - 9, D / 2 - 6, W / 2 + 9, D / 2 + 6, y + 14, y + 19, sh(C.dark, 1.2), C.roof); sign(m, F, W / 2 - 9.2, D / 2 - 6.2, W / 2 + 9.2, D / 2 + 6.2, y + 18.4, 0.5, neon);
  },
  club(m, F, b) {
    const { W, D } = F, y = F.baseY, neon = [C.neonM, C.neonC, C.gold][b.seed % 3], wl = [C.brick, C.dark, hx('#5a524c')][(b.seed >> 2) % 3];
    lbox(m, F, 1, 2, W - 1, D - 2, F.lo - 1, y + 8.5, wl, C.roof, win(b, F, 4, 4.2, 0.3, 0.4, ST.shop, y + 4.2)); cornice(m, F, 1, 2, W - 1, D - 2, y + 8.5, 0.5, sh(wl, 1.3), 0.25, C.roof);
    sign(m, F, W / 2 - 4, 1.6, W / 2 + 4, 1.9, y + 4.6, 1.5, neon); lbox(m, F, W / 2 - 1.4, 1.8, W / 2 + 1.4, 2.1, y, y + 3, hx('#201c1a'), C.dark);
  },
  popup(m, F, b) {
    const { W, D } = F, y = F.baseY;
    lbox(m, F, 3, 6, W - 3, D - 3, F.lo - 1, y + 9, hx('#77756f'), null); lroof(m, F, 3, 6, W - 3, D - 3, y + 9, 3, hx('#5c5a55'), hx('#77756f'), true, 'z');
    for (let k = 0; k < 9; k++) sign(m, F, 4 + k * ((W - 8) / 8) - 0.25, 3.5, 4 + k * ((W - 8) / 8) + 0.25, 4, y + 4.4 - Math.sin((k / 8) * Math.PI) * 0.8, 0.5, [C.neonM, C.neonC, C.gold][k % 3]);
    lbox(m, F, 5, 1.5, 11, 4.5, y, y + 3, C.white, C.white); lbox(m, F, W - 10, 1.5, W - 5, 4.5, y, y + 2.6, hx('#6e2f2f'), hx('#6e2f2f'));
  },
  musicvenue(m, F, b) {
    const { W, D } = F, y = F.baseY, Wn = win(b, F, 3.4, 4.4, 0.5, 0.66, ST.shop);
    lbox(m, F, 2, 3, W - 2, 16, F.lo - 1, y + 15, C.stone, C.roof, Wn); cornice(m, F, 2, 3, W - 2, 16, y + 15, 0.8, C.white, 0.4, C.roof); lbox(m, F, 4, 16, W - 4, D - 3, F.lo - 1, y + 21, hx('#8c8478'), C.roof);
    lbox(m, F, W / 2 - 7, 0.6, W / 2 + 7, 3, y + 4.2, y + 5, C.dark, C.dark); sign(m, F, W / 2 - 7.1, 0.5, W / 2 + 7.1, 0.7, y + 5, 2, hx('#f3e6c4')); sign(m, F, W / 2 - 0.8, 2.4, W / 2 + 0.8, 2.9, y + 7, 9, C.red);
  },
  comedy(m, F, b) {
    const { W, D } = F, y = F.baseY;
    lbox(m, F, 0.8, 2, W - 0.8, D - 2, F.lo - 1, y + 8, C.brick, C.roof, win(b, F, 3, 4, 0.45, 0.55, ST.home, y + 4)); sign(m, F, 2, 1.6, W - 2, 1.9, y + 4.2, 1.3, C.gold); lbox(m, F, 1.4, 0.8, W - 1.4, 2, y + 3.6, y + 3.9, C.red, C.red);
  },
};
E.oracle = E.ballpark;

// Suspension bridges at their real sites. cfg: a, b (lon/lat ends), towers (fractions), h, colour, anchor (fraction or null)
function emitBridge(m, cfg) {
  const A = ll(...cfg.a), B = ll(...cfg.b), dx = B[0] - A[0], dz = B[1] - A[1], L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L, px = -uz, pz = ux, c = cfg.color, hw = 15, Ht = cfg.h * K ** 0.5;
  const at = (t, o) => [A[0] + dx * t + px * o, A[1] + dz * t + pz * o], deck = (t) => roadY(A[0] + dx * t, A[1] + dz * t);
  const sup = [[0, deck(0) + 2], ...cfg.towers.map((t) => [t, Ht]), [1, deck(1) + 2]];
  if (cfg.anchor) { sup.push([cfg.anchor, deck(cfg.anchor) + 14]); sup.sort((a, b) => a[0] - b[0]); const [x, z] = at(cfg.anchor, 0); prim.box(m, x - 14, z - 14, x + 14, z + 14, -8, deck(cfg.anchor) + 12, C.conc, C.conc); }
  for (const t of cfg.towers) for (const o of [-hw, hw]) {
    const [x, z] = at(t, o);
    prim.box(m, x - 5, z - 5, x + 5, z + 5, -10, 6, C.conc, C.conc);
    let w = 3.6; for (let k = 0; k < 4; k++) { prim.box(m, x - w, z - w, x + w, z + w, 6 + ((Ht - 6) * k) / 4, 6 + ((Ht - 6) * (k + 1)) / 4, c, k === 3 ? c : null); w *= 0.86; }
  }
  for (const t of cfg.towers) for (let k = 1; k <= 4; k++) { const y = deck(t) + 8 + ((Ht - deck(t) - 14) * k) / 4, a = at(t, -hw), b2 = at(t, hw); beam(m, a[0], y, a[1], b2[0], y, b2[1], 3.2, k === 4 ? 6 : 3.4, c); }
  // roadway lamps down both sides and a red beacon on each tower, so the span reads at night
  { const lamp = hx('#ffd9a0'), red = hx('#ff4a3a'), nl = Math.max(8, Math.round(L / 55));
    for (let k = 1; k < nl; k++) for (const o of [-hw + 1.5, hw - 1.5]) { const t = k / nl, [x, z] = at(t, o), yd = deck(t); prim.box(m, x - 0.25, z - 0.25, x + 0.25, z + 0.25, yd, yd + 7, c, null); prim.box(m, x - 0.7, z - 0.7, x + 0.7, z + 0.7, yd + 7, yd + 8.1, lamp, lamp, GLOW); }
    for (const t of cfg.towers) for (const o of [-hw, hw]) { const [x, z] = at(t, o); prim.box(m, x - 0.9, z - 0.9, x + 0.9, z + 0.9, Ht, Ht + 1.8, red, red, GLOW); } }
  for (let s = 0; s + 1 < sup.length; s++) {
    const [t0, y0] = sup[s], [t1, y1] = sup[s + 1], n = Math.max(6, Math.round(((t1 - t0) * L) / 45)), low = Math.min(deck((t0 + t1) / 2) + 5, Math.min(y0, y1));
    const cy = (u) => { const lin = y0 + (y1 - y0) * u, sag = (lin - low) * 4 * u * (1 - u) * (Math.min(y0, y1) > low + 1 ? 1 : 0); return lin - sag * (y0 !== y1 && (s === 0 || s === sup.length - 2) ? 0.55 : 1); };
    for (const o of [-hw, hw]) for (let k = 0; k < n; k++) {
      const ua = k / n, ub = (k + 1) / n, a = at(t0 + (t1 - t0) * ua, o), b2 = at(t0 + (t1 - t0) * ub, o);
      beam(m, a[0], cy(ua), a[1], b2[0], cy(ub), b2[1], 1.1, 1.1, c);
      if (k > 0 && k % 2 === 0) { const yd = deck(t0 + (t1 - t0) * ua) + 1; if (cy(ua) > yd + 2) beam(m, a[0], yd, a[1], a[0] + ux * 0.4, yd, a[1] + uz * 0.4, 0.4, cy(ua) - yd, c); }
    }
  }
}
export const BRIDGES = {
  goldengate: { a: [-122.4777, 37.8077], b: [-122.4797, 37.8327], towers: [0.26, 0.72], h: 227, color: C.orange },
  baybridge: { a: [-122.3888, 37.7872], b: [-122.3668, 37.8072], towers: [0.14, 0.38, 0.62, 0.86], h: 160, color: C.bridge, anchor: 0.5 },
};
E.goldengate = (m, F) => { lbox(m, F, 2, 2, F.W - 2, F.D - 2, F.lo - 1, F.baseY + 9, C.conc, C.conc); emitBridge(m, BRIDGES.goldengate); };
E.baybridge = (m, F) => { lbox(m, F, 2, 2, F.W - 2, F.D - 2, F.lo - 1, F.baseY + 9, C.conc, C.conc); emitBridge(m, BRIDGES.baybridge); };

// ---- catalog -------------------------------------------------------------------------------------
// cost and upkeep in $K. fx: amen [radius m, strength], svc [kind, radius], noise [radius, strength], tour (visitor draw), cap (venue capacity)
const S = (k, name, cat, w, d, h, cost, up, jobs, fx = {}, extra = {}) => ({ k, name, cat, w, d, h, cost, up, jobs, fx, ...extra });
export const CATALOG = [
  S('park', 'Park', 'park', 0, 0, 12, 0.5, 0.01, 0, { amen: [240, 0.55] }, { rect: true, green: true, per: true }),
  S('plaza', 'Plaza', 'park', 0, 0, 8, 0.8, 0.012, 0, { amen: [170, 0.35] }, { rect: true, per: true }),
  S('fountain', 'Fountain', 'park', 2, 2, 5, 14, 0.2, 0, { amen: [130, 0.3] }),
  S('tree', 'Trees', 'park', 1, 1, 9, 0.6, 0, 0, { amen: [50, 0.08] }, { green: true }),
  S('bench', 'Bench', 'park', 1, 1, 2, 0.3, 0, 0, { amen: [40, 0.05] }, { green: true }),
  S('lamp', 'Lamp', 'park', 1, 1, 6, 0.5, 0, 0, { amen: [40, 0.04] }, { green: true }),
  S('planter', 'Planter', 'park', 1, 1, 2, 0.4, 0, 0, { amen: [40, 0.06] }, { green: true }),
  S('school', 'School', 'service', 6, 6, 12, 140, 6, 60, { svc: ['edu', 640] }),
  S('university', 'University', 'service', 10, 9, 36, 700, 30, 900, { svc: ['edu', 1500], amen: [400, 0.3], uni: 1 }),
  S('hospital', 'Hospital', 'service', 8, 8, 38, 480, 28, 700, { svc: ['health', 1250] }),
  S('police', 'Police station', 'service', 4, 5, 14, 150, 9, 80, { svc: ['police', 950] }),
  S('fire', 'Fire station', 'service', 4, 5, 20, 140, 8, 60, { svc: ['fire', 850] }),
  S('goldengate', 'Golden Gate Bridge', 'landmark', 3, 3, 30, 3500, 20, 40, { tour: 10, amen: [900, 0.6] }, { site: [-122.4777, 37.8068], fixed: true, parody: 'Golden Great Bridge' }),
  S('baybridge', 'Bay Bridge', 'landmark', 3, 3, 30, 3000, 20, 40, { tour: 5, amen: [600, 0.3] }, { site: [-122.3893, 37.7866], fixed: true, parody: 'Bae Bridge' }),
  S('transamerica', 'Transamerica Pyramid', 'landmark', 6, 6, 260, 1500, 10, 1500, { tour: 6, amen: [500, 0.45] }, { site: [-122.4027, 37.7952], parody: 'Transpacifica Pyramid' }),
  S('salesforce', 'Salesforce Tower', 'landmark', 7, 7, 326, 2200, 14, 6000, { tour: 4, amen: [500, 0.4] }, { site: [-122.3970, 37.7897], parody: 'Salesfarce Tower' }),
  S('paintedladies', 'Painted Ladies', 'landmark', 7, 3, 16, 300, 1, 0, { tour: 5, amen: [350, 0.5] }, { site: [-122.4330, 37.7763], res: 40, parody: 'Tinted Ladies' }),
  S('coit', 'Coit Tower', 'landmark', 4, 4, 64, 350, 2, 12, { tour: 5, amen: [450, 0.5] }, { site: [-122.4058, 37.8024], parody: 'Quoit Tower' }),
  S('alcatraz', 'Alcatraz', 'landmark', 10, 6, 30, 500, 4, 60, { tour: 9, amen: [300, 0.2] }, { site: [-122.4230, 37.8267], parody: 'Alcatrash' }),
  S('palace', 'Palace of Fine Arts', 'landmark', 9, 9, 45, 700, 4, 30, { tour: 6, amen: [500, 0.6] }, { site: [-122.4484, 37.8029], green: true, parody: 'Palace of Fine Farts' }),
  S('ferry', 'Ferry Building', 'landmark', 14, 3, 75, 800, 5, 400, { tour: 7, amen: [500, 0.5] }, { site: [-122.3937, 37.7955], parody: 'Fairy Building' }),
  S('ghirardelli', 'Ghirardelli Square', 'landmark', 8, 6, 34, 600, 4, 300, { tour: 6, amen: [400, 0.45] }, { site: [-122.4226, 37.8058], parody: 'Girardeli Square' }),
  S('conservatory', 'Conservatory of Flowers', 'landmark', 8, 4, 22, 400, 3, 20, { tour: 4, amen: [450, 0.6] }, { site: [-122.4602, 37.7726], green: true, parody: 'Conservatory of Showers' }),
  S('oracle', 'Oracle Park', 'landmark', 22, 22, 44, 2400, 30, 800, { tour: 6, cap: 41000, noise: [520, 0.35], league: 'MLB' }, { site: [-122.3893, 37.7786], parody: 'Oracular Park' }),
  S('superclub', 'Superclub', 'night', 6, 6, 20, 380, 6, 120, { cap: 2400, noise: [420, 0.55], venue: 'club' }),
  S('club', 'Club', 'night', 3, 4, 10, 90, 2, 30, { cap: 450, noise: [260, 0.45], venue: 'club' }),
  S('popup', 'Warehouse pop-up', 'night', 5, 5, 13, 30, 1, 15, { cap: 800, noise: [380, 0.6], venue: 'club', temp: 3 }),
  S('musicvenue', 'Music venue', 'night', 5, 6, 22, 260, 4, 60, { cap: 1300, noise: [300, 0.4], venue: 'music' }),
  S('comedy', 'Comedy club', 'night', 2, 3, 9, 60, 1, 16, { cap: 180, noise: [120, 0.15], venue: 'comedy' }),
  S('ballpark', 'Ballpark', 'sport', 22, 22, 44, 2000, 28, 700, { cap: 40000, noise: [520, 0.35], league: 'MLB', tour: 3 }),
  S('arena', 'Arena', 'sport', 16, 16, 34, 1600, 24, 600, { cap: 18000, noise: [420, 0.3], league: 'NBA,WNBA,NHL', tour: 3 }),
  S('stadium', 'Football stadium', 'sport', 28, 24, 56, 3000, 36, 900, { cap: 68000, noise: [650, 0.4], league: 'NFL', tour: 4 }),
  S('soccer', 'Soccer stadium', 'sport', 20, 18, 36, 1200, 16, 350, { cap: 18000, noise: [420, 0.3], league: 'MLS', tour: 2 }),
  S('tennis', 'Tennis center', 'sport', 12, 10, 14, 500, 6, 120, { cap: 9000, noise: [200, 0.12], league: 'Tennis', tour: 2, amen: [250, 0.2] }),
  S('golf', 'Golf course', 'sport', 0, 0, 12, 1.2, 0.02, 0, { amen: [320, 0.5], league: 'Golf', tour: 2 }, { rect: true, green: true, per: true, min: 24 }),
  S('olympic', 'Olympic park', 'sport', 40, 30, 58, 6000, 60, 2500, { cap: 80000, noise: [700, 0.4], tour: 14, amen: [600, 0.4], league: 'NFL,MLS' }, { needs: 'olympics' }),
  S('f1pit', 'Race pit building', 'sport', 10, 3, 12, 300, 4, 80, { noise: [300, 0.3] }, { hidden: true }),
];
export const CAT = Object.fromEntries(CATALOG.map((c) => [c.k, c]));
export const CATS = [['park', 'Parks and decor'], ['service', 'Services'], ['landmark', 'Landmarks'], ['night', 'Nightlife'], ['sport', 'Sports']];
ext.emitSpecial = (m, F, b, r) => {
  const e = E[b.sp]; if (!e) return; const n0 = m.n; e(m, F, b, r);
  // landmarks, venues and stadiums are floodlit at night: every plain surface that is not foliage or already self-lit
  const c = CAT[b.sp]; if (c && (c.cat === 'landmark' || c.cat === 'night' || c.cat === 'sport')) for (let n = n0; n < m.n; n++) { const o = n * 4; if (m.win[o] <= 3 && !(m.win[o + 2] & 96) && m.win[o + 3] !== 255) m.win[o + 2] |= 64; }
};
ext.sign = (m, F, b) => { const y = b.baseY + b.height, c = b.sign; lbox(m, F, F.W * 0.22, 1.4, F.W * 0.78, 2.2, y, y + Math.min(5, 1.5 + b.height * 0.03), c, sh(c, 0.7), GLOW); };

// ---- styles by era and neighbourhood ---------------------------------------------------------------
const pal = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.map(hx)]));
function mural(m, F, b, r) { // painted side wall, Mission style
  if (b.zone !== 3 && b.zone !== 11 && b.zone !== 1) return; if (r() > 0.45) return;
  const cols = ['#b4563c', '#d0a23c', '#3f7f8c', '#5f8f4f', '#8a4f8c', '#d07a4a', '#2f5f8a'].map(hx), h = Math.min(b.height * 0.8, 9), n = 5, d0 = F.D * 0.2, dl = (F.D * 0.6) / n;
  for (let k = 0; k < n; k++) lbox(m, F, -0.06, d0 + k * dl, 0.02, d0 + (k + 1) * dl, F.baseY + 0.6 + ((k * 7) % 3) * 0.5, F.baseY + h - ((k * 5) % 3) * 0.7, r.pick(cols), null);
}
function eaves(m, F, b) { // flared green eaves, Chinatown style
  if (b.zone !== 3 && b.zone !== 11 && b.zone !== 10) return;
  const y = b.baseY + b.height; lbox(m, F, -0.3, -0.5, F.W + 0.3, 2.2, y - 0.2, y + 0.35, hx('#2f6b4a'), hx('#2f6b4a')); lbox(m, F, 0.4, 0.2, F.W - 0.4, 1.6, y + 0.35, y + 0.9, hx('#9c2f2a'), hx('#b8892c'));
}
ext.styles = [
  null,
  { name: 'Victorian', pal: pal({ house: ['#b9a6c0', '#9db5b0', '#c9b37a', '#b58a7a', '#8fa6bd', '#c7c1ae', '#a7b38f', '#bfa0a0', '#d0c8b4'] }) },
  { name: 'Stucco', pal: pal({ house: ['#e0d2b4', '#c4d3c0', '#e2c3a8', '#bccfd8', '#e6dcc6', '#d9b9b0', '#d8d3c8', '#e3d08f', '#c9c0d6', '#b8d0c4', '#ecdcc8', '#d6c4a4'], brick: ['#cfc4ae', '#c4b8a6', '#d8cdb8'] }) },
  { name: 'Chinatown', pal: pal({ awning: ['#9c2f2a', '#b8892c', '#2f6b4a', '#8a2a26'], brick: ['#8e4a3c', '#7d3f35', '#a0604a', '#94503e'], crown: ['#2f6b4a', '#9c2f2a', '#b8892c'] }), extra: eaves },
  { name: 'Mission', pal: pal({ house: ['#d2b48c', '#c8a878', '#b98f6f', '#d8c4a0', '#a8c0b0', '#c7a0a0', '#d0b070'], awning: ['#b4563c', '#d0a23c', '#3f7f8c', '#5f8f4f'] }), extra: mural },
  { name: 'North Beach', pal: pal({ house: ['#d9d0bc', '#cfc6b2', '#e0d8c8', '#c8bfa8'], awning: ['#7a2f2a', '#2f5a3f', '#d8d0bc', '#8a3a30'], stone: ['#cfc6b2', '#d6cebb', '#c4baa4'] }) },
  { name: 'Modernist', pal: pal({ tower: ['#9a9c98', '#b3b2ab', '#7f8587', '#a8a59a', '#8c8f8a', '#c0bdb2'], stone: ['#a8a79f', '#b6b4aa', '#96968f'], brick: ['#9f9d94', '#8f8f88', '#adaba0'], crown: ['#8c8f8a', '#a8a59a'] }), glass: 0.72 },
  { name: 'Glass', pal: pal({ tower: ['#6f8088', '#5d6b74', '#7b8a8f', '#566068', '#8c979a', '#4e5a60'], stone: ['#73838a', '#61707a', '#8a9598'], brick: ['#6a7880', '#7f8c90', '#59656c'], crown: ['#8fa0a6', '#5d6b74'], dark: ['#39444c', '#2f383e'] }), glass: 0.9 },
  { name: 'Megatower', pal: pal({ tower: ['#5a6a78', '#48545e', '#7d8c94', '#39444c', '#66788a'], stone: ['#5a6a78', '#6c7c88'], brick: ['#4f5c66', '#64727c'], crown: ['#9fb4c0', '#c8a04a'], dark: ['#2a3238'] }), glass: 0.93 },
];
const HOOD_STYLE = {
  'Castro/Upper Market': 1, 'Haight Ashbury': 1, 'Noe Valley': 1, 'Western Addition': 1, 'Pacific Heights': 1, 'Hayes Valley': 1, 'Presidio Heights': 1, 'Lone Mountain/USF': 1, 'Russian Hill': 1, 'Nob Hill': 1, 'Glen Park': 1, 'Bernal Heights': 1, 'Potrero Hill': 1, 'Japantown': 1,
  'Sunset/Parkside': 2, 'Outer Richmond': 2, 'Inner Sunset': 2, 'Inner Richmond': 2, 'Excelsior': 2, 'Outer Mission': 2, 'Oceanview/Merced/Ingleside': 2, 'West of Twin Peaks': 2, 'Lakeshore': 2, 'Visitacion Valley': 2, 'Portola': 2, 'Seacliff': 2, 'Marina': 2, 'Twin Peaks': 2, 'Bayview Hunters Point': 2,
  Chinatown: 3, Mission: 4, 'North Beach': 5,
};
// style for a new building: neighbourhood character for low-rise blocks, era for the big ones
export function styleFor(b, hoodName, year, rnd) {
  // Prewar stone and brick stay the default look in every era. Later eras mix in a share of newer buildings.
  const z = b.zone, hood = HOOD_STYLE[hoodName] || 0, tallZone = z === 2 || z === 4 || z === 6 || z === 9 || z === 11 || z === 5 || z === 10;
  if (!tallZone || year < 1950) return hood;
  const u = rnd(), office = z === 6 || z === 5, techZone = z === 9;
  const mega = year >= 2040 ? (techZone ? 0.45 : office ? 0.3 : 0.08) : 0;
  const glass = year >= 1990 ? (techZone ? 0.7 : office ? 0.3 : 0.1) : 0;
  const modern = year >= 1990 ? (techZone ? 0.2 : office ? 0.14 : 0.1) : techZone ? 0.8 : office ? 0.4 : 0.2;
  if (u < mega) return 8; if (u < mega + glass) return 7; if (u < mega + glass + modern) return 6;
  return z === 6 || z === 9 || z === 5 ? 0 : hood;
}

// ---- local businesses ------------------------------------------------------------------------------
const BIZ = {
  Mission: [['Taqueria', 'El Farolito', 'La Paloma', 'Tres Hermanos', 'Mission Burrito', 'Pancho'], ['Panaderia', 'Dolores Coffee Roasters', 'Valencia Books', 'Mural Print Shop']],
  Chinatown: [['Dim Sum', 'Golden Lotus', 'Jade Garden', 'Lucky Dragon', 'Grant Avenue', 'Great Eastern'], ['Tea House', 'Herbal Shop', 'Bakery', 'Noodle House']],
  'North Beach': [['Caffe', 'Trieste', 'Roma', 'Greco', 'Puccini', 'Colombo'], ['Trattoria', 'Focacceria', 'Espresso Bar', 'Pasticceria']],
  Japantown: [['Ramen', 'Sakura', 'Kintetsu', 'Fuji', 'Matsu'], ['Mochi Shop', 'Izakaya', 'Stationery', 'Boba Bar']],
  'Castro/Upper Market': [['Castro', 'Rainbow', 'Twin', 'Harvey'], ['Wine Bar', 'Cafe', 'Theatre Bar', 'Bookshop']],
  'Sunset/Parkside': [['Irving', 'Noriega', 'Taraval', 'Ocean'], ['Boba', 'Dumpling House', 'Surf Shop', 'Bakery']],
  'Outer Richmond': [['Clement', 'Balboa', 'Geary'], ['Dumplings', 'Pho', 'Bakery', 'Russian Deli']],
  'Inner Richmond': [['Clement', 'Geary', 'Arguello'], ['Dim Sum', 'Bookshop', 'Burmese Kitchen', 'Boba']],
  Marina: [['Chestnut', 'Union', 'Marina'], ['Wine Bar', 'Juice Bar', 'Brunch House', 'Yoga Studio']],
  'Haight Ashbury': [['Haight', 'Ashbury', 'Cole'], ['Records', 'Vintage', 'Coffee Roasters', 'Smoke Shop']],
  'South of Market': [['Folsom', 'Brannan', 'Howard'], ['Coffee Lab', 'Sourdough Bakery', 'Coworking Cafe', 'Poke']],
};
const GEN = [['Corner', 'Bay', 'Fog City', 'Golden', 'Sutro', 'Presidio', 'Twin Peaks', 'Pacific'], ['Sourdough Bakery', 'Coffee Roasters', 'Burrito Shop', 'Market', 'Wine Bar', 'Boba', 'Hardware', 'Books', 'Diner', 'Cafe']];
export function businessName(hoodName, nr) { const t = BIZ[hoodName] || GEN; return `${nr.pick(t[0])} ${nr.pick(t[1])}`; }
export const VENUE_NAMES = {
  club: ['1015 Folsom', 'The Midway', 'Public Works', 'The Great Northern', 'Audio', 'Temple', 'Halcyon', 'Monarch', 'DNA Lounge', 'The EndUp', 'F8', 'Underground SF', 'Madarae', 'Bergerac'],
  superclub: ['Club Space West', 'The Midway Yard', 'Pier 70 Hall', 'Sutro Warehouse', 'Cow Palace Annex'],
  music: ['The Fillmore', 'The Independent', 'Great American Music Hall', 'The Warfield', 'Bimbo\'s 365', 'The Chapel', 'Bottom of the Hill', 'August Hall', 'The Regency'],
  comedy: ['Cobb\'s Comedy Club', 'Punch Line', 'The Purple Onion', 'Cheaper Than Therapy', 'The Setup'],
  popup: ['Pier Pop-up', 'Dogpatch Warehouse', 'Bayview Hangar', 'Mint Yard', 'Fog Machine'],
};
void rng;
