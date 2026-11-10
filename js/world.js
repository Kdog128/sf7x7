// Grid state for the city: zoning, road occupancy, building registry and the overlay texture.
import * as THREE from 'three';
import { MAP, heightAt, coastDist } from './terrain.js';

export const CELL = 8;
export const GX = (MAP.maxX - MAP.minX) / CELL, GZ = (MAP.maxZ - MAP.minZ) / CELL;
export const CH = 32; // cells per render chunk (256 m)
export const CXN = Math.ceil(GX / CH), CZN = Math.ceil(GZ / CH);

// Zone ids: odd = light density, even = dark density
export const ZONES = [
  null,
  { key: 'RL', group: 'R', name: 'Residential', density: 'Light', color: '#8fc27a' },
  { key: 'RD', group: 'R', name: 'Residential', density: 'Dark', color: '#3f8a45' },
  { key: 'CL', group: 'C', name: 'Commercial', density: 'Light', color: '#7fb0e0' },
  { key: 'CD', group: 'C', name: 'Commercial', density: 'Dark', color: '#2f6cb8' },
  { key: 'OL', group: 'O', name: 'Office', density: 'Light', color: '#7fd0cf' },
  { key: 'OD', group: 'O', name: 'Office', density: 'Dark', color: '#1f8f96' },
  { key: 'IL', group: 'I', name: 'Industrial', density: 'Light', color: '#e2c56a' },
  { key: 'ID', group: 'I', name: 'Industrial', density: 'Dark', color: '#b98a22' },
];
export const TIERS = [
  ['Rural', 0], ['Hamlet', 1000], ['Village', 2500], ['Town', 5000], ['Big Town', 10000],
  ['Small City', 20000], ['City', 40000], ['Big City', 70000], ['Metropolis', 100000],
];

export const zone = new Uint8Array(GX * GZ);
export const road = new Uint8Array(GX * GZ);   // bit0 any road, bit1 road that gives lot access
export const bid = new Int32Array(GX * GZ);    // building id per cell (0 = none)
export const land = new Uint8Array(GX * GZ);   // 1 = buildable land
const overlay = new Uint8Array(GX * GZ);

export const cellX = (i) => MAP.minX + i * CELL;
export const cellZ = (j) => MAP.minZ + j * CELL;
export const toI = (x) => Math.floor((x - MAP.minX) / CELL);
export const toJ = (z) => Math.floor((z - MAP.minZ) / CELL);
export const inGrid = (i, j) => i >= 0 && j >= 0 && i < GX && j < GZ;

export function initLand() {
  // buildable: above the waterline with a little freeboard, and not a cliff
  for (let j = 0; j < GZ; j++) for (let i = 0; i < GX; i++) {
    const x = cellX(i) + CELL / 2, z = cellZ(j) + CELL / 2;
    const h = heightAt(x, z);
    if (h < 1.0) continue;
    const s = Math.max(Math.abs(heightAt(x + 8, z) - heightAt(x - 8, z)), Math.abs(heightAt(x, z + 8) - heightAt(x, z - 8))) / 16;
    if (s < 0.55 && coastDist(x, z) > 6) land[j * GX + i] = 1;
  }
}

export const zoneTex = new THREE.DataTexture(overlay, GX, GZ, THREE.RedFormat, THREE.UnsignedByteType);
zoneTex.magFilter = zoneTex.minFilter = THREE.NearestFilter; zoneTex.unpackAlignment = 1; zoneTex.generateMipmaps = false;
zoneTex.needsUpdate = true;
let overlayDirty = false;
export function refreshOverlay(i0, j0, i1, j1) {
  i0 = Math.max(0, i0); j0 = Math.max(0, j0); i1 = Math.min(GX - 1, i1); j1 = Math.min(GZ - 1, j1);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const o = j * GX + i, b = bid[o];
    let v = zone[o];
    if (b) { const B = buildings.get(b); v |= 32; if (B && B.zone !== 1) v |= 16; }
    overlay[o] = v;
  }
  overlayDirty = true;
}
export function flushOverlay() { if (overlayDirty) { zoneTex.needsUpdate = true; overlayDirty = false; } }

// ---- buildings registry ----------------------------------------------------------------------
export const buildings = new Map();
export const chunkBuildings = Array.from({ length: CXN * CZN }, () => new Set());
export const stats = { pop: 0, jobsC: 0, jobsO: 0, jobsI: 0, count: 0 };
export const state = { nextId: 1, hooks: { chunkDirty: () => {}, cellsChanged: () => {}, clearTrees: () => {} } };
export const chunkOf = (i, j) => Math.floor(i / CH) + Math.floor(j / CH) * CXN;

function tally(b, s) {
  if (b.zone <= 2) stats.pop += s * b.res;
  else if (b.zone <= 4) stats.jobsC += s * b.jobs;
  else if (b.zone <= 6) stats.jobsO += s * b.jobs;
  else stats.jobsI += s * b.jobs;
  stats.count += s;
}
// b: {id?, i, j, w, d, zone, level, seed, front, born, birth, res, jobs, ...design}
export function addBuilding(b) {
  if (!b.id) b.id = state.nextId++;
  else if (b.id >= state.nextId) state.nextId = b.id + 1;
  for (let j = b.j; j < b.j + b.d; j++) for (let i = b.i; i < b.i + b.w; i++) bid[j * GX + i] = b.id;
  buildings.set(b.id, b);
  b.chunk = chunkOf(b.i, b.j);
  chunkBuildings[b.chunk].add(b.id);
  tally(b, 1);
  refreshOverlay(b.i, b.j, b.i + b.w - 1, b.j + b.d - 1);
  state.hooks.clearTrees(cellX(b.i), cellZ(b.j), cellX(b.i + b.w), cellZ(b.j + b.d));
  state.hooks.chunkDirty(b.chunk);
  state.hooks.cellsChanged(b.i - 1, b.j - 1, b.i + b.w, b.j + b.d);
  return b;
}
export function removeBuilding(id) {
  const b = buildings.get(id); if (!b) return null;
  for (let j = b.j; j < b.j + b.d; j++) for (let i = b.i; i < b.i + b.w; i++) if (bid[j * GX + i] === id) bid[j * GX + i] = 0;
  buildings.delete(id); chunkBuildings[b.chunk].delete(id);
  tally(b, -1);
  refreshOverlay(b.i, b.j, b.i + b.w - 1, b.j + b.d - 1);
  state.hooks.chunkDirty(b.chunk);
  state.hooks.cellsChanged(b.i - 1, b.j - 1, b.i + b.w, b.j + b.d);
  return b;
}
export function tierOf(pop) { let t = 0; for (let k = 0; k < TIERS.length; k++) if (pop >= TIERS[k][1]) t = k; return t; }
export function resetWorld() {
  zone.fill(0); road.fill(0); bid.fill(0); overlay.fill(0); overlayDirty = true;
  buildings.clear(); for (const s of chunkBuildings) s.clear();
  stats.pop = stats.jobsC = stats.jobsO = stats.jobsI = stats.count = 0; state.nextId = 1;
}
