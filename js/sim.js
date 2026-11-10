// Demand, growth and upgrades. Buildings appear on zoned cells that front a road.
import { CELL, GX, GZ, zone, road, bid, land, buildings, stats, addBuilding, removeBuilding, tierOf, state as W, inGrid } from './world.js';
import { design, lotBase, MAX_LEVEL } from './buildings.js';
import { clamp, smoothstep } from './util.js';

// frontier: zoned, empty, road-fronting cells, kept per zone for O(1) random sampling
const fzone = new Uint8Array(GX * GZ), fpos = new Int32Array(GX * GZ);
const lists = Array.from({ length: 9 }, () => []);
function setFrontier(o, z) {
  const cur = fzone[o]; if (cur === z) return;
  if (cur) { const l = lists[cur], p = fpos[o], last = l.pop(); if (last !== o) { l[p] = last; fpos[last] = p; } }
  if (z) { fpos[o] = lists[z].length; lists[z].push(o); }
  fzone[o] = z;
}
const access = (i, j) => inGrid(i, j) && road[j * GX + i] & 2;
export function refreshCells(i0, j0, i1, j1) {
  i0 = Math.max(0, i0); j0 = Math.max(0, j0); i1 = Math.min(GX - 1, i1); j1 = Math.min(GZ - 1, j1);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const o = j * GX + i, z = zone[o];
    const ok = z && !bid[o] && !road[o] && land[o] && (access(i - 1, j) || access(i + 1, j) || access(i, j - 1) || access(i, j + 1));
    setFrontier(o, ok ? z : 0);
  }
}
export function resetSim() { fzone.fill(0); for (const l of lists) l.length = 0; sim.demand = { R: 0.3, C: 0, O: 0, I: 0 }; sim.acc = 0; sim.uacc = 0; ids.length = 0; }
export const frontierSize = (z) => lists[z].length;

export const sim = { demand: { R: 0.3, C: 0, O: 0, I: 0 }, growth: 1, acc: 0, uacc: 0, time: 10, day: 1, lastBuilt: null, rand: Math.random };

function computeDemand() {
  const pop = stats.pop, workers = pop * 0.52, jobs = stats.jobsC + stats.jobsO + stats.jobsI;
  const off = smoothstep(500, 30000, pop), wI = 0.45 - 0.25 * off, wO = 0.12 + 0.6 * off, cT = pop * 0.2; // jobs outgrow local workers: commuters arrive from the wider Bay
  const t = {
    R: clamp(0.3 + (jobs * 1.1 - workers) / (workers + 120), -1, 1),
    C: clamp((cT - stats.jobsC) / (cT + 30), -1, 1),
    O: clamp((workers * wO - stats.jobsO) / (workers * wO + 40), -1, 1),
    I: clamp((workers * wI - stats.jobsI) / (workers * wI + 40), -1, 1),
  };
  for (const k in t) sim.demand[k] += (t[k] - sim.demand[k]) * 0.25;
}

// candidate lot sizes [frontage, depth, weight]
const LOTS = {
  1: [[1, 2, 6], [1, 3, 2], [2, 2, 1.5], [2, 3, 1]], 2: [[2, 3, 3], [3, 3, 3], [2, 2, 2], [3, 4, 2], [4, 4, 1.5]],
  3: [[1, 2, 3], [2, 2, 3], [2, 3, 2], [3, 2, 2], [1, 1, 1]], 4: [[3, 3, 3], [2, 3, 2], [4, 4, 2], [3, 4, 2], [4, 5, 1], [2, 2, 1]],
  5: [[2, 3, 3], [3, 3, 3], [2, 2, 2], [3, 4, 1.5]], 6: [[3, 3, 3], [4, 4, 3], [3, 4, 2], [4, 5, 1.5], [5, 5, 1.5], [2, 3, 1], [2, 2, 0.6]],
  7: [[2, 3, 3], [3, 3, 3], [3, 4, 2], [4, 4, 1.5], [2, 2, 1]], 8: [[4, 5, 3], [5, 6, 2], [4, 4, 2], [6, 6, 1.5], [3, 4, 1.5], [3, 3, 1]],
};
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // N E S W (direction of the street from the lot)

function tryPlace(o, rnd) {
  const z = zone[o], i = o % GX, j = (o - i) / GX;
  const fronts = []; for (let f = 0; f < 4; f++) if (access(i + DIRS[f][0], j + DIRS[f][1])) fronts.push(f);
  if (!fronts.length) return null;
  const f = fronts[Math.floor(rnd() * fronts.length)], [fx, fz] = DIRS[f], ax = -fz, az = fx; // (ax,az): along the street
  // weighted shuffle of lot sizes
  const opts = LOTS[z].map((l) => [l, Math.pow(rnd(), 1 / l[2])]).sort((a, b) => b[1] - a[1]).map((e) => e[0]);
  const free = (ci, cj) => { if (!inGrid(ci, cj)) return false; const q = cj * GX + ci; return zone[q] === z && !bid[q] && !road[q] && land[q]; };
  for (const [w, d] of opts) {
    const start = Math.floor(rnd() * w);
    for (let k = 0; k < w; k++) {
      const off = (start + k) % w; let ok = true;
      for (let a = 0; a < w && ok; a++) {
        const bi = i + ax * (a - off), bj = j + az * (a - off);
        if (!access(bi + fx, bj + fz)) { ok = false; break; }
        for (let b = 0; b < d; b++) if (!free(bi - fx * b, bj - fz * b)) { ok = false; break; }
      }
      if (!ok) continue;
      const i0 = i + ax * -off, j0 = j + az * -off, i1 = i + ax * (w - 1 - off) - fx * (d - 1), j1 = j + az * (w - 1 - off) - fz * (d - 1);
      return { i: Math.min(i0, i1), j: Math.min(j0, j1), w: Math.abs(i1 - i0) + 1, d: Math.abs(j1 - j0) + 1, zone: z, front: f };
    }
  }
  return null;
}

