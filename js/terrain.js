// San Francisco heightfield: real coastline (from neighbourhood outlines) + hand-placed hills.
import * as THREE from 'three';
import { LAND as LAND0, FAR_LAND as FAR0, PARK_GGP as GGP0, PARK_PRESIDIO as PRE0, LON0, LAT0, MX, MZ } from './data/geo.js';
import { clamp, lerp, smoothstep, fbm, noise2, pointInRing, hex2lin, hash2 } from './util.js';

// Map size is fixed for the life of the page: 'region' (San Francisco at 0.6 scale with Daly City, South City, Oakland, Berkeley and Marin around it),
// 'real' (the 7x7 mile city at true size) or 'compact' (half scale).
export const MAPMODE = ['region', 'real', 'compact'].includes(globalThis.__MAP7) ? globalThis.__MAP7 : 'region';
export const K = MAPMODE === 'compact' ? 0.5 : MAPMODE === 'region' ? 0.6 : 1;
const HS = K === 1 ? 1 : Math.sqrt(K) * 1.05; // hills keep some of their height when the map shrinks
export const MAP = MAPMODE === 'compact' ? { minX: -4560, maxX: 4080, minZ: -4560, maxZ: 3600, G: 24 }
  : MAPMODE === 'region' ? { minX: -5760, maxX: 11520, minZ: -7440, maxZ: 8400, G: 24 }
  : { minX: -9120, maxX: 8160, minZ: -9120, maxZ: 7200, G: 24 };
export const SFB = { minX: -9120 * K, maxX: 8160 * K, minZ: -9120 * K, maxZ: 7200 * K }; // the city itself, in every map mode
const scaleRings = (rs) => (K === 1 ? rs : rs.map((r) => r.map((v) => v * K)));
// the city and county outlines come from different sources and leave a hairline gap at the county line: cover it
const SEAM = [-5750, 6780, 3650, 6780, 3650, 6930, -5750, 6930];
// the far shores are traced coarsely; corner-cutting rounds off their stair steps
const chaikin = (r) => { const o = []; for (let i = 0, n = r.length; i < n; i += 2) { const ax = r[i], az = r[i + 1], bx = r[(i + 2) % n], bz = r[(i + 3) % n]; o.push(ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25, ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75); } return o; };
const LAND = scaleRings(LAND0), FAR_LAND = scaleRings([...FAR0.map((r) => chaikin(chaikin(r))), SEAM]), PARK_GGP = scaleRings(GGP0), PARK_PRESIDIO = scaleRings(PRE0);
export const NX = (MAP.maxX - MAP.minX) / MAP.G + 1;
export const NZ = (MAP.maxZ - MAP.minZ) / MAP.G + 1;
const R = 12; // raster resolution for the coastline distance field
const RW = (MAP.maxX - MAP.minX) / R, RH = (MAP.maxZ - MAP.minZ) / R;
const CG = 240, CN = 301, C0 = -36000; // coarse backdrop grid

// ---- surrounding areas (regional map): closed until the city grows, or all open ------------------
export const HAS_AREAS = MAPMODE === 'region';
export const AREAS = [
  { k: 'sf', name: 'San Francisco', at: 0, c: [-122.44, 37.76] }, { k: 'daly', name: 'Daly City', at: 5000, c: [-122.47, 37.69] },
  { k: 'ssf', name: 'South City', at: 12000, c: [-122.41, 37.665] }, { k: 'oak', name: 'Oakland', at: 25000, c: [-122.275, 37.80] },
  { k: 'berk', name: 'Berkeley', at: 45000, c: [-122.285, 37.865] }, { k: 'marin', name: 'Marin', at: 70000, c: [-122.49, 37.845] },
];
export const areas = { open: new Set(['sf']), all: false, sig: HAS_AREAS ? '100000' : '' };
// which area a point belongs to (index into AREAS); the limits are straight lines in real-world metres
export function areaAt(x, z) {
  if (!HAS_AREAS) return 0;
  const rx = x / K, rz = z / K;
  if (rx > 8400) return rz < -8400 ? 4 : 3;
  if (rz > 6900) return rz > 10800 || rx > 1800 ? 2 : 1;
  if (rz < -4800 && rx < 4500 && !(rx > 1000 && rz > -6700)) return 5;
  return 0;
}
export const areaOpen = (a) => !HAS_AREAS || a === 0 || areas.all || areas.open.has(AREAS[a].k);
export const lockedAt = (x, z) => { const a = areaAt(x, z); return areaOpen(a) ? null : AREAS[a]; };

export const ll = (lon, lat) => [(lon - LON0) * MX * K, -(lat - LAT0) * MZ * K];

