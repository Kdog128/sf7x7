// Grid state for the city: zoning, road occupancy, building registry and the overlay texture.
import * as THREE from 'three';
import { MAP, heightAt, coastDist, HAS_AREAS, areaAt, areaOpen } from './terrain.js';

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
  { key: 'TS', group: 'O', name: 'Tech and startup', density: 'Special', color: '#8f7fd6', spec: true },
  { key: 'TL', group: 'C', name: 'Tourism and leisure', density: 'Special', color: '#e08a9c', spec: true },
  { key: 'MX', group: 'R', name: 'Mixed-use', density: 'Special', color: '#c9a36b', spec: true },
  { key: 'PM', group: 'I', name: 'Port and maritime', density: 'Special', color: '#6f8fa8', spec: true },
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

// buildable: above the waterline with a little freeboard, and not a cliff
function isLand(i, j) {
  const x = cellX(i) + CELL / 2, z = cellZ(j) + CELL / 2, h = heightAt(x, z);
  if (h < 1.0 || (HAS_AREAS && !areaOpen(areaAt(x, z)))) return 0;
  const s = Math.max(Math.abs(heightAt(x + 8, z) - heightAt(x - 8, z)), Math.abs(heightAt(x, z + 8) - heightAt(x, z - 8))) / 16;
  return s < 0.55 && coastDist(x, z) > 6 ? 1 : 0;
}
export function initLand() { for (let j = 0; j < GZ; j++) for (let i = 0; i < GX; i++) land[j * GX + i] = isLand(i, j); }
// an area opened (or a new city closed them again): re-evaluate every cell outside San Francisco
export function refreshAreas() {
  if (!HAS_AREAS) return;
  for (let j = 0; j < GZ; j++) for (let i = 0; i < GX; i++) { if (!areaAt(cellX(i) + CELL / 2, cellZ(j) + CELL / 2)) continue; const o = j * GX + i, l = isLand(i, j); land[o] = l; if (!l && !bid[o]) zone[o] = 0; }
}
// after terraforming: re-evaluate a cell rectangle; empty zoning on cells that are no longer land is dropped
export function updateLand(i0, j0, i1, j1) {
  i0 = Math.max(0, i0); j0 = Math.max(0, j0); i1 = Math.min(GX - 1, i1); j1 = Math.min(GZ - 1, j1);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const o = j * GX + i, l = isLand(i, j); land[o] = l; if (!l && !bid[o]) zone[o] = 0; }
  refreshOverlay(i0, j0, i1, j1); state.hooks.cellsChanged(i0 - 1, j0 - 1, i1 + 1, j1 + 1);
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
    if (b) { const B = buildings.get(b); v |= 32; if (B && B.zone !== 1 && !B.green) v |= 16; }
    overlay[o] = v;
  }
  overlayDirty = true;
}
export function flushOverlay() { if (overlayDirty) { zoneTex.needsUpdate = true; overlayDirty = false; } }

// ---- buildings registry ----------------------------------------------------------------------
export const buildings = new Map();
export const chunkBuildings = Array.from({ length: CXN * CZN }, () => new Set());
export const stats = { pop: 0, jobsC: 0, jobsO: 0, jobsI: 0, count: 0 };
export const state = { nextId: 1, hooks: { chunkDirty: () => {}, cellsChanged: () => {}, clearTrees: () => {}, added: () => {}, removed: () => {} } };
export const chunkOf = (i, j) => Math.floor(i / CH) + Math.floor(j / CH) * CXN;

function tally(b, s) {
  const g = b.zone ? ZONES[b.zone].group : 'C', j = s * (b.jobs || 0);
  stats.pop += s * (b.res || 0);
  if (g === 'O') stats.jobsO += j; else if (g === 'I') stats.jobsI += j; else stats.jobsC += j;
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
  state.hooks.added(b);
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
  state.hooks.removed(b);
  return b;
}
export function tierOf(pop) { let t = 0; for (let k = 0; k < TIERS.length; k++) if (pop >= TIERS[k][1]) t = k; return t; }
export function resetWorld() {
  zone.fill(0); road.fill(0); bid.fill(0); overlay.fill(0); overlayDirty = true;
  buildings.clear(); for (const s of chunkBuildings) s.clear();
  stats.pop = stats.jobsC = stats.jobsO = stats.jobsI = stats.count = 0; state.nextId = 1;
}