const ids = []; // building ids for random upgrade sampling (lazy-deleted)
export function spawn(lot, level, seed, birth) {
  const b = { ...lot, level, seed, born: sim.day, birth };
  Object.assign(b, design(b)); b.baseY = lotBase(b); b.topY = b.baseY + b.height * 1.3 + 8;
  addBuilding(b); ids.push(b.id); sim.lastBuilt = b;
  return b;
}
export function registerLoaded(b) { ids.push(b.id); }

function developedShare(b, rad) {
  const ci = b.i + (b.w >> 1), cj = b.j + (b.d >> 1); let n = 0, t = 0;
  for (let j = cj - rad; j <= cj + rad; j += 2) for (let i = ci - rad; i <= ci + rad; i += 2) { if (!inGrid(i, j)) continue; const q = j * GX + i; if (!land[q] || road[q]) continue; t++; if (bid[q]) n++; }
  return t ? n / t : 0;
}
// share of nearby cells that are built up in dark zoning: high in the middle of a dense district, lower at its edge
function centrality(b) {
  const ci = b.i + (b.w >> 1), cj = b.j + (b.d >> 1); let n = 0, t = 0;
  for (let j = cj - 28; j <= cj + 28; j += 4) for (let i = ci - 28; i <= ci + 28; i += 4) { t++; if (!inGrid(i, j)) continue; const q = j * GX + i; if (bid[q] && !(zone[q] & 1)) n++; }
  return n / t;
}
function levelCap(b) {
  const tier = tierOf(stats.pop), max = MAX_LEVEL[b.zone];
  if (b.zone & 1) return developedShare(b, 6) > 0.4 ? max : 1;            // light zones mature with their block
  let cap = Math.min(max, 1 + Math.floor((tier + 1) / 2));
  const c = centrality(b), area = b.w * b.d;
  cap = Math.min(cap, c > 0.5 ? 5 : c > 0.4 ? 4 : c > 0.28 ? 3 : c > 0.15 ? 2 : 1);
  if (area < 6) cap = Math.min(cap, 3); else if (area < 9) cap = Math.min(cap, 4);
  return Math.max(1, cap - [0, 0, 0, 1, 1, 2][b.seed % 6]);              // not every owner builds to the limit
}
const GROUP = ['', 'R', 'R', 'C', 'C', 'O', 'O', 'I', 'I'];

// dt: real seconds scaled by game speed. now: render clock for the rise animation.
export function stepSim(dt, now) {
  sim.time += dt * (24 / 180);
  if (sim.time >= 24) { sim.time -= 24; sim.day++; }
  computeDemand();
  const rnd = sim.rand, rate = (1.5 + 0.05 * Math.pow(stats.pop, 0.6)) * sim.growth;
  sim.acc = Math.min(sim.acc + rate * dt, 40);
  let guard = 0;
  while (sim.acc >= 1 && guard++ < 40) {
    sim.acc -= 1;
    const d = sim.demand, wR = Math.max(d.R, 0), wC = Math.max(d.C, 0), wO = Math.max(d.O, 0), wI = Math.max(d.I, 0), tot = wR + wC + wO + wI;
    if (tot <= 0) break;
    let x = rnd() * tot, g = x < wR ? 0 : x < wR + wC ? 1 : x < wR + wC + wO ? 2 : 3;
    if (rnd() > [wR, wC, wO, wI][g] * 1.6) continue;
    const zl = g * 2 + 1, zd = zl + 1, nl = lists[zl].length, nd = lists[zd].length;
    if (!nl && !nd) { sim.uacc += 0.6; continue; } // nowhere to build: pressure goes into taller buildings instead
    const z = rnd() * (nl + nd * 1.5) < nl ? zl : zd, l = lists[z];
    const lot = tryPlace(l[Math.floor(rnd() * l.length)], rnd);
    if (lot) spawn(lot, 1, Math.floor(rnd() * 0x7fffffff), now);
  }
  // upgrades
  sim.uacc = Math.min(sim.uacc + rate * 0.5 * dt, 20);
  while (sim.uacc >= 1 && ids.length) {
    sim.uacc -= 1;
    const k = Math.floor(rnd() * ids.length), b = buildings.get(ids[k]);
    if (!b) { ids[k] = ids[ids.length - 1]; ids.pop(); continue; }
    if (b.locked || sim.demand[GROUP[b.zone]] < 0.12 || sim.day - b.born < 1 || b.level >= levelCap(b)) continue;
    removeBuilding(b.id);
    spawn({ i: b.i, j: b.j, w: b.w, d: b.d, zone: b.zone, front: b.front }, b.level + 1, Math.floor(rnd() * 0x7fffffff), now);
  }
}
export { CELL };