// Broad swells [lon, lat, height, rx, rz]
const SWELLS = [
  [-122.4530, 37.7500, 92, 2500, 2500], [-122.4770, 37.7520, 48, 2300, 2600], [-122.4800, 37.7800, 34, 2300, 1300],
  [-122.4500, 37.7915, 44, 2000, 620], [-122.4250, 37.7230, 52, 2300, 1900], [-122.4640, 37.7150, 46, 2400, 1700],
  [-122.4160, 37.7965, 26, 1000, 900], [-122.4080, 37.7530, 20, 1500, 1200], [-122.5050, 37.8400, 150, 3200, 1500],
];
// Named hills [lon, lat, summit height (absolute), radius]
const HILLS = [
  [-122.4477, 37.7544, 276, 330], [-122.4477, 37.7516, 282, 330], [-122.4572, 37.7583, 277, 500], [-122.4546, 37.7383, 283, 560],
  [-122.4719, 37.7564, 203, 430], [-122.4660, 37.7505, 228, 420], [-122.4610, 37.7430, 215, 330], [-122.4413, 37.7683, 173, 330],
  [-122.4388, 37.7651, 150, 230], [-122.4455, 37.7634, 172, 240], [-122.4380, 37.7430, 205, 520], [-122.4148, 37.7432, 132, 470],
  [-122.3992, 37.7576, 98, 560], [-122.4161, 37.7930, 112, 520], [-122.4194, 37.8011, 92, 420], [-122.4058, 37.8024, 84, 270],
  [-122.4382, 37.7925, 112, 700], [-122.4660, 37.7905, 116, 760], [-122.4520, 37.7790, 132, 330], [-122.5000, 37.7850, 112, 620],
  [-122.5105, 37.7780, 62, 330], [-122.4460, 37.7810, 92, 420], [-122.4346, 37.7764, 80, 300], [-122.4270, 37.7570, 108, 330],
  [-122.4755, 37.7686, 124, 190], [-122.4640, 37.7170, 150, 520], [-122.4190, 37.7180, 157, 720], [-122.3930, 37.7130, 128, 400],
  [-122.3790, 37.7300, 78, 520], [-122.4040, 37.7290, 104, 430], [-122.4520, 37.7260, 112, 420], [-122.4130, 37.7230, 96, 380],
  [-122.4830, 37.7985, 80, 520], [-122.4590, 37.8000, 55, 500], [-122.4300, 37.7700, 62, 420], [-122.4995, 37.8262, 285, 950],
  [-122.4890, 37.8345, 290, 820], [-122.5290, 37.8330, 265, 980], [-122.4800, 37.8405, 185, 700], [-122.5120, 37.8300, 240, 800],
  [-122.3660, 37.8105, 102, 330], [-122.4230, 37.8267, 41, 150], [-122.4350, 37.6880, 330, 1900], [-122.4880, 37.7060, 60, 600], [-122.5200, 37.8650, 300, 2600], [-122.4950, 37.8600, 240, 1500],
];
const LAKES = [[-122.4945, 37.7285, 430, 230], [-122.4905, 37.7170, 190, 600], [-122.4852, 37.7218, 330, 140]];
const FORESTS = [ // [lon, lat, radius, density]
  [-122.4572, 37.7583, 620, 0.62], [-122.4546, 37.7383, 520, 0.45], [-122.4420, 37.7400, 380, 0.3], [-122.4190, 37.7180, 700, 0.34],
  [-122.5000, 37.7850, 680, 0.42], [-122.4800, 37.7355, 380, 0.4], [-122.4925, 37.7225, 900, 0.22], [-122.4413, 37.7683, 300, 0.5],
  [-122.3660, 37.8105, 330, 0.4], [-122.5105, 37.7780, 260, 0.35], [-122.4388, 37.7651, 200, 0.25], [-122.4950, 37.8330, 1800, 0.07],
  [-122.3930, 37.7130, 380, 0.25],
];

function rasterize(rings, w, h, x0, z0, res, mask) {
  const xs = [];
  for (const r of rings) {
    const n = r.length;
    let minz = Infinity, maxz = -Infinity;
    for (let i = 1; i < n; i += 2) { if (r[i] < minz) minz = r[i]; if (r[i] > maxz) maxz = r[i]; }
    const j0 = Math.max(0, Math.floor((minz - z0) / res - 0.5)), j1 = Math.min(h - 1, Math.ceil((maxz - z0) / res));
    for (let j = j0; j <= j1; j++) {
      const z = z0 + (j + 0.5) * res; xs.length = 0;
      for (let i = 0, k = n - 2; i < n; k = i, i += 2) {
        const za = r[k + 1], zb = r[i + 1];
        if ((za > z) !== (zb > z)) xs.push(r[k] + ((z - za) / (zb - za)) * (r[i] - r[k]));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.ceil((xs[k] - x0) / res - 0.5)), i1 = Math.min(w - 1, Math.floor((xs[k + 1] - x0) / res - 0.5));
        for (let i = i0; i <= i1; i++) mask[j * w + i] = 1;
      }
    }
  }
}

// Exact squared Euclidean distance transform (Felzenszwalb & Huttenlocher), in cells.
function edt(mask, w, h, target) {
  const INF = 1e12, n = Math.max(w, h);
  const f = new Float64Array(n), dd = new Float64Array(n), v = new Int32Array(n), zz = new Float64Array(n + 1);
  const out = new Float32Array(w * h);
  const pass = (len) => {
    let k = 0; v[0] = 0; zz[0] = -INF; zz[1] = INF;
    for (let q = 1; q < len; q++) {
      let s;
      for (;;) {
        const p = v[k];
        s = (f[q] + q * q - (f[p] + p * p)) / (2 * q - 2 * p);
        if (s <= zz[k] && k > 0) k--; else break;
      }
      k++; v[k] = q; zz[k] = s; zz[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) { while (zz[k + 1] < q) k++; const p = v[k]; dd[q] = (q - p) * (q - p) + f[p]; }
  };
  for (let i = 0; i < w; i++) {
    for (let j = 0; j < h; j++) f[j] = mask[j * w + i] === target ? 0 : INF;
    pass(h);
    for (let j = 0; j < h; j++) out[j * w + i] = dd[j];
  }
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) f[i] = out[j * w + i];
    pass(w);
    for (let i = 0; i < w; i++) out[j * w + i] = dd[i];
  }
  return out;
}
function signedDistance(mask, w, h, res) {
  const toWater = edt(mask, w, h, 0), toLand = edt(mask, w, h, 1);
  const sd = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) sd[i] = mask[i] ? Math.sqrt(toWater[i]) * res - res * 0.5 : -Math.sqrt(toLand[i]) * res + res * 0.5;
  return sd;
}

// ---- build the fields once at import --------------------------------------------------------
const fine = new Uint8Array(RW * RH);
rasterize(LAND, RW, RH, MAP.minX, MAP.minZ, R, fine);
rasterize(FAR_LAND, RW, RH, MAP.minX, MAP.minZ, R, fine);
for (const [lon, lat, rx0, rz0] of LAKES) {
  const [cx, cz] = ll(lon, lat), rx = rx0 * K, rz = rz0 * K;
  const i0 = Math.max(0, Math.floor((cx - rx - MAP.minX) / R)), i1 = Math.min(RW - 1, Math.ceil((cx + rx - MAP.minX) / R));
  const j0 = Math.max(0, Math.floor((cz - rz - MAP.minZ) / R)), j1 = Math.min(RH - 1, Math.ceil((cz + rz - MAP.minZ) / R));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const dx = (MAP.minX + (i + 0.5) * R - cx) / rx, dz = (MAP.minZ + (j + 0.5) * R - cz) / rz;
    if (dx * dx + dz * dz < 1) fine[j * RW + i] = 0;
  }
}
const SD = signedDistance(fine, RW, RH, R);
const coarse = new Uint8Array(CN * CN);
rasterize(LAND, CN, CN, C0 - CG / 2, C0 - CG / 2, CG, coarse);
rasterize(FAR_LAND, CN, CN, C0 - CG / 2, C0 - CG / 2, CG, coarse);
const SDC = signedDistance(coarse, CN, CN, CG);

function bil(arr, w, h, fx, fz) {
  fx = clamp(fx, 0, w - 1.001); fz = clamp(fz, 0, h - 1.001);
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, o = j * w + i;
  return (arr[o] * (1 - tx) + arr[o + 1] * tx) * (1 - tz) + (arr[o + w] * (1 - tx) + arr[o + w + 1] * tx) * tz;
}
const inMap = (x, z) => x >= MAP.minX && x <= MAP.maxX && z >= MAP.minZ && z <= MAP.maxZ;
// Signed distance to the nearest shore in metres (positive on land).
export function coastDist(x, z) {
  if (inMap(x, z)) return bil(SD, RW, RH, (x - MAP.minX) / R - 0.5, (z - MAP.minZ) / R - 0.5);
  return bil(SDC, CN, CN, (x - C0) / CG, (z - C0) / CG);
}

const swells = SWELLS.map(([lon, lat, h, rx, rz]) => [...ll(lon, lat), h * HS, rx * K, rz * K]);
const hills = HILLS.map(([lon, lat, h, r]) => [...ll(lon, lat), h * HS, r * K]);
function analyticHeight(x, z, d) {
  if (d <= 0) return -0.6 - 26 * (1 - Math.exp(d / 260));
  let g = 5;
  for (const s of swells) {
    const dx = (x - s[0]) / s[3], dz = (z - s[1]) / s[4], q = dx * dx + dz * dz;
    if (q < 9) g += s[2] * Math.exp(-q);
  }
  let e = 0; // smooth max of each hill's rise above the swell surface
  for (const hl of hills) {
    const dx = x - hl[0], dz = z - hl[1], r = hl[3];
    if (dx > 3 * r || dx < -3 * r || dz > 3 * r || dz < -3 * r) continue;
    const c = (hl[2] - g) * Math.exp(-(dx * dx + dz * dz) / (r * r));
    if (c > 0) e += c * c * c;
  }
  let h = g + Math.cbrt(e);
  h += (fbm(x / 210, z / 210, 3) - 0.47) * (3 + 0.05 * h);
  const out = Math.max(SFB.minX - x, x - SFB.maxX, SFB.minZ - z, z - SFB.maxZ, 0);
  if (out > 0) { // generic ranges beyond the city (Marin, East Bay, Peninsula)
    const n = fbm(x / 5200 + 7.3, z / 5200 - 2.1, 4);
    h += smoothstep(0, 7000 * K, out) * smoothstep(200, 2500, d) * n * n * (MAPMODE === 'region' && inMap(x, z) ? 300 * (x > SFB.maxX + 900 ? smoothstep(900, 2600, d) : 1) : 760);
  }
  return 1 + (h - 1) * smoothstep(0, 150, d);
}

export const H = new Float32Array(NX * NZ);
for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
  const x = MAP.minX + i * MAP.G, z = MAP.minZ + j * MAP.G;
  H[j * NX + i] = analyticHeight(x, z, coastDist(x, z));
}
// ---- terraforming -----------------------------------------------------------------------------
export const terra = { edits: new Map(), refresh: null }; // vertex index -> edited height
function fixRegion(i0, j0, i1, j1) {
  // re-derive the shore distance around the edit from the heightfield as it now stands
  const M = 30, a0 = Math.max(0, Math.floor((i0 * MAP.G) / R) - M), a1 = Math.min(RW - 1, Math.ceil((i1 * MAP.G) / R) + M);
  const b0 = Math.max(0, Math.floor((j0 * MAP.G) / R) - M), b1 = Math.min(RH - 1, Math.ceil((j1 * MAP.G) / R) + M), w = a1 - a0 + 1, h = b1 - b0 + 1;
  const mask = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) mask[j * w + i] = heightAt(MAP.minX + (a0 + i + 0.5) * R, MAP.minZ + (b0 + j + 0.5) * R) > 0.3 ? 1 : 0;
  const loc = signedDistance(mask, w, h, R);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const v = loc[j * w + i], o = (b0 + j) * RW + a0 + i, old = SD[o], m = Math.min(i, j, w - 1 - i, h - 1 - j) * R, same = (old > 0) === (v > 0);
    SD[o] = Math.abs(v) <= m ? v : Math.sign(v) * (same ? Math.max(Math.abs(old), m) : Math.max(m, R));
  }
  if (terra.refresh) terra.refresh(i0, j0, i1, j1);
}
// mode: raise | lower | flatten | fill (make land) | dig (make water). guard(i, j) may veto a vertex.
export function sculpt(x, z, radius, mode, amt, guard) {
  const G = MAP.G, i0 = Math.max(1, Math.ceil((x - radius - MAP.minX) / G)), i1 = Math.min(NX - 2, Math.floor((x + radius - MAP.minX) / G));
  const j0 = Math.max(1, Math.ceil((z - radius - MAP.minZ) / G)), j1 = Math.min(NZ - 2, Math.floor((z + radius - MAP.minZ) / G));
  const target = mode === 'flatten' ? Math.max(heightAt(x, z), 1.6) : 0; let changed = false;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const d = Math.hypot(MAP.minX + i * G - x, MAP.minZ + j * G - z) / radius; if (d > 1) continue;
    const w = (1 - d * d) * (1 - d * d), o = j * NX + i, h = H[o]; let nh = h;
    if (mode === 'raise') nh = Math.min(h + amt * w, 420); else if (mode === 'lower') nh = Math.max(h - amt * w, 1.2);
    else if (mode === 'flatten') nh = h + (target - h) * Math.min(1, w * amt * 0.35);
    else if (mode === 'fill') nh = h < 2.6 ? h + (2.6 - h) * Math.min(1, w * 2.2) : h;
    else if (mode === 'dig') nh = h + (-4 - h) * Math.min(1, w * 1.6);
    if (Math.abs(nh - h) < 0.01 || (guard && !guard(i, j))) continue;
    rememberOriginal(o); H[o] = nh; terra.edits.set(o, nh); changed = true;
  }
  if (!changed) return null;
  fixRegion(i0 - 1, j0 - 1, i1 + 1, j1 + 1);
  return [i0 - 1, j0 - 1, i1 + 1, j1 + 1];
}
const H0 = new Map(); // original heights of edited vertices, so a new city can restore the natural terrain
export function rememberOriginal(o) { if (!H0.has(o)) H0.set(o, H[o]); }
export function setEdits(list) { // list: [index, height, ...]; replaces all current edits
  let i0 = 1e9, j0 = 1e9, i1 = -1, j1 = -1;
  const touch = (o) => { const i = o % NX, j = (o - i) / NX; if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j; };
  for (const [o, h] of H0) { if (H[o] !== h) { H[o] = h; touch(o); } }
  terra.edits.clear();
  for (let k = 0; k + 1 < (list ? list.length : 0); k += 2) { const o = list[k]; if (o < 0 || o >= H.length) continue; rememberOriginal(o); H[o] = list[k + 1]; terra.edits.set(o, list[k + 1]); touch(o); }
  if (i1 >= 0) fixRegion(Math.max(0, i0 - 1), Math.max(0, j0 - 1), Math.min(NX - 1, i1 + 1), Math.min(NZ - 1, j1 + 1));
  return i1 >= 0 ? [i0, j0, i1, j1] : null;
}
// Height on the rendered triangle surface.
export function heightAt(x, z) {
  const fx = clamp((x - MAP.minX) / MAP.G, 0, NX - 1.0001), fz = clamp((z - MAP.minZ) / MAP.G, 0, NZ - 1.0001);
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, o = j * NX + i;
  const h00 = H[o], h10 = H[o + 1], h01 = H[o + NX], h11 = H[o + NX + 1];
  return tx + tz <= 1 ? h00 + (h10 - h00) * tx + (h01 - h00) * tz : h11 + (h01 - h11) * (1 - tx) + (h10 - h11) * (1 - tz);
}
export function slopeAt(x, z) {
  const e = 12;
  const dx = heightAt(x + e, z) - heightAt(x - e, z), dz = heightAt(x, z + e) - heightAt(x, z - e);
  return Math.hypot(dx, dz) / (2 * e);
}
const bbox = (rings) => { const b = [1e9, 1e9, -1e9, -1e9]; for (const r of rings) for (let i = 0; i < r.length; i += 2) { b[0] = Math.min(b[0], r[i]); b[1] = Math.min(b[1], r[i + 1]); b[2] = Math.max(b[2], r[i]); b[3] = Math.max(b[3], r[i + 1]); } return b; };
const BB_GGP = bbox(PARK_GGP), BB_PRE = bbox(PARK_PRESIDIO);
const inBB = (b, x, z) => x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3];
export const inGGP = (x, z) => inBB(BB_GGP, x, z) && PARK_GGP.some((r) => pointInRing(x, z, r));
export const inPresidio = (x, z) => inBB(BB_PRE, x, z) && PARK_PRESIDIO.some((r) => pointInRing(x, z, r));

// Ray vs terrain (and the sea surface). Returns {x,y,z,water} or null.
export function raycastGround(ox, oy, oz, dx, dy, dz, maxT = 60000) {
  let t = 0, prev = 0;
  for (let n = 0; n < 4000 && t < maxT; n++) {
    const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t;
    const g = Math.max(heightAt(x, z), 0);
    if (y <= g) {
      let a = prev, b = t;
      for (let k = 0; k < 14; k++) {
        const m = (a + b) / 2;
        if (oy + dy * m <= Math.max(heightAt(ox + dx * m, oz + dz * m), 0)) b = m; else a = m;
      }
      const hx = ox + dx * b, hz = oz + dz * b, hh = heightAt(hx, hz);
      if (!inMap(hx, hz)) return null;
      return { x: hx, y: Math.max(hh, 0), z: hz, water: hh < 0.05 };
    }
    prev = t;
    t += clamp((y - g) * 0.5, 1.5, 400);
  }
  return null;
}

// ---- rendering ------------------------------------------------------------------------------
const C = {
  grassA: hex2lin('#74905a'), grassB: hex2lin('#8fa062'), dry: hex2lin('#a9a570'), park: hex2lin('#55784a'), forest: hex2lin('#4a6141'),
  rock: hex2lin('#8f8773'), sand: hex2lin('#d4c6a0'), dune: hex2lin('#b9b083'), shallow: hex2lin('#6f9a96'), deep: hex2lin('#2b4a5c'),
  far: hex2lin('#7c8d66'), fill: hex2lin('#9c9684'),
};
const mix3 = (a, b, t, o) => { o[0] = lerp(a[0], b[0], t); o[1] = lerp(a[1], b[1], t); o[2] = lerp(a[2], b[2], t); return o; };

function groundColor(x, z, h, d, slope, out) {
  if (d <= 0) return mix3(C.shallow, C.deep, smoothstep(0, 9, -h - 0.6), out);
  const rx = x * 0.829 - z * 0.559, rz = x * 0.559 + z * 0.829;   // rotated so the noise lattice does not line up with the street grid
  const n = fbm(rx / 420, rz / 420, 3), n2 = fbm(rx / 170 + 11, rz / 170 - 4, 2);
  mix3(C.grassA, C.grassB, smoothstep(0.25, 0.75, n), out);
  mix3(out, C.dry, smoothstep(0.4, 0.85, n2) * 0.4, out);
  const west = smoothstep(-1500, -5200, x) * smoothstep(0.35, 0.6, fbm(x / 520 + 3, z / 520, 3)); // Outside Lands dunes
  mix3(out, C.dune, west * 0.7, out);
  if (inGGP(x, z) || inPresidio(x, z)) mix3(out, C.park, 0.8, out);
  mix3(out, C.rock, smoothstep(0.32, 0.62, slope) * 0.8, out);
  mix3(out, C.sand, (1 - smoothstep(6, 46, d)) * (1 - smoothstep(2.5, 7, h)), out);
  return out;
}

export function buildTerrain(scene, zoneTex, GX, GZ) {
  const uniforms = {
    uZoneTex: { value: zoneTex }, uMapMin: { value: new THREE.Vector2(MAP.minX, MAP.minZ) },
    uMapSize: { value: new THREE.Vector2(MAP.maxX - MAP.minX, MAP.maxZ - MAP.minZ) }, uCells: { value: new THREE.Vector2(GX, GZ) },
    uZoneCols: { value: [] }, uShowEmpty: { value: 0.5 }, uShowDev: { value: 0 }, uGrid: { value: 0 },
    uBrush: { value: new THREE.Vector4(0, 0, 0, 0) }, uRect: { value: new THREE.Vector4(0, 0, 0, 0) }, uRectOn: { value: 0 },
    uPrevCol: { value: new THREE.Color(1, 1, 1) }, uLock: { value: AREAS.map((a, i) => (areaOpen(i) ? 0 : 1)) }, uK: { value: K }, uHeatTex: { value: null }, uHeat: { value: 0 }, uHeatScale: { value: new THREE.Vector2(1, 1) },
  };
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vWp;
      uniform sampler2D uZoneTex; uniform vec2 uMapMin, uMapSize, uCells; uniform vec3 uZoneCols[13]; uniform sampler2D uHeatTex; uniform float uHeat; uniform vec2 uHeatScale;
      uniform float uShowEmpty, uShowDev, uGrid, uRectOn; uniform vec4 uBrush, uRect; uniform vec3 uPrevCol; uniform float uLock[6]; uniform float uK;
      float th(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float tn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(th(i), th(i+vec2(1,0)), f.x), mix(th(i+vec2(0,1)), th(i+vec2(1,1)), f.x), f.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        float dn = tn(vWp.xz * 0.045) * 0.6 + tn(vWp.xz * 0.37) * 0.4;
        diffuseColor.rgb *= 0.86 + 0.28 * dn;
        vec2 cc = (vWp.xz - uMapMin) / uMapSize;
        if (cc.x > 0.0 && cc.x < 1.0 && cc.y > 0.0 && cc.y < 1.0 && vWp.y > 0.2) {
          vec2 rr = vWp.xz / uK; // areas that are not open yet read as a grey survey map
          int ar = rr.x > 8400.0 ? (rr.y < -8400.0 ? 4 : 3) : rr.y > 6900.0 ? ((rr.y > 10800.0 || rr.x > 1800.0) ? 2 : 1) : (rr.y < -4800.0 && rr.x < 4500.0 && !(rr.x > 1000.0 && rr.y > -6700.0)) ? 5 : 0;
          float lk = uLock[ar];
          if (lk > 0.0) { float gl = dot(diffuseColor.rgb, vec3(0.3, 0.5, 0.2)), hat = smoothstep(0.38, 0.5, abs(fract((vWp.x + vWp.z) / 96.0) - 0.5)); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(gl * 0.95, gl * 0.97, gl) * (0.8 - 0.09 * hat), 0.8 * lk); }
          float v = floor(texture2D(uZoneTex, cc).r * 255.0 + 0.5);
          float zone = mod(v, 16.0); float flags = floor(v / 16.0);
          float paved = mod(flags, 2.0), dev = mod(floor(flags / 2.0), 2.0);
          vec2 cell = cc * uCells; vec2 fw = fwidth(cell);
          if (paved > 0.5) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.30, 0.295, 0.285) * (0.9 + 0.2 * dn), 0.94);
          else if (dev > 0.5) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.27, 0.31, 0.2), 0.45);
          if (zone > 0.5) {
            vec3 zc = uZoneCols[int(zone)];
            diffuseColor.rgb = mix(diffuseColor.rgb, zc, dev > 0.5 ? uShowDev : uShowEmpty);
          }
          if (uHeat > 0.0) { vec4 hc = texture2D(uHeatTex, cc * uHeatScale); diffuseColor.rgb = mix(diffuseColor.rgb, pow(hc.rgb, vec3(2.2)), hc.a * uHeat); }
          if (uGrid > 0.0) {
            vec2 g = abs(fract(cell) - 0.5);
            float line = max(smoothstep(0.5 - fw.x * 1.2, 0.5, g.x), smoothstep(0.5 - fw.y * 1.2, 0.5, g.y));
            float lod = 1.0 - smoothstep(0.08, 0.35, max(fw.x, fw.y));
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.04), line * uGrid * lod * (zone > 0.5 ? 0.42 : 0.2));
          }
          if (uBrush.w > 0.0) {
            float bd = length(vWp.xz - uBrush.xy);
            float ring = 1.0 - smoothstep(0.0, 1.5 + fwidth(bd) * 1.5, abs(bd - uBrush.z));
            diffuseColor.rgb = mix(diffuseColor.rgb, uPrevCol, max(ring * 0.9, step(bd, uBrush.z) * 0.25));
          }
          if (uRectOn > 0.0 && vWp.x > uRect.x && vWp.x < uRect.z && vWp.z > uRect.y && vWp.z < uRect.w) {
            vec2 e = min(vWp.xz - uRect.xy, uRect.zw - vWp.xz);
            float edge = 1.0 - smoothstep(0.0, 1.0 + fwidth(vWp.x) * 2.0, min(e.x, e.y));
            diffuseColor.rgb = mix(diffuseColor.rgb, uPrevCol, max(0.3, edge * 0.9));
          }
        }
      }`);
  };

  // main map, in tiles so the frustum can cull
  const group = new THREE.Group();
  const TX = 120, TZ = 136, col = [0, 0, 0], tiles = [];
  const nrm = (i, j, o) => {
    const i0 = Math.max(i - 1, 0), i1 = Math.min(i + 1, NX - 1), j0 = Math.max(j - 1, 0), j1 = Math.min(j + 1, NZ - 1);
    const dx = (H[j * NX + i1] - H[j * NX + i0]) / ((i1 - i0) * MAP.G), dz = (H[j1 * NX + i] - H[j0 * NX + i]) / ((j1 - j0) * MAP.G);
    const l = 1 / Math.hypot(dx, 1, dz); o[0] = -dx * l; o[1] = l; o[2] = -dz * l; return Math.hypot(dx, dz);
  };
  const nv = [0, 0, 0];
  for (let tz = 0; tz < NZ - 1; tz += TZ) for (let tx = 0; tx < NX - 1; tx += TX) {
    const w = Math.min(TX, NX - 1 - tx) + 1, h = Math.min(TZ, NZ - 1 - tz) + 1;
    const pos = new Float32Array(w * h * 3), nor = new Float32Array(w * h * 3), cols = new Float32Array(w * h * 3);
    let top = -1e9;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const gi = tx + i, gj = tz + j, x = MAP.minX + gi * MAP.G, z = MAP.minZ + gj * MAP.G, y = H[gj * NX + gi], o = (j * w + i) * 3;
      pos[o] = x; pos[o + 1] = y; pos[o + 2] = z; if (y > top) top = y;
      const sl = nrm(gi, gj, nv); nor[o] = nv[0]; nor[o + 1] = nv[1]; nor[o + 2] = nv[2];
      groundColor(x, z, y, coastDist(x, z), sl, col); cols[o] = col[0]; cols[o + 1] = col[1]; cols[o + 2] = col[2];
    }
    const lods = [1, 2, 4].map((st) => {
      const idx = new Uint32Array(Math.ceil((w - 1) / st) * Math.ceil((h - 1) / st) * 6); let k = 0;
      for (let j = 0; j < h - 1; j += st) for (let i = 0; i < w - 1; i += st) {
        const si = Math.min(st, w - 1 - i), sj = Math.min(st, h - 1 - j), a = j * w + i, b = a + si, c = a + w * sj, d = c + si;
        idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d;
      }
      return new THREE.BufferAttribute(idx, 1);
    });
    const idx = lods[0].array;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    void idx; geo.setIndex(lods[0]);
    geo.computeBoundingSphere(); geo.computeBoundingBox();
    const m = new THREE.Mesh(geo, mat); m.receiveShadow = true; m.matrixAutoUpdate = false;
    m.userData = { lods, lod: 0, top, tx, tz, w, h };
    tiles.push(m); group.add(m);
  }

  // after terraforming: rewrite heights, normals and colours of the touched vertices
  terra.refresh = (i0, j0, i1, j1) => {
    for (const m of tiles) {
      const u = m.userData, a0 = Math.max(i0, u.tx), a1 = Math.min(i1, u.tx + u.w - 1), b0 = Math.max(j0, u.tz), b1 = Math.min(j1, u.tz + u.h - 1);
      if (a0 > a1 || b0 > b1) continue;
      const P = m.geometry.attributes.position, N = m.geometry.attributes.normal, Cc = m.geometry.attributes.color;
      for (let gj = b0; gj <= b1; gj++) for (let gi = a0; gi <= a1; gi++) {
        const o = ((gj - u.tz) * u.w + (gi - u.tx)) * 3, x = MAP.minX + gi * MAP.G, z = MAP.minZ + gj * MAP.G, y = H[gj * NX + gi];
        P.array[o + 1] = y; const sl = nrm(gi, gj, nv); N.array[o] = nv[0]; N.array[o + 1] = nv[1]; N.array[o + 2] = nv[2];
        groundColor(x, z, y, coastDist(x, z), sl, col); if (terra.edits.has(gj * NX + gi) && y > 0.5) mix3(col, C.fill, 0.55, col);
        Cc.array[o] = col[0]; Cc.array[o + 1] = col[1]; Cc.array[o + 2] = col[2];
      }
      P.needsUpdate = N.needsUpdate = Cc.needsUpdate = true;
    }
  };
  // distant land, same height function sampled coarsely; cells inside the map are skipped
  {
    const pos = new Float32Array(CN * CN * 3), cols = new Float32Array(CN * CN * 3);
    const hs = new Float32Array(CN * CN);
    // Near the shore the coarse distance field is too blocky, so measure against the outline itself and
    // make height proportional to it: the sea plane then cuts the mesh along the real coastline.
    const rings = [...LAND, ...FAR_LAND].map((r) => {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let k = 0; k < r.length; k += 2) { if (r[k] < x0) x0 = r[k]; if (r[k] > x1) x1 = r[k]; if (r[k + 1] < z0) z0 = r[k + 1]; if (r[k + 1] > z1) z1 = r[k + 1]; }
      return { r, x0, x1, z0, z1 };
    });
    const exactDist = (x, z) => {
      let best = 1e12, inside = false;
      for (const g of rings) {
        const bx = Math.max(g.x0 - x, 0, x - g.x1), bz = Math.max(g.z0 - z, 0, z - g.z1);
        if (bx * bx + bz * bz > best) continue;
        const r = g.r;
        if (!inside && bx === 0 && bz === 0 && pointInRing(x, z, r)) inside = true;
        for (let i = 0, k = r.length - 2; i < r.length; k = i, i += 2) {
          const ax = r[k], az = r[k + 1], ex = r[i] - ax, ez = r[i + 1] - az, l2 = ex * ex + ez * ez;
          const t = l2 > 0 ? clamp(((x - ax) * ex + (z - az) * ez) / l2, 0, 1) : 0, qx = ax + ex * t - x, qz = az + ez * t - z, q = qx * qx + qz * qz;
          if (q < best) best = q;
        }
      }
      return (inside ? 1 : -1) * Math.sqrt(best);
    };
    for (let j = 0; j < CN; j++) for (let i = 0; i < CN; i++) {
      const x = C0 + i * CG, z = C0 + j * CG, o = (j * CN + i) * 3;
      const onEdge = inMap(x, z);
      let d = coastDist(x, z), y;
      if (onEdge) y = heightAt(x, z);
      else {
        if (Math.abs(d) < CG * 2.5) d = exactDist(x, z);
        y = d <= 0 ? Math.max(d * 0.1, -26) : lerp(d * 0.1, analyticHeight(x, z, d), smoothstep(90, 520, d)) + 0.4;
      }
      hs[j * CN + i] = y; pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;
      if (d <= 0) mix3(C.shallow, C.deep, smoothstep(0, 9, -y - 0.6), col);
      else { mix3(C.far, C.grassB, noise2(x / 2100, z / 2100), col); mix3(col, C.forest, smoothstep(120, 520, y) * 0.55, col); if (onEdge) groundColor(x, z, y, d, 0, col); }
      cols[o] = col[0]; cols[o + 1] = col[1]; cols[o + 2] = col[2];
    }
    const i0 = (MAP.minX - C0) / CG, i1 = (MAP.maxX - C0) / CG, j0 = (MAP.minZ - C0) / CG, j1 = (MAP.maxZ - C0) / CG;
    const idx = [];
    for (let j = 0; j < CN - 1; j++) for (let i = 0; i < CN - 1; i++) {
      if (i >= i0 && i < i1 && j >= j0 && j < j1) continue;
      const a = j * CN + i, b = a + 1, c = a + CN, d = c + 1;
      if (hs[a] < 0 && hs[b] < 0 && hs[c] < 0 && hs[d] < 0) continue; // open water: the sea plane covers it
      idx.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    const far = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    far.matrixAutoUpdate = false; far.position.y = -0.4; far.updateMatrix();
    group.add(far);
  }
  // dark floor far below the sea so open water reads the same everywhere
  const abyss = new THREE.Mesh(new THREE.PlaneGeometry(150000, 150000), new THREE.MeshStandardMaterial({ color: new THREE.Color(...C.deep), roughness: 1 }));
  abyss.rotation.x = -Math.PI / 2; abyss.position.y = -34; group.add(abyss);
  scene.add(group);
  // Pick a level of detail per tile from its distance to the camera.
  function updateLOD(cam) {
    for (const m of tiles) {
      const bs = m.geometry.boundingSphere, d = Math.max(0, cam.distanceTo(bs.center) - bs.radius);
      const l = d > 14000 ? 2 : d > 6000 ? 1 : 0;
      if (l !== m.userData.lod) { m.userData.lod = l; m.geometry.setIndex(m.userData.lods[l]); }
    }
  }
  return { uniforms, group, material: mat, updateLOD };
}

// ---- wild trees (parks + wooded hills) ------------------------------------------------------
export function buildForests(scene) {
  const forests = FORESTS.map(([lon, lat, r, dens]) => [...ll(lon, lat), r * K, dens]);
  const S = 27, BUCKET = 1728;
  const buckets = new Map();
  const palette = ['#4c6a3c', '#59764a', '#42603a', '#66804f', '#6c8458', '#8d8a3e', '#9a7a36', '#7f6a34'].map(hex2lin);
  for (let z = MAP.minZ + S; z < MAP.maxZ; z += S) for (let x = MAP.minX + S; x < MAP.maxX; x += S) {
    const ci = Math.round(x / S), cj = Math.round(z / S);
    const px = x + (hash2(ci, cj) - 0.5) * S * 0.9, pz = z + (hash2(cj + 91, ci - 17) - 0.5) * S * 0.9;
    let dens = 0;
    for (const f of forests) {
      const q = Math.hypot(px - f[0], pz - f[1]) / f[2];
      if (q < 1) dens = Math.max(dens, f[3] * (1 - q * q * 0.6));
    }
    if (inGGP(px, pz)) dens = Math.max(dens, 0.2 + 0.5 * smoothstep(0.35, 0.65, fbm(px / 260, pz / 260, 2)));
    else if (inPresidio(px, pz)) dens = Math.max(dens, 0.12 + 0.6 * smoothstep(0.4, 0.62, fbm(px / 330 + 9, pz / 330, 2)));
    if (hash2(ci * 3 + 5, cj * 7 - 2) > dens) continue;
    const h = heightAt(px, pz);
    if (h < 2.2 || coastDist(px, pz) < 26) continue;
    const key = Math.floor((px - MAP.minX) / BUCKET) + Math.floor((pz - MAP.minZ) / BUCKET) * 64;
    let b = buckets.get(key); if (!b) buckets.set(key, (b = []));
    const r1 = hash2(ci + 400, cj + 9);
    b.push(px, h, pz, 4.5 + r1 * 4.5, 7 + hash2(ci - 3, cj + 77) * 7, Math.floor(hash2(ci + 31, cj - 55) * (r1 > 0.8 ? 8 : 5)));
  }
  // lumpy crown: a subdivided ball with its corners pushed in and out, so the wood does not look like dice
  const geo = new THREE.IcosahedronGeometry(1, 1), gp = geo.attributes.position;
  for (let i = 0; i < gp.count; i++) { const x = gp.getX(i), y = gp.getY(i), z = gp.getZ(i), k = 0.82 + 0.36 * hash2(Math.round(x * 50), Math.round(y * 50 + z * 131)); gp.setXYZ(i, x * k, y * k * (y < 0 ? 0.8 : 1), z * k); }
  geo.computeVertexNormals();
  geo.translate(0, 0.72, 0);
  const mat = new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true });
  const meshes = [], m4 = new THREE.Matrix4(), c = new THREE.Color(), index = new Map();
  const CELL = 64;
  for (const [, b] of buckets) {
    const n = b.length / 6, im = new THREE.InstancedMesh(geo, mat, n);
    for (let i = 0; i < n; i++) {
      const o = i * 6, p = palette[b[o + 5]];
      m4.makeScale(b[o + 3], b[o + 4], b[o + 3]); m4.setPosition(b[o], b[o + 1] - 0.5, b[o + 2]);
      im.setMatrixAt(i, m4);
      const t = 0.82 + hash2(i, n) * 0.36; c.setRGB(p[0] * t, p[1] * t, p[2] * t); im.setColorAt(i, c);
      const k = Math.floor((b[o] - MAP.minX) / CELL) + Math.floor((b[o + 2] - MAP.minZ) / CELL) * 512;
      let l = index.get(k); if (!l) index.set(k, (l = []));
      l.push(meshes.length, i, b[o], b[o + 2]);
    }
    im.castShadow = true; im.receiveShadow = true; im.computeBoundingSphere(); im.matrixAutoUpdate = false;
    im.userData.orig = im.instanceMatrix.array.slice();
    scene.add(im); meshes.push(im);
  }
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  // Remove trees inside a world-space rectangle (roads and buildings clear the land).
  function clearRect(x0, z0, x1, z1) {
    const dirty = new Set();
    for (let cz = Math.floor((z0 - MAP.minZ) / CELL); cz <= Math.floor((z1 - MAP.minZ) / CELL); cz++)
      for (let cx = Math.floor((x0 - MAP.minX) / CELL); cx <= Math.floor((x1 - MAP.minX) / CELL); cx++) {
        const l = index.get(cx + cz * 512); if (!l) continue;
        for (let i = 0; i < l.length; i += 4) {
          if (l[i + 1] < 0 || l[i + 2] < x0 || l[i + 2] > x1 || l[i + 3] < z0 || l[i + 3] > z1) continue;
          meshes[l[i]].setMatrixAt(l[i + 1], zero); dirty.add(l[i]); l[i + 1] = -l[i + 1] - 1;
        }
      }
    for (const m of dirty) meshes[m].instanceMatrix.needsUpdate = true;
  }
  function reset() {
    for (const m of meshes) { m.instanceMatrix.array.set(m.userData.orig); m.instanceMatrix.needsUpdate = true; }
    for (const l of index.values()) for (let i = 0; i < l.length; i += 4) if (l[i + 1] < 0) l[i + 1] = -l[i + 1] - 1;
  }
  return { clearRect, reset, count: [...buckets.values()].reduce((s, b) => s + b.length / 6, 0) };
}
